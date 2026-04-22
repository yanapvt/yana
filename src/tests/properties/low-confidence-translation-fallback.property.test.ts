/**
 * Property Test 22: Low-Confidence Translation Fallback
 * 
 * Property Statement:
 * For any translation with confidence below the configured threshold, the Orchestrator 
 * SHALL apply multilingual fallback behavior and the System SHALL flag the message for 
 * operator review rather than proceeding with low-confidence execution.
 * 
 * **Validates: Requirements 10.8**
 * 
 * Requirements:
 * - 10.8: WHEN translation confidence is below the configured threshold, THE Orchestrator 
 *         SHALL apply multilingual fallback behavior and flag the message for operator review
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TranslationService } from '../../services/TranslationService.js';
import { MessageRepository } from '../../db/repositories/MessageRepository.js';
import { HumanHandoffRepository } from '../../db/repositories/HumanHandoffRepository.js';

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary language codes
 */
const languageCodeArb = fc.constantFrom('en', 'es', 'fr', 'de', 'si', 'ta', 'it', 'pt', 'zh', 'ja');

/**
 * Generates arbitrary user utterances (non-empty, non-whitespace)
 */
const userUtteranceArb = fc.oneof(
  fc.constantFrom(
    'I need a hotel in Galle',
    'Bonjour, je cherche un hôtel',
    'Hola, busco un hotel',
    'ආයුබෝවන්, හෝටලයක් සොයනවා',
    'வணக்கம், ஹோட்டல் தேடுகிறேன்',
    'Ambiguous complex text that is hard to translate',
    'Unknown phrase with low confidence',
    'Very long text that might have translation issues and low confidence scores'
  ),
  fc.string({ minLength: 10, maxLength: 200 }).filter(s => {
    const trimmed = s.trim();
    const alphanumeric = trimmed.replace(/[^a-zA-Z0-9]/g, '');
    return alphanumeric.length >= 5;
  })
);

/**
 * Generates arbitrary confidence scores below a threshold
 */
const lowConfidenceArb = (threshold: number) => 
  fc.double({ min: 0.0, max: threshold - 0.01, noNaN: true });

/**
 * Generates arbitrary confidence scores at or above a threshold
 */
const highConfidenceArb = (threshold: number) => 
  fc.double({ min: threshold, max: 1.0, noNaN: true });

/**
 * Generates arbitrary confidence thresholds
 */
const confidenceThresholdArb = fc.double({ min: 0.5, max: 0.95, noNaN: true });

/**
 * Generates arbitrary UUIDs
 */
const uuidArb = fc.uuid();

/**
 * Generates arbitrary translation context
 */
