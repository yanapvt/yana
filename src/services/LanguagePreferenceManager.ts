/**
 * LanguagePreferenceManager
 * 
 * Manages user language preference detection, persistence, and application.
 * Detects language on first meaningful message and stores it in user profile.
 * 
 * Validates: Requirements 10.2, 10.4
 */

import { TranslationService } from './TranslationService.js';
import { SessionManager } from './SessionManager.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of language preference detection and persistence
 */
export interface LanguagePreferenceResult {
  userId: string;
  detectedLanguage: string;
  confidence: number;
  isFirstDetection: boolean;
  preferredLanguage: string;
}

/**
 * Error thrown when language preference management encounters an issue
 */
export class LanguagePreferenceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'LanguagePreferenceError';
  }
}

// ============================================================================
// LanguagePreferenceManager Class
// ============================================================================

export class LanguagePreferenceManager {
  constructor(
    private translationService: TranslationService,
    private sessionManager: SessionManager
  ) {}

  /**
   * Detect and persist user's language preference on first meaningful message
   * 
   * If user already has a stored language preference, returns it without detection.
   * If this is the first meaningful message, detects language and stores it.
   * 
   * Validates: Requirement 10.2
   * 
   * @param userId - User ID
   * @param messageText - User's message text for language detection
   * @returns Language preference result with detection details
   * @throws LanguagePreferenceError if detection or persistence fails
   */
  async detectAndPersistLanguagePreference(
    userId: string,
    messageText: string
  ): Promise<LanguagePreferenceResult> {
    try {
      // Check if user already has a stored language preference
      const existingLanguage = await this.sessionManager.getPreferredLanguage(userId);

      // If user has a stored preference, use it without re-detection.
      if (existingLanguage) {
        return {
          userId,
          detectedLanguage: existingLanguage,
          confidence: 1.0,
          isFirstDetection: false,
          preferredLanguage: existingLanguage,
        };
      }

      // Detect language from message text
      const detection = await this.translationService.detectLanguage(messageText);

      // Store the detected language as user's preferred language
      await this.sessionManager.updatePreferredLanguage(userId, detection.language);

      console.log('[LanguagePreferenceManager] Language preference stored:', {
        userId,
        detectedLanguage: detection.language,
        confidence: detection.confidence,
        isFirstDetection: true,
      });

      return {
        userId,
        detectedLanguage: detection.language,
        confidence: detection.confidence,
        isFirstDetection: true,
        preferredLanguage: detection.language,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new LanguagePreferenceError(
          `Failed to detect and persist language preference: ${error.message}`,
          'DETECTION_PERSISTENCE_FAILED',
          true // Retryable
        );
      }
      throw error;
    }
  }

  /**
   * Get user's preferred language for rendering WhatsApp messages
   * 
   * Returns the stored language preference or detects it from the provided message.
   * 
   * Validates: Requirement 10.4
   * 
   * @param userId - User ID
   * @param fallbackMessageText - Optional message text for detection if no preference exists
   * @returns Language code for rendering messages
   */
  async getPreferredLanguageForRendering(
    userId: string,
    fallbackMessageText?: string
  ): Promise<string> {
    try {
      // Try to get stored preference first
      const storedLanguage = await this.sessionManager.getPreferredLanguage(userId);

      if (storedLanguage) {
        return storedLanguage;
      }

      // If no stored preference and we have a message, detect and persist
      if (fallbackMessageText) {
        const result = await this.detectAndPersistLanguagePreference(
          userId,
          fallbackMessageText
        );
        return result.preferredLanguage;
      }

      // Default to English if no preference and no message to detect from
      return 'en';
    } catch (error) {
      // On error, fall back to English to ensure messages can still be rendered
      console.error('[LanguagePreferenceManager] Error getting preferred language:', error);
      return 'en';
    }
  }

  /**
   * Update user's preferred language manually
   * 
   * Allows explicit language preference updates (e.g., from user settings)
   * 
   * @param userId - User ID
   * @param language - Language code to set
   */
  async updatePreferredLanguage(userId: string, language: string): Promise<void> {
    try {
      await this.sessionManager.updatePreferredLanguage(userId, language);

      console.log('[LanguagePreferenceManager] Language preference updated:', {
        userId,
        language,
      });
    } catch (error) {
      throw new LanguagePreferenceError(
        `Failed to update language preference: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_FAILED',
        true // Retryable
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let languagePreferenceManagerInstance: LanguagePreferenceManager | null = null;

/**
 * Gets the singleton LanguagePreferenceManager instance
 */
export function getLanguagePreferenceManager(
  translationService: TranslationService,
  sessionManager: SessionManager
): LanguagePreferenceManager {
  if (!languagePreferenceManagerInstance) {
    languagePreferenceManagerInstance = new LanguagePreferenceManager(
      translationService,
      sessionManager
    );
  }
  return languagePreferenceManagerInstance;
}

/**
 * Initializes the LanguagePreferenceManager
 */
export function initLanguagePreferenceManager(
  translationService: TranslationService,
  sessionManager: SessionManager
): LanguagePreferenceManager {
  languagePreferenceManagerInstance = new LanguagePreferenceManager(
    translationService,
    sessionManager
  );
  return languagePreferenceManagerInstance;
}
