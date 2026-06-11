/**
 * StateStore Usage Examples
 * 
 * This file demonstrates how the StateStore service integrates with
 * the Session Manager and other platform components.
 */

import { getStateStore } from './StateStore.js';
import { SessionState } from '../types/core.js';

// ============================================================================
// Example 1: Session State Management
// ============================================================================

/**
 * Example: Loading session state with fallback to durable store
 * 
 * This demonstrates Requirement 16.3: Session_Manager loads active session
 * state from State_Store and falls back to Durable_Store when expired.
 */
export async function loadSessionWithFallback(
  sessionId: string,
  loadFromDurableStore: (sessionId: string) => Promise<SessionState | null>
): Promise<SessionState | null> {
  const stateStore = getStateStore();

  // Try to load from hot state (Redis)
  let state = await stateStore.getSessionState(sessionId);

  if (state) {
    console.log(`Session ${sessionId} loaded from hot state (Redis)`);
    return state;
  }

  // Fallback to durable store (Postgres)
  console.log(`Session ${sessionId} not in hot state, loading from durable store`);
  state = await loadFromDurableStore(sessionId);

  if (state) {
    // Warm the cache for future requests
    await stateStore.setSessionState(sessionId, state);
    console.log(`Session ${sessionId} loaded from durable store and cached`);
  }

  return state;
}

// ============================================================================
// Example 2: Schema Field Collection Flow
// ============================================================================

/**
 * Example: Updating session state during schema field collection
 */
export async function collectSchemaField(
  sessionId: string,
  fieldName: string,
  fieldValue: unknown
): Promise<void> {
  const stateStore = getStateStore();

  // Load current state
  const state = await stateStore.getSessionState(sessionId);
  if (!state) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Update collected fields
  state.collectedFields[fieldName] = fieldValue;

  // Remove from missing fields
  state.missingFields = state.missingFields.filter((f) => f !== fieldName);

  // Update current step if needed
  if (state.missingFields.length === 0) {
    state.currentStep = 'ready_for_execution';
  }

  // Save updated state
  await stateStore.setSessionState(sessionId, state);

  console.log(`Field ${fieldName} collected for session ${sessionId}`);
  console.log(`Remaining missing fields: ${state.missingFields.join(', ')}`);
}

// ============================================================================
// Example 3: Tool Result Caching
// ============================================================================

/**
 * Example: Caching tool results to avoid redundant API calls
 */
export async function executeToolWithCache(
  toolName: string,
  params: Record<string, unknown>,
  executeTool: (params: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  const stateStore = getStateStore();

  // Generate cache key from tool name and params
  const cacheKey = generateCacheKey(toolName, params);

  // Check cache first
  const cached = await stateStore.getToolCache(cacheKey);
  if (cached) {
    console.log(`Tool ${toolName} result loaded from cache`);
    return cached.result;
  }

  // Execute tool
  console.log(`Tool ${toolName} cache miss, executing...`);
  const result = await executeTool(params);

  // Cache the result (5 minute TTL)
  await stateStore.setToolCache(
    cacheKey,
    {
      toolName,
      params,
      result,
      timestamp: new Date(),
    },
    300
  );

  return result;
}

/**
 * Generate a cache key from tool name and params
 */
function generateCacheKey(toolName: string, params: Record<string, unknown>): string {
  // Simple hash - in production, use a proper hash function
  const paramsStr = JSON.stringify(params, Object.keys(params).sort());
  const hash = Buffer.from(paramsStr).toString('base64').substring(0, 16);
  return `${toolName}:${hash}`;
}

// ============================================================================
// Example 4: Session Cleanup
// ============================================================================

/**
 * Example: Explicit session cleanup after completion
 */
export async function cleanupSession(sessionId: string): Promise<void> {
  const stateStore = getStateStore();

  // Delete from hot state
  const deleted = await stateStore.deleteSessionState(sessionId);

  if (deleted) {
    console.log(`Session ${sessionId} cleaned up from hot state`);
  } else {
    console.log(`Session ${sessionId} was not in hot state (already expired or not found)`);
  }

  // Note: Durable store records are retained for audit purposes
}

// ============================================================================
// Example 5: Booking Flow State Management
// ============================================================================

/**
 * Example: Managing booking progress in session state
 */
export async function updateBookingProgress(
  sessionId: string,
  bookingId: string,
  state: 'initiated' | 'hold_requested' | 'payment_pending' | 'confirmed'
): Promise<void> {
  const stateStore = getStateStore();

  const sessionState = await stateStore.getSessionState(sessionId);
  if (!sessionState) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Update booking progress
  sessionState.bookingProgress = {
    bookingId,
    state: state as any,
    selectedService: sessionState.bookingProgress?.selectedService,
  };

  // Update current step
  sessionState.currentStep = `booking_${state}`;

  // Save updated state
  await stateStore.setSessionState(sessionId, sessionState);

  console.log(`Booking ${bookingId} state updated to ${state} for session ${sessionId}`);
}

// ============================================================================
// Example 6: Payment Flow State Management
// ============================================================================

/**
 * Example: Managing payment progress in session state
 */
export async function updatePaymentProgress(
  sessionId: string,
  paymentId: string,
  state: 'initiated' | 'pending' | 'succeeded' | 'failed',
  amount?: number,
  currency?: string
): Promise<void> {
  const stateStore = getStateStore();

  const sessionState = await stateStore.getSessionState(sessionId);
  if (!sessionState) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Update payment progress
  sessionState.paymentProgress = {
    paymentId,
    state: state as any,
    amount: amount ?? sessionState.paymentProgress?.amount,
    currency: currency ?? sessionState.paymentProgress?.currency,
  };

  // Update current step
  sessionState.currentStep = `payment_${state}`;

  // Save updated state
  await stateStore.setSessionState(sessionId, sessionState);

  console.log(`Payment ${paymentId} state updated to ${state} for session ${sessionId}`);
}
