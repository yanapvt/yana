/**
 * TranslationService Unit Tests
 * 
 * Tests language detection, canonical form normalization, translation,
 * and translation record storage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslationService, TranslationServiceError } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

// Mock MessageRepository
const mockMessageRepository = {
  createTranslation: vi.fn(),
  findTranslationByMessageId: vi.fn(),
} as unknown as MessageRepository;

describe('TranslationService', () => {
  let service: TranslationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TranslationService(mockMessageRepository, {
      provider: 'mock',
      confidenceThreshold: 0.7,
      defaultLanguage: 'en',
      canonicalLanguage: 'en',
    });
  });

  describe('detectLanguage', () => {
    it('should detect English language', async () => {
      const result = await service.detectLanguage('Hello, I need a hotel');

      expect(result.language).toBe('en');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should detect French language', async () => {
      const result = await service.detectLanguage('Bonjour, je cherche un hôtel');

      expect(result.language).toBe('fr');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect Spanish language', async () => {
      const result = await service.detectLanguage('Hola, busco un hotel');

      expect(result.language).toBe('es');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should throw error for empty text', async () => {
      await expect(service.detectLanguage('')).rejects.toThrow(TranslationServiceError);
      await expect(service.detectLanguage('   ')).rejects.toThrow(TranslationServiceError);
    });

    it('should include alternatives in detection result', async () => {
      const result = await service.detectLanguage('Hello world');

      expect(result.alternatives).toBeDefined();
      expect(Array.isArray(result.alternatives)).toBe(true);
    });
  });

  describe('toCanonicalForm', () => {
    it('should normalize English text to canonical form', async () => {
      const result = await service.toCanonicalForm('Hello, I need a hotel!', 'en');

      expect(result).toBe('hello i need a hotel');
      expect(result).not.toContain('!');
      expect(result).not.toContain(',');
    });

    it('should translate and normalize non-English text', async () => {
      const result = await service.toCanonicalForm('Bonjour', 'fr');

      expect(result).toBe('hello');
    });

    it('should remove extra whitespace', async () => {
      const result = await service.toCanonicalForm('Hello    world   !', 'en');

      expect(result).toBe('hello world');
    });

    it('should convert to lowercase', async () => {
      const result = await service.toCanonicalForm('HELLO WORLD', 'en');

      expect(result).toBe('hello world');
    });

    it('should throw error for empty text', async () => {
      await expect(service.toCanonicalForm('', 'en')).rejects.toThrow(TranslationServiceError);
    });
  });

  describe('translate', () => {
    it('should translate French to English', async () => {
      const result = await service.translate('Bonjour', 'en', 'fr');

      expect(result.translatedText).toBe('hello');
      expect(result.detectedLanguage).toBe('fr');
      expect(result.targetLanguage).toBe('en');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.canonicalForm).toBeDefined();
    });

    it('should detect language if not provided', async () => {
      const result = await service.translate('Bonjour', 'en');

      expect(result.detectedLanguage).toBe('fr');
      expect(result.translatedText).toBe('hello');
    });

    it('should return original text if source and target are the same', async () => {
      const result = await service.translate('Hello world', 'en', 'en');

      expect(result.translatedText).toBe('Hello world');
      expect(result.confidence).toBe(1.0);
      expect(result.metadata?.noTranslationNeeded).toBe(true);
    });

    it('should include canonical form in result', async () => {
      const result = await service.translate('Bonjour', 'en', 'fr');

      expect(result.canonicalForm).toBe('hello');
    });

    it('should include metadata with confidence scores', async () => {
      const result = await service.translate('Bonjour', 'en');

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.detectionConfidence).toBeDefined();
      expect(result.metadata?.translationConfidence).toBeDefined();
      expect(result.metadata?.provider).toBe('mock');
    });

    it('should throw error for empty text', async () => {
      await expect(service.translate('', 'en')).rejects.toThrow(TranslationServiceError);
    });
  });

  describe('storeTranslationRecord', () => {
    it('should store translation record in database', async () => {
      const mockTranslation = {
        translationId: 'trans_123',
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
        translatorMetadata: { provider: 'mock' },
        createdAt: new Date(),
      };

      vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockTranslation);

      const record = {
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
        translatorMetadata: { provider: 'mock' },
      };

      const result = await service.storeTranslationRecord('session_123', record);

      expect(result).toEqual(mockTranslation);
      expect(mockMessageRepository.createTranslation).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg_123',
          originalText: 'Bonjour',
          detectedLanguage: 'fr',
          translatedText: 'Hello',
          canonicalForm: 'hello',
          translationConfidence: 0.95,
        })
      );
    });

    it('should include session ID in metadata', async () => {
      const mockTranslation = {
        translationId: 'trans_123',
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
        translatorMetadata: {},
        createdAt: new Date(),
      };

      vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockTranslation);

      const record = {
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
      };

      await service.storeTranslationRecord('session_123', record);

      expect(mockMessageRepository.createTranslation).toHaveBeenCalledWith(
        expect.objectContaining({
          translatorMetadata: expect.objectContaining({
            sessionId: 'session_123',
          }),
        })
      );
    });

    it('should throw error if storage fails', async () => {
      vi.mocked(mockMessageRepository.createTranslation).mockRejectedValue(
        new Error('Database error')
      );

      const record = {
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
      };

      await expect(service.storeTranslationRecord('session_123', record)).rejects.toThrow(
        TranslationServiceError
      );
    });
  });

  describe('end-to-end translation flow', () => {
    it('should handle complete translation workflow', async () => {
      const mockTranslation = {
        translationId: 'trans_123',
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
        translatorMetadata: {},
        createdAt: new Date(),
      };

      vi.mocked(mockMessageRepository.createTranslation).mockResolvedValue(mockTranslation);

      // 1. Detect language
      const detection = await service.detectLanguage('Bonjour');
      expect(detection.language).toBe('fr');

      // 2. Translate to English
      const translation = await service.translate('Bonjour', 'en', detection.language);
      expect(translation.translatedText).toBe('hello');
      expect(translation.canonicalForm).toBe('hello');

      // 3. Store translation record
      const record = {
        messageId: 'msg_123',
        originalText: 'Bonjour',
        detectedLanguage: translation.detectedLanguage,
        translatedText: translation.translatedText,
        canonicalForm: translation.canonicalForm,
        translationConfidence: translation.confidence,
        translatorMetadata: translation.metadata,
      };

      const stored = await service.storeTranslationRecord('session_123', record);
      expect(stored.translationId).toBe('trans_123');
    });
  });

  describe('error handling', () => {
    it('should mark errors as retryable or non-retryable', async () => {
      try {
        await service.detectLanguage('');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        expect((error as TranslationServiceError).retryable).toBe(false);
      }
    });

    it('should include error codes', async () => {
      try {
        await service.detectLanguage('');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        expect((error as TranslationServiceError).code).toBe('EMPTY_TEXT');
      }
    });
  });
});
