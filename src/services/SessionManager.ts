/**
 * SessionManager Service
 * Manages session lifecycle and context assembly
 * 
 * Validates: Requirements 1.3, 1.4, 1.6, 1.8, 16.3
 */

import { UserRepository } from '../db/repositories/UserRepository.js';
import { SessionRepository } from '../db/repositories/SessionRepository.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { StateStore } from './StateStore.js';
import { getStateStore } from './StateStore.js';
import { logger } from '../config/logger.js';
import type {
  SessionState,
  UserProfile,
  BehavioralMemory,
  CommunicationPreferences,
} from '../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface ContextPackage {
  sessionId: string;
  userId: string;
  userProfile: UserProfileSummary;
  behavioralSummary: BehavioralMemory;
  activeFlowState: SessionState;
  schemaProgress: SchemaProgress;
}

export interface UserProfileSummary {
  name?: string;
  nationality?: string;
  preferredLanguage: string;
  homeLocation?: string;
  preferredCurrency: string;
  communicationPreferences: CommunicationPreferences;
}

export interface SchemaProgress {
  activeSchema?: string;
  schemaVersion?: string;
  missingFields: string[];
  collectedFields: Record<string, unknown>;
}

export interface CreateSessionResult {
  sessionId: string;
  userId: string;
  isNewUser: boolean;
  isNewSession: boolean;
}

// ============================================================================
// SessionManager Class
// ============================================================================

export class SessionManager {
  constructor(
    private userRepository: UserRepository,
    private sessionRepository: SessionRepository,
    private messageRepository: MessageRepository,
    private stateStore: StateStore
  ) {}

  /**
   * Create a new session and user if necessary
   * Idempotent: Returns existing session/user if already exists
   * 
   * Validates: Requirement 1.3
   */
  async createSession(data: {
    phoneNumber: string;
    phoneHash: string;
    preferredLanguage?: string;
    preferredCurrency?: string;
  }): Promise<CreateSessionResult> {
    const { phoneNumber, phoneHash, preferredLanguage = 'en', preferredCurrency = 'USD' } = data;

    logger.debug('SessionManager', 'Creating session', {
      phoneNumber,
      preferredLanguage,
      preferredCurrency,
    });

    // Check if user exists
    let user = await this.userRepository.findByPhoneNumber(phoneNumber);
    const isNewUser = !user;

    // Create user if doesn't exist
    if (!user) {
      logger.debug('SessionManager', 'Creating new user', { phoneNumber });
      user = await this.userRepository.createUser(
        phoneNumber,
        phoneHash,
        preferredLanguage,
        preferredCurrency
      );
      logger.info('SessionManager', 'New user created', {
        userId: user.userId,
        phoneNumber,
        preferredLanguage,
      });
    } else {
      logger.debug('SessionManager', 'User already exists', { userId: user.userId, phoneNumber });
    }

    // Check for active session
    let session = await this.sessionRepository.findActiveByUserId(user.userId);
    const isNewSession = !session;

    // Create session if doesn't exist or no active session
    if (!session) {
      logger.debug('SessionManager', 'Creating new session', { userId: user.userId });
      session = await this.sessionRepository.createSession(user.userId, phoneNumber);
      logger.info('SessionManager', 'New session created', {
        sessionId: session.sessionId,
        userId: user.userId,
      });
    } else {
      // Update last activity for existing session
      logger.debug('SessionManager', 'Session already exists, updating activity', {
        sessionId: session.sessionId,
      });
      await this.sessionRepository.updateLastActivity(session.sessionId);
    }

    return {
      sessionId: session.sessionId,
      userId: user.userId,
      isNewUser,
      isNewSession,
    };
  }

