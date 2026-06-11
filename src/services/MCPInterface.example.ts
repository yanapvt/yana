/**
 * Example usage of MCPInterface
 * Demonstrates tool registration, adapter implementation, and tool execution
 */

import { MCPInterface, ProviderAdapter } from './MCPInterface.js';
import { ToolRegistry } from './ToolRegistry.js';
import {
  ToolCallRequest,
  CorrelationContext,
  ErrorCategory,
} from '../types/core.js';

// ============================================================================
// Example 1: Implement a Provider Adapter
// ============================================================================

class HotelSearchAdapter implements ProviderAdapter {
  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    console.log(`Executing hotel search with correlation ID: ${context.correlationId}`);
    console.log('Parameters:', params);

    // Simulate API call to hotel provider
    const response = await fetch('https://api.booking.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': context.correlationId,
      },
      body: JSON.stringify({
        location: params.location,
        checkin: params.checkin_date,
        checkout: params.checkout_date,
        guests: params.guests || 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Hotel search failed: ${response.statusText}`);
    }

    const data = await response.json();

    // Return normalized results
    return {
      results: data.hotels.map((hotel: any) => ({
        name: hotel.name,
        location: hotel.address,
        price: hotel.price,
        currency: hotel.currency,
        rating: hotel.rating,
        reviewCount: hotel.reviews,
        amenities: hotel.amenities,
        cancellationPolicy: hotel.cancellation,
        bookingToken: hotel.token,
      })),
    };
  }

  getProviderName(): string {
    return 'booking_com';
  }
}

// ============================================================================
// Example 2: Register Tool and Adapter
// ============================================================================

async function setupHotelSearch() {
  const toolRegistry = new ToolRegistry();
  const mcpInterface = new MCPInterface(toolRegistry);

  // Register the tool definition
  await toolRegistry.registerTool({
    name: 'search_hotels',
    version: '1.0',
    description: 'Search for hotels by location and date',
    parameters: {
      required: [
        {
          name: 'location',
          type: 'string',
          description: 'Hotel location (city or region)',
        },
        {
          name: 'checkin_date',
          type: 'date',
          description: 'Check-in date (ISO format)',
        },
      ],
      optional: [
        {
          name: 'checkout_date',
          type: 'date',
          description: 'Check-out date (ISO format)',
        },
        {
          name: 'guests',
          type: 'number',
          description: 'Number of guests',
        },
        {
          name: 'budget',
          type: 'number',
          description: 'Maximum budget per night',
        },
        {
          name: 'currency',
          type: 'string',
          description: 'Preferred currency code',
        },
      ],
    },
    providerMapping: {
      providerName: 'booking_com',
      adapterClass: 'HotelSearchAdapter',
    },
    executionPolicy: {
      retryCount: 3,
      retryDelayMs: 1000,
      retryBackoffMultiplier: 2,
      idempotent: true,
      timeoutMs: 30000,
    },
    permissions: {
      requiredRoles: [],
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000,
      },
    },
    schemaBindings: {
      triggerSchemas: ['search_hotels'],
    },
  });

  // Register the provider adapter
  const adapter = new HotelSearchAdapter();
  mcpInterface.registerAdapter('HotelSearchAdapter', adapter);

  return mcpInterface;
}

// ============================================================================
// Example 3: Execute a Tool Call
// ============================================================================

async function executeHotelSearch() {
  const mcpInterface = await setupHotelSearch();

  // Create tool call request
  const request: ToolCallRequest = {
    tool: 'search_hotels',
    params: {
      location: 'Galle, Sri Lanka',
      checkin_date: '2026-04-17',
      checkout_date: '2026-04-18',
      guests: 2,
      currency: 'GBP',
    },
    context: {
      userLanguage: 'en',
      canonicalLanguage: 'en',
      sessionId: 'sess_abc123',
      requestId: 'req_xyz789',
    },
  };

  // Create correlation context
  const correlationCtx: CorrelationContext = {
    correlationId: 'corr_hotel_search_001',
    sessionId: 'sess_abc123',
    userId: 'user_john_doe',
    requestTimestamp: new Date(),
  };

  // Execute the tool call
  console.log('Executing hotel search...');
  const result = await mcpInterface.executeToolCall(request, correlationCtx);

  if (result.success) {
    console.log('✓ Hotel search succeeded');
    console.log('Results:', result.data);
    console.log('Execution time:', result.metadata.executionTimeMs, 'ms');
    console.log('Attempts:', result.metadata.attemptNumber);
  } else {
    console.error('✗ Hotel search failed');
    console.error('Error category:', result.error?.category);
    console.error('Error message:', result.error?.message);
    console.error('Retryable:', result.error?.retryable);
    console.error('Attempts:', result.metadata.attemptNumber);
  }

  return result;
}

// ============================================================================
// Example 4: Handle Validation Errors
// ============================================================================

async function handleValidationError() {
  const mcpInterface = await setupHotelSearch();

  // Missing required parameter
  const request: ToolCallRequest = {
    tool: 'search_hotels',
    params: {
      location: 'Galle',
      // Missing checkin_date
    },
    context: {
      userLanguage: 'en',
      canonicalLanguage: 'en',
      sessionId: 'sess_abc123',
      requestId: 'req_xyz789',
    },
  };

  const correlationCtx: CorrelationContext = {
    correlationId: 'corr_validation_error',
    sessionId: 'sess_abc123',
    requestTimestamp: new Date(),
  };

  const result = await mcpInterface.executeToolCall(request, correlationCtx);

  if (!result.success && result.error?.category === ErrorCategory.SCHEMA_ERROR) {
    console.log('Validation error detected');
    console.log('Missing fields:', result.error.message);
    
    // Inform user about missing parameters
    return {
      action: 'ask_missing_fields',
      missingFields: ['checkin_date'],
    };
  }
}

// ============================================================================
// Example 5: Handle Provider Failures with Retry
// ============================================================================

class UnreliableAdapter implements ProviderAdapter {
  private attemptCount = 0;

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.attemptCount++;
    console.log(`Attempt ${this.attemptCount}`);

    // Fail first 2 attempts, succeed on 3rd
    if (this.attemptCount < 3) {
      throw new Error('Provider timeout - please retry');
    }

    return { success: true, data: 'Operation completed' };
  }

  getProviderName(): string {
    return 'unreliable_provider';
  }
}

async function handleProviderRetry() {
  const toolRegistry = new ToolRegistry();
  const mcpInterface = new MCPInterface(toolRegistry);

  // Register tool with retry policy
  await toolRegistry.registerTool({
    name: 'test_tool',
    version: '1.0',
    description: 'Test tool with retries',
    parameters: {
      required: [],
      optional: [],
    },
    providerMapping: {
      providerName: 'unreliable',
      adapterClass: 'UnreliableAdapter',
    },
    executionPolicy: {
      retryCount: 3,
      retryDelayMs: 500,
      retryBackoffMultiplier: 2,
      idempotent: true,
    },
    permissions: {
      requiredRoles: [],
    },
    schemaBindings: {
      triggerSchemas: [],
    },
  });

  // Register unreliable adapter
  mcpInterface.registerAdapter('UnreliableAdapter', new UnreliableAdapter());

  const request: ToolCallRequest = {
    tool: 'test_tool',
    params: {},
    context: {
      userLanguage: 'en',
      canonicalLanguage: 'en',
      sessionId: 'sess_retry_test',
      requestId: 'req_retry_test',
    },
  };

  const correlationCtx: CorrelationContext = {
    correlationId: 'corr_retry_test',
    sessionId: 'sess_retry_test',
    requestTimestamp: new Date(),
  };

  console.log('Testing retry logic...');
  const result = await mcpInterface.executeToolCall(request, correlationCtx);

  if (result.success) {
    console.log('✓ Succeeded after retries');
    console.log('Total attempts:', result.metadata.attemptNumber);
  } else {
    console.error('✗ Failed after all retries');
    console.error('Total attempts:', result.metadata.attemptNumber);
  }
}

// ============================================================================
// Example 6: Multiple Tools with Different Adapters
// ============================================================================

class FlightSearchAdapter implements ProviderAdapter {
  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    console.log('Searching flights...');
    return {
      flights: [
        {
          airline: 'Example Airways',
          departure: params.departure,
          arrival: params.arrival,
          price: 250,
          currency: 'USD',
        },
      ],
    };
  }

  getProviderName(): string {
    return 'amadeus';
  }
}

async function setupMultipleTools() {
  const toolRegistry = new ToolRegistry();
  const mcpInterface = new MCPInterface(toolRegistry);

  // Register hotel search
  await toolRegistry.registerTool({
    name: 'search_hotels',
    version: '1.0',
    description: 'Search for hotels',
    parameters: {
      required: [
        { name: 'location', type: 'string' },
        { name: 'checkin_date', type: 'date' },
      ],
      optional: [],
    },
    providerMapping: {
      providerName: 'booking_com',
      adapterClass: 'HotelSearchAdapter',
    },
    executionPolicy: {
      retryCount: 3,
      retryDelayMs: 1000,
      idempotent: true,
    },
    permissions: { requiredRoles: [] },
    schemaBindings: { triggerSchemas: ['search_hotels'] },
  });

  // Register flight search
  await toolRegistry.registerTool({
    name: 'search_flights',
    version: '1.0',
    description: 'Search for flights',
    parameters: {
      required: [
        { name: 'departure', type: 'string' },
        { name: 'arrival', type: 'string' },
        { name: 'date', type: 'date' },
      ],
      optional: [],
    },
    providerMapping: {
      providerName: 'amadeus',
      adapterClass: 'FlightSearchAdapter',
    },
    executionPolicy: {
      retryCount: 2,
      retryDelayMs: 2000,
      idempotent: true,
    },
    permissions: { requiredRoles: [] },
    schemaBindings: { triggerSchemas: ['search_flights'] },
  });

  // Register adapters
  mcpInterface.registerAdapter('HotelSearchAdapter', new HotelSearchAdapter());
  mcpInterface.registerAdapter('FlightSearchAdapter', new FlightSearchAdapter());

  console.log('Registered 2 tools with different adapters');
  return mcpInterface;
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExamples() {
  console.log('=== MCPInterface Examples ===\n');

  try {
    console.log('Example 1: Execute hotel search');
    await executeHotelSearch();
    console.log();

    console.log('Example 2: Handle validation error');
    await handleValidationError();
    console.log();

    console.log('Example 3: Handle provider retry');
    await handleProviderRetry();
    console.log();

    console.log('Example 4: Setup multiple tools');
    await setupMultipleTools();
    console.log();
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Uncomment to run examples
// runExamples();

export {
  HotelSearchAdapter,
  FlightSearchAdapter,
  UnreliableAdapter,
  setupHotelSearch,
  executeHotelSearch,
  handleValidationError,
  handleProviderRetry,
  setupMultipleTools,
};