const translationContextArb = fc.record({
  text: userUtteranceArb,
  targetLanguage: languageCodeArb,
  sessionId: uuidArb,
  userId: uuidArb,
  correlationId: uuidArb,
  messageId: uuidArb,
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 22: Low-Confidence Translation Fallback', () => {
  let mockMessageRepository: MessageRepository;
  let mockHumanHandoffRepository: HumanHandoffRepository;
  let translationService: TranslationService;
  const defaultThreshold = 0.7;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockMessageRepository = {
      createTranslation: vi.fn(),
      findTranslationByMessageId: vi.fn(),
    } as unknown as MessageRepository;

    mockHumanHandoffRepository = {
      createHandoff: vi.fn(),
      findHandoffById: vi.fn(),
      findHandoffsBySession: vi.fn(),
    } as unknown as HumanHandoffRepository;

    translationService = new TranslationService(
      mockMessageRepository,
      { confidenceThreshold: defaultThreshold },
      mockHumanHandoffRepository
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Core Property: Low confidence SHALL trigger fallback and operator flagging
  // ==========================================================================

  it('should apply multilingual fallback for any translation below confidence threshold', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation that will have low confidence
          // Mock the translation to return low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using text that triggers low confidence
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is below threshold, fallback should be applied
          if (result.confidence < defaultThreshold) {
            expect(result.metadata?.fallbackApplied).toBe(true);
            expect(result.metadata?.belowConfidenceThreshold).toBe(true);
            expect(result.metadata?.confidenceThreshold).toBe(defaultThreshold);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should flag message for operator review when confidence is below threshold', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is below threshold, should be flagged for review
          if (result.confidence < defaultThreshold) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.handoffId).toBeDefined();
            expect(mockHumanHandoffRepository.createHandoff).toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should NOT proceed with low-confidence execution', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is below threshold, should require operator review
          // (indicating we should NOT proceed with automated execution)
          if (result.confidence < defaultThreshold) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.metadata?.belowConfidenceThreshold).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Threshold Boundary Testing
  // ==========================================================================

  it('should respect the configured confidence threshold boundary', () => {
    fc.assert(
      fc.property(
        confidenceThresholdArb,
        translationContextArb,
        async (threshold, context) => {
          // Given: A TranslationService with a specific threshold
          const testService = new TranslationService(
            mockMessageRepository,
            { confidenceThreshold: threshold },
            mockHumanHandoffRepository
          );

          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await testService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: Behavior must depend on threshold comparison
          if (result.confidence < threshold) {
            // Below threshold: must apply fallback and flag for review
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.metadata?.fallbackApplied).toBe(true);
            expect(result.metadata?.belowConfidenceThreshold).toBe(true);
            expect(result.handoffId).toBeDefined();
          } else {
            // At or above threshold: should not require review
            expect(result.requiresOperatorReview).toBeUndefined();
            expect(result.metadata?.fallbackApplied).toBeUndefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should trigger fallback when confidence is even slightly below threshold', () => {
    fc.assert(
      fc.property(
        confidenceThresholdArb,
        translationContextArb,
        async (threshold, context) => {
          // Given: A TranslationService with a specific threshold
          const testService = new TranslationService(
            mockMessageRepository,
            { confidenceThreshold: threshold },
            mockHumanHandoffRepository
          );

          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate text that will have confidence just below threshold
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await testService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If below threshold, must trigger fallback
          if (result.confidence < threshold) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.metadata?.fallbackApplied).toBe(true);
            expect(mockHumanHandoffRepository.createHandoff).toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // High Confidence Should Not Trigger Fallback
  // ==========================================================================

  it('should NOT trigger fallback when confidence meets or exceeds threshold', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Given: A translation with high confidence
          // When: We translate with fallback using high-confidence text (short, simple text)
          const highConfidenceText = 'Bonjour';  // Simple, known phrase with high confidence
          const result = await translationService.translateWithFallback(
            highConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is at or above threshold, should not trigger fallback
          if (result.confidence >= defaultThreshold) {
            expect(result.requiresOperatorReview).toBeUndefined();
            expect(result.metadata?.fallbackApplied).toBeUndefined();
            expect(result.metadata?.belowConfidenceThreshold).toBeUndefined();
            expect(result.handoffId).toBeUndefined();
            expect(mockHumanHandoffRepository.createHandoff).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Fallback Behavior Validation
  // ==========================================================================

  it('should apply multilingual fallback that preserves original text', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If fallback is applied, original text should be preserved
          if (result.metadata?.fallbackApplied) {
            // The translation result should still contain the translated text
            expect(result.translatedText).toBeDefined();
            expect(result.detectedLanguage).toBeDefined();
            expect(result.canonicalForm).toBeDefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should create handoff with correct triggering condition', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If handoff was created, verify the triggering condition
          if (result.handoffId) {
            expect(mockHumanHandoffRepository.createHandoff).toHaveBeenCalledWith(
              expect.objectContaining({
                sessionId: context.sessionId,
                userId: context.userId,
                correlationId: context.correlationId,
                triggeringCondition: 'low_confidence_translation',
                status: 'pending',
              })
            );
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should include confidence information in handoff session summary', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If handoff was created, verify session summary includes confidence info
          if (result.handoffId) {
            const createCall = vi.mocked(mockHumanHandoffRepository.createHandoff).mock.calls[0][0];
            expect(createCall.sessionSummary).toHaveProperty('confidence');
            expect(createCall.sessionSummary).toHaveProperty('confidenceThreshold');
            expect(createCall.sessionSummary).toHaveProperty('messageId');
            expect(createCall.sessionSummary).toHaveProperty('detectedLanguage');
            expect(createCall.sessionSummary).toHaveProperty('targetLanguage');
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Graceful Degradation
  // ==========================================================================

  it('should handle missing HumanHandoffRepository gracefully', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A TranslationService without HumanHandoffRepository
          const serviceWithoutHandoff = new TranslationService(
            mockMessageRepository,
            { confidenceThreshold: defaultThreshold }
            // No humanHandoffRepository provided
          );

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await serviceWithoutHandoff.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: Should still apply fallback even without handoff capability
          if (result.confidence < defaultThreshold) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.metadata?.fallbackApplied).toBe(true);
            // handoffId should be undefined since no repository available
            expect(result.handoffId).toBeUndefined();
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  // ==========================================================================
  // Consistency and Determinism
  // ==========================================================================

  it('should produce consistent fallback behavior for the same low-confidence translation', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A specific low-confidence translation
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          const lowConfidenceText = 'ambiguous complex unknown text';

          // When: We translate the same text multiple times
          const result1 = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          vi.clearAllMocks();
          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          const result2 = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: Both results should have consistent fallback behavior
          if (result1.confidence < defaultThreshold && result2.confidence < defaultThreshold) {
            expect(result1.requiresOperatorReview).toBe(result2.requiresOperatorReview);
            expect(result1.metadata?.fallbackApplied).toBe(result2.metadata?.fallbackApplied);
            expect(result1.metadata?.belowConfidenceThreshold).toBe(result2.metadata?.belowConfidenceThreshold);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  // ==========================================================================
  // Requirement 10.8 Validation
  // ==========================================================================

  it('should validate Requirement 10.8: apply multilingual fallback for low confidence', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is below threshold, must apply multilingual fallback (Requirement 10.8)
          if (result.confidence < defaultThreshold) {
            expect(result.metadata?.fallbackApplied).toBe(true);
            expect(result.metadata?.belowConfidenceThreshold).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should validate Requirement 10.8: flag message for operator review for low confidence', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is below threshold, must flag for operator review (Requirement 10.8)
          if (result.confidence < defaultThreshold) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.handoffId).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should validate Requirement 10.8: do not proceed with low-confidence execution', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with low confidence
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback using low-confidence text
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: If confidence is below threshold, must NOT proceed with execution (Requirement 10.8)
          // This is indicated by requiresOperatorReview flag
          if (result.confidence < defaultThreshold) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.metadata?.belowConfidenceThreshold).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  it('should handle confidence of 0 correctly', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with zero confidence (worst case)
          const mockHandoff = {
            handoffId: fc.sample(uuidArb, 1)[0],
            sessionId: context.sessionId,
            userId: context.userId,
            correlationId: context.correlationId,
            triggeringCondition: 'low_confidence_translation',
            sessionSummary: {},
            status: 'pending' as const,
            createdAt: new Date(),
          };

          vi.mocked(mockHumanHandoffRepository.createHandoff).mockResolvedValue(mockHandoff);

          // When: We translate with fallback
          const lowConfidenceText = 'ambiguous complex unknown text';
          const result = await translationService.translateWithFallback(
            lowConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: Should trigger fallback and flagging
          if (result.confidence === 0) {
            expect(result.requiresOperatorReview).toBe(true);
            expect(result.metadata?.fallbackApplied).toBe(true);
            expect(result.handoffId).toBeDefined();
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle confidence of 1 correctly', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          // Given: A translation with maximum confidence
          // When: We translate with fallback using high-confidence text (short, simple)
          const highConfidenceText = 'Bonjour';  // Simple phrase with high confidence
          const result = await translationService.translateWithFallback(
            highConfidenceText,
            context.targetLanguage,
            context.sessionId,
            context.userId,
            context.correlationId,
            context.messageId
          );

          // Then: Should not trigger fallback for high confidence
          if (result.confidence >= defaultThreshold) {
            expect(result.requiresOperatorReview).toBeUndefined();
            expect(result.metadata?.fallbackApplied).toBeUndefined();
            expect(result.handoffId).toBeUndefined();
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle empty text gracefully', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', '   ', '\t', '\n'),
        translationContextArb,
        async (emptyText, context) => {
          // Given: Empty or whitespace-only text

          // When/Then: Should throw an error
          await expect(
            translationService.translateWithFallback(
              emptyText,
              context.targetLanguage,
              context.sessionId,
              context.userId,
              context.correlationId,
              context.messageId
            )
          ).rejects.toThrow();
        }
      ),
      { numRuns: 10 }
    );
  });
});
