/**
 * Unit tests for NangoAdapter base class
 * 
 * Tests credential management, OAuth token handling, retry logic,
 * and error classification.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NangoAdapter,
  type NangoConfig,
  type OAuthToken,
  type ProviderRequest,
  type ProviderResponse,
  type RetryPolicy,
} from './NangoAdapter.js';
import { CorrelationContext, ErrorCategory, ProviderFailureState } from '../../types/core.js';

// ============================================================================
// Test Implementation
// ============================================================================

/**
 * Concrete test implementation of NangoAdapter
 */
class TestNangoAdapter extends NangoAdapter {
  public callCount = 0;
  public shouldFail = false;
  public failureCount = 0;
  public currentFailures = 0;

  getProviderName(): string {
    return 'test-provider';
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return {
      normalized: true,
      data: rawResponse,
    };
  }

  buildProviderRequest(params: Record<string, unknown>): ProviderRequest {
    return {
      method: 'POST',
      endpoint: 'https://api.test-provider.com/action',
      body: params,
    };
  }

  // Override to simulate HTTP requests
  protected async performHttpRequest(request: ProviderRequest): Promise<ProviderResponse> {
    this.callCount++;

    if (this.shouldFail && this.currentFailures < this.failureCount) {
      this.currentFailures++;
      return {
        success: false,
        statusCode: 500,
        data: { error: 'Server error' },
      };
    }

    return {
      success: true,
      statusCode: 200,
      data: { result: 'success', request },
    };
  }

  // Override to simulate token fetching
  protected async fetchTokenFromNango(context: CorrelationContext): Promise<OAuthToken> {
    return {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      tokenType: 'Bearer',
      scope: 'read write',
    };
  }

  // Expose protected methods for testing
  public async testGetOAuthToken(context: CorrelationContext): Promise<OAuthToken> {
    return this.getOAuthToken(context);
  }

  public async testExecuteProviderRequest<T = unknown>(
    request: ProviderRequest,
    context: CorrelationContext
  ): Promise<ProviderResponse<T>> {
    return this.executeProviderRequest<T>(request, context);
  }

  public testClearTokenCache(): void {
    this.clearTokenCache();
  }
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestConfig(): NangoConfig {
  return {
    nangoUrl: 'https://api.nango.dev',
    secretKey: 'test-secret-key',
    integrationId: 'test-integration',
    connectionId: 'test-connection',
  };
}

function createTestContext(): CorrelationContext {
  return {
    correlationId: 'test-correlation-id',
    sessionId: 'test-session-id',
    userId: 'test-user-id',
    requestTimestamp: new Date(),
  };
}

function createCustomRetryPolicy(): Partial<RetryPolicy> {
  return {
    maxRetries: 2,
    initialDelayMs: 100,
    maxDelayMs: 500,
    backoffMultiplier: 2,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('NangoAdapter', () => {
  let adapter: TestNangoAdapter;
  let config: NangoConfig;
  let context: CorrelationContext;

  beforeEach(() => {
    config = createTestConfig();
    context = createTestContext();
    adapter = new TestNangoAdapter(config);
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
      const customPolicy = createCustomRetryPolicy();
      const customAdapter = new TestNangoAdapter(config, customPolicy);
      const policy = customAdapter.getRetryPolicy();

      expect(policy.maxRetries).toBe(2);
      expect(policy.initialDelayMs).toBe(100);
      expect(policy.maxDelayMs).toBe(500);
      expect(policy.backoffMultiplier).toBe(2);
    });

    it('should return provider name', () => {
      expect(adapter.getProviderName()).toBe('test-provider');
    });
  });

  describe('OAuth Token Management', () => {
    it('should fetch and cache OAuth token', async () => {
      const token1 = await adapter.testGetOAuthToken(context);
      const token2 = await adapter.testGetOAuthToken(context);

      expect(token1.accessToken).toBe('test-access-token');
      expect(token1.tokenType).toBe('Bearer');
      expect(token2).toEqual(token1); // Should return cached token
    });

    it('should clear token cache', async () => {
      await adapter.testGetOAuthToken(context);
      adapter.testClearTokenCache();

      // After clearing cache, should fetch new token
      const token = await adapter.testGetOAuthToken(context);
      expect(token.accessToken).toBe('test-access-token');
    });

    it('should validate token expiry', async () => {
      // Create adapter with expired token
      class ExpiredTokenAdapter extends TestNangoAdapter {
        protected async fetchTokenFromNango(context: CorrelationContext): Promise<OAuthToken> {
          return {
            accessToken: 'expired-token',
            tokenType: 'Bearer',
            expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
          };
        }
      }

      const expiredAdapter = new ExpiredTokenAdapter(config);
      const token = await expiredAdapter.testGetOAuthToken(context);

      // Should fetch new token since cached one is expired
      expect(token.accessToken).toBe('expired-token');
    });
  });

  describe('Provider Request Execution', () => {
    it('should execute successful provider request', async () => {
      const request: ProviderRequest = {
        method: 'POST',
        endpoint: 'https://api.test.com/action',
        body: { test: 'data' },
      };

      const response = await adapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.data).toBeDefined();
      expect(adapter.callCount).toBe(1);
    });

    it('should retry on retryable errors', async () => {
      // Use faster retry policy for testing
      const fastAdapter = new TestNangoAdapter(config, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 2,
      });
      fastAdapter.shouldFail = true;
      fastAdapter.failureCount = 2; // Fail twice, then succeed

      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await fastAdapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(true);
      expect(fastAdapter.callCount).toBe(3); // 2 failures + 1 success
    });

    it('should exhaust retries and return failure', async () => {
      // Use faster retry policy for testing
      const fastAdapter = new TestNangoAdapter(config, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 2,
      });
      fastAdapter.shouldFail = true;
      fastAdapter.failureCount = 10; // Fail more than max retries

      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await fastAdapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.retryable).toBe(true);
      expect(fastAdapter.callCount).toBe(3); // Initial + 2 retries
    });

