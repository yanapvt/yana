/**
 * Property Test 12: Tool Call Retry Policy
 * 
 * Property Statement:
 * For any failed tool call where the tool's execution policy specifies a retry count 
 * greater than zero, the MCP_Interface SHALL retry the call up to the configured 
 * number of times before returning a final failure state.
 * 
 * **Validates: Requirements 5.5, 21.3**
 * 
 * Requirements:
 * - 5.5: THE System SHALL apply retry policies to failed tool calls as defined in 
 *        the tool's registered execution policy
 * - 21.3: THE System SHALL implement retry policies for failed provider calls as 
 *         defined in the provider adapter configuration
 */

import fc from 'fast-check';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPInterface, ProviderAdapter } from '../../services/MCPInterface.js';
import { ToolRegistry } from '../../services/ToolRegistry.js';
import { ToolRepository } from '../../db/repositories/ToolRepository.js';
import {
  ToolCallRequest,
  CorrelationContext,
  ErrorCategory,
} from '../../types/core.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock provider adapter that fails a specified number of times before succeeding
 */
class MockRetryableAdapter implements ProviderAdapter {
  public executionCount = 0;
  private failuresBeforeSuccess: number;
  private errorType: 'retryable' | 'non-retryable';

  constructor(failuresBeforeSuccess: number, errorType: 'retryable' | 'non-retryable' = 'retryable') {
    this.failuresBeforeSuccess = failuresBeforeSuccess;
    this.errorType = errorType;
  }

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.executionCount++;

    if (this.executionCount <= this.failuresBeforeSuccess) {
      // Throw appropriate error type
      if (this.errorType === 'retryable') {
        throw new Error('Network timeout - retryable error');
      } else {
        throw new Error('Invalid parameter - non-retryable error');
      }
    }

    return { success: true, data: params };
  }

  getProviderName(): string {
    return 'mock_retryable_provider';
  }

  reset(): void {
    this.executionCount = 0;
  }
}

/**
 * Mock provider adapter that always fails
 */
class MockAlwaysFailAdapter implements ProviderAdapter {
  public executionCount = 0;
  private errorType: 'retryable' | 'non-retryable';

  constructor(errorType: 'retryable' | 'non-retryable' = 'retryable') {
    this.errorType = errorType;
  }

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.executionCount++;

    if (this.errorType === 'retryable') {
      throw new Error('Network timeout - retryable error');
    } else {
      throw new Error('Invalid parameter - non-retryable error');
    }
  }

  getProviderName(): string {
    return 'mock_always_fail_provider';
  }

  reset(): void {
    this.executionCount = 0;
  }
}

/**
 * Creates a mock tool definition with configurable retry policy
 */
function createMockToolDefinition(
  toolName: string,
  retryCount: number,
  retryDelayMs: number = 0,
  adapterClass: string = 'MockRetryableAdapter'
) {
  return {
    name: toolName,
    version: '1.0',
    description: `Test tool: ${toolName}`,
    parameters: {
      required: [
        { name: 'param1', type: 'string', description: 'Parameter 1' },
      ],
      optional: [],
    },
    providerMapping: {
      providerName: 'test_provider',
      adapterClass,
    },
    executionPolicy: {
      retryCount,
      retryDelayMs,
      idempotent: true,
    },
    permissions: {
      requiredRoles: [],
      rateLimit: { maxRequests: 100, windowMs: 60000 },
    },
    schemaBindings: {
      triggerSchemas: [toolName],
    },
  };
}

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary retry counts (0-5)
 */
const retryCountArb = fc.integer({ min: 0, max: 5 });

/**
 * Generates arbitrary failure counts
 */
const failureCountArb = fc.integer({ min: 1, max: 10 });

/**
 * Generates arbitrary correlation context
 */
const correlationContextArb = fc.record({
  correlationId: fc.uuid(),
  sessionId: fc.uuid(),
  userId: fc.uuid(),
  requestTimestamp: fc.date(),
});

/**
 * Generates arbitrary tool call request
 */
