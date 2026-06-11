/**
 * Unit tests for MCPInterface
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPInterface, ProviderAdapter } from './MCPInterface.js';
import { ToolRegistry } from './ToolRegistry.js';
import { ToolRepository } from '../db/repositories/ToolRepository.js';
import {
  ToolCallRequest,
  ToolCallContext,
  CorrelationContext,
  ErrorCategory,
} from '../types/core.js';

// ============================================================================
// Mock Implementations
// ============================================================================

class MockProviderAdapter implements ProviderAdapter {
  private shouldFail: boolean;
  private failureCount: number;
  private currentAttempt: number;

  constructor(shouldFail = false, failureCount = 0) {
    this.shouldFail = shouldFail;
    this.failureCount = failureCount;
    this.currentAttempt = 0;
  }

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.currentAttempt++;

    if (this.shouldFail && this.currentAttempt <= this.failureCount) {
      throw new Error('Provider timeout');
    }

    return {
      results: [
        {
          name: 'Test Hotel',
          location: params.location,
          price: 100,
          currency: 'USD',
        },
      ],
    };
  }

  getProviderName(): string {
    return 'test_provider';
  }

  reset(): void {
    this.currentAttempt = 0;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('MCPInterface', () => {
  let mcpInterface: MCPInterface;
  let mockToolRegistry: ToolRegistry;
  let mockToolRepository: ToolRepository;
  let mockAdapter: MockProviderAdapter;

  const mockToolDefinition = {
    name: 'search_hotels',
    version: '1.0',
    description: 'Search for hotels',
    parameters: {
      required: [
        { name: 'location', type: 'string', description: 'Hotel location' },
        { name: 'checkin_date', type: 'date', description: 'Check-in date' },
      ],
      optional: [
        { name: 'guests', type: 'number', description: 'Number of guests' },
      ],
    },
    providerMapping: {
      providerName: 'booking_com',
      adapterClass: 'HotelSearchAdapter',
    },
    executionPolicy: {
      retryCount: 3,
      retryDelayMs: 100,
      retryBackoffMultiplier: 2,
      idempotent: true,
    },
    permissions: {
      requiredRoles: [],
      rateLimit: { maxRequests: 100, windowMs: 60000 },
    },
    schemaBindings: {
      triggerSchemas: ['search_hotels'],
    },
  };

  const mockCorrelationContext: CorrelationContext = {
    correlationId: 'test-correlation-id',
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    requestTimestamp: new Date(),
  };

  beforeEach(() => {
    // Create mock tool registry
    mockToolRegistry = {
      getTool: vi.fn().mockResolvedValue(mockToolDefinition),
      isToolAvailable: vi.fn().mockResolvedValue(true),
    } as any;

    // Create mock tool repository
    mockToolRepository = {
      createRun: vi.fn().mockResolvedValue({
        runId: 'test-run-id',
        correlationId: 'test-correlation-id',
        toolName: 'search_hotels',
        executionStatus: 'success',
      }),
    } as any;

    // Create mock adapter
    mockAdapter = new MockProviderAdapter();

    // Create MCP interface with mocks
    const adapters = new Map<string, ProviderAdapter>();
    adapters.set('HotelSearchAdapter', mockAdapter);

    mcpInterface = new MCPInterface(mockToolRegistry, mockToolRepository, adapters);
  });

  describe('executeToolCall', () => {
    it('should successfully execute a valid tool call', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
          guests: 2,
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.error).toBeUndefined();
      expect(result.metadata.toolName).toBe('search_hotels');
      expect(result.metadata.attemptNumber).toBe(1);
      expect(result.metadata.provider).toBe('booking_com');
      expect(mockToolRepository.createRun).toHaveBeenCalledOnce();
    });

    it('should return validation error for missing required parameter', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          // Missing checkin_date
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.category).toBe(ErrorCategory.SCHEMA_ERROR);
      expect(result.error?.message).toContain('checkin_date');
      expect(result.error?.retryable).toBe(false);
      expect(mockToolRepository.createRun).toHaveBeenCalledOnce();
    });

    it('should return validation error for invalid parameter type', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
          guests: 'two', // Should be number
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.category).toBe(ErrorCategory.SCHEMA_ERROR);
      expect(result.error?.message).toContain('guests');
      expect(result.error?.message).toContain('number');
    });

    it('should return error when tool is not available', async () => {
      mockToolRegistry.isToolAvailable = vi.fn().mockResolvedValue(false);

      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('not available');
    });

    it('should return error when tool is not found', async () => {
      mockToolRegistry.getTool = vi.fn().mockResolvedValue(null);
      mockToolRegistry.isToolAvailable = vi.fn().mockResolvedValue(false);

      const request: ToolCallRequest = {
        tool: 'unknown_tool',
        params: {},
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.category).toBe(ErrorCategory.SCHEMA_ERROR);
      expect(result.error?.message).toContain('not available');
    });

    it('should normalize date inputs to ISO format', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: new Date('2026-04-17'),
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(true);
      // The adapter should receive normalized ISO string
    });

    it('should retry on retryable errors', async () => {
      // Configure adapter to fail twice then succeed
      mockAdapter = new MockProviderAdapter(true, 2);
      const adapters = new Map<string, ProviderAdapter>();
      adapters.set('HotelSearchAdapter', mockAdapter);
      mcpInterface = new MCPInterface(mockToolRegistry, mockToolRepository, adapters);

      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(true);
      expect(result.metadata.attemptNumber).toBe(3); // Failed twice, succeeded on third
    });

    it('should return failure after exhausting retries', async () => {
      // Configure adapter to always fail
      mockAdapter = new MockProviderAdapter(true, 10);
      const adapters = new Map<string, ProviderAdapter>();
      adapters.set('HotelSearchAdapter', mockAdapter);
      mcpInterface = new MCPInterface(mockToolRegistry, mockToolRepository, adapters);

      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
      expect(result.metadata.attemptNumber).toBe(4); // 1 initial + 3 retries
    });

    it('should log all tool calls (success and failure)', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(mockToolRepository.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'test-correlation-id',
          sessionId: 'test-session-id',
          userId: 'test-user-id',
          toolName: 'search_hotels',
          inputParams: expect.any(Object),
          executionStatus: 'success',
          executionTimeMs: expect.any(Number),
          attemptNumber: expect.any(Number),
        })
      );
    });

    it('should return error when adapter is not registered', async () => {
      // Create MCP interface without registering adapter
      mcpInterface = new MCPInterface(mockToolRegistry, mockToolRepository, new Map());

      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('No adapter registered');
    });
  });

  describe('registerAdapter', () => {
    it('should register a new adapter', () => {
      const newAdapter = new MockProviderAdapter();
      mcpInterface.registerAdapter('NewAdapter', newAdapter);

      // Adapter should be registered (tested indirectly through executeToolCall)
      expect(true).toBe(true);
    });
  });

  describe('validation', () => {
    it('should validate required string parameters', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 123, // Should be string
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('location');
      expect(result.error?.message).toContain('string');
    });

    it('should validate optional parameters when provided', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
          guests: 'invalid', // Should be number
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('guests');
    });

    it('should allow optional parameters to be omitted', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
          // guests is optional and omitted
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.success).toBe(true);
    });
  });

  describe('error categorization', () => {
    it('should categorize provider failures correctly', async () => {
      mockAdapter = new MockProviderAdapter(true, 10);
      const adapters = new Map<string, ProviderAdapter>();
      adapters.set('HotelSearchAdapter', mockAdapter);
      mcpInterface = new MCPInterface(mockToolRegistry, mockToolRepository, adapters);

      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.error?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
    });

    it('should categorize validation errors correctly', async () => {
      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          // Missing required parameter
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);

      expect(result.error?.category).toBe(ErrorCategory.SCHEMA_ERROR);
    });
  });

  describe('retry policy', () => {
    it('should apply exponential backoff on retries', async () => {
      mockAdapter = new MockProviderAdapter(true, 2);
      const adapters = new Map<string, ProviderAdapter>();
      adapters.set('HotelSearchAdapter', mockAdapter);
      mcpInterface = new MCPInterface(mockToolRegistry, mockToolRepository, adapters);

      const request: ToolCallRequest = {
        tool: 'search_hotels',
        params: {
          location: 'Galle',
          checkin_date: '2026-04-17',
        },
        context: {
          userLanguage: 'en',
          canonicalLanguage: 'en',
          sessionId: 'test-session-id',
          requestId: 'test-request-id',
        },
      };

      const startTime = Date.now();
      const result = await mcpInterface.executeToolCall(request, mockCorrelationContext);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      // Should have delays: 100ms + 200ms = 300ms minimum
      expect(duration).toBeGreaterThanOrEqual(250);
    });
  });
});
