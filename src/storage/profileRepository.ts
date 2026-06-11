import crypto from 'node:crypto';
import type { BasicProfileForm, StoredProfile } from '../types/forms.js';
import { basicProfileFormSchema } from '../validation/formSchemas.js';
import { pool } from '../db/connection.js';

export interface ProfileRepository {
  findByUserId(userId: string): Promise<StoredProfile | null>;
  upsert(userId: string, profile: BasicProfileForm): Promise<StoredProfile>;
}

/**
 * Implements the repository contract without committing the app to a database
 * shape. A PostgreSQL implementation can replace this class later.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  private readonly profiles = new Map<string, StoredProfile>();

  findByUserId(userId: string): Promise<StoredProfile | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  upsert(userId: string, form: BasicProfileForm): Promise<StoredProfile> {
    const existing = this.profiles.get(userId);
    const now = new Date();
    const profile: StoredProfile = {
      userId,
      form,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.profiles.set(userId, profile);
    return Promise.resolve(profile);
  }

  clear(): void {
    this.profiles.clear();
  }
}

const PROFILE_FORM_KEY = 'yanaBasicProfileForm';

interface ProfileRow {
  phone_number: string;
  notification_preferences: unknown;
  profile_created_at: Date;
  profile_updated_at: Date;
}

export class PostgresProfileRepository implements ProfileRepository {
  async findByUserId(userId: string): Promise<StoredProfile | null> {
    const phoneNumber = normalizePhoneNumber(userId);
    const result = await pool.query<ProfileRow>(
      `SELECT
         users.phone_number,
         user_preferences.notification_preferences,
         user_profiles.created_at AS profile_created_at,
         user_profiles.updated_at AS profile_updated_at
       FROM users
       JOIN user_profiles ON user_profiles.user_id = users.user_id
       JOIN user_preferences ON user_preferences.user_id = users.user_id
       WHERE users.phone_number = $1`,
      [phoneNumber]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const form = readStoredProfileForm(row.notification_preferences);
    if (!form) {
      return null;
    }

    return {
      userId,
      form,
      createdAt: row.profile_created_at,
      updatedAt: row.profile_updated_at,
    };
  }

  async upsert(userId: string, form: BasicProfileForm): Promise<StoredProfile> {
    const phoneNumber = normalizePhoneNumber(userId);
    const phoneHash = crypto.createHash('sha256').update(phoneNumber).digest('hex');
    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query<{ user_id: string }>(
        `INSERT INTO users (phone_number, phone_hash, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (phone_number)
         DO UPDATE SET updated_at = NOW()
         RETURNING user_id`,
        [phoneNumber, phoneHash]
      );
      const databaseUserId = userResult.rows[0]?.user_id;
      if (!databaseUserId) {
        throw new Error('Failed to upsert profile user');
      }

      const profileResult = await client.query<{
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO user_profiles (
           user_id,
           name,
           nationality,
           preferred_language,
           home_location,
           preferred_currency,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           nationality = EXCLUDED.nationality,
           preferred_language = EXCLUDED.preferred_language,
           home_location = EXCLUDED.home_location,
           preferred_currency = EXCLUDED.preferred_currency,
           updated_at = NOW()
         RETURNING created_at, updated_at`,
        [
          databaseUserId,
          form.fullName,
          form.nationality.slice(0, 3).toUpperCase(),
          form.preferredLanguage,
          `${form.city}, ${form.countryOfResidence}`,
          form.preferredCurrency,
        ]
      );

      await client.query(
        `INSERT INTO user_preferences (
           user_id,
           tts_enabled,
           proactive_messaging_enabled,
           notification_preferences,
           created_at,
           updated_at
         )
         VALUES ($1, false, false, jsonb_build_object($2::text, $3::jsonb), NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           notification_preferences =
             COALESCE(user_preferences.notification_preferences, '{}'::jsonb)
             || jsonb_build_object($2::text, $3::jsonb),
           updated_at = NOW()`,
        [databaseUserId, PROFILE_FORM_KEY, JSON.stringify(form)]
      );

      await client.query(
        `INSERT INTO user_language_settings (
           user_id,
           recent_actions,
           frequent_services,
           common_destinations,
           preferred_vendors,
           past_bookings,
           timing_patterns,
           created_at,
           updated_at
         )
         VALUES ($1, '[]', '[]', '[]', '[]', '[]', '{}', NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [databaseUserId]
      );

      await client.query('COMMIT');

      const timestamps = profileResult.rows[0];
      return {
        userId,
        form,
        createdAt: timestamps?.created_at ?? now,
        updatedAt: timestamps?.updated_at ?? now,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizePhoneNumber(userId: string): string {
  return userId.startsWith('whatsapp:') ? userId.slice('whatsapp:'.length) : userId;
}

function readStoredProfileForm(notificationPreferences: unknown): BasicProfileForm | null {
  if (!isRecord(notificationPreferences)) {
    return null;
  }

  const parsed = basicProfileFormSchema.safeParse(notificationPreferences[PROFILE_FORM_KEY]);
  return parsed.success ? parsed.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
