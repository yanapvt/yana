# 🚀 YANA/OGO Demo - Quick Start Guide

## **Start the Demo in 3 Steps**

### **Step 1: Stop any running servers**
```bash
# Kill any process on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || echo "Port 3000 is free"
```

### **Step 2: Start the server**
```bash
npm run dev
```

You should see:
```
YANA / OGO Platform starting...
Environment: development
Development mode: true
Server listening on port 3000
```

### **Step 3: Open the demo in your browser**

Go to: **http://localhost:3000/demo**

---

## 🎮 **What You Can Test**

### **1. System Status**
- Click "Test Now" under "System Status"
- See which components are available

### **2. Hotel Search Tool Call**
- Click "Test Hotel Search"
- See the MCPInterface validate and execute a hotel search
- View the mock hotel results

### **3. Session Creation**
- Click "Test Session Creation"
- See SessionManager create a new user session
- View the session ID and user details

### **4. Schema Validation**
- Click "Test Schema Validation"
- See SchemaEngine validate hotel search parameters
- View missing fields and validation errors

### **5. List Tools**
- Click "List Tools"
- See all registered tools in the ToolRegistry

---

## 📸 **What You'll See**

Each test shows:
- ✅ **Success/Error status**
- 📊 **JSON response** with all the data
- ⏱️ **Timestamp** of the request
- 🔍 **Detailed information** about what happened

---

## 🧪 **Testing with curl** (Alternative)

If you prefer command line:

```bash
# Test system status
curl http://localhost:3000/demo/status

# Test hotel search
curl -X POST http://localhost:3000/demo/tool-call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "search_hotels",
    "params": {
      "location": "Galle, Sri Lanka",
      "checkin_date": "2026-05-01",
      "checkout_date": "2026-05-03",
      "guests": 2
    }
  }'

# Test session creation
curl -X POST http://localhost:3000/demo/session \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+94771234567",
    "name": "John Doe"
  }'

# Test schema validation
curl -X POST http://localhost:3000/demo/schema-validation \
  -H "Content-Type: application/json" \
  -d '{
    "schema": "search_hotels",
    "fields": {
      "location": "Galle",
      "checkin_date": "2026-05-01"
    }
  }'

# List all tools
curl http://localhost:3000/demo/tools
```

---

## 🎯 **What's Being Tested**

### **MCPInterface** (Task 9.2)
- ✅ Tool call validation
- ✅ Parameter normalization
- ✅ Provider adapter routing
- ✅ Logging with correlation IDs
- ✅ Retry logic (simulated)

### **ToolRegistry** (Task 9.1)
- ✅ Tool registration
- ✅ Tool retrieval
- ✅ Tool listing

### **SessionManager** (Task 5.1)
- ✅ Session creation
- ✅ User profile management
- ✅ Session state tracking

### **SchemaEngine** (Task 6.2)
- ✅ Schema validation
- ✅ Missing field detection
- ✅ Field completeness checking

---

## 🔍 **Understanding the Results**

### **Successful Tool Call Response:**
```json
{
  "success": true,
  "toolCall": {
    "tool": "search_hotels",
    "params": { "location": "Galle", ... },
    "correlationId": "demo-correlation-1234567890"
  },
  "result": {
    "success": true,
    "data": {
      "results": [
        {
          "name": "Galle Face Hotel",
          "price": 150,
          "currency": "USD",
          "rating": 4.5,
          ...
        }
      ]
    },
    "metadata": {
      "toolName": "search_hotels",
      "executionTimeMs": 5,
      "attemptNumber": 1,
      "provider": "demo_hotels"
    }
  }
}
```

### **Session Creation Response:**
```json
{
  "success": true,
  "session": {
    "sessionId": "sess_abc123",
    "userId": "user_xyz789",
    "phoneNumber": "+94771234567",
    "createdAt": "2026-04-20T18:00:00.000Z"
  },
  "message": "Session created successfully"
}
```

### **Schema Validation Response:**
```json
{
  "success": true,
  "schema": "search_hotels",
  "fields": {
    "location": "Galle",
    "checkin_date": "2026-05-01"
  },
  "validation": {
    "isComplete": true,
    "missingFields": [],
    "isValid": true,
    "errors": []
  }
}
```

---

## 🐛 **Troubleshooting**

### **Problem: Port 3000 already in use**
```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

### **Problem: Module not found errors**
```bash
npm install
npm run dev
```

### **Problem: Page not loading**
1. Check the server is running (look for "Server listening on port 3000")
2. Try http://localhost:3000/demo in your browser
3. Check for errors in the terminal

---

## 📚 **Next Steps**

After testing the demo:

1. **Run the automated tests:**
   ```bash
   npm test
   ```

2. **Read the implementation review:**
   - Open `IMPLEMENTATION_REVIEW.md`

3. **Continue development:**
   - Implement remaining tasks
   - Add more components
   - Build end-to-end flows

---

## 💡 **Tips**

- **Keep the terminal open** to see server logs
- **Refresh the page** if something doesn't work
- **Check the browser console** (F12) for JavaScript errors
- **Use the curl commands** for automated testing

---

**Enjoy testing the YANA/OGO platform! 🎉**
