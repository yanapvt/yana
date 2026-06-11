/**
 * MCPInterface - MCP Tool Interface Layer
 * Validates tool calls, routes to adapters, logs execution, handles retries
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import {
  ToolCallRequest,
  ToolCallResult,
  ToolCallError,
  CorrelationContext,
  ErrorCategory,
} from '../types/core.js';
import { ToolRegistry } from './ToolRegistry.js';
import { ToolRepository } from '../db/repositories/ToolRepository.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Provider adapter interface that all tool adapters must implement
 */
export interface ProviderAdapter {
  /**
   * Execute the tool with the given parameters
   * @param params - Normalized tool parameters
   * @param context - Correlation context for logging
   * @returns The result data from the provider
   */
  execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown>;

  /**
   * Get the provider name for logging
   */
  getProviderName(): string;
}

/**
 * Validation error details
 */
interface ValidationError {
  field: string;
  message: string;
}

// ============================================================================
// MCPInterface Class
// ============================================================================

export class MCPInterface {
  private toolRegistry: ToolRegistry;
  private toolRepository: ToolRepository;
  private adapters: Map<string, ProviderAdapter>;

  constructor(
    toolRegistry?: ToolRegistry,
    toolRepository?: ToolRepository,
    adapters?: Map<string, ProviderAdapter>
  ) {
    this.toolRegistry = toolRegistry || new ToolRegistry();
    this.toolRepository = toolRepository || new ToolRepository();
    this.adapters = adapters || new Map();
  }

  /**
   * Register a provider adapter for a specific adapter class
   * @param adapterClass - The adapter class name from tool definition
   * @param adapter - The adapter instance
   */
  registerAdapter(adapterClass: string, adapter: ProviderAdapter): void {
    this.adapters.set(adapterClass, adapter);
  }

