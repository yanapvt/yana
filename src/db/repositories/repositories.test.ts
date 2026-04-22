/**
 * Unit tests for repository classes
 * Tests create, read, update, and upsert operations against a test database
 * Requirements: 16.2
 * 
 * IMPORTANT: These tests require a PostgreSQL database with migrations applied.
 * See README.test.md for setup instructions.
 * 
 * To run these tests:
 * 1. Set up a test database with environment variables
 * 2. Run migrations: npm run migrate
 * 3. Run tests: npm test -- src/db/repositories/repositories.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { UserRepository } from './UserRepository.js';
import { SessionRepository } from './SessionRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { BookingRepository } from './BookingRepository.js';
import { PaymentRepository } from './PaymentRepository.js';
import { SchemaRepository } from './SchemaRepository.js';
import { ToolRepository } from './ToolRepository.js';
import { AuditRepository } from './AuditRepository.js';
import { BookingState, PaymentState, ErrorCategory } from '../../types/core.js';

// ============================================================================
// Test Database Setup
// ============================================================================

/**
 * Test database connection pool
 * 
 * NOTE: This uses the same database as the application. In a production setup,
 * you should use a separate test database or implement transaction-based rollback
 * for better test isolation.
 * 
 * Recommended approach:
 * - Use POSTGRES_DB=yana_ogo_test for tests
 * - Run migrations on the test database before running tests
 * - Clean up test data after each test (implemented below)
 */
const testPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'yana_ogo',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
});

// ============================================================================
// Helper Functions
// ============================================================================

async function cleanupDatabase() {
  // Clean up test data in reverse dependency order
  await testPool.query('DELETE FROM payment_events');
  await testPool.query('DELETE FROM payments');
  await testPool.query('DELETE FROM booking_events');
  await testPool.query('DELETE FROM bookings');
  await testPool.query('DELETE FROM tool_runs');
  await testPool.query('DELETE FROM tool_registry');
  await testPool.query('DELETE FROM decision_logs');
  await testPool.query('DELETE FROM audit_logs');
  await testPool.query('DELETE FROM message_translations');
  await testPool.query('DELETE FROM messages');
  await testPool.query('DELETE FROM session_state');
  await testPool.query('DELETE FROM sessions');
  await testPool.query('DELETE FROM schema_versions');
  await testPool.query('DELETE FROM schemas');
  await testPool.query('DELETE FROM user_language_settings');
  await testPool.query('DELETE FROM user_preferences');
  await testPool.query('DELETE FROM user_profiles');
  await testPool.query('DELETE FROM users');
}

// ============================================================================
// Test Lifecycle
// ============================================================================

beforeAll(async () => {
  // Ensure database connection is working
  await testPool.query('SELECT 1');
});

afterAll(async () => {
  await cleanupDatabase();
  await testPool.end();
});

beforeEach(async () => {
  await cleanupDatabase();
});

// ============================================================================
// UserRepository Tests
// ============================================================================

