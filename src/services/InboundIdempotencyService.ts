import crypto from 'node:crypto';
import { pool } from '../db/connection.js';
import { getStateStore, type StateStore } from './StateStore.js';

export type InboundEffectClass = 'read_only' | 'repeatable_external_effect';
export type IdempotencyDecision = 'new' | 'duplicate' | 'unavailable';

export interface DurableInboundClaimStore {
  claim(input: { provider: string; messageIdHash: string; correlationId: string; effectClass: InboundEffectClass; expiresAt: Date }): Promise<boolean>;
}

export class PostgresInboundClaimStore implements DurableInboundClaimStore {
  async claim(input: { provider: string; messageIdHash: string; correlationId: string; effectClass: InboundEffectClass; expiresAt: Date }): Promise<boolean> {
    const result = await pool.query(
      `INSERT INTO inbound_message_claims(provider, message_id_hash, correlation_id, effect_class, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, message_id_hash) DO UPDATE SET
         correlation_id=EXCLUDED.correlation_id, effect_class=EXCLUDED.effect_class,
         claimed_at=NOW(), expires_at=EXCLUDED.expires_at
       WHERE inbound_message_claims.expires_at <= NOW()
       RETURNING message_id_hash`,
      [input.provider, input.messageIdHash, input.correlationId, input.effectClass, input.expiresAt]
    );
    return result.rowCount === 1;
  }
}

export class InboundIdempotencyService {
  constructor(
    private readonly stateStore: StateStore = getStateStore(),
    private readonly durableStore: DurableInboundClaimStore = new PostgresInboundClaimStore(),
    private readonly ttlSeconds = 24 * 60 * 60,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async claim(provider: string, messageId: string, correlationId: string, effectClass: InboundEffectClass): Promise<IdempotencyDecision> {
    const hash = crypto.createHash('sha256').update(messageId).digest('hex');
    try {
      await this.stateStore.connect();
      if (!this.stateStore.isConnected()) throw new Error('redis_unavailable');
      const result = await this.stateStore.getClient().set(`webhook:${provider}:message:${hash}`, correlationId, { NX: true, EX: this.ttlSeconds });
      if (result === null) return 'duplicate';
    } catch { /* Postgres remains the authoritative shared claim. */ }
    try {
      const created = await this.durableStore.claim({
        provider, messageIdHash: hash, correlationId, effectClass,
        expiresAt: new Date(this.clock().getTime() + this.ttlSeconds * 1000),
      });
      return created ? 'new' : 'duplicate';
    } catch {
      return effectClass === 'read_only' ? 'new' : 'unavailable';
    }
  }
}

let instance: InboundIdempotencyService | undefined;
export function getInboundIdempotencyService(): InboundIdempotencyService {
  return instance ??= new InboundIdempotencyService();
}
export function initInboundIdempotencyService(value: InboundIdempotencyService): void { instance = value; }
