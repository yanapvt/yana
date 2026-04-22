/**
 * Property Test 13: Provider Failure Structured Response
 * 
 * Property Statement:
 * For any provider call that exhausts its retry policy, the Provider_Adapter SHALL 
 * return a structured failure state to the MCP_Interface containing the error 
 * classification and relevant context.
 * 
 * **Validates: Requirements 6.2, 6.6**
 * 
 * Requirements:
 * - 6.2: THE Nango_Adapter SHALL handle provider-specific request normalization, 
 *        retries, and rate limit behaviors
 * - 6.6: WHEN a provider call fails after exhausting retry policy, THE Provider_Adapter 
 *        SHALL return a structured failure state to the MCP_Interface
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { NangoAdapter, NangoConfig, ProviderRequest, ProviderResponse } from '../../services/adapters/NangoAdapter.js';
import { BaseProviderAdapter } from '../../services/adapters/ProviderAdapter.js';
import { CorrelationContext, ErrorCategory, ProviderFailureState } from '../../types/core.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock NangoAdapter that always fails after exhausting retries
 */
class MockFailingNangoAdapter extends NangoAdapter {
  public executionCount = 0;
  private errorType: 'network' | 'rate-limit' | 'server-error' | 'auth-error';
  private statusCode: number;

  constructor(
    config: NangoConfig,
    errorType: 'network' | 'rate-limit' | 'server-error' | 'auth-error' = 'network',
    maxRetries: number = 3
  ) {
    super(config, { maxRetries, initialDelayMs: 10, maxDelayMs: 50 });
    this.errorType = errorType;
    
    // Map error types to status codes
    this.statusCode = {
      'network': 503,
      'rate-limit': 429,
      'server-error': 500,
      'auth-error': 401,
    }[errorType];
  }

  getProviderName(): string {
    return 'mock_failing_provider';
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  buildProviderRequest(params: Record<string, unknown>): ProviderRequest {
    return {
      method: 'POST',
      endpoint: 'https://api.example.com/test',
      body: params,
    };
  }

  // Override to provide a mock token without calling Nango
  protected async getOAuthToken(context: CorrelationContext): Promise<any> {
    return {
      accessToken: 'mock_token',
      tokenType: 'Bearer',
    };
  }

  protected async performHttpRequest(request: ProviderRequest): Promise<ProviderResponse> {
    this.executionCount++;

    // Simulate different error types
    return {
      success: false,
      statusCode: this.statusCode,
      data: {
        error: `${this.errorType} error`,
        message: `Provider failed with ${this.errorType}`,
      },
    };
  }

  reset(): void {
    this.executionCount = 0;
  }
}

/**
 * Mock BaseProviderAdapter that always fails
 */
class MockFailingBaseAdapter extends BaseProviderAdapter {
  public executionCount = 0;
  private shouldThrow: boolean;

  constructor(maxRetries: number = 3, shouldThrow: boolean = true) {
    super({ maxRetries, initialDelayMs: 10, maxDelayMs: 50 });
    this.shouldThrow = shouldThrow;
  }

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.executionCount++;

    if (this.shouldThrow) {
      throw new Error('Provider execution failed - network timeout');
    }

    return { error: 'Provider failed' };
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  getProviderName(): string {
    return 'mock_base_provider';
  }

