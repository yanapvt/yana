/**
 * Property Test 3: Message History Persistence
 * 
 * Property Statement:
 * For any processed message, querying the conversation history for that session SHALL 
 * return the message with its original content and metadata.
 * 
 * **Validates: Requirements 1.6, 16.2**
 * 
 * Requirements:
 * - 1.6: WHEN a message is processed, THE Session_Manager SHALL append the message to 
 *        conversation history in the Durable_Store
 * - 16.2: THE Durable_Store SHALL persist users, sessions, message history, audit logs, 
 *         tool runs, bookings, payments, vendor records, translations, preferences, and 
 *         operator actions
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../../services/SessionManager.js';
import { UserRepository } from '../../db/repositories/UserRepository.js';
import { SessionRepository } from '../../db/repositories/SessionRepository.js';
import { MessageRepository } from '../../db/repositories/MessageRepository.js';
import { StateStore } from '../../services/StateStore.js';
import type { Message } from '../../db/repositories/MessageRepository.js';

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
 * Generates arbitrary correlation IDs
 */
const correlationIdArb = fc.uuid();

/**
 * Generates arbitrary message IDs
 */
const messageIdArb = fc.uuid();

/**
 * Generates arbitrary message types
 */
const messageTypeArb = fc.constantFrom('text', 'media', 'audio', 'interactive');

/**
 * Generates arbitrary message roles
 */
const messageRoleArb = fc.constantFrom<'user' | 'assistant' | 'system'>(
  'user',
  'assistant',
  'system'
);

/**
 * Generates arbitrary message content based on message type
 */
const messageContentArb = messageTypeArb.chain((type) => {
  switch (type) {
    case 'text':
      return fc.record({
        type: fc.constant('text'),
        body: fc.string({ minLength: 1, maxLength: 1000 }),
        text: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        mediaUrl: fc.constant(undefined),
        caption: fc.constant(undefined),
        selectedId: fc.constant(undefined),
        selectedTitle: fc.constant(undefined),
      });
    case 'media':
      return fc.record({
        type: fc.constant('media'),
        body: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        text: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        mediaUrl: fc.webUrl(),
        caption: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
        selectedId: fc.constant(undefined),
        selectedTitle: fc.constant(undefined),
      });
    case 'audio':
      return fc.record({
        type: fc.constant('audio'),
        body: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        text: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        mediaUrl: fc.webUrl(),
        caption: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
        selectedId: fc.constant(undefined),
        selectedTitle: fc.constant(undefined),
      });
    case 'interactive':
      return fc.record({
        type: fc.constant('interactive'),
        body: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        text: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        mediaUrl: fc.constant(undefined),
        caption: fc.constant(undefined),
        selectedId: fc.string({ minLength: 1, maxLength: 100 }),
        selectedTitle: fc.string({ minLength: 1, maxLength: 100 }),
      });
    default:
      return fc.record({
        type: fc.constant('text'),
        body: fc.string({ minLength: 1, maxLength: 1000 }),
        text: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
        mediaUrl: fc.constant(undefined),
        caption: fc.constant(undefined),
        selectedId: fc.constant(undefined),
        selectedTitle: fc.constant(undefined),
      });
  }
});

/**
 * Generates arbitrary message metadata
 */
const messageMetadataArb = fc.option(
  fc.record({
    source: fc.option(fc.constantFrom('whatsapp', 'internal', 'system'), { nil: undefined }),
    processingTimeMs: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
    llmModel: fc.option(fc.constantFrom('gpt-4', 'gpt-3.5-turbo', 'claude-3'), { nil: undefined }),
    confidence: fc.option(fc.double({ min: 0, max: 1 }), { nil: undefined }),
    flags: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
  }),
  { nil: undefined }
);

/**
 * Generates a complete message for testing
 */
const messageArb = fc.record({
  sessionId: sessionIdArb,
  userId: userIdArb,
  correlationId: correlationIdArb,
  fromNumber: phoneNumberArb,
  toNumber: phoneNumberArb,
  messageType: messageTypeArb,
  role: messageRoleArb,
  content: messageContentArb,
  metadata: messageMetadataArb,
});

