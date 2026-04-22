/**
 * Property Test 9: Low-Confidence LLM Fallback
 * 
 * Property Statement:
 * For any LLM decision output with confidence below the configured threshold, 
 * the Orchestrator SHALL respond with UI-based narrowing rather than proceeding 
 * with execution.
 * 
 * **Validates: Requirements 4.5**
 * 
 * Requirements:
 * - 4.5: WHEN LLM output confidence is below the configured threshold, THE Orchestrator 
 *        SHALL fall back to UI-based narrowing rather than proceeding with low-confidence 
 *        execution
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
 * Generates arbitrary LLM decisions with confidence below a given threshold
 */
function lowConfidenceLLMDecisionArb(threshold: number): fc.Arbitrary<LLMDecisionOutput> {
  return fc.record({
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
    confidence: fc.double({ min: 0, max: threshold - 0.01, noNaN: true }),
    reasoning: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  });
}

/**
 * Generates arbitrary LLM decisions with confidence at or above a given threshold
 */
function highConfidenceLLMDecisionArb(threshold: number): fc.Arbitrary<LLMDecisionOutput> {
  return fc.record({
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
    confidence: fc.double({ min: threshold, max: 1, noNaN: true }),
    reasoning: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  });
}

/**
 * Generates arbitrary confidence thresholds
 */
const confidenceThresholdArb = fc.double({ min: 0.5, max: 0.95, noNaN: true });

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