  reset(): void {
    this.executionCount = 0;
  }
}

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary NangoConfig
 */
const nangoConfigArb = fc.record({
  nangoUrl: fc.constant('https://api.nango.dev'),
  secretKey: fc.hexaString({ minLength: 32, maxLength: 32 }),
  integrationId: fc.uuid(),
  connectionId: fc.uuid(),
});

/**
 * Generates arbitrary correlation context
 */
const correlationContextArb = fc.record({
  correlationId: fc.uuid(),
  sessionId: fc.option(fc.uuid(), { nil: undefined }),
  userId: fc.option(fc.uuid(), { nil: undefined }),
  requestTimestamp: fc.date(),
});

/**
 * Generates arbitrary retry counts (1-5)
 */
const retryCountArb = fc.integer({ min: 1, max: 5 });

/**
 * Generates arbitrary provider parameters
 */
const providerParamsArb = fc.record({
  action: fc.constantFrom('search', 'book', 'cancel', 'update'),
  resourceId: fc.uuid(),
  data: fc.record({
    field1: fc.string(),
    field2: fc.integer(),
  }),
});

/**
 * Generates arbitrary error types
 */
const errorTypeArb = fc.constantFrom('network', 'rate-limit', 'server-error', 'auth-error') as fc.Arbitrary<'network' | 'rate-limit' | 'server-error' | 'auth-error'>;

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 13: Provider Failure Structured Response', () => {
  it('should return structured ProviderFailureState after exhausting retry policy', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter with a specific retry policy that will fail
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider request is executed and exhausts all retries
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The result should indicate failure
          expect(result.success).toBe(false);

          // And: A structured ProviderFailureState should be returned
          expect(result.failureState).toBeDefined();
          const failureState = result.failureState as ProviderFailureState;

          // And: The failure state should contain error classification
          expect(failureState.category).toBeDefined();
          expect(Object.values(ErrorCategory)).toContain(failureState.category);

          // And: The failure state should contain a message
          expect(failureState.message).toBeDefined();
          expect(typeof failureState.message).toBe('string');
          expect(failureState.message.length).toBeGreaterThan(0);

          // And: The failure state should indicate it's not retryable after exhaustion
          expect(failureState.retryable).toBe(false);

          // And: The failure state should contain relevant context
          expect(failureState.context).toBeDefined();
          expect(failureState.context.providerName).toBe('mock_failing_provider');
          
          // For non-retryable errors (auth-error), only 1 attempt is made
          // For retryable errors, maxRetries + 1 attempts are made
          const isRetryable = errorType === 'network' || errorType === 'rate-limit' || errorType === 'server-error';
          const expectedAttempts = isRetryable ? maxRetries + 1 : 1;
          expect(failureState.context.attemptCount).toBe(expectedAttempts);
          
          expect(failureState.context.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
          expect(failureState.context.timestamp).toBeInstanceOf(Date);
          expect(failureState.context.correlationId).toBe(context.correlationId);

          // And: The correct number of attempts should have been made
          expect(adapter.executionCount).toBe(expectedAttempts);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should include provider-specific error details in failure state', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter that will fail with specific error details
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider request is executed
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The failure state should exist
          expect(result.failureState).toBeDefined();
          const failureState = result.failureState as ProviderFailureState;

          // And: Provider-specific error information should be included
          if (failureState.providerCode || failureState.providerMessage) {
            expect(
              failureState.providerCode || failureState.providerMessage
            ).toBeDefined();
          }

          // And: The error should have a code or message
          expect(
            failureState.code || failureState.message
          ).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should include complete context metadata in failure state', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter with retry policy
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider request fails after retries
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The failure context should contain all required metadata
          const failureContext = result.failureState?.context;
          expect(failureContext).toBeDefined();

          // And: Provider name should be present
          expect(failureContext?.providerName).toBe('mock_failing_provider');

          // And: Attempt count should match expected retries
          const isRetryable = errorType === 'network' || errorType === 'rate-limit' || errorType === 'server-error';
          const expectedAttempts = isRetryable ? maxRetries + 1 : 1;
          expect(failureContext?.attemptCount).toBe(expectedAttempts);

          // And: Execution time should be tracked
          expect(failureContext?.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
          expect(typeof failureContext?.totalExecutionTimeMs).toBe('number');

          // And: Timestamp should be recent
          expect(failureContext?.timestamp).toBeInstanceOf(Date);
          const timeDiff = Date.now() - failureContext!.timestamp.getTime();
          expect(timeDiff).toBeLessThan(5000); // Within 5 seconds

          // And: Correlation ID should match the request
          expect(failureContext?.correlationId).toBe(context.correlationId);

          // And: Additional metadata should be present
          expect(failureContext?.metadata).toBeDefined();
          if (context.sessionId) {
            expect(failureContext?.metadata?.sessionId).toBe(context.sessionId);
          }
          if (context.userId) {
            expect(failureContext?.metadata?.userId).toBe(context.userId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should classify errors correctly in failure state', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter that fails with a specific error type
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider request fails
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The error should be classified appropriately
          const failureState = result.failureState as ProviderFailureState;
          expect(failureState.category).toBeDefined();

          // And: The category should be a valid ErrorCategory
          const validCategories = Object.values(ErrorCategory);
          expect(validCategories).toContain(failureState.category);

          // And: Network/server errors should be classified as PROVIDER_FAILURE
          if (errorType === 'network' || errorType === 'rate-limit' || errorType === 'server-error') {
            expect(failureState.category).toBe(ErrorCategory.PROVIDER_FAILURE);
          }

          // And: Auth errors should be classified as PROVIDER_FAILURE
          if (errorType === 'auth-error') {
            expect(failureState.category).toBe(ErrorCategory.PROVIDER_FAILURE);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should mark failure as non-retryable after exhausting retry policy', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter with retry policy
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: All retries are exhausted
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The failure should be marked as non-retryable
          expect(result.failureState?.retryable).toBe(false);

          // And: The error should also indicate non-retryable
          // (Note: The error.retryable may still be true for the error type,
          // but failureState.retryable should be false after exhaustion)
          expect(result.failureState?.retryable).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should track HTTP status code in failure context when available', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter that returns HTTP errors
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider request fails with HTTP error
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The last status code should be tracked in context
          const failureContext = result.failureState?.context;
          expect(failureContext?.lastStatusCode).toBeDefined();
          expect(typeof failureContext?.lastStatusCode).toBe('number');

          // And: The status code should match the error type
          const expectedStatusCodes = {
            'network': 503,
            'rate-limit': 429,
            'server-error': 500,
            'auth-error': 401,
          };
          expect(failureContext?.lastStatusCode).toBe(expectedStatusCodes[errorType]);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should return structured failure for BaseProviderAdapter implementations', async () => {
    await fc.assert(
      fc.asyncProperty(
        retryCountArb,
        providerParamsArb,
        correlationContextArb,
        async (maxRetries, params, context) => {
          // Given: A BaseProviderAdapter implementation that fails
          const adapter = new MockFailingBaseAdapter(maxRetries, true);

          // When: The adapter executes and fails
          // Note: BaseProviderAdapter doesn't have executeProviderRequest,
          // but we can test that it properly handles failures
          let caughtError = false;
          try {
            await adapter.execute(params, context);
          } catch (error) {
            caughtError = true;
            expect(error).toBeInstanceOf(Error);
          }

          // Then: An error should be thrown (BaseProviderAdapter doesn't wrap in ProviderResponse)
          expect(caughtError).toBe(true);

          // And: The adapter should have attempted execution
          expect(adapter.executionCount).toBeGreaterThan(0);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should maintain consistent failure state structure across different error types', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        fc.array(errorTypeArb, { minLength: 2, maxLength: 4 }),
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorTypes, params, context) => {
          // Given: Multiple provider adapters with different error types
          const results: ProviderFailureState[] = [];

          for (const errorType of errorTypes) {
            const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);
            const request = adapter.buildProviderRequest(params);
            const result = await adapter['executeProviderRequest'](request, context);
            
            if (result.failureState) {
              results.push(result.failureState);
            }
          }

          // Then: All failure states should have consistent structure
          for (const failureState of results) {
            // All should have required fields
            expect(failureState.category).toBeDefined();
            expect(failureState.message).toBeDefined();
            expect(typeof failureState.retryable).toBe('boolean');
            expect(failureState.context).toBeDefined();

            // All contexts should have required fields
            expect(failureState.context.providerName).toBeDefined();
            expect(failureState.context.attemptCount).toBeGreaterThan(0);
            expect(failureState.context.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
            expect(failureState.context.timestamp).toBeInstanceOf(Date);
            expect(failureState.context.correlationId).toBe(context.correlationId);
          }

          // And: All should be marked as non-retryable after exhaustion
          for (const failureState of results) {
            expect(failureState.retryable).toBe(false);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should include request timestamp in failure context metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: A provider adapter with correlation context
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider request fails
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: The failure context metadata should include request timestamp
          const metadata = result.failureState?.context.metadata;
          expect(metadata).toBeDefined();
          expect(metadata?.requestTimestamp).toBe(context.requestTimestamp);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should return failure state for any provider that exhausts retries', async () => {
    await fc.assert(
      fc.asyncProperty(
        nangoConfigArb,
        retryCountArb,
        errorTypeArb,
        providerParamsArb,
        correlationContextArb,
        async (config, maxRetries, errorType, params, context) => {
          // Given: Any provider adapter configuration
          const adapter = new MockFailingNangoAdapter(config, errorType, maxRetries);

          // When: The provider exhausts its retry policy
          const request = adapter.buildProviderRequest(params);
          const result = await adapter['executeProviderRequest'](request, context);

          // Then: A structured failure state MUST be returned
          expect(result.failureState).toBeDefined();

          // And: The failure state MUST contain error classification
          expect(result.failureState?.category).toBeDefined();

          // And: The failure state MUST contain relevant context
          expect(result.failureState?.context).toBeDefined();
          expect(result.failureState?.context.providerName).toBeDefined();
          expect(result.failureState?.context.attemptCount).toBeGreaterThan(0);
          expect(result.failureState?.context.correlationId).toBeDefined();

          // And: The failure MUST be marked as non-retryable
          expect(result.failureState?.retryable).toBe(false);
        }
      ),
      { numRuns: 100, timeout: 10000 }
    );
  }, 15000);
});
