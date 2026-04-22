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

    // Check if user exists
    let user = await this.userRepository.findByPhoneNumber(phoneNumber);
    const isNewUser = !user;

    // Create user if doesn't exist
    if (!user) {
      user = await this.userRepository.createUser(
        phoneNumber,
        phoneHash,
        preferredLanguage,
        preferredCurrency
      );
    }

    // Check for active session
    let session = await this.sessionRepository.findActiveByUserId(user.userId);
    const isNewSession = !session;

    // Create session if doesn't exist or no active session
    if (!session) {
      session = await this.sessionRepository.createSession(user.userId, phoneNumber);
    } else {
      // Update last activity for existing session
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
    // Find user by phone number
    const user = await this.userRepository.findByPhoneNumber(phoneNumber);
    if (!user) {
      return null;
    }

    // Find active session
    const session = await this.sessionRepository.findActiveByUserId(user.userId);
    if (!session) {
      return null;
    }

    // Try to load from State_Store first
    let sessionState = await this.stateStore.getSessionState(session.sessionId);

    // Fallback to Durable_Store if not in State_Store
    if (!sessionState) {
      const stateData = await this.sessionRepository.getState(session.sessionId);
      if (stateData) {
        sessionState = {
          currentIntent: stateData.currentIntent,
          currentStep: stateData.currentStep,
          activeSchema: stateData.activeSchema,
          schemaVersion: stateData.schemaVersion,
          missingFields: stateData.missingFields,
          collectedFields: stateData.collectedFields,
          pendingOptions: stateData.pendingOptions,
          bookingProgress: stateData.bookingProgress,
          paymentProgress: stateData.paymentProgress,
        };

        // Restore to State_Store for future access
        await this.stateStore.setSessionState(session.sessionId, sessionState);
      }
    }

    // If still no state, create empty state
    if (!sessionState) {
      sessionState = {
        missingFields: [],
        collectedFields: {},
      };
    }

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
    // Load session
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Load user profile
    const profile = await this.userRepository.getProfile(session.userId);
    if (!profile) {
      throw new Error(`User profile not found for user: ${session.userId}`);
    }

    // Load user preferences
    const preferences = await this.userRepository.getPreferences(session.userId);
    if (!preferences) {
      throw new Error(`User preferences not found for user: ${session.userId}`);
    }

    // Load behavioral memory (language settings)
    const languageSettings = await this.userRepository.getLanguageSettings(session.userId);
    if (!languageSettings) {
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
          pendingOptions: stateData.pendingOptions,
          bookingProgress: stateData.bookingProgress,
          paymentProgress: stateData.paymentProgress,
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
    // Load session to get userId
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
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
  }

  /**
   * Update session state in both State_Store and Durable_Store
   */
  async updateSessionState(
    sessionId: string,
    updates: Partial<SessionState>
  ): Promise<void> {
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
    await this.sessionRepository.updateState(sessionId, updates);

    // Update session last activity
    await this.sessionRepository.updateLastActivity(sessionId);
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
    await this.userRepository.updateProfile(userId, {
      preferredLanguage: language,
    });
  }

  /**
   * Get user's preferred language from profile
   * 
   * @param userId - User ID
   * @returns Language code or null if user not found
   */
  async getPreferredLanguage(userId: string): Promise<string | null> {
    const profile = await this.userRepository.getProfile(userId);
    return profile?.preferredLanguage ?? null;
  }
}