  /**
   * Execute a tool call with validation, routing, logging, and retry logic
   * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
   *
   * @param toolCallRequest - The tool call request
   * @param correlationCtx - Correlation context for tracing
   * @returns ToolCallResult with success/failure state
   */
  async executeToolCall(
    toolCallRequest: ToolCallRequest,
    correlationCtx: CorrelationContext
  ): Promise<ToolCallResult> {
    const startTime = Date.now();
    const { tool: toolName, params, context } = toolCallRequest;

    // Step 1: Validate against registered contract (Requirement 5.1)
    const validationResult = await this.validateToolCall(toolName, params);
    if (!validationResult.valid) {
      // On validation failure: return structured error state, do not execute (Requirement 5.4)
      const error: ToolCallError = {
        category: ErrorCategory.SCHEMA_ERROR,
        message: `Tool call validation failed: ${validationResult.errors.join(', ')}`,
        retryable: false,
      };

      const result: ToolCallResult = {
        success: false,
        error,
        metadata: {
          toolName,
          executionTimeMs: Date.now() - startTime,
          attemptNumber: 1,
          timestamp: new Date(),
        },
      };

      // Log validation failure (Requirement 5.3)
      await this.logToolCall(toolCallRequest, correlationCtx, result, 1);

      return result;
    }

    // Step 2: Get tool definition and execution policy
    const toolDef = await this.toolRegistry.getTool(toolName);
    if (!toolDef) {
      // This should not happen if validation passed, so it's an internal error
      const error: ToolCallError = {
        category: ErrorCategory.INTERNAL_SYSTEM_ERROR,
        message: `Tool definition not found after validation: ${toolName}`,
        retryable: false,
      };

      const result: ToolCallResult = {
        success: false,
        error,
        metadata: {
          toolName,
          executionTimeMs: Date.now() - startTime,
          attemptNumber: 1,
          timestamp: new Date(),
        },
      };

      await this.logToolCall(toolCallRequest, correlationCtx, result, 1);
      return result;
    }

    const executionPolicy = toolDef.executionPolicy;

    // Step 3: Normalize input (Requirement 5.2)
    const normalizedParams = this.normalizeInput(params, toolDef);

    // Step 4: Execute with retry policy (Requirement 5.5)
    let lastError: ToolCallError | undefined;
    const maxAttempts = (executionPolicy.retryCount || 0) + 1;
    let finalAttempt = 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Route to correct adapter (Requirement 5.6)
        const result = await this.routeToAdapter(
          toolDef,
          normalizedParams,
          correlationCtx,
          attempt
        );

        // Success - log and return
        const successResult: ToolCallResult = {
          success: true,
          data: result,
          metadata: {
            toolName,
            executionTimeMs: Date.now() - startTime,
            attemptNumber: attempt,
            provider: toolDef.providerMapping.providerName,
            timestamp: new Date(),
          },
        };

        // Log successful call (Requirement 5.3)
        await this.logToolCall(toolCallRequest, correlationCtx, successResult, attempt);

        return successResult;
      } catch (error) {
        finalAttempt = attempt;
        // Determine if error is retryable
        const isRetryable = this.isRetryableError(error);
        const errorCategory = this.categorizeError(error);

        lastError = {
          category: errorCategory,
          message: error instanceof Error ? error.message : String(error),
          code: (error as any).code,
          retryable: isRetryable,
        };

        // If not retryable or last attempt, break
        if (!isRetryable || attempt === maxAttempts) {
          break;
        }

        // Apply retry delay with exponential backoff
        if (attempt < maxAttempts) {
          const delay = this.calculateRetryDelay(executionPolicy, attempt);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted - return final failure state (Requirement 5.5)
    const failureResult: ToolCallResult = {
      success: false,
      error: lastError,
      metadata: {
        toolName,
        executionTimeMs: Date.now() - startTime,
        attemptNumber: finalAttempt,
        provider: toolDef.providerMapping.providerName,
        timestamp: new Date(),
      },
    };

    // Log failure (Requirement 5.3)
    await this.logToolCall(toolCallRequest, correlationCtx, failureResult, finalAttempt);

    return failureResult;
  }

  /**
   * Validate tool call against registered contract
   * Requirement 5.1
   */
  private async validateToolCall(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if tool exists and is enabled
    const isAvailable = await this.toolRegistry.isToolAvailable(toolName);
    if (!isAvailable) {
      errors.push(`Tool '${toolName}' is not available or is disabled`);
      return { valid: false, errors };
    }

    // Get tool definition
    const toolDef = await this.toolRegistry.getTool(toolName);
    if (!toolDef) {
      errors.push(`Tool '${toolName}' not found in registry`);
      return { valid: false, errors };
    }

    // Validate required parameters
    const requiredParams = toolDef.parameters.required || [];
    for (const paramDef of requiredParams) {
      if (!(paramDef.name in params)) {
        errors.push(`Missing required parameter: ${paramDef.name}`);
      } else {
        // Validate parameter type
        const typeError = this.validateParameterType(
          paramDef.name,
          params[paramDef.name],
          paramDef.type
        );
        if (typeError) {
          errors.push(typeError);
        }
      }
    }

    // Validate optional parameters (if provided)
    const optionalParams = toolDef.parameters.optional || [];
    for (const paramDef of optionalParams) {
      if (paramDef.name in params) {
        const typeError = this.validateParameterType(
          paramDef.name,
          params[paramDef.name],
          paramDef.type
        );
        if (typeError) {
          errors.push(typeError);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate parameter type
   */
  private validateParameterType(
    name: string,
    value: unknown,
    expectedType: string
  ): string | null {
    const actualType = typeof value;

    switch (expectedType) {
      case 'string':
        if (actualType !== 'string') {
          return `Parameter '${name}' must be a string, got ${actualType}`;
        }
        break;
      case 'number':
        if (actualType !== 'number') {
          return `Parameter '${name}' must be a number, got ${actualType}`;
        }
        break;
      case 'boolean':
        if (actualType !== 'boolean') {
          return `Parameter '${name}' must be a boolean, got ${actualType}`;
        }
        break;
      case 'date':
        if (actualType !== 'string' && !(value instanceof Date)) {
          return `Parameter '${name}' must be a date string or Date object, got ${actualType}`;
        }
        if (typeof value === 'string' && isNaN(new Date(value).getTime())) {
          return `Parameter '${name}' must be a valid date string`;
        }
        if (value instanceof Date && isNaN(value.getTime())) {
          return `Parameter '${name}' must be a valid Date object`;
        }
        break;
      case 'object':
        if (actualType !== 'object' || value === null) {
          return `Parameter '${name}' must be an object, got ${actualType}`;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return `Parameter '${name}' must be an array`;
        }
        break;
    }

    return null;
  }

  /**
   * Normalize input parameters
   * Requirement 5.2
   */
  private normalizeInput(
    params: Record<string, unknown>,
    toolDef: any
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};

    // Copy all parameters
    for (const [key, value] of Object.entries(params)) {
      // Normalize dates to ISO strings
      if (value instanceof Date) {
        normalized[key] = value.toISOString();
      } else if (typeof value === 'string' && this.isDateString(value)) {
        // Ensure date strings are in ISO format
        normalized[key] = new Date(value).toISOString();
      } else {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  /**
   * Check if a string is a valid date string
   */
  private isDateString(value: string): boolean {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  /**
   * Route tool call to correct adapter
   * Requirement 5.6
   */
  private async routeToAdapter(
    toolDef: any,
    params: Record<string, unknown>,
    correlationCtx: CorrelationContext,
    attemptNumber: number
  ): Promise<unknown> {
    const adapterClass = toolDef.providerMapping.adapterClass;
    const adapter = this.adapters.get(adapterClass);

    if (!adapter) {
      throw new Error(
        `No adapter registered for adapter class: ${adapterClass}`
      );
    }

    // Execute through adapter
    return await adapter.execute(params, correlationCtx);
  }

  /**
   * Log tool call (success or failure)
   * Requirement 5.3
   */
  private async logToolCall(
    toolCallRequest: ToolCallRequest,
    correlationCtx: CorrelationContext,
    result: ToolCallResult,
    attemptNumber: number
  ): Promise<void> {
    try {
      await this.toolRepository.createRun({
        correlationId: correlationCtx.correlationId,
        sessionId: correlationCtx.sessionId,
        userId: correlationCtx.userId,
        toolName: toolCallRequest.tool,
        inputParams: toolCallRequest.params,
        outputData: result.success ? (result.data as Record<string, unknown>) : undefined,
        errorData: result.error ? (result.error as unknown as Record<string, unknown>) : undefined,
        executionStatus: result.success ? 'success' : 'failure',
        executionTimeMs: result.metadata.executionTimeMs,
        attemptNumber,
        providerName: result.metadata.provider,
      });
    } catch (error) {
      // Log error but don't fail the tool call
      console.error('Failed to log tool call:', error);
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    const explicitRetryable = (error as any)?.retryable;
    if (typeof explicitRetryable === 'boolean') {
      return explicitRetryable;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('non-retryable')) {
        return false;
      }

      // Network errors, timeouts, rate limits are retryable
      if (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('rate limit') ||
        message.includes('503') ||
        message.includes('502')
      ) {
        return true;
      }
    }

    // Check for specific error codes
    const errorCode = (error as any).code;
    if (errorCode === 'ETIMEDOUT' || errorCode === 'ECONNREFUSED') {
      return true;
    }

    return false;
  }

  /**
   * Categorize error into ErrorCategory
   */
  private categorizeError(error: unknown): ErrorCategory {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('validation') || message.includes('invalid')) {
        return ErrorCategory.SCHEMA_ERROR;
      }

      if (
        message.includes('provider') ||
        message.includes('network') ||
        message.includes('timeout')
      ) {
        return ErrorCategory.PROVIDER_FAILURE;
      }

      if (message.includes('payment')) {
        return ErrorCategory.PAYMENT_FAILURE;
      }

      if (message.includes('translation')) {
        return ErrorCategory.TRANSLATION_FAILURE;
      }
    }

    return ErrorCategory.INTERNAL_SYSTEM_ERROR;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(executionPolicy: any, attemptNumber: number): number {
    const baseDelay = executionPolicy.retryDelayMs ?? 1000;
    const backoffMultiplier = executionPolicy.retryBackoffMultiplier ?? 2;

    return baseDelay * Math.pow(backoffMultiplier, attemptNumber - 1);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
