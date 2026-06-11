/**
 * UserRepository - Data access layer for user entities
 * Handles users, user_profiles, user_preferences, and user_language_settings
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';

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

      // Check if user exists (idempotency)
      const existingUser = await client.query<any>(
        'SELECT user_id, phone_number, phone_hash, created_at, updated_at FROM users WHERE phone_number = $1',
        [phoneNumber]
      );

      if (existingUser.rows.length > 0) {
        await client.query('COMMIT');
        return this.mapUser(existingUser.rows[0]);
      }

      // Create user
      const userResult = await client.query<any>(
        `INSERT INTO users (phone_number, phone_hash, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING user_id, phone_number, phone_hash, created_at, updated_at`,
        [phoneNumber, phoneHash]
      );

      const user = userResult.rows[0];

      // Create user profile
      await client.query(
        `INSERT INTO user_profiles (user_id, preferred_language, preferred_currency, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [user.user_id, preferredLanguage, preferredCurrency]
      );

      // Create user preferences
      await client.query(
        `INSERT INTO user_preferences (user_id, tts_enabled, proactive_messaging_enabled, notification_preferences, created_at, updated_at)
         VALUES ($1, false, false, '{}', NOW(), NOW())`,
        [user.user_id]
      );

      // Create user language settings
      await client.query(
        `INSERT INTO user_language_settings (user_id, recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns, created_at, updated_at)
         VALUES ($1, '[]', '[]', '[]', '[]', '[]', '{}', NOW(), NOW())`,
        [user.user_id]
      );

      await client.query('COMMIT');
      return this.mapUser(user);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find user by phone number
   */
  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const result = await pool.query<any>(
      'SELECT user_id, phone_number, phone_hash, created_at, updated_at FROM users WHERE phone_number = $1',
      [phoneNumber]
    );

    return result.rows.length > 0 ? this.mapUser(result.rows[0]) : null;
  }

  /**
   * Find user by user ID
   */
  async findById(userId: string): Promise<User | null> {
    const result = await pool.query<any>(
      'SELECT user_id, phone_number, phone_hash, created_at, updated_at FROM users WHERE user_id = $1',
      [userId]
    );

    return result.rows.length > 0 ? this.mapUser(result.rows[0]) : null;
  }

  /**
   * Get user profile
   */
  async getProfile(userId: string): Promise<UserProfileData | null> {
    const result = await pool.query<any>(
      `SELECT user_id, name, nationality, preferred_language, home_location, preferred_currency, created_at, updated_at
       FROM user_profiles WHERE user_id = $1`,
      [userId]
    );

    return result.rows.length > 0 ? this.mapUserProfile(result.rows[0]) : null;
  }

  /**
   * Update user profile
   * Idempotent: Updates only provided fields
   */
  async updateProfile(
    userId: string,
    updates: Partial<Omit<UserProfileData, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UserProfileData> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.nationality !== undefined) {
      fields.push(`nationality = $${paramIndex++}`);
      values.push(updates.nationality);
    }
    if (updates.preferredLanguage !== undefined) {
      fields.push(`preferred_language = $${paramIndex++}`);
      values.push(updates.preferredLanguage);
    }
    if (updates.homeLocation !== undefined) {
      fields.push(`home_location = $${paramIndex++}`);
      values.push(updates.homeLocation);
    }
    if (updates.preferredCurrency !== undefined) {
      fields.push(`preferred_currency = $${paramIndex++}`);
      values.push(updates.preferredCurrency);
    }

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query<any>(
      `UPDATE user_profiles SET ${fields.join(', ')}
       WHERE user_id = $${paramIndex}
       RETURNING user_id, name, nationality, preferred_language, home_location, preferred_currency, created_at, updated_at`,
      values
    );

    return this.mapUserProfile(result.rows[0]);
  }

  /**
   * Get user preferences
   */
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const result = await pool.query<any>(
      `SELECT user_id, tts_enabled, proactive_messaging_enabled, notification_preferences, created_at, updated_at
       FROM user_preferences WHERE user_id = $1`,
      [userId]
    );

    return result.rows.length > 0 ? this.mapUserPreferences(result.rows[0]) : null;
  }

  /**
   * Update user preferences
   * Idempotent: Updates only provided fields
   */
  async updatePreferences(
    userId: string,
    updates: Partial<Omit<UserPreferences, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UserPreferences> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.ttsEnabled !== undefined) {
      fields.push(`tts_enabled = $${paramIndex++}`);
      values.push(updates.ttsEnabled);
    }
    if (updates.proactiveMessagingEnabled !== undefined) {
      fields.push(`proactive_messaging_enabled = $${paramIndex++}`);
      values.push(updates.proactiveMessagingEnabled);
    }
    if (updates.notificationPreferences !== undefined) {
      fields.push(`notification_preferences = $${paramIndex++}`);
      values.push(JSON.stringify(updates.notificationPreferences));
    }

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query<any>(
      `UPDATE user_preferences SET ${fields.join(', ')}
       WHERE user_id = $${paramIndex}
       RETURNING user_id, tts_enabled, proactive_messaging_enabled, notification_preferences, created_at, updated_at`,
      values
    );

    return this.mapUserPreferences(result.rows[0]);
  }

  /**
   * Get user language settings (behavioral memory)
   */
  async getLanguageSettings(userId: string): Promise<UserLanguageSettings | null> {
    const result = await pool.query<any>(
      `SELECT user_id, recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns, created_at, updated_at
       FROM user_language_settings WHERE user_id = $1`,
      [userId]
    );

    return result.rows.length > 0 ? this.mapUserLanguageSettings(result.rows[0]) : null;
  }

  /**
   * Update user language settings (behavioral memory)
   * Idempotent: Updates only provided fields
   */
  async updateLanguageSettings(
    userId: string,
    updates: Partial<Omit<UserLanguageSettings, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<UserLanguageSettings> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.recentActions !== undefined) {
      fields.push(`recent_actions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.recentActions));
    }
    if (updates.frequentServices !== undefined) {
      fields.push(`frequent_services = $${paramIndex++}`);
      values.push(JSON.stringify(updates.frequentServices));
    }
    if (updates.commonDestinations !== undefined) {
      fields.push(`common_destinations = $${paramIndex++}`);
      values.push(JSON.stringify(updates.commonDestinations));
    }
    if (updates.preferredVendors !== undefined) {
      fields.push(`preferred_vendors = $${paramIndex++}`);
      values.push(JSON.stringify(updates.preferredVendors));
    }
    if (updates.pastBookings !== undefined) {
      fields.push(`past_bookings = $${paramIndex++}`);
      values.push(JSON.stringify(updates.pastBookings));
    }
    if (updates.timingPatterns !== undefined) {
      fields.push(`timing_patterns = $${paramIndex++}`);
      values.push(JSON.stringify(updates.timingPatterns));
    }

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query<any>(
      `UPDATE user_language_settings SET ${fields.join(', ')}
       WHERE user_id = $${paramIndex}
       RETURNING user_id, recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns, created_at, updated_at`,
      values
    );

    return this.mapUserLanguageSettings(result.rows[0]);
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
