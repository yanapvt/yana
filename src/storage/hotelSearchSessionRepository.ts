import crypto from 'node:crypto';
import { assertExpectedRevision, PersistenceError } from './Persistence.js';
import { pool } from '../db/connection.js';
import { appendWorkflowTransition } from './WorkflowTransitionAudit.js';
import type { HotelSearchSession } from '../services/hotelSearchSessionService.js';

const HOTEL_SESSIONS_KEY = 'yanaHotelSearchSessions';

export interface HotelSearchSessionRepository {
  upsert(session: HotelSearchSession, expectedRevision?: number): Promise<void>;
  findLatestActiveByUserId(userId: string): Promise<HotelSearchSession | null>;
  clearActiveByUserId(userId: string): Promise<void>;
}

export class InMemoryHotelSearchSessionRepository implements HotelSearchSessionRepository {
  private readonly sessions = new Map<string, HotelSearchSession>();

  upsert(session: HotelSearchSession, expectedRevision?: number): Promise<void> {
    const expected = expectedRevision ?? session.revision ?? 0;
    assertExpectedRevision([...this.sessions.values()], session, expected);
    this.sessions.set(session.whatsappUserId, structuredClone({ ...session, revision: expected + 1 }));
    return Promise.resolve();
  }

  findLatestActiveByUserId(userId: string): Promise<HotelSearchSession | null> {
    const session = this.sessions.get(userId);
    return Promise.resolve(session && session.state !== 'reset' ? session : null);
  }

  clearActiveByUserId(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      this.sessions.set(userId, {
        ...session,
        revision: (session.revision ?? 0) + 1,
        state: 'reset',
        stage: 'reset',
        updatedAt: new Date().toISOString(),
      });
    }
    return Promise.resolve();
  }

  clear(): void {
    this.sessions.clear();
  }
}

interface PreferencesRow {
  notification_preferences: unknown;
}

export class PostgresHotelSearchSessionRepository implements HotelSearchSessionRepository {
  async upsert(session: HotelSearchSession, expectedRevision?: number): Promise<void> {
    const phoneNumber = normalizePhoneNumber(session.whatsappUserId);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      // The first inbound message can arrive before the profile form is
      // completed. Persisting its profile-required session must therefore
      // establish the identity row instead of assuming the user already exists.
      const phoneHash = crypto.createHash('sha256').update(phoneNumber).digest('hex');
      const userResult = await client.query<{ user_id: string }>(
        `INSERT INTO users (phone_number, phone_hash, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (phone_number)
         DO UPDATE SET updated_at = NOW()
         RETURNING user_id`,
        [phoneNumber, phoneHash]
      );
      const databaseUserId = userResult.rows[0]?.user_id;

      if (!databaseUserId) throw new PersistenceError();

      await client.query(
        `INSERT INTO user_preferences (
           user_id,
           tts_enabled,
           proactive_messaging_enabled,
           notification_preferences,
           created_at,
           updated_at
         )
         VALUES ($1, false, false, '{}', NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [databaseUserId]
      );

      const preferencesResult = await client.query<PreferencesRow>(
        `SELECT notification_preferences
         FROM user_preferences
         WHERE user_id = $1
         FOR UPDATE`,
        [databaseUserId]
      );
      const notificationPreferences = readPreferences(preferencesResult.rows[0]);
      const expected = expectedRevision ?? session.revision ?? 0;
      assertExpectedRevision(readPersistedSessions(notificationPreferences), session, expected);
      session = { ...session, revision: expected + 1 };
      const sessions = readPersistedSessions(notificationPreferences).filter(
        (persisted) => persisted.whatsappUserId !== session.whatsappUserId
      );

      await client.query(
        `UPDATE user_preferences
         SET notification_preferences = $2::jsonb,
             updated_at = NOW()
         WHERE user_id = $1`,
        [
          databaseUserId,
          JSON.stringify({
            ...notificationPreferences,
            [HOTEL_SESSIONS_KEY]: [...sessions, session].slice(-10),
          }),
        ]
      );
      await appendWorkflowTransition(client, 'hotel', session);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findLatestActiveByUserId(userId: string): Promise<HotelSearchSession | null> {
    const phoneNumber = normalizePhoneNumber(userId);
    const result = await pool.query<PreferencesRow>(
      `SELECT user_preferences.notification_preferences
       FROM users
       JOIN user_preferences ON user_preferences.user_id = users.user_id
       WHERE users.phone_number = $1`,
      [phoneNumber]
    );
    const sessions = readPersistedSessions(readPreferences(result.rows[0]))
      .filter((session) => session.whatsappUserId === userId && session.state !== 'reset')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return sessions[0] ?? null;
  }

  async clearActiveByUserId(userId: string): Promise<void> {
    const active = await this.findLatestActiveByUserId(userId);
    if (!active) {
      return;
    }

    await this.upsert({
      ...active,
      state: 'reset',
      stage: 'reset',
      updatedAt: new Date().toISOString(),
    });
  }
}

function normalizePhoneNumber(userId: string): string {
  return userId.startsWith('whatsapp:') ? userId.slice('whatsapp:'.length) : userId;
}

function readPreferences(row?: PreferencesRow): Record<string, unknown> {
  return isRecord(row?.notification_preferences) ? row.notification_preferences : {};
}

function readPersistedSessions(
  notificationPreferences: Record<string, unknown>
): HotelSearchSession[] {
  const sessions = notificationPreferences[HOTEL_SESSIONS_KEY];
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.filter(isHotelSearchSession);
}

function isHotelSearchSession(value: unknown): value is HotelSearchSession {
  return (
    isRecord(value) &&
    typeof value.whatsappUserId === 'string' &&
    typeof value.state === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
