import crypto from 'node:crypto';
import { pool } from '../db/connection.js';
import type { MemoryCandidate, TravellerMemoryFact, TravellerMemoryScope } from '../orchestration/TravellerMemory.js';
import { isSensitiveMemory } from '../orchestration/TravellerMemory.js';

export interface TravellerMemoryRepository {
  findForContext(userId: string, contextIds?: string[]): Promise<TravellerMemoryFact[]>;
  saveCandidates(userId: string, sourceMessageId: string, candidates: MemoryCandidate[], contextId?: string): Promise<TravellerMemoryFact[]>;
  confirmPending(userId: string): Promise<number>;
  rejectPending(userId: string): Promise<number>;
  forget(userId: string, key?: string): Promise<number>;
}

export class InMemoryTravellerMemoryRepository implements TravellerMemoryRepository {
  private facts: TravellerMemoryFact[] = [];
  async findForContext(userId: string, contextIds: string[] = []): Promise<TravellerMemoryFact[]> {
    return structuredClone(this.facts.filter((fact) => fact.userId === userId && (!fact.expiresAt || Date.parse(fact.expiresAt) > Date.now()) &&
      (fact.scope === 'profile' || !fact.contextId || contextIds.includes(fact.contextId))));
  }
  async saveCandidates(userId: string, sourceMessageId: string, candidates: MemoryCandidate[], contextId = 'trip:current'): Promise<TravellerMemoryFact[]> {
    const saved: TravellerMemoryFact[] = [];
    for (const candidate of candidates) {
      const now = new Date().toISOString();
      const scopedId = candidate.scope === 'profile' ? undefined : contextId;
      const existing = this.facts.find((fact) => fact.userId === userId && fact.sourceMessageId === sourceMessageId &&
        fact.scope === candidate.scope && fact.key === candidate.key && fact.value === candidate.value);
      if (existing) { saved.push(existing); continue; }
      this.facts.filter((fact) => fact.userId === userId && fact.scope === candidate.scope && fact.contextId === scopedId && fact.key === candidate.key && fact.status === 'confirmed')
        .forEach((fact) => { fact.status = 'superseded'; fact.updatedAt = now; });
      const fact: TravellerMemoryFact = { ...candidate, id: crypto.randomUUID(), userId, contextId: scopedId,
        status: candidate.requiresConfirmation ? 'proposed' : 'confirmed', sensitive: isSensitiveMemory(candidate.key), sourceMessageId,
        createdAt: now, updatedAt: now, expiresAt: memoryExpiry(candidate.key) ?? undefined };
      this.facts.push(fact); saved.push(fact);
    }
    return structuredClone(saved);
  }
  async confirmPending(userId: string): Promise<number> {
    let count = 0;
    this.facts.forEach((fact) => { if (fact.userId === userId && fact.status === 'proposed') { fact.status = 'confirmed'; fact.updatedAt = new Date().toISOString(); count++; } });
    return count;
  }
  async rejectPending(userId: string): Promise<number> {
    let count = 0;
    this.facts.forEach((fact) => { if (fact.userId === userId && fact.status === 'proposed') { fact.status = 'rejected'; fact.updatedAt = new Date().toISOString(); count++; } });
    return count;
  }
  async forget(userId: string, key?: string): Promise<number> {
    let count = 0;
    this.facts.forEach((fact) => { if (fact.userId === userId && (!key || fact.key === key) && ['confirmed', 'proposed'].includes(fact.status)) { fact.status = 'rejected'; fact.updatedAt = new Date().toISOString(); count++; } });
    return count;
  }
  clear(): void { this.facts = []; }
}

interface MemoryRow {
  memory_id: string; phone_number: string; scope: TravellerMemoryScope; context_id: string | null; memory_key: TravellerMemoryFact['key'];
  memory_value: string; status: TravellerMemoryFact['status']; sensitive: boolean; confidence: number; explicit: boolean;
  source_message_id: string; created_at: Date; updated_at: Date; expires_at: Date | null;
}

