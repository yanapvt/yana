/**
 * StateStore Service Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { StateStore } from './StateStore.js';
import { SessionState } from '../types/core.js';

describe('StateStore', () => {
  let stateStore: StateStore;

  beforeAll(async () => {
    stateStore = new StateStore();
    await stateStore.connect();
  });

  afterAll(async () => {
    await stateStore.disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test
    await stateStore.flushAll();
  });

  describe('Connection Management', () => {
    it('should connect to Redis successfully', () => {
      expect(stateStore.isConnected()).toBe(true);
    });
  });

  describe('Session State Operations', () => {
    it('should set and get session state', async () => {
      const sessionId = 'test-session-1';
      const state: SessionState = {
        currentIntent: 'search_hotels',
        currentStep: 'collect_location',
        activeSchema: 'hotel_search',
        schemaVersion: '1.0',
        missingFields: ['location', 'checkin_date'],
        collectedFields: {},
      };

      await stateStore.setSessionState(sessionId, state);
      const retrieved = await stateStore.getSessionState(sessionId);

      expect(retrieved).toEqual(state);
    });

    it('should return null for non-existent session', async () => {
      const retrieved = await stateStore.getSessionState('non-existent-session');
      expect(retrieved).toBeNull();
    });

    it('should delete session state', async () => {
      const sessionId = 'test-session-2';
      const state: SessionState = {
        missingFields: [],
        collectedFields: { location: 'Galle' },
      };

      await stateStore.setSessionState(sessionId, state);
      const deleted = await stateStore.deleteSessionState(sessionId);
      expect(deleted).toBe(true);

      const retrieved = await stateStore.getSessionState(sessionId);
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent session', async () => {
      const deleted = await stateStore.deleteSessionState('non-existent-session');
      expect(deleted).toBe(false);
    });

    it('should handle session state with all fields', async () => {
      const sessionId = 'test-session-3';
      const state: SessionState = {
        currentIntent: 'book_hotel',
        currentStep: 'payment',
        activeSchema: 'hotel_booking',
        schemaVersion: '2.0',
        missingFields: [],
        collectedFields: {
          location: 'Colombo',
          checkin_date: '2026-05-01',
          checkout_date: '2026-05-03',
          guests: 2,
        },
        pendingOptions: [
          { id: 'hotel_1', title: 'Hotel A' },
          { id: 'hotel_2', title: 'Hotel B' },
        ],
        bookingProgress: {
          bookingId: 'booking_123',
          state: 'payment_pending' as any,
          selectedService: { hotelId: 'hotel_1' },
        },
        paymentProgress: {
          paymentId: 'payment_456',
          state: 'pending' as any,
          amount: 15000,
          currency: 'LKR',
        },
      };

      await stateStore.setSessionState(sessionId, state);
      const retrieved = await stateStore.getSessionState(sessionId);

      expect(retrieved).toEqual(state);
    });

    it('should respect custom TTL', async () => {
      const sessionId = 'test-session-ttl';
      const state: SessionState = {
        missingFields: [],
        collectedFields: {},
      };

      // Set with 1 second TTL
      await stateStore.setSessionState(sessionId, state, 1);

      // Should exist immediately
      let retrieved = await stateStore.getSessionState(sessionId);
      expect(retrieved).toEqual(state);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired
      retrieved = await stateStore.getSessionState(sessionId);
      expect(retrieved).toBeNull();
    });
  });

  describe('Tool Cache Operations', () => {
    it('should set and get tool cache', async () => {
      const cacheKey = 'search_hotels:hash123';
      const entry = {
        toolName: 'search_hotels',
        params: { location: 'Galle', checkin_date: '2026-05-01' },
        result: { hotels: [{ id: 'hotel_1', name: 'Hotel A' }] },
        timestamp: new Date(),
      };

      await stateStore.setToolCache(cacheKey, entry);
      const retrieved = await stateStore.getToolCache(cacheKey);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.toolName).toBe(entry.toolName);
      expect(retrieved?.params).toEqual(entry.params);
      expect(retrieved?.result).toEqual(entry.result);
      expect(retrieved?.timestamp.getTime()).toBeCloseTo(entry.timestamp.getTime(), -2);
    });

    it('should return null for non-existent cache entry', async () => {
      const retrieved = await stateStore.getToolCache('non-existent-key');
      expect(retrieved).toBeNull();
    });

    it('should respect custom TTL for tool cache', async () => {
      const cacheKey = 'tool_cache_ttl';
      const entry = {
        toolName: 'test_tool',
        params: {},
        result: { data: 'test' },
        timestamp: new Date(),
      };

      // Set with 1 second TTL
      await stateStore.setToolCache(cacheKey, entry, 1);

      // Should exist immediately
      let retrieved = await stateStore.getToolCache(cacheKey);
      expect(retrieved).toBeTruthy();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired
      retrieved = await stateStore.getToolCache(cacheKey);
      expect(retrieved).toBeNull();
    });

    it('should handle complex tool cache data', async () => {
      const cacheKey = 'complex_tool_cache';
      const entry = {
        toolName: 'search_hotels',
        params: {
          location: 'Colombo',
          checkin_date: '2026-05-01',
          checkout_date: '2026-05-03',
          guests: 2,
          budget: { min: 5000, max: 15000 },
          amenities: ['wifi', 'pool', 'parking'],
        },
        result: {
          hotels: [
            {
              id: 'hotel_1',
              name: 'Hotel A',
              price: 12000,
              rating: 4.5,
              amenities: ['wifi', 'pool'],
            },
            {
              id: 'hotel_2',
              name: 'Hotel B',
              price: 8000,
              rating: 4.0,
              amenities: ['wifi', 'parking'],
            },
          ],
          totalResults: 2,
        },
        timestamp: new Date(),
      };

      await stateStore.setToolCache(cacheKey, entry);
      const retrieved = await stateStore.getToolCache(cacheKey);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.params).toEqual(entry.params);
      expect(retrieved?.result).toEqual(entry.result);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty session state', async () => {
      const sessionId = 'empty-session';
      const state: SessionState = {
        missingFields: [],
        collectedFields: {},
      };

      await stateStore.setSessionState(sessionId, state);
      const retrieved = await stateStore.getSessionState(sessionId);

      expect(retrieved).toEqual(state);
    });

    it('should handle special characters in session ID', async () => {
      const sessionId = 'session:with:colons-and-dashes_123';
      const state: SessionState = {
        missingFields: [],
        collectedFields: { test: 'value' },
      };

      await stateStore.setSessionState(sessionId, state);
      const retrieved = await stateStore.getSessionState(sessionId);

      expect(retrieved).toEqual(state);
    });

    it('should handle unicode in collected fields', async () => {
      const sessionId = 'unicode-session';
      const state: SessionState = {
        missingFields: [],
        collectedFields: {
          location: 'කොළඹ', // Colombo in Sinhala
          name: '日本', // Japan in Japanese
          emoji: '🏨🌴',
        },
      };

      await stateStore.setSessionState(sessionId, state);
      const retrieved = await stateStore.getSessionState(sessionId);

      expect(retrieved).toEqual(state);
    });
  });

  describe('Fallback Behavior', () => {
    it('should return null for expired session (fallback scenario)', async () => {
      const sessionId = 'expired-fallback-session';
      const state: SessionState = {
        currentIntent: 'test_intent',
        missingFields: [],
        collectedFields: { test: 'data' },
      };

      // Set with very short TTL
      await stateStore.setSessionState(sessionId, state, 1);

      // Verify it exists initially
      let retrieved = await stateStore.getSessionState(sessionId);
      expect(retrieved).toEqual(state);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should return null, indicating need for fallback to Durable_Store
      retrieved = await stateStore.getSessionState(sessionId);
      expect(retrieved).toBeNull();
    });

    it('should return null for non-existent session (fallback scenario)', async () => {
      // This tests the fallback path when State_Store has no entry
      const retrieved = await stateStore.getSessionState('never-existed-session');
      expect(retrieved).toBeNull();
    });

    it('should handle corrupted data gracefully', async () => {
      const sessionId = 'corrupted-data-session';
      
      // Manually insert invalid JSON into Redis
      const key = `session:${sessionId}:state`;
      await stateStore['client'].set(key, 'invalid-json-{{{', 'EX', 60);

      // Should return null instead of throwing
      const retrieved = await stateStore.getSessionState(sessionId);
      expect(retrieved).toBeNull();
    });

    it('should return null for expired tool cache (fallback scenario)', async () => {
      const cacheKey = 'expired-tool-cache';
      const entry = {
        toolName: 'test_tool',
        params: { test: 'param' },
        result: { data: 'result' },
        timestamp: new Date(),
      };

      // Set with very short TTL
      await stateStore.setToolCache(cacheKey, entry, 1);

      // Verify it exists initially
      let retrieved = await stateStore.getToolCache(cacheKey);
      expect(retrieved).toBeTruthy();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should return null after expiry
      retrieved = await stateStore.getToolCache(cacheKey);
      expect(retrieved).toBeNull();
    });
  });
});
