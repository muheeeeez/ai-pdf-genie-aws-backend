import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

interface ProcessingLambdaStackProps extends StackProps {
  pdfBucket: s3.Bucket;
}

export class ProcessingLambdaStack extends Stack {
  public readonly processingLambda: lambda.NodejsFunction;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ProcessingLambdaStackProps) {
    super(scope, id, props);

    // ✅ Processing Lambda - handles Q&A using extractedText from frontend
    this.processingLambda = new lambda.NodejsFunction(this, 'ProcessingLambda', {
      entry: path.join(__dirname, '../lambdas/processing-handler.ts'),
      runtime: Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30), // Simpler now - just Bedrock call
      memorySize: 256, // Less memory needed - no Textract
      environment: {
        // No environment variables needed - receives extractedText from frontend
      },
    });

    // Grant Lambda permission to invoke Bedrock models (only permission needed)
    this.processingLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/amazon.titan-text-lite-v1`,
        `arn:aws:bedrock:*::foundation-model/amazon.titan-text-express-v1`,
      ],
    }));

    // ✅ API Gateway integration with security
    this.api = new apigateway.RestApi(this, 'ProcessingApi', {
      restApiName: 'AI PDF Genie Processing API',
      description: 'Secure API for document Q&A',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 20,  // Higher limit for Q&A
        throttlingRateLimit: 10,   // Max 10 requests per second
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
    const apiKey = this.api.addApiKey('ProcessingApiKey', {
      apiKeyName: 'ai-pdf-genie-processing-key',
      description: 'API Key for Q&A endpoint',
    });

    // Create usage plan with rate limiting
    const usagePlan = this.api.addUsagePlan('ProcessingUsagePlan', {
      name: 'Q&A Usage Plan',
      throttle: {
        rateLimit: 10,      // 10 requests per second
        burstLimit: 20,     // Max 20 concurrent
      },
      quota: {
        limit: 5000,        // Max 5000 questions per day
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiKey(apiKey);

    const processingIntegration = new apigateway.LambdaIntegration(this.processingLambda);
    const processResource = this.api.root.addResource('process');
    processResource.addMethod('POST', processingIntegration, {
      apiKeyRequired: true, // Require API key
    });

    // Associate usage plan with stage
    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    new cdk.CfnOutput(this, 'ProcessingApiUrl', { 
      value: this.api.url,
      description: 'Processing API URL (requires X-Api-Key header)',
    });

    new cdk.CfnOutput(this, 'ProcessingApiKeyId', {
      value: apiKey.keyId,
      description: 'Processing API Key ID - get value from AWS Console → API Gateway → API Keys',
    });
  }
}