describe('UserRepository', () => {
  const userRepo = new UserRepository();

  describe('createUser', () => {
    it('should create a new user with profile, preferences, and language settings', async () => {
      const user = await userRepo.createUser(
        '+1234567890',
        'hash123',
        'en',
        'USD'
      );

      expect(user.userId).toBeDefined();
      expect(user.phoneNumber).toBe('+1234567890');
      expect(user.phoneHash).toBe('hash123');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);

      // Verify profile was created
      const profile = await userRepo.getProfile(user.userId);
      expect(profile).toBeDefined();
      expect(profile?.preferredLanguage).toBe('en');
      expect(profile?.preferredCurrency).toBe('USD');

      // Verify preferences were created
      const preferences = await userRepo.getPreferences(user.userId);
      expect(preferences).toBeDefined();
      expect(preferences?.ttsEnabled).toBe(false);
      expect(preferences?.proactiveMessagingEnabled).toBe(false);

      // Verify language settings were created
      const langSettings = await userRepo.getLanguageSettings(user.userId);
      expect(langSettings).toBeDefined();
      expect(langSettings?.recentActions).toEqual([]);
      expect(langSettings?.frequentServices).toEqual([]);
    });

    it('should be idempotent - return existing user if phone number exists', async () => {
      const user1 = await userRepo.createUser('+1234567890', 'hash123');
      const user2 = await userRepo.createUser('+1234567890', 'hash456');

      expect(user1.userId).toBe(user2.userId);
      expect(user2.phoneHash).toBe('hash123'); // Original hash preserved
    });
  });

  describe('findByPhoneNumber', () => {
    it('should find user by phone number', async () => {
      const created = await userRepo.createUser('+1234567890', 'hash123');
      const found = await userRepo.findByPhoneNumber('+1234567890');

      expect(found).toBeDefined();
      expect(found?.userId).toBe(created.userId);
    });

    it('should return null if user not found', async () => {
      const found = await userRepo.findByPhoneNumber('+9999999999');
      expect(found).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find user by ID', async () => {
      const created = await userRepo.createUser('+1234567890', 'hash123');
      const found = await userRepo.findById(created.userId);

      expect(found).toBeDefined();
      expect(found?.phoneNumber).toBe('+1234567890');
    });

    it('should return null if user not found', async () => {
      const found = await userRepo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('should update user profile fields', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      
      const updated = await userRepo.updateProfile(user.userId, {
        name: 'John Doe',
        nationality: 'US',
        homeLocation: 'New York',
      });

      expect(updated.name).toBe('John Doe');
      expect(updated.nationality).toBe('US');
      expect(updated.homeLocation).toBe('New York');
      expect(updated.preferredLanguage).toBe('en'); // Unchanged
    });

    it('should be idempotent - allow multiple updates', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      
      await userRepo.updateProfile(user.userId, { name: 'John' });
      const updated = await userRepo.updateProfile(user.userId, { name: 'Jane' });

      expect(updated.name).toBe('Jane');
    });
  });

  describe('updatePreferences', () => {
    it('should update user preferences', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      
      const updated = await userRepo.updatePreferences(user.userId, {
        ttsEnabled: true,
        proactiveMessagingEnabled: true,
        notificationPreferences: { booking: true, payment: false },
      });

      expect(updated.ttsEnabled).toBe(true);
      expect(updated.proactiveMessagingEnabled).toBe(true);
      expect(updated.notificationPreferences).toEqual({ booking: true, payment: false });
    });
  });

  describe('updateLanguageSettings', () => {
    it('should update user language settings', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      
      const updated = await userRepo.updateLanguageSettings(user.userId, {
        recentActions: ['search_hotel', 'book_hotel'],
        frequentServices: ['hotel'],
        commonDestinations: ['Paris', 'London'],
      });

      expect(updated.recentActions).toEqual(['search_hotel', 'book_hotel']);
      expect(updated.frequentServices).toEqual(['hotel']);
      expect(updated.commonDestinations).toEqual(['Paris', 'London']);
    });
  });
});

// ============================================================================
// SessionRepository Tests
// ============================================================================

