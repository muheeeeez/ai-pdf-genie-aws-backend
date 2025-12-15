# AI PDF Genie - AWS Backend

AI-powered document processing backend that extracts text from PDFs and generates intelligent summaries and answers using AWS AI services.

## What It Does

Upload a PDF, image, or text file and get:
- ✅ **Instant AI Summary** - Automatic document summarization
- ✅ **Text Extraction** - Extract text from any document format
- ✅ **Q&A Capability** - Ask questions about your documents

## AWS Services Used

- **AWS Lambda** - Serverless compute for processing
- **Amazon Textract** - AI-powered text extraction from PDFs and images
- **Amazon Bedrock** (Titan Text Lite) - AI text generation for summaries and Q&A
- **Amazon S3** - Temporary file storage (auto-deleted after 1 day)
- **API Gateway** - REST API endpoints with API key authentication
- **CloudFormation** - Infrastructure as Code via AWS CDK

## Architecture

```
Frontend → API Gateway → Lambda → Textract → Bedrock → Response
                                    ↓
                                   S3
```

## Deployment

Automatically deploys via GitHub Actions on push to `master` branch.

```bash
# Manual deployment
cdk deploy --all
```

## Region

Deployed to: **ca-central-1** (Canada Central)

