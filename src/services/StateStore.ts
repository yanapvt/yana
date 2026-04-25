/**
 * StateStore Service
 * Wraps Redis for hot session state management
 * Optional in development - can run without Redis for local development
 * 
 * Validates: Requirements 16.1, 16.3
 */

import { createClient, RedisClientType } from 'redis';
import { env } from '../config/environment.js';
import { logger } from '../config/logger.js';
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
  private client: RedisClientType | null = null;
  private connected: boolean = false;
  private enabled: boolean = env.redis.enabled;

  constructor() {
    if (!this.enabled) {
      logger.warn('StateStore', 'Redis is disabled - session state will not be cached');
      return;
    }

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
      logger.error('StateStore', 'Redis client error', {
        error: err instanceof Error ? err.message : String(err),
        host: env.redis.host,
        port: env.redis.port,
      });
    });

    this.client.on('connect', () => {
      logger.info('StateStore', 'Redis client connected', {
        host: env.redis.host,
        port: env.redis.port,
      });
      this.connected = true;
    });

    this.client.on('disconnect', () => {
      logger.debug('StateStore', 'Redis client disconnected');
      this.connected = false;
    });
  }

  /**
   * Get the underlying Redis client for advanced operations
   * Use with caution - prefer using the provided methods when possible
   */
  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis is disabled or not initialized');
    }
    return this.client;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.enabled) {
      logger.debug('StateStore', 'Skipping Redis connection (disabled)');
      return;
    }

    if (!this.connected && this.client) {
      try {
        logger.debug('StateStore', 'Connecting to Redis');
        await this.client.connect();
      } catch (error) {
        logger.error('StateStore', 'Failed to connect to Redis', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (this.connected && this.client) {
      try {
        await this.client.quit();
        this.connected = false;
        logger.info('StateStore', 'Redis client disconnected');
      } catch (error) {
        logger.error('StateStore', 'Error disconnecting from Redis', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.enabled;
  }

  /**
   * Check if Redis is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
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
    if (!this.enabled || !this.client || !this.connected) {
      logger.debug('StateStore', 'Skipping session state set (Redis disabled or disconnected)', {
        sessionId,
      });
      return;
    }

    const key = this.getSessionKey(sessionId);
    const ttl = ttlSeconds ?? env.operational.sessionTtlSeconds;
    const serialized = JSON.stringify(state);

    try {
      await this.client.setEx(key, ttl, serialized);
      logger.debug('StateStore', 'Session state set', { sessionId, ttl });
    } catch (error) {
      logger.error('StateStore', 'Failed to set session state', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get session state
   * @param sessionId - Session identifier
   * @returns Session state or null if not found or expired
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    if (!this.enabled || !this.client || !this.connected) {
      logger.debug('StateStore', 'Skipping session state get (Redis disabled or disconnected)', {
        sessionId,
      });
      return null;
    }

    const key = this.getSessionKey(sessionId);

    try {
      const data = await this.client.get(key);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as SessionState;
    } catch (error) {
      logger.error('StateStore', 'Failed to get session state', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Delete session state
   * @param sessionId - Session identifier
   * @returns True if deleted, false if not found
   */
  async deleteSessionState(sessionId: string): Promise<boolean> {
    if (!this.enabled || !this.client || !this.connected) {
      logger.debug('StateStore', 'Skipping session state delete (Redis disabled or disconnected)', {
        sessionId,
      });
      return false;
    }

    try {
      const key = this.getSessionKey(sessionId);
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      logger.error('StateStore', 'Failed to delete session state', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
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
    if (!this.enabled || !this.client || !this.connected) {
      logger.debug('StateStore', 'Skipping tool cache set (Redis disabled or disconnected)', {
        cacheKey,
      });
      return;
    }

    try {
      const key = this.getToolCacheKey(cacheKey);
      const serialized = JSON.stringify({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      });

      await this.client.setEx(key, ttlSeconds, serialized);
      logger.debug('StateStore', 'Tool cache set', { cacheKey, ttlSeconds });
    } catch (error) {
      logger.error('StateStore', 'Failed to set tool cache', {
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get tool cache entry
   * @param cacheKey - Cache key
   * @returns Tool cache entry or null if not found or expired
   */
  async getToolCache(cacheKey: string): Promise<ToolCacheEntry | null> {
    if (!this.enabled || !this.client || !this.connected) {
      logger.debug('StateStore', 'Skipping tool cache get (Redis disabled or disconnected)', {
        cacheKey,
      });
      return null;
    }

    try {
      const key = this.getToolCacheKey(cacheKey);
      const data = await this.client.get(key);

      if (!data) {
        return null;
      }

      const parsed = JSON.parse(data);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
      } as ToolCacheEntry;
    } catch (error) {
      logger.error('StateStore', 'Failed to get tool cache', {
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
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
    if (!this.enabled || !this.client || !this.connected) {
      logger.debug('StateStore', 'Skipping flush (Redis disabled or disconnected)');
      return;
    }

    try {
      await this.client.flushDb();
      logger.info('StateStore', 'Redis database flushed');
    } catch (error) {
      logger.error('StateStore', 'Failed to flush Redis database', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
