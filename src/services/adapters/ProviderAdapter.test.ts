/**
 * Unit tests for ProviderAdapter interface and BaseProviderAdapter
 * 
 * Tests the provider adapter contract and base implementation for
 * direct provider integrations (without Nango).
 * 
 * Requirements: 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  type ProviderAdapter,
  BaseProviderAdapter,
  type ProviderAdapterResult,
  type ProviderAdapterError,
} from './ProviderAdapter.js';
import { type RetryPolicy } from './NangoAdapter.js';
import { CorrelationContext, ErrorCategory, ProviderFailureState } from '../../types/core.js';

// ============================================================================
// Test Implementation
// ============================================================================

/**
 * Concrete test implementation of BaseProviderAdapter
 */
class TestProviderAdapter extends BaseProviderAdapter {
  public callCount = 0;
  public shouldFail = false;
  public failureCount = 0;
  private currentFailures = 0;

  getProviderName(): string {
    return 'test-direct-provider';
  }

  normalizeResponse(rawResponse: unknown): unknown {
    if (typeof rawResponse === 'object' && rawResponse !== null) {
      return {
        normalized: true,
        ...rawResponse,
      };
    }
    return { normalized: true, value: rawResponse };
  }

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    this.callCount++;

    // Simulate retries
    if (this.shouldFail && this.currentFailures < this.failureCount) {
      this.currentFailures++;
      throw new Error('Simulated provider failure');
    }

    // Simulate successful execution
    const rawResponse = {
      id: 'test-123',
      status: 'success',
      params,
      context: {
        correlationId: context.correlationId,
        timestamp: new Date().toISOString(),
      },
    };

    return this.normalizeResponse(rawResponse);
  }

  // Expose protected methods for testing
  public async testSleep(ms: number): Promise<void> {
    return this.sleep(ms);
  }

  public testCalculateBackoffDelay(attemptNumber: number): number {
    return this.calculateBackoffDelay(attemptNumber);
  }
}

/**
 * Alternative implementation for testing interface compliance
 */
class AlternativeProviderAdapter implements ProviderAdapter {
  getProviderName(): string {
    return 'alternative-provider';
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return { alternative: true, data: rawResponse };
  }

  getRetryPolicy(): RetryPolicy {
    return {
      maxRetries: 5,
      initialDelayMs: 500,
      maxDelayMs: 5000,
      backoffMultiplier: 1.5,
      retryableStatusCodes: [500, 502, 503],
      retryableErrorCodes: ['TIMEOUT'],
    };
  }

  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    return this.normalizeResponse({ executed: true, params });
  }
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestContext(): CorrelationContext {
  return {
    correlationId: 'test-correlation-id',
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    requestTimestamp: new Date(),
  };
}

function createTestParams(): Record<string, unknown> {
  return {
    action: 'search',
    location: 'Galle',
    date: '2026-04-17',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProviderAdapter Interface', () => {
  describe('Interface Contract', () => {
    it('should define required methods', () => {
      const adapter: ProviderAdapter = new TestProviderAdapter();

      expect(typeof adapter.execute).toBe('function');
      expect(typeof adapter.normalizeResponse).toBe('function');
      expect(typeof adapter.getRetryPolicy).toBe('function');
      expect(typeof adapter.getProviderName).toBe('function');
    });

    it('should allow multiple implementations', () => {
      const adapter1: ProviderAdapter = new TestProviderAdapter();
      const adapter2: ProviderAdapter = new AlternativeProviderAdapter();

      expect(adapter1.getProviderName()).toBe('test-direct-provider');
      expect(adapter2.getProviderName()).toBe('alternative-provider');
    });

    it('should support custom retry policies', () => {
      const adapter: ProviderAdapter = new AlternativeProviderAdapter();
      const policy = adapter.getRetryPolicy();

      expect(policy.maxRetries).toBe(5);
      expect(policy.initialDelayMs).toBe(500);
      expect(policy.backoffMultiplier).toBe(1.5);
    });
  });
});

