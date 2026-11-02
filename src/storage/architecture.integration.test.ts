import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db/connection.js';
import { PostgresItinerarySessionRepository } from './itinerarySessionRepository.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { withWorkflowLock } from '../services/WorkflowLockService.js';
import type { ItinerarySession } from '../services/itinerarySessionService.js';

const phone = '+94770000991';
const traveller = `whatsapp:${phone}`;
const repository = new PostgresItinerarySessionRepository();

beforeEach(async () => {
  await pool.query('DELETE FROM users WHERE phone_number=$1', [phone]);
  await pool.query('INSERT INTO users(phone_number,phone_hash) VALUES($1,$2)', [phone, 'architecture-integration-fixture']);
});
afterAll(async () => {
  await pool.query('DELETE FROM users WHERE phone_number=$1', [phone]);
  await pool.end();
});

function session(): ItinerarySession {
  return {
    id: 'architecture-trip', userId: traveller, whatsappUserId: traveller,
    criteria: {}, state: 'editing_itinerary', revision: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    workspaceAccess: { tokenHash: 'architecture-test-hash', createdAt: new Date().toISOString() },
  };
}

describe('architecture persistence against PostgreSQL', () => {
  it('allows one concurrent revision update and rejects the stale writer', async () => {
    await repository.upsert(session(), 0);
    const saved = (await repository.findLatestActiveByUserId(traveller))!;
    expect(saved.revision).toBe(1);
    const outcomes = await Promise.allSettled([
      repository.upsert({ ...saved, additionalPreferences: 'first' }, 1),
      repository.upsert({ ...saved, additionalPreferences: 'second' }, 1),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 'conflict' } });
    expect((await repository.findLatestActiveByUserId(traveller))?.revision).toBe(2);
  });

  it('recovers workspace access from JSON storage and excludes cleared sessions', async () => {
    await repository.upsert(session(), 0);
    expect((await new PostgresItinerarySessionRepository().findByWorkspaceTokenHash('architecture-test-hash'))?.id).toBe('architecture-trip');
    await repository.clearActiveByUserId(traveller);
    expect(await repository.findByWorkspaceTokenHash('architecture-test-hash')).toBeNull();
    await expect(repository.upsert(session(), 0)).rejects.toMatchObject({ status: 'conflict' });
  });

  it('persists both conversation roles exactly once under concurrent retries', async () => {
    const messages = new MessageRepository();
    const input = { traveller, peer: '+15550000000', requestId: 'architecture-message' };
    await Promise.all(Array.from({ length: 3 }, () => messages.appendConversationTurn({ ...input, role: 'user', text: 'Vegetarian food please.' })));
    await messages.appendConversationTurn({ ...input, role: 'assistant', text: 'Which city?' });
    const history = await new MessageRepository().findRecentByTraveller(traveller);
    expect(history).toHaveLength(2);
    expect(history.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(history[1].content).toContain('delivery not verified');
  });

  it('excludes a second connection while locked and releases after an operation fails', async () => {
    await withWorkflowLock(traveller, async () => {
      await expect(withWorkflowLock(traveller, async () => 'unexpected')).rejects.toMatchObject({ status: 'conflict' });
    });
    await expect(withWorkflowLock(traveller, async () => { throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
    await expect(withWorkflowLock(traveller, async () => 'released')).resolves.toBe('released');
  });
});
