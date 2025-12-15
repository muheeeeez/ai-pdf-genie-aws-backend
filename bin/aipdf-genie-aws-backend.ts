#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { PdfBucketStack } from '../lib/pdf-bucket-stack';
import { UploadLambdaStack } from '../lib/upload-lambda-stack';
import { ProcessingLambdaStack } from '../lib/processing-lambda-stack';

const app = new cdk.App();

// 1. Create S3 bucket for document storage
const bucketStack = new PdfBucketStack(app, 'AiPdfGenieBucketStack');

// 2. Create Upload Lambda (handles file upload, Textract extraction, Bedrock summary)
const uploadStack = new UploadLambdaStack(app, 'AiPdfGenieUploadStack', {
  pdfBucket: bucketStack.pdfBucket,
});

// 3. Create Processing Lambda (handles Q&A using extractedText from frontend)
const processingStack = new ProcessingLambdaStack(app, 'AiPdfGenieProcessingStack', {
  pdfBucket: bucketStack.pdfBucket,
});

// Output API endpoints
new cdk.CfnOutput(uploadStack, 'UploadApiEndpoint', {
  value: uploadStack.api.url,
  description: 'POST to /upload with { fileName, fileBase64 }',
});

new cdk.CfnOutput(processingStack, 'ProcessingApiEndpoint', {
  value: `${processingStack.api.url}process`,
  description: 'POST to /process with { extractedText, question }',
});
