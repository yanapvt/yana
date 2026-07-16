import crypto from 'crypto';
import type { FormType, ServiceRequestForm, StoredServiceRequest } from '../types/forms.js';
import { pool } from '../db/connection.js';

type ServiceFormType = Exclude<FormType, 'profile'>;
const SERVICE_REQUESTS_KEY = 'yanaServiceRequests';

export interface ServiceRequestRepository {
  create<T extends ServiceRequestForm>(
    userId: string,
    type: ServiceFormType,
    form: T
  ): Promise<StoredServiceRequest<T>>;
  findByUserId(userId: string, type?: ServiceFormType): Promise<StoredServiceRequest[]>;
}

export class InMemoryServiceRequestRepository implements ServiceRequestRepository {
  private readonly requests: StoredServiceRequest[] = [];

  create<T extends ServiceRequestForm>(
    userId: string,
    type: ServiceFormType,
    form: T
  ): Promise<StoredServiceRequest<T>> {
    const request: StoredServiceRequest<T> = {
      id: crypto.randomUUID(),
      userId,
      type,
      form,
      createdAt: new Date(),
    };

    this.requests.push(request);
    return Promise.resolve(request);
  }

  findByUserId(userId: string, type?: ServiceFormType): Promise<StoredServiceRequest[]> {
    return Promise.resolve(
      this.requests.filter(
        (request) => request.userId === userId && (!type || request.type === type)
      )
    );
  }

  clear(): void {
    this.requests.length = 0;
  }
}

interface ServiceRequestRow {
  notification_preferences: unknown;
}

interface PersistedServiceRequest {
  id: string;
  userId: string;
  type: ServiceFormType;
  form: ServiceRequestForm;
  createdAt: string;
}

export class PostgresServiceRequestRepository implements ServiceRequestRepository {
  async create<T extends ServiceRequestForm>(
    userId: string,
    type: ServiceFormType,
    form: T
  ): Promise<StoredServiceRequest<T>> {
    const phoneNumber = normalizePhoneNumber(userId);
    const phoneHash = crypto.createHash('sha256').update(phoneNumber).digest('hex');
    const createdAt = new Date();
    const request: PersistedServiceRequest = {
      id: crypto.randomUUID(),
      userId,
      type,
      form,
      createdAt: createdAt.toISOString(),
    };

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
        throw new Error('Failed to upsert service request user');
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

      const preferencesResult = await client.query<ServiceRequestRow>(
        `SELECT notification_preferences
         FROM user_preferences
         WHERE user_id = $1
         FOR UPDATE`,
        [databaseUserId]
      );
      const notificationPreferences = readPreferences(preferencesResult.rows[0]);
      const serviceRequests = readPersistedRequests(notificationPreferences);

      await client.query(
        `UPDATE user_preferences
         SET notification_preferences = $2::jsonb,
             updated_at = NOW()
         WHERE user_id = $1`,
        [
          databaseUserId,
          JSON.stringify({
            ...notificationPreferences,
            [SERVICE_REQUESTS_KEY]: [...serviceRequests, request],
          }),
        ]
      );

      await client.query('COMMIT');

      return {
        id: request.id,
        userId,
        type,
        form,
        createdAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByUserId(
    userId: string,
    type?: ServiceFormType
  ): Promise<StoredServiceRequest[]> {
    const phoneNumber = normalizePhoneNumber(userId);
    const result = await pool.query<ServiceRequestRow>(
      `SELECT user_preferences.notification_preferences
       FROM users
       JOIN user_preferences ON user_preferences.user_id = users.user_id
       WHERE users.phone_number = $1`,
      [phoneNumber]
    );
    const notificationPreferences = readPreferences(result.rows[0]);

    return readPersistedRequests(notificationPreferences)
      .filter((request) => request.userId === userId && (!type || request.type === type))
      .map((request) => ({
        id: request.id,
        userId: request.userId,
        type: request.type,
        form: request.form,
        createdAt: new Date(request.createdAt),
      }));
  }
}

function normalizePhoneNumber(userId: string): string {
  return userId.startsWith('whatsapp:') ? userId.slice('whatsapp:'.length) : userId;
}

function readPreferences(row?: ServiceRequestRow): Record<string, unknown> {
  return isRecord(row?.notification_preferences) ? row.notification_preferences : {};
}

function readPersistedRequests(
  notificationPreferences: Record<string, unknown>
): PersistedServiceRequest[] {
  const requests = notificationPreferences[SERVICE_REQUESTS_KEY];
  if (!Array.isArray(requests)) {
    return [];
  }

  return requests.filter(isPersistedServiceRequest);
}

function isPersistedServiceRequest(value: unknown): value is PersistedServiceRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.userId === 'string' &&
    isServiceFormType(value.type) &&
    isRecord(value.form) &&
    typeof value.createdAt === 'string'
  );
}

function isServiceFormType(value: unknown): value is ServiceFormType {
  return (
    value === 'hotel' ||
    value === 'restaurant' ||
    value === 'itinerary' ||
    value === 'excursion' ||
    value === 'excursion_booking' ||
    value === 'logistics' ||
    value === 'logistics_booking'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