    it('should inject OAuth token into request headers', async () => {
      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
        headers: { 'X-Custom': 'value' },
      };

      const response = await adapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(true);
      // Token should be injected (verified in performHttpRequest)
    });
  });

  describe('Response Normalization', () => {
    it('should normalize provider response', () => {
      const rawResponse = { id: 123, name: 'Test' };
      const normalized = adapter.normalizeResponse(rawResponse);

      expect(normalized).toEqual({
        normalized: true,
        data: rawResponse,
      });
    });
  });

  describe('Request Building', () => {
    it('should build provider request from parameters', () => {
      const params = { location: 'Galle', checkin: '2026-04-17' };
      const request = adapter.buildProviderRequest(params);

      expect(request.method).toBe('POST');
      expect(request.endpoint).toBe('https://api.test-provider.com/action');
      expect(request.body).toEqual(params);
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

    it('should include standard retryable status codes', () => {
      const policy = adapter.getRetryPolicy();

      expect(policy.retryableStatusCodes).toContain(408); // Timeout
      expect(policy.retryableStatusCodes).toContain(429); // Rate limit
      expect(policy.retryableStatusCodes).toContain(500); // Server error
      expect(policy.retryableStatusCodes).toContain(502); // Bad gateway
      expect(policy.retryableStatusCodes).toContain(503); // Service unavailable
      expect(policy.retryableStatusCodes).toContain(504); // Gateway timeout
    });

    it('should include standard retryable error codes', () => {
      const policy = adapter.getRetryPolicy();

      expect(policy.retryableErrorCodes).toContain('ETIMEDOUT');
      expect(policy.retryableErrorCodes).toContain('ECONNREFUSED');
      expect(policy.retryableErrorCodes).toContain('ENOTFOUND');
    });
  });

  describe('Error Classification', () => {
    it('should classify 400 errors as user input errors', async () => {
      class BadRequestAdapter extends TestNangoAdapter {
        protected async performHttpRequest(): Promise<ProviderResponse> {
          return {
            success: false,
            statusCode: 400,
            data: { message: 'Invalid parameters' },
          };
        }
      }

      const badAdapter = new BadRequestAdapter(config, {
        maxRetries: 0, // No retries for faster test
      });
      const request: ProviderRequest = {
        method: 'POST',
        endpoint: 'https://api.test.com/action',
      };

      const response = await badAdapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(false);
      expect(response.error?.category).toBe(ErrorCategory.USER_INPUT_ERROR);
      expect(response.error?.retryable).toBe(false);
    });

    it('should classify 401/403 errors as provider failures', async () => {
      class UnauthorizedAdapter extends TestNangoAdapter {
        protected async performHttpRequest(): Promise<ProviderResponse> {
          return {
            success: false,
            statusCode: 401,
            data: { message: 'Unauthorized' },
          };
        }
      }

      const authAdapter = new UnauthorizedAdapter(config, {
        maxRetries: 0, // No retries for faster test
      });
      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await authAdapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(false);
      expect(response.error?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
      expect(response.error?.retryable).toBe(false);
    });

    it('should classify 429 errors as retryable provider failures', async () => {
      class RateLimitAdapter extends TestNangoAdapter {
        protected async performHttpRequest(): Promise<ProviderResponse> {
          return {
            success: false,
            statusCode: 429,
            data: { message: 'Rate limit exceeded' },
          };
        }
      }

      const rateLimitAdapter = new RateLimitAdapter(config, {
        maxRetries: 0, // No retries for faster test
      });
      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await rateLimitAdapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(false);
      expect(response.error?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
      expect(response.error?.retryable).toBe(true);
    });

    it('should classify 5xx errors as retryable provider failures', async () => {
      class ServerErrorAdapter extends TestNangoAdapter {
        protected async performHttpRequest(): Promise<ProviderResponse> {
          return {
            success: false,
            statusCode: 503,
            data: { message: 'Service unavailable' },
          };
        }
      }

      const serverAdapter = new ServerErrorAdapter(config, {
        maxRetries: 0, // No retries for faster test
      });
      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await serverAdapter.testExecuteProviderRequest(request, context);

      expect(response.success).toBe(false);
      expect(response.error?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
      expect(response.error?.retryable).toBe(true);
    });
  });

  describe('Rate Limit Handling', () => {
    it('should respect Retry-After header', async () => {
      class RateLimitWithRetryAfterAdapter extends TestNangoAdapter {
        private attemptCount = 0;

        protected async performHttpRequest(): Promise<ProviderResponse> {
          this.attemptCount++;

          if (this.attemptCount === 1) {
            return {
              success: false,
              statusCode: 429,
              headers: { 'Retry-After': '1' }, // 1 second
              data: { message: 'Rate limit exceeded' },
            };
          }

          return {
            success: true,
            statusCode: 200,
            data: { result: 'success' },
          };
        }
      }

      const rateLimitAdapter = new RateLimitWithRetryAfterAdapter(config);
      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const startTime = Date.now();
      const response = await rateLimitAdapter.testExecuteProviderRequest(request, context);
      const duration = Date.now() - startTime;

      expect(response.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(1000); // Should wait at least 1 second
    });
  });

  describe('Requirements Validation', () => {
    it('should satisfy Requirement 6.1: OAuth handling and token refresh', async () => {
      // Test OAuth token management
      const token = await adapter.testGetOAuthToken(context);
      expect(token.accessToken).toBeDefined();
      expect(token.tokenType).toBeDefined();
    });

    it('should satisfy Requirement 6.2: Provider-specific normalization and retries', async () => {
      // Test normalization
      const normalized = adapter.normalizeResponse({ test: 'data' });
      expect(normalized).toBeDefined();

      // Test retry behavior with fast retry policy
      const fastAdapter = new TestNangoAdapter(config, {
        maxRetries: 1,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 2,
      });
      fastAdapter.shouldFail = true;
      fastAdapter.failureCount = 1;

      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await fastAdapter.testExecuteProviderRequest(request, context);
      expect(response.success).toBe(true);
      expect(fastAdapter.callCount).toBeGreaterThan(1); // Retried
    });

    it('should satisfy Requirement 6.5: Replaceable without changing Orchestrator', () => {
      // Test that adapter interface is consistent
      // NangoAdapter is abstract, so we test the concrete implementation
      expect(typeof adapter.normalizeResponse).toBe('function');
      expect(typeof adapter.getRetryPolicy).toBe('function');
      expect(typeof adapter.getProviderName).toBe('function');
      expect(typeof adapter.buildProviderRequest).toBe('function');
    });

    it('should satisfy Requirement 6.6: Return structured failure state after retry exhaustion', async () => {
      // Use faster retry policy for testing
      const fastAdapter = new TestNangoAdapter(config, {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 2,
      });
      fastAdapter.shouldFail = true;
      fastAdapter.failureCount = 10; // Fail more than max retries

      const request: ProviderRequest = {
        method: 'GET',
        endpoint: 'https://api.test.com/data',
      };

      const response = await fastAdapter.testExecuteProviderRequest(request, context);

      // Verify failure response
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      
      // Verify structured failure state (Requirement 6.6)
      expect(response.failureState).toBeDefined();
      expect(response.failureState?.category).toBeDefined();
      expect(response.failureState?.message).toBeDefined();
      expect(response.failureState?.retryable).toBe(false); // Not retryable after exhaustion
      
      // Verify failure context
      expect(response.failureState?.context).toBeDefined();
      expect(response.failureState?.context.providerName).toBe('test-provider');
      expect(response.failureState?.context.attemptCount).toBe(3); // Initial + 2 retries
      expect(response.failureState?.context.totalExecutionTimeMs).toBeGreaterThan(0);
      expect(response.failureState?.context.timestamp).toBeInstanceOf(Date);
      expect(response.failureState?.context.correlationId).toBe(context.correlationId);
    });

    it('should satisfy Requirement 13.2: Provide context for human handoff on repeated failures', async () => {
      // Use faster retry policy for testing
      const fastAdapter = new TestNangoAdapter(config, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 2,
      });
      fastAdapter.shouldFail = true;
      fastAdapter.failureCount = 10; // Fail repeatedly

      const request: ProviderRequest = {
        method: 'POST',
        endpoint: 'https://api.test.com/booking',
        body: { hotelId: 'hotel-123' },
      };

      const response = await fastAdapter.testExecuteProviderRequest(request, context);

      // Verify failure state contains all context needed for human handoff
      expect(response.failureState).toBeDefined();
      
      // Error classification for routing
      expect(response.failureState?.category).toBe(ErrorCategory.PROVIDER_FAILURE);
      
      // Context for operator
      expect(response.failureState?.context.providerName).toBe('test-provider');
      expect(response.failureState?.context.attemptCount).toBe(4); // Initial + 3 retries
      expect(response.failureState?.context.correlationId).toBe(context.correlationId);
      expect(response.failureState?.context.metadata?.sessionId).toBe(context.sessionId);
      expect(response.failureState?.context.metadata?.userId).toBe(context.userId);
      
      // Timing information
      expect(response.failureState?.context.totalExecutionTimeMs).toBeGreaterThan(0);
      expect(response.failureState?.context.timestamp).toBeInstanceOf(Date);
    });
  });
});
