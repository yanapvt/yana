import { pool } from '../db/connection.js';
import type { RestaurantSearchSession } from '../services/restaurantSearchSessionService.js';

const RESTAURANT_SESSIONS_KEY = 'yanaRestaurantSearchSessions';

export interface RestaurantSearchSessionRepository {
  upsert(session: RestaurantSearchSession): Promise<void>;
  findLatestActiveByUserId(userId: string): Promise<RestaurantSearchSession | null>;
  clearActiveByUserId(userId: string): Promise<void>;
}

export class InMemoryRestaurantSearchSessionRepository
  implements RestaurantSearchSessionRepository
{
  private readonly sessions = new Map<string, RestaurantSearchSession>();

  upsert(session: RestaurantSearchSession): Promise<void> {
    this.sessions.set(session.whatsappUserId, session);
    return Promise.resolve();
  }

  findLatestActiveByUserId(userId: string): Promise<RestaurantSearchSession | null> {
    const session = this.sessions.get(userId);
    return Promise.resolve(session && session.state !== 'reset' ? session : null);
  }

  clearActiveByUserId(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      this.sessions.set(userId, {
        ...session,
        state: 'reset',
        stage: 'reset',
        updatedAt: new Date().toISOString(),
      });
    }
    return Promise.resolve();
  }
}

interface PreferencesRow {
  notification_preferences: unknown;
}

export class PostgresRestaurantSearchSessionRepository
  implements RestaurantSearchSessionRepository
{
  async upsert(session: RestaurantSearchSession): Promise<void> {
    const phoneNumber = normalizePhoneNumber(session.whatsappUserId);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const userResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM users WHERE phone_number = $1`,
        [phoneNumber]
      );
      const databaseUserId = userResult.rows[0]?.user_id;

      if (!databaseUserId) {
        await client.query('COMMIT');
        return;
      }

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
            [RESTAURANT_SESSIONS_KEY]: [...sessions, session].slice(-10),
          }),
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findLatestActiveByUserId(userId: string): Promise<RestaurantSearchSession | null> {
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
): RestaurantSearchSession[] {
  const sessions = notificationPreferences[RESTAURANT_SESSIONS_KEY];
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.filter(isRestaurantSearchSession);
}

function isRestaurantSearchSession(value: unknown): value is RestaurantSearchSession {
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