describe('BaseProviderAdapter', () => {
  let adapter: TestProviderAdapter;
  let context: CorrelationContext;
  let params: Record<string, unknown>;

  beforeEach(() => {
    adapter = new TestProviderAdapter();
    context = createTestContext();
    params = createTestParams();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with default retry policy', () => {
      const policy = adapter.getRetryPolicy();

      expect(policy.maxRetries).toBe(3);
      expect(policy.initialDelayMs).toBe(1000);
      expect(policy.maxDelayMs).toBe(10000);
      expect(policy.backoffMultiplier).toBe(2);
      expect(policy.retryableStatusCodes).toContain(500);
      expect(policy.retryableStatusCodes).toContain(429);
    });

    it('should initialize with custom retry policy', () => {
      const customAdapter = new TestProviderAdapter({
        maxRetries: 5,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        backoffMultiplier: 1.5,
      });

      const policy = customAdapter.getRetryPolicy();

      expect(policy.maxRetries).toBe(5);
      expect(policy.initialDelayMs).toBe(500);
      expect(policy.maxDelayMs).toBe(5000);
      expect(policy.backoffMultiplier).toBe(1.5);
    });

    it('should return provider name', () => {
      expect(adapter.getProviderName()).toBe('test-direct-provider');
    });
  });

  describe('Execute Method', () => {
    it('should execute successfully with valid parameters', async () => {
      const result = await adapter.execute(params, context);

      expect(result).toBeDefined();
      expect((result as any).normalized).toBe(true);
      expect((result as any).status).toBe('success');
      expect(adapter.callCount).toBe(1);
    });

    it('should pass parameters to execution', async () => {
      const result = await adapter.execute(params, context);

      expect((result as any).params).toEqual(params);
    });

    it('should pass correlation context', async () => {
      const result = await adapter.execute(params, context);

      expect((result as any).context.correlationId).toBe(context.correlationId);
    });

    it('should handle execution failures', async () => {
      adapter.shouldFail = true;
      adapter.failureCount = 10; // Fail indefinitely

      await expect(adapter.execute(params, context)).rejects.toThrow(
        'Simulated provider failure'
      );
    });
  });

  describe('Response Normalization', () => {
    it('should normalize object responses', () => {
      const rawResponse = { id: 123, name: 'Test' };
      const normalized = adapter.normalizeResponse(rawResponse);

      expect((normalized as any).normalized).toBe(true);
      expect((normalized as any).id).toBe(123);
      expect((normalized as any).name).toBe('Test');
    });

    it('should normalize primitive responses', () => {
      const rawResponse = 'simple string';
      const normalized = adapter.normalizeResponse(rawResponse);

      expect((normalized as any).normalized).toBe(true);
      expect((normalized as any).value).toBe('simple string');
    });

    it('should normalize null responses', () => {
      const normalized = adapter.normalizeResponse(null);

      expect((normalized as any).normalized).toBe(true);
      expect((normalized as any).value).toBeNull();
    });
  });

  describe('Retry Policy', () => {
    it('should return retry policy configuration', () => {
      const policy = adapter.getRetryPolicy();

      expect(policy).toHaveProperty('maxRetries');
      expect(policy).toHaveProperty('initialDelayMs');
      expect(policy).toHaveProperty('maxDelayMs');
      expect(policy).toHaveProperty('backoffMultiplier');
      expect(policy).toHaveProperty('retryableStatusCodes');
      expect(policy).toHaveProperty('retryableErrorCodes');
    });

    it('should not mutate internal retry policy', () => {
      const policy1 = adapter.getRetryPolicy();
      policy1.maxRetries = 999;

      const policy2 = adapter.getRetryPolicy();
      expect(policy2.maxRetries).toBe(3); // Should still be default
    });
  });

  describe('Backoff Calculation', () => {
    it('should calculate exponential backoff', () => {
      const delay0 = adapter.testCalculateBackoffDelay(0);
      const delay1 = adapter.testCalculateBackoffDelay(1);
      const delay2 = adapter.testCalculateBackoffDelay(2);

      expect(delay0).toBe(1000); // initialDelayMs * 2^0
      expect(delay1).toBe(2000); // initialDelayMs * 2^1
      expect(delay2).toBe(4000); // initialDelayMs * 2^2
    });

    it('should cap backoff at maxDelayMs', () => {
      const delay10 = adapter.testCalculateBackoffDelay(10);

      expect(delay10).toBe(10000); // Should be capped at maxDelayMs
    });

    it('should use custom backoff multiplier', () => {
      const customAdapter = new TestProviderAdapter({
        initialDelayMs: 100,
        backoffMultiplier: 3,
      });

      const delay0 = customAdapter.testCalculateBackoffDelay(0);
      const delay1 = customAdapter.testCalculateBackoffDelay(1);
      const delay2 = customAdapter.testCalculateBackoffDelay(2);

      expect(delay0).toBe(100); // 100 * 3^0
      expect(delay1).toBe(300); // 100 * 3^1
      expect(delay2).toBe(900); // 100 * 3^2
    });
  });

  describe('Sleep Utility', () => {
    it('should sleep for specified duration', async () => {
      const startTime = Date.now();
      await adapter.testSleep(100);
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(100);
      expect(duration).toBeLessThan(200); // Allow some margin
    });
  });

  describe('Replaceability', () => {
    it('should allow swapping implementations without interface changes', async () => {
      const adapters: ProviderAdapter[] = [
        new TestProviderAdapter(),
        new AlternativeProviderAdapter(),
      ];

      for (const adapter of adapters) {
        const result = await adapter.execute(params, context);
        expect(result).toBeDefined();

        const normalized = adapter.normalizeResponse({ test: 'data' });
        expect(normalized).toBeDefined();

        const policy = adapter.getRetryPolicy();
        expect(policy).toBeDefined();

        const name = adapter.getProviderName();
        expect(typeof name).toBe('string');
      }
    });
  });

  describe('Requirements Validation', () => {
    it('should satisfy Requirement 6.2: Provider-specific normalization', () => {
      const rawResponse = { id: 123, data: 'test' };
      const normalized = adapter.normalizeResponse(rawResponse);

      expect(normalized).toBeDefined();
      expect((normalized as any).normalized).toBe(true);
    });

    it('should satisfy Requirement 6.4: Direct provider integration without Nango', async () => {
      // BaseProviderAdapter should work without Nango
      const result = await adapter.execute(params, context);

      expect(result).toBeDefined();
      expect(adapter.callCount).toBe(1);
    });

    it('should satisfy Requirement 6.5: Replaceable without changing Orchestrator', () => {
      // Test that different implementations satisfy the same interface
      const adapter1: ProviderAdapter = new TestProviderAdapter();
      const adapter2: ProviderAdapter = new AlternativeProviderAdapter();

      // Both should have the same interface
      expect(typeof adapter1.execute).toBe('function');
      expect(typeof adapter2.execute).toBe('function');
      expect(typeof adapter1.normalizeResponse).toBe('function');
      expect(typeof adapter2.normalizeResponse).toBe('function');
      expect(typeof adapter1.getRetryPolicy).toBe('function');
      expect(typeof adapter2.getRetryPolicy).toBe('function');
      expect(typeof adapter1.getProviderName).toBe('function');
      expect(typeof adapter2.getProviderName).toBe('function');
    });
  });

  describe('Error Handling', () => {
    it('should propagate execution errors', async () => {
      adapter.shouldFail = true;
      adapter.failureCount = 1;

      await expect(adapter.execute(params, context)).rejects.toThrow();
    });

    it('should handle normalization of error responses', () => {
      const errorResponse = {
        error: 'Something went wrong',
        code: 'ERR_PROVIDER',
      };

      const normalized = adapter.normalizeResponse(errorResponse);

      expect((normalized as any).normalized).toBe(true);
      expect((normalized as any).error).toBe('Something went wrong');
    });
  });
});

