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
});