const toolCallRequestArb = fc.record({
  tool: fc.constant('test_tool'),
  params: fc.record({
    param1: fc.string(),
  }),
  context: fc.record({
    userLanguage: fc.constant('en'),
    canonicalLanguage: fc.constant('en'),
    sessionId: fc.uuid(),
    requestId: fc.uuid(),
  }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 12: Tool Call Retry Policy', () => {
  let mockToolRepository: ToolRepository;

  beforeEach(() => {
    mockToolRepository = {
      createRun: vi.fn().mockResolvedValue({ runId: 'test-run-id' }),
    } as any;
  });

  it('should retry failed calls up to the configured retry count', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n > 0),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, request, correlationCtx) => {
          // Given: A tool with a specific retry count and an adapter that always fails
          const mockAdapter = new MockAlwaysFailAdapter('retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should fail after all retries
          expect(result.success).toBe(false);

          // And: The adapter should be called exactly (retryCount + 1) times
          // (initial attempt + retries)
          const expectedAttempts = retryCount + 1;
          expect(mockAdapter.executionCount).toBe(expectedAttempts);

          // And: The metadata should reflect the final attempt number
          expect(result.metadata.attemptNumber).toBe(expectedAttempts);

          // And: A structured error should be returned
          expect(result.error).toBeDefined();
          expect(result.error?.retryable).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should return final failure state after exhausting all retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n > 0),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, request, correlationCtx) => {
          // Given: A tool with retries and an adapter that always fails
          const mockAdapter = new MockAlwaysFailAdapter('retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed and all retries are exhausted
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The result should be a final failure state
          expect(result.success).toBe(false);

          // And: The error should be defined with complete information
          expect(result.error).toBeDefined();
          expect(result.error?.category).toBeDefined();
          expect(result.error?.message).toBeDefined();
          expect(typeof result.error?.retryable).toBe('boolean');

          // And: Metadata should indicate all attempts were made
          expect(result.metadata.attemptNumber).toBe(retryCount + 1);
          expect(result.metadata.toolName).toBe('test_tool');
          expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);
          expect(result.metadata.timestamp).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should stop retrying once a call succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n >= 2),
        fc.integer({ min: 1, max: 3 }),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, failuresBeforeSuccess, request, correlationCtx) => {
          // Ensure failures before success is less than total allowed attempts
          const actualFailures = Math.min(failuresBeforeSuccess, retryCount);

          // Given: A tool with retries and an adapter that succeeds after N failures
          const mockAdapter = new MockRetryableAdapter(actualFailures, 'retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should succeed
          expect(result.success).toBe(true);

          // And: The adapter should be called exactly (actualFailures + 1) times
          // (failures + 1 success)
          expect(mockAdapter.executionCount).toBe(actualFailures + 1);

          // And: Should not retry after success
          expect(mockAdapter.executionCount).toBeLessThanOrEqual(retryCount + 1);

          // And: The metadata should reflect the attempt number where it succeeded
          expect(result.metadata.attemptNumber).toBe(actualFailures + 1);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should not retry non-retryable errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n > 0),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, request, correlationCtx) => {
          // Given: A tool with retries and an adapter that fails with non-retryable error
          const mockAdapter = new MockAlwaysFailAdapter('non-retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should fail
          expect(result.success).toBe(false);

          // And: The adapter should be called only once (no retries for non-retryable errors)
          expect(mockAdapter.executionCount).toBe(1);

          // And: The metadata should reflect only one attempt
          expect(result.metadata.attemptNumber).toBe(1);

          // And: The error should be marked as non-retryable
          expect(result.error).toBeDefined();
          expect(result.error?.retryable).toBe(false);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should not retry when retry count is zero', async () => {
    await fc.assert(
      fc.asyncProperty(
        toolCallRequestArb,
        correlationContextArb,
        async (request, correlationCtx) => {
          // Given: A tool with zero retry count
          const mockAdapter = new MockAlwaysFailAdapter('retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', 0, 10, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should fail
          expect(result.success).toBe(false);

          // And: The adapter should be called exactly once (no retries)
          expect(mockAdapter.executionCount).toBe(1);

          // And: The metadata should reflect only one attempt
          expect(result.metadata.attemptNumber).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should log all retry attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n > 0 && n <= 3),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, request, correlationCtx) => {
          // Given: A tool with retries and an adapter that always fails
          const mockAdapter = new MockAlwaysFailAdapter('retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const createRunSpy = vi.fn().mockResolvedValue({ runId: 'test-run-id' });
          const mockRepo = { createRun: createRunSpy } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(mockToolRegistry, mockRepo, adapters);

          // When: The tool call is executed with retries
          await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The final attempt should be logged
          expect(createRunSpy).toHaveBeenCalled();

          // And: The log should contain the final attempt number
          const lastCall = createRunSpy.mock.calls[createRunSpy.mock.calls.length - 1][0];
          expect(lastCall.attemptNumber).toBe(retryCount + 1);
          expect(lastCall.executionStatus).toBe('failure');
          expect(lastCall.correlationId).toBe(correlationCtx.correlationId);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should respect retry policy for any valid retry count', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb,
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, request, correlationCtx) => {
          // Given: A tool with any valid retry count
          const mockAdapter = new MockAlwaysFailAdapter('retryable');
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The total attempts should equal (retryCount + 1)
          const expectedAttempts = retryCount + 1;
          expect(mockAdapter.executionCount).toBe(expectedAttempts);

          // And: The result metadata should match
          expect(result.metadata.attemptNumber).toBe(expectedAttempts);

          // And: The result should be a failure (since adapter always fails)
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should apply retry policy consistently across different error types', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n > 0),
        fc.constantFrom('timeout', 'network', 'rate limit', '503'),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, errorKeyword, request, correlationCtx) => {
          // Given: A tool with retries and an adapter that fails with specific retryable error
          class CustomErrorAdapter implements ProviderAdapter {
            public executionCount = 0;

            async execute(): Promise<unknown> {
              this.executionCount++;
              throw new Error(`Provider error: ${errorKeyword}`);
            }

            getProviderName(): string {
              return 'custom_error_provider';
            }
          }

          const mockAdapter = new CustomErrorAdapter();
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'CustomErrorAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('CustomErrorAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The retry policy should be applied
          expect(mockAdapter.executionCount).toBe(retryCount + 1);

          // And: The result should be a failure
          expect(result.success).toBe(false);

          // And: The error should be marked as retryable
          expect(result.error?.retryable).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should return success immediately when first attempt succeeds (no retries needed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb.filter((n) => n > 0),
        toolCallRequestArb,
        correlationContextArb,
        async (retryCount, request, correlationCtx) => {
          // Given: A tool with retries and an adapter that succeeds immediately
          const mockAdapter = new MockRetryableAdapter(0, 'retryable'); // 0 failures before success
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition('test_tool', retryCount, 0, 'MockRetryableAdapter')
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockRetryableAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should succeed
          expect(result.success).toBe(true);

          // And: The adapter should be called exactly once (no retries needed)
          expect(mockAdapter.executionCount).toBe(1);

          // And: The metadata should reflect only one attempt
          expect(result.metadata.attemptNumber).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });
});