  /**
   * Resume a session by phone number
   * Loads session from State_Store, falls back to Durable_Store
   * 
   * Validates: Requirement 1.4
   */
  async resumeSession(phoneNumber: string): Promise<ContextPackage | null> {
    logger.debug('SessionManager', 'Resuming session', { phoneNumber });

    // Find user by phone number
    const user = await this.userRepository.findByPhoneNumber(phoneNumber);
    if (!user) {
      logger.warn('SessionManager', 'User not found', { phoneNumber });
      return null;
    }

    // Find active session
    const session = await this.sessionRepository.findActiveByUserId(user.userId);
    if (!session) {
      logger.debug('SessionManager', 'No active session found', { userId: user.userId });
      return null;
    }

    logger.debug('SessionManager', 'Active session found', {
      sessionId: session.sessionId,
      userId: user.userId,
    });

    // Try to load from State_Store first
    let sessionState = await this.stateStore.getSessionState(session.sessionId);

    // Fallback to Durable_Store if not in State_Store
    if (!sessionState) {
      logger.debug('SessionManager', 'Session state not in State_Store, checking Durable_Store');
      const stateData = await this.sessionRepository.getState(session.sessionId);
      if (stateData) {
        sessionState = {
          currentIntent: stateData.currentIntent,
          currentStep: stateData.currentStep,
          activeSchema: stateData.activeSchema,
          schemaVersion: stateData.schemaVersion,
          missingFields: stateData.missingFields,
          collectedFields: stateData.collectedFields,
          pendingOptions: stateData.pendingOptions as any,
          bookingProgress: stateData.bookingProgress as any,
          paymentProgress: stateData.paymentProgress as any,
        };

        logger.debug('SessionManager', 'Session state restored from Durable_Store');

        // Restore to State_Store for future access
        await this.stateStore.setSessionState(session.sessionId, sessionState);
      }
    }

    // If still no state, create empty state
    if (!sessionState) {
      logger.debug('SessionManager', 'No session state found, creating empty state');
      sessionState = {
        missingFields: [],
        collectedFields: {},
      };
    }

    logger.info('SessionManager', 'Session resumed successfully', {
      sessionId: session.sessionId,
      userId: user.userId,
    });

    // Assemble and return context package
    return this.assembleContextPackage(session.sessionId);
  }

  /**
   * Assemble a complete context package for a session
   * Returns user profile, behavioral summary, active flow state, and schema progress
   * 
   * Validates: Requirement 1.8, 16.3
   */
  async assembleContextPackage(sessionId: string): Promise<ContextPackage> {
    logger.debug('SessionManager', 'Assembling context package', { sessionId });

    // Load session
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      logger.error('SessionManager', 'Session not found', { sessionId });
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Load user profile
    const profile = await this.userRepository.getProfile(session.userId);
    if (!profile) {
      logger.error('SessionManager', 'User profile not found', { userId: session.userId });
      throw new Error(`User profile not found for user: ${session.userId}`);
    }

    // Load user preferences
    const preferences = await this.userRepository.getPreferences(session.userId);
    if (!preferences) {
      logger.error('SessionManager', 'User preferences not found', { userId: session.userId });
      throw new Error(`User preferences not found for user: ${session.userId}`);
    }

    // Load behavioral memory (language settings)
    const languageSettings = await this.userRepository.getLanguageSettings(session.userId);
    if (!languageSettings) {
      logger.error('SessionManager', 'Language settings not found', { userId: session.userId });
      throw new Error(`User language settings not found for user: ${session.userId}`);
    }

    // Load session state from State_Store first, fallback to Durable_Store
    let sessionState = await this.stateStore.getSessionState(sessionId);
    if (!sessionState) {
      const stateData = await this.sessionRepository.getState(sessionId);
      if (stateData) {
        sessionState = {
          currentIntent: stateData.currentIntent,
          currentStep: stateData.currentStep,
          activeSchema: stateData.activeSchema,
          schemaVersion: stateData.schemaVersion,
          missingFields: stateData.missingFields,
          collectedFields: stateData.collectedFields,
          pendingOptions: stateData.pendingOptions as any,
          bookingProgress: stateData.bookingProgress as any,
          paymentProgress: stateData.paymentProgress as any,
        };
      }
    }

    // Default empty state if not found
    if (!sessionState) {
      sessionState = {
        missingFields: [],
        collectedFields: {},
      };
    }

    // Assemble context package
    const contextPackage: ContextPackage = {
      sessionId: session.sessionId,
      userId: session.userId,
      userProfile: {
        name: profile.name,
        nationality: profile.nationality,
        preferredLanguage: profile.preferredLanguage,
        homeLocation: profile.homeLocation,
        preferredCurrency: profile.preferredCurrency,
        communicationPreferences: {
          ttsEnabled: preferences.ttsEnabled,
          proactiveMessagingEnabled: preferences.proactiveMessagingEnabled,
          notificationPreferences: preferences.notificationPreferences,
        },
      },
      behavioralSummary: {
        recentActions: languageSettings.recentActions,
        frequentServices: languageSettings.frequentServices,
        commonDestinations: languageSettings.commonDestinations,
        preferredVendors: languageSettings.preferredVendors,
        pastBookings: languageSettings.pastBookings,
        timingPatterns: languageSettings.timingPatterns,
      },
      activeFlowState: sessionState,
      schemaProgress: {
        activeSchema: sessionState.activeSchema,
        schemaVersion: sessionState.schemaVersion,
        missingFields: sessionState.missingFields,
        collectedFields: sessionState.collectedFields,
      },
    };

    return contextPackage;
  }

