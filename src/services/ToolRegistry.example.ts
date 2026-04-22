/**
 * Example usage of ToolRegistry
 * 
 * This file demonstrates how to register, retrieve, and manage tools
 * using the ToolRegistry service.
 */

import { ToolRegistry, type ToolDefinition } from './ToolRegistry.js';

// ============================================================================
// Example 1: Register a hotel search tool
// ============================================================================

async function registerHotelSearchTool() {
  const toolRegistry = new ToolRegistry();

  const hotelSearchTool: ToolDefinition = {
    name: 'search_hotels',
    version: '1.0',
    description: 'Search for hotels by location and date',
    parameters: {
      required: [
        {
          name: 'location',
          type: 'string',
          description: 'Hotel location (city, region, or coordinates)',
        },
        {
          name: 'checkin_date',
          type: 'date',
          description: 'Check-in date in ISO 8601 format',
        },
      ],
      optional: [
        {
          name: 'checkout_date',
          type: 'date',
          description: 'Check-out date in ISO 8601 format',
        },
        {
          name: 'guests',
          type: 'number',
          description: 'Number of guests',
          validation: {
            min: 1,
            max: 10,
          },
          defaultValue: 1,
        },
        {
          name: 'budget',
          type: 'number',
          description: 'Maximum budget per night',
        },
        {
          name: 'currency',
          type: 'string',
          description: 'Currency code (ISO 4217)',
          validation: {
            pattern: '^[A-Z]{3}$',
          },
          defaultValue: 'USD',
        },
      ],
    },
    providerMapping: {
      providerName: 'booking_com',
      adapterClass: 'HotelSearchAdapter',
      endpoint: '/hotels/search',
      method: 'POST',
      requestMapping: {
        location: 'destination',
        checkin_date: 'check_in',
        checkout_date: 'check_out',
        guests: 'adults',
      },
      responseMapping: {
        'results[].name': 'hotelName',
        'results[].price': 'pricePerNight',
        'results[].rating': 'starRating',
      },
    },
    executionPolicy: {
      retryCount: 3,
      retryDelayMs: 1000,
      retryBackoffMultiplier: 2,
      idempotent: true,
      timeoutMs: 30000,
    },
    permissions: {
      requiredRoles: ['user', 'admin'],
      rateLimit: {
        maxCallsPerMinute: 10,
        maxCallsPerHour: 100,
      },
    },
    schemaBindings: {
      triggerSchemas: ['search_hotels', 'hotel_booking'],
      requiredSchemaFields: ['location', 'checkin_date'],
      outputSchemaMapping: {
        hotelName: 'hotel_name',
        pricePerNight: 'price',
      },
    },
  };

  const result = await toolRegistry.registerTool(hotelSearchTool);

  if (result.success) {
    console.log(`✓ Tool '${result.toolName}' registered successfully`);
  } else {
    console.error(`✗ Failed to register tool: ${result.message}`);
    console.error('Errors:', result.errors);
  }
}

// ============================================================================
// Example 2: Register a payment processing tool
// ============================================================================

async function registerPaymentTool() {
  const toolRegistry = new ToolRegistry();

  const paymentTool: ToolDefinition = {
    name: 'process_payment',
    version: '1.0',
    description: 'Process a payment for a booking',
    parameters: {
      required: [
        {
          name: 'booking_id',
          type: 'string',
          description: 'Unique booking identifier',
        },
        {
          name: 'amount',
          type: 'number',
          description: 'Payment amount',
          validation: {
            min: 0.01,
          },
        },
        {
          name: 'currency',
          type: 'string',
          description: 'Currency code (ISO 4217)',
          validation: {
            pattern: '^[A-Z]{3}$',
          },
        },
        {
          name: 'payment_method',
          type: 'string',
          description: 'Payment method',
          validation: {
            enum: ['telco_billing', 'payment_link', 'card'],
          },
        },
      ],
      optional: [
        {
          name: 'customer_phone',
          type: 'string',
          description: 'Customer phone number for telco billing',
        },
        {
          name: 'return_url',
          type: 'string',
          description: 'Return URL after payment completion',
        },
      ],
    },
    providerMapping: {
      providerName: 'stripe',
      adapterClass: 'PaymentAdapter',
      endpoint: '/payments/create',
      method: 'POST',
    },
    executionPolicy: {
      retryCount: 2,
      retryDelayMs: 2000,
      idempotent: true,
      timeoutMs: 60000,
    },
    permissions: {
      requiredRoles: ['user', 'admin'],
      rateLimit: {
        maxCallsPerMinute: 5,
        maxCallsPerHour: 50,
      },
    },
    schemaBindings: {
      triggerSchemas: ['payment_processing'],
      requiredSchemaFields: ['booking_id', 'amount', 'currency'],
    },
  };

  const result = await toolRegistry.registerTool(paymentTool);

  if (result.success) {
    console.log(`✓ Tool '${result.toolName}' registered successfully`);
  } else {
    console.error(`✗ Failed to register tool: ${result.message}`);
  }
}

