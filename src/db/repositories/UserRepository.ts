/**
 * UserRepository - Data access layer for user entities
 * Handles users, user_profiles, user_preferences, and user_language_settings
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';
import type { UserProfile } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface User {
  userId: string;
  phoneNumber: string;
  phoneHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfileData {
  userId: string;
  name?: string;
  nationality?: string;
  preferredLanguage: string;
  homeLocation?: string;
  preferredCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  userId: string;
  ttsEnabled: boolean;
  proactiveMessagingEnabled: boolean;
  notificationPreferences: Record<string, boolean>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserLanguageSettings {
  userId: string;
  recentActions: string[];
  frequentServices: string[];
  commonDestinations: string[];
  preferredVendors: string[];
  pastBookings: string[];
  timingPatterns: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// UserRepository Class
// ============================================================================

export class UserRepository {
  /**
   * Create a new user with associated profile, preferences, and language settings
   * Idempotent: If user with phone number exists, returns existing user
   */
  async createUser(
    phoneNumber: string,
    phoneHash: string,
    preferredLanguage = 'en',
    preferredCurrency = 'USD'
  ): Promise<User> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingUser = await client.query<User>(
        'SELECT user_id, phone_number, phone_hash, created_at, updated_at FROM users WHERE phone_number = $1',
        [phoneNumber]
      );

      if (existingUser.rows.length > 0) {
        await client.query('COMMIT');
        return this.mapUser(existingUser.rows[0]);
      }

      const userResult = await client.query<User>(
        `INSERT INTO users (phone_number, phone_hash, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING user_id, phone_number, phone_hash, created_at, updated_at`,
        [phoneNumber, phoneHash]
      );

      const user = this.mapUser(userResult.rows[0]);

      await client.query(
        `INSERT INTO user_profiles (user_id, preferred_language, preferred_currency, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [user.userId, preferredLanguage, preferredCurrency]
      );

      await client.query(
        `INSERT INTO user_preferences (user_id, tts_enabled, proactive_messaging_enabled, notification_preferences, created_at, updated_at)
         VALUES ($1, false, false, '{}', NOW(), NOW())`,
        [user.userId]
      );

      await client.query(
        `INSERT INTO user_language_settings (user_id, recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns, created_at, updated_at)
         VALUES ($1, '[]', '[]', '[]', '[]', '[]', '{}', NOW(), NOW())`,
        [user.userId]
      );

      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const result = await pool.query<User>(
      'SELECT user_id, phone_number, phone_hash, created_at, updated_at FROM users WHERE phone_number = $1',
      [phoneNumber]
    );
    return result.rows.length > 0 ? this.mapUser(result.rows[0]) : null;
  }

  async findById(userId: string): Promise<User | null> {
    const result = await pool.query<User>(
      'SELECT user_id, phone_number, phone_hash, created_at, updated_at FROM users WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0 ? this.mapUser(result.rows[0]) : null;
  }

  async getProfile(userId: string): Promise<UserProfileData | null> {
    const result = await pool.query<UserProfileData>(
      `SELECT user_id, name, nationality, preferred_language, home_location, preferred_currency, created_at, updated_at
       FROM user_profiles WHERE user_id = $1`,
      [userId]
    );
    return result.rows.length > 0 ? this.mapUserProfile(result.rows[0]) : null;
  }

  /**
   * Update user profile — fixed parameterized SQL ($N placeholders)
   */
  async updateProfile(
    userId: string,
    updates: Partial<Omit<UserProfileData, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UserProfileData> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let n = 1;

    if (updates.name !== undefined)              { setClauses.push(`name = $${n++}`);              values.push(updates.name); }
    if (updates.nationality !== undefined)        { setClauses.push(`nationality = $${n++}`);        values.push(updates.nationality); }
    if (updates.preferredLanguage !== undefined)  { setClauses.push(`preferred_language = $${n++}`); values.push(updates.preferredLanguage); }
    if (updates.homeLocation !== undefined)       { setClauses.push(`home_location = $${n++}`);      values.push(updates.homeLocation); }
    if (updates.preferredCurrency !== undefined)  { setClauses.push(`preferred_currency = $${n++}`); values.push(updates.preferredCurrency); }

    setClauses.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query<UserProfileData>(
      `UPDATE user_profiles SET ${setClauses.join(', ')}
       WHERE user_id = $${n}
       RETURNING user_id, name, nationality, preferred_language, home_location, preferred_currency, created_at, updated_at`,
      values
    );

    return this.mapUserProfile(result.rows[0]);
  }

  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const result = await pool.query<UserPreferences>(
      `SELECT user_id, tts_enabled, proactive_messaging_enabled, notification_preferences, created_at, updated_at
       FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    return result.rows.length > 0 ? this.mapUserPreferences(result.rows[0]) : null;
  }

  /**
   * Update user preferences — fixed parameterized SQL
   */
  async updatePreferences(
    userId: string,
    updates: Partial<Omit<UserPreferences, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UserPreferences> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let n = 1;

    if (updates.ttsEnabled !== undefined)               { setClauses.push(`tts_enabled = $${n++}`);               values.push(updates.ttsEnabled); }
    if (updates.proactiveMessagingEnabled !== undefined) { setClauses.push(`proactive_messaging_enabled = $${n++}`); values.push(updates.proactiveMessagingEnabled); }
    if (updates.notificationPreferences !== undefined)   { setClauses.push(`notification_preferences = $${n++}`);   values.push(JSON.stringify(updates.notificationPreferences)); }

    setClauses.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query<UserPreferences>(
      `UPDATE user_preferences SET ${setClauses.join(', ')}
       WHERE user_id = $${n}
       RETURNING user_id, tts_enabled, proactive_messaging_enabled, notification_preferences, created_at, updated_at`,
      values
    );

    return this.mapUserPreferences(result.rows[0]);
  }

  async getLanguageSettings(userId: string): Promise<UserLanguageSettings | null> {
    const result = await pool.query<UserLanguageSettings>(
      `SELECT user_id, recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns, created_at, updated_at
       FROM user_language_settings WHERE user_id = $1`,
      [userId]
    );
    return result.rows.length > 0 ? this.mapUserLanguageSettings(result.rows[0]) : null;
  }

  /**
   * Update user language settings (behavioral memory) — fixed parameterized SQL
   */
  async updateLanguageSettings(
    userId: string,
    updates: Partial<Omit<UserLanguageSettings, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UserLanguageSettings> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let n = 1;

    if (updates.recentActions !== undefined)      { setClauses.push(`recent_actions = $${n++}`);       values.push(JSON.stringify(updates.recentActions)); }
    if (updates.frequentServices !== undefined)   { setClauses.push(`frequent_services = $${n++}`);    values.push(JSON.stringify(updates.frequentServices)); }
    if (updates.commonDestinations !== undefined) { setClauses.push(`common_destinations = $${n++}`);  values.push(JSON.stringify(updates.commonDestinations)); }
    if (updates.preferredVendors !== undefined)   { setClauses.push(`preferred_vendors = $${n++}`);    values.push(JSON.stringify(updates.preferredVendors)); }
    if (updates.pastBookings !== undefined)       { setClauses.push(`past_bookings = $${n++}`);        values.push(JSON.stringify(updates.pastBookings)); }
    if (updates.timingPatterns !== undefined)     { setClauses.push(`timing_patterns = $${n++}`);      values.push(JSON.stringify(updates.timingPatterns)); }

    setClauses.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query<UserLanguageSettings>(
      `UPDATE user_language_settings SET ${setClauses.join(', ')}
       WHERE user_id = $${n}
       RETURNING user_id, recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns, created_at, updated_at`,
      values
    );

    return this.mapUserLanguageSettings(result.rows[0]);
  }

  /**
   * Append a destination to common_destinations (deduped, max 20).
   * Called whenever the user searches for hotels/transport/excursions in a location.
   */
  async appendDestination(userId: string, destination: string): Promise<void> {
    await pool.query(
      `UPDATE user_language_settings
       SET common_destinations = (
         SELECT jsonb_agg(DISTINCT val) FROM (
           SELECT jsonb_array_elements_text(common_destinations) AS val
           UNION SELECT $1::text
         ) sub
         LIMIT 20
       ),
       updated_at = NOW()
       WHERE user_id = $2`,
      [destination, userId]
    );
  }

  /**
   * Append a service to frequent_services (deduped, max 20).
   * Called whenever the user uses a service vertical (hotels, transport, etc.).
   */
  async appendFrequentService(userId: string, service: string): Promise<void> {
    await pool.query(
      `UPDATE user_language_settings
       SET frequent_services = (
         SELECT jsonb_agg(DISTINCT val) FROM (
           SELECT jsonb_array_elements_text(frequent_services) AS val
           UNION SELECT $1::text
         ) sub
         LIMIT 20
       ),
       updated_at = NOW()
       WHERE user_id = $2`,
      [service, userId]
    );
  }

  /**
   * Prepend an action to recent_actions (max 10, newest first).
   */
  async appendRecentAction(userId: string, action: string): Promise<void> {
    await pool.query(
      `UPDATE user_language_settings
       SET recent_actions = (
         SELECT jsonb_agg(val ORDER BY idx) FROM (
           SELECT val, row_number() OVER () AS idx
           FROM (
             SELECT $1::text AS val
             UNION ALL
             SELECT jsonb_array_elements_text(recent_actions)
           ) sub
           LIMIT 10
         ) ordered
       ),
       updated_at = NOW()
       WHERE user_id = $2`,
      [action, userId]
    );
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapUser(row: any): User {
    return {
      userId: row.user_id,
      phoneNumber: row.phone_number,
      phoneHash: row.phone_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapUserProfile(row: any): UserProfileData {
    return {
      userId: row.user_id,
      name: row.name,
      nationality: row.nationality,
      preferredLanguage: row.preferred_language,
      homeLocation: row.home_location,
      preferredCurrency: row.preferred_currency,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapUserPreferences(row: any): UserPreferences {
    return {
      userId: row.user_id,
      ttsEnabled: row.tts_enabled,
      proactiveMessagingEnabled: row.proactive_messaging_enabled,
      notificationPreferences: row.notification_preferences,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapUserLanguageSettings(row: any): UserLanguageSettings {
    return {
      userId: row.user_id,
      recentActions: row.recent_actions,
      frequentServices: row.frequent_services,
      commonDestinations: row.common_destinations,
      preferredVendors: row.preferred_vendors,
      pastBookings: row.past_bookings,
      timingPatterns: row.timing_patterns,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