describe('SessionRepository', () => {
  const sessionRepo = new SessionRepository();
  const userRepo = new UserRepository();

  describe('createSession', () => {
    it('should create a new session with initial state', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBe(user.userId);
      expect(session.phoneNumber).toBe('+1234567890');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);

      // Verify session state was created
      const state = await sessionRepo.getState(session.sessionId);
      expect(state).toBeDefined();
      expect(state?.missingFields).toEqual([]);
      expect(state?.collectedFields).toEqual({});
    });

    it('should be idempotent - return existing active session', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session1 = await sessionRepo.createSession(user.userId, '+1234567890');
      const session2 = await sessionRepo.createSession(user.userId, '+1234567890');

      expect(session1.sessionId).toBe(session2.sessionId);
    });
  });

  describe('findById', () => {
    it('should find session by ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const created = await sessionRepo.createSession(user.userId, '+1234567890');
      const found = await sessionRepo.findById(created.sessionId);

      expect(found).toBeDefined();
      expect(found?.userId).toBe(user.userId);
    });

    it('should return null if session not found', async () => {
      const found = await sessionRepo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('updateState', () => {
    it('should update session state fields', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const updated = await sessionRepo.updateState(session.sessionId, {
        currentIntent: 'book_hotel',
        activeSchema: 'hotel_booking',
        missingFields: ['location', 'check_in_date'],
        collectedFields: { guests: 2 },
      });

      expect(updated.currentIntent).toBe('book_hotel');
      expect(updated.activeSchema).toBe('hotel_booking');
      expect(updated.missingFields).toEqual(['location', 'check_in_date']);
      expect(updated.collectedFields).toEqual({ guests: 2 });
    });
  });

  describe('appendConversationHistory', () => {
    it('should append message to conversation history', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      await sessionRepo.appendConversationHistory(session.sessionId, {
        role: 'user',
        content: 'I want to book a hotel',
      });

      const state = await sessionRepo.getState(session.sessionId);
      expect(state?.conversationHistory).toHaveLength(1);
      expect(state?.conversationHistory[0]).toEqual({
        role: 'user',
        content: 'I want to book a hotel',
      });
    });
  });
});

// ============================================================================
// MessageRepository Tests
// ============================================================================

describe('MessageRepository', () => {
  const messageRepo = new MessageRepository();
  const sessionRepo = new SessionRepository();
  const userRepo = new UserRepository();

  describe('createMessage', () => {
    it('should create a new message', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const message = await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Hello' },
        metadata: { source: 'whatsapp' },
      });

      expect(message.messageId).toBeDefined();
      expect(message.sessionId).toBe(session.sessionId);
      expect(message.role).toBe('user');
      expect(message.content).toEqual({ text: 'Hello' });
    });

    it('should be idempotent - return existing message with same correlation ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const message1 = await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Hello' },
      });

      const message2 = await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Different' },
      });

      expect(message1.messageId).toBe(message2.messageId);
      expect(message2.content).toEqual({ text: 'Hello' }); // Original preserved
    });
  });

  describe('findById', () => {
    it('should find message by ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const created = await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Hello' },
      });

      const found = await messageRepo.findById(created.messageId);
      expect(found).toBeDefined();
      expect(found?.content).toEqual({ text: 'Hello' });
    });
  });

  describe('findBySessionId', () => {
    it('should find messages by session ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-1',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Message 1' },
      });

      await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-2',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'assistant',
        content: { text: 'Message 2' },
      });

      const messages = await messageRepo.findBySessionId(session.sessionId);
      expect(messages).toHaveLength(2);
    });
  });

  describe('createTranslation', () => {
    it('should create a message translation', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const message = await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Bonjour' },
      });

      const translation = await messageRepo.createTranslation({
        messageId: message.messageId,
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
        translationConfidence: 0.95,
      });

      expect(translation.translationId).toBeDefined();
      expect(translation.messageId).toBe(message.messageId);
      expect(translation.detectedLanguage).toBe('fr');
      expect(translation.translatedText).toBe('Hello');
    });

    it('should be idempotent - return existing translation', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const message = await messageRepo.createMessage({
        sessionId: session.sessionId,
        userId: user.userId,
        correlationId: 'corr-123',
        fromNumber: '+1234567890',
        toNumber: '+0987654321',
        messageType: 'text',
        role: 'user',
        content: { text: 'Bonjour' },
      });

      const translation1 = await messageRepo.createTranslation({
        messageId: message.messageId,
        originalText: 'Bonjour',
        detectedLanguage: 'fr',
        translatedText: 'Hello',
        canonicalForm: 'hello',
      });

      const translation2 = await messageRepo.createTranslation({
        messageId: message.messageId,
        originalText: 'Bonjour',
        detectedLanguage: 'es',
        translatedText: 'Hola',
        canonicalForm: 'hola',
      });

      expect(translation1.translationId).toBe(translation2.translationId);
      expect(translation2.detectedLanguage).toBe('fr'); // Original preserved
    });
  });
});

