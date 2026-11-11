import { describe, expect, it } from 'vitest';
import { validateAndMapDecision } from './LLMDecisionInterpreter.js';

describe('LLMDecisionInterpreter validation', () => {
  it('keeps only fields approved for the selected workflow', () => {
    const result = validateAndMapDecision({
      intent: 'search_restaurants',
      parameters: {
        location: 'Kollupitiya',
        cuisine: 'Chinese',
        bookingStatus: 'confirmed',
        arbitraryTool: 'charge-card',
      },
      missingFields: ['guests', 'bookingStatus'],
      suggestedAction: 'execute_tool',
      confidence: 0.94,
    });

    expect(result.intent).toBe('restaurant_search');
    expect(result.entities).toEqual({ location: 'Kollupitiya', cuisine: 'Chinese' });
    expect(result.missingFields).toEqual(['guests']);
  });

  it('rejects an unknown intent instead of granting it an executable action', () => {
    const result = validateAndMapDecision({
      intent: 'issue_refund_and_confirm_booking',
      parameters: { bookingStatus: 'confirmed' },
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.99,
    });

    expect(result.intent).toBe('unclear');
    expect(result.role).toBe('unclear');
    expect(result.entities).toEqual({});
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('maps the versioned conversational contract without granting arbitrary actions', () => {
    const result = validateAndMapDecision({
      contractVersion: '2.0',
      responseText: 'Would you like a restaurant, an activity, or somewhere to stay?',
      intent: 'general_inquiry',
      intentConfidence: 0.88,
      ambiguity: { isAmbiguous: false, alternatives: [] },
      clarificationRequired: false,
      parameters: {},
      fieldUpdates: {},
      missingFields: [],
      taskTransition: 'none',
      recommendedSchema: 'general_inquiry',
      uiRecommendation: { mode: 'chat_reply', schemaId: 'general_inquiry' },
      proposedAction: { name: 'none', arguments: {} },
      unresolvedQuestions: [],
      suggestedAction: 'clarify',
      confidence: 0.88,
    });

    expect(result).toMatchObject({
      role: 'question_or_faq',
      intent: 'general_inquiry',
      responseText: 'Would you like a restaurant, an activity, or somewhere to stay?',
      recommendedSchema: 'general_inquiry',
      proposedAction: { name: 'none', arguments: {} },
    });
  });

  it('requires a concrete question for an ambiguous proposal', () => {
    expect(() => validateAndMapDecision({
      intent: 'general_inquiry', parameters: {}, missingFields: [],
      ambiguity: { isAmbiguous: true, alternatives: ['search_restaurants', 'search_excursions'] },
      clarificationRequired: true, suggestedAction: 'clarify', confidence: 0.6,
    })).toThrow();
  });

  it('rejects unregistered schema and executable action names', () => {
    expect(() => validateAndMapDecision({
      intent: 'search_hotels', parameters: {}, missingFields: [],
      recommendedSchema: 'charge_credit_card',
      proposedAction: { name: 'delete_database' as never, arguments: {} },
      suggestedAction: 'execute_tool', confidence: 0.99,
    })).toThrow();
  });

  it('rejects arbitrary tool arguments even when the proposal action is allowlisted', () => {
    expect(() => validateAndMapDecision({
      intent: 'search_hotels', parameters: {}, missingFields: [],
      proposedAction: { name: 'search', arguments: { tool: 'charge_card' } as never },
      suggestedAction: 'execute_tool', confidence: 0.99,
    })).toThrow();
  });

  it('rejects conflicting candidate field updates', () => {
    expect(() => validateAndMapDecision({
      intent: 'search_restaurants', parameters: { location: 'Galle' },
      fieldUpdates: { location: 'Kandy' }, missingFields: [],
      suggestedAction: 'execute_tool', confidence: 0.95,
    })).toThrow();
  });
});
