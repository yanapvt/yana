// @ts-nocheck
/**
 * Demo/Playground Routes
 * Manual testing endpoints for completed components
 */

import { Router, Request, Response } from 'express';
import { MCPInterface, ProviderAdapter } from '../services/MCPInterface.js';
import { ToolRegistry } from '../services/ToolRegistry.js';
import { SessionManager } from '../services/SessionManager.js';
import { SchemaEngine } from '../services/SchemaEngine.js';
import { LLMService } from '../services/LLMService.js';
import { StateStore } from '../services/StateStore.js';
import { CorrelationContext, ToolCallRequest } from '../types/core.js';

const router = Router();

// ============================================================================
// Mock Provider Adapter for Demo
// ============================================================================

class DemoHotelAdapter implements ProviderAdapter {
  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    // Simulate hotel search results
    return {
      results: [
        {
          name: 'Galle Face Hotel',
          location: params.location || 'Galle',
          price: 150,
          currency: 'USD',
          rating: 4.5,
          reviewCount: 1250,
          amenities: ['WiFi', 'Pool', 'Restaurant', 'Spa'],
          cancellationPolicy: 'Free cancellation up to 24 hours before check-in',
          bookingToken: 'demo_token_123',
        },
        {
          name: 'Jetwing Lighthouse',
          location: params.location || 'Galle',
          price: 200,
          currency: 'USD',
          rating: 4.8,
          reviewCount: 890,
          amenities: ['WiFi', 'Pool', 'Beach Access', 'Restaurant'],
          cancellationPolicy: 'Free cancellation up to 48 hours before check-in',
          bookingToken: 'demo_token_456',
        },
      ],
    };
  }

  getProviderName(): string {
    return 'demo_hotel_provider';
  }
}

// ============================================================================
// Initialize Services
// ============================================================================

const toolRegistry = new ToolRegistry();
const mcpInterface = new MCPInterface(toolRegistry);
const sessionManager = new SessionManager();
const schemaEngine = new SchemaEngine();
// LLMService not initialized in demo (requires API key)
const stateStore = new StateStore();

// Register demo hotel search tool
toolRegistry.registerTool({
  name: 'search_hotels',
  version: '1.0',
  description: 'Search for hotels by location and dates',
  parameters: {
    required: [
      { name: 'location', type: 'string', description: 'Hotel location' },
      { name: 'checkin_date', type: 'date', description: 'Check-in date' },
    ],
    optional: [
      { name: 'checkout_date', type: 'date', description: 'Check-out date' },
      { name: 'guests', type: 'number', description: 'Number of guests' },
    ],
  },
  providerMapping: {
    providerName: 'demo_hotels',
    adapterClass: 'DemoHotelAdapter',
  },
  executionPolicy: {
    retryCount: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
    idempotent: true,
  },
  permissions: {
    requiredRoles: [],
  },
  schemaBindings: {
    triggerSchemas: ['search_hotels'],
  },
});

// Register the demo adapter
mcpInterface.registerAdapter('DemoHotelAdapter', new DemoHotelAdapter());

// ============================================================================
// Demo Home Page
// ============================================================================