// ============================================================================
// BookingRepository Tests
// ============================================================================

describe('BookingRepository', () => {
  const bookingRepo = new BookingRepository();
  const sessionRepo = new SessionRepository();
  const userRepo = new UserRepository();

  describe('createBooking', () => {
    it('should create a new booking with initial event', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.INITIATED,
        serviceType: 'hotel',
        serviceDetails: { hotelName: 'Grand Hotel', nights: 2 },
        amount: 200,
        currency: 'USD',
      });

      expect(booking.bookingId).toBeDefined();
      expect(booking.state).toBe(BookingState.INITIATED);
      expect(booking.serviceType).toBe('hotel');
      expect(booking.amount).toBe(200);

      // Verify booking event was created
      const events = await bookingRepo.getEvents(booking.bookingId);
      expect(events).toHaveLength(1);
      expect(events[0].newState).toBe(BookingState.INITIATED);
    });

    it('should be idempotent - return existing booking with same correlation ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const booking1 = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.INITIATED,
        serviceType: 'hotel',
        serviceDetails: { hotelName: 'Grand Hotel' },
      });

      const booking2 = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.CONFIRMED,
        serviceType: 'hotel',
        serviceDetails: { hotelName: 'Different Hotel' },
      });

      expect(booking1.bookingId).toBe(booking2.bookingId);
      expect(booking2.state).toBe(BookingState.INITIATED); // Original preserved
    });
  });

  describe('findById', () => {
    it('should find booking by ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const created = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.INITIATED,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const found = await bookingRepo.findById(created.bookingId);
      expect(found).toBeDefined();
      expect(found?.bookingId).toBe(created.bookingId);
    });
  });

  describe('updateState', () => {
    it('should update booking state and create event', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.INITIATED,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const updated = await bookingRepo.updateState(
        booking.bookingId,
        BookingState.CONFIRMED,
        'payment_completed'
      );

      expect(updated.state).toBe(BookingState.CONFIRMED);
      expect(updated.confirmedAt).toBeInstanceOf(Date);

      // Verify event was created
      const events = await bookingRepo.getEvents(booking.bookingId);
      expect(events).toHaveLength(2);
      expect(events[1].previousState).toBe(BookingState.INITIATED);
      expect(events[1].newState).toBe(BookingState.CONFIRMED);
    });
  });

  describe('findByUserId', () => {
    it('should find bookings by user ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-1',
        state: BookingState.INITIATED,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-2',
        state: BookingState.CONFIRMED,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const bookings = await bookingRepo.findByUserId(user.userId);
      expect(bookings).toHaveLength(2);
    });
  });
});

// ============================================================================
// PaymentRepository Tests
// ============================================================================

