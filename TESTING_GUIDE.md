# YANA/OGO Platform - Testing Guide

This guide shows you how to test the platform at its current stage of development.

---

## 🧪 **Testing Methods**

### **Method 1: Run Automated Tests** ✅ (Recommended)

The platform has comprehensive unit tests and property-based tests for all completed components.

#### **Run All Tests**
```bash
npm test
```

#### **Run Specific Component Tests**
```bash
# Test MCPInterface (the newest component)
npm test -- src/services/MCPInterface.test.ts

# Test Tool Registry
npm test -- src/services/ToolRegistry.test.ts

# Test Session Manager
npm test -- src/services/SessionManager.test.ts

# Test Schema Engine
npm test -- src/services/SchemaEngine.test.ts

# Test LLM Service
npm test -- src/services/LLMService.test.ts

# Test Property-based tests
npm test -- src/tests/properties/
```

#### **Run Tests in Watch Mode** (auto-rerun on file changes)
```bash
npm run test:watch
```

---

### **Method 2: Start the Server and Test Endpoints** 🌐

The server has basic endpoints you can test with curl or a browser.

#### **Step 1: Stop any running servers**
```bash
# Kill any process on port 3000
lsof -ti:3000 | xargs kill -9
```

#### **Step 2: Start the development server**
```bash
npm run dev
```

You should see:
```
YANA / OGO Platform starting...
Environment: development
Development mode: true
Server listening on port 3000
Webhook endpoint: POST http://localhost:3000/webhook/whatsapp
Health check: GET http://localhost:3000/health
```

#### **Step 3: Test the endpoints**

**Health Check (Browser or curl):**
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-04-20T17:00:00.000Z",
  "environment": "development"
}
```

**Webhook Endpoint (curl):**
```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "From": "whatsapp:+1234567890",
    "Body": "Hello",
    "MessageSid": "test123"
  }'
```

Expected: The server will validate the signature (will fail without proper Twilio signature, but you'll see the validation logic working).

---

### **Method 3: Interactive Testing with Node REPL** 🔧

You can test individual components interactively.

#### **Start Node REPL with TypeScript**
```bash
npx tsx
```

#### **Test MCPInterface**
```typescript
// Import the service
import { MCPInterface } from './src/services/MCPInterface.js';
import { ToolRegistry } from './src/services/ToolRegistry.js';

// Create instances
const toolRegistry = new ToolRegistry();
const mcpInterface = new MCPInterface(toolRegistry);

// Register a test tool
await toolRegistry.registerTool({
  name: 'test_tool',
  version: '1.0',
  description: 'Test tool',
  parameters: {
    required: [{ name: 'message', type: 'string' }],
    optional: []
  },
  providerMapping: {
    providerName: 'test',
    adapterClass: 'TestAdapter'
  },
  executionPolicy: {
    retryCount: 3,
    retryDelayMs: 1000,
    idempotent: true
  },
  permissions: { requiredRoles: [] },
  schemaBindings: { triggerSchemas: [] }
});

// Test validation
const result = await mcpInterface.executeToolCall(
  {
    tool: 'test_tool',
    params: { message: 'Hello' },
    context: {
      userLanguage: 'en',
      canonicalLanguage: 'en',
      sessionId: 'test-session',
      requestId: 'test-request'
    }
  },
  {
    correlationId: 'test-corr-id',
    sessionId: 'test-session',
    requestTimestamp: new Date()
  }
);

