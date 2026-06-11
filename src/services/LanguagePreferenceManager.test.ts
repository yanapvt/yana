/**
 * LanguagePreferenceManager Unit Tests
 * 
 * Tests language preference detection, persistence, and application.
 * 
 * Validates: Requirements 10.2, 10.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LanguagePreferenceManager,
  LanguagePreferenceError,
} from './LanguagePreferenceManager.js';
import { TranslationService } from './TranslationService.js';
import { SessionManager } from './SessionManager.js';

// Mock TranslationService
const mockTranslationService = {
  detectLanguage: vi.fn(),
  translate: vi.fn(),
  toCanonicalForm: vi.fn(),
  storeTranslationRecord: vi.fn(),
} as unknown as TranslationService;

// Mock SessionManager
const mockSessionManager = {
  getPreferredLanguage: vi.fn(),
  updatePreferredLanguage: vi.fn(),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
  assembleContextPackage: vi.fn(),
  appendMessage: vi.fn(),
  updateSessionState: vi.fn(),
} as unknown as SessionManager;

describe('LanguagePreferenceManager', () => {
  let manager: LanguagePreferenceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LanguagePreferenceManager(mockTranslationService, mockSessionManager);
  });

  describe('detectAndPersistLanguagePreference', () => {
    it('should detect and persist language on first message', async () => {
      // Mock: No existing language preference
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      // Mock: Language detection returns French
      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'fr',
        confidence: 0.95,
        alternatives: [{ language: 'en', confidence: 0.05 }],
      });

      const result = await manager.detectAndPersistLanguagePreference(
        'user_123',
        'Bonjour, je cherche un hôtel'
      );

      // Should detect language
      expect(mockTranslationService.detectLanguage).toHaveBeenCalledWith(
        'Bonjour, je cherche un hôtel'
      );

      // Should persist detected language
      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_123', 'fr');

      // Should return detection result
      expect(result).toEqual({
        userId: 'user_123',
        detectedLanguage: 'fr',
        confidence: 0.95,
        isFirstDetection: true,
        preferredLanguage: 'fr',
      });
    });

    it('should return existing preference without detection if already stored', async () => {
      // Mock: User has existing French preference
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('fr');

      const result = await manager.detectAndPersistLanguagePreference(
        'user_123',
        'Hello, I need a hotel'
      );

      // Should NOT call language detection
      expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();

      // Should NOT update preference
      expect(mockSessionManager.updatePreferredLanguage).not.toHaveBeenCalled();

      // Should return existing preference
      expect(result).toEqual({
        userId: 'user_123',
        detectedLanguage: 'fr',
        confidence: 1.0,
        isFirstDetection: false,
        preferredLanguage: 'fr',
      });
    });

    it('should use stored English preference without re-detection', async () => {
      // Mock: User has an explicit English preference
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('en');

      // Mock: Language detection returns Spanish
      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'es',
        confidence: 0.92,
        alternatives: [{ language: 'en', confidence: 0.08 }],
      });

      const result = await manager.detectAndPersistLanguagePreference(
        'user_123',
        'Hola, busco un hotel'
      );

      // Should not detect language when any preference is stored
      expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();

      // Should not update preference
      expect(mockSessionManager.updatePreferredLanguage).not.toHaveBeenCalled();

      // Should return the stored preference
      expect(result).toEqual({
        userId: 'user_123',
        detectedLanguage: 'en',
        confidence: 1.0,
        isFirstDetection: false,
        preferredLanguage: 'en',
      });
    });

    it('should handle Sinhala language detection', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'si',
        confidence: 0.96,
        alternatives: [{ language: 'en', confidence: 0.04 }],
      });

      const result = await manager.detectAndPersistLanguagePreference(
        'user_123',
        'හෝටලයක් සොයනවා'
      );

      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_123', 'si');
      expect(result.detectedLanguage).toBe('si');
      expect(result.isFirstDetection).toBe(true);
    });

    it('should handle Tamil language detection', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'ta',
        confidence: 0.94,
        alternatives: [{ language: 'en', confidence: 0.06 }],
      });

      const result = await manager.detectAndPersistLanguagePreference(
        'user_123',
        'ஹோட்டல் தேடுகிறேன்'
      );

      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_123', 'ta');
      expect(result.detectedLanguage).toBe('ta');
      expect(result.isFirstDetection).toBe(true);
    });

    it('should throw LanguagePreferenceError if detection fails', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockRejectedValue(
        new Error('Detection service unavailable')
      );

      await expect(
        manager.detectAndPersistLanguagePreference('user_123', 'Hello')
      ).rejects.toThrow(LanguagePreferenceError);

      await expect(
        manager.detectAndPersistLanguagePreference('user_123', 'Hello')
      ).rejects.toThrow('Failed to detect and persist language preference');
    });

    it('should throw LanguagePreferenceError if persistence fails', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'fr',
        confidence: 0.95,
        alternatives: [],
      });

      vi.mocked(mockSessionManager.updatePreferredLanguage).mockRejectedValue(
        new Error('Database error')
      );

      await expect(
        manager.detectAndPersistLanguagePreference('user_123', 'Bonjour')
      ).rejects.toThrow(LanguagePreferenceError);
    });

    it('should mark errors as retryable', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockRejectedValue(
        new Error('Network error')
      );

      try {
        await manager.detectAndPersistLanguagePreference('user_123', 'Hello');
      } catch (error) {
        expect(error).toBeInstanceOf(LanguagePreferenceError);
        expect((error as LanguagePreferenceError).retryable).toBe(true);
        expect((error as LanguagePreferenceError).code).toBe('DETECTION_PERSISTENCE_FAILED');
      }
    });
  });

  describe('getPreferredLanguageForRendering', () => {
    it('should return stored language preference', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('fr');

      const language = await manager.getPreferredLanguageForRendering('user_123');

      expect(language).toBe('fr');
      expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
    });

    it('should detect and persist if no stored preference and message provided', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'es',
        confidence: 0.93,
        alternatives: [],
      });

      vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

      const language = await manager.getPreferredLanguageForRendering(
        'user_123',
        'Hola, busco un hotel'
      );

      expect(mockTranslationService.detectLanguage).toHaveBeenCalledWith('Hola, busco un hotel');
      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_123', 'es');
      expect(language).toBe('es');
    });

    it('should default to "en" if no preference and no message', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      const language = await manager.getPreferredLanguageForRendering('user_123');

      expect(language).toBe('en');
      expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();
    });

    it('should fall back to "en" on error', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockRejectedValue(
        new Error('Database error')
      );

      const language = await manager.getPreferredLanguageForRendering('user_123');

      expect(language).toBe('en');
    });

    it('should handle detection error gracefully', async () => {
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockRejectedValue(
        new Error('Detection failed')
      );

      const language = await manager.getPreferredLanguageForRendering('user_123', 'Hello');

      // Should fall back to 'en' on error
      expect(language).toBe('en');
    });
  });

  describe('updatePreferredLanguage', () => {
    it('should update user language preference', async () => {
      vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

      await manager.updatePreferredLanguage('user_123', 'fr');

      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_123', 'fr');
    });

    it('should throw LanguagePreferenceError if update fails', async () => {
      vi.mocked(mockSessionManager.updatePreferredLanguage).mockRejectedValue(
        new Error('Database error')
      );

      await expect(manager.updatePreferredLanguage('user_123', 'fr')).rejects.toThrow(
        LanguagePreferenceError
      );

      await expect(manager.updatePreferredLanguage('user_123', 'fr')).rejects.toThrow(
        'Failed to update language preference'
      );
    });

    it('should mark update errors as retryable', async () => {
      vi.mocked(mockSessionManager.updatePreferredLanguage).mockRejectedValue(
        new Error('Network error')
      );

      try {
        await manager.updatePreferredLanguage('user_123', 'fr');
      } catch (error) {
        expect(error).toBeInstanceOf(LanguagePreferenceError);
        expect((error as LanguagePreferenceError).retryable).toBe(true);
        expect((error as LanguagePreferenceError).code).toBe('UPDATE_FAILED');
      }
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete first-time user flow', async () => {
      // Scenario: New user sends first message in French
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue(null);

      vi.mocked(mockTranslationService.detectLanguage).mockResolvedValue({
        language: 'fr',
        confidence: 0.95,
        alternatives: [],
      });

      vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

      // First message: detect and persist
      const result = await manager.detectAndPersistLanguagePreference(
        'user_123',
        'Bonjour, je cherche un hôtel'
      );

      expect(result.isFirstDetection).toBe(true);
      expect(result.preferredLanguage).toBe('fr');
      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_123', 'fr');

      // Subsequent message: use stored preference
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('fr');

      const language = await manager.getPreferredLanguageForRendering('user_123');
      expect(language).toBe('fr');
    });

    it('should handle returning user with stored preference', async () => {
      // Scenario: Returning user with stored Spanish preference
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('es');

      const result = await manager.detectAndPersistLanguagePreference(
        'user_456',
        'Hello, I need a hotel'
      );

      // Should use stored preference, not detect from English message
      expect(result.isFirstDetection).toBe(false);
      expect(result.preferredLanguage).toBe('es');
      expect(mockTranslationService.detectLanguage).not.toHaveBeenCalled();

      // Rendering should also use stored preference
      const language = await manager.getPreferredLanguageForRendering('user_456');
      expect(language).toBe('es');
    });

    it('should handle language preference override', async () => {
      // Scenario: User changes language preference manually
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('en');
      vi.mocked(mockSessionManager.updatePreferredLanguage).mockResolvedValue(undefined);

      // User explicitly changes to French
      await manager.updatePreferredLanguage('user_789', 'fr');

      expect(mockSessionManager.updatePreferredLanguage).toHaveBeenCalledWith('user_789', 'fr');

      // Subsequent rendering should use new preference
      vi.mocked(mockSessionManager.getPreferredLanguage).mockResolvedValue('fr');

      const language = await manager.getPreferredLanguageForRendering('user_789');
      expect(language).toBe('fr');
    });
  });
});