describe('PaymentRepository', () => {
  const paymentRepo = new PaymentRepository();
  const bookingRepo = new BookingRepository();
  const sessionRepo = new SessionRepository();
  const userRepo = new UserRepository();

  describe('createPayment', () => {
    it('should create a new payment with initial event', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.PAYMENT_PENDING,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const payment = await paymentRepo.createPayment({
        bookingId: booking.bookingId,
        userId: user.userId,
        correlationId: 'payment-123',
        state: PaymentState.INITIATED,
        amount: 200,
        currency: 'USD',
        paymentMethod: 'payment_link',
        providerName: 'stripe',
      });

      expect(payment.paymentId).toBeDefined();
      expect(payment.state).toBe(PaymentState.INITIATED);
      expect(payment.amount).toBe(200);
      expect(payment.currency).toBe('USD');

      // Verify payment event was created
      const events = await paymentRepo.getEvents(payment.paymentId);
      expect(events).toHaveLength(1);
      expect(events[0].newState).toBe(PaymentState.INITIATED);
    });

    it('should be idempotent - return existing payment with same correlation ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.PAYMENT_PENDING,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const payment1 = await paymentRepo.createPayment({
        bookingId: booking.bookingId,
        userId: user.userId,
        correlationId: 'payment-123',
        state: PaymentState.INITIATED,
        amount: 200,
        currency: 'USD',
        paymentMethod: 'payment_link',
        providerName: 'stripe',
      });

      const payment2 = await paymentRepo.createPayment({
        bookingId: booking.bookingId,
        userId: user.userId,
        correlationId: 'payment-123',
        state: PaymentState.SUCCEEDED,
        amount: 300,
        currency: 'EUR',
        paymentMethod: 'telco_billing',
        providerName: 'different',
      });

      expect(payment1.paymentId).toBe(payment2.paymentId);
      expect(payment2.state).toBe(PaymentState.INITIATED); // Original preserved
      expect(payment2.amount).toBe(200); // Original preserved
    });
  });

  describe('findById', () => {
    it('should find payment by ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.PAYMENT_PENDING,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const created = await paymentRepo.createPayment({
        bookingId: booking.bookingId,
        userId: user.userId,
        correlationId: 'payment-123',
        state: PaymentState.INITIATED,
        amount: 200,
        currency: 'USD',
        paymentMethod: 'payment_link',
        providerName: 'stripe',
      });

      const found = await paymentRepo.findById(created.paymentId);
      expect(found).toBeDefined();
      expect(found?.paymentId).toBe(created.paymentId);
    });
  });

  describe('updateState', () => {
    it('should update payment state and create event', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.PAYMENT_PENDING,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      const payment = await paymentRepo.createPayment({
        bookingId: booking.bookingId,
        userId: user.userId,
        correlationId: 'payment-123',
        state: PaymentState.INITIATED,
        amount: 200,
        currency: 'USD',
        paymentMethod: 'payment_link',
        providerName: 'stripe',
      });

      const updated = await paymentRepo.updateState(
        payment.paymentId,
        PaymentState.SUCCEEDED,
        'webhook_received'
      );

      expect(updated.state).toBe(PaymentState.SUCCEEDED);
      expect(updated.succeededAt).toBeInstanceOf(Date);

      // Verify event was created
      const events = await paymentRepo.getEvents(payment.paymentId);
      expect(events).toHaveLength(2);
      expect(events[1].previousState).toBe(PaymentState.INITIATED);
      expect(events[1].newState).toBe(PaymentState.SUCCEEDED);
    });
  });

  describe('findByBookingId', () => {
    it('should find payments by booking ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');
      const booking = await bookingRepo.createBooking({
        userId: user.userId,
        sessionId: session.sessionId,
        correlationId: 'booking-123',
        state: BookingState.PAYMENT_PENDING,
        serviceType: 'hotel',
        serviceDetails: {},
      });

      await paymentRepo.createPayment({
        bookingId: booking.bookingId,
        userId: user.userId,
        correlationId: 'payment-1',
        state: PaymentState.INITIATED,
        amount: 200,
        currency: 'USD',
        paymentMethod: 'payment_link',
        providerName: 'stripe',
      });

      const payments = await paymentRepo.findByBookingId(booking.bookingId);
      expect(payments).toHaveLength(1);
    });
  });
});

// ============================================================================
// SchemaRepository Tests
// ============================================================================

