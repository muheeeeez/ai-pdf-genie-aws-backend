import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

interface UploadLambdaStackProps extends StackProps {
  pdfBucket: s3.Bucket;
}

export class UploadLambdaStack extends Stack {
  public readonly uploadLambda: lambda.NodejsFunction;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: UploadLambdaStackProps) {
    super(scope, id, props);

    // Upload Lambda - handles upload, Textract extraction, and Bedrock summary
    this.uploadLambda = new lambda.NodejsFunction(this, 'UploadLambda', {
      entry: path.join(__dirname, '../lambdas/upload-handler.ts'),
      runtime: Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(60), // Textract + Bedrock processing takes time
      memorySize: 512, // Increase memory for better performance
      environment: {
        BUCKET_NAME: props.pdfBucket.bucketName,
      },
    });

    // Grant Lambda permission to read/write the bucket
    props.pdfBucket.grantReadWrite(this.uploadLambda);

    // Grant Lambda permission to use Textract
    this.uploadLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'textract:AnalyzeDocument',
        'textract:DetectDocumentText',
      ],
      resources: ['*'],
    }));

    // Grant Lambda permission to invoke Bedrock models
    this.uploadLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/amazon.titan-text-lite-v1`,
        `arn:aws:bedrock:*::foundation-model/amazon.titan-text-express-v1`,
      ],
    }));

    // API Gateway with security
    this.api = new apigateway.RestApi(this, 'AIPDFGenieApi', {
      restApiName: 'AI PDF Genie Upload API',
      description: 'Secure API for PDF upload and processing',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 10,  // Max 10 concurrent requests
        throttlingRateLimit: 5,    // Max 5 requests per second
        metricsEnabled: true,
      },
      // CORS Configuration
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // Change to ['https://your-frontend.com'] in production
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
        ],
        maxAge: cdk.Duration.hours(1),
      },
      // Enforce HTTPS only
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*'],
            conditions: {
              StringEquals: {
                'aws:SecureTransport': 'true', // HTTPS only
              },
            },
          }),
        ],
      }),
    });

    // Create API Key
    const apiKey = this.api.addApiKey('UploadApiKey', {
      apiKeyName: 'ai-pdf-genie-upload-key',
      description: 'API Key for Upload endpoint',
    });

    // Create usage plan with rate limiting
    const usagePlan = this.api.addUsagePlan('UploadUsagePlan', {
      name: 'Upload Usage Plan',
      throttle: {
        rateLimit: 5,       // 5 requests per second
        burstLimit: 10,     // Max 10 concurrent
      },
      quota: {
        limit: 1000,        // Max 1000 requests per day
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiKey(apiKey);

    const uploadIntegration = new apigateway.LambdaIntegration(this.uploadLambda);
    const uploadResource = this.api.root.addResource('upload');
    uploadResource.addMethod('POST', uploadIntegration, {
      apiKeyRequired: true, // Require API key
    });

    // Associate usage plan with stage
    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    new cdk.CfnOutput(this, 'ApiUrl', { 
      value: this.api.url,
      description: 'Upload API URL (requires X-Api-Key header)',
    });
    
    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID - get value from AWS Console → API Gateway → API Keys',
    });
  }
}
