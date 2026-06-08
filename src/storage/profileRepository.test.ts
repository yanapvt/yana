import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/connection.js';
import type { BasicProfileForm } from '../types/forms.js';
import { PostgresProfileRepository } from './profileRepository.js';

vi.mock('../db/connection.js', () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

const profileForm: BasicProfileForm = {
  fullName: 'Jane Doe',
  preferredName: 'Jane',
  email: 'jane@example.com',
  phone: '+94770000001',
  preferredLanguage: 'English',
  nationality: 'Sri Lankan',
  countryOfResidence: 'Sri Lanka',
  city: 'Colombo',
  dateOfBirth: '1990-05-03',
  preferredCurrency: 'USD',
  travelStyle: 'Luxury',
  dietaryRestrictions: 'Vegetarian',
  accessibilityNeeds: undefined,
  consent: true,
};

describe('PostgresProfileRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the external profile form and searchable profile summary', async () => {
    const createdAt = new Date('2026-06-01T10:00:00.000Z');
    const updatedAt = new Date('2026-06-01T10:01:00.000Z');
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ user_id: 'database-user-id' }] })
        .mockResolvedValueOnce({ rows: [{ created_at: createdAt, updated_at: updatedAt }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(client);

    const repository = new PostgresProfileRepository();
    const saved = await repository.upsert('whatsapp:+94770000001', profileForm);

    expect(saved).toEqual({
      userId: 'whatsapp:+94770000001',
      form: profileForm,
      createdAt,
      updatedAt,
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'));
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['+94770000001'])
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_profiles'),
      expect.arrayContaining(['database-user-id', 'Jane Doe', 'SRI', 'English'])
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_preferences'),
      expect.arrayContaining(['database-user-id', 'yanaBasicProfileForm', JSON.stringify(profileForm)])
    );
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
    expect(client.release).toHaveBeenCalled();
  });

  it('reads the full profile form from the preferences JSON bridge', async () => {
    const createdAt = new Date('2026-06-01T10:00:00.000Z');
    const updatedAt = new Date('2026-06-01T10:01:00.000Z');
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          phone_number: '+94770000001',
          notification_preferences: {
            yanaBasicProfileForm: profileForm,
          },
          profile_created_at: createdAt,
          profile_updated_at: updatedAt,
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const repository = new PostgresProfileRepository();
    const saved = await repository.findByUserId('whatsapp:+94770000001');

    expect(saved).toEqual({
      userId: 'whatsapp:+94770000001',
      form: profileForm,
      createdAt,
      updatedAt,
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE users.phone_number = $1'),
      ['+94770000001']
    );
  });
});
