/**
 * Property Test 8: LLM Output Validation Before Execution
 * 
 * Property Statement:
 * For any LLM decision output, the Orchestrator SHALL validate the output against 
 * schema and business rules before taking any action; invalid LLM outputs SHALL not 
 * result in tool execution, booking, or payment actions.
 * 
 * **Validates: Requirements 4.3, 4.4**
 * 
 * Requirements:
 * - 4.3: THE LLM SHALL not directly execute side effects, tool calls, bookings, or payments
 * - 4.4: THE Orchestrator SHALL validate all LLM decision outputs against schema and 
 *        business rules before proceeding with any action
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from '../../services/Orchestrator.js';
import { SchemaEngine } from '../../services/SchemaEngine.js';
import type { LLMDecisionOutput, SchemaDefinition } from '../../types/core.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a valid schema definition for testing
 */
function createTestSchema(requiredFields: string[], optionalFields: string[] = []): SchemaDefinition {
  const fields: Record<string, any> = {};
  
  for (const field of [...requiredFields, ...optionalFields]) {
    fields[field] = {
      name: field,
      type: 'text',
      ui: {
        promptKey: `test.${field}.prompt`,
        mode: 'text',
      },
      validation: {
        required: requiredFields.includes(field),
      },
    };
  }

  return {
    schemaName: 'test_schema',
    version: '1.0',
    requiredFields,
    optionalFields,
    fields,
  };
}

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary valid LLM decision outputs
 */
const validLLMDecisionArb = fc.record({
  intent: fc.constantFrom('search_hotels', 'book_hotel', 'search_transport', 'explore'),
  parameters: fc.dictionary(
    fc.constantFrom('location', 'checkin_date', 'checkout_date', 'guests', 'budget'),
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.integer({ min: 1, max: 10 }),
      fc.constant('2026-04-17')
    ),
    { minKeys: 0, maxKeys: 5 }
  ),
  missingFields: fc.array(
    fc.constantFrom('location', 'checkin_date', 'checkout_date', 'guests'),
    { maxLength: 4 }
  ),
  suggestedAction: fc.constantFrom('ask_missing', 'execute_tool', 'clarify', 'handoff') as fc.Arbitrary<'ask_missing' | 'execute_tool' | 'clarify' | 'handoff'>,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoning: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
});

/**
 * Generates arbitrary LLM decisions with invalid structure
 */
const invalidStructureLLMDecisionArb = fc.oneof(
  // Missing intent
  fc.record({
    intent: fc.constant(''),
    parameters: fc.constant({}),
    missingFields: fc.constant([]),
    suggestedAction: fc.constant('ask_missing') as fc.Arbitrary<'ask_missing'>,
    confidence: fc.constant(0.9),
  }),
  // Invalid parameters type (array instead of object)
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.constant([]) as any,
    missingFields: fc.constant([]),
    suggestedAction: fc.constant('ask_missing') as fc.Arbitrary<'ask_missing'>,
    confidence: fc.constant(0.9),
  }),
  // Invalid missingFields type (not array)
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.constant({}),
    missingFields: fc.constant('location') as any,
    suggestedAction: fc.constant('ask_missing') as fc.Arbitrary<'ask_missing'>,
    confidence: fc.constant(0.9),
  }),
  // Invalid suggestedAction
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.constant({}),
    missingFields: fc.constant([]),
    suggestedAction: fc.constant('invalid_action') as any,
    confidence: fc.constant(0.9),
  }),
  // Invalid confidence (out of range)
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.constant({}),
    missingFields: fc.constant([]),
    suggestedAction: fc.constant('ask_missing') as fc.Arbitrary<'ask_missing'>,
    confidence: fc.constant(1.5),
  })
);

/**
 * Generates arbitrary LLM decisions with low confidence
 */
const lowConfidenceLLMDecisionArb = fc.record({
  intent: fc.constantFrom('search_hotels', 'book_hotel'),
  parameters: fc.constant({}),
  missingFields: fc.constant([]),
  suggestedAction: fc.constant('ask_missing') as fc.Arbitrary<'ask_missing'>,
  confidence: fc.double({ min: 0, max: 0.84, noNaN: true }), // Below default threshold of 0.85
});