describe('SchemaRepository', () => {
  const schemaRepo = new SchemaRepository();

  describe('createSchema', () => {
    it('should create a new schema', async () => {
      const schema = await schemaRepo.createSchema(
        'hotel_booking',
        '1.0',
        'Hotel booking workflow'
      );

      expect(schema.schemaId).toBeDefined();
      expect(schema.schemaName).toBe('hotel_booking');
      expect(schema.currentVersion).toBe('1.0');
      expect(schema.description).toBe('Hotel booking workflow');
    });

    it('should be idempotent - return existing schema', async () => {
      const schema1 = await schemaRepo.createSchema('hotel_booking', '1.0');
      const schema2 = await schemaRepo.createSchema('hotel_booking', '2.0');

      expect(schema1.schemaId).toBe(schema2.schemaId);
      expect(schema2.currentVersion).toBe('1.0'); // Original preserved
    });
  });

  describe('findByName', () => {
    it('should find schema by name', async () => {
      const created = await schemaRepo.createSchema('hotel_booking', '1.0');
      const found = await schemaRepo.findByName('hotel_booking');

      expect(found).toBeDefined();
      expect(found?.schemaId).toBe(created.schemaId);
    });

    it('should return null if schema not found', async () => {
      const found = await schemaRepo.findByName('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('createVersion', () => {
    it('should create a schema version', async () => {
      const schema = await schemaRepo.createSchema('hotel_booking', '1.0');

      const version = await schemaRepo.createVersion({
        schemaId: schema.schemaId,
        version: '1.0',
        requiredFields: ['location', 'check_in_date'],
        optionalFields: ['check_out_date', 'guests'],
        fields: {
          location: { type: 'location', required: true },
          check_in_date: { type: 'date', required: true },
        },
        isActive: true,
      });

      expect(version.versionId).toBeDefined();
      expect(version.version).toBe('1.0');
      expect(version.requiredFields).toEqual(['location', 'check_in_date']);
      expect(version.isActive).toBe(true);
    });

    it('should be idempotent - return existing version', async () => {
      const schema = await schemaRepo.createSchema('hotel_booking', '1.0');

      const version1 = await schemaRepo.createVersion({
        schemaId: schema.schemaId,
        version: '1.0',
        requiredFields: ['location'],
        optionalFields: [],
        fields: {},
      });

      const version2 = await schemaRepo.createVersion({
        schemaId: schema.schemaId,
        version: '1.0',
        requiredFields: ['different'],
        optionalFields: [],
        fields: {},
      });

      expect(version1.versionId).toBe(version2.versionId);
      expect(version2.requiredFields).toEqual(['location']); // Original preserved
    });
  });

  describe('updateCurrentVersion', () => {
    it('should update schema current version', async () => {
      const schema = await schemaRepo.createSchema('hotel_booking', '1.0');
      const updated = await schemaRepo.updateCurrentVersion(schema.schemaId, '2.0');

      expect(updated.currentVersion).toBe('2.0');
    });
  });

  describe('findVersionsBySchemaId', () => {
    it('should find all versions for a schema', async () => {
      const schema = await schemaRepo.createSchema('hotel_booking', '1.0');

      await schemaRepo.createVersion({
        schemaId: schema.schemaId,
        version: '1.0',
        requiredFields: [],
        optionalFields: [],
        fields: {},
      });

      await schemaRepo.createVersion({
        schemaId: schema.schemaId,
        version: '2.0',
        requiredFields: [],
        optionalFields: [],
        fields: {},
      });

      const versions = await schemaRepo.findVersionsBySchemaId(schema.schemaId);
      expect(versions).toHaveLength(2);
    });
  });
});

// ============================================================================
// ToolRepository Tests
// ============================================================================

describe('ToolRepository', () => {
  const toolRepo = new ToolRepository();

  describe('registerTool', () => {
    it('should register a new tool', async () => {
      const tool = await toolRepo.registerTool({
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {
          input: { location: 'string', check_in: 'date' },
          output: { hotels: 'array' },
        },
        executionPolicy: { maxRetries: 3, timeoutMs: 5000 },
        isEnabled: true,
      });

      expect(tool.toolId).toBeDefined();
      expect(tool.toolName).toBe('search_hotels');
      expect(tool.toolVersion).toBe('1.0');
      expect(tool.isEnabled).toBe(true);
    });

    it('should be idempotent - update existing tool', async () => {
      const tool1 = await toolRepo.registerTool({
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: { input: {}, output: {} },
      });

      const tool2 = await toolRepo.registerTool({
        toolName: 'search_hotels',
        toolVersion: '2.0',
        contract: { input: {}, output: {} },
      });

      expect(tool1.toolId).toBe(tool2.toolId);
      expect(tool2.toolVersion).toBe('2.0'); // Updated
    });
  });

  describe('findByName', () => {
    it('should find tool by name', async () => {
      const created = await toolRepo.registerTool({
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
      });

      const found = await toolRepo.findByName('search_hotels');
      expect(found).toBeDefined();
      expect(found?.toolId).toBe(created.toolId);
    });

    it('should return null if tool not found', async () => {
      const found = await toolRepo.findByName('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('createRun', () => {
    it('should create a tool run record', async () => {
      await toolRepo.registerTool({
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
      });

      const run = await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: { location: 'Paris', check_in: '2024-01-01' },
        outputData: { hotels: [] },
        executionStatus: 'success',
        executionTimeMs: 250,
        attemptNumber: 1,
      });

      expect(run.runId).toBeDefined();
      expect(run.toolName).toBe('search_hotels');
      expect(run.executionStatus).toBe('success');
      expect(run.attemptNumber).toBe(1);
    });

    it('should be idempotent - return existing run with same correlation ID and attempt', async () => {
      const run1 = await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: { location: 'Paris' },
        executionStatus: 'success',
        attemptNumber: 1,
      });

      const run2 = await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: { location: 'London' },
        executionStatus: 'failure',
        attemptNumber: 1,
      });

      expect(run1.runId).toBe(run2.runId);
      expect(run2.executionStatus).toBe('success'); // Original preserved
    });

    it('should allow different attempts for same correlation ID', async () => {
      const run1 = await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: {},
        executionStatus: 'failure',
        attemptNumber: 1,
      });

      const run2 = await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: {},
        executionStatus: 'success',
        attemptNumber: 2,
      });

      expect(run1.runId).not.toBe(run2.runId);
      expect(run2.attemptNumber).toBe(2);
    });
  });

  describe('findRunsByCorrelationId', () => {
    it('should find tool runs by correlation ID', async () => {
      await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: {},
        executionStatus: 'failure',
        attemptNumber: 1,
      });

      await toolRepo.createRun({
        correlationId: 'corr-123',
        toolName: 'search_hotels',
        inputParams: {},
        executionStatus: 'success',
        attemptNumber: 2,
      });

      const runs = await toolRepo.findRunsByCorrelationId('corr-123');
      expect(runs).toHaveLength(2);
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable a tool', async () => {
      await toolRepo.registerTool({
        toolName: 'search_hotels',
        toolVersion: '1.0',
        contract: {},
        isEnabled: true,
      });

      await toolRepo.setEnabled('search_hotels', false);
      const tool = await toolRepo.findByName('search_hotels');
      expect(tool?.isEnabled).toBe(false);

      await toolRepo.setEnabled('search_hotels', true);
      const toolEnabled = await toolRepo.findByName('search_hotels');
      expect(toolEnabled?.isEnabled).toBe(true);
    });
  });
});

