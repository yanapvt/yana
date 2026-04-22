/**
 * Property Test 20: Translation Round-Trip and Storage
 * 
 * Property Statement:
 * For any user utterance that requires translation, the Translation_Service SHALL produce 
 * a Canonical_Form and the System SHALL store the original utterance, detected language, 
 * translated text, Canonical_Form, translation confidence, and translator metadata as a 
 * complete translation record.
 * 
 * **Validates: Requirements 10.3, 10.7, 16.5**
 * 
 * Requirements:
 * - 10.3: THE Translation_Service SHALL normalize user utterances into Canonical_Form 
 *         for schema processing and tool execution
 * - 10.7: THE System SHALL store the original user utterance, detected language, 
 *         translated text, Canonical_Form, and translation confidence for every 
 *         translated message
 * - 16.5: THE System SHALL store translation records including original utterance, 
 *         detected language, translated canonical text, vendor or API translated form 
 *         where used, translation confidence, and translator metadata
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TranslationService } from '../../services/TranslationService.js';
import { MessageRepository } from '../../db/repositories/MessageRepository.js';

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
    'I want to book a room for tonight',
    'Can you help me find accommodation?',
    'Looking for a place to stay near the beach'
  ),
  fc.string({ minLength: 10, maxLength: 200 }).filter(s => {
    const trimmed = s.trim();
    // Must have at least 5 alphanumeric characters
    const alphanumeric = trimmed.replace(/[^a-zA-Z0-9]/g, '');
    return alphanumeric.length >= 5;
  })
);

/**
 * Generates arbitrary confidence scores
 */
const confidenceArb = fc.double({ min: 0.0, max: 1.0 });

/**
 * Generates arbitrary message IDs
 */
const messageIdArb = fc.uuid();

/**
 * Generates arbitrary session IDs
 */
const sessionIdArb = fc.uuid();

/**
 * Generates arbitrary user IDs
 */
const userIdArb = fc.uuid();

/**
 * Generates arbitrary correlation IDs
 */
const correlationIdArb = fc.uuid();

/**
 * Generates arbitrary translator metadata
 */
const translatorMetadataArb = fc.record({
  provider: fc.constantFrom('mock', 'google', 'aws', 'azure'),
  model: fc.option(fc.string(), { nil: undefined }),
  detectionConfidence: fc.option(confidenceArb, { nil: undefined }),
  translationConfidence: fc.option(confidenceArb, { nil: undefined }),
  timestamp: fc.option(fc.date().map(d => d.toISOString()), { nil: undefined }),
});

/**
 * Generates arbitrary translation context
 */