/**
 * Generates arbitrary LLM decisions that violate business rules
 */
const businessRuleViolationArb = fc.oneof(
  // Execute tool with missing fields
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.constant({}),
    missingFields: fc.constant(['location', 'checkin_date']),
    suggestedAction: fc.constant('execute_tool') as fc.Arbitrary<'execute_tool'>,
    confidence: fc.constant(0.95),
  }),
  // Ask missing with no missing fields
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.dictionary(
      fc.constantFrom('location', 'checkin_date'),
      fc.string({ minLength: 1 }),
      { minKeys: 2, maxKeys: 2 }
    ),
    missingFields: fc.constant([]),
    suggestedAction: fc.constant('ask_missing') as fc.Arbitrary<'ask_missing'>,
    confidence: fc.constant(0.95),
  }),
  // Parameters with null values
  fc.record({
    intent: fc.constant('search_hotels'),
    parameters: fc.constant({ location: null, checkin_date: undefined }),
    missingFields: fc.constant([]),
    suggestedAction: fc.constant('execute_tool') as fc.Arbitrary<'execute_tool'>,
    confidence: fc.constant(0.95),
  })
);

/**
 * Generates arbitrary collected fields
 */
const collectedFieldsArb = fc.dictionary(
  fc.constantFrom('location', 'checkin_date', 'checkout_date', 'guests'),
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 50 }),
    fc.integer({ min: 1, max: 10 })
  ),
  { minKeys: 0, maxKeys: 4 }
);

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 8: LLM Output Validation Before Execution', () => {
  let orchestrator: Orchestrator;
  let schemaEngine: SchemaEngine;

  beforeEach(() => {
    schemaEngine = new SchemaEngine();
    orchestrator = new Orchestrator({
      confidenceThreshold: 0.85,
      schemaEngine,
    });
  });

  // ==========================================================================
  // Core Property: Invalid outputs SHALL NOT result in execution
  // ==========================================================================

  it('should never allow execution when LLM output has invalid structure', () => {
    fc.assert(
      fc.property(invalidStructureLLMDecisionArb, (decision) => {
        // Given: An LLM decision with invalid structure
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: The decision SHALL NOT be allowed to proceed
        expect(result.shouldProceed).toBe(false);
        
        // And: Validation must indicate failure
        expect(result.validation.valid).toBe(false);
        
        // And: There must be at least one error
        expect(result.validation.errors.length).toBeGreaterThan(0);
        
        // And: A fallback action must be recommended
        expect(result.fallbackAction).toBeDefined();
        expect(['ui_narrowing', 'clarify', 'handoff']).toContain(result.fallbackAction);
      }),
      { numRuns: 100 }
    );
  });

  it('should never allow execution when confidence is below threshold', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb, (decision) => {
        // Given: An LLM decision with low confidence
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: The decision SHALL NOT be allowed to proceed
        expect(result.shouldProceed).toBe(false);
        
        // And: Validation must indicate failure
        expect(result.validation.valid).toBe(false);
        
        // And: There must be a confidence error
        const hasConfidenceError = result.validation.errors.some(
          (e) => e.type === 'confidence'
        );
        expect(hasConfidenceError).toBe(true);
        
        // And: Fallback action must be UI narrowing
        expect(result.fallbackAction).toBe('ui_narrowing');
        expect(result.fallbackReason).toContain('Confidence');
      }),
      { numRuns: 100 }
    );
  });

  it('should never allow execution when business rules are violated', () => {
    fc.assert(
      fc.property(businessRuleViolationArb, (decision) => {
        // Given: An LLM decision that violates business rules
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: The decision SHALL NOT be allowed to proceed (for errors)
        // Note: Some business rule violations are warnings, not errors
        const hasBusinessRuleError = result.validation.errors.some(
          (e) => e.type === 'business_rule' && e.severity === 'error'
        );
        
        if (hasBusinessRuleError) {
          expect(result.shouldProceed).toBe(false);
        }
        
        // And: There must be at least one business rule error or warning
        const hasBusinessRuleIssue = result.validation.errors.some(
          (e) => e.type === 'business_rule'
        );
        expect(hasBusinessRuleIssue).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should never allow execution when required schema fields are missing', () => {
    fc.assert(
      fc.property(
        validLLMDecisionArb,
        fc.array(fc.constantFrom('location', 'checkin_date', 'guests'), { minLength: 1, maxLength: 3 }),
        (decision, requiredFields) => {
          // Given: A schema with required fields
          const schema = createTestSchema(requiredFields);
          
          // And: An LLM decision that doesn't provide all required fields
          const incompleteDecision: LLMDecisionOutput = {
            ...decision,
            parameters: {}, // No parameters provided
            suggestedAction: 'execute_tool', // Trying to execute
          };

          // When: The Orchestrator validates the decision against the schema
          const result = orchestrator.validateLLMDecision(incompleteDecision, schema, {});

          // Then: The decision SHALL NOT be allowed to proceed
          expect(result.shouldProceed).toBe(false);
          
          // And: There must be schema or business rule errors
          const hasRelevantError = result.validation.errors.some(
            (e) => (e.type === 'schema' || e.type === 'business_rule') && e.severity === 'error'
          );
          expect(hasRelevantError).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Validation Always Occurs Before Execution
  // ==========================================================================

  it('should always perform validation before indicating execution readiness', () => {
    fc.assert(
      fc.property(validLLMDecisionArb, (decision) => {
        // Given: Any LLM decision output
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: A validation result must always be present
        expect(result.validation).toBeDefined();
        expect(result.validation).toHaveProperty('valid');
        expect(result.validation).toHaveProperty('errors');
        expect(Array.isArray(result.validation.errors)).toBe(true);
        
        // And: shouldProceed must be defined
        expect(result.shouldProceed).toBeDefined();
        expect(typeof result.shouldProceed).toBe('boolean');
        
        // And: If shouldProceed is true, validation must be valid
        if (result.shouldProceed) {
          expect(result.validation.valid).toBe(true);
          const hasErrors = result.validation.errors.some((e) => e.severity === 'error');
          expect(hasErrors).toBe(false);
        }
        
        // And: If validation has errors, shouldProceed must be false
        const hasErrors = result.validation.errors.some((e) => e.severity === 'error');
        if (hasErrors) {
          expect(result.shouldProceed).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should validate structure before checking other rules', () => {
    fc.assert(
      fc.property(invalidStructureLLMDecisionArb, (decision) => {
        // Given: An LLM decision with invalid structure
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: There must be structure errors
        const hasStructureError = result.validation.errors.some(
          (e) => e.type === 'structure'
        );
        expect(hasStructureError).toBe(true);
        
        // And: Execution must not be allowed
        expect(result.shouldProceed).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should validate confidence threshold early in the validation process', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb, (decision) => {
        // Given: An LLM decision with low confidence
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Confidence error must be present
        const confidenceError = result.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(confidenceError).toBeDefined();
        
        // And: Fallback must be triggered immediately
        expect(result.fallbackAction).toBe('ui_narrowing');
        expect(result.shouldProceed).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Schema Validation Integration
  // ==========================================================================

  it('should validate against schema when schema is provided', () => {
    fc.assert(
      fc.property(
        validLLMDecisionArb,
        fc.array(fc.constantFrom('location', 'checkin_date'), { minLength: 1, maxLength: 2 }),
        collectedFieldsArb,
        (decision, requiredFields, collectedFields) => {
          // Given: A schema with required fields
          const schema = createTestSchema(requiredFields);
          
          // When: The Orchestrator validates the decision with schema
          const result = orchestrator.validateLLMDecision(decision, schema, collectedFields);

          // Then: Validation must occur
          expect(result.validation).toBeDefined();
          
          // And: If required fields are missing, validation should fail or warn
          const allFields = { ...collectedFields, ...decision.parameters };
          const missingRequired = requiredFields.filter((field) => !allFields[field]);
          
          if (missingRequired.length > 0 && decision.suggestedAction === 'execute_tool') {
            // Should not proceed if trying to execute with missing fields
            expect(result.shouldProceed).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should merge collected fields with LLM parameters during schema validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          intent: fc.constant('search_hotels'),
          parameters: fc.constant({ checkin_date: '2026-04-17' }),
          missingFields: fc.constant([]),
          suggestedAction: fc.constant('execute_tool') as fc.Arbitrary<'execute_tool'>,
          confidence: fc.constant(0.95),
        }),
        (decision) => {
          // Given: A schema requiring location and checkin_date
          const schema = createTestSchema(['location', 'checkin_date']);
          
          // And: Location is already collected
          const collectedFields = { location: 'Galle' };
          
          // And: LLM provides checkin_date
          // (decision.parameters already has checkin_date)

          // When: The Orchestrator validates with both collected and LLM fields
          const result = orchestrator.validateLLMDecision(decision, schema, collectedFields);

          // Then: Validation should consider both sources
          // Since both required fields are present (location from collected, checkin_date from LLM)
          // The validation should not fail on missing fields
          const hasMissingFieldError = result.validation.errors.some(
            (e) => e.type === 'schema' && e.severity === 'error' && e.message.includes('required')
          );
          
          // Should not have missing field errors since we have both fields
          expect(hasMissingFieldError).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Business Rules Validation
  // ==========================================================================

  it('should reject execute_tool action when missing fields are present', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('location', 'checkin_date', 'guests'), { minLength: 1, maxLength: 3 }),
        (missingFields) => {
          // Given: An LLM decision with missing fields but suggesting execute_tool
          const decision: LLMDecisionOutput = {
            intent: 'search_hotels',
            parameters: {},
            missingFields,
            suggestedAction: 'execute_tool',
            confidence: 0.95,
          };

          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision);

          // Then: Execution must not be allowed
          expect(result.shouldProceed).toBe(false);
          
          // And: There must be a business rule error
          const hasBusinessRuleError = result.validation.errors.some(
            (e) => e.type === 'business_rule' && e.severity === 'error'
          );
          expect(hasBusinessRuleError).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should detect parameters with null or undefined values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('location', 'checkin_date', 'guests'),
        (fieldName) => {
          // Given: An LLM decision with null/undefined parameter values
          const decision: LLMDecisionOutput = {
            intent: 'search_hotels',
            parameters: { [fieldName]: null },
            missingFields: [],
            suggestedAction: 'ask_missing',
            confidence: 0.95,
          };

          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision);

          // Then: There should be a business rule warning about null values
          const hasNullValueWarning = result.validation.errors.some(
            (e) => e.type === 'business_rule' && e.message.includes('null or undefined')
          );
          expect(hasNullValueWarning).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Fallback Actions
  // ==========================================================================

  it('should always recommend a fallback action when validation fails', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          invalidStructureLLMDecisionArb,
          lowConfidenceLLMDecisionArb,
          businessRuleViolationArb
        ),
        (decision) => {
          // Given: An invalid LLM decision
          
          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision);

          // Then: If shouldProceed is false, a fallback must be recommended
          if (!result.shouldProceed) {
            expect(result.fallbackAction).toBeDefined();
            expect(['ui_narrowing', 'clarify', 'handoff']).toContain(result.fallbackAction);
            expect(result.fallbackReason).toBeDefined();
            expect(typeof result.fallbackReason).toBe('string');
            expect(result.fallbackReason!.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should recommend ui_narrowing for low confidence decisions', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb, (decision) => {
        // Given: An LLM decision with low confidence
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Fallback action must be ui_narrowing
        expect(result.fallbackAction).toBe('ui_narrowing');
        expect(result.fallbackReason).toContain('Confidence');
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Valid Decisions Should Proceed
  // ==========================================================================

  it('should allow execution for valid high-confidence decisions with complete fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          intent: fc.constantFrom('search_hotels', 'book_hotel'),
          parameters: fc.dictionary(
            fc.constantFrom('location', 'checkin_date'),
            fc.string({ minLength: 1 }),
            { minKeys: 2, maxKeys: 2 }
          ),
          missingFields: fc.constant([]),
          suggestedAction: fc.constant('execute_tool') as fc.Arbitrary<'execute_tool'>,
          confidence: fc.double({ min: 0.85, max: 1, noNaN: true }),
        }),
        (decision) => {
          // Given: A valid, high-confidence decision with complete fields
          
          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision);

          // Then: Execution should be allowed
          expect(result.shouldProceed).toBe(true);
          
          // And: Validation should be valid
          expect(result.validation.valid).toBe(true);
          
          // And: There should be no errors (warnings are OK)
          const hasErrors = result.validation.errors.some((e) => e.severity === 'error');
          expect(hasErrors).toBe(false);
          
          // And: No fallback action should be needed
          expect(result.fallbackAction).toBeUndefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Requirement 4.4 Validation
  // ==========================================================================

  it('should validate Requirement 4.4: validate all LLM outputs before any action', () => {
    fc.assert(
      fc.property(validLLMDecisionArb, (decision) => {
        // Given: Any LLM decision output
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Validation must always occur (Requirement 4.4)
        expect(result.validation).toBeDefined();
        expect(result.validation.valid).toBeDefined();
        expect(result.validation.errors).toBeDefined();
        
        // And: shouldProceed must be determined by validation results
        expect(result.shouldProceed).toBeDefined();
        
        // And: If validation has errors, execution must not proceed
        const hasErrors = result.validation.errors.some((e) => e.severity === 'error');
        if (hasErrors) {
          expect(result.shouldProceed).toBe(false);
        }
        
        // And: If execution is allowed, validation must be valid
        if (result.shouldProceed) {
          expect(result.validation.valid).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should validate Requirement 4.4: check against schema when provided', () => {
    fc.assert(
      fc.property(
        validLLMDecisionArb,
        fc.array(fc.constantFrom('location', 'checkin_date', 'guests'), { minLength: 1, maxLength: 3 }),
        (decision, requiredFields) => {
          // Given: A schema definition
          const schema = createTestSchema(requiredFields);
          
          // When: The Orchestrator validates with schema
          const result = orchestrator.validateLLMDecision(decision, schema);

          // Then: Schema validation must occur
          // This is evidenced by the validation result being influenced by schema
          expect(result.validation).toBeDefined();
          
          // And: If required fields are missing and action is execute_tool, must not proceed
          const hasAllRequired = requiredFields.every(
            (field) => decision.parameters[field] !== undefined && decision.parameters[field] !== null
          );
          
          if (!hasAllRequired && decision.suggestedAction === 'execute_tool') {
            expect(result.shouldProceed).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should validate Requirement 4.4: check business rules', () => {
    fc.assert(
      fc.property(businessRuleViolationArb, (decision) => {
        // Given: An LLM decision that violates business rules
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Business rule validation must occur
        const hasBusinessRuleIssue = result.validation.errors.some(
          (e) => e.type === 'business_rule'
        );
        expect(hasBusinessRuleIssue).toBe(true);
        
        // And: Errors must prevent execution
        const hasBusinessRuleError = result.validation.errors.some(
          (e) => e.type === 'business_rule' && e.severity === 'error'
        );
        if (hasBusinessRuleError) {
          expect(result.shouldProceed).toBe(false);
        }
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Determinism and Consistency
  // ==========================================================================

  it('should produce consistent validation results for the same input', () => {
    fc.assert(
      fc.property(validLLMDecisionArb, (decision) => {
        // Given: A specific LLM decision
        
        // When: The Orchestrator validates the same decision multiple times
        const result1 = orchestrator.validateLLMDecision(decision);
        const result2 = orchestrator.validateLLMDecision(decision);
        const result3 = orchestrator.validateLLMDecision(decision);

        // Then: All results must be consistent
        expect(result1.shouldProceed).toBe(result2.shouldProceed);
        expect(result2.shouldProceed).toBe(result3.shouldProceed);
        
        expect(result1.validation.valid).toBe(result2.validation.valid);
        expect(result2.validation.valid).toBe(result3.validation.valid);
        
        expect(result1.validation.errors.length).toBe(result2.validation.errors.length);
        expect(result2.validation.errors.length).toBe(result3.validation.errors.length);
      }),
      { numRuns: 50 }
    );
  });

  it('should never throw exceptions during validation', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (decision) => {
          // Given: Any input (even invalid/malformed)
          
          // When: The Orchestrator attempts to validate
          // Then: It should not throw exceptions
          expect(() => {
            orchestrator.validateLLMDecision(decision as any);
          }).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});