describe('Property 9: Low-Confidence LLM Fallback', () => {
  let orchestrator: Orchestrator;
  let schemaEngine: SchemaEngine;
  const defaultThreshold = 0.85;

  beforeEach(() => {
    schemaEngine = new SchemaEngine();
    orchestrator = new Orchestrator({
      confidenceThreshold: defaultThreshold,
      schemaEngine,
    });
  });

  // ==========================================================================
  // Core Property: Low confidence SHALL trigger UI-based narrowing fallback
  // ==========================================================================

  it('should never allow execution when confidence is below threshold', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
        // Given: An LLM decision with confidence below the threshold
        expect(decision.confidence).toBeLessThan(defaultThreshold);
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: The decision SHALL NOT be allowed to proceed
        expect(result.shouldProceed).toBe(false);
        
        // And: Validation must indicate failure
        expect(result.validation.valid).toBe(false);
        
        // And: There must be a confidence error
        const hasConfidenceError = result.validation.errors.some(
          (e) => e.type === 'confidence' && e.severity === 'error'
        );
        expect(hasConfidenceError).toBe(true);
        
        // And: Fallback action must be UI narrowing (Requirement 4.5)
        expect(result.fallbackAction).toBe('ui_narrowing');
        
        // And: Fallback reason must mention confidence
        expect(result.fallbackReason).toBeDefined();
        expect(result.fallbackReason).toContain('Confidence');
        expect(result.fallbackReason).toContain('threshold');
      }),
      { numRuns: 100 }
    );
  });

  it('should always fall back to UI narrowing for low confidence, regardless of other factors', () => {
    fc.assert(
      fc.property(
        lowConfidenceLLMDecisionArb(defaultThreshold),
        fc.option(fc.constant(createTestSchema(['location', 'checkin_date'])), { nil: undefined }),
        collectedFieldsArb,
        (decision, schema, collectedFields) => {
          // Given: An LLM decision with low confidence
          // And: Potentially valid schema and collected fields
          
          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision, schema, collectedFields);

          // Then: Must fall back to UI narrowing regardless of other validation results
          expect(result.shouldProceed).toBe(false);
          expect(result.fallbackAction).toBe('ui_narrowing');
          
          // And: Confidence error must be present
          const confidenceError = result.validation.errors.find(
            (e) => e.type === 'confidence'
          );
          expect(confidenceError).toBeDefined();
          expect(confidenceError?.severity).toBe('error');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should trigger UI narrowing fallback even when suggested action is execute_tool', () => {
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
          confidence: fc.double({ min: 0, max: defaultThreshold - 0.01, noNaN: true }),
        }),
        (decision) => {
          // Given: An LLM decision suggesting execute_tool with complete fields
          // But: Confidence is below threshold
          expect(decision.suggestedAction).toBe('execute_tool');
          expect(decision.missingFields.length).toBe(0);
          expect(decision.confidence).toBeLessThan(defaultThreshold);
          
          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision);

          // Then: Must NOT proceed with execution despite suggested action
          expect(result.shouldProceed).toBe(false);
          
          // And: Must fall back to UI narrowing
          expect(result.fallbackAction).toBe('ui_narrowing');
          
          // And: Confidence must be the blocking factor
          const confidenceError = result.validation.errors.find(
            (e) => e.type === 'confidence'
          );
          expect(confidenceError).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Threshold Boundary Testing
  // ==========================================================================

  it('should respect the configured confidence threshold boundary', () => {
    fc.assert(
      fc.property(
        confidenceThresholdArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (threshold, confidence) => {
          // Given: An Orchestrator with a specific threshold
          const testOrchestrator = new Orchestrator({
            confidenceThreshold: threshold,
            schemaEngine,
          });
          
          // And: An LLM decision with a specific confidence
          const decision: LLMDecisionOutput = {
            intent: 'search_hotels',
            parameters: { location: 'Galle', checkin_date: '2026-04-17' },
            missingFields: [],
            suggestedAction: 'execute_tool',
            confidence,
          };

          // When: The Orchestrator validates the decision
          const result = testOrchestrator.validateLLMDecision(decision);

          // Then: Behavior must depend on threshold comparison
          if (confidence < threshold) {
            // Below threshold: must not proceed, must fall back to UI narrowing
            expect(result.shouldProceed).toBe(false);
            expect(result.fallbackAction).toBe('ui_narrowing');
            
            const confidenceError = result.validation.errors.find(
              (e) => e.type === 'confidence'
            );
            expect(confidenceError).toBeDefined();
          } else {
            // At or above threshold: confidence should not block execution
            const confidenceError = result.validation.errors.find(
              (e) => e.type === 'confidence'
            );
            expect(confidenceError).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should allow execution when confidence exactly equals threshold', () => {
    fc.assert(
      fc.property(confidenceThresholdArb, (threshold) => {
        // Given: An Orchestrator with a specific threshold
        const testOrchestrator = new Orchestrator({
          confidenceThreshold: threshold,
          schemaEngine,
        });
        
        // And: An LLM decision with confidence exactly at threshold
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle', checkin_date: '2026-04-17' },
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: threshold,
        };

        // When: The Orchestrator validates the decision
        const result = testOrchestrator.validateLLMDecision(decision);

        // Then: Confidence should not block execution
        const confidenceError = result.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(confidenceError).toBeUndefined();
        
        // And: If no other errors, should proceed
        const hasOtherErrors = result.validation.errors.some(
          (e) => e.type !== 'confidence' && e.severity === 'error'
        );
        if (!hasOtherErrors) {
          expect(result.shouldProceed).toBe(true);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('should block execution when confidence is even slightly below threshold', () => {
    fc.assert(
      fc.property(confidenceThresholdArb, (threshold) => {
        // Given: An Orchestrator with a specific threshold
        const testOrchestrator = new Orchestrator({
          confidenceThreshold: threshold,
          schemaEngine,
        });
        
        // And: An LLM decision with confidence just below threshold
        const epsilon = 0.001;
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle', checkin_date: '2026-04-17' },
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: Math.max(0, threshold - epsilon),
        };

        // When: The Orchestrator validates the decision
        const result = testOrchestrator.validateLLMDecision(decision);

        // Then: Must not proceed
        expect(result.shouldProceed).toBe(false);
        
        // And: Must fall back to UI narrowing
        expect(result.fallbackAction).toBe('ui_narrowing');
        
        // And: Must have confidence error
        const confidenceError = result.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(confidenceError).toBeDefined();
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // High Confidence Should Not Trigger Fallback
  // ==========================================================================

  it('should not trigger confidence fallback when confidence meets or exceeds threshold', () => {
    fc.assert(
      fc.property(highConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
        // Given: An LLM decision with confidence at or above threshold
        expect(decision.confidence).toBeGreaterThanOrEqual(defaultThreshold);
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Confidence should not be a blocking factor
        const confidenceError = result.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(confidenceError).toBeUndefined();
        
        // And: If fallback is triggered, it should not be due to confidence
        if (result.fallbackAction === 'ui_narrowing') {
          expect(result.fallbackReason).not.toContain('Confidence');
        }
      }),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Confidence Check Happens Early
  // ==========================================================================

  it('should check confidence before other validation steps', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
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
        
        // And: Fallback reason must reference confidence
        expect(result.fallbackReason).toContain('Confidence');
      }),
      { numRuns: 100 }
    );
  });

  it('should trigger confidence fallback even with valid structure and schema', () => {
    fc.assert(
      fc.property(
        fc.record({
          intent: fc.constant('search_hotels'),
          parameters: fc.constant({ location: 'Galle', checkin_date: '2026-04-17' }),
          missingFields: fc.constant([]),
          suggestedAction: fc.constant('execute_tool') as fc.Arbitrary<'execute_tool'>,
          confidence: fc.double({ min: 0, max: defaultThreshold - 0.01, noNaN: true }),
        }),
        (decision) => {
          // Given: A structurally valid decision with complete schema fields
          // But: Low confidence
          const schema = createTestSchema(['location', 'checkin_date']);
          const collectedFields = {};

          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision, schema, collectedFields);

          // Then: Must not proceed due to low confidence
          expect(result.shouldProceed).toBe(false);
          expect(result.fallbackAction).toBe('ui_narrowing');
          
          // And: Confidence error must be present
          const confidenceError = result.validation.errors.find(
            (e) => e.type === 'confidence'
          );
          expect(confidenceError).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Fallback Message Quality
  // ==========================================================================

  it('should provide informative fallback reason for low confidence', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
        // Given: An LLM decision with low confidence
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Fallback reason must be informative
        expect(result.fallbackReason).toBeDefined();
        expect(result.fallbackReason!.length).toBeGreaterThan(0);
        
        // And: Must mention both actual confidence and threshold
        expect(result.fallbackReason).toContain('Confidence');
        expect(result.fallbackReason).toContain('threshold');
        
        // And: Should include numeric values for debugging
        expect(result.fallbackReason).toMatch(/\d+\.\d+/); // Contains decimal number
      }),
      { numRuns: 50 }
    );
  });

  it('should include confidence value in error message', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
        // Given: An LLM decision with low confidence
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Confidence error message must include the actual confidence value
        const confidenceError = result.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(confidenceError).toBeDefined();
        expect(confidenceError!.message).toContain(decision.confidence.toFixed(2));
        expect(confidenceError!.message).toContain(defaultThreshold.toFixed(2));
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Dynamic Threshold Configuration
  // ==========================================================================

  it('should respect dynamically updated confidence threshold', () => {
    fc.assert(
      fc.property(
        confidenceThresholdArb,
        confidenceThresholdArb,
        (initialThreshold, newThreshold) => {
          // Given: An Orchestrator with an initial threshold
          const testOrchestrator = new Orchestrator({
            confidenceThreshold: initialThreshold,
            schemaEngine,
          });
          
          // When: The threshold is updated
          testOrchestrator.setConfidenceThreshold(newThreshold);
          
          // Then: The new threshold should be in effect
          expect(testOrchestrator.getConfidenceThreshold()).toBe(newThreshold);
          
          // And: Validation should use the new threshold
          const decision: LLMDecisionOutput = {
            intent: 'search_hotels',
            parameters: { location: 'Galle' },
            missingFields: [],
            suggestedAction: 'execute_tool',
            confidence: (initialThreshold + newThreshold) / 2, // Between the two thresholds
          };
          
          const result = testOrchestrator.validateLLMDecision(decision);
          
          // Behavior should depend on new threshold, not initial
          if (decision.confidence < newThreshold) {
            expect(result.shouldProceed).toBe(false);
            expect(result.fallbackAction).toBe('ui_narrowing');
          } else {
            const confidenceError = result.validation.errors.find(
              (e) => e.type === 'confidence'
            );
            expect(confidenceError).toBeUndefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Requirement 4.5 Validation
  // ==========================================================================

  it('should validate Requirement 4.5: fall back to UI-based narrowing for low confidence', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
        // Given: An LLM decision with confidence below threshold
        
        // When: The Orchestrator validates the decision
        const result = orchestrator.validateLLMDecision(decision);

        // Then: Must fall back to UI-based narrowing (Requirement 4.5)
        expect(result.fallbackAction).toBe('ui_narrowing');
        
        // And: Must not proceed with execution
        expect(result.shouldProceed).toBe(false);
        
        // And: Must have confidence error
        const confidenceError = result.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(confidenceError).toBeDefined();
        expect(confidenceError!.severity).toBe('error');
      }),
      { numRuns: 100 }
    );
  });

  it('should validate Requirement 4.5: never proceed with low-confidence execution', () => {
    fc.assert(
      fc.property(
        lowConfidenceLLMDecisionArb(defaultThreshold),
        fc.option(fc.constant(createTestSchema(['location', 'checkin_date'])), { nil: undefined }),
        collectedFieldsArb,
        (decision, schema, collectedFields) => {
          // Given: An LLM decision with low confidence
          // And: Any schema and collected fields
          
          // When: The Orchestrator validates the decision
          const result = orchestrator.validateLLMDecision(decision, schema, collectedFields);

          // Then: Must NEVER proceed with execution (Requirement 4.5)
          expect(result.shouldProceed).toBe(false);
          
          // And: Must respond with UI-based narrowing
          expect(result.fallbackAction).toBe('ui_narrowing');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  it('should handle confidence of 0 correctly', () => {
    // Given: An LLM decision with zero confidence
    const decision: LLMDecisionOutput = {
      intent: 'search_hotels',
      parameters: { location: 'Galle' },
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0,
    };

    // When: The Orchestrator validates the decision
    const result = orchestrator.validateLLMDecision(decision);

    // Then: Must not proceed
    expect(result.shouldProceed).toBe(false);
    expect(result.fallbackAction).toBe('ui_narrowing');
    
    // And: Must have confidence error
    const confidenceError = result.validation.errors.find(
      (e) => e.type === 'confidence'
    );
    expect(confidenceError).toBeDefined();
  });

  it('should handle confidence of 1 correctly', () => {
    // Given: An LLM decision with maximum confidence
    const decision: LLMDecisionOutput = {
      intent: 'search_hotels',
      parameters: { location: 'Galle', checkin_date: '2026-04-17' },
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 1.0,
    };

    // When: The Orchestrator validates the decision
    const result = orchestrator.validateLLMDecision(decision);

    // Then: Confidence should not block execution
    const confidenceError = result.validation.errors.find(
      (e) => e.type === 'confidence'
    );
    expect(confidenceError).toBeUndefined();
  });

  it('should handle very small confidence differences correctly', () => {
    fc.assert(
      fc.property(confidenceThresholdArb, (threshold) => {
        // Given: An Orchestrator with a specific threshold
        const testOrchestrator = new Orchestrator({
          confidenceThreshold: threshold,
          schemaEngine,
        });
        
        // And: Two decisions with very small confidence difference
        const epsilon = 0.0001;
        const belowDecision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle' },
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: Math.max(0, threshold - epsilon),
        };
        
        const aboveDecision: LLMDecisionOutput = {
          ...belowDecision,
          confidence: Math.min(1, threshold + epsilon),
        };

        // When: The Orchestrator validates both decisions
        const belowResult = testOrchestrator.validateLLMDecision(belowDecision);
        const aboveResult = testOrchestrator.validateLLMDecision(aboveDecision);

        // Then: Below threshold must not proceed
        expect(belowResult.shouldProceed).toBe(false);
        expect(belowResult.fallbackAction).toBe('ui_narrowing');
        
        // And: Above threshold should not have confidence error
        const aboveConfidenceError = aboveResult.validation.errors.find(
          (e) => e.type === 'confidence'
        );
        expect(aboveConfidenceError).toBeUndefined();
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Consistency and Determinism
  // ==========================================================================

  it('should produce consistent results for the same low-confidence decision', () => {
    fc.assert(
      fc.property(lowConfidenceLLMDecisionArb(defaultThreshold), (decision) => {
        // Given: A specific low-confidence LLM decision
        
        // When: The Orchestrator validates the same decision multiple times
        const result1 = orchestrator.validateLLMDecision(decision);
        const result2 = orchestrator.validateLLMDecision(decision);
        const result3 = orchestrator.validateLLMDecision(decision);

        // Then: All results must be consistent
        expect(result1.shouldProceed).toBe(false);
        expect(result2.shouldProceed).toBe(false);
        expect(result3.shouldProceed).toBe(false);
        
        expect(result1.fallbackAction).toBe('ui_narrowing');
        expect(result2.fallbackAction).toBe('ui_narrowing');
        expect(result3.fallbackAction).toBe('ui_narrowing');
        
        expect(result1.validation.valid).toBe(result2.validation.valid);
        expect(result2.validation.valid).toBe(result3.validation.valid);
      }),
      { numRuns: 50 }
    );
  });
});
