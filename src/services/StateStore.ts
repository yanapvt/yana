/**
 * StateStore Service
 * Wraps Redis for hot session state management
 * Supports both standard Redis and Upstash Redis REST API
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
// Upstash Redis REST Client
// ============================================================================

class UpstashRedisClient {
  private restUrl: string;
  private restToken: string;

  constructor(restUrl: string, restToken: string) {
    this.restUrl = restUrl.replace(/\/$/, ''); // Remove trailing slash
    this.restToken = restToken;
  }

  private async execute(command: string[]): Promise<any> {
    const response = await fetch(`${this.restUrl}/${command.join('/')}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.restToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Upstash Redis error: ${response.statusText}`);
    }

    const data = (await response.json()) as { result: any };
    return data.result;
  }

  async get(key: string): Promise<string | null> {
    return await this.execute(['GET', key]);
  }

  async set(key: string, value: string, options?: { NX?: boolean; EX?: number }): Promise<string | null> {
    const command = ['SET', key, value];
    
    if (options?.NX) {
      command.push('NX');
    }
    
    if (options?.EX) {
      command.push('EX', options.EX.toString());
    }
    
    return await this.execute(command);
  }

  async setEx(key: string, seconds: number, value: string): Promise<string> {
    return await this.execute(['SETEX', key, seconds.toString(), value]);
  }

  async del(key: string): Promise<number> {
    return await this.execute(['DEL', key]);
  }

  async flushDb(): Promise<string> {
    return await this.execute(['FLUSHDB']);
  }
}

// ============================================================================
// StateStore Service
// ============================================================================

export class StateStore {
  private client: RedisClientType | UpstashRedisClient;
  private connected: boolean = false;
  private isUpstash: boolean = false;
  private fallbackStore = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    // Check if using Upstash Redis REST API
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (upstashUrl && upstashToken) {
      // Use Upstash REST API
      console.log('Using Upstash Redis REST API');
      this.client = new UpstashRedisClient(upstashUrl, upstashToken);
      this.isUpstash = true;
      this.connected = true; // REST API doesn't need connection
    } else {
      // Use standard Redis client
      console.log('Using standard Redis client');
      this.client = createClient({
        socket: {
          host: env.redis.host,
          port: env.redis.port,
          connectTimeout: 1000,
          reconnectStrategy: false,
        },
        password: env.redis.password,
        database: env.redis.db,
      }) as RedisClientType;

      // Error handling for standard Redis
      (this.client as RedisClientType).on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      (this.client as RedisClientType).on('connect', () => {
        console.log('Redis Client Connected');
        this.connected = true;
      });

      (this.client as RedisClientType).on('disconnect', () => {
        console.log('Redis Client Disconnected');
        this.connected = false;
      });
    }
  }

  /**
   * Get the underlying Redis client for advanced operations
   * Use with caution - prefer using the provided methods when possible
   */
  getClient(): RedisClientType | UpstashRedisClient {
    return this.client;
  }

  /**
   * Connect to Redis (only needed for standard Redis, not Upstash)
   */
  async connect(): Promise<void> {
    if (this.isUpstash) {
      // Upstash REST API doesn't need connection
      this.connected = true;
      return;
    }

    if (!this.connected) {
      try {
        await (this.client as RedisClientType).connect();
      } catch (error) {
        this.connected = false;
        console.warn('[StateStore] Redis is unavailable; using in-memory session fallback');
      }
    }
  }

  /**
   * Disconnect from Redis (only needed for standard Redis, not Upstash)
   */
  async disconnect(): Promise<void> {
    if (this.isUpstash) {
      // Upstash REST API doesn't need disconnection
      this.connected = false;
      return;
    }

    if (this.connected) {
      await (this.client as RedisClientType).quit();
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

    try {
      await this.connect();
      await this.client.setEx(key, ttl, serialized);
    } catch {
      this.setFallback(key, serialized, ttl);
    }
  }

  /**
   * Get session state
   * @param sessionId - Session identifier
   * @returns Session state or null if not found or expired
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    const key = this.getSessionKey(sessionId);
    let data: string | null;
    try {
      await this.connect();
      data = await this.client.get(key);
    } catch {
      data = this.getFallback(key);
    }

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
    try {
      await this.connect();
      const result = await this.client.del(key);
      return result > 0;
    } catch {
      return this.deleteFallback(key);
    }
  }

  // ==========================================================================
  // Generic JSON State Methods
  // ==========================================================================

  async setJson<T>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const ttl = ttlSeconds ?? env.operational.sessionTtlSeconds;
    const serialized = JSON.stringify(value);
    try {
      await this.connect();
      await this.client.setEx(key, ttl, serialized);
    } catch {
      this.setFallback(key, serialized, ttl);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    let data: string | null;
    try {
      await this.connect();
      data = await this.client.get(key);
    } catch {
      data = this.getFallback(key);
    }

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as T;
    } catch (error) {
      console.error(`Failed to parse JSON state for ${key}:`, error);
      return null;
    }
  }

  async deleteKey(key: string): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.client.del(key);
      return result > 0;
    } catch {
      return this.deleteFallback(key);
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
    const key = this.getToolCacheKey(cacheKey);
    const serialized = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    });

    try {
      await this.connect();
      await this.client.setEx(key, ttlSeconds, serialized);
    } catch {
      this.setFallback(key, serialized, ttlSeconds);
    }
  }

  /**
   * Get tool cache entry
   * @param cacheKey - Cache key
   * @returns Tool cache entry or null if not found or expired
   */
  async getToolCache(cacheKey: string): Promise<ToolCacheEntry | null> {
    const key = this.getToolCacheKey(cacheKey);
    let data: string | null;
    try {
      await this.connect();
      data = await this.client.get(key);
    } catch {
      data = this.getFallback(key);
    }

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
    this.fallbackStore.clear();
    try {
      await this.connect();
      await this.client.flushDb();
    } catch {
      // Redis may be intentionally unavailable in local tests; fallback was already cleared.
    }
  }

  private setFallback(key: string, value: string, ttlSeconds: number): void {
    this.fallbackStore.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  private getFallback(key: string): string | null {
    const entry = this.fallbackStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.fallbackStore.delete(key);
      return null;
    }
    return entry.value;
  }

  private deleteFallback(key: string): boolean {
    return this.fallbackStore.delete(key);
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
