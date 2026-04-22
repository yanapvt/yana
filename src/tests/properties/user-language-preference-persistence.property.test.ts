/**
 * Property Test 21: User Language Preference Persistence
 * 
 * Property Statement:
 * For any user with a stored language preference, all subsequent WhatsApp UI labels, 
 * messages, and confirmations rendered for that user SHALL be in the user's preferred language.
 * 
 * **Validates: Requirements 10.2, 10.4**
 * 
 * Requirements:
 * - 10.2: THE System SHALL store the user's preferred language in the user profile and 
 *         apply it to all subsequent interactions in that session
 * - 10.4: THE WhatsApp_Renderer SHALL translate all WhatsApp UI labels, messages, and 
 *         confirmations into the user's preferred language before delivery
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LanguagePreferenceManager } from '../../services/LanguagePreferenceManager.js';
import { TranslationService } from '../../services/TranslationService.js';
import { SessionManager } from '../../services/SessionManager.js';

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary language codes
 */
const languageCodeArb = fc.constantFrom('en', 'es', 'fr', 'de', 'si', 'ta', 'it', 'pt', 'zh', 'ja');

/**
 * Generates arbitrary user IDs
 */
const userIdArb = fc.uuid();

/**
 * Generates arbitrary user messages in various languages
 */
const userMessageArb = fc.oneof(
  fc.constantFrom(
    'I need a hotel in Galle',
    'Bonjour, je cherche un hôtel',
    'Hola, busco un hotel',
    'ආයුබෝවන්, හෝටලයක් සොයනවා',
    'வணக்கம், ஹோட்டல் தேடுகிறேன்',
    'Ich brauche ein Hotel',
    'Preciso de um hotel',
    '我需要一家酒店',
    'ホテルが必要です'
  )
);

/**
 * Generates arbitrary confidence scores
 */
const confidenceArb = fc.double({ min: 0.7, max: 1.0 });

/**
 * Generates arbitrary user context with language preference
 */
