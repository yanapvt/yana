/**
 * Orchestrator - Core decision and state transition coordinator
 * 
 * Responsibilities:
 * - Validate LLM decision outputs against schema and business rules
 * - Enforce confidence thresholds and fallback to UI-narrowing
 * - Coordinate state transitions and next actions
 * - Maintain separation between LLM recommendations and execution
 * 
 * Requirements: 4.4, 4.5
 */

import type { LLMDecisionOutput, SchemaDefinition } from '../types/core.js';
import { SchemaEngine, type CollectedFields } from './SchemaEngine.js';
import { env } from '../config/environment.js';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  type: 'schema' | 'business_rule' | 'confidence' | 'structure';
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface OrchestratorConfig {
  confidenceThreshold: number;
  schemaEngine: SchemaEngine;
}

export interface ValidatedDecision {
  decision: LLMDecisionOutput;
  validation: ValidationResult;
  shouldProceed: boolean;
  fallbackAction?: 'ui_narrowing' | 'clarify' | 'handoff';
  fallbackReason?: string;
}

// ============================================================================
// Orchestrator Class
// ============================================================================

export class Orchestrator {
  private config: OrchestratorConfig;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = {
      confidenceThreshold: config?.confidenceThreshold ?? env.llm.confidenceThreshold,
      schemaEngine: config?.schemaEngine ?? new SchemaEngine(),
    };
  }

  /**
   * Validate LLM decision output against schema and business rules
   * 
   * This is the critical validation gate that ensures:
   * 1. LLM output has valid structure
   * 2. Confidence meets threshold requirements
   * 3. Parameters match schema requirements
   * 4. Business rules are satisfied
   * 
   * If validation fails or confidence is too low, the system falls back
   * to UI-based narrowing rather than proceeding with execution.
   * 
   * Validates: Requirements 4.4, 4.5
   * 
   * @param decision - LLM decision output to validate
   * @param schema - Schema definition for the detected intent (if applicable)
   * @param collectedFields - Fields already collected in the session
   * @returns Validated decision with proceed/fallback recommendation
   */
  validateLLMDecision(
    decision: LLMDecisionOutput,
    schema?: SchemaDefinition,
    collectedFields?: CollectedFields
  ): ValidatedDecision {
    const errors: ValidationError[] = [];

    // Step 1: Validate decision structure
    const structureErrors = this.validateStructure(decision);
    errors.push(...structureErrors);

    // If there are structure errors, return early - don't proceed with further validation
    const hasStructureErrors = structureErrors.some((e) => e.severity === 'error');
    if (hasStructureErrors) {
      return {
        decision,
        validation: {
          valid: false,
          errors,
        },
        shouldProceed: false,
        fallbackAction: 'ui_narrowing',
        fallbackReason: 'Invalid decision structure',
      };
    }

    // Step 2: Validate confidence threshold (Requirement 4.5)
    const confidenceError = this.validateConfidence(decision);
    if (confidenceError) {
      errors.push(confidenceError);
    }

    // Step 3: Validate against schema if provided (Requirement 4.4)
    if (schema) {
      const schemaErrors = this.validateAgainstSchema(decision, schema, collectedFields);
      errors.push(...schemaErrors);
    }

    // Step 4: Validate business rules (Requirement 4.4)
    const businessRuleErrors = this.validateBusinessRules(decision);
    errors.push(...businessRuleErrors);

    // Determine if we should proceed
    const hasErrors = errors.some((e) => e.severity === 'error');
    const shouldProceed = !hasErrors;

    // Determine fallback action if we shouldn't proceed
    let fallbackAction: 'ui_narrowing' | 'clarify' | 'handoff' | undefined;
    let fallbackReason: string | undefined;

    if (!shouldProceed) {
      // Choose fallback based on error types
      const hasConfidenceErrors = errors.some((e) => e.type === 'confidence');
      const hasSchemaErrors = errors.some((e) => e.type === 'schema');
      const hasBusinessRuleErrors = errors.some((e) => e.type === 'business_rule');

      if (hasConfidenceErrors) {
        fallbackAction = 'ui_narrowing';
        fallbackReason = `Confidence ${decision.confidence.toFixed(2)} below threshold ${this.config.confidenceThreshold.toFixed(2)}`;
      } else if (hasSchemaErrors) {
        fallbackAction = 'ui_narrowing';
        fallbackReason = 'Schema validation failed - collecting fields via UI';
      } else if (hasBusinessRuleErrors) {
        fallbackAction = 'clarify';
        fallbackReason = 'Business rule validation failed - requesting clarification';
      } else {
        fallbackAction = 'ui_narrowing';
        fallbackReason = 'Validation failed - falling back to UI narrowing';
      }
    }

    return {
      decision,
      validation: {
        valid: !hasErrors,
        errors,
      },
      shouldProceed,
      fallbackAction,
      fallbackReason,
    };
  }

  /**
   * Check if confidence meets the configured threshold
   * 
   * Validates: Requirement 4.5
   */
  private validateConfidence(decision: LLMDecisionOutput): ValidationError | null {
    if (decision.confidence < this.config.confidenceThreshold) {
      return {
        type: 'confidence',
        message: `Confidence ${decision.confidence.toFixed(2)} is below threshold ${this.config.confidenceThreshold.toFixed(2)}`,
        severity: 'error',
      };
    }
    return null;
  }

  /**
   * Validate the structure of the LLM decision output
   * 
   * Ensures all required fields are present and have valid types
   */
  private validateStructure(decision: LLMDecisionOutput): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      return [{
        type: 'structure',
        message: 'Decision must be an object',
        severity: 'error',
      }];
    }

    // Validate intent
    if (!decision.intent || typeof decision.intent !== 'string' || decision.intent.trim() === '') {
      errors.push({
        type: 'structure',
        field: 'intent',
        message: 'Intent must be a non-empty string',
        severity: 'error',
      });
    }

    // Validate parameters
    if (!decision.parameters || typeof decision.parameters !== 'object' || Array.isArray(decision.parameters)) {
      errors.push({
        type: 'structure',
        field: 'parameters',
        message: 'Parameters must be an object',
        severity: 'error',
      });
    }

    // Validate missingFields
    if (!Array.isArray(decision.missingFields)) {
      errors.push({
        type: 'structure',
        field: 'missingFields',
        message: 'Missing fields must be an array',
        severity: 'error',
      });
    }

    // Validate suggestedAction
    const validActions = ['ask_missing', 'execute_tool', 'clarify', 'handoff'];
    if (!validActions.includes(decision.suggestedAction)) {
      errors.push({
        type: 'structure',
        field: 'suggestedAction',
        message: `Suggested action must be one of: ${validActions.join(', ')}`,
        severity: 'error',
      });
    }

    // Validate confidence
    if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 1) {
      errors.push({
        type: 'structure',
        field: 'confidence',
        message: 'Confidence must be a number between 0 and 1',
        severity: 'error',
      });
    }

    return errors;
  }

  /**
   * Validate LLM decision against schema requirements
   * 
   * Validates: Requirement 4.4
   */
  private validateAgainstSchema(
    decision: LLMDecisionOutput,
    schema: SchemaDefinition,
    collectedFields?: CollectedFields
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Merge collected fields with LLM-extracted parameters
    const allFields: CollectedFields = {
      ...(collectedFields || {}),
      ...decision.parameters,
    };

    // Use SchemaEngine to validate fields
    const schemaValidation = this.config.schemaEngine.validateFields(schema, allFields);

    if (!schemaValidation.valid) {
      for (const fieldError of schemaValidation.errors) {
        // If the suggested action is 'ask_missing', missing fields are expected
        // and should not block execution - downgrade to warning
        const isMissingFieldError = fieldError.message.includes('required') || fieldError.message.includes('missing');
        const severity = (decision.suggestedAction === 'ask_missing' && isMissingFieldError) 
          ? 'warning' 
          : 'error';
        
        errors.push({
          type: 'schema',
          field: fieldError.fieldName,
          message: fieldError.message,
          severity,
        });
      }
    }

    // Check if LLM correctly identified missing fields
    const actualMissingFields = this.config.schemaEngine.getMissingFields(schema, allFields);
    const llmMissingFields = decision.missingFields;

    // Warn if LLM missed some required fields
    for (const field of actualMissingFields) {
      if (!llmMissingFields.includes(field)) {
        errors.push({
          type: 'schema',
          field,
          message: `LLM did not identify missing required field: ${field}`,
          severity: 'warning',
        });
      }
    }

    // Warn if LLM identified fields that aren't actually missing
    for (const field of llmMissingFields) {
      if (!actualMissingFields.includes(field)) {
        errors.push({
          type: 'schema',
          field,
          message: `LLM incorrectly identified field as missing: ${field}`,
          severity: 'warning',
        });
      }
    }

    return errors;
  }

  /**
   * Validate business rules
   * 
   * Business rules include:
   * - Suggested action must be consistent with missing fields
   * - Parameters must not contain invalid values
   * - Intent must be actionable
   * 
   * Validates: Requirement 4.4
   */
  private validateBusinessRules(decision: LLMDecisionOutput): ValidationError[] {
    const errors: ValidationError[] = [];

    // Rule 1: If there are missing fields, suggested action should be 'ask_missing'
    if (decision.missingFields.length > 0 && decision.suggestedAction === 'execute_tool') {
      errors.push({
        type: 'business_rule',
        message: `Cannot execute tool with ${decision.missingFields.length} missing fields`,
        severity: 'error',
      });
    }

    // Rule 2: If suggested action is 'execute_tool', there should be no missing fields
    if (decision.suggestedAction === 'execute_tool' && decision.missingFields.length > 0) {
      errors.push({
        type: 'business_rule',
        message: 'Suggested action is execute_tool but missing fields are present',
        severity: 'error',
      });
    }

    // Rule 3: If suggested action is 'ask_missing', there should be missing fields
    if (decision.suggestedAction === 'ask_missing' && decision.missingFields.length === 0) {
      errors.push({
        type: 'business_rule',
        message: 'Suggested action is ask_missing but no missing fields identified',
        severity: 'warning',
      });
    }

    // Rule 4: Parameters should not contain null or undefined values
    for (const [key, value] of Object.entries(decision.parameters)) {
      if (value === null || value === undefined) {
        errors.push({
          type: 'business_rule',
          field: key,
          message: `Parameter '${key}' has null or undefined value`,
          severity: 'warning',
        });
      }
    }

    return errors;
  }

  /**
   * Get the configured confidence threshold
   */
  getConfidenceThreshold(): number {
    return this.config.confidenceThreshold;
  }

  /**
   * Update the confidence threshold
   */
  setConfidenceThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Confidence threshold must be between 0 and 1');
    }
    this.config.confidenceThreshold = threshold;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let orchestratorInstance: Orchestrator | null = null;

/**
 * Gets the singleton Orchestrator instance
 */
export function getOrchestrator(): Orchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator();
  }
  return orchestratorInstance;
}

/**
 * Initializes the Orchestrator with custom configuration
 */
export function initOrchestrator(config?: Partial<OrchestratorConfig>): Orchestrator {
  orchestratorInstance = new Orchestrator(config);
  return orchestratorInstance;
}
