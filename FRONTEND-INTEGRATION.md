# 🎨 Frontend Integration Guide - AI PDF Genie Backend

Complete guide for integrating your frontend with the AI PDF Genie AWS backend.

---

## 📋 **Prerequisites**

After deploying the backend (`cdk deploy --all`), you'll have:
1. **Two API endpoints** (Upload & Processing)
2. **Two API keys** (one for each endpoint)

---

## 🔑 **Step 1: Get Your API Keys**

### **From AWS Console:**

1. Go to **AWS Console** → **API Gateway**
2. Click **API Keys** in the left sidebar
3. You'll see two keys:
   - `ai-pdf-genie-upload-key`
   - `ai-pdf-genie-processing-key`
4. Click each key → Click **"Show"** → Copy the value

### **Store Keys Securely:**

Create a `.env` file in your frontend project:

```bash
# .env (NEVER commit this to Git!)
VITE_UPLOAD_API_URL=https://xxxxx.execute-api.region.amazonaws.com/prod/upload
VITE_UPLOAD_API_KEY=your-upload-api-key-here

VITE_PROCESSING_API_URL=https://xxxxx.execute-api.region.amazonaws.com/prod/process
VITE_PROCESSING_API_KEY=your-processing-api-key-here
```

**For Create React App:**
```bash
REACT_APP_UPLOAD_API_URL=...
REACT_APP_UPLOAD_API_KEY=...
REACT_APP_PROCESSING_API_URL=...
REACT_APP_PROCESSING_API_KEY=...
```

---

## 📤 **Step 2: Implement File Upload**

### **Upload Flow:**
```
User selects file → Convert to base64 → Send to /upload → 
Receive extractedText + summary → Store in localStorage
```

### **Implementation:**

```typescript
// services/api.ts

interface UploadResponse {
  documentId: string;
  fileName: string;
  s3Key: string;
  extractedText: string;  // Store this for Q&A!
  summary: string;         // Display this to user
  message: string;
}

async function uploadDocument(file: File): Promise<UploadResponse> {
  // 1. Convert file to base64
  const base64 = await fileToBase64(file);

  // 2. Send to upload API
  const response = await fetch(import.meta.env.VITE_UPLOAD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': import.meta.env.VITE_UPLOAD_API_KEY, // ← Required!
    },
    body: JSON.stringify({
      fileName: file.name,
      fileBase64: base64,
    }),
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const data = await response.json();
  
  // 3. Store extracted text in localStorage for later Q&A
  localStorage.setItem(`doc-${data.documentId}`, data.extractedText);
  
  return data;
}

// Helper: Convert File to base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
}
```

---

## 💬 **Step 3: Implement Q&A**

### **Q&A Flow:**
```
User asks question → Get extractedText from localStorage → 
Send to /process → Display answer
```

### **Implementation:**

```typescript
// services/api.ts

interface QuestionResponse {
  question: string;
  answer: string;
}

async function askQuestion(
  documentId: string, 
  question: string
): Promise<QuestionResponse> {
  // 1. Get extracted text from localStorage
  const extractedText = localStorage.getItem(`doc-${documentId}`);
  
  if (!extractedText) {
    throw new Error('Document not found. Please upload again.');
  }

  // 2. Send to processing API
  const response = await fetch(import.meta.env.VITE_PROCESSING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': import.meta.env.VITE_PROCESSING_API_KEY, // ← Required!
    },
    body: JSON.stringify({
      extractedText,  // From localStorage
      question,       // User's question
    }),
  });

  if (!response.ok) {
    throw new Error(`Question failed: ${response.statusText}`);
  }

  return await response.json();
}
```

---

## 🎯 **Step 4: Complete React Example**