// ============================================================================
// AuditRepository Tests
// ============================================================================

describe('AuditRepository', () => {
  const auditRepo = new AuditRepository();
  const sessionRepo = new SessionRepository();
  const userRepo = new UserRepository();

  describe('createAuditLog', () => {
    it('should create an audit log entry', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const log = await auditRepo.createAuditLog({
        correlationId: 'corr-123',
        sessionId: session.sessionId,
        userId: user.userId,
        actionType: 'tool_execution',
        toolUsed: 'search_hotels',
        executionStatus: 'success',
        latencyMs: 250,
      });

      expect(log.logId).toBeDefined();
      expect(log.correlationId).toBe('corr-123');
      expect(log.actionType).toBe('tool_execution');
      expect(log.executionStatus).toBe('success');
    });

    it('should create audit log with error information', async () => {
      const log = await auditRepo.createAuditLog({
        correlationId: 'corr-456',
        actionType: 'provider_call',
        providerUsed: 'booking_api',
        executionStatus: 'failure',
        errorCode: 'TIMEOUT',
        errorCategory: ErrorCategory.PROVIDER_FAILURE,
        metadata: { reason: 'Connection timeout' },
      });

      expect(log.errorCode).toBe('TIMEOUT');
      expect(log.errorCategory).toBe(ErrorCategory.PROVIDER_FAILURE);
      expect(log.metadata).toEqual({ reason: 'Connection timeout' });
    });
  });

  describe('findByCorrelationId', () => {
    it('should find audit logs by correlation ID', async () => {
      await auditRepo.createAuditLog({
        correlationId: 'corr-123',
        actionType: 'webhook_received',
        executionStatus: 'success',
      });

      await auditRepo.createAuditLog({
        correlationId: 'corr-123',
        actionType: 'tool_execution',
        executionStatus: 'success',
      });

      const logs = await auditRepo.findByCorrelationId('corr-123');
      expect(logs).toHaveLength(2);
    });
  });

  describe('findByActionType', () => {
    it('should find audit logs by action type', async () => {
      await auditRepo.createAuditLog({
        correlationId: 'corr-1',
        actionType: 'tool_execution',
        executionStatus: 'success',
      });

      await auditRepo.createAuditLog({
        correlationId: 'corr-2',
        actionType: 'tool_execution',
        executionStatus: 'failure',
      });

      const logs = await auditRepo.findByActionType('tool_execution');
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by execution status', async () => {
      await auditRepo.createAuditLog({
        correlationId: 'corr-3',
        actionType: 'provider_call',
        executionStatus: 'success',
      });

      await auditRepo.createAuditLog({
        correlationId: 'corr-4',
        actionType: 'provider_call',
        executionStatus: 'failure',
      });

      const successLogs = await auditRepo.findByActionType('provider_call', 100, 'success');
      const failureLogs = await auditRepo.findByActionType('provider_call', 100, 'failure');

      expect(successLogs.every(log => log.executionStatus === 'success')).toBe(true);
      expect(failureLogs.every(log => log.executionStatus === 'failure')).toBe(true);
    });
  });

  describe('createDecisionLog', () => {
    it('should create a decision log entry', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const decision = await auditRepo.createDecisionLog({
        correlationId: 'corr-123',
        sessionId: session.sessionId,
        userId: user.userId,
        intent: 'book_hotel',
        parameters: { location: 'Paris', guests: 2 },
        missingFields: ['check_in_date'],
        suggestedAction: 'ask_missing',
        confidence: 0.85,
        reasoning: 'User expressed clear intent to book',
        modelUsed: 'gpt-4',
      });

      expect(decision.decisionId).toBeDefined();
      expect(decision.intent).toBe('book_hotel');
      expect(decision.confidence).toBe(0.85);
      expect(decision.missingFields).toEqual(['check_in_date']);
    });

    it('should be idempotent - return existing decision log', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      const decision1 = await auditRepo.createDecisionLog({
        correlationId: 'corr-123',
        sessionId: session.sessionId,
        userId: user.userId,
        intent: 'book_hotel',
        parameters: {},
        missingFields: [],
      });

      const decision2 = await auditRepo.createDecisionLog({
        correlationId: 'corr-123',
        sessionId: session.sessionId,
        userId: user.userId,
        intent: 'search_hotel',
        parameters: {},
        missingFields: [],
      });

      expect(decision1.decisionId).toBe(decision2.decisionId);
      expect(decision2.intent).toBe('book_hotel'); // Original preserved
    });
  });

  describe('findDecisionsBySessionId', () => {
    it('should find decision logs by session ID', async () => {
      const user = await userRepo.createUser('+1234567890', 'hash123');
      const session = await sessionRepo.createSession(user.userId, '+1234567890');

      await auditRepo.createDecisionLog({
        correlationId: 'corr-1',
        sessionId: session.sessionId,
        userId: user.userId,
        intent: 'book_hotel',
        parameters: {},
        missingFields: [],
      });

      await auditRepo.createDecisionLog({
        correlationId: 'corr-2',
        sessionId: session.sessionId,
        userId: user.userId,
        intent: 'search_hotel',
        parameters: {},
        missingFields: [],
      });

      const decisions = await auditRepo.findDecisionsBySessionId(session.sessionId);
      expect(decisions).toHaveLength(2);
    });
  });
});
