import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/connection.js';
import type { HotelSearchSession } from '../services/hotelSearchSessionService.js';
import { PostgresHotelSearchSessionRepository } from './hotelSearchSessionRepository.js';

vi.mock('../db/connection.js', () => ({
  pool: { connect: vi.fn() },
}));

function firstContactSession(userId: string): HotelSearchSession {
  const now = new Date().toISOString();
  return {
    id: 'first-contact-session',
    userId,
    whatsappUserId: userId,
    normalizedCriteria: {},
    criteria: {},
    resultBatches: [],
    latestDisplayedBatchIndex: -1,
    nextCount: 0,
    results: [],
    nextOffset: 0,
    state: 'profile_required',
    stage: 'awaiting_preferences',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}

describe('PostgresHotelSearchSessionRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the identity row before saving a first-contact profile gate session', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ user_id: 'database-user-id' }] }) // INSERT user
        .mockResolvedValueOnce({ rows: [] }) // Ensure preferences row
        .mockResolvedValueOnce({ rows: [] }) // Lock/read preferences
        .mockResolvedValueOnce({ rows: [] }) // Persist session
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const userId = 'whatsapp:+94770000001';
    const phoneNumber = '+94770000001';
    await new PostgresHotelSearchSessionRepository().upsert(firstContactSession(userId));

    const insertUser = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO users'));
    expect(insertUser?.[0]).toContain('ON CONFLICT (phone_number)');
    expect(insertUser?.[1]).toEqual([
      phoneNumber,
      crypto.createHash('sha256').update(phoneNumber).digest('hex'),
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
    expect(client.release).toHaveBeenCalledOnce();
  });
});
