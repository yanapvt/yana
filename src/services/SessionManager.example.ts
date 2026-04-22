/**
 * SessionManager Usage Examples
 * Demonstrates how to use the SessionManager service
 */

import { SessionManager } from './SessionManager.js';
import { UserRepository } from '../db/repositories/UserRepository.js';
import { SessionRepository } from '../db/repositories/SessionRepository.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { getStateStore } from './StateStore.js';

// ============================================================================
// Example 1: Create a new session
// ============================================================================

async function example1_createSession() {
  // Initialize dependencies
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const messageRepo = new MessageRepository();
  const stateStore = getStateStore();

  const sessionManager = new SessionManager(userRepo, sessionRepo, messageRepo, stateStore);

  // Create session for a new user
  const result = await sessionManager.createSession({
    phoneNumber: '+1234567890',
    phoneHash: 'hash_of_phone_number',
    preferredLanguage: 'en',
    preferredCurrency: 'USD',
  });

  console.log('Session created:', result);
  // Output: { sessionId: 'session-123', userId: 'user-456', isNewUser: true, isNewSession: true }
}

// ============================================================================
// Example 2: Resume an existing session
// ============================================================================

async function example2_resumeSession() {
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const messageRepo = new MessageRepository();
  const stateStore = getStateStore();

  const sessionManager = new SessionManager(userRepo, sessionRepo, messageRepo, stateStore);

  // Resume session by phone number
  const contextPackage = await sessionManager.resumeSession('+1234567890');

  if (contextPackage) {
    console.log('Session resumed:', {
      sessionId: contextPackage.sessionId,
      userId: contextPackage.userId,
      preferredLanguage: contextPackage.userProfile.preferredLanguage,
      currentIntent: contextPackage.activeFlowState.currentIntent,
      missingFields: contextPackage.schemaProgress.missingFields,
    });
  } else {
    console.log('No active session found');
  }
}

// ============================================================================
// Example 3: Assemble context package for orchestrator
// ============================================================================

async function example3_assembleContext() {
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const messageRepo = new MessageRepository();
  const stateStore = getStateStore();

  const sessionManager = new SessionManager(userRepo, sessionRepo, messageRepo, stateStore);

  // Assemble complete context package
  const context = await sessionManager.assembleContextPackage('session-123');

  console.log('Context package assembled:');
  console.log('User Profile:', context.userProfile);
  console.log('Behavioral Summary:', context.behavioralSummary);
  console.log('Active Flow State:', context.activeFlowState);
  console.log('Schema Progress:', context.schemaProgress);

  // Use context for orchestration decisions
  const { activeFlowState, schemaProgress, userProfile } = context;

  if (schemaProgress.missingFields.length > 0) {
    console.log(`Need to collect: ${schemaProgress.missingFields.join(', ')}`);
  }

  if (activeFlowState.currentIntent === 'search_hotels') {
    console.log('User is searching for hotels');
    console.log('Collected fields:', schemaProgress.collectedFields);
  }
}

// ============================================================================
// Example 4: Append a message to the session
// ============================================================================

async function example4_appendMessage() {
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const messageRepo = new MessageRepository();
  const stateStore = getStateStore();

  const sessionManager = new SessionManager(userRepo, sessionRepo, messageRepo, stateStore);

  // Append user message
  await sessionManager.appendMessage('session-123', {
    correlationId: 'corr-abc-123',
    fromNumber: '+1234567890',
    toNumber: '+0987654321',
    messageType: 'text',
    role: 'user',
    content: {
      type: 'text',
      body: 'I want to book a hotel in Galle',
    },
    metadata: {
      source: 'whatsapp',
      timestamp: new Date().toISOString(),
    },
  });

  console.log('User message appended');

  // Append assistant response
  await sessionManager.appendMessage('session-123', {
    correlationId: 'corr-abc-124',
    fromNumber: '+0987654321',
    toNumber: '+1234567890',
    messageType: 'text',
    role: 'assistant',
    content: {
      type: 'text',
      body: 'Great! When would you like to check in?',
    },
  });

  console.log('Assistant message appended');
}