/**
 * Generates a batch of messages for the same session
 */
const messageBatchArb = fc
  .tuple(sessionIdArb, userIdArb, phoneNumberArb, phoneNumberArb)
  .chain(([sessionId, userId, fromNumber, toNumber]) =>
    fc.array(
      fc.record({
        correlationId: correlationIdArb,
        messageType: messageTypeArb,
        role: messageRoleArb,
        content: messageContentArb,
        metadata: messageMetadataArb,
      }),
      { minLength: 1, maxLength: 10 }
    ).map((messages) => ({
      sessionId,
      userId,
      fromNumber,
      toNumber,
      messages,
    }))
  );

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 3: Message History Persistence', () => {
  let mockUserRepository: UserRepository;
  let mockSessionRepository: SessionRepository;
  let mockMessageRepository: MessageRepository;
  let mockStateStore: StateStore;
  let sessionManager: SessionManager;

  // Storage for messages to simulate persistence
  let messageStore: Map<string, Message>;
  let sessionMessagesStore: Map<string, Message[]>;

  beforeEach(() => {
    // Initialize message stores
    messageStore = new Map();
    sessionMessagesStore = new Map();

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
      createMessage: vi.fn().mockImplementation(async (data) => {
        // Simulate idempotent message creation
        const existingMessages = sessionMessagesStore.get(data.sessionId) || [];
        const existing = existingMessages.find(
          (m) => m.correlationId === data.correlationId && m.sessionId === data.sessionId
        );

        if (existing) {
          return existing;
        }

        // Create new message
        const message: Message = {
          messageId: `msg_${Date.now()}_${Math.random()}`,
          sessionId: data.sessionId,
          userId: data.userId,
          correlationId: data.correlationId,
          fromNumber: data.fromNumber,
          toNumber: data.toNumber,
          messageType: data.messageType,
          role: data.role,
          content: data.content,
          metadata: data.metadata,
          createdAt: new Date(),
        };

        // Store message
        messageStore.set(message.messageId, message);
        const sessionMessages = sessionMessagesStore.get(data.sessionId) || [];
        sessionMessages.push(message);
        sessionMessagesStore.set(data.sessionId, sessionMessages);

        return message;
      }),
      findById: vi.fn().mockImplementation(async (messageId: string) => {
        return messageStore.get(messageId) || null;
      }),
      findBySessionId: vi.fn().mockImplementation(async (sessionId: string, limit = 100) => {
        const messages = sessionMessagesStore.get(sessionId) || [];
        return messages.slice(-limit).reverse();
      }),
      findByCorrelationId: vi.fn().mockImplementation(async (correlationId: string) => {
        return Array.from(messageStore.values()).filter(
          (m) => m.correlationId === correlationId
        );
      }),
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
    messageStore.clear();
    sessionMessagesStore.clear();
  });

  it('should persist and retrieve a single message with all original content and metadata', () => {
    return fc.assert(
      fc.asyncProperty(messageArb, async (messageData) => {
        // Given: A session exists
        const mockSession = {
          sessionId: messageData.sessionId,
          userId: messageData.userId,
          phoneNumber: messageData.fromNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

        // When: A message is appended to the session
        await sessionManager.appendMessage(messageData.sessionId, {
          correlationId: messageData.correlationId,
          fromNumber: messageData.fromNumber,
          toNumber: messageData.toNumber,
          messageType: messageData.messageType,
          role: messageData.role,
          content: messageData.content,
          metadata: messageData.metadata,
        });

        // Then: The message should be retrievable by session ID
        const retrievedMessages = await mockMessageRepository.findBySessionId(
          messageData.sessionId
        );

        expect(retrievedMessages).toHaveLength(1);
        const retrievedMessage = retrievedMessages[0];

        // Verify all original content is preserved
        expect(retrievedMessage.sessionId).toBe(messageData.sessionId);
        expect(retrievedMessage.userId).toBe(messageData.userId);
        expect(retrievedMessage.correlationId).toBe(messageData.correlationId);
        expect(retrievedMessage.fromNumber).toBe(messageData.fromNumber);
        expect(retrievedMessage.toNumber).toBe(messageData.toNumber);
        expect(retrievedMessage.messageType).toBe(messageData.messageType);
        expect(retrievedMessage.role).toBe(messageData.role);
        expect(retrievedMessage.content).toEqual(messageData.content);
        expect(retrievedMessage.metadata).toEqual(messageData.metadata);

        // Verify message was persisted to Durable_Store
        expect(mockMessageRepository.createMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: messageData.sessionId,
            userId: messageData.userId,
            correlationId: messageData.correlationId,
            fromNumber: messageData.fromNumber,
            toNumber: messageData.toNumber,
            messageType: messageData.messageType,
            role: messageData.role,
            content: messageData.content,
            metadata: messageData.metadata,
          })
        );

        // Verify conversation history was updated
        expect(mockSessionRepository.appendConversationHistory).toHaveBeenCalledWith(
          messageData.sessionId,
          expect.objectContaining({
            role: messageData.role,
            content: messageData.content,
          })
        );
      }),
      { numRuns: 50 }
    );
  });

  it('should preserve message order in conversation history', () => {
    return fc.assert(
      fc.asyncProperty(messageBatchArb, async (batch) => {
        // Given: A session exists
        const mockSession = {
          sessionId: batch.sessionId,
          userId: batch.userId,
          phoneNumber: batch.fromNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

        // When: Multiple messages are appended in sequence
        for (const msg of batch.messages) {
          await sessionManager.appendMessage(batch.sessionId, {
            correlationId: msg.correlationId,
            fromNumber: batch.fromNumber,
            toNumber: batch.toNumber,
            messageType: msg.messageType,
            role: msg.role,
            content: msg.content,
            metadata: msg.metadata,
          });
        }

        // Then: Messages should be retrievable in the correct order
        const retrievedMessages = await mockMessageRepository.findBySessionId(batch.sessionId);

        expect(retrievedMessages).toHaveLength(batch.messages.length);

        // Verify order is preserved (reversed because findBySessionId returns DESC order)
        const expectedCorrelationIds = batch.messages.map((m) => m.correlationId).reverse();
        const actualCorrelationIds = retrievedMessages.map((m) => m.correlationId);

        expect(actualCorrelationIds).toEqual(expectedCorrelationIds);
      }),
      { numRuns: 30 }
    );
  });

  it('should handle idempotent message creation (duplicate correlation IDs)', () => {
    return fc.assert(
      fc.asyncProperty(messageArb, async (messageData) => {
        // Given: A session exists
        const mockSession = {
          sessionId: messageData.sessionId,
          userId: messageData.userId,
          phoneNumber: messageData.fromNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

        // When: The same message is appended multiple times (same correlation ID)
        await sessionManager.appendMessage(messageData.sessionId, {
          correlationId: messageData.correlationId,
          fromNumber: messageData.fromNumber,
          toNumber: messageData.toNumber,
          messageType: messageData.messageType,
          role: messageData.role,
          content: messageData.content,
          metadata: messageData.metadata,
        });

        await sessionManager.appendMessage(messageData.sessionId, {
          correlationId: messageData.correlationId,
          fromNumber: messageData.fromNumber,
          toNumber: messageData.toNumber,
          messageType: messageData.messageType,
          role: messageData.role,
          content: messageData.content,
          metadata: messageData.metadata,
        });

        await sessionManager.appendMessage(messageData.sessionId, {
          correlationId: messageData.correlationId,
          fromNumber: messageData.fromNumber,
          toNumber: messageData.toNumber,
          messageType: messageData.messageType,
          role: messageData.role,
          content: messageData.content,
          metadata: messageData.metadata,
        });

        // Then: Only one message should be stored (idempotency)
        const retrievedMessages = await mockMessageRepository.findBySessionId(
          messageData.sessionId
        );

        expect(retrievedMessages).toHaveLength(1);
        expect(retrievedMessages[0].correlationId).toBe(messageData.correlationId);
      }),
      { numRuns: 30 }
    );
  });

  it('should retrieve messages by correlation ID', () => {
    return fc.assert(
      fc.asyncProperty(messageArb, async (messageData) => {
        // Given: A session exists and a message is appended
        const mockSession = {
          sessionId: messageData.sessionId,
          userId: messageData.userId,
          phoneNumber: messageData.fromNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

        await sessionManager.appendMessage(messageData.sessionId, {
          correlationId: messageData.correlationId,
          fromNumber: messageData.fromNumber,
          toNumber: messageData.toNumber,
          messageType: messageData.messageType,
          role: messageData.role,
          content: messageData.content,
          metadata: messageData.metadata,
        });

        // When: We query by correlation ID
        const retrievedMessages = await mockMessageRepository.findByCorrelationId(
          messageData.correlationId
        );

        // Then: The message should be found with all original data
        expect(retrievedMessages).toHaveLength(1);
        const retrievedMessage = retrievedMessages[0];

        expect(retrievedMessage.correlationId).toBe(messageData.correlationId);
        expect(retrievedMessage.sessionId).toBe(messageData.sessionId);
        expect(retrievedMessage.content).toEqual(messageData.content);
        expect(retrievedMessage.metadata).toEqual(messageData.metadata);
      }),
      { numRuns: 30 }
    );
  });

  it('should preserve complex nested metadata structures', () => {
    return fc.assert(
      fc.asyncProperty(
        sessionIdArb,
        userIdArb,
        phoneNumberArb,
        phoneNumberArb,
        correlationIdArb,
        messageTypeArb,
        messageRoleArb,
        messageContentArb,
        fc.record({
          nested: fc.record({
            deep: fc.record({
              value: fc.string(),
              array: fc.array(fc.integer(), { maxLength: 5 }),
            }),
          }),
          flags: fc.array(fc.string(), { maxLength: 3 }),
          numbers: fc.array(fc.double(), { maxLength: 5 }),
          mixed: fc.anything(),
        }),
        async (
          sessionId,
          userId,
          fromNumber,
          toNumber,
          correlationId,
          messageType,
          role,
          content,
          complexMetadata
        ) => {
          // Given: A session exists
          const mockSession = {
            sessionId,
            userId,
            phoneNumber: fromNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          };

          vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
          vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

          // When: A message with complex metadata is appended
          await sessionManager.appendMessage(sessionId, {
            correlationId,
            fromNumber,
            toNumber,
            messageType,
            role,
            content,
            metadata: complexMetadata,
          });

          // Then: The complex metadata should be preserved exactly
          const retrievedMessages = await mockMessageRepository.findBySessionId(sessionId);

          expect(retrievedMessages).toHaveLength(1);
          expect(retrievedMessages[0].metadata).toEqual(complexMetadata);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should handle messages with no metadata', () => {
    return fc.assert(
      fc.asyncProperty(
        sessionIdArb,
        userIdArb,
        phoneNumberArb,
        phoneNumberArb,
        correlationIdArb,
        messageTypeArb,
        messageRoleArb,
        messageContentArb,
        async (sessionId, userId, fromNumber, toNumber, correlationId, messageType, role, content) => {
          // Given: A session exists
          const mockSession = {
            sessionId,
            userId,
            phoneNumber: fromNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          };

          vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
          vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

          // When: A message without metadata is appended
          await sessionManager.appendMessage(sessionId, {
            correlationId,
            fromNumber,
            toNumber,
            messageType,
            role,
            content,
            // No metadata field
          });

          // Then: The message should be stored and retrieved correctly
          const retrievedMessages = await mockMessageRepository.findBySessionId(sessionId);

          expect(retrievedMessages).toHaveLength(1);
          expect(retrievedMessages[0].correlationId).toBe(correlationId);
          expect(retrievedMessages[0].content).toEqual(content);
          expect(retrievedMessages[0].metadata).toBeUndefined();
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should maintain message integrity across different message types', () => {
    return fc.assert(
      fc.asyncProperty(
        sessionIdArb,
        userIdArb,
        phoneNumberArb,
        phoneNumberArb,
        async (sessionId, userId, fromNumber, toNumber) => {
          // Given: A session exists
          const mockSession = {
            sessionId,
            userId,
            phoneNumber: fromNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          };

          vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
          vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

          // When: Messages of different types are appended
          const messages = [
            {
              correlationId: `corr_text_${Date.now()}`,
              messageType: 'text',
              role: 'user' as const,
              content: { type: 'text', body: 'Hello' },
            },
            {
              correlationId: `corr_media_${Date.now()}`,
              messageType: 'media',
              role: 'assistant' as const,
              content: { type: 'media', mediaUrl: 'https://example.com/image.jpg' },
            },
            {
              correlationId: `corr_audio_${Date.now()}`,
              messageType: 'audio',
              role: 'user' as const,
              content: { type: 'audio', audioUrl: 'https://example.com/audio.mp3' },
            },
            {
              correlationId: `corr_interactive_${Date.now()}`,
              messageType: 'interactive',
              role: 'system' as const,
              content: { type: 'interactive', selectedId: 'btn_1' },
            },
          ];

          for (const msg of messages) {
            await sessionManager.appendMessage(sessionId, {
              correlationId: msg.correlationId,
              fromNumber,
              toNumber,
              messageType: msg.messageType,
              role: msg.role,
              content: msg.content,
            });
          }

          // Then: All messages should be retrievable with correct types and content
          const retrievedMessages = await mockMessageRepository.findBySessionId(sessionId);

          expect(retrievedMessages).toHaveLength(4);

          // Verify each message type is preserved
          const messagesByType = new Map(
            retrievedMessages.map((m) => [m.messageType, m])
          );

          expect(messagesByType.get('text')?.content).toEqual({ type: 'text', body: 'Hello' });
          expect(messagesByType.get('media')?.content).toEqual({
            type: 'media',
            mediaUrl: 'https://example.com/image.jpg',
          });
          expect(messagesByType.get('audio')?.content).toEqual({
            type: 'audio',
            audioUrl: 'https://example.com/audio.mp3',
          });
          expect(messagesByType.get('interactive')?.content).toEqual({
            type: 'interactive',
            selectedId: 'btn_1',
          });
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should update session last activity when appending messages', () => {
    return fc.assert(
      fc.asyncProperty(messageArb, async (messageData) => {
        // Given: A session exists
        const mockSession = {
          sessionId: messageData.sessionId,
          userId: messageData.userId,
          phoneNumber: messageData.fromNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

        // When: A message is appended
        await sessionManager.appendMessage(messageData.sessionId, {
          correlationId: messageData.correlationId,
          fromNumber: messageData.fromNumber,
          toNumber: messageData.toNumber,
          messageType: messageData.messageType,
          role: messageData.role,
          content: messageData.content,
          metadata: messageData.metadata,
        });

        // Then: Session last activity should be updated
        expect(mockSessionRepository.updateLastActivity).toHaveBeenCalledWith(
          messageData.sessionId
        );
      }),
      { numRuns: 30 }
    );
  });

  it('should handle concurrent message appends for the same session', () => {
    return fc.assert(
      fc.asyncProperty(messageBatchArb, async (batch) => {
        // Given: A session exists
        const mockSession = {
          sessionId: batch.sessionId,
          userId: batch.userId,
          phoneNumber: batch.fromNumber,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        };

        vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
        vi.mocked(mockStateStore.getSessionState).mockResolvedValue(null);

        // When: Multiple messages are appended concurrently
        await Promise.all(
          batch.messages.map((msg) =>
            sessionManager.appendMessage(batch.sessionId, {
              correlationId: msg.correlationId,
              fromNumber: batch.fromNumber,
              toNumber: batch.toNumber,
              messageType: msg.messageType,
              role: msg.role,
              content: msg.content,
              metadata: msg.metadata,
            })
          )
        );

        // Then: All messages should be persisted
        const retrievedMessages = await mockMessageRepository.findBySessionId(batch.sessionId);

        expect(retrievedMessages).toHaveLength(batch.messages.length);

        // Verify all correlation IDs are present
        const retrievedCorrelationIds = new Set(retrievedMessages.map((m) => m.correlationId));
        const expectedCorrelationIds = new Set(batch.messages.map((m) => m.correlationId));

        expect(retrievedCorrelationIds).toEqual(expectedCorrelationIds);
      }),
      { numRuns: 20 }
    );
  });
});