// ============================================================================
// Example 3: Retrieve and use a tool
// ============================================================================

async function retrieveAndUseTool() {
  const toolRegistry = new ToolRegistry();

  // Retrieve a tool by name
  const tool = await toolRegistry.getTool('search_hotels');

  if (tool) {
    console.log(`Found tool: ${tool.name} v${tool.version}`);
    console.log(`Description: ${tool.description}`);
    console.log(`Provider: ${tool.providerMapping.providerName}`);
    console.log(`Required parameters:`, tool.parameters.required.map((p) => p.name));
    console.log(`Optional parameters:`, tool.parameters.optional.map((p) => p.name));
    console.log(`Retry policy: ${tool.executionPolicy.retryCount} retries`);
    console.log(`Idempotent: ${tool.executionPolicy.idempotent}`);
  } else {
    console.log('Tool not found');
  }
}

// ============================================================================
// Example 4: List all available tools
// ============================================================================

async function listAllTools() {
  const toolRegistry = new ToolRegistry();

  const tools = await toolRegistry.listTools();

  console.log(`Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name} v${tool.version}: ${tool.description}`);
  }
}

// ============================================================================
// Example 5: Get tools for a specific schema
// ============================================================================

async function getToolsForSchema() {
  const toolRegistry = new ToolRegistry();

  const schemaName = 'search_hotels';
  const tools = await toolRegistry.getToolsForSchema(schemaName);

  console.log(`Found ${tools.length} tools for schema '${schemaName}':`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`);
  }
}

// ============================================================================
// Example 6: Enable/disable a tool
// ============================================================================

async function manageToolAvailability() {
  const toolRegistry = new ToolRegistry();

  const toolName = 'search_hotels';

  // Check if tool is available
  const isAvailable = await toolRegistry.isToolAvailable(toolName);
  console.log(`Tool '${toolName}' is ${isAvailable ? 'available' : 'not available'}`);

  // Disable the tool
  await toolRegistry.setToolEnabled(toolName, false);
  console.log(`Tool '${toolName}' has been disabled`);

  // Check again
  const isStillAvailable = await toolRegistry.isToolAvailable(toolName);
  console.log(`Tool '${toolName}' is ${isStillAvailable ? 'available' : 'not available'}`);

  // Re-enable the tool
  await toolRegistry.setToolEnabled(toolName, true);
  console.log(`Tool '${toolName}' has been re-enabled`);
}

// ============================================================================
// Example 7: Get execution policy for a tool
// ============================================================================

async function getToolExecutionPolicy() {
  const toolRegistry = new ToolRegistry();

  const toolName = 'search_hotels';
  const policy = await toolRegistry.getExecutionPolicy(toolName);

  if (policy) {
    console.log(`Execution policy for '${toolName}':`);
    console.log(`  - Retry count: ${policy.retryCount}`);
    console.log(`  - Retry delay: ${policy.retryDelayMs}ms`);
    console.log(`  - Backoff multiplier: ${policy.retryBackoffMultiplier || 1}`);
    console.log(`  - Idempotent: ${policy.idempotent}`);
    console.log(`  - Timeout: ${policy.timeoutMs || 'none'}ms`);
  } else {
    console.log(`Tool '${toolName}' not found`);
  }
}

// ============================================================================
// Run examples
// ============================================================================

async function runExamples() {
  console.log('=== Example 1: Register hotel search tool ===');
  await registerHotelSearchTool();
  console.log();

  console.log('=== Example 2: Register payment tool ===');
  await registerPaymentTool();
  console.log();

  console.log('=== Example 3: Retrieve and use a tool ===');
  await retrieveAndUseTool();
  console.log();

  console.log('=== Example 4: List all tools ===');
  await listAllTools();
  console.log();

  console.log('=== Example 5: Get tools for schema ===');
  await getToolsForSchema();
  console.log();

  console.log('=== Example 6: Manage tool availability ===');
  await manageToolAvailability();
  console.log();

  console.log('=== Example 7: Get execution policy ===');
  await getToolExecutionPolicy();
}

// Uncomment to run examples:
// runExamples().catch(console.error);
