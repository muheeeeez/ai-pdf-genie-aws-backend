import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class PdfBucketStack extends Stack {
  public readonly pdfBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.pdfBucket = new s3.Bucket(this, 'EphemeralPdfBucket', {
      removalPolicy: RemovalPolicy.DESTROY, // deletes bucket if stack is destroyed
      autoDeleteObjects: true, // deletes objects when bucket is destroyed
      encryption: s3.BucketEncryption.S3_MANAGED, // encrypt PDFs at rest
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // private bucket
      lifecycleRules: [
        {
          expiration: Duration.days(1), // delete PDFs automatically after 1 day
        },
      ],
    });
  }
}
