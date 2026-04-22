/**
 * TranslationService
 * 
 * Handles language detection, normalization to canonical form, translation,
 * and storage of translation records.
 * 
 * Validates: Requirements 10.1, 10.3, 10.7
 */

import { MessageRepository, MessageTranslation } from '../db/repositories/MessageRepository.js';
import { HumanHandoffRepository, CreateHumanHandoffData } from '../db/repositories/HumanHandoffRepository.js';
import { env } from '../config/environment.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  alternatives?: Array<{ language: string; confidence: number }>;
}

/**
 * Translation result
 */
export interface TranslationResult {
  translatedText: string;
  detectedLanguage: string;
  targetLanguage: string;
  confidence: number;
  canonicalForm: string;
  metadata?: Record<string, unknown>;
  requiresOperatorReview?: boolean;
  handoffId?: string;
}

/**
 * Multilingual fallback result
 */
export interface MultilingualFallbackResult {
  originalText: string;
  detectedLanguage: string;
  fallbackApplied: boolean;
  fallbackText?: string;
  confidence: number;
}

/**
 * Translation record for storage
 */
export interface TranslationRecord {
  messageId: string;
  originalText: string;
  detectedLanguage: string;
  translatedText: string;
  canonicalForm: string;
  translationConfidence: number;
  translatorMetadata?: Record<string, unknown>;
}

/**
 * Configuration for translation service
 */
export interface TranslationConfig {
  provider: string;
  apiKey?: string;
  confidenceThreshold: number;
  defaultLanguage: string;
  canonicalLanguage: string;
}

/**
 * Error thrown when translation service encounters an issue
 */
export class TranslationServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'TranslationServiceError';
  }
}

// ============================================================================
// TranslationService Class
// ============================================================================

export class TranslationService {
  private config: TranslationConfig;
  private messageRepository: MessageRepository;
  private humanHandoffRepository?: HumanHandoffRepository;

  constructor(
    messageRepository: MessageRepository,
    config?: Partial<TranslationConfig>,
    humanHandoffRepository?: HumanHandoffRepository
  ) {
    this.messageRepository = messageRepository;
    this.humanHandoffRepository = humanHandoffRepository;
    this.config = {
      provider: config?.provider ?? env.translation?.provider ?? 'mock',
      apiKey: config?.apiKey ?? env.translation?.apiKey,
      confidenceThreshold: config?.confidenceThreshold ?? env.translation?.confidenceThreshold ?? 0.7,
      defaultLanguage: config?.defaultLanguage ?? 'en',
      canonicalLanguage: config?.canonicalLanguage ?? 'en',
    };
  }

  /**
   * Detect language from user message
   * 
   * Validates: Requirement 10.1
   * 
   * @param text - User message text
   * @returns Language detection result with confidence
   * @throws TranslationServiceError if detection fails
   */
  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    if (!text || text.trim().length === 0) {
      throw new TranslationServiceError(
        'Cannot detect language from empty text',
        'EMPTY_TEXT',
        false
      );
    }

