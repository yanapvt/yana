/**
 * Property Test 2: Session State Round-Trip
 * 
 * Property Statement:
 * For any user session with stored state (active schema, conversation history, flow progress), 
 * sending a new message SHALL result in the Session_Manager loading and returning a context 
 * package that contains all previously stored state components.
 * 
 * **Validates: Requirements 1.4, 1.8, 16.3**
 * 
 * Requirements:
 * - 1.4: WHEN a valid inbound message is received from a returning user, THE Session_Manager 
 *        SHALL resume the prior session context including active flow state, schema progress, 
 *        and conversation history
 * - 1.8: WHEN a session is loaded, THE Session_Manager SHALL assemble a context package 
 *        including user profile, behavioral summary, active flow state, and schema progress
 * - 16.3: THE Session_Manager SHALL load active session state from the State_Store and fall 
 *         back to the Durable_Store when the State_Store entry has expired
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../../services/SessionManager.js';
import { UserRepository } from '../../db/repositories/UserRepository.js';
import { SessionRepository } from '../../db/repositories/SessionRepository.js';
import { MessageRepository } from '../../db/repositories/MessageRepository.js';
import { StateStore } from '../../services/StateStore.js';
import type { SessionState, BookingState, PaymentState } from '../../types/core.js';

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary phone numbers
 */
const phoneNumberArb = fc.stringMatching(/^\+[1-9][0-9]{7,14}$/);

/**
 * Generates arbitrary user IDs
 */
const userIdArb = fc.uuid();

/**
 * Generates arbitrary session IDs
 */
const sessionIdArb = fc.uuid();

/**
 * Generates arbitrary schema names
 */
const schemaNameArb = fc.constantFrom(
  'search_hotels',
  'book_hotel',
  'search_transport',
  'book_excursion'
);

/**
 * Generates arbitrary schema versions
 */
const schemaVersionArb = fc.constantFrom('1.0', '1.1', '2.0', '2.1');

/**
 * Generates arbitrary field names
 */
const fieldNameArb = fc.constantFrom(
  'location',
  'checkin_date',
  'checkout_date',
  'guests',
  'budget',
  'currency',
  'destination',
  'departure_date'
);

/**
 * Generates arbitrary field values
 */
const fieldValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.date(),
  fc.constant(null),
  fc.constant(undefined)
);

/**
 * Generates arbitrary collected fields
 */
const collectedFieldsArb = fc.dictionary(fieldNameArb, fieldValueArb, {
  minKeys: 0,
  maxKeys: 5,
});

/**
 * Generates arbitrary missing fields
 */
const missingFieldsArb = fc.array(fieldNameArb, { minLength: 0, maxLength: 5 });

/**
 * Generates arbitrary booking progress
 */
const bookingProgressArb = fc.record({
  bookingId: fc.option(fc.uuid(), { nil: undefined }),
  state: fc.constantFrom<BookingState>(
    'initiated',
    'hold_requested',
    'hold_confirmed',
    'payment_pending',
    'confirmed',
    'cancelled',
    'timed_out'
  ),
  selectedService: fc.option(fc.object(), { nil: undefined }),
});

/**
 * Generates arbitrary payment progress
 */
const paymentProgressArb = fc.record({
  paymentId: fc.option(fc.uuid(), { nil: undefined }),
  state: fc.constantFrom<PaymentState>(
    'initiated',
    'pending',
    'succeeded',
    'failed',
    'timed_out',
    'refunded_or_cancelled'
  ),
  amount: fc.option(fc.double({ min: 0, max: 10000 }), { nil: undefined }),
  currency: fc.option(fc.constantFrom('USD', 'EUR', 'GBP', 'LKR'), { nil: undefined }),
});

/**
 * Generates arbitrary session state
 */
const sessionStateArb: fc.Arbitrary<SessionState> = fc.record({
  currentIntent: fc.option(schemaNameArb, { nil: undefined }),
  currentStep: fc.option(fc.string(), { nil: undefined }),
  activeSchema: fc.option(schemaNameArb, { nil: undefined }),
  schemaVersion: fc.option(schemaVersionArb, { nil: undefined }),
  missingFields: missingFieldsArb,
  collectedFields: collectedFieldsArb,
  pendingOptions: fc.option(
    fc.array(
      fc.record({
        id: fc.string(),
        title: fc.string(),
        description: fc.option(fc.string(), { nil: undefined }),
      }),
      { minLength: 0, maxLength: 3 }
    ),
    { nil: undefined }
  ),
  bookingProgress: fc.option(bookingProgressArb, { nil: undefined }),
  paymentProgress: fc.option(paymentProgressArb, { nil: undefined }),
});

