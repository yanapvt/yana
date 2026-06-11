/**
 * SessionManager Unit Tests
 * Tests session lifecycle and context assembly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from './SessionManager.js';
import { UserRepository } from '../db/repositories/UserRepository.js';
import { SessionRepository } from '../db/repositories/SessionRepository.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { StateStore } from './StateStore.js';
import type { SessionState } from '../types/core.js';

// ============================================================================
// Mock Setup
// ============================================================================

const mockUserRepository = {
  findByPhoneNumber: vi.fn(),
  createUser: vi.fn(),
  getProfile: vi.fn(),
  getPreferences: vi.fn(),
  getLanguageSettings: vi.fn(),
} as unknown as UserRepository;

const mockSessionRepository = {
  findActiveByUserId: vi.fn(),
  createSession: vi.fn(),
  updateLastActivity: vi.fn(),
  findById: vi.fn(),
  getState: vi.fn(),
  updateState: vi.fn(),
  appendConversationHistory: vi.fn(),
} as unknown as SessionRepository;

const mockMessageRepository = {
  createMessage: vi.fn(),
} as unknown as MessageRepository;

const mockStateStore = {
  getSessionState: vi.fn(),
  setSessionState: vi.fn(),
} as unknown as StateStore;

// ============================================================================
// Test Suite
// ============================================================================

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new SessionManager(
      mockUserRepository,
      mockSessionRepository,
      mockMessageRepository,
      mockStateStore
    );
  });

  // ==========================================================================
  // createSession Tests
  // ==========================================================================

  describe('createSession', () => {
    it('should create new user and session when user does not exist', async () => {
      // Arrange
      const phoneNumber = '+1234567890';
      const phoneHash = 'hash123';
      const mockUser = { userId: 'user-1', phoneNumber, phoneHash, createdAt: new Date(), updatedAt: new Date() };
      const mockSession = {
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };

      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(null);
      vi.mocked(mockUserRepository.createUser).mockResolvedValue(mockUser);
      vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(null);
      vi.mocked(mockSessionRepository.createSession).mockResolvedValue(mockSession);

      // Act
      const result = await sessionManager.createSession({
        phoneNumber,
        phoneHash,
        preferredLanguage: 'en',
        preferredCurrency: 'USD',
      });

      // Assert
      expect(result).toEqual({
        sessionId: 'session-1',
        userId: 'user-1',
        isNewUser: true,
        isNewSession: true,
      });
      expect(mockUserRepository.createUser).toHaveBeenCalledWith(phoneNumber, phoneHash, 'en', 'USD');
      expect(mockSessionRepository.createSession).toHaveBeenCalledWith('user-1', phoneNumber);
    });

    it('should reuse existing user and create new session', async () => {
      // Arrange
      const phoneNumber = '+1234567890';
      const phoneHash = 'hash123';
      const mockUser = { userId: 'user-1', phoneNumber, phoneHash, createdAt: new Date(), updatedAt: new Date() };
      const mockSession = {
        sessionId: 'session-2',
        userId: 'user-1',
        phoneNumber,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };

      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
      vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(null);
      vi.mocked(mockSessionRepository.createSession).mockResolvedValue(mockSession);

      // Act
      const result = await sessionManager.createSession({
        phoneNumber,
        phoneHash,
      });

      // Assert
      expect(result).toEqual({
        sessionId: 'session-2',
        userId: 'user-1',
        isNewUser: false,
        isNewSession: true,
      });
      expect(mockUserRepository.createUser).not.toHaveBeenCalled();
      expect(mockSessionRepository.createSession).toHaveBeenCalledWith('user-1', phoneNumber);
    });

    it('should reuse existing user and active session', async () => {
      // Arrange
      const phoneNumber = '+1234567890';
      const phoneHash = 'hash123';
      const mockUser = { userId: 'user-1', phoneNumber, phoneHash, createdAt: new Date(), updatedAt: new Date() };
      const mockSession = {
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };

      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
      vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);

      // Act
      const result = await sessionManager.createSession({
        phoneNumber,
        phoneHash,
      });

      // Assert
      expect(result).toEqual({
        sessionId: 'session-1',
        userId: 'user-1',
        isNewUser: false,
        isNewSession: false,
      });
      expect(mockUserRepository.createUser).not.toHaveBeenCalled();
      expect(mockSessionRepository.createSession).not.toHaveBeenCalled();
      expect(mockSessionRepository.updateLastActivity).toHaveBeenCalledWith('session-1');
    });
  });

  // ==========================================================================
  // resumeSession Tests
  // ==========================================================================

  describe('resumeSession', () => {
    it('should return null when user does not exist', async () => {
      // Arrange
      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(null);

      // Act
      const result = await sessionManager.resumeSession('+1234567890');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when no active session exists', async () => {
      // Arrange
      const mockUser = {
        userId: 'user-1',
        phoneNumber: '+1234567890',
        phoneHash: 'hash123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
      vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(null);

      // Act
      const result = await sessionManager.resumeSession('+1234567890');

      // Assert
      expect(result).toBeNull();
    });

    it('should load session from State_Store when available', async () => {
      // Arrange
      const mockUser = {
        userId: 'user-1',
        phoneNumber: '+1234567890',
        phoneHash: 'hash123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockSession = {
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber: '+1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };
      const mockSessionState: SessionState = {
        currentIntent: 'search_hotels',
        activeSchema: 'hotel_search',
        missingFields: ['checkin_date'],
        collectedFields: { location: 'Galle' },
      };
      const mockProfile = {
        userId: 'user-1',
        preferredLanguage: 'en',
        preferredCurrency: 'USD',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockPreferences = {
        userId: 'user-1',
        ttsEnabled: false,
        proactiveMessagingEnabled: false,
        notificationPreferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockLanguageSettings = {
        userId: 'user-1',
        recentActions: [],
        frequentServices: [],
        commonDestinations: [],
        preferredVendors: [],
        pastBookings: [],
        timingPatterns: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
      vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
      vi.mocked(mockStateStore.getSessionState).mockResolvedValue(mockSessionState);
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
      vi.mocked(mockUserRepository.getProfile).mockResolvedValue(mockProfile);
      vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(mockPreferences);
      vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(mockLanguageSettings);

      // Act
      const result = await sessionManager.resumeSession('+1234567890');

      // Assert
      expect(result).toBeDefined();
      expect(result?.sessionId).toBe('session-1');
      expect(result?.activeFlowState.currentIntent).toBe('search_hotels');
      expect(mockStateStore.getSessionState).toHaveBeenCalledWith('session-1');
      expect(mockSessionRepository.getState).not.toHaveBeenCalled();
    });

    it('should fallback to Durable_Store when State_Store is empty', async () => {
      // Arrange
      const mockUser = {
        userId: 'user-1',
        phoneNumber: '+1234567890',
        phoneHash: 'hash123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockSession = {
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber: '+1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };
      const mockStateData = {
        sessionId: 'session-1',
        currentIntent: 'search_hotels',
        activeSchema: 'hotel_search',
        missingFields: ['checkin_date'],
        collectedFields: { location: 'Galle' },
        pendingOptions: [],
        conversationHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockProfile = {
        userId: 'user-1',
        preferredLanguage: 'en',
        preferredCurrency: 'USD',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockPreferences = {
        userId: 'user-1',
        ttsEnabled: false,
        proactiveMessagingEnabled: false,
        notificationPreferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockLanguageSettings = {
        userId: 'user-1',
        recentActions: [],
        frequentServices: [],
        commonDestinations: [],
        preferredVendors: [],
        pastBookings: [],
        timingPatterns: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
      vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
      vi.mocked(mockStateStore.getSessionState).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      vi.mocked(mockSessionRepository.getState).mockResolvedValue(mockStateData);
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
      vi.mocked(mockUserRepository.getProfile).mockResolvedValue(mockProfile);
      vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(mockPreferences);
      vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(mockLanguageSettings);

      // Act
      const result = await sessionManager.resumeSession('+1234567890');

      // Assert
      expect(result).toBeDefined();
      expect(result?.sessionId).toBe('session-1');
      expect(result?.activeFlowState.currentIntent).toBe('search_hotels');
      expect(mockStateStore.getSessionState).toHaveBeenCalled();
      expect(mockSessionRepository.getState).toHaveBeenCalledWith('session-1');
      expect(mockStateStore.setSessionState).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // assembleContextPackage Tests
  // ==========================================================================

  describe('assembleContextPackage', () => {
    it('should assemble complete context package', async () => {
      // Arrange
      const mockSession = {
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber: '+1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };
      const mockProfile = {
        userId: 'user-1',
        name: 'John Doe',
        nationality: 'US',
        preferredLanguage: 'en',
        homeLocation: 'New York',
        preferredCurrency: 'USD',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockPreferences = {
        userId: 'user-1',
        ttsEnabled: true,
        proactiveMessagingEnabled: false,
        notificationPreferences: { booking: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockLanguageSettings = {
        userId: 'user-1',
        recentActions: ['search_hotels'],
        frequentServices: ['hotels'],
        commonDestinations: ['Galle', 'Colombo'],
        preferredVendors: ['vendor-1'],
        pastBookings: ['booking-1'],
        timingPatterns: { weekend: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockSessionState: SessionState = {
        currentIntent: 'search_hotels',
        activeSchema: 'hotel_search',
        schemaVersion: '1.0',
        missingFields: ['checkin_date'],
        collectedFields: { location: 'Galle' },
      };

      vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
      vi.mocked(mockUserRepository.getProfile).mockResolvedValue(mockProfile);
      vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(mockPreferences);
      vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(mockLanguageSettings);
      vi.mocked(mockStateStore.getSessionState).mockResolvedValue(mockSessionState);

      // Act
      const result = await sessionManager.assembleContextPackage('session-1');

      // Assert
      expect(result).toEqual({
        sessionId: 'session-1',
        userId: 'user-1',
        userProfile: {
          name: 'John Doe',
          nationality: 'US',
          preferredLanguage: 'en',
          homeLocation: 'New York',
          preferredCurrency: 'USD',
          communicationPreferences: {
            ttsEnabled: true,
            proactiveMessagingEnabled: false,
            notificationPreferences: { booking: true },
          },
        },
        behavioralSummary: {
          recentActions: ['search_hotels'],
          frequentServices: ['hotels'],
          commonDestinations: ['Galle', 'Colombo'],
          preferredVendors: ['vendor-1'],
          pastBookings: ['booking-1'],
          timingPatterns: { weekend: true },
        },
        activeFlowState: mockSessionState,
        schemaProgress: {
          activeSchema: 'hotel_search',
          schemaVersion: '1.0',
          missingFields: ['checkin_date'],
          collectedFields: { location: 'Galle' },
        },
      });
    });

    it('should throw error when session not found', async () => {
      // Arrange
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(null);

      // Act & Assert
      await expect(sessionManager.assembleContextPackage('invalid-session')).rejects.toThrow(
        'Session not found: invalid-session'
      );
    });
  });

  // ==========================================================================
  // appendMessage Tests
  // ==========================================================================

  describe('appendMessage', () => {
    it('should persist message to both stores', async () => {
      // Arrange
      const mockSession = {
        sessionId: 'session-1',
        userId: 'user-1',
        phoneNumber: '+1234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
      };
      const mockSessionState: SessionState = {
        missingFields: [],
        collectedFields: {},
      };
      const message = {
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user' as const,
        content: { body: 'Hello' },
        metadata: { source: 'whatsapp' },
      };

      vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
      vi.mocked(mockStateStore.getSessionState).mockResolvedValue(mockSessionState);

      // Act
      await sessionManager.appendMessage('session-1', message);

      // Assert
      expect(mockMessageRepository.createMessage).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userId: 'user-1',
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { body: 'Hello' },
        metadata: { source: 'whatsapp' },
      });
      expect(mockSessionRepository.appendConversationHistory).toHaveBeenCalled();
      expect(mockStateStore.setSessionState).toHaveBeenCalled();
      expect(mockSessionRepository.updateLastActivity).toHaveBeenCalledWith('session-1');
    });

    it('should throw error when session not found', async () => {
      // Arrange
      vi.mocked(mockSessionRepository.findById).mockResolvedValue(null);

      const message = {
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user' as const,
        content: { body: 'Hello' },
      };

      // Act & Assert
      await expect(sessionManager.appendMessage('invalid-session', message)).rejects.toThrow(
        'Session not found: invalid-session'
      );
    });
  });

  // ==========================================================================
  // updateSessionState Tests
  // ==========================================================================

  describe('updateSessionState', () => {
    it('should update state in both stores', async () => {
      // Arrange
      const currentState: SessionState = {
        currentIntent: 'search_hotels',
        missingFields: ['checkin_date'],
        collectedFields: { location: 'Galle' },
      };
      const updates: Partial<SessionState> = {
        missingFields: [],
        collectedFields: { location: 'Galle', checkin_date: '2026-04-17' },
      };

      vi.mocked(mockStateStore.getSessionState).mockResolvedValue(currentState);

      // Act
      await sessionManager.updateSessionState('session-1', updates);

      // Assert
      expect(mockStateStore.setSessionState).toHaveBeenCalledWith('session-1', {
        currentIntent: 'search_hotels',
        missingFields: [],
        collectedFields: { location: 'Galle', checkin_date: '2026-04-17' },
      });
      expect(mockSessionRepository.updateState).toHaveBeenCalledWith('session-1', updates);
      expect(mockSessionRepository.updateLastActivity).toHaveBeenCalledWith('session-1');
    });
  });
});