console.log(result);
```

---

### **Method 4: Use VS Code Debugger** 🐛

#### **Step 1: Open VS Code**

#### **Step 2: Set breakpoints**
- Open `src/services/MCPInterface.ts`
- Click in the left margin to set a breakpoint on line 100 (or any line you want to inspect)

#### **Step 3: Start debugging**
- Press **F5** or click "Run and Debug"
- Select "Debug YANA/OGO Server"

#### **Step 4: Trigger the code**
- In another terminal, send a request:
```bash
curl http://localhost:3000/health
```

The debugger will pause at your breakpoint, and you can inspect variables, step through code, etc.

---

## 📊 **What Can You Test Right Now?**

### ✅ **Fully Testable Components**

1. **MCPInterface** - Tool call validation, routing, logging, retry
   ```bash
   npm test -- src/services/MCPInterface.test.ts
   ```

2. **ToolRegistry** - Tool registration and retrieval
   ```bash
   npm test -- src/services/ToolRegistry.test.ts
   ```

3. **SessionManager** - Session creation and state management
   ```bash
   npm test -- src/services/SessionManager.test.ts
   ```

4. **SchemaEngine** - Schema validation and field collection
   ```bash
   npm test -- src/services/SchemaEngine.test.ts
   ```

5. **LLMService** - LLM decision mode (with mocked LLM)
   ```bash
   npm test -- src/services/LLMService.test.ts
   ```

6. **StateStore** - Redis state management (with mocked Redis)
   ```bash
   npm test -- src/services/StateStore.test.ts
   ```

7. **Repositories** - Database access layer
   ```bash
   npm test -- src/db/repositories/
   ```

8. **Property Tests** - Universal correctness guarantees
   ```bash
   npm test -- src/tests/properties/
   ```

### ⏳ **Not Yet Testable (Not Implemented)**

- ❌ End-to-end hotel search flow
- ❌ WhatsApp message rendering
- ❌ Booking and payment flows
- ❌ Translation service
- ❌ TTS generation
- ❌ Vendor CMS

---

## 🎯 **Recommended Testing Workflow**

### **For Quick Validation**
```bash
# Run all tests (takes ~10 seconds)
npm test
```

### **For Development**
```bash
# Run tests in watch mode (auto-rerun on changes)
npm run test:watch
```

### **For Debugging**
1. Set breakpoints in VS Code
2. Press F5 to start debugger
3. Send requests to trigger your breakpoints

### **For Manual Testing**
```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Send test requests
curl http://localhost:3000/health
```

---

## 📝 **Example Test Session**

Here's a complete example of testing the platform:

```bash
# 1. Install dependencies (if not done)
npm install

# 2. Run all tests to verify everything works
npm test

# Expected output:
# ✓ src/services/MCPInterface.test.ts (17 tests)
# ✓ src/services/ToolRegistry.test.ts (12 tests)
# ✓ src/services/SessionManager.test.ts (15 tests)
# ... etc
# Test Files  X passed (X)
# Tests  XXX passed (XXX)

# 3. Start the server
npm run dev

# Expected output:
# YANA / OGO Platform starting...
# Server listening on port 3000

# 4. In another terminal, test the health endpoint
curl http://localhost:3000/health

# Expected output:
# {"status":"ok","timestamp":"...","environment":"development"}

# 5. Stop the server (Ctrl+C in the server terminal)
```

---

## 🔍 **Troubleshooting**

### **Problem: "address already in use" error**

**Solution:**
```bash
# Kill the process on port 3000
lsof -ti:3000 | xargs kill -9

# Then start the server again
npm run dev
```

### **Problem: Tests fail with "Cannot find module"**

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### **Problem: TypeScript errors**

**Solution:**
```bash
# Check for type errors
npx tsc --noEmit

# If errors appear, they need to be fixed in the code
```

### **Problem: Tests are cached**

**Solution:**
```bash
# Clear test cache
npm test -- --no-cache
```

---

## 📈 **Test Coverage**

Current test coverage by component:

| Component | Unit Tests | Property Tests | Integration Tests |
|-----------|------------|----------------|-------------------|
| MCPInterface | ✅ 17 tests | ✅ 2 properties | ❌ Not yet |
| ToolRegistry | ✅ 12 tests | ❌ Not yet | ❌ Not yet |
| SessionManager | ✅ 15 tests | ✅ 2 properties | ❌ Not yet |
| SchemaEngine | ✅ 18 tests | ✅ 3 properties | ❌ Not yet |
| LLMService | ✅ 14 tests | ✅ 3 properties | ❌ Not yet |
| StateStore | ✅ 8 tests | ❌ Not yet | ❌ Not yet |
| Repositories | ✅ 24 tests | ❌ Not yet | ❌ Not yet |
| **Total** | **108 tests** | **10 properties** | **0 tests** |

---

## 🎓 **Understanding the Tests**

### **Unit Tests**
- Test individual functions and methods in isolation
- Use mocks for external dependencies
- Fast and focused

**Example:** Testing that MCPInterface validates required parameters

### **Property Tests**
- Test universal properties that should always hold true
- Generate hundreds of random test cases
- Catch edge cases you might not think of

**Example:** "For ANY tool call with missing required parameters, validation MUST fail"

### **Integration Tests** (Not yet implemented)
- Test multiple components working together
- Use real or realistic test data
- Slower but more comprehensive

**Example:** Testing the full flow from webhook → session → LLM → tool call → response

---

## 🚀 **Next Steps**

Once you've tested the current components, you can:

1. **Continue implementation** - Build the Orchestrator and WhatsApp Renderer
2. **Add more tests** - Write integration tests for end-to-end flows
3. **Test with real services** - Connect to actual Twilio, LLM, and database
4. **Deploy to staging** - Test in a production-like environment

---

**Last Updated:** April 20, 2026, 5:50 PM
