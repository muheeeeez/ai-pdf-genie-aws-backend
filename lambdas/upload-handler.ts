import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as crypto from 'crypto';

const s3 = new S3Client({});
const textract = new TextractClient({});
const bedrock = new BedrockRuntimeClient({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

// Extract text from document using Textract or direct read
async function extractText(fileBuffer: Buffer, ext: string): Promise<string> {
  if (ext === '.txt') {
    return fileBuffer.toString('utf-8');
  }
  
  if (ext === '.pdf' || ['.jpg', '.jpeg', '.png', '.tif', '.tiff'].includes(ext)) {
    console.log(`Processing ${ext} file with Textract (size: ${fileBuffer.length} bytes)`);
    
    // Validate PDF file signature
    if (ext === '.pdf') {
      const header = fileBuffer.slice(0, 5).toString('utf-8');
      if (!header.startsWith('%PDF-')) {
        throw new Error('Invalid PDF file: File does not have a valid PDF signature. Please ensure the file is a valid PDF.');
      }
      
      // Check if PDF is not corrupted (should have %%EOF at the end)
      const tail = fileBuffer.slice(-1024).toString('utf-8');
      if (!tail.includes('%%EOF')) {
        console.warn('PDF might be truncated or corrupted: missing %%EOF marker');
      }
      
      // Textract has size limits: 10MB for DetectDocumentText with bytes
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (fileBuffer.length > maxSize) {
        throw new Error(`PDF file too large (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB). Maximum size is 10MB for direct processing.`);
      }
    }
    
    try {
      // Use DetectDocumentText for text extraction
      const textractResult = await textract.send(
        new DetectDocumentTextCommand({
          Document: { Bytes: fileBuffer },
        })
      );
      
      // Filter for LINE blocks for better text quality
      const extractedText = textractResult.Blocks
        ?.filter(block => block.BlockType === 'LINE' && block.Text)
        .map(block => block.Text)
        .join(' ') || '';
      
      console.log(`Successfully extracted ${extractedText.length} characters from ${ext} file`);
      
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('No text could be extracted from the document. The document might be empty, image-based, or password-protected.');
      }
      
      return extractedText;
    } catch (error: any) {
      console.error('Textract error details:', {
        name: error.name,
        message: error.message,
        code: error.Code,
        statusCode: error.$metadata?.httpStatusCode
      });
      
      // Provide specific error messages
      if (error.name === 'UnsupportedDocumentException') {
        throw new Error('PDF format not supported by Textract. Please ensure the PDF is not encrypted, password-protected, or corrupted. Try re-saving the PDF or using a different file.');
      } else if (error.name === 'InvalidParameterException') {
        throw new Error('Invalid document format. The file might be corrupted or not a valid PDF.');
      } else if (error.message && !error.name?.includes('Exception')) {
        // Re-throw our custom errors
        throw error;
      }
      
      throw new Error(`Text extraction failed: ${error.message || 'Unknown error'}`);
    }
  }
  
  return '';
}

// Generate summary using Bedrock
async function generateSummary(text: string): Promise<string> {
  const modelId = 'amazon.titan-text-lite-v1';
  const maxTextLength = 3000; // ~750 tokens to control costs
  const truncatedText = text.length > maxTextLength ? text.slice(0, maxTextLength) + '...' : text;

  const requestBody = {
    inputText: `Provide a concise summary of the following document:\n\n${truncatedText}\n\nSummary:`,
    textGenerationConfig: {
      maxTokenCount: 512,
      temperature: 0.7,
      topP: 0.9,
      stopSequences: []
    }
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await bedrock.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.results[0].outputText.trim();
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  try {
    if (!event.body) {
      return { 
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No file uploaded' }) 
      };
    }

    const { fileName, fileBase64 } = JSON.parse(event.body);

    // Validate supported file types
    const allowedExtensions = ['.pdf', '.txt', '.jpg', '.jpeg', '.png', '.tif', '.tiff'];
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return { 
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unsupported file type' }) 
      };
    }

    const fileBuffer = Buffer.from(fileBase64, 'base64');
    
    // Validate buffer
    if (!fileBuffer || fileBuffer.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Empty or invalid file received' }),
      };
    }
    
    const documentId = crypto.randomUUID();
    const key = `${documentId}-${fileName}`;

    // Determine proper content type for S3
    const contentTypeMap: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.tif': 'image/tiff',
      '.tiff': 'image/tiff',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    // 1️⃣ Upload to S3 (for backup/reference)
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
      })
    );

    // 2️⃣ Extract text immediately using Textract
    console.log('Extracting text from document...');
    const extractedText = await extractText(fileBuffer, ext);

    if (!extractedText) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Could not extract text from document' }),
      };
    }

    // 3️⃣ Generate initial summary using Bedrock
    console.log('Generating AI summary...');
    const summary = await generateSummary(extractedText);

    // 4️⃣ Return BOTH extracted text and summary to frontend
    // Frontend will store in localStorage for later Q&A
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        documentId,
        fileName,
        s3Key: key,
        extractedText,  // Frontend stores this for Q&A
        summary,        // Frontend displays this immediately
        message: 'Document processed successfully. You can now ask questions about it.',
      }),
    };
  } catch (err) {
    console.error('Upload/Processing error:', err);
    
    // Determine appropriate status code and message
    let statusCode = 500;
    let errorMessage = 'Upload or processing failed';
    
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      
      // Client errors (400) - user can fix
      if (msg.includes('invalid') || 
          msg.includes('not supported') || 
          msg.includes('too large') ||
          msg.includes('empty') ||
          msg.includes('password-protected') ||
          msg.includes('encrypted') ||
          msg.includes('corrupted')) {
        statusCode = 400;
        errorMessage = err.message;
      } else {
        // Server errors (500) - system issue
        errorMessage = 'Server processing error';
      }
    }
    
    return {
      statusCode,
      headers: corsHeaders,
      body: JSON.stringify({
        error: errorMessage,
        details: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};