/**
 * Generates arbitrary user profile data
 */
const userProfileArb = fc.record({
  userId: userIdArb,
  name: fc.option(fc.string({ minLength: 1, maxLength: 80 }), { nil: undefined }),
  nationality: fc.option(fc.constantFrom('US', 'UK', 'LK', 'IN', 'AU'), { nil: undefined }),
  preferredLanguage: fc.constantFrom('en', 'es', 'fr', 'de', 'si', 'ta'),
  homeLocation: fc.option(fc.constantFrom('Colombo', 'Galle', 'Kandy', 'Ella', 'Mirissa'), { nil: undefined }),
  preferredCurrency: fc.constantFrom('USD', 'EUR', 'GBP', 'LKR'),
  createdAt: fc.date(),
  updatedAt: fc.date(),
});

/**
 * Generates arbitrary user preferences
 */
const userPreferencesArb = fc.record({
  userId: userIdArb,
  ttsEnabled: fc.boolean(),
  proactiveMessagingEnabled: fc.boolean(),
  notificationPreferences: fc.dictionary(fc.string(), fc.boolean(), {
    minKeys: 0,
    maxKeys: 3,
  }),
  createdAt: fc.date(),
  updatedAt: fc.date(),
});

/**
 * Generates arbitrary behavioral memory
 */
const behavioralMemoryArb = fc.record({
  userId: userIdArb,
  recentActions: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  frequentServices: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  commonDestinations: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  preferredVendors: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  pastBookings: fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  timingPatterns: fc.dictionary(fc.string(), fc.anything(), { minKeys: 0, maxKeys: 3 }),
  createdAt: fc.date(),
  updatedAt: fc.date(),
});

/**
 * Generates a complete session context with all components
 */
