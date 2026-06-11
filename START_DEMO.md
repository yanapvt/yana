# 🚀 Start the YANA/OGO Demo

## **Follow These Steps Exactly:**

### **Step 1: Open a NEW Terminal**
- In VS Code, click Terminal → New Terminal
- Or press `` Ctrl+Shift+` ``

### **Step 2: Kill any existing process on port 3000**
Copy and paste this command:
```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1; echo "✓ Port 3000 is now free"
```

### **Step 3: Start the server**
Copy and paste this command:
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

### **Step 4: Open your browser**
Go to: **http://localhost:3000/demo**

---

## ✅ **What You'll See**

A web page with interactive buttons to test:
1. **System Status** - See which components are running
2. **Hotel Search** - Test the MCPInterface with a hotel search
3. **Session Creation** - Test the SessionManager
4. **Schema Validation** - Test the SchemaEngine
5. **List Tools** - See all registered tools

---

## 🎮 **How to Use**

1. Click any "Test Now" or "Test..." button
2. Wait a moment for the result
3. See the JSON response with all the data
4. Try different tests!

---

## 📸 **Screenshot of What You'll See**

The demo page has:
- A clean, modern interface
- Interactive buttons for each component
- Real-time JSON responses
- Success/error indicators

---

## 🐛 **If Something Goes Wrong**

### **Problem: "address already in use"**
```bash
# Run this in the terminal:
lsof -ti:3000 | xargs kill -9
# Then start again:
npm run dev
```

### **Problem: "Cannot GET /demo"**
- Make sure the server is running (you should see "Server listening on port 3000")
- Try refreshing the browser
- Check the URL is exactly: http://localhost:3000/demo

### **Problem: Buttons don't work**
- Open browser console (F12)
- Look for JavaScript errors
- Refresh the page

---

## 🎯 **What's Being Tested**

When you click the buttons, you're testing:

✅ **MCPInterface** - Tool call validation, routing, logging  
✅ **ToolRegistry** - Tool registration and retrieval  
✅ **SessionManager** - Session creation and management  
✅ **SchemaEngine** - Schema validation and field checking  
✅ **StateStore** - Redis state management  

All with **real code** that's been implemented and tested!

---

## 💡 **Pro Tips**

- Keep the terminal open to see server logs
- Each test shows detailed JSON responses
- You can test multiple times
- Try the curl commands in `DEMO_QUICKSTART.md` for command-line testing

---

**Ready? Start with Step 1! 🚀**
