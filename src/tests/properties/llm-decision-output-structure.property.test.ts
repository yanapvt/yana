/**
 * Property Test 7: LLM Decision Output Structure
 * 
 * Property Statement:
 * For any user input processed in decision mode, the LLM output SHALL be a structured 
 * object containing intent, extracted parameters, identified missing fields, suggested 
 * next action, and confidence metadata.
 * 
 * **Validates: Requirements 4.1**
 * 
 * Requirements:
 * - 4.1: THE LLM SHALL operate in a decision mode that produces a structured output 
 *        including intent, extracted parameters, identified missing fields, suggested 
 *        next action, and confidence metadata
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { LLMService, type ContextPackage } from '../../services/LLMService.js';
import type { LLMDecisionOutput } from '../../types/core.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Validates that an object has the complete LLM decision output structure
 */
function validateLLMDecisionStructure(output: unknown): output is LLMDecisionOutput {
  if (!output || typeof output !== 'object') {
    return false;
  }

  const decision = output as Record<string, unknown>;

  // Check intent field
  if (typeof decision.intent !== 'string' || decision.intent.trim() === '') {
    return false;
  }

  // Check parameters field
  if (!decision.parameters || typeof decision.parameters !== 'object' || Array.isArray(decision.parameters)) {
    return false;
  }

  // Check missingFields field
  if (!Array.isArray(decision.missingFields)) {
    return false;
  }

  // Check suggestedAction field
  const validActions = ['ask_missing', 'execute_tool', 'clarify', 'handoff'];
  if (!validActions.includes(decision.suggestedAction as string)) {
    return false;
  }

  // Check confidence field
  if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 1) {
    return false;
  }

  // Check optional reasoning field (if present)
  if (decision.reasoning !== undefined && typeof decision.reasoning !== 'string') {
    return false;
  }

  return true;
}

/**
 * Extracts all required field names from a decision output
 */
function getRequiredFields(): string[] {
  return ['intent', 'parameters', 'missingFields', 'suggestedAction', 'confidence'];
}

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary user messages
 */
const userMessageArb = fc.oneof(
  // Simple booking requests
  fc.constantFrom(
    'I want to book a hotel',
    'Find me accommodation',
    'Search for hotels',
    'Book a room',
    'I need a place to stay'
  ),
  // Requests with location
  fc.record({
    action: fc.constantFrom('book', 'find', 'search for'),
    service: fc.constantFrom('hotel', 'accommodation', 'room'),
    location: fc.constantFrom('Galle', 'Colombo', 'Kandy', 'London', 'Paris'),
  }).map(({ action, service, location }) => `${action} ${service} in ${location}`),
  // Requests with dates
  fc.record({
    action: fc.constantFrom('book', 'find'),
    service: fc.constantFrom('hotel', 'room'),
    date: fc.constantFrom('tomorrow', 'next week', 'this weekend'),
  }).map(({ action, service, date }) => `${action} ${service} for ${date}`),
  // Complex requests
  fc.string({ minLength: 5, maxLength: 200 }),
  // Empty or minimal input
  fc.constantFrom('', 'help', 'hi', '?')
);

/**
 * Generates arbitrary conversation history
 */
