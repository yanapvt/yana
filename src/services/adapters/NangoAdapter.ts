/**
 * NangoAdapter - Base class for Nango-based provider integrations
 * 
 * Wraps Nango SDK for credential storage, OAuth handling, and token refresh.
 * Provides a foundation for provider-specific adapters to extend.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { CorrelationContext, ErrorCategory, ProviderFailureState, ProviderFailureContext } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Nango configuration for a provider
 */
export interface NangoConfig {
  /** Nango instance URL (e.g., https://api.nango.dev) */
  nangoUrl: string;
  /** Nango secret key for authentication */
  secretKey: string;
  /** Provider integration ID in Nango */
  integrationId: string;
  /** Connection ID for this specific provider instance */
  connectionId: string;
}

/**
 * OAuth token information
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType: string;
  scope?: string;
}

/**
 * Provider request configuration
 */
export interface ProviderRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  headers?: Record<string, string>;
  body?: unknown;
  queryParams?: Record<string, string>;
}

/**
 * Provider response wrapper
 */
export interface ProviderResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ProviderError;
  failureState?: ProviderFailureState;
  statusCode?: number;
  headers?: Record<string, string>;
}

/**
 * Provider error details
 */
export interface ProviderError {
  category: ErrorCategory;
  message: string;
  code?: string;
  retryable: boolean;
  providerCode?: string;
  providerMessage?: string;
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatusCodes: number[];
  retryableErrorCodes: string[];
}

// ============================================================================
// NangoAdapter Base Class
// ============================================================================

/**
 * Base class for Nango-based provider adapters
 * 
 * Handles:
 * - Credential storage and retrieval via Nango
 * - OAuth token management and refresh
 * - Provider-specific request normalization
 * - Retry logic and rate limit handling
 * - Error classification and structured responses
 * 
 * Requirements:
 * - 6.1: Manage provider credential storage, OAuth, token refresh
 * - 6.2: Handle provider-specific normalization, retries, rate limits
 * - 6.3: No business logic that belongs in Orchestrator/Schema_Engine
 * - 6.4: Support direct provider integration without Nango where necessary
 * - 6.5: Replaceable without changing Orchestrator or Schema_Engine
 */
export abstract class NangoAdapter {
  protected config: NangoConfig;
  protected retryPolicy: RetryPolicy;
  private tokenCache: Map<string, OAuthToken> = new Map();