const userContextArb = fc.record({
  userId: userIdArb,
  preferredLanguage: languageCodeArb,
  firstMessage: userMessageArb,
  subsequentMessages: fc.array(userMessageArb, { minLength: 1, maxLength: 5 }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 21: User Language Preference Persistence', () => {
  let mockTranslationService: TranslationService;
  let mockSessionManager: SessionManager;
  let languagePreferenceManager: LanguagePreferenceManager;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockTranslationService = {
      detectLanguage: vi.fn(),
      translate: vi.fn(),
      toCanonicalForm: vi.fn(),
      storeTranslationRecord: vi.fn(),
    } as unknown as TranslationService;

    mockSessionManager = {
      getPreferredLanguage: vi.fn(),
      updatePreferredLanguage: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      assembleContextPackage: vi.fn(),
      appendMessage: vi.fn(),
      updateSessionState: vi.fn(),
    } as unknown as SessionManager;

    languagePreferenceManager = new LanguagePreferenceManager(
      mockTranslationService,
      mockSessionManager
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should persist detected language on first message', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userMessageArb,
        languageCodeArb,
        confidenceArb,
        async (userId, firstMessage, detectedLang, confidence) => {
          // Given: A new user with no stored language preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

          // Mock language detection
          vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
            language: detectedLang,
            confidence,
            alternatives: [],
          });

          vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

          // When: User sends their first message
          const result = await languagePreferenceManager.detectAndPersistLanguagePreference(
            userId,
            firstMessage
          );

          // Then: Language should be detected and persisted
          expect(mockTranslationService.detectLanguage).toHaveBeenCalledWith(firstMessage);
          expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith(userId, detectedLang);
          expect(result.isFirstDetection).toBe(true);
          expect(result.preferredLanguage).toBe(detectedLang);
          expect(result.detectedLanguage).toBe(detectedLang);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should use stored language preference for all subsequent interactions', () => {
    fc.assert(
      fc.property(
        userContextArb,
        async (context) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Given: A user with a stored language preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(context.preferredLanguage);

          // When: User sends subsequent messages (in any language)
          for (const message of context.subsequentMessages) {
            const result = await languagePreferenceManager.detectAndPersistLanguagePreference(
              context.userId,
              message
            );

            // Then: Stored preference should be used without re-detection
            expect(result.preferredLanguage).toBe(context.preferredLanguage);
            expect(result.isFirstDetection).toBe(false);
            expect(result.confidence).toBe(1.0); // Full confidence in stored preference
          }

          // Language detection should never be called for subsequent messages
          expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();

          // Language preference should not be updated again
          expect(mockSessionManager.updatePreferredLanguage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should return stored preference for rendering regardless of message language', () => {
    fc.assert(
      fc.property(
        userIdArb,
        languageCodeArb,
        fc.array(userMessageArb, { minLength: 1, maxLength: 5 }),
        async (userId, storedLanguage, messages) => {
          // Given: A user with a stored language preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(storedLanguage);

          // When: We get the preferred language for rendering (with various messages)
          for (const message of messages) {
            const language = await languagePreferenceManager.getPreferredLanguageForRendering(
              userId,
              message
            );

            // Then: Should always return the stored preference
            expect(language).toBe(storedLanguage);
          }

          // Should never attempt language detection when preference is stored
          expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should maintain language preference consistency across multiple rendering calls', () => {
    fc.assert(
      fc.property(
        userIdArb,
        languageCodeArb,
        fc.integer({ min: 2, max: 10 }),
        async (userId, storedLanguage, numCalls) => {
          // Given: A user with a stored language preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(storedLanguage);

          // When: We get the preferred language multiple times
          const languages = await Promise.all(
            Array.from({ length: numCalls }, () =>
              languagePreferenceManager.getPreferredLanguageForRendering(userId)
            )
          );

          // Then: All calls should return the same language
          const uniqueLanguages = new Set(languages);
          expect(uniqueLanguages.size).toBe(1);
          expect(uniqueLanguages.has(storedLanguage)).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should not re-detect language when stored preference exists (even if different from message)', () => {
    fc.assert(
      fc.property(
        userIdArb,
        languageCodeArb,
        userMessageArb,
        async (userId, storedLanguage, messageInDifferentLanguage) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Given: A user with stored Spanish preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(storedLanguage);

          // When: User sends a message in a different language
          const result = await languagePreferenceManager.detectAndPersistLanguagePreference(
            userId,
            messageInDifferentLanguage
          );

          // Then: Should use stored preference, not detect from message
          expect(result.preferredLanguage).toBe(storedLanguage);
          expect(result.isFirstDetection).toBe(false);
          expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
          expect(mockSessionManager.updatePreferredLanguage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should allow manual language preference updates', () => {
    fc.assert(
      fc.property(
        userIdArb,
        languageCodeArb,
        languageCodeArb,
        async (userId, initialLanguage, newLanguage) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Given: A user with an initial language preference
          vi.mocked(mockSessionManager.getPreferredLanguage)
            .mockResolvedValueOnce(initialLanguage)
            .mockResolvedValueOnce(newLanguage);

          vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

          // When: User manually updates their language preference
          await languagePreferenceManager.updatePreferredLanguage(userId, newLanguage);

          // Then: New preference should be persisted
          expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith(userId, newLanguage);

          // And subsequent rendering should use new preference
          const language = await languagePreferenceManager.getPreferredLanguageForRendering(userId);
          expect(language).toBe(newLanguage);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should detect and persist language when stored preference is default "en"', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userMessageArb,
        languageCodeArb.filter(lang => lang !== 'en'),
        confidenceArb,
        async (userId, message, detectedLang, confidence) => {
          // Given: A user with default 'en' preference (not yet detected)
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('en');

          // Mock language detection to return non-English language
          vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
            language: detectedLang,
            confidence,
            alternatives: [],
          });

          vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

          // When: User sends a message in their actual language
          const result = await languagePreferenceManager.detectAndPersistLanguagePreference(
            userId,
            message
          );

          // Then: Should detect and update to actual language
          expect(mockTranslationService.detectLanguage).toHaveBeenCalledWith(message);
          expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith(userId, detectedLang);
          expect(result.isFirstDetection).toBe(true);
          expect(result.preferredLanguage).toBe(detectedLang);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should handle complete user journey: first message → persistence → subsequent interactions', () => {
    fc.assert(
      fc.property(
        userContextArb,
        confidenceArb,
        async (context, confidence) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Phase 1: First message - detect and persist
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValueOnce(null);

          vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
            language: context.preferredLanguage,
            confidence,
            alternatives: [],
          });

          vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

          const firstResult = await languagePreferenceManager.detectAndPersistLanguagePreference(
            context.userId,
            context.firstMessage
          );

          expect(firstResult.isFirstDetection).toBe(true);
          expect(firstResult.preferredLanguage).toBe(context.preferredLanguage);
          expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith(
            context.userId,
            context.preferredLanguage
          );

          // Phase 2: Subsequent messages - use stored preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(context.preferredLanguage);
          vi.clearAllMocks(); // Clear first phase calls

          for (const message of context.subsequentMessages) {
            const result = await languagePreferenceManager.detectAndPersistLanguagePreference(
              context.userId,
              message
            );

            expect(result.preferredLanguage).toBe(context.preferredLanguage);
            expect(result.isFirstDetection).toBe(false);
          }

          // Should not detect or update language for subsequent messages
          expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
          expect(mockSessionManager.updatePreferredLanguage).not.toHaveBeenCalled();

          // Phase 3: Rendering - always use stored preference
          for (let i = 0; i < context.subsequentMessages.length; i++) {
            const language = await languagePreferenceManager.getPreferredLanguageForRendering(
              context.userId
            );
            expect(language).toBe(context.preferredLanguage);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should fall back to English when no preference and no message provided', () => {
    fc.assert(
      fc.property(
        userIdArb,
        async (userId) => {
          // Given: A user with no stored preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

          // When: We get preferred language without a message to detect from
          const language = await languagePreferenceManager.getPreferredLanguageForRendering(userId);

          // Then: Should default to English
          expect(language).toBe('en');
          expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should detect and persist when no preference but message is provided', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userMessageArb,
        languageCodeArb,
        confidenceArb,
        async (userId, message, detectedLang, confidence) => {
          // Given: A user with no stored preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

          vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
            language: detectedLang,
            confidence,
            alternatives: [],
          });

          vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

          // When: We get preferred language with a message
          const language = await languagePreferenceManager.getPreferredLanguageForRendering(
            userId,
            message
          );

          // Then: Should detect, persist, and return detected language
          expect(mockTranslationService.detectLanguage).toHaveBeenCalledWith(message);
          expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith(userId, detectedLang);
          expect(language).toBe(detectedLang);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should gracefully fall back to English on errors', () => {
    fc.assert(
      fc.property(
        userIdArb,
        userMessageArb,
        async (userId, message) => {
          // Given: SessionManager throws an error
          vi.mocked(mockSessionManager.getPreferredLanguage).mockRejectedValue(
            new Error('Database error')
          );

          // When: We get preferred language for rendering
          const language = await languagePreferenceManager.getPreferredLanguageForRendering(
            userId,
            message
          );

          // Then: Should fall back to English without throwing
          expect(language).toBe('en');
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should maintain preference persistence across service restarts (idempotency)', () => {
    fc.assert(
      fc.property(
        userIdArb,
        languageCodeArb,
        fc.integer({ min: 2, max: 5 }),
        async (userId, storedLanguage, numRestarts) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Given: A user with a stored language preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(storedLanguage);

          // When: We simulate multiple service restarts by creating new manager instances
          const languages: string[] = [];
          for (let i = 0; i < numRestarts; i++) {
            const manager = new LanguagePreferenceManager(
              mockTranslationService,
              mockSessionManager
            );
            const language = await manager.getPreferredLanguageForRendering(userId);
            languages.push(language);
          }

          // Then: All instances should return the same stored preference
          const uniqueLanguages = new Set(languages);
          expect(uniqueLanguages.size).toBe(1);
          expect(uniqueLanguages.has(storedLanguage)).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should never lose language preference once stored', () => {
    fc.assert(
      fc.property(
        userIdArb,
        languageCodeArb,
        fc.array(userMessageArb, { minLength: 5, maxLength: 20 }),
        async (userId, initialLanguage, messages) => {
          // Clear mocks for this property run
          vi.clearAllMocks();
          
          // Given: A user with an initial stored language preference
          vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(initialLanguage);

          // When: User sends many messages over time
          const preferences: string[] = [];
          for (const message of messages) {
            const result = await languagePreferenceManager.detectAndPersistLanguagePreference(
              userId,
              message
            );
            preferences.push(result.preferredLanguage);
          }

          // Then: All interactions should use the same stored preference
          const uniquePreferences = new Set(preferences);
          expect(uniquePreferences.size).toBe(1);
          expect(uniquePreferences.has(initialLanguage)).toBe(true);

          // And language should never be re-detected
          expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 30 }
    );
  });
});