const conversationHistoryArb = fc.array(
  fc.record({
    role: fc.constantFrom('user', 'assistant', 'system') as fc.Arbitrary<'user' | 'assistant' | 'system'>,
    content: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  { minLength: 0, maxLength: 10 }
);

/**
 * Generates arbitrary user profile data
 */
const userProfileArb = fc.record({
  preferredLanguage: fc.constantFrom('en', 'es', 'fr', 'de', 'si', 'ta'),
  nationality: fc.constantFrom('GB', 'US', 'FR', 'DE', 'LK', 'IN'),
  recentActions: fc.array(fc.constantFrom('search_hotels', 'book_hotel', 'search_transport'), { maxLength: 5 }),
});

/**
 * Generates arbitrary session state
 */
const sessionStateArb = fc.record({
  currentIntent: fc.option(fc.constantFrom('search_hotels', 'book_hotel', 'search_transport', 'explore'), { nil: undefined }),
  activeSchema: fc.option(fc.constantFrom('hotel_search', 'hotel_booking', 'transport_search'), { nil: undefined }),
  collectedFields: fc.dictionary(
    fc.constantFrom('location', 'checkin_date', 'checkout_date', 'guests'),
    fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
    { maxKeys: 4 }
  ),
  missingFields: fc.array(fc.constantFrom('location', 'checkin_date', 'checkout_date', 'guests'), { maxLength: 4 }),
});

/**
 * Generates arbitrary available schemas
 */
const availableSchemasArb = fc.array(
  fc.constantFrom('search_hotels', 'book_hotel', 'search_transport', 'search_excursions'),
  { minLength: 0, maxLength: 5 }
);

/**
 * Generates a complete context package
 */
const contextPackageArb = fc.record({
  userMessage: userMessageArb,
  conversationHistory: fc.option(conversationHistoryArb, { nil: undefined }),
  userProfile: fc.option(userProfileArb, { nil: undefined }),
  sessionState: fc.option(sessionStateArb, { nil: undefined }),
  availableSchemas: fc.option(availableSchemasArb, { nil: undefined }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 7: LLM Decision Output Structure', () => {
  let service: LLMService;

  beforeEach(() => {
    // Initialize with mock provider for testing
    service = new LLMService({
      provider: 'mock',
      apiKey: 'test-key',
      model: 'test-model',
      confidenceThreshold: 0.85,
    });
  });

  it('should always return a structured object with all required fields', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input processed in decision mode
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The output must be a structured object
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();

        // And: All required fields must be present
        const requiredFields = getRequiredFields();
        for (const field of requiredFields) {
          expect(result).toHaveProperty(field);
        }

        // And: The structure must be valid
        expect(validateLLMDecisionStructure(result)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should always include a non-empty string intent', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Intent must be a non-empty string
        expect(typeof result.intent).toBe('string');
        expect(result.intent.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should always include a parameters object (not array or null)', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Parameters must be an object
        expect(result.parameters).toBeDefined();
        expect(typeof result.parameters).toBe('object');
        expect(result.parameters).not.toBeNull();
        expect(Array.isArray(result.parameters)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should always include a missingFields array', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Missing fields must be an array
        expect(Array.isArray(result.missingFields)).toBe(true);
        
        // And: All elements must be strings
        for (const field of result.missingFields) {
          expect(typeof field).toBe('string');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should always include a valid suggestedAction', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Suggested action must be one of the valid values
        const validActions = ['ask_missing', 'execute_tool', 'clarify', 'handoff'];
        expect(validActions).toContain(result.suggestedAction);
      }),
      { numRuns: 100 }
    );
  });

  it('should always include a confidence value between 0 and 1', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Confidence must be a number between 0 and 1
        expect(typeof result.confidence).toBe('number');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(Number.isFinite(result.confidence)).toBe(true);
        expect(Number.isNaN(result.confidence)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should include optional reasoning field as string when present', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: If reasoning is present, it must be a string
        if (result.reasoning !== undefined) {
          expect(typeof result.reasoning).toBe('string');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should maintain structure consistency across multiple calls with same input', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: A specific user input
        
        // When: The LLM service processes the same input multiple times
        const result1 = await service.decide(contextPackage);
        const result2 = await service.decide(contextPackage);
        const result3 = await service.decide(contextPackage);

        // Then: All results must have the same structure
        expect(validateLLMDecisionStructure(result1)).toBe(true);
        expect(validateLLMDecisionStructure(result2)).toBe(true);
        expect(validateLLMDecisionStructure(result3)).toBe(true);

        // And: All results must have the same field types
        expect(typeof result1.intent).toBe(typeof result2.intent);
        expect(typeof result1.intent).toBe(typeof result3.intent);
        expect(Array.isArray(result1.missingFields)).toBe(Array.isArray(result2.missingFields));
        expect(Array.isArray(result1.missingFields)).toBe(Array.isArray(result3.missingFields));
        expect(typeof result1.confidence).toBe(typeof result2.confidence);
        expect(typeof result1.confidence).toBe(typeof result3.confidence);
      }),
      { numRuns: 50 }
    );
  });

  it('should handle empty user messages without breaking structure', () => {
    return fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        // Given: An empty user message
        const contextPackage: ContextPackage = {
          userMessage: '',
        };

        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The structure must still be valid
        expect(validateLLMDecisionStructure(result)).toBe(true);
        expect(result.intent).toBeDefined();
        expect(result.parameters).toBeDefined();
        expect(result.missingFields).toBeDefined();
        expect(result.suggestedAction).toBeDefined();
        expect(result.confidence).toBeDefined();
      }),
      { numRuns: 10 }
    );
  });

  it('should handle very long user messages without breaking structure', () => {
    return fc.assert(
      fc.asyncProperty(fc.string({ minLength: 500, maxLength: 2000 }), async (longMessage) => {
        // Given: A very long user message
        const contextPackage: ContextPackage = {
          userMessage: longMessage,
        };

        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The structure must still be valid
        expect(validateLLMDecisionStructure(result)).toBe(true);
      }),
      { numRuns: 20 }
    );
  });

  it('should handle special characters in user messages without breaking structure', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 100 }),
        async (message) => {
          // Given: A user message with special characters
          const specialMessage = `${message} 😊 $100-$200 São Paulo!`;
          const contextPackage: ContextPackage = {
            userMessage: specialMessage,
          };

          // When: The LLM service processes the input
          const result = await service.decide(contextPackage);

          // Then: The structure must still be valid
          expect(validateLLMDecisionStructure(result)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should handle context packages with all optional fields undefined', () => {
    return fc.assert(
      fc.asyncProperty(userMessageArb, async (userMessage) => {
        // Given: A context package with only the required userMessage field
        const contextPackage: ContextPackage = {
          userMessage,
          conversationHistory: undefined,
          userProfile: undefined,
          sessionState: undefined,
          availableSchemas: undefined,
        };

        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The structure must still be valid
        expect(validateLLMDecisionStructure(result)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should handle context packages with empty arrays and objects', () => {
    return fc.assert(
      fc.asyncProperty(userMessageArb, async (userMessage) => {
        // Given: A context package with empty arrays and objects
        const contextPackage: ContextPackage = {
          userMessage,
          conversationHistory: [],
          userProfile: {
            preferredLanguage: 'en',
            nationality: 'GB',
            recentActions: [],
          },
          sessionState: {
            collectedFields: {},
            missingFields: [],
          },
          availableSchemas: [],
        };

        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The structure must still be valid
        expect(validateLLMDecisionStructure(result)).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should never return null or undefined as the decision output', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The result must never be null or undefined
        expect(result).not.toBeNull();
        expect(result).not.toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('should never return primitive types as the decision output', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The result must be an object (not string, number, boolean, etc.)
        expect(typeof result).toBe('object');
        expect(Array.isArray(result)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('should ensure parameters object never contains functions', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Parameters should not contain function values
        for (const value of Object.values(result.parameters)) {
          expect(typeof value).not.toBe('function');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should ensure missingFields array contains only strings', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Every element in missingFields must be a string
        for (const field of result.missingFields) {
          expect(typeof field).toBe('string');
          expect(field).not.toBe('');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should ensure confidence is a valid finite number', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: Confidence must be a valid finite number
        expect(Number.isFinite(result.confidence)).toBe(true);
        expect(Number.isNaN(result.confidence)).toBe(false);
        expect(result.confidence).not.toBe(Infinity);
        expect(result.confidence).not.toBe(-Infinity);
      }),
      { numRuns: 100 }
    );
  });

  it('should validate Requirement 4.1: structured output with all required components', () => {
    return fc.assert(
      fc.asyncProperty(contextPackageArb, async (contextPackage) => {
        // Given: Any user input processed in decision mode
        
        // When: The LLM service processes the input
        const result = await service.decide(contextPackage);

        // Then: The output must contain all required components per Requirement 4.1
        
        // 1. Intent
        expect(result).toHaveProperty('intent');
        expect(typeof result.intent).toBe('string');
        expect(result.intent.trim().length).toBeGreaterThan(0);

        // 2. Extracted parameters
        expect(result).toHaveProperty('parameters');
        expect(typeof result.parameters).toBe('object');
        expect(result.parameters).not.toBeNull();
        expect(Array.isArray(result.parameters)).toBe(false);

        // 3. Identified missing fields
        expect(result).toHaveProperty('missingFields');
        expect(Array.isArray(result.missingFields)).toBe(true);

        // 4. Suggested next action
        expect(result).toHaveProperty('suggestedAction');
        expect(['ask_missing', 'execute_tool', 'clarify', 'handoff']).toContain(result.suggestedAction);

        // 5. Confidence metadata
        expect(result).toHaveProperty('confidence');
        expect(typeof result.confidence).toBe('number');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});