  constructor(config: NangoConfig, retryPolicy?: Partial<RetryPolicy>) {
    this.config = config;
    this.retryPolicy = {
      maxRetries: retryPolicy?.maxRetries ?? 3,
      initialDelayMs: retryPolicy?.initialDelayMs ?? 1000,
      maxDelayMs: retryPolicy?.maxDelayMs ?? 10000,
      backoffMultiplier: retryPolicy?.backoffMultiplier ?? 2,
      retryableStatusCodes: retryPolicy?.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504],
      retryableErrorCodes: retryPolicy?.retryableErrorCodes ?? ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'],
    };
  }

  // ============================================================================
  // Abstract Methods - Must be implemented by provider-specific adapters
  // ============================================================================

  /**
   * Get the provider name for logging and identification
   */
  abstract getProviderName(): string;

  /**
   * Normalize provider-specific response to internal format
   * 
   * Each provider adapter must implement this to convert the raw provider
   * response into the expected internal data structure.
   * 
   * Requirement 6.2: Handle provider-specific normalization
   */
  abstract normalizeResponse(rawResponse: unknown): unknown;

  /**
   * Build provider-specific request from normalized parameters
   * 
   * Converts internal normalized parameters into the provider's expected
   * request format (endpoint, headers, body, query params).
   * 
   * Requirement 6.2: Handle provider-specific request normalization
   */
  abstract buildProviderRequest(params: Record<string, unknown>): ProviderRequest;

  // ============================================================================
  // OAuth and Credential Management
  // ============================================================================

  /**
   * Get OAuth token for the provider
   * 
   * Retrieves token from cache if valid, otherwise fetches from Nango.
   * Automatically refreshes expired tokens.
   * 
   * Requirement 6.1: OAuth handling and token refresh
   */
  protected async getOAuthToken(context: CorrelationContext): Promise<OAuthToken> {
    const cacheKey = `${this.config.integrationId}:${this.config.connectionId}`;
    
    // Check cache first
    const cachedToken = this.tokenCache.get(cacheKey);
    if (cachedToken && this.isTokenValid(cachedToken)) {
      return cachedToken;
    }

    // Fetch from Nango
    try {
      const token = await this.fetchTokenFromNango(context);
      this.tokenCache.set(cacheKey, token);
      return token;
    } catch (error) {
      throw this.createProviderError(
        ErrorCategory.PROVIDER_FAILURE,
        'Failed to retrieve OAuth token',
        error,
        false
      );
    }
  }

  /**
   * Check if a token is still valid
   */
  private isTokenValid(token: OAuthToken): boolean {
    if (!token.expiresAt) {
      // If no expiry, assume valid (some providers don't expire tokens)
      return true;
    }

    // Add 5-minute buffer before expiry
    const bufferMs = 5 * 60 * 1000;
    return token.expiresAt.getTime() - bufferMs > Date.now();
  }

  /**
   * Fetch OAuth token from Nango
   * 
   * In a real implementation, this would call the Nango API.
   * For now, this is a placeholder that can be overridden.
   * 
   * Requirement 6.1: Credential storage via Nango
   */
  protected async fetchTokenFromNango(context: CorrelationContext): Promise<OAuthToken> {
    // Placeholder implementation
    // In production, this would call:
    // const response = await fetch(`${this.config.nangoUrl}/connection/${this.config.connectionId}`, {
    //   headers: { 'Authorization': `Bearer ${this.config.secretKey}` }
    // });
    
    throw new Error('Nango integration not yet implemented - override fetchTokenFromNango in subclass');
  }

  /**
   * Refresh an expired OAuth token
   * 
   * Requirement 6.1: Token refresh
   */
  protected async refreshOAuthToken(
    token: OAuthToken,
    context: CorrelationContext
  ): Promise<OAuthToken> {
    // Placeholder implementation
    // In production, this would call Nango's token refresh endpoint
    
    throw new Error('Token refresh not yet implemented - override refreshOAuthToken in subclass');
  }

  /**
   * Clear cached token (useful for testing or forcing refresh)
   */
  protected clearTokenCache(): void {
    this.tokenCache.clear();
  }

  // ============================================================================
  // Provider Request Execution
  // ============================================================================

  /**
   * Execute a provider request with retry logic
   * 
   * Handles:
   * - OAuth token injection
   * - Retry logic with exponential backoff
   * - Rate limit detection and handling
   * - Error classification
   * - Structured failure state on retry exhaustion
   * 
   * Requirements:
   * - 6.1: OAuth handling
   * - 6.2: Retries and rate limit behaviors
   * - 6.6: Return structured failure state after retry exhaustion
   */
  protected async executeProviderRequest<T = unknown>(
    request: ProviderRequest,
    context: CorrelationContext
  ): Promise<ProviderResponse<T>> {
    let lastError: ProviderError | undefined;
    const startTime = Date.now();
    let attemptCount = 0;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      attemptCount++;
      try {
        // Get OAuth token
        const token = await this.getOAuthToken(context);

        // Add authorization header
        const headers = {
          ...request.headers,
          'Authorization': `${token.tokenType} ${token.accessToken}`,
          'Content-Type': 'application/json',
        };

        // Execute request (placeholder - would use fetch or http client)
        const response = await this.performHttpRequest({
          ...request,
          headers,
        });

        // Check for rate limiting
        if (response.statusCode === 429) {
          const retryAfter = this.extractRetryAfter(response.headers);
          if (retryAfter && attempt < this.retryPolicy.maxRetries) {
            await this.sleep(retryAfter);
            continue;
          }
        }

        // Check if response indicates success
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          return {
            success: true,
            data: response.data as T,
            statusCode: response.statusCode,
            headers: response.headers,
          };
        }

        // Non-2xx response
        lastError = this.classifyHttpError(response.statusCode, response.data);

        // Check if retryable
        if (!this.isRetryableStatusCode(response.statusCode || 0) || attempt === this.retryPolicy.maxRetries) {
          break;
        }

        // Apply backoff delay
        await this.sleep(this.calculateBackoffDelay(attempt));

      } catch (error) {
        lastError = this.classifyError(error);

        // Check if retryable
        if (!lastError.retryable || attempt === this.retryPolicy.maxRetries) {
          break;
        }

        // Apply backoff delay
        await this.sleep(this.calculateBackoffDelay(attempt));
      }
    }

    // All retries exhausted - return structured failure state
    // Requirement 6.6: Return structured failure state after retry exhaustion
    const totalExecutionTimeMs = Date.now() - startTime;
    const failureState: ProviderFailureState = {
      category: lastError?.category || ErrorCategory.PROVIDER_FAILURE,
      message: lastError?.message || 'Provider request failed after exhausting retry policy',
      code: lastError?.code,
      retryable: false, // Not retryable after exhaustion
      providerCode: lastError?.providerCode,
      providerMessage: lastError?.providerMessage,
      context: {
        providerName: this.getProviderName(),
        attemptCount,
        totalExecutionTimeMs,
        timestamp: new Date(),
        correlationId: context.correlationId,
        lastStatusCode: lastError?.code ? parseInt(lastError.code, 10) : undefined,
        metadata: {
          sessionId: context.sessionId,
          userId: context.userId,
          requestTimestamp: context.requestTimestamp,
        },
      },
    };

    return {
      success: false,
      error: lastError,
      failureState,
    };
  }

  /**
   * Perform the actual HTTP request
   * 
   * Placeholder for HTTP client implementation.
   * Subclasses can override to use specific HTTP libraries.
   */
  protected async performHttpRequest(request: ProviderRequest): Promise<ProviderResponse> {
    // Placeholder implementation
    // In production, this would use fetch or axios:
    // const response = await fetch(request.endpoint, {
    //   method: request.method,
    //   headers: request.headers,
    //   body: request.body ? JSON.stringify(request.body) : undefined,
    // });
    
    throw new Error('HTTP request not yet implemented - override performHttpRequest in subclass');
  }

  // ============================================================================
  // Retry and Rate Limit Logic
  // ============================================================================

  /**
   * Get the retry policy for this adapter
   * 
   * Requirement 6.2: Provider-specific retry behaviors
   */
  getRetryPolicy(): RetryPolicy {
    return { ...this.retryPolicy };
  }

  /**
   * Check if a status code is retryable
   */
  private isRetryableStatusCode(statusCode: number): boolean {
    return this.retryPolicy.retryableStatusCodes.includes(statusCode);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attemptNumber: number): number {
    const delay = this.retryPolicy.initialDelayMs * 
                  Math.pow(this.retryPolicy.backoffMultiplier, attemptNumber);
    return Math.min(delay, this.retryPolicy.maxDelayMs);
  }

  /**
   * Extract retry-after header value in milliseconds
   */
  private extractRetryAfter(headers?: Record<string, string>): number | null {
    if (!headers) return null;

    const retryAfter = headers['retry-after'] || headers['Retry-After'];
    if (!retryAfter) return null;

    // Try parsing as seconds
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }

    // Try parsing as HTTP date
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }

    return null;
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Error Classification
  // ============================================================================

  /**
   * Classify HTTP error response
   */
  private classifyHttpError(statusCode: number | undefined, responseData: unknown): ProviderError {
    const message = this.extractErrorMessage(responseData);

    if (statusCode === 400 || statusCode === 422) {
      return {
        category: ErrorCategory.USER_INPUT_ERROR,
        message: message || 'Invalid request parameters',
        code: statusCode.toString(),
        retryable: false,
      };
    }

    if (statusCode === 401 || statusCode === 403) {
      return {
        category: ErrorCategory.PROVIDER_FAILURE,
        message: message || 'Authentication or authorization failed',
        code: statusCode.toString(),
        retryable: false,
      };
    }

    if (statusCode === 404) {
      return {
        category: ErrorCategory.PROVIDER_FAILURE,
        message: message || 'Resource not found',
        code: statusCode.toString(),
        retryable: false,
      };
    }

    if (statusCode === 429) {
      return {
        category: ErrorCategory.PROVIDER_FAILURE,
        message: message || 'Rate limit exceeded',
        code: statusCode.toString(),
        retryable: true,
      };
    }

    if (statusCode && statusCode >= 500) {
      return {
        category: ErrorCategory.PROVIDER_FAILURE,
        message: message || 'Provider server error',
        code: statusCode.toString(),
        retryable: true,
      };
    }

    return {
      category: ErrorCategory.PROVIDER_FAILURE,
      message: message || 'Unknown provider error',
      code: statusCode?.toString(),
      retryable: false,
    };
  }

  /**
   * Classify exception error
   */
  private classifyError(error: unknown): ProviderError {
    if (error instanceof Error) {
      const errorCode = (error as any).code;

      // Network errors
      if (this.retryPolicy.retryableErrorCodes.includes(errorCode)) {
        return {
          category: ErrorCategory.PROVIDER_FAILURE,
          message: error.message,
          code: errorCode,
          retryable: true,
        };
      }

      // Timeout errors
      if (error.message.toLowerCase().includes('timeout')) {
        return {
          category: ErrorCategory.PROVIDER_FAILURE,
          message: error.message,
          retryable: true,
        };
      }
    }

    return {
      category: ErrorCategory.INTERNAL_SYSTEM_ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
      retryable: false,
    };
  }

  /**
   * Create a provider error
   */
  protected createProviderError(
    category: ErrorCategory,
    message: string,
    originalError?: unknown,
    retryable: boolean = false
  ): ProviderError {
    return {
      category,
      message,
      code: originalError instanceof Error ? (originalError as any).code : undefined,
      retryable,
      providerMessage: originalError instanceof Error ? originalError.message : undefined,
    };
  }

  /**
   * Extract error message from response data
   */
  private extractErrorMessage(responseData: unknown): string | undefined {
    if (!responseData) return undefined;

    if (typeof responseData === 'string') {
      return responseData;
    }

    if (typeof responseData === 'object') {
      const data = responseData as any;
      return data.message || data.error || data.error_description;
    }

    return undefined;
  }
}