router.get('/', (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>YANA/OGO Platform - Demo Playground</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background: #f5f5f5;
        }
        h1 { color: #333; }
        .section {
          background: white;
          padding: 20px;
          margin: 20px 0;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .endpoint {
          background: #f8f9fa;
          padding: 15px;
          margin: 10px 0;
          border-left: 4px solid #007bff;
          border-radius: 4px;
        }
        .method {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-weight: bold;
          margin-right: 10px;
        }
        .get { background: #28a745; color: white; }
        .post { background: #007bff; color: white; }
        code {
          background: #f4f4f4;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
        }
        pre {
          background: #2d2d2d;
          color: #f8f8f2;
          padding: 15px;
          border-radius: 4px;
          overflow-x: auto;
        }
        button {
          background: #007bff;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        button:hover { background: #0056b3; }
        .status { margin-top: 10px; padding: 10px; border-radius: 4px; }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <h1>🚀 YANA/OGO Platform - Demo Playground</h1>
      <p>Test the completed components manually through these interactive endpoints.</p>

      <div class="section">
        <h2>📊 System Status</h2>
        <div class="endpoint">
          <span class="method get">GET</span>
          <code>/demo/status</code>
          <p>Check which components are available for testing</p>
          <button onclick="testEndpoint('/demo/status', 'GET')">Test Now</button>
          <div id="status-result"></div>
        </div>
      </div>

      <div class="section">
        <h2>🔧 Component Testing</h2>
        
        <div class="endpoint">
          <span class="method post">POST</span>
          <code>/demo/tool-call</code>
          <p>Test the MCPInterface with a hotel search tool call</p>
          <button onclick="testToolCall()">Test Hotel Search</button>
          <div id="tool-call-result"></div>
        </div>

        <div class="endpoint">
          <span class="method post">POST</span>
          <code>/demo/session</code>
          <p>Test SessionManager - create and manage sessions</p>
          <button onclick="testSession()">Test Session Creation</button>
          <div id="session-result"></div>
        </div>

        <div class="endpoint">
          <span class="method post">POST</span>
          <code>/demo/schema-validation</code>
          <p>Test SchemaEngine - validate hotel search parameters</p>
          <button onclick="testSchema()">Test Schema Validation</button>
          <div id="schema-result"></div>
        </div>

        <div class="endpoint">
          <span class="method get">GET</span>
          <code>/demo/tools</code>
          <p>List all registered tools in the ToolRegistry</p>
          <button onclick="testEndpoint('/demo/tools', 'GET')">List Tools</button>
          <div id="tools-result"></div>
        </div>
      </div>

      <div class="section">
        <h2>📖 Documentation</h2>
        <ul>
          <li><a href="/demo/docs">API Documentation</a></li>
          <li><a href="https://github.com/yourusername/yana-ogo">GitHub Repository</a></li>
        </ul>
      </div>

      <script>
        async function testEndpoint(url, method = 'GET', body = null) {
          const resultId = url.split('/').pop() + '-result';
          const resultDiv = document.getElementById(resultId);
          resultDiv.innerHTML = '<p>Loading...</p>';

          try {
            const options = {
              method,
              headers: { 'Content-Type': 'application/json' }
            };
            if (body) options.body = JSON.stringify(body);

            const response = await fetch(url, options);
            const data = await response.json();
            
            resultDiv.innerHTML = \`
              <div class="status success">
                <strong>✓ Success</strong>
                <pre>\${JSON.stringify(data, null, 2)}</pre>
              </div>
            \`;
          } catch (error) {
            resultDiv.innerHTML = \`
              <div class="status error">
                <strong>✗ Error</strong>
                <p>\${error.message}</p>
              </div>
            \`;
          }
        }

        async function testToolCall() {
          const body = {
            tool: 'search_hotels',
            params: {
              location: 'Galle, Sri Lanka',
              checkin_date: '2026-05-01',
              checkout_date: '2026-05-03',
              guests: 2
            }
          };
          await testEndpoint('/demo/tool-call', 'POST', body);
        }

        async function testSession() {
          const body = {
            phoneNumber: '+94771234567',
            name: 'Demo User'
          };
          await testEndpoint('/demo/session', 'POST', body);
        }

        async function testSchema() {
          const body = {
            schema: 'search_hotels',
            fields: {
              location: 'Galle',
              checkin_date: '2026-05-01'
            }
          };
          await testEndpoint('/demo/schema-validation', 'POST', body);
        }
      </script>
    </body>
    </html>
  `);
});

// ============================================================================
// Status Endpoint
// ============================================================================

router.get('/status', (req: Request, res: Response) => {
  res.json({
    status: 'operational',
    components: {
      mcpInterface: { status: 'available', version: '1.0' },
      toolRegistry: { status: 'available', version: '1.0' },
      sessionManager: { status: 'available', version: '1.0' },
      schemaEngine: { status: 'available', version: '1.0' },
      llmService: { status: 'not_configured', version: '1.0', note: 'Requires API key' },
      stateStore: { status: 'available', version: '1.0' },
    },
    registeredTools: ['search_hotels'],
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Tool Call Testing
// ============================================================================

router.post('/tool-call', async (req: Request, res: Response) => {
  try {
    const { tool, params } = req.body;

    const toolCallRequest: ToolCallRequest = {
      tool,
      params,
      context: {
        userLanguage: 'en',
        canonicalLanguage: 'en',
        sessionId: 'demo-session-' + Date.now(),
        requestId: 'demo-request-' + Date.now(),
      },
    };

    const correlationCtx: CorrelationContext = {
      correlationId: 'demo-correlation-' + Date.now(),
      sessionId: toolCallRequest.context.sessionId,
      userId: 'demo-user',
      requestTimestamp: new Date(),
    };

    const result = await mcpInterface.executeToolCall(toolCallRequest, correlationCtx);

    res.json({
      success: true,
      toolCall: {
        tool,
        params,
        correlationId: correlationCtx.correlationId,
      },
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Session Testing
// ============================================================================

router.post('/session', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, name } = req.body;

    const session = await sessionManager.createSession({
      phoneNumber: phoneNumber || '+94771234567',
      name: name || 'Demo User',
      preferredLanguage: 'en',
    });

    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        phoneNumber: session.phoneNumber,
        createdAt: session.createdAt,
      },
      message: 'Session created successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Schema Validation Testing
// ============================================================================

router.post('/schema-validation', async (req: Request, res: Response) => {
  try {
    const { schema, fields } = req.body;

    // Get the schema definition
    const schemaDefinition = {
      name: 'search_hotels',
      version: '1.0',
      requiredFields: ['location', 'checkin_date'],
      optionalFields: ['checkout_date', 'guests'],
      fields: {
        location: {
          type: 'string',
          validation: { required: true },
        },
        checkin_date: {
          type: 'date',
          validation: { required: true },
        },
        checkout_date: {
          type: 'date',
          validation: { required: false },
        },
        guests: {
          type: 'number',
          validation: { required: false, min: 1, max: 10 },
        },
      },
    };

    const missingFields = schemaEngine.getMissingFields(schemaDefinition, fields);
    const isComplete = schemaEngine.isComplete(schemaDefinition, fields);
    const validationResult = schemaEngine.validateFields(schemaDefinition, fields);

    res.json({
      success: true,
      schema: schema || 'search_hotels',
      fields,
      validation: {
        isComplete,
        missingFields,
        isValid: validationResult.valid,
        errors: validationResult.errors,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// List Tools
// ============================================================================

router.get('/tools', async (req: Request, res: Response) => {
  try {
    const tools = await toolRegistry.listTools();

    res.json({
      success: true,
      tools: tools.map((tool) => ({
        name: tool.name,
        version: tool.version,
        description: tool.description,
        requiredParams: tool.parameters.required.map((p) => p.name),
        optionalParams: tool.parameters.optional.map((p) => p.name),
        provider: tool.providerMapping.providerName,
      })),
      count: tools.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Documentation
// ============================================================================

router.get('/docs', (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>YANA/OGO API Documentation</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        h1, h2, h3 { color: #333; }
        code {
          background: #f4f4f4;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
        }
        pre {
          background: #2d2d2d;
          color: #f8f8f2;
          padding: 15px;
          border-radius: 4px;
          overflow-x: auto;
        }
        .endpoint {
          background: #f8f9fa;
          padding: 15px;
          margin: 15px 0;
          border-left: 4px solid #007bff;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <h1>YANA/OGO Platform - API Documentation</h1>
      
      <h2>Available Endpoints</h2>
      
      <div class="endpoint">
        <h3>GET /demo/status</h3>
        <p>Get system status and available components</p>
        <pre>curl http://localhost:3000/demo/status</pre>
      </div>

      <div class="endpoint">
        <h3>POST /demo/tool-call</h3>
        <p>Execute a tool call through MCPInterface</p>
        <pre>curl -X POST http://localhost:3000/demo/tool-call \\
  -H "Content-Type: application/json" \\
  -d '{
    "tool": "search_hotels",
    "params": {
      "location": "Galle",
      "checkin_date": "2026-05-01",
      "guests": 2
    }
  }'</pre>
      </div>

      <div class="endpoint">
        <h3>POST /demo/session</h3>
        <p>Create a new session</p>
        <pre>curl -X POST http://localhost:3000/demo/session \\
  -H "Content-Type: application/json" \\
  -d '{
    "phoneNumber": "+94771234567",
    "name": "John Doe"
  }'</pre>
      </div>

      <div class="endpoint">
        <h3>POST /demo/schema-validation</h3>
        <p>Validate fields against a schema</p>
        <pre>curl -X POST http://localhost:3000/demo/schema-validation \\
  -H "Content-Type: application/json" \\
  -d '{
    "schema": "search_hotels",
    "fields": {
      "location": "Galle",
      "checkin_date": "2026-05-01"
    }
  }'</pre>
      </div>

      <div class="endpoint">
        <h3>GET /demo/tools</h3>
        <p>List all registered tools</p>
        <pre>curl http://localhost:3000/demo/tools</pre>
      </div>

      <p><a href="/demo">← Back to Demo Home</a></p>
    </body>
    </html>
  `);
});

export default router;