describe('ProviderAdapter Types', () => {
  describe('ProviderAdapterResult', () => {
    it('should structure successful results', () => {
      const result: ProviderAdapterResult = {
        success: true,
        data: { id: 123, name: 'Test' },
        metadata: {
          providerName: 'test-provider',
          executionTimeMs: 150,
          attemptCount: 1,
          timestamp: new Date(),
        },
      };

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.metadata.providerName).toBe('test-provider');
    });

    it('should structure error results', () => {
      const result: ProviderAdapterResult = {
        success: false,
        error: {
          message: 'Provider unavailable',
          code: 'ERR_UNAVAILABLE',
          retryable: true,
          providerCode: '503',
          providerMessage: 'Service temporarily unavailable',
        },
        metadata: {
          providerName: 'test-provider',
          executionTimeMs: 5000,
          attemptCount: 3,
          timestamp: new Date(),
        },
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.retryable).toBe(true);
    });

    it('should structure failure results with ProviderFailureState (Requirement 6.6)', () => {
      const failureState: ProviderFailureState = {
        category: ErrorCategory.PROVIDER_FAILURE,
        message: 'Provider request failed after exhausting retry policy',
        code: '503',
        retryable: false,
        providerCode: 'SERVICE_UNAVAILABLE',
        providerMessage: 'Service temporarily unavailable',
        context: {
          providerName: 'test-provider',
          attemptCount: 4,
          totalExecutionTimeMs: 5000,
          timestamp: new Date(),
          correlationId: 'test-correlation-id',
          lastStatusCode: 503,
          metadata: {
            sessionId: 'test-session-id',
            userId: 'test-user-id',
          },
        },
      };

      const result: ProviderAdapterResult = {
        success: false,
        failureState,
        metadata: {
          providerName: 'test-provider',
          executionTimeMs: 5000,
          attemptCount: 4,
          timestamp: new Date(),
        },
      };

      expect(result.success).toBe(false);
      expect(result.failureState).toBeDefined();
      expect(result.failureState?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
      expect(result.failureState?.retryable).toBe(false);
      expect(result.failureState?.context.providerName).toBe('test-provider');
      expect(result.failureState?.context.attemptCount).toBe(4);
      expect(result.failureState?.context.correlationId).toBe('test-correlation-id');
    });
  });

  describe('ProviderAdapterError', () => {
    it('should structure error information', () => {
      const error: ProviderAdapterError = {
        message: 'Rate limit exceeded',
        code: 'ERR_RATE_LIMIT',
        retryable: true,
        providerCode: '429',
        providerMessage: 'Too many requests',
      };

      expect(error.message).toBe('Rate limit exceeded');
      expect(error.retryable).toBe(true);
      expect(error.providerCode).toBe('429');
    });

    it('should support minimal error structure', () => {
      const error: ProviderAdapterError = {
        message: 'Unknown error',
        retryable: false,
      };

      expect(error.message).toBe('Unknown error');
      expect(error.retryable).toBe(false);
      expect(error.code).toBeUndefined();
    });
  });
});