    try {
      // Call language detection provider
      const result = await this.callLanguageDetection(text);

      // Log detection for observability
      console.log('[TranslationService] Language detected:', {
        text: text.substring(0, 50),
        language: result.language,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      if (error instanceof TranslationServiceError) {
        throw error;
      }

      throw new TranslationServiceError(
        `Failed to detect language: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DETECTION_FAILED',
        true // Retryable
      );
    }
  }

  /**
   * Normalize text to canonical form for schema processing and tool execution
   * 
   * Canonical form is a normalized representation of the text that:
   * - Uses the canonical language (typically English)
   * - Removes ambiguity and colloquialisms
   * - Standardizes terminology for schema field matching
   * - Preserves semantic meaning
   * 
   * Validates: Requirement 10.3
   * 
   * @param text - Original text
   * @param sourceLang - Source language code
   * @returns Canonical form text
   * @throws TranslationServiceError if normalization fails
   */
  async toCanonicalForm(text: string, sourceLang: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw new TranslationServiceError(
        'Cannot normalize empty text',
        'EMPTY_TEXT',
        false
      );
    }

    try {
      // If already in canonical language, just normalize
      if (sourceLang === this.config.canonicalLanguage) {
        return this.normalizeText(text);
      }

      // Translate to canonical language
      const translated = await this.translateText(
        text,
        sourceLang,
        this.config.canonicalLanguage
      );

      // Apply normalization
      const canonical = this.normalizeText(translated.text);

      console.log('[TranslationService] Canonical form created:', {
        original: text.substring(0, 50),
        sourceLang,
        canonical: canonical.substring(0, 50),
      });

      return canonical;
    } catch (error) {
      if (error instanceof TranslationServiceError) {
        throw error;
      }

      throw new TranslationServiceError(
        `Failed to create canonical form: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CANONICALIZATION_FAILED',
        true // Retryable
      );
    }
  }

  /**
   * Translate text to target language
   * 
   * Validates: Requirement 10.4
   * 
   * @param text - Text to translate
   * @param targetLang - Target language code
   * @param sourceLang - Optional source language (will detect if not provided)
   * @returns Translation result with confidence
   * @throws TranslationServiceError if translation fails
   */
  async translate(
    text: string,
    targetLang: string,
    sourceLang?: string
  ): Promise<TranslationResult> {
    if (!text || text.trim().length === 0) {
      throw new TranslationServiceError(
        'Cannot translate empty text',
        'EMPTY_TEXT',
        false
      );
    }

    try {
      // Detect source language if not provided
      let detectedLanguage = sourceLang;
      let detectionConfidence = 1.0;

      if (!detectedLanguage) {
        const detection = await this.detectLanguage(text);
        detectedLanguage = detection.language;
        detectionConfidence = detection.confidence;
      }

      // If source and target are the same, return original text
      if (detectedLanguage === targetLang) {
        const canonicalForm = await this.toCanonicalForm(text, detectedLanguage);
        return {
          translatedText: text,
          detectedLanguage,
          targetLanguage: targetLang,
          confidence: 1.0,
          canonicalForm,
          metadata: {
            noTranslationNeeded: true,
          },
        };
      }

      // Translate text
      const translationResult = await this.translateText(
        text,
        detectedLanguage,
        targetLang
      );

      // Create canonical form
      const canonicalForm = await this.toCanonicalForm(text, detectedLanguage);

      // Combine confidence scores (detection * translation)
      const combinedConfidence = detectionConfidence * translationResult.confidence;

      const result: TranslationResult = {
        translatedText: translationResult.text,
        detectedLanguage,
        targetLanguage: targetLang,
        confidence: combinedConfidence,
        canonicalForm,
        metadata: {
          detectionConfidence,
          translationConfidence: translationResult.confidence,
          provider: this.config.provider,
        },
      };

      console.log('[TranslationService] Translation completed:', {
        sourceLang: detectedLanguage,
        targetLang,
        confidence: combinedConfidence,
      });

      return result;
    } catch (error) {
      if (error instanceof TranslationServiceError) {
        throw error;
      }

      throw new TranslationServiceError(
        `Failed to translate text: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSLATION_FAILED',
        true // Retryable
      );
    }
  }

  /**
   * Store translation record in database
   * 
   * Validates: Requirement 10.7
   * 
   * @param sessionId - Session ID for context
   * @param record - Translation record to store
   * @returns Stored translation record
   * @throws TranslationServiceError if storage fails
   */
  async storeTranslationRecord(
    sessionId: string,
    record: TranslationRecord
  ): Promise<MessageTranslation> {
    try {
      const translation = await this.messageRepository.createTranslation({
        messageId: record.messageId,
        originalText: record.originalText,
        detectedLanguage: record.detectedLanguage,
        translatedText: record.translatedText,
        canonicalForm: record.canonicalForm,
        translationConfidence: record.translationConfidence,
        translatorMetadata: {
          ...record.translatorMetadata,
          sessionId,
          storedAt: new Date().toISOString(),
        },
      });

      console.log('[TranslationService] Translation record stored:', {
        translationId: translation.translationId,
        messageId: record.messageId,
        detectedLanguage: record.detectedLanguage,
        confidence: record.translationConfidence,
      });

      return translation;
    } catch (error) {
      throw new TranslationServiceError(
        `Failed to store translation record: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_FAILED',
        true // Retryable
      );
    }
  }

  /**
   * Apply multilingual fallback when translation confidence is low
   * 
   * When confidence is below threshold, this method:
   * 1. Returns the original text in the detected language
   * 2. Optionally provides a simplified fallback message
   * 
   * Validates: Requirement 10.8 (partial)
   * 
   * @param originalText - Original text
   * @param detectedLanguage - Detected language
   * @param confidence - Translation confidence score
   * @returns Multilingual fallback result
   */
  applyMultilingualFallback(
    originalText: string,
    detectedLanguage: string,
    confidence: number
  ): MultilingualFallbackResult {
    console.log('[TranslationService] Applying multilingual fallback:', {
      detectedLanguage,
      confidence,
      threshold: this.config.confidenceThreshold,
    });

    // Return original text with fallback indicator
    return {
      originalText,
      detectedLanguage,
      fallbackApplied: true,
      fallbackText: originalText, // Keep original text for multilingual display
      confidence,
    };
  }

  /**
   * Flag message for operator review when translation confidence is low
   * 
   * Creates a human handoff record for operator review of low-confidence translations.
   * 
   * Validates: Requirement 10.8
   * 
   * @param sessionId - Session ID
   * @param userId - User ID
   * @param correlationId - Correlation ID for traceability
   * @param translationResult - Translation result with low confidence
   * @param messageId - Message ID for reference
   * @returns Handoff ID if flagged, undefined if no handoff repository available
   * @throws TranslationServiceError if flagging fails
   */
  async flagForOperatorReview(
    sessionId: string,
    userId: string,
    correlationId: string,
    translationResult: TranslationResult,
    messageId: string
  ): Promise<string | undefined> {
    if (!this.humanHandoffRepository) {
      console.warn('[TranslationService] Cannot flag for operator review: HumanHandoffRepository not available');
      return undefined;
    }

    try {
      const handoffData: CreateHumanHandoffData = {
        sessionId,
        userId,
        correlationId,
        triggeringCondition: 'low_confidence_translation',
        sessionSummary: {
          reason: 'Low-confidence translation detected',
          messageId,
          originalText: translationResult.translatedText,
          detectedLanguage: translationResult.detectedLanguage,
          targetLanguage: translationResult.targetLanguage,
          confidence: translationResult.confidence,
          confidenceThreshold: this.config.confidenceThreshold,
          canonicalForm: translationResult.canonicalForm,
          timestamp: new Date().toISOString(),
        },
        status: 'pending',
      };

      const handoff = await this.humanHandoffRepository.createHandoff(handoffData);

      console.log('[TranslationService] Message flagged for operator review:', {
        handoffId: handoff.handoffId,
        sessionId,
        messageId,
        confidence: translationResult.confidence,
      });

      return handoff.handoffId;
    } catch (error) {
      throw new TranslationServiceError(
        `Failed to flag message for operator review: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FLAGGING_FAILED',
        true // Retryable
      );
    }
  }

  /**
   * Translate with automatic low-confidence handling
   * 
   * This method extends the standard translate() method with automatic
   * low-confidence detection, multilingual fallback, and operator flagging.
   * 
   * Validates: Requirements 10.8
   * 
   * @param text - Text to translate
   * @param targetLang - Target language code
   * @param sessionId - Session ID for operator flagging
   * @param userId - User ID for operator flagging
   * @param correlationId - Correlation ID for traceability
   * @param messageId - Message ID for reference
   * @param sourceLang - Optional source language (will detect if not provided)
   * @returns Translation result with fallback and flagging applied if needed
   */
  async translateWithFallback(
    text: string,
    targetLang: string,
    sessionId: string,
    userId: string,
    correlationId: string,
    messageId: string,
    sourceLang?: string
  ): Promise<TranslationResult> {
    // Perform standard translation
    const translationResult = await this.translate(text, targetLang, sourceLang);

    // Check if confidence is below threshold
    if (translationResult.confidence < this.config.confidenceThreshold) {
      console.log('[TranslationService] Low confidence translation detected:', {
        confidence: translationResult.confidence,
        threshold: this.config.confidenceThreshold,
      });

      // Apply multilingual fallback
      const fallback = this.applyMultilingualFallback(
        text,
        translationResult.detectedLanguage,
        translationResult.confidence
      );

      // Flag for operator review
      const handoffId = await this.flagForOperatorReview(
        sessionId,
        userId,
        correlationId,
        translationResult,
        messageId
      );

      // Return result with fallback and flagging metadata
      return {
        ...translationResult,
        requiresOperatorReview: true,
        handoffId,
        metadata: {
          ...translationResult.metadata,
          fallbackApplied: fallback.fallbackApplied,
          belowConfidenceThreshold: true,
          confidenceThreshold: this.config.confidenceThreshold,
        },
      };
    }

    // Return normal translation result
    return translationResult;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Call language detection provider
   */
  private async callLanguageDetection(text: string): Promise<LanguageDetectionResult> {
    if (this.config.provider === 'mock') {
      return this.mockLanguageDetection(text);
    }

    // TODO: Implement actual provider integration (Google Translate, AWS Translate, etc.)
    throw new TranslationServiceError(
      `Translation provider '${this.config.provider}' not yet implemented`,
      'PROVIDER_NOT_IMPLEMENTED',
      false
    );
  }

  /**
   * Call translation provider
   */
  private async translateText(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<{ text: string; confidence: number }> {
    if (this.config.provider === 'mock') {
      return this.mockTranslation(text, sourceLang, targetLang);
    }

    // TODO: Implement actual provider integration (Google Translate, AWS Translate, etc.)
    throw new TranslationServiceError(
      `Translation provider '${this.config.provider}' not yet implemented`,
      'PROVIDER_NOT_IMPLEMENTED',
      false
    );
  }

  /**
   * Normalize text for canonical form
   * - Trim whitespace
   * - Convert to lowercase
   * - Remove extra spaces
   * - Standardize punctuation
   */
  private normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .trim();
  }

  /**
   * Mock language detection for testing
   */
  private mockLanguageDetection(text: string): LanguageDetectionResult {
    // Simple heuristic-based detection for common patterns
    const lowerText = text.toLowerCase();

    // French patterns
    if (
      lowerText.includes('bonjour') ||
      lowerText.includes('merci') ||
      lowerText.includes('oui') ||
      lowerText.includes('non')
    ) {
      return {
        language: 'fr',
        confidence: 0.9,
        alternatives: [{ language: 'en', confidence: 0.1 }],
      };
    }

    // Spanish patterns
    if (
      lowerText.includes('hola') ||
      lowerText.includes('gracias') ||
      lowerText.includes('sí') ||
      lowerText.includes('no')
    ) {
      return {
        language: 'es',
        confidence: 0.9,
        alternatives: [{ language: 'en', confidence: 0.1 }],
      };
    }

    // Sinhala patterns (Sri Lankan language)
    if (
      lowerText.includes('ආයුබෝවන්') ||
      lowerText.includes('ස්තූතියි') ||
      lowerText.includes('හෝටලය')
    ) {
      return {
        language: 'si',
        confidence: 0.95,
        alternatives: [{ language: 'en', confidence: 0.05 }],
      };
    }

    // Tamil patterns
    if (
      lowerText.includes('வணக்கம்') ||
      lowerText.includes('நன்றி') ||
      lowerText.includes('ஹோட்டல்')
    ) {
      return {
        language: 'ta',
        confidence: 0.95,
        alternatives: [{ language: 'en', confidence: 0.05 }],
      };
    }

    // Default to English
    return {
      language: 'en',
      confidence: 0.85,
      alternatives: [
        { language: 'fr', confidence: 0.08 },
        { language: 'es', confidence: 0.07 },
      ],
    };
  }

  /**
   * Mock translation for testing
   */
  private mockTranslation(
    text: string,
    sourceLang: string,
    targetLang: string
  ): { text: string; confidence: number } {
    // Simple mock translations for common phrases
    const translations: Record<string, Record<string, string>> = {
      'fr-en': {
        bonjour: 'hello',
        'je cherche un hôtel': 'i am looking for a hotel',
        merci: 'thank you',
      },
      'es-en': {
        hola: 'hello',
        'busco un hotel': 'i am looking for a hotel',
        gracias: 'thank you',
      },
      'si-en': {
        'ආයුබෝවන්': 'hello',
        'හෝටලයක් සොයනවා': 'looking for a hotel',
        'ස්තූතියි': 'thank you',
      },
      'ta-en': {
        'வணக்கம்': 'hello',
        'ஹோட்டல் தேடுகிறேன்': 'looking for a hotel',
        'நன்றி': 'thank you',
      },
    };

    const key = `${sourceLang}-${targetLang}`;
    const lowerText = text.toLowerCase().trim();

    if (translations[key] && translations[key][lowerText]) {
      return {
        text: translations[key][lowerText],
        confidence: 0.95,
      };
    }

    // Return lower confidence for complex or ambiguous text
    if (
      text.toLowerCase().includes('ambiguous') ||
      text.toLowerCase().includes('complex') ||
      text.toLowerCase().includes('unknown') ||
      text.length > 50
    ) {
      return {
        text: text,
        confidence: 0.5, // Below threshold
      };
    }

    // If no translation found, return original with moderate confidence
    return {
      text: text,
      confidence: 0.7,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let translationServiceInstance: TranslationService | null = null;

/**
 * Gets the singleton TranslationService instance
 */
export function getTranslationService(
  messageRepository: MessageRepository,
  humanHandoffRepository?: HumanHandoffRepository
): TranslationService {
  if (!translationServiceInstance) {
    translationServiceInstance = new TranslationService(messageRepository, undefined, humanHandoffRepository);
  }
  return translationServiceInstance;
}

/**
 * Initializes the TranslationService with custom configuration
 */
export function initTranslationService(
  messageRepository: MessageRepository,
  config?: Partial<TranslationConfig>,
  humanHandoffRepository?: HumanHandoffRepository
): TranslationService {
  translationServiceInstance = new TranslationService(messageRepository, config, humanHandoffRepository);
  return translationServiceInstance;
}
