/**
 * StateStore Service
 * Wraps Redis for hot session state management
 * 
 * Validates: Requirements 16.1, 16.3
 */

import { createClient, RedisClientType } from 'redis';
import { env } from '../config/environment.js';
import { SessionState } from '../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolCacheEntry {
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
  timestamp: Date;
}

// ============================================================================
// StateStore Service
// ============================================================================

export class StateStore {
  private client: RedisClientType;
  private connected: boolean = false;

  constructor() {
    this.client = createClient({
      socket: {
        host: env.redis.host,
        port: env.redis.port,
      },
      password: env.redis.password,
      database: env.redis.db,
    });

    // Error handling
    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
      this.connected = true;
    });

    this.client.on('disconnect', () => {
      console.log('Redis Client Disconnected');
      this.connected = false;
    });
  }

  /**
   * Get the underlying Redis client for advanced operations
   * Use with caution - prefer using the provided methods when possible
   */
  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ==========================================================================
  // Session State Methods
  // ==========================================================================

  /**
   * Set session state with TTL
   * @param sessionId - Session identifier
   * @param state - Session state object
   * @param ttlSeconds - Time to live in seconds (defaults to env.operational.sessionTtlSeconds)
   */
  async setSessionState(
    sessionId: string,
    state: SessionState,
    ttlSeconds?: number
  ): Promise<void> {
    const key = this.getSessionKey(sessionId);
    const ttl = ttlSeconds ?? env.operational.sessionTtlSeconds;
    const serialized = JSON.stringify(state);

    await this.client.setEx(key, ttl, serialized);
  }

  /**
   * Get session state
   * @param sessionId - Session identifier
   * @returns Session state or null if not found or expired
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    const key = this.getSessionKey(sessionId);
    const data = await this.client.get(key);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as SessionState;
    } catch (error) {
      console.error(`Failed to parse session state for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Delete session state
   * @param sessionId - Session identifier
   * @returns True if deleted, false if not found
   */
  async deleteSessionState(sessionId: string): Promise<boolean> {
    const key = this.getSessionKey(sessionId);
    const result = await this.client.del(key);
    return result > 0;
  }

  // ==========================================================================
  // Tool Cache Methods
  // ==========================================================================

  /**
   * Set tool cache entry with TTL
   * @param cacheKey - Cache key (typically derived from tool name + params hash)
   * @param entry - Tool cache entry
   * @param ttlSeconds - Time to live in seconds (defaults to 300 = 5 minutes)
   */
  async setToolCache(
    cacheKey: string,
    entry: ToolCacheEntry,
    ttlSeconds: number = 300
  ): Promise<void> {
    const key = this.getToolCacheKey(cacheKey);
    const serialized = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    });

    await this.client.setEx(key, ttlSeconds, serialized);
  }

  /**
   * Get tool cache entry
   * @param cacheKey - Cache key
   * @returns Tool cache entry or null if not found or expired
   */
  async getToolCache(cacheKey: string): Promise<ToolCacheEntry | null> {
    const key = this.getToolCacheKey(cacheKey);
    const data = await this.client.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
      } as ToolCacheEntry;
    } catch (error) {
      console.error(`Failed to parse tool cache for ${cacheKey}:`, error);
      return null;
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Generate session state key
   */
  private getSessionKey(sessionId: string): string {
    return `session:${sessionId}:state`;
  }

  /**
   * Generate tool cache key
   */
  private getToolCacheKey(cacheKey: string): string {
    return `tool:cache:${cacheKey}`;
  }

  /**
   * Flush all data (use with caution, primarily for testing)
   */
  async flushAll(): Promise<void> {
    await this.client.flushDb();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let stateStoreInstance: StateStore | null = null;

/**
 * Get or create StateStore singleton instance
 */
export function getStateStore(): StateStore {
  if (!stateStoreInstance) {
    stateStoreInstance = new StateStore();
  }
  return stateStoreInstance;
}

/**
 * Initialize and connect StateStore
 */
export async function initStateStore(): Promise<StateStore> {
  const store = getStateStore();
  await store.connect();
  return store;
}

/**
 * Close StateStore connection
 */
export async function closeStateStore(): Promise<void> {
  if (stateStoreInstance) {
    await stateStoreInstance.disconnect();
    stateStoreInstance = null;
  }
}