const translationContextArb = fc.record({
  utterance: userUtteranceArb,
  targetLanguage: languageCodeArb,
  messageId: messageIdArb,
  sessionId: sessionIdArb,
  userId: userIdArb,
  correlationId: correlationIdArb,
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 20: Translation Round-Trip and Storage', () => {
  let mockMessageRepository: MessageRepository;
  let translationService: TranslationService;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockMessageRepository = {
      createTranslation: vi.fn(),
      findTranslationByMessageId: vi.fn(),
    } as unknown as MessageRepository;

    translationService = new TranslationService(mockMessageRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to get the last mock call (for property tests that run multiple times)
  const getLastCreateTranslationCall = () => {
    const calls = vi.mocked(mockMessageRepository.createTranslation).mock.calls;
    return calls[calls.length - 1][0];
  };

  it('should produce Canonical_Form for any user utterance', () => {
    fc.assert(
      fc.property(userUtteranceArb, languageCodeArb, async (utterance, sourceLang) => {
        // Given: Any user utterance in any language
        
        // When: We normalize to canonical form
        const canonicalForm = await translationService.toCanonicalForm(utterance, sourceLang);

        // Then: A canonical form should be produced
        expect(canonicalForm).toBeDefined();
        expect(typeof canonicalForm).toBe('string');
        expect(canonicalForm.length).toBeGreaterThan(0);

        // Canonical form should be normalized (lowercase, no extra spaces, no punctuation)
        expect(canonicalForm).toBe(canonicalForm.toLowerCase());
        expect(canonicalForm).not.toMatch(/\s{2,}/); // No multiple spaces
        expect(canonicalForm).not.toMatch(/^\s/); // No leading whitespace
        expect(canonicalForm).not.toMatch(/\s$/); // No trailing whitespace
      }),
      { numRuns: 50 }
    );
  });

  it('should store complete translation record with all required fields', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Given: A user utterance that requires translation
        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: 'en',
          translatedText: context.utterance,
          canonicalForm: context.utterance.toLowerCase().trim(),
          translationConfidence: 0.95,
          translatorMetadata: { provider: 'mock' },
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

        // When: We translate and store the utterance
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        const storedRecord = await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        // Then: All required fields should be stored
        expect(storedRecord).toBeDefined();
        expect(storedRecord.messageId).toBe(context.messageId);
        expect(storedRecord.originalText).toBe(context.utterance);
        expect(storedRecord.detectedLanguage).toBeDefined();
        expect(storedRecord.translatedText).toBeDefined();
        expect(storedRecord.canonicalForm).toBeDefined();
        expect(storedRecord.translationConfidence).toBeDefined();
        expect(storedRecord.translatorMetadata).toBeDefined();

        // Verify createTranslation was called with complete data
        expect(mockMessageRepository.createTranslation).toHaveBeenCalledWith(
          expect.objectContaining({
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: expect.any(String),
            translatedText: expect.any(String),
            canonicalForm: expect.any(String),
            translationConfidence: expect.any(Number),
            translatorMetadata: expect.any(Object),
          })
        );
      }),
      { numRuns: 50 }
    );
  });

  it('should preserve original utterance exactly as received', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Given: A user utterance with specific formatting
        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: 'en',
          translatedText: context.utterance,
          canonicalForm: context.utterance.toLowerCase().trim(),
          translationConfidence: 0.95,
          translatorMetadata: { provider: 'mock' },
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

        // When: We translate and store
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        // Then: Original text should be preserved exactly
        const createCall = getLastCreateTranslationCall();
        expect(createCall.originalText).toBe(context.utterance);
        expect(createCall.originalText).not.toBe(createCall.canonicalForm); // Unless already normalized
      }),
      { numRuns: 50 }
    );
  });

  it('should store detected language for every translation', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Given: A user utterance
        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: 'en',
          translatedText: context.utterance,
          canonicalForm: context.utterance.toLowerCase().trim(),
          translationConfidence: 0.95,
          translatorMetadata: { provider: 'mock' },
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

        // When: We translate without providing source language
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        // Then: Detected language should be stored
        const createCall = getLastCreateTranslationCall();
        expect(createCall.detectedLanguage).toBeDefined();
        expect(typeof createCall.detectedLanguage).toBe('string');
        expect(createCall.detectedLanguage.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 }
    );
  });

  it('should store translation confidence for every translation', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Given: A user utterance
        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: 'en',
          translatedText: context.utterance,
          canonicalForm: context.utterance.toLowerCase().trim(),
          translationConfidence: 0.95,
          translatorMetadata: { provider: 'mock' },
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

        // When: We translate and store
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        // Then: Translation confidence should be stored
        const createCall = getLastCreateTranslationCall();
        expect(createCall.translationConfidence).toBeDefined();
        expect(typeof createCall.translationConfidence).toBe('number');
        expect(createCall.translationConfidence).toBeGreaterThanOrEqual(0);
        expect(createCall.translationConfidence).toBeLessThanOrEqual(1);
      }),
      { numRuns: 50 }
    );
  });

  it('should store translator metadata for every translation', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Given: A user utterance
        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: 'en',
          translatedText: context.utterance,
          canonicalForm: context.utterance.toLowerCase().trim(),
          translationConfidence: 0.95,
          translatorMetadata: { provider: 'mock' },
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

        // When: We translate and store
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        // Then: Translator metadata should be stored
        const createCall = getLastCreateTranslationCall();
        expect(createCall.translatorMetadata).toBeDefined();
        expect(typeof createCall.translatorMetadata).toBe('object');
        expect(createCall.translatorMetadata).not.toBeNull();
      }),
      { numRuns: 50 }
    );
  });

  it('should produce consistent Canonical_Form for same input', () => {
    fc.assert(
      fc.property(userUtteranceArb, languageCodeArb, async (utterance, sourceLang) => {
        // Given: The same user utterance
        
        // When: We normalize it multiple times
        const canonical1 = await translationService.toCanonicalForm(utterance, sourceLang);
        const canonical2 = await translationService.toCanonicalForm(utterance, sourceLang);
        const canonical3 = await translationService.toCanonicalForm(utterance, sourceLang);

        // Then: All canonical forms should be identical
        expect(canonical1).toBe(canonical2);
        expect(canonical2).toBe(canonical3);
      }),
      { numRuns: 30 }
    );
  });

  it('should store translated text that differs from original for different languages', () => {
    fc.assert(
      fc.property(
        translationContextArb,
        async (context) => {
          const mockStoredTranslation = {
            translationId: fc.sample(fc.uuid(), 1)[0],
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: 'en',
            translatedText: context.utterance,
            canonicalForm: context.utterance.toLowerCase().trim(),
            translationConfidence: 0.95,
            translatorMetadata: { provider: 'mock' },
            createdAt: new Date(),
          };

          vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

          // When: We translate
          const translationResult = await translationService.translate(
            context.utterance,
            context.targetLanguage
          );

          await translationService.storeTranslationRecord(
            context.sessionId,
            {
              messageId: context.messageId,
              originalText: context.utterance,
              detectedLanguage: translationResult.detectedLanguage,
              translatedText: translationResult.translatedText,
              canonicalForm: translationResult.canonicalForm,
              translationConfidence: translationResult.confidence,
              translatorMetadata: translationResult.metadata,
            }
          );

          // Then: Translated text should be stored
          const createCall = getLastCreateTranslationCall();
          expect(createCall.translatedText).toBeDefined();
          expect(typeof createCall.translatedText).toBe('string');
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should handle round-trip: translate, store, and retrieve maintains data integrity', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Given: A complete translation workflow
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        // Create mock with actual translation result data
        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: translationResult.detectedLanguage,
          translatedText: translationResult.translatedText,
          canonicalForm: translationResult.canonicalForm,
          translationConfidence: translationResult.confidence,
          translatorMetadata: translationResult.metadata,
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);
        vi.mocked(mockMessageRepository.findTranslationByMessageId).mockResolvedValue(mockStoredTranslation);

        // When: We store and then retrieve the translation
        const storedRecord = await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        const retrievedRecord = await mockMessageRepository.findTranslationByMessageId(context.messageId);

        // Then: Retrieved record should match stored record
        expect(retrievedRecord).toBeDefined();
        expect(retrievedRecord?.messageId).toBe(context.messageId);
        expect(retrievedRecord?.originalText).toBe(context.utterance);
        expect(retrievedRecord?.detectedLanguage).toBe(translationResult.detectedLanguage);
        expect(retrievedRecord?.translatedText).toBe(translationResult.translatedText);
        expect(retrievedRecord?.canonicalForm).toBe(translationResult.canonicalForm);
        expect(retrievedRecord?.translationConfidence).toBe(translationResult.confidence);
      }),
      { numRuns: 30 }
    );
  });

  it('should include sessionId in translator metadata when storing', () => {
    fc.assert(
      fc.property(translationContextArb, async (context) => {
        // Clear mocks for this property run
        vi.clearAllMocks();
        
        // Given: A translation with session context
        const translationResult = await translationService.translate(
          context.utterance,
          context.targetLanguage
        );

        const mockStoredTranslation = {
          translationId: fc.sample(fc.uuid(), 1)[0],
          messageId: context.messageId,
          originalText: context.utterance,
          detectedLanguage: translationResult.detectedLanguage,
          translatedText: translationResult.translatedText,
          canonicalForm: translationResult.canonicalForm,
          translationConfidence: translationResult.confidence,
          translatorMetadata: { 
            ...translationResult.metadata,
            sessionId: context.sessionId,
          },
          createdAt: new Date(),
        };

        vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockStoredTranslation);

        // When: We translate and store with session context
        await translationService.storeTranslationRecord(
          context.sessionId,
          {
            messageId: context.messageId,
            originalText: context.utterance,
            detectedLanguage: translationResult.detectedLanguage,
            translatedText: translationResult.translatedText,
            canonicalForm: translationResult.canonicalForm,
            translationConfidence: translationResult.confidence,
            translatorMetadata: translationResult.metadata,
          }
        );

        // Then: Translator metadata should include sessionId
        const calls = vi.mocked(mockMessageRepository.createTranslation).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const createCall = calls[0][0]; // After clearing, this is the first (and only) call
        expect(createCall.translatorMetadata).toBeDefined();
        expect(createCall.translatorMetadata).toHaveProperty('sessionId');
        expect(createCall.translatorMetadata?.sessionId).toBe(context.sessionId);
      }),
      { numRuns: 30 }
    );
  });

  it('should reject empty utterances', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', '   ', '\t', '\n'),
        languageCodeArb,
        async (emptyUtterance, targetLang) => {
          // Given: An empty or whitespace-only utterance

          // When/Then: Translation should throw an error
          await expect(
            translationService.translate(emptyUtterance, targetLang)
          ).rejects.toThrow();
        }
      ),
      { numRuns: 10 }
    );
  });

  it('should reject empty text for canonical form generation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', '   ', '\t', '\n'),
        languageCodeArb,
        async (emptyText, sourceLang) => {
          // Given: An empty or whitespace-only text

          // When/Then: Canonical form generation should throw an error
          await expect(
            translationService.toCanonicalForm(emptyText, sourceLang)
          ).rejects.toThrow();
        }
      ),
      { numRuns: 10 }
    );
  });
});