// ============================================================================
// Example 5: Update session state during schema collection
// ============================================================================

async function example5_updateSessionState() {
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const messageRepo = new MessageRepository();
  const stateStore = getStateStore();

  const sessionManager = new SessionManager(userRepo, sessionRepo, messageRepo, stateStore);

  // User provides location
  await sessionManager.updateSessionState('session-123', {
    currentIntent: 'search_hotels',
    activeSchema: 'hotel_search',
    schemaVersion: '1.0',
    missingFields: ['checkin_date', 'checkout_date'],
    collectedFields: {
      location: 'Galle',
    },
  });

  console.log('Session state updated: location collected');

  // User provides check-in date
  await sessionManager.updateSessionState('session-123', {
    missingFields: ['checkout_date'],
    collectedFields: {
      location: 'Galle',
      checkin_date: '2026-04-17',
    },
  });

  console.log('Session state updated: check-in date collected');

  // User provides check-out date - schema complete
  await sessionManager.updateSessionState('session-123', {
    missingFields: [],
    collectedFields: {
      location: 'Galle',
      checkin_date: '2026-04-17',
      checkout_date: '2026-04-18',
    },
  });

  console.log('Session state updated: schema collection complete');
}

// ============================================================================
// Example 6: Complete workflow - new user to hotel search
// ============================================================================

async function example6_completeWorkflow() {
  const userRepo = new UserRepository();
  const sessionRepo = new SessionRepository();
  const messageRepo = new MessageRepository();
  const stateStore = getStateStore();

  const sessionManager = new SessionManager(userRepo, sessionRepo, messageRepo, stateStore);

  // Step 1: Create session for new user
  const { sessionId, userId, isNewUser } = await sessionManager.createSession({
    phoneNumber: '+1234567890',
    phoneHash: 'hash_123',
    preferredLanguage: 'en',
    preferredCurrency: 'GBP',
  });

  console.log(`Step 1: Session created (new user: ${isNewUser})`);

  // Step 2: User sends first message
  await sessionManager.appendMessage(sessionId, {
    correlationId: 'corr-001',
    fromNumber: '+1234567890',
    toNumber: '+0987654321',
    messageType: 'text',
    role: 'user',
    content: { type: 'text', body: 'I need a hotel in Galle' },
  });

  console.log('Step 2: User message received');

  // Step 3: Initialize hotel search schema
  await sessionManager.updateSessionState(sessionId, {
    currentIntent: 'search_hotels',
    activeSchema: 'hotel_search',
    schemaVersion: '1.0',
    missingFields: ['checkin_date', 'checkout_date'],
    collectedFields: { location: 'Galle' },
  });

  console.log('Step 3: Schema initialized');

  // Step 4: Assemble context for orchestrator
  const context = await sessionManager.assembleContextPackage(sessionId);

  console.log('Step 4: Context assembled for orchestrator');
  console.log('  - User language:', context.userProfile.preferredLanguage);
  console.log('  - User currency:', context.userProfile.preferredCurrency);
  console.log('  - Current intent:', context.activeFlowState.currentIntent);
  console.log('  - Missing fields:', context.schemaProgress.missingFields);
  console.log('  - Collected fields:', context.schemaProgress.collectedFields);

  // Step 5: Resume session later
  const resumedContext = await sessionManager.resumeSession('+1234567890');

  if (resumedContext) {
    console.log('Step 5: Session resumed successfully');
    console.log('  - Session ID:', resumedContext.sessionId);
    console.log('  - Active schema:', resumedContext.schemaProgress.activeSchema);
  }
}

// Export examples for documentation
export {
  example1_createSession,
  example2_resumeSession,
  example3_assembleContext,
  example4_appendMessage,
  example5_updateSessionState,
  example6_completeWorkflow,
};
