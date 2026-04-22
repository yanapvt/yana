/**
 * Property Test 10: Tool Call Contract Validation
 * 
 * Property Statement:
 * For any tool call, the MCP_Interface SHALL validate the call against the tool's 
 * registered contract; calls that fail validation SHALL not be executed and SHALL 
 * return a structured error state.
 * 
 * **Validates: Requirements 5.1, 5.4**
 * 
 * Requirements:
 * - 5.1: THE MCP_Interface SHALL validate every tool call against the tool's 
 *        registered contract before execution
 * - 5.4: WHEN a tool call fails, THE MCP_Interface SHALL return a structured 
 *        error state to the Orchestrator
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
 * Mock provider adapter that tracks execution attempts
 */
class MockProviderAdapter implements ProviderAdapter {
  public executionCount = 0;

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.executionCount++;
    return { success: true, data: params };
  }

  getProviderName(): string {
    return 'mock_provider';
  }

  reset(): void {
    this.executionCount = 0;
  }
}

/**
 * Creates a mock tool definition
 */
function createMockToolDefinition(
  toolName: string,
  requiredParams: Array<{ name: string; type: string }>,
  optionalParams: Array<{ name: string; type: string }> = []
) {
  return {
    name: toolName,
    version: '1.0',
    description: `Test tool: ${toolName}`,
    parameters: {
      required: requiredParams.map((p) => ({
        name: p.name,
        type: p.type,
        description: `Parameter ${p.name}`,
      })),
      optional: optionalParams.map((p) => ({
        name: p.name,
        type: p.type,
        description: `Optional parameter ${p.name}`,
      })),
    },
    providerMapping: {
      providerName: 'test_provider',
      adapterClass: 'MockAdapter',
    },
    executionPolicy: {
      retryCount: 0,
      retryDelayMs: 100,
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
 * Generates arbitrary tool names
 */
const toolNameArb = fc.oneof(
  fc.constant('search_hotels'),
  fc.constant('book_hotel'),
  fc.constant('cancel_booking'),
  fc.stringMatching(/^[a-z_]+$/).filter((s) => s.length > 2 && s.length < 30)
);

/**
 * Generates arbitrary parameter names
 */
const paramNameArb = fc.stringMatching(/^[a-z_][a-z0-9_]*$/).filter(
  (s) => s.length > 1 && s.length < 20
);

/**
 * Generates arbitrary parameter types
 */
const paramTypeArb = fc.oneof(
  fc.constant('string'),
  fc.constant('number'),
  fc.constant('boolean'),
  fc.constant('date'),
  fc.constant('object'),
  fc.constant('array')
);

/**
 * Generates a value matching a specific type
 */
function generateValueForType(type: string): fc.Arbitrary<unknown> {
  switch (type) {
    case 'string':
      return fc.string();
    case 'number':
      return fc.integer();
    case 'boolean':
      return fc.boolean();
    case 'date':
      return fc.date().map((d) => d.toISOString());
    case 'object':
      return fc.dictionary(fc.string(), fc.string());
    case 'array':
      return fc.array(fc.string());
    default:
      return fc.string();
  }
}

/**
 * Generates a value NOT matching a specific type
 */
function generateInvalidValueForType(type: string): fc.Arbitrary<unknown> {
  switch (type) {
    case 'string':
      return fc.oneof(fc.integer(), fc.boolean(), fc.constant(null));
    case 'number':
      return fc.oneof(fc.string(), fc.boolean(), fc.constant(null));
    case 'boolean':
      return fc.oneof(fc.string(), fc.integer(), fc.constant(null));
    case 'date':
      // Generate values that are definitely not valid dates
      return fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant('invalid-date-string'));
    case 'object':
      return fc.oneof(fc.string(), fc.integer(), fc.constant(null));
    case 'array':
      return fc.oneof(fc.string(), fc.integer(), fc.dictionary(fc.string(), fc.string()));
    default:
      return fc.integer();
  }
}

/**
 * Generates arbitrary parameter definitions
 */
const paramDefinitionArb = fc.record({
  name: paramNameArb,
  type: paramTypeArb,
});

/**
 * Generates a tool definition with arbitrary parameters
 */
const toolDefinitionArb = fc.record({
  toolName: toolNameArb,
  requiredParams: fc.array(paramDefinitionArb, { minLength: 1, maxLength: 5 }),
  optionalParams: fc.array(paramDefinitionArb, { minLength: 0, maxLength: 3 }),
});

/**
 * Generates a valid tool call request matching a tool definition
 */
const validToolCallArb = toolDefinitionArb.chain((toolDef) => {
  // Generate values for all required parameters
  const requiredParamsArb = fc.record(
    Object.fromEntries(
      toolDef.requiredParams.map((p) => [p.name, generateValueForType(p.type)])
    )
  );

  // Optionally include some optional parameters
  const optionalParamsArb = fc.record(
    Object.fromEntries(
      toolDef.optionalParams.map((p) => [
        p.name,
        fc.option(generateValueForType(p.type), { nil: undefined }),
      ])
    )
  );

  return fc.record({
    toolDef: fc.constant(toolDef),
    params: fc
      .tuple(requiredParamsArb, optionalParamsArb)
      .map(([required, optional]) => {
        // Merge required and optional, filtering out undefined values
        const merged = { ...required };
        for (const [key, value] of Object.entries(optional)) {
          if (value !== undefined) {
            merged[key] = value;
          }
        }
        return merged;
      }),
  });
});

/**
 * Generates an invalid tool call request (missing required parameters)
 */
const missingParamToolCallArb = toolDefinitionArb
  .filter((toolDef) => toolDef.requiredParams.length > 0)
  .chain((toolDef) => {
    // Pick a subset of required parameters (at least one missing)
    const numToInclude = fc.integer({
      min: 0,
      max: toolDef.requiredParams.length - 1,
    });

    return numToInclude.chain((count) => {
      const paramsToInclude = toolDef.requiredParams.slice(0, count);
      const paramsArb = fc.record(
        Object.fromEntries(
          paramsToInclude.map((p) => [p.name, generateValueForType(p.type)])
        )
      );

      return fc.record({
        toolDef: fc.constant(toolDef),
        params: paramsArb,
      });
    });
  });

/**
 * Generates an invalid tool call request (wrong parameter type)
 */
const wrongTypeToolCallArb = toolDefinitionArb
  .filter((toolDef) => toolDef.requiredParams.length > 0)
  .chain((toolDef) => {
    // Pick one parameter to have wrong type
    const paramIndex = fc.integer({
      min: 0,
      max: toolDef.requiredParams.length - 1,
    });

    return paramIndex.chain((idx) => {
      const wrongParam = toolDef.requiredParams[idx];
      const otherParams = toolDef.requiredParams.filter((_, i) => i !== idx);

      const wrongValueArb = generateInvalidValueForType(wrongParam.type);
      const otherParamsArb = fc.record(
        Object.fromEntries(
          otherParams.map((p) => [p.name, generateValueForType(p.type)])
        )
      );

      return fc.record({
        toolDef: fc.constant(toolDef),
        params: fc
          .tuple(wrongValueArb, otherParamsArb)
          .map(([wrongValue, otherValues]) => ({
            ...otherValues,
            [wrongParam.name]: wrongValue,
          })),
        wrongParamName: fc.constant(wrongParam.name),
      });
    });
  });

/**
 * Generates arbitrary correlation context
 */
const correlationContextArb = fc.record({
  correlationId: fc.uuid(),
  sessionId: fc.uuid(),
  userId: fc.uuid(),
  requestTimestamp: fc.date(),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 10: Tool Call Contract Validation', () => {
  let mockToolRepository: ToolRepository;

  beforeEach(() => {
    mockToolRepository = {
      createRun: vi.fn().mockResolvedValue({ runId: 'test-run-id' }),
    } as any;
  });

  it('should accept and execute all valid tool calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        validToolCallArb,
        correlationContextArb,
        async ({ toolDef, params }, correlationCtx) => {
          // Given: A tool definition and a valid tool call request
          const mockAdapter = new MockProviderAdapter();
          
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should succeed
          expect(result.success).toBe(true);

          // And: The adapter should have been executed
          expect(mockAdapter.executionCount).toBe(1);

          // And: No error should be returned
          expect(result.error).toBeUndefined();

          // And: The result should contain metadata
          expect(result.metadata).toBeDefined();
          expect(result.metadata.toolName).toBe(toolDef.toolName);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject all tool calls with missing required parameters', async () => {
    await fc.assert(
      fc.asyncProperty(
        missingParamToolCallArb,
        correlationContextArb,
        async ({ toolDef, params }, correlationCtx) => {
          // Given: A tool definition and a tool call missing required parameters
          const mockAdapter = new MockProviderAdapter();
          
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should fail
          expect(result.success).toBe(false);

          // And: The adapter should NOT have been executed
          expect(mockAdapter.executionCount).toBe(0);

          // And: A structured error should be returned
          expect(result.error).toBeDefined();
          expect(result.error?.category).toBe(ErrorCategory.SCHEMA_ERROR);
          expect(result.error?.retryable).toBe(false);

          // And: The error message should indicate missing parameter
          expect(result.error?.message).toContain('validation failed');

          // And: The result should contain metadata
          expect(result.metadata).toBeDefined();
          expect(result.metadata.toolName).toBe(toolDef.toolName);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject all tool calls with wrong parameter types', async () => {
    await fc.assert(
      fc.asyncProperty(
        wrongTypeToolCallArb,
        correlationContextArb,
        async ({ toolDef, params, wrongParamName }, correlationCtx) => {
          // Given: A tool definition and a tool call with wrong parameter type
          const mockAdapter = new MockProviderAdapter();
          
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should fail
          expect(result.success).toBe(false);

          // And: The adapter should NOT have been executed
          expect(mockAdapter.executionCount).toBe(0);

          // And: A structured error should be returned
          expect(result.error).toBeDefined();
          expect(result.error?.category).toBe(ErrorCategory.SCHEMA_ERROR);
          expect(result.error?.retryable).toBe(false);

          // And: The error message should reference the wrong parameter
          expect(result.error?.message).toContain('validation failed');

          // And: The result should contain metadata
          expect(result.metadata).toBeDefined();
          expect(result.metadata.toolName).toBe(toolDef.toolName);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should reject tool calls for unavailable tools', async () => {
    await fc.assert(
      fc.asyncProperty(
        toolNameArb,
        fc.dictionary(fc.string(), fc.string()),
        correlationContextArb,
        async (toolName, params, correlationCtx) => {
          // Given: A tool that is not available
          const mockAdapter = new MockProviderAdapter();
          
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(null),
            isToolAvailable: vi.fn().mockResolvedValue(false),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should fail
          expect(result.success).toBe(false);

          // And: The adapter should NOT have been executed
          expect(mockAdapter.executionCount).toBe(0);

          // And: A structured error should be returned
          expect(result.error).toBeDefined();
          expect(result.error?.retryable).toBe(false);

          // And: The error message should indicate tool not available
          expect(result.error?.message).toContain('not available');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should always return structured error state for validation failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(missingParamToolCallArb, wrongTypeToolCallArb),
        correlationContextArb,
        async (toolCall, correlationCtx) => {
          // Given: Any invalid tool call
          const mockAdapter = new MockProviderAdapter();
          const toolDef = toolCall.toolDef;
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params: toolCall.params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The result must have a structured error
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();

          // And: The error must have required fields
          expect(result.error?.category).toBeDefined();
          expect(result.error?.message).toBeDefined();
          expect(typeof result.error?.retryable).toBe('boolean');

          // And: The error category must be valid
          expect(Object.values(ErrorCategory)).toContain(result.error?.category);

          // And: Metadata must be present
          expect(result.metadata).toBeDefined();
          expect(result.metadata.toolName).toBe(toolDef.toolName);
          expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);
          expect(result.metadata.attemptNumber).toBe(1);
          expect(result.metadata.timestamp).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should log all validation failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        missingParamToolCallArb,
        correlationContextArb,
        async ({ toolDef, params }, correlationCtx) => {
          // Given: An invalid tool call
          const mockAdapter = new MockProviderAdapter();
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const createRunSpy = vi.fn().mockResolvedValue({ runId: 'test-run-id' });
          const mockRepo = { createRun: createRunSpy } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(mockToolRegistry, mockRepo, adapters);

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed
          await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The failure should be logged
          expect(createRunSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              correlationId: correlationCtx.correlationId,
              sessionId: correlationCtx.sessionId,
              userId: correlationCtx.userId,
              toolName: toolDef.toolName,
              executionStatus: 'failure',
              errorData: expect.any(Object),
            })
          );
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should be deterministic: same invalid call yields same validation error', async () => {
    await fc.assert(
      fc.asyncProperty(
        missingParamToolCallArb,
        correlationContextArb,
        async ({ toolDef, params }, correlationCtx) => {
          // Given: An invalid tool call
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          
          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The same invalid call is executed multiple times
          const results = [];
          for (let i = 0; i < 3; i++) {
            const mockAdapter = new MockProviderAdapter();
            adapters.set('MockAdapter', mockAdapter);
            const result = await mcpInterface.executeToolCall(request, correlationCtx);
            results.push({
              success: result.success,
              errorCategory: result.error?.category,
              errorRetryable: result.error?.retryable,
              adapterExecuted: mockAdapter.executionCount > 0,
            });
          }

          // Then: All attempts should yield the same result
          expect(results[0]).toEqual(results[1]);
          expect(results[1]).toEqual(results[2]);

          // And: The adapter should never be executed
          expect(results[0].adapterExecuted).toBe(false);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should validate before execution: no side effects on validation failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(missingParamToolCallArb, wrongTypeToolCallArb),
        correlationContextArb,
        async (toolCall, correlationCtx) => {
          // Given: Any invalid tool call
          const mockAdapter = new MockProviderAdapter();
          const toolDef = toolCall.toolDef;
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params: toolCall.params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The invalid tool call is executed
          await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The adapter should NEVER be executed (no side effects)
          expect(mockAdapter.executionCount).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should accept optional parameters when they match the expected type', async () => {
    await fc.assert(
      fc.asyncProperty(
        toolDefinitionArb.filter((td) => td.optionalParams.length > 0),
        correlationContextArb,
        async (toolDef, correlationCtx) => {
          // Given: A tool with optional parameters
          const mockAdapter = new MockProviderAdapter();
          const mockToolRegistry = {
            getTool: vi.fn().mockResolvedValue(
              createMockToolDefinition(
                toolDef.toolName,
                toolDef.requiredParams,
                toolDef.optionalParams
              )
            ),
            isToolAvailable: vi.fn().mockResolvedValue(true),
          } as any;

          const adapters = new Map<string, ProviderAdapter>();
          adapters.set('MockAdapter', mockAdapter);

          const mcpInterface = new MCPInterface(
            mockToolRegistry,
            mockToolRepository,
            adapters
          );

          // Build params with all required and all optional parameters
          const params: Record<string, unknown> = {};
          for (const p of toolDef.requiredParams) {
            params[p.name] = await fc.sample(generateValueForType(p.type), 1)[0];
          }
          for (const p of toolDef.optionalParams) {
            params[p.name] = await fc.sample(generateValueForType(p.type), 1)[0];
          }

          const request: ToolCallRequest = {
            tool: toolDef.toolName,
            params,
            context: {
              userLanguage: 'en',
              canonicalLanguage: 'en',
              sessionId: correlationCtx.sessionId,
              requestId: correlationCtx.correlationId,
            },
          };

          // When: The tool call is executed with optional parameters
          const result = await mcpInterface.executeToolCall(request, correlationCtx);

          // Then: The call should succeed
          expect(result.success).toBe(true);

          // And: The adapter should have been executed
          expect(mockAdapter.executionCount).toBe(1);
        }
      ),
      { numRuns: 30 }
    );
  });
});