```typescript
// components/DocumentChat.tsx

import { useState } from 'react';

export function DocumentChat() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [question, setQuestion] = useState<string>('');
  const [answer, setAnswer] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Handle file upload
  const handleUpload = async () => {
    if (!file) return;
    
    setLoading(true);
    try {
      const result = await uploadDocument(file);
      
      setDocumentId(result.documentId);
      setSummary(result.summary);
      
      alert('Document uploaded and processed! ✅');
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // Handle question
  const handleAskQuestion = async () => {
    if (!documentId || !question) return;
    
    setLoading(true);
    try {
      const result = await askQuestion(documentId, question);
      setAnswer(result.answer);
    } catch (error) {
      console.error('Question error:', error);
      alert('Failed to get answer. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">AI PDF Genie</h1>

      {/* Upload Section */}
      <div className="mb-8 p-4 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">📤 Upload Document</h2>
        <input
          type="file"
          accept=".pdf,.txt,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="mb-4"
        />
        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Upload & Process'}
        </button>
      </div>

      {/* Summary Display */}
      {summary && (
        <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">📝 Summary</h2>
          <p>{summary}</p>
        </div>
      )}

      {/* Q&A Section */}
      {documentId && (
        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-4">💬 Ask Questions</h2>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What is this document about?"
            className="w-full p-2 border rounded mb-4"
          />
          <button
            onClick={handleAskQuestion}
            disabled={!question || loading}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
          >
            {loading ? 'Thinking...' : 'Ask Question'}
          </button>

          {answer && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
              <strong>Answer:</strong>
              <p className="mt-2">{answer}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## 🔒 **Step 5: Security Best Practices**

### ✅ **DO:**
- Store API keys in `.env` files
- Add `.env` to `.gitignore`
- Use environment variables in code
- Validate file types before upload
- Show loading states to users
- Handle errors gracefully

### ❌ **DON'T:**
- Commit API keys to Git
- Hard-code API keys in source code
- Share API keys publicly
- Skip error handling

---

## 🚨 **Error Handling**

```typescript
async function uploadDocument(file: File): Promise<UploadResponse> {
  try {
    const base64 = await fileToBase64(file);
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': uploadApiKey,
      },
      body: JSON.stringify({
        fileName: file.name,
        fileBase64: base64,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    return await response.json();
    
  } catch (error) {
    console.error('Upload error:', error);
    
    // User-friendly error messages
    if (error instanceof Error) {
      if (error.message.includes('403')) {
        throw new Error('Invalid API key. Check your configuration.');
      }
      if (error.message.includes('429')) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (error.message.includes('413')) {
        throw new Error('File too large. Maximum size is 10MB.');
      }
    }
    
    throw new Error('Upload failed. Please try again.');
  }
}
```

---

## 📱 **Supported File Types**

Your backend accepts:
- ✅ **PDF**: `.pdf`
- ✅ **Text**: `.txt`
- ✅ **Images**: `.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`

**Maximum file size:** 10MB (enforced on backend, but validate on frontend too!)

---

## 🎨 **UI/UX Recommendations**

### **Upload Flow:**
1. Show file picker with accepted types
2. Display file size/name before upload
3. Show progress indicator during upload
4. Display summary immediately after upload
5. Enable Q&A section once summary is ready

### **Q&A Flow:**
1. Keep summary visible for context
2. Show question history (optional)
3. Disable submit while processing
4. Show typing indicator for better UX
5. Allow follow-up questions easily

---

## 💾 **LocalStorage Structure**

```typescript
// Store extracted text
localStorage.setItem(`doc-${documentId}`, extractedText);

// Optional: Store metadata
localStorage.setItem(`doc-${documentId}-meta`, JSON.stringify({
  fileName: 'document.pdf',
  uploadedAt: new Date().toISOString(),
  summary: 'Summary text...',
}));

// Retrieve for Q&A
const extractedText = localStorage.getItem(`doc-${documentId}`);

// Clear old documents (optional cleanup)
function cleanupOldDocuments() {
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith('doc-')) {
      const meta = localStorage.getItem(`${key}-meta`);
      if (meta) {
        const { uploadedAt } = JSON.parse(meta);
        const age = Date.now() - new Date(uploadedAt).getTime();
        if (age > 24 * 60 * 60 * 1000) { // 24 hours
          localStorage.removeItem(key);
          localStorage.removeItem(`${key}-meta`);
        }
      }
    }
  });
}
```

---

## 🔧 **Testing**

### **Test Upload:**
```typescript
// Test with a small text file
const testFile = new File(['Hello world!'], 'test.txt', { type: 'text/plain' });
await uploadDocument(testFile);
```

### **Test Q&A:**
```typescript
await askQuestion(documentId, 'What is this document about?');
```

### **Test Error Handling:**
```typescript
// Test with invalid API key
// Test with file too large
// Test with unsupported file type
```

---

## 📊 **Rate Limits**

Be aware of these limits:

| Endpoint | Rate Limit | Daily Quota |
|----------|-----------|-------------|
| Upload | 5 req/sec | 1,000 uploads |
| Processing | 10 req/sec | 5,000 questions |

**Show user-friendly messages when limits are hit!**

---

## 🎯 **Complete TypeScript Types**

```typescript
// types/api.ts

export interface UploadRequest {
  fileName: string;
  fileBase64: string;
}

export interface UploadResponse {
  documentId: string;
  fileName: string;
  s3Key: string;
  extractedText: string;
  summary: string;
  message: string;
}

export interface QuestionRequest {
  extractedText: string;
  question: string;
}

export interface QuestionResponse {
  question: string;
  answer: string;
}

export interface ApiError {
  error: string;
  details?: string;
}
```

---

## 🚀 **Deployment Checklist**

Before deploying your frontend:

- [ ] API keys stored in environment variables
- [ ] `.env` added to `.gitignore`
- [ ] Error handling implemented
- [ ] Loading states added
- [ ] File size validation on frontend
- [ ] File type validation on frontend
- [ ] CORS origins updated in backend (if not done already)
- [ ] Tested upload flow
- [ ] Tested Q&A flow
- [ ] Tested error scenarios

---

## 📞 **Need Help?**

**Common Issues:**

1. **403 Forbidden** → Check API key is correct and included in `X-Api-Key` header
2. **429 Too Many Requests** → Rate limit exceeded, implement retry logic
3. **CORS Error** → Update backend CORS settings to include your domain
4. **Document not found** → localStorage might be cleared, re-upload document

---

## 🎉 **You're Ready!**

Your frontend can now:
- ✅ Upload documents (PDF, images, text)
- ✅ Get AI-generated summaries instantly
- ✅ Ask questions about documents
- ✅ Handle errors gracefully
- ✅ Work securely with API keys
- ✅ Stay within rate limits

**Happy coding!** 🚀

