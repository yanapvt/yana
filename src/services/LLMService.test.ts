/**
 * Unit tests for LLMService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMService, LLMServiceError, type ContextPackage } from './LLMService.js';

describe('LLMService', () => {
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

  describe('constructor', () => {
    it('should create an instance with provided config', () => {
      expect(service).toBeInstanceOf(LLMService);
    });

    it('should throw error if API key is missing', () => {
      expect(() => {
        new LLMService({
          provider: 'openai',
          apiKey: '',
          model: 'gpt-4',
        });
      }).toThrow(LLMServiceError);
    });
  });

  describe('decide - Decision Mode', () => {
    it('should return structured LLMDecisionOutput', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'I want to book a hotel in Galle',
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('parameters');
      expect(result).toHaveProperty('missingFields');
      expect(result).toHaveProperty('suggestedAction');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.intent).toBe('string');
      expect(typeof result.parameters).toBe('object');
      expect(Array.isArray(result.missingFields)).toBe(true);
      expect(['ask_missing', 'execute_tool', 'clarify', 'handoff']).toContain(result.suggestedAction);
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should handle context package with conversation history', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Yes, Galle',
        conversationHistory: [
          { role: 'assistant', content: 'Where would you like to stay?' },
          { role: 'user', content: 'I want to book a hotel' },
        ],
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should handle context package with session state', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Tomorrow',
        sessionState: {
          currentIntent: 'search_hotels',
          activeSchema: 'hotel_search',
          collectedFields: { location: 'Galle' },
          missingFields: ['checkin_date'],
        },
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('suggestedAction');
    });

    it('should handle context package with user profile', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Book a hotel',
        userProfile: {
          preferredLanguage: 'en',
          nationality: 'GB',
          recentActions: ['search_hotels'],
        },
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
    });

    it('should handle context package with available schemas', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'I need accommodation',
        availableSchemas: ['search_hotels', 'search_transport', 'search_excursions'],
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
    });

    it('should validate confidence is between 0 and 1', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Book hotel',
      };

      const result = await service.decide(contextPackage);

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should validate suggestedAction is one of allowed values', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Help me book',
      };

      const result = await service.decide(contextPackage);

      expect(['ask_missing', 'execute_tool', 'clarify', 'handoff']).toContain(result.suggestedAction);
    });

    it('should include optional reasoning field', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Find hotels',
      };

      const result = await service.decide(contextPackage);

      // Reasoning is optional, but if present should be a string
      if (result.reasoning) {
        expect(typeof result.reasoning).toBe('string');
      }
    });
  });

  describe('generateUIContent - UI-Support Mode', () => {
    it('should generate UI content string', async () => {
      const prompt = 'Generate a friendly greeting message';
      const userLanguage = 'en';

      const result = await service.generateUIContent(prompt, userLanguage);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle different languages', async () => {
      const prompt = 'Generate a confirmation message';
      const userLanguage = 'es';

      const result = await service.generateUIContent(prompt, userLanguage);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should default to English if language not specified', async () => {
      const prompt = 'Generate a welcome message';

      const result = await service.generateUIContent(prompt);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle various prompt types', async () => {
      const prompts = [
        'Generate a booking confirmation message',
        'Create a friendly error message',
        'Format a hotel result summary',
        'Write a payment reminder',
      ];

      for (const prompt of prompts) {
        const result = await service.generateUIContent(prompt, 'en');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('should return non-empty content', async () => {
      const prompt = 'Generate content';

      const result = await service.generateUIContent(prompt, 'en');

      expect(result.trim().length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw LLMServiceError with proper structure', async () => {
      const serviceWithInvalidProvider = new LLMService({
        provider: 'unsupported-provider',
        apiKey: 'test-key',
        model: 'test-model',
      });

      const contextPackage: ContextPackage = {
        userMessage: 'Test',
      };

      await expect(serviceWithInvalidProvider.decide(contextPackage)).rejects.toThrow(LLMServiceError);
    });

    it('should indicate if error is retryable', async () => {
      const serviceWithInvalidProvider = new LLMService({
        provider: 'unsupported-provider',
        apiKey: 'test-key',
        model: 'test-model',
      });

      const contextPackage: ContextPackage = {
        userMessage: 'Test',
      };

      try {
        await serviceWithInvalidProvider.decide(contextPackage);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(LLMServiceError);
        if (error instanceof LLMServiceError) {
          expect(typeof error.retryable).toBe('boolean');
          expect(error.code).toBeTruthy();
        }
      }
    });
  });

  describe('Requirements Validation', () => {
    it('should validate Requirement 4.1: LLM operates in decision mode producing structured output', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Book a hotel in Colombo',
      };

      const result = await service.decide(contextPackage);

      // Verify structured output contains all required fields
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('parameters');
      expect(result).toHaveProperty('missingFields');
      expect(result).toHaveProperty('suggestedAction');
      expect(result).toHaveProperty('confidence');
    });

    it('should validate Requirement 4.2: LLM operates in UI-support mode for content generation', async () => {
      const prompt = 'Generate a booking confirmation message';
      const userLanguage = 'en';

      const result = await service.generateUIContent(prompt, userLanguage);

      // Verify UI content is generated
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should validate Requirement 4.3: LLM does not directly execute side effects', () => {
      // The LLMService should not have methods for:
      // - Executing tool calls
      // - Creating bookings
      // - Processing payments
      // - Directly modifying state

      expect(service).not.toHaveProperty('executeToolCall');
      expect(service).not.toHaveProperty('createBooking');
      expect(service).not.toHaveProperty('processPayment');
      expect(service).not.toHaveProperty('updateState');

      // Only decision and UI generation methods should exist
      expect(service).toHaveProperty('decide');
      expect(service).toHaveProperty('generateUIContent');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty user message', async () => {
      const contextPackage: ContextPackage = {
        userMessage: '',
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('confidence');
    });

    it('should handle very long user messages', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'I want to book a hotel '.repeat(100),
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
    });

    it('should handle special characters in user message', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Book hotel in São Paulo! Cost: $100-$200 😊',
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
    });

    it('should handle empty context package fields', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Book hotel',
        conversationHistory: [],
        sessionState: {
          collectedFields: {},
          missingFields: [],
        },
        availableSchemas: [],
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
    });

    it('should handle undefined optional fields in context package', async () => {
      const contextPackage: ContextPackage = {
        userMessage: 'Book hotel',
        conversationHistory: undefined,
        userProfile: undefined,
        sessionState: undefined,
        availableSchemas: undefined,
      };

      const result = await service.decide(contextPackage);

      expect(result).toHaveProperty('intent');
    });
  });
});
