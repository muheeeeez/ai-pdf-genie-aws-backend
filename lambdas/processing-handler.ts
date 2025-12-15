import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({});

// Answer questions using Bedrock
async function answerQuestion(extractedText: string, question: string): Promise<string> {
  const modelId = 'amazon.titan-text-lite-v1';
  
  // Truncate text to avoid excessive token usage and costs
  const maxTextLength = 3000; // ~750 tokens
  const truncatedText = extractedText.length > maxTextLength 
    ? extractedText.slice(0, maxTextLength) + '...' 
    : extractedText;
  
  const userPrompt = `Based on this document content:\n\n${truncatedText}\n\nQuestion: ${question}\n\nAnswer:`;

  const requestBody = {
    inputText: userPrompt,
    textGenerationConfig: {
      maxTokenCount: 512,      // Limit output tokens to control costs
      temperature: 0.7,        // Balanced creativity
      topP: 0.9,              // Nucleus sampling
      stopSequences: []
    }
  };

  try {
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody)
    });

    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    // Extract the generated text from Titan's response format
    return responseBody.results[0].outputText.trim();
  } catch (error) {
    console.error('Bedrock error:', error);
    throw new Error(`AI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  // Handle preflight requests
  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    if (!event.body) {
      return { 
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No input provided' }) 
      };
    }

    const { extractedText, question } = JSON.parse(event.body);

    // Validate inputs
    if (!extractedText || !question) {
      return { 
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Missing required fields: extractedText and question',
          hint: 'Frontend should send the extractedText from localStorage along with the user question'
        }) 
      };
    }

    // Answer the question using the extracted text from frontend
    console.log('Processing Q&A with Bedrock...');
    const answer = await answerQuestion(extractedText, question);

    // Return the answer
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        question,
        answer,
      }),
    };
  } catch (err) {
    console.error('Q&A processing error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Q&A processing failed',
        details: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};
