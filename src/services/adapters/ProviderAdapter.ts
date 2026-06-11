/**
 * ProviderAdapter - Interface for provider-specific adapters
 * 
 * Defines the contract that all provider adapters must implement.
 * Adapters are replaceable without changing MCPInterface or Orchestrator.
 * 
 * Requirements: 6.2, 6.3, 6.4, 6.5
 */

import { CorrelationContext, ProviderFailureState } from '../../types/core.js';
import { RetryPolicy } from './NangoAdapter.js';

// ============================================================================
// ProviderAdapter Interface
// ============================================================================

/**
 * Provider adapter interface that all tool adapters must implement
 * 
 * This interface defines the contract for provider-specific adapters.
 * Adapters can be implemented with or without Nango, supporting both
 * Nango-based integrations and direct provider integrations.
 * 
 * Requirements:
 * - 6.2: Handle provider-specific normalization, retries, rate limits
 * - 6.3: No business logic that belongs in Orchestrator/Schema_Engine
 * - 6.4: Support direct provider integration without Nango
 * - 6.5: Replaceable without changing Orchestrator or Schema_Engine
 */
export interface ProviderAdapter {
  /**
   * Execute the tool with the given parameters
   * 
   * This is the main entry point for tool execution. The adapter receives
   * normalized parameters and must:
   * 1. Transform parameters to provider-specific format
   * 2. Execute the provider API call
   * 3. Normalize the response to internal format
   * 4. Handle errors and return structured results
   * 
   * @param params - Normalized tool parameters
   * @param context - Correlation context for logging and tracing
   * @returns The normalized result data from the provider
   * @throws Error if execution fails after retries
   */
  execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown>;

  /**
   * Normalize provider-specific response to internal format
   * 
   * Converts the raw provider response into the expected internal data
   * structure. This ensures that the rest of the system works with
   * consistent data formats regardless of the provider.
   * 
   * Requirement 6.2: Handle provider-specific normalization
   * 
   * @param rawResponse - Raw response from the provider
   * @returns Normalized response in internal format
   */
  normalizeResponse(rawResponse: unknown): unknown;

  /**
   * Get the retry policy for this adapter
   * 
   * Returns the retry configuration including max retries, delays,
   * backoff multipliers, and retryable error conditions.
   * 
   * Requirement 6.2: Provider-specific retry behaviors
   * 
   * @returns Retry policy configuration
   */
  getRetryPolicy(): RetryPolicy;

  /**
   * Get the provider name for logging and identification
   * 
   * @returns Provider name (e.g., "booking.com", "stripe", "twilio")
   */
  getProviderName(): string;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Provider adapter execution result
 * 
 * Wraps the result of a provider adapter execution with metadata
 * about the execution (timing, attempts, etc.)
 * 
 * Requirements: 6.6, 13.2
 */
export interface ProviderAdapterResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ProviderAdapterError;
  failureState?: ProviderFailureState;
  metadata: {
    providerName: string;
    executionTimeMs: number;
    attemptCount: number;
    timestamp: Date;
  };
}

/**
 * Provider adapter error
 * 
 * Structured error information from provider adapter execution
 */
export interface ProviderAdapterError {
  message: string;
  code?: string;
  retryable: boolean;
  providerCode?: string;
  providerMessage?: string;
}

// ============================================================================
// Base Provider Adapter (for direct integrations without Nango)
// ============================================================================

/**
 * Base class for direct provider integrations (without Nango)
 * 
 * Provides common functionality for adapters that integrate directly
 * with provider APIs without using Nango for credential management.
 * 
 * Requirement 6.4: Support direct provider integration without Nango
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  protected retryPolicy: RetryPolicy;

  constructor(retryPolicy?: Partial<RetryPolicy>) {
    this.retryPolicy = {
      maxRetries: retryPolicy?.maxRetries ?? 3,
      initialDelayMs: retryPolicy?.initialDelayMs ?? 1000,
      maxDelayMs: retryPolicy?.maxDelayMs ?? 10000,
      backoffMultiplier: retryPolicy?.backoffMultiplier ?? 2,
      retryableStatusCodes: retryPolicy?.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504],
      retryableErrorCodes: retryPolicy?.retryableErrorCodes ?? ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'],
    };
  }

  /**
   * Execute the tool with the given parameters
   * Must be implemented by subclasses
   */
  abstract execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown>;

  /**
   * Normalize provider-specific response to internal format
   * Must be implemented by subclasses
   */
  abstract normalizeResponse(rawResponse: unknown): unknown;

  /**
   * Get the provider name for logging and identification
   * Must be implemented by subclasses
   */
  abstract getProviderName(): string;

  /**
   * Get the retry policy for this adapter
   */
  getRetryPolicy(): RetryPolicy {
    return { ...this.retryPolicy };
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay
   */
  protected calculateBackoffDelay(attemptNumber: number): number {
    const delay = this.retryPolicy.initialDelayMs * 
                  Math.pow(this.retryPolicy.backoffMultiplier, attemptNumber);
    return Math.min(delay, this.retryPolicy.maxDelayMs);
  }
}