const sessionContextArb = fc.record({
  phoneNumber: phoneNumberArb,
  userId: userIdArb,
  sessionId: sessionIdArb,
  sessionState: sessionStateArb,
  userProfile: userProfileArb,
  userPreferences: userPreferencesArb,
  behavioralMemory: behavioralMemoryArb,
});

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 2: Session State Round-Trip', () => {
  let mockUserRepository: UserRepository;
  let mockSessionRepository: SessionRepository;
  let mockMessageRepository: MessageRepository;
  let mockStateStore: StateStore;
  let sessionManager: SessionManager;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockUserRepository = {
      findByPhoneNumber: vi.fn(),
      createUser: vi.fn(),
      getProfile: vi.fn(),
      getPreferences: vi.fn(),
      getLanguageSettings: vi.fn(),
    } as unknown as UserRepository;

    mockSessionRepository = {
      findActiveByUserId: vi.fn(),
      createSession: vi.fn(),
      updateLastActivity: vi.fn(),
      findById: vi.fn(),
      getState: vi.fn(),
      updateState: vi.fn(),
      appendConversationHistory: vi.fn(),
    } as unknown as SessionRepository;

    mockMessageRepository = {
      createMessage: vi.fn(),
    } as unknown as MessageRepository;

    mockStateStore = {
      getSessionState: vi.fn(),
      setSessionState: vi.fn(),
    } as unknown as StateStore;

    sessionManager = new SessionManager(
      mockUserRepository,
      mockSessionRepository,
      mockMessageRepository,
      mockStateStore
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should load and return all stored state components from State_Store', () => {
    return fc.assert(
      fc.asyncProperty(sessionContextArb, async (context) => {
        // Given: A session with stored state in State_Store
        const mockUser = {
          userId: context.userId,
          phoneNumber: context.phoneNumber,
          phoneHash: 'hash123',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSession = {
          sessionId: context.sessionId,
          userId: context.userId,
          phoneNumber: context.phoneNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
        vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(context.sessionState);
        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockUserRepository.getProfile).mockResolvedValue(context.userProfile);
        vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(context.userPreferences);
        vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(
          context.behavioralMemory
        );

        // When: We resume the session
        const result = await sessionManager.resumeSession(context.phoneNumber);

        // Then: The context package should contain all stored state components
        expect(result).not.toBeNull();
        expect(result?.sessionId).toBe(context.sessionId);
        expect(result?.userId).toBe(context.userId);

        // Verify user profile components
        expect(result?.userProfile.name).toBe(context.userProfile.name);
        expect(result?.userProfile.nationality).toBe(context.userProfile.nationality);
        expect(result?.userProfile.preferredLanguage).toBe(context.userProfile.preferredLanguage);
        expect(result?.userProfile.homeLocation).toBe(context.userProfile.homeLocation);
        expect(result?.userProfile.preferredCurrency).toBe(context.userProfile.preferredCurrency);

        // Verify communication preferences
        expect(result?.userProfile.communicationPreferences.ttsEnabled).toBe(
          context.userPreferences.ttsEnabled
        );
        expect(result?.userProfile.communicationPreferences.proactiveMessagingEnabled).toBe(
          context.userPreferences.proactiveMessagingEnabled
        );

        // Verify behavioral summary
        expect(result?.behavioralSummary.recentActions).toEqual(
          context.behavioralMemory.recentActions
        );
        expect(result?.behavioralSummary.frequentServices).toEqual(
          context.behavioralMemory.frequentServices
        );
        expect(result?.behavioralSummary.commonDestinations).toEqual(
          context.behavioralMemory.commonDestinations
        );
        expect(result?.behavioralSummary.preferredVendors).toEqual(
          context.behavioralMemory.preferredVendors
        );
        expect(result?.behavioralSummary.pastBookings).toEqual(
          context.behavioralMemory.pastBookings
        );

        // Verify active flow state
        expect(result?.activeFlowState.currentIntent).toBe(context.sessionState.currentIntent);
        expect(result?.activeFlowState.currentStep).toBe(context.sessionState.currentStep);
        expect(result?.activeFlowState.activeSchema).toBe(context.sessionState.activeSchema);
        expect(result?.activeFlowState.schemaVersion).toBe(context.sessionState.schemaVersion);
        expect(result?.activeFlowState.missingFields).toEqual(context.sessionState.missingFields);
        expect(result?.activeFlowState.collectedFields).toEqual(
          context.sessionState.collectedFields
        );

        // Verify schema progress
        expect(result?.schemaProgress.activeSchema).toBe(context.sessionState.activeSchema);
        expect(result?.schemaProgress.schemaVersion).toBe(context.sessionState.schemaVersion);
        expect(result?.schemaProgress.missingFields).toEqual(context.sessionState.missingFields);
        expect(result?.schemaProgress.collectedFields).toEqual(
          context.sessionState.collectedFields
        );

        // Verify State_Store was checked first
        expect(mockStateStore.getSessionState).toHaveBeenCalledWith(context.sessionId);
        expect(mockSessionRepository.getState).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });

  it('should fallback to Durable_Store when State_Store is empty', () => {
    return fc.assert(
      fc.asyncProperty(sessionContextArb, async (context) => {
        // Given: A session with state only in Durable_Store (State_Store expired)
        const mockUser = {
          userId: context.userId,
          phoneNumber: context.phoneNumber,
          phoneHash: 'hash123',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSession = {
          sessionId: context.sessionId,
          userId: context.userId,
          phoneNumber: context.phoneNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        const mockStateData = {
          sessionId: context.sessionId,
          ...context.sessionState,
          conversationHistory: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
        vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null); // State_Store empty
        vi.mocked(mockSessionRepository.getState).mockResolvedValue(mockStateData);
        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockUserRepository.getProfile).mockResolvedValue(context.userProfile);
        vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(context.userPreferences);
        vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(
          context.behavioralMemory
        );

        // When: We resume the session
        const result = await sessionManager.resumeSession(context.phoneNumber);

        // Then: The context package should contain all stored state components from Durable_Store
        expect(result).not.toBeNull();
        expect(result?.sessionId).toBe(context.sessionId);

        // Verify active flow state was loaded from Durable_Store
        expect(result?.activeFlowState.currentIntent).toBe(context.sessionState.currentIntent);
        expect(result?.activeFlowState.activeSchema).toBe(context.sessionState.activeSchema);
        expect(result?.activeFlowState.missingFields).toEqual(context.sessionState.missingFields);
        expect(result?.activeFlowState.collectedFields).toEqual(
          context.sessionState.collectedFields
        );

        // Verify fallback occurred
        expect(mockStateStore.getSessionState).toHaveBeenCalled();
        expect(mockSessionRepository.getState).toHaveBeenCalledWith(context.sessionId);

        // Verify state was restored to State_Store
        expect(mockStateStore.setSessionState).toHaveBeenCalledWith(
          context.sessionId,
          expect.objectContaining({
            currentIntent: context.sessionState.currentIntent,
            activeSchema: context.sessionState.activeSchema,
            missingFields: context.sessionState.missingFields,
            collectedFields: context.sessionState.collectedFields,
          })
        );
      }),
      { numRuns: 50 }
    );
  });

  it('should preserve all session state components through update and reload cycle', () => {
    return fc.assert(
      fc.asyncProperty(
        sessionContextArb,
        sessionStateArb,
        async (initialContext, updatedState) => {
          // Given: A session with initial state
          const mockUser = {
            userId: initialContext.userId,
            phoneNumber: initialContext.phoneNumber,
            phoneHash: 'hash123',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const mockSession = {
            sessionId: initialContext.sessionId,
            userId: initialContext.userId,
            phoneNumber: initialContext.phoneNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          };

          // Setup initial state
          vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
          vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
          vi.mocked(mockStateStore.getSessionState)
            .mockResolvedValueOnce(initialContext.sessionState)
            .mockResolvedValueOnce(initialContext.sessionState)
            .mockResolvedValueOnce(updatedState); // After update
          vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
          vi.mocked(mockUserRepository.getProfile).mockResolvedValue(initialContext.userProfile);
          vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(
            initialContext.userPreferences
          );
          vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(
            initialContext.behavioralMemory
          );

          // When: We update the session state
          await sessionManager.updateSessionState(initialContext.sessionId, updatedState);

          // And: We reload the session
          const result = await sessionManager.resumeSession(initialContext.phoneNumber);

          // Then: The reloaded state should match the updated state
          expect(result).not.toBeNull();
          expect(result?.activeFlowState.currentIntent).toBe(updatedState.currentIntent);
          expect(result?.activeFlowState.currentStep).toBe(updatedState.currentStep);
          expect(result?.activeFlowState.activeSchema).toBe(updatedState.activeSchema);
          expect(result?.activeFlowState.schemaVersion).toBe(updatedState.schemaVersion);
          expect(result?.activeFlowState.missingFields).toEqual(updatedState.missingFields);
          expect(result?.activeFlowState.collectedFields).toEqual(updatedState.collectedFields);

          // Verify both stores were updated
          expect(mockStateStore.setSessionState).toHaveBeenCalledWith(
            initialContext.sessionId,
            expect.objectContaining({
              currentIntent: updatedState.currentIntent,
              missingFields: updatedState.missingFields,
              collectedFields: updatedState.collectedFields,
            })
          );
          expect(mockSessionRepository.updateState).toHaveBeenCalledWith(
            initialContext.sessionId,
            updatedState
          );
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should maintain state consistency across multiple resume operations', () => {
    return fc.assert(
      fc.asyncProperty(sessionContextArb, async (context) => {
        // Given: A session with stored state
        const mockUser = {
          userId: context.userId,
          phoneNumber: context.phoneNumber,
          phoneHash: 'hash123',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSession = {
          sessionId: context.sessionId,
          userId: context.userId,
          phoneNumber: context.phoneNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
        vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(context.sessionState);
        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockUserRepository.getProfile).mockResolvedValue(context.userProfile);
        vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(context.userPreferences);
        vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(
          context.behavioralMemory
        );

        // When: We resume the session multiple times
        const result1 = await sessionManager.resumeSession(context.phoneNumber);
        const result2 = await sessionManager.resumeSession(context.phoneNumber);
        const result3 = await sessionManager.resumeSession(context.phoneNumber);

        // Then: All results should be identical
        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();
        expect(result3).not.toBeNull();

        // Verify session IDs match
        expect(result1?.sessionId).toBe(result2?.sessionId);
        expect(result2?.sessionId).toBe(result3?.sessionId);

        // Verify active flow state is consistent
        expect(result1?.activeFlowState).toEqual(result2?.activeFlowState);
        expect(result2?.activeFlowState).toEqual(result3?.activeFlowState);

        // Verify schema progress is consistent
        expect(result1?.schemaProgress).toEqual(result2?.schemaProgress);
        expect(result2?.schemaProgress).toEqual(result3?.schemaProgress);

        // Verify user profile is consistent
        expect(result1?.userProfile).toEqual(result2?.userProfile);
        expect(result2?.userProfile).toEqual(result3?.userProfile);
      }),
      { numRuns: 30 }
    );
  });

  it('should handle empty session state gracefully', () => {
    return fc.assert(
      fc.asyncProperty(phoneNumberArb, userIdArb, sessionIdArb, async (phoneNumber, userId, sessionId) => {
        // Given: A session with no stored state (new session)
        const mockUser = {
          userId,
          phoneNumber,
          phoneHash: 'hash123',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSession = {
          sessionId,
          userId,
          phoneNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        const mockProfile = {
          userId,
          preferredLanguage: 'en',
          preferredCurrency: 'USD',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockPreferences = {
          userId,
          ttsEnabled: false,
          proactiveMessagingEnabled: false,
          notificationPreferences: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockLanguageSettings = {
          userId,
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
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);
        vi.mocked(mockSessionRepository.getState).mockResolvedValue(null);
        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockUserRepository.getProfile).mockResolvedValue(mockProfile);
        vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(mockPreferences);
        vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(mockLanguageSettings);

        // When: We resume the session
        const result = await sessionManager.resumeSession(phoneNumber);

        // Then: The context package should be created with empty state
        expect(result).not.toBeNull();
        expect(result?.sessionId).toBe(sessionId);
        expect(result?.userId).toBe(userId);
        expect(result?.activeFlowState.missingFields).toEqual([]);
        expect(result?.activeFlowState.collectedFields).toEqual({});
        expect(result?.schemaProgress.missingFields).toEqual([]);
        expect(result?.schemaProgress.collectedFields).toEqual({});
      }),
      { numRuns: 30 }
    );
  });

  it('should preserve booking and payment progress through round-trip', () => {
    return fc.assert(
      fc.asyncProperty(
        sessionContextArb,
        bookingProgressArb,
        paymentProgressArb,
        async (context, bookingProgress, paymentProgress) => {
          // Given: A session with booking and payment progress
          const sessionStateWithProgress: SessionState = {
            ...context.sessionState,
            bookingProgress,
            paymentProgress,
          };

          const mockUser = {
            userId: context.userId,
            phoneNumber: context.phoneNumber,
            phoneHash: 'hash123',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const mockSession = {
            sessionId: context.sessionId,
            userId: context.userId,
            phoneNumber: context.phoneNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          };

          vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
          vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
          vi.mocked(mockStateStore.getSessionState).mockResolvedValue(sessionStateWithProgress);
          vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
          vi.mocked(mockUserRepository.getProfile).mockResolvedValue(context.userProfile);
          vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(context.userPreferences);
          vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(
            context.behavioralMemory
          );

          // When: We resume the session
          const result = await sessionManager.resumeSession(context.phoneNumber);

          // Then: Booking and payment progress should be preserved
          expect(result).not.toBeNull();
          expect(result?.activeFlowState.bookingProgress).toEqual(bookingProgress);
          expect(result?.activeFlowState.paymentProgress).toEqual(paymentProgress);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should return null for non-existent users', () => {
    return fc.assert(
      fc.asyncProperty(phoneNumberArb, async (phoneNumber) => {
        // Given: A phone number with no associated user
        vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(null);

        // When: We try to resume the session
        const result = await sessionManager.resumeSession(phoneNumber);

        // Then: Result should be null
        expect(result).toBeNull();
        expect(mockSessionRepository.findActiveByUserId).not.toHaveBeenCalled();
      }),
      { numRuns: 30 }
    );
  });

  it('should return null for users with no active session', () => {
    return fc.assert(
      fc.asyncProperty(phoneNumberArb, userIdArb, async (phoneNumber, userId) => {
        // Given: A user with no active session
        const mockUser = {
          userId,
          phoneNumber,
          phoneHash: 'hash123',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
        vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(null);

        // When: We try to resume the session
        const result = await sessionManager.resumeSession(phoneNumber);

        // Then: Result should be null
        expect(result).toBeNull();
        expect(mockStateStore.getSessionState).not.toHaveBeenCalled();
      }),
      { numRuns: 30 }
    );
  });
});