  /**
   * Append a message to the session
   * Persists to Durable_Store and updates State_Store
   * 
   * Validates: Requirement 1.6
   */
  async appendMessage(
    sessionId: string,
    message: {
      correlationId: string;
      fromNumber: string;
      toNumber: string;
      messageType: string;
      role: 'user' | 'assistant' | 'system';
      content: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    logger.debug('SessionManager', 'Appending message to session', {
      sessionId,
      correlationId: message.correlationId,
      role: message.role,
      messageType: message.messageType,
    });

    // Load session to get userId
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      logger.error('SessionManager', 'Session not found for appending message', { sessionId });
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Persist message to Durable_Store (idempotent via correlation_id)
    await this.messageRepository.createMessage({
      sessionId,
      userId: session.userId,
      correlationId: message.correlationId,
      fromNumber: message.fromNumber,
      toNumber: message.toNumber,
      messageType: message.messageType,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
    });

    logger.debug('SessionManager', 'Message persisted to Durable_Store', {
      sessionId,
      correlationId: message.correlationId,
    });

    // Update conversation history in session state (Durable_Store)
    await this.sessionRepository.appendConversationHistory(sessionId, {
      role: message.role,
      content: message.content,
      timestamp: new Date(),
      metadata: message.metadata,
    });

    // Update State_Store with latest conversation entry
    const sessionState = await this.stateStore.getSessionState(sessionId);
    if (sessionState) {
      // State_Store doesn't maintain full conversation history, just update timestamp
      await this.stateStore.setSessionState(sessionId, sessionState);
    }

    // Update session last activity
    await this.sessionRepository.updateLastActivity(sessionId);

    logger.info('SessionManager', 'Message appended successfully', {
      sessionId,
      correlationId: message.correlationId,
    });
  }

  /**
   * Update session state in both State_Store and Durable_Store
   */
  async updateSessionState(
    sessionId: string,
    updates: Partial<SessionState>
  ): Promise<void> {
    logger.debug('SessionManager', 'Updating session state', {
      sessionId,
      updates: Object.keys(updates),
    });

    // Update State_Store
    const currentState = await this.stateStore.getSessionState(sessionId);
    const newState: SessionState = {
      ...currentState,
      ...updates,
      missingFields: updates.missingFields ?? currentState?.missingFields ?? [],
      collectedFields: updates.collectedFields ?? currentState?.collectedFields ?? {},
    };
    await this.stateStore.setSessionState(sessionId, newState);

    // Update Durable_Store
    await this.sessionRepository.updateState(sessionId, updates as any);

    // Update session last activity
    await this.sessionRepository.updateLastActivity(sessionId);

    logger.debug('SessionManager', 'Session state updated', {
      sessionId,
      currentIntent: newState.currentIntent,
      missingFieldsCount: newState.missingFields.length,
    });
  }

  /**
   * Update user's preferred language in profile
   * Stores the detected language preference for all subsequent interactions
   * 
   * Validates: Requirement 10.2
   * 
   * @param userId - User ID
   * @param language - Detected language code (e.g., 'en', 'fr', 'es', 'si', 'ta')
   */
  async updatePreferredLanguage(userId: string, language: string): Promise<void> {
    logger.debug('SessionManager', 'Updating preferred language', { userId, language });
    await this.userRepository.updateProfile(userId, {
      preferredLanguage: language,
    });
    logger.info('SessionManager', 'Preferred language updated', { userId, language });
  }

  /**
   * Get user's preferred language from profile
   * 
   * @param userId - User ID
   * @returns Language code or null if user not found
   */
  async getPreferredLanguage(userId: string): Promise<string | null> {
    logger.debug('SessionManager', 'Getting preferred language', { userId });
    const profile = await this.userRepository.getProfile(userId);
    const language = profile?.preferredLanguage ?? null;
    logger.debug('SessionManager', 'Preferred language retrieved', { userId, language });
    return language;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sessionManagerInstance: SessionManager | null = null;

/**
 * Gets the singleton SessionManager instance
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(
      new UserRepository(),
      new SessionRepository(),
      new MessageRepository(),
      getStateStore()
    );
  }
  return sessionManagerInstance;
}

