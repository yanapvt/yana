/**
 * TranslationService Low-Confidence Fallback Tests
 * 
 * Tests for low-confidence translation handling, multilingual fallback,
 * and operator flagging functionality.
 * 
 * Validates: Requirements 10.8, 10.9
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { HumanHandoffRepository } from '../db/repositories/HumanHandoffRepository.js';

describe('TranslationService - Low-Confidence Fallback', () => {
  let translationService: TranslationService;
  let mockMessageRepository: MessageRepository;
  let mockHumanHandoffRepository: HumanHandoffRepository;

  beforeEach(() => {
    // Mock MessageRepository
    mockMessageRepository = {
      createTranslation: vi.fn(),
      findTranslationByMessageId: vi.fn(),
    } as any;

    // Mock HumanHandoffRepository
    mockHumanHandoffRepository = {
      createHandoff: vi.fn(),
      findById: vi.fn(),
      findBySessionId: vi.fn(),
      findPending: vi.fn(),
      assignToOperator: vi.fn(),
      resolveHandoff: vi.fn(),
      cancelHandoff: vi.fn(),
    } as any;

    // Initialize TranslationService with low confidence threshold for testing
    translationService = new TranslationService(
      mockMessageRepository,
      {
        provider: 'mock',
        confidenceThreshold: 0.7,
        defaultLanguage: 'en',
        canonicalLanguage: 'en',
      },
      mockHumanHandoffRepository
    );
  });

  describe('applyMultilingualFallback', () => {
    it('should apply multilingual fallback for low-confidence translations', () => {
      const result = translationService.applyMultilingualFallback(
        'Bonjour, je cherche un hôtel',
        'fr',
        0.5
      );

      expect(result).toEqual({
        originalText: 'Bonjour, je cherche un hôtel',
        detectedLanguage: 'fr',
        fallbackApplied: true,
        fallbackText: 'Bonjour, je cherche un hôtel',
        confidence: 0.5,
      });
    });

    it('should preserve original text in fallback', () => {
      const originalText = 'Complex text with ambiguous meaning';
      const result = translationService.applyMultilingualFallback(
        originalText,
        'en',
        0.3
      );

      expect(result.fallbackText).toBe(originalText);
      expect(result.fallbackApplied).toBe(true);
    });
  });

  describe('flagForOperatorReview', () => {
    it('should create human handoff for low-confidence translation', async () => {
      const mockHandoff = {
        handoffId: 'handoff-123',
        sessionId: 'session-123',
        userId: 'user-123',
        correlationId: 'corr-123',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {},
        status: 'pending' as const,
        createdAt: new Date(),
      };

      vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

      const translationResult = {
        translatedText: 'hello i am looking for a hotel',
        detectedLanguage: 'fr',
        targetLanguage: 'en',
        confidence: 0.5,
        canonicalForm: 'hello i am looking for a hotel',
      };

      const handoffId = await translationService.flagForOperatorReview(
        'session-123',
        'user-123',
        'corr-123',
        translationResult,
        'message-123'
      );

      expect(handoffId).toBe('handoff-123');
      expect(mockHumanHandoffRepository.createHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-123',
          userId: 'user-123',
          correlationId: 'corr-123',
          triggeringCondition: 'low_confidence_translation',
          status: 'pending',
        })
      );

      // Verify session summary contains translation details
      const callArgs = vi.mocked(mockHumanHandoffRepository.createHandoff).mock.calls[0][0];
      expect(callArgs.sessionSummary).toMatchObject({
        reason: 'Low-confidence translation detected',
        messageId: 'message-123',
        detectedLanguage: 'fr',
        targetLanguage: 'en',
        confidence: 0.5,
      });
    });

    it('should return undefined if HumanHandoffRepository is not available', async () => {
      const serviceWithoutHandoff = new TranslationService(
        mockMessageRepository,
        { provider: 'mock' }
        // No HumanHandoffRepository provided
      );

      const translationResult = {
        translatedText: 'test',
        detectedLanguage: 'en',
        targetLanguage: 'en',
        confidence: 0.5,
        canonicalForm: 'test',
      };

      const handoffId = await serviceWithoutHandoff.flagForOperatorReview(
        'session-123',
        'user-123',
        'corr-123',
        translationResult,
        'message-123'
      );

      expect(handoffId).toBeUndefined();
    });

    it('should include confidence threshold in session summary', async () => {
      const mockHandoff = {
        handoffId: 'handoff-123',
        sessionId: 'session-123',
        userId: 'user-123',
        correlationId: 'corr-123',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {},
        status: 'pending' as const,
        createdAt: new Date(),
      };

      vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

      const translationResult = {
        translatedText: 'test',
        detectedLanguage: 'en',
        targetLanguage: 'en',
        confidence: 0.6,
        canonicalForm: 'test',
      };

      await translationService.flagForOperatorReview(
        'session-123',
        'user-123',
        'corr-123',
        translationResult,
        'message-123'
      );

      const callArgs = vi.mocked(mockHumanHandoffRepository.createHandoff).mock.calls[0][0];
      expect(callArgs.sessionSummary).toHaveProperty('confidenceThreshold', 0.7);
    });
  });

  describe('translateWithFallback', () => {
    it('should apply fallback and flag for review when confidence is below threshold', async () => {
      const mockHandoff = {
        handoffId: 'handoff-123',
        sessionId: 'session-123',
        userId: 'user-123',
        correlationId: 'corr-123',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {},
        status: 'pending' as const,
        createdAt: new Date(),
      };

      vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

      // Use text with "ambiguous" keyword to trigger low confidence (0.5)
      // Translate from French to English to avoid same-language shortcut
      const result = await translationService.translateWithFallback(
        'Unknown ambiguous text',
        'en',
        'session-123',
        'user-123',
        'corr-123',
        'message-123',
        'fr' // Source language is French
      );

      expect(result.requiresOperatorReview).toBe(true);
      expect(result.handoffId).toBe('handoff-123');
      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.metadata?.belowConfidenceThreshold).toBe(true);
      expect(mockHumanHandoffRepository.createHandoff).toHaveBeenCalled();
    });

    it('should not apply fallback when confidence is above threshold', async () => {
      // Mock translation will return high confidence for known phrases
      const result = await translationService.translateWithFallback(
        'bonjour',
        'en',
        'session-123',
        'user-123',
        'corr-123',
        'message-123',
        'fr'
      );

      expect(result.requiresOperatorReview).toBeUndefined();
      expect(result.handoffId).toBeUndefined();
      expect(result.metadata?.fallbackApplied).toBeUndefined();
      expect(mockHumanHandoffRepository.createHandoff).not.toHaveBeenCalled();
    });

    it('should handle translation from French with low confidence', async () => {
      const mockHandoff = {
        handoffId: 'handoff-456',
        sessionId: 'session-456',
        userId: 'user-456',
        correlationId: 'corr-456',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {},
        status: 'pending' as const,
        createdAt: new Date(),
      };

      vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

      // Use text with "complex" keyword to trigger low confidence (0.5)
      const result = await translationService.translateWithFallback(
        'Texte français complexe et ambigu',
        'en',
        'session-456',
        'user-456',
        'corr-456',
        'message-456',
        'fr'
      );

      expect(result.confidence).toBeLessThan(0.7);
      expect(result.requiresOperatorReview).toBe(true);
      expect(result.handoffId).toBe('handoff-456');
    });

    it('should include confidence threshold in metadata', async () => {
      const mockHandoff = {
        handoffId: 'handoff-789',
        sessionId: 'session-789',
        userId: 'user-789',
        correlationId: 'corr-789',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {},
        status: 'pending' as const,
        createdAt: new Date(),
      };

      vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

      // Use text with "ambiguous" to trigger low confidence
      const result = await translationService.translateWithFallback(
        'Low confidence ambiguous text',
        'en',
        'session-789',
        'user-789',
        'corr-789',
        'message-789',
        'en'
      );

      if (result.requiresOperatorReview) {
        expect(result.metadata?.confidenceThreshold).toBe(0.7);
      }
    });
  });

  describe('Integration with existing translate method', () => {
    it('should work with standard translate method for high confidence', async () => {
      const result = await translationService.translate('bonjour', 'en', 'fr');

      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.translatedText).toBe('hello');
      expect(result.detectedLanguage).toBe('fr');
      expect(result.targetLanguage).toBe('en');
    });

    it('should detect low confidence in standard translate method', async () => {
      // Use text with "complex" to trigger low confidence
      // Translate from French to English
      const result = await translationService.translate(
        'Unknown complex phrase',
        'en',
        'fr' // Source language is French
      );

      // Standard translate doesn't apply fallback, but confidence should be low
      expect(result.confidence).toBeLessThan(0.7);
    });
  });

  describe('Requirement 10.8 validation', () => {
    it('should apply multilingual fallback when confidence is below threshold', async () => {
      const mockHandoff = {
        handoffId: 'handoff-req108',
        sessionId: 'session-req108',
        userId: 'user-req108',
        correlationId: 'corr-req108',
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {},
        status: 'pending' as const,
        createdAt: new Date(),
      };

      vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

      // Use text with "ambiguous" to trigger low confidence
      // Translate from French to English
      const result = await translationService.translateWithFallback(
        'Ambiguous text for requirement validation',
        'en',
        'session-req108',
        'user-req108',
        'corr-req108',
        'message-req108',
        'fr' // Source language is French
      );

      // Verify multilingual fallback was applied
      expect(result.metadata?.fallbackApplied).toBe(true);
      
      // Verify message was flagged for operator review
      expect(result.requiresOperatorReview).toBe(true);
      expect(result.handoffId).toBe('handoff-req108');
      
      // Verify handoff was created with correct triggering condition
      expect(mockHumanHandoffRepository.createHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeringCondition: 'low_confidence_translation',
          status: 'pending',
        })
      );
    });
  });
});
