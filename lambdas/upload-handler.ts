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
  if (ext === '.pdf' || ['.jpg', '.jpeg', '.png', '.tif', '.tiff'].includes(ext)) {
    // Use DetectDocumentText for simpler, more reliable text extraction
    const textractResult = await textract.send(
      new DetectDocumentTextCommand({
        Document: { Bytes: fileBuffer },
      })
    );
    return textractResult.Blocks?.map(b => b.Text).filter(Boolean).join(' ') || '';
  } else if (ext === '.txt') {
    return fileBuffer.toString('utf-8');
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
    const documentId = crypto.randomUUID();
    const key = `${documentId}-${fileName}`;

    // 1️⃣ Upload to S3 (for backup/reference)
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: ext === '.txt' ? 'text/plain' : 'application/pdf',
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
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Upload or processing failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};
