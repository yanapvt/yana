/**
 * Unit tests for Orchestrator LLM output validation
 * 
 * Tests Requirements 4.4 and 4.5:
 * - Validate LLM decision outputs against schema and business rules
 * - Enforce confidence threshold and fallback to UI-narrowing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from './Orchestrator.js';
import { SchemaEngine } from './SchemaEngine.js';
import type { LLMDecisionOutput, SchemaDefinition } from '../types/core.js';

describe('Orchestrator - LLM Output Validation', () => {
  let orchestrator: Orchestrator;
  let schemaEngine: SchemaEngine;

  beforeEach(() => {
    schemaEngine = new SchemaEngine();
    orchestrator = new Orchestrator({
      confidenceThreshold: 0.85,
      schemaEngine,
    });
  });

  describe('validateLLMDecision', () => {
    describe('Confidence Threshold Validation (Requirement 4.5)', () => {
      it('should reject decision when confidence is below threshold', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle' },
          missingFields: ['checkin_date'],
          suggestedAction: 'ask_missing',
          confidence: 0.70, // Below 0.85 threshold
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.fallbackAction).toBe('ui_narrowing');
        expect(result.fallbackReason).toContain('Confidence');
        expect(result.fallbackReason).toContain('below threshold');
        expect(result.validation.valid).toBe(false);
        expect(result.validation.errors).toHaveLength(1);
        expect(result.validation.errors[0].type).toBe('confidence');
      });

      it('should accept decision when confidence meets threshold', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: ['location', 'checkin_date'],
          suggestedAction: 'ask_missing',
          confidence: 0.85, // Exactly at threshold
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(true);
        expect(result.fallbackAction).toBeUndefined();
        expect(result.validation.valid).toBe(true);
      });

      it('should accept decision when confidence is above threshold', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: ['location', 'checkin_date'],
          suggestedAction: 'ask_missing',
          confidence: 0.95, // Above threshold
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(true);
        expect(result.validation.valid).toBe(true);
      });

      it('should use UI-narrowing fallback for low confidence', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: 0.50,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.fallbackAction).toBe('ui_narrowing');
        expect(result.fallbackReason).toMatch(/confidence.*below threshold/i);
      });
    });

    describe('Structure Validation', () => {
      it('should reject decision with missing intent', () => {
        const decision = {
          intent: '',
          parameters: {},
          missingFields: [],
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        } as LLMDecisionOutput;

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some((e) => e.field === 'intent')).toBe(true);
      });

      it('should reject decision with invalid parameters type', () => {
        const decision = {
          intent: 'search_hotels',
          parameters: null,
          missingFields: [],
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        } as unknown as LLMDecisionOutput;

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some((e) => e.field === 'parameters')).toBe(true);
      });

      it('should reject decision with invalid missingFields type', () => {
        const decision = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: 'not-an-array',
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        } as unknown as LLMDecisionOutput;

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some((e) => e.field === 'missingFields')).toBe(true);
      });

      it('should reject decision with invalid suggestedAction', () => {
        const decision = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: [],
          suggestedAction: 'invalid_action',
          confidence: 0.9,
        } as unknown as LLMDecisionOutput;

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some((e) => e.field === 'suggestedAction')).toBe(true);
      });

      it('should reject decision with confidence out of range', () => {
        const decision = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: [],
          suggestedAction: 'ask_missing',
          confidence: 1.5,
        } as LLMDecisionOutput;

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some((e) => e.field === 'confidence')).toBe(true);
      });

      it('should accept decision with valid structure', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle' },
          missingFields: ['checkin_date'],
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(true);
        expect(result.validation.valid).toBe(true);
      });
    });

    describe('Schema Validation (Requirement 4.4)', () => {
      const hotelSearchSchema: SchemaDefinition = {
        schemaName: 'search_hotels',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: ['checkout_date', 'guests'],
        fields: {
          location: {
            name: 'location',
            type: 'location_or_text',
            ui: {
              promptKey: 'hotel.location.prompt',
              mode: 'text',
            },
            validation: {
              required: true,
            },
          },
          checkin_date: {
            name: 'checkin_date',
            type: 'date',
            ui: {
              promptKey: 'hotel.checkin.prompt',
              mode: 'buttons',
            },
            validation: {
              required: true,
            },
          },
          guests: {
            name: 'guests',
            type: 'number',
            ui: {
              promptKey: 'hotel.guests.prompt',
              mode: 'text',
            },
            validation: {
              required: false,
              min: 1,
              max: 10,
            },
          },
        },
      };

      it('should validate decision against schema when all required fields present', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {
            location: 'Galle',
            checkin_date: '2026-04-17',
          },
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: 0.95,
        };

        const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

        expect(result.shouldProceed).toBe(true);
        expect(result.validation.valid).toBe(true);
      });

      it('should detect missing required fields in schema validation', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {
            location: 'Galle',
            // checkin_date is missing
          },
          missingFields: ['checkin_date'],
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

        // Should still proceed because suggestedAction is 'ask_missing'
        expect(result.shouldProceed).toBe(true);
        expect(result.validation.valid).toBe(true);
      });

      it('should warn when LLM misses identifying a required field', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {
            location: 'Galle',
            // checkin_date is missing
          },
          missingFields: [], // LLM didn't identify checkin_date as missing
          suggestedAction: 'execute_tool',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some(
          (e) => e.type === 'schema' && e.field === 'checkin_date' && e.severity === 'warning'
        )).toBe(true);
      });

      it('should validate field values against schema rules', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {
            location: 'Galle',
            checkin_date: '2026-04-17',
            guests: 15, // Exceeds max of 10
          },
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some(
          (e) => e.type === 'schema' && e.field === 'guests'
        )).toBe(true);
      });

      it('should merge collected fields with LLM parameters for validation', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {
            checkin_date: '2026-04-17',
          },
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: 0.9,
        };

        const collectedFields = {
          location: 'Galle',
        };

        const result = orchestrator.validateLLMDecision(
          decision,
          hotelSearchSchema,
          collectedFields
        );

        expect(result.shouldProceed).toBe(true);
        expect(result.validation.valid).toBe(true);
      });
    });

    describe('Business Rules Validation (Requirement 4.4)', () => {
      it('should reject execute_tool action when missing fields exist', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle' },
          missingFields: ['checkin_date'],
          suggestedAction: 'execute_tool', // Invalid: can't execute with missing fields
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.validation.errors.some(
          (e) => e.type === 'business_rule' && e.message.includes('missing fields')
        )).toBe(true);
      });

      it('should warn when ask_missing action has no missing fields', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle', checkin_date: '2026-04-17' },
          missingFields: [],
          suggestedAction: 'ask_missing', // Inconsistent: nothing to ask
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.validation.errors.some(
          (e) => e.type === 'business_rule' && e.severity === 'warning'
        )).toBe(true);
      });

      it('should warn about null or undefined parameter values', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {
            location: 'Galle',
            checkin_date: null,
          },
          missingFields: [],
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.validation.errors.some(
          (e) => e.type === 'business_rule' && e.field === 'checkin_date'
        )).toBe(true);
      });

      it('should accept valid business rule combinations', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: ['location', 'checkin_date'],
          suggestedAction: 'ask_missing',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(true);
        expect(result.validation.valid).toBe(true);
      });
    });

    describe('Fallback Actions', () => {
      it('should recommend ui_narrowing fallback for schema errors', () => {
        const schema: SchemaDefinition = {
          schemaName: 'search_hotels',
          version: '1.0',
          requiredFields: ['location'],
          optionalFields: [],
          fields: {
            location: {
              name: 'location',
              type: 'text',
              ui: { promptKey: 'location', mode: 'text' },
              validation: { required: true },
            },
          },
        };

        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: [],
          suggestedAction: 'execute_tool',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision, schema);

        expect(result.shouldProceed).toBe(false);
        expect(result.fallbackAction).toBe('ui_narrowing');
        expect(result.fallbackReason).toContain('Schema validation failed');
      });

      it('should recommend clarify fallback for business rule errors', () => {
        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: { location: 'Galle' },
          missingFields: ['checkin_date'],
          suggestedAction: 'execute_tool',
          confidence: 0.9,
        };

        const result = orchestrator.validateLLMDecision(decision);

        expect(result.shouldProceed).toBe(false);
        expect(result.fallbackAction).toBe('clarify');
        expect(result.fallbackReason).toContain('Business rule validation failed');
      });
    });

    describe('Configuration', () => {
      it('should allow getting confidence threshold', () => {
        const threshold = orchestrator.getConfidenceThreshold();
        expect(threshold).toBe(0.85);
      });

      it('should allow setting confidence threshold', () => {
        orchestrator.setConfidenceThreshold(0.75);
        expect(orchestrator.getConfidenceThreshold()).toBe(0.75);

        const decision: LLMDecisionOutput = {
          intent: 'search_hotels',
          parameters: {},
          missingFields: [],
          suggestedAction: 'ask_missing',
          confidence: 0.80, // Now above new threshold
        };

        const result = orchestrator.validateLLMDecision(decision);
        expect(result.shouldProceed).toBe(true);
      });

      it('should reject invalid confidence threshold values', () => {
        expect(() => orchestrator.setConfidenceThreshold(-0.1)).toThrow();
        expect(() => orchestrator.setConfidenceThreshold(1.5)).toThrow();
      });
    });
  });
});