export class PostgresTravellerMemoryRepository implements TravellerMemoryRepository {
  async findForContext(userId: string, contextIds: string[] = []): Promise<TravellerMemoryFact[]> {
    const result = await pool.query<MemoryRow>(`SELECT tm.*, u.phone_number FROM traveller_memories tm JOIN users u ON u.user_id=tm.user_id
      WHERE u.phone_number=$1 AND (tm.scope='profile' OR tm.context_id IS NULL OR tm.context_id=ANY($2::text[]))
      AND (tm.expires_at IS NULL OR tm.expires_at>NOW()) ORDER BY tm.updated_at DESC LIMIT 50`, [normalize(userId), contextIds]);
    return result.rows.map(mapRow);
  }
  async saveCandidates(userId: string, sourceMessageId: string, candidates: MemoryCandidate[], contextId = 'trip:current'): Promise<TravellerMemoryFact[]> {
    if (!candidates.length) return [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ user_id: string }>('SELECT user_id FROM users WHERE phone_number=$1 FOR UPDATE', [normalize(userId)]);
      if (!user.rows[0]) throw new Error('Traveller profile is unavailable');
      const saved: TravellerMemoryFact[] = [];
      for (const candidate of candidates) {
        const scopedId = candidate.scope === 'profile' ? null : contextId;
        const existing = await client.query<MemoryRow>(`SELECT tm.*, $6::text AS phone_number FROM traveller_memories tm
          WHERE user_id=$1 AND source_message_id=$2 AND scope=$3 AND memory_key=$4 AND memory_value=$5`,
          [user.rows[0].user_id, sourceMessageId, candidate.scope, candidate.key, candidate.value, normalize(userId)]);
        if (existing.rows[0]) { saved.push(mapRow(existing.rows[0])); continue; }
        if (!candidate.requiresConfirmation) await client.query(`UPDATE traveller_memories SET status='superseded', updated_at=NOW()
          WHERE user_id=$1 AND scope=$2 AND context_id IS NOT DISTINCT FROM $3 AND memory_key=$4 AND status='confirmed'`,
          [user.rows[0].user_id, candidate.scope, scopedId, candidate.key]);
        const inserted = await client.query<MemoryRow>(`INSERT INTO traveller_memories
          (user_id, scope, context_id, memory_key, memory_value, status, sensitive, confidence, explicit, source_message_id, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (user_id, source_message_id, scope, memory_key, memory_value) DO UPDATE SET updated_at=traveller_memories.updated_at
          RETURNING *, $12::text AS phone_number`, [user.rows[0].user_id, candidate.scope, scopedId, candidate.key, candidate.value,
            candidate.requiresConfirmation ? 'proposed' : 'confirmed', isSensitiveMemory(candidate.key), candidate.confidence, candidate.explicit, sourceMessageId,
            memoryExpiry(candidate.key), normalize(userId)]);
        saved.push(mapRow(inserted.rows[0]));
      }
      await client.query('COMMIT'); return saved;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async confirmPending(userId: string): Promise<number> {
    const result = await pool.query(`UPDATE traveller_memories tm SET status='confirmed', updated_at=NOW() FROM users u
      WHERE tm.user_id=u.user_id AND u.phone_number=$1 AND tm.status='proposed'`, [normalize(userId)]);
    return result.rowCount ?? 0;
  }
  async rejectPending(userId: string): Promise<number> {
    const result = await pool.query(`UPDATE traveller_memories tm SET status='rejected', updated_at=NOW() FROM users u
      WHERE tm.user_id=u.user_id AND u.phone_number=$1 AND tm.status='proposed'`, [normalize(userId)]);
    return result.rowCount ?? 0;
  }
  async forget(userId: string, key?: string): Promise<number> {
    const result = await pool.query(`UPDATE traveller_memories tm SET status='rejected', updated_at=NOW() FROM users u
      WHERE tm.user_id=u.user_id AND u.phone_number=$1 AND tm.status IN ('confirmed','proposed') AND ($2::text IS NULL OR tm.memory_key=$2)`, [normalize(userId), key ?? null]);
    return result.rowCount ?? 0;
  }
}

const normalize = (userId: string) => userId.startsWith('whatsapp:') ? userId.slice(9) : userId;
function memoryExpiry(key: MemoryCandidate['key']): string | null {
  if (key === 'current_location') return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (key === 'trip_destination') return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}
function mapRow(row: MemoryRow): TravellerMemoryFact { return { id: row.memory_id, userId: row.phone_number, scope: row.scope, contextId: row.context_id ?? undefined,
  key: row.memory_key, value: row.memory_value, status: row.status, sensitive: row.sensitive, confidence: Number(row.confidence), explicit: row.explicit,
  requiresConfirmation: row.sensitive, sourceMessageId: row.source_message_id, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), expiresAt: row.expires_at?.toISOString() }; }
