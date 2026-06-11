import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/connection.js';
import type { HotelRequestForm } from '../types/forms.js';
import { PostgresServiceRequestRepository } from './serviceRequestRepository.js';

vi.mock('../db/connection.js', () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

const hotelForm: HotelRequestForm = {
  destination: 'Galle Fort',
  checkIn: '2026-06-12',
  checkOut: '2026-06-15',
  adults: 2,
  children: 0,
  rooms: 1,
  budget: 'USD 120 per night',
  mealPlan: 'B&B',
};

describe('PostgresServiceRequestRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends a validated service request into the preferences JSON bridge', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ user_id: 'database-user-id' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              notification_preferences: {
                existing: true,
                yanaServiceRequests: [],
              },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(client);

    const repository = new PostgresServiceRequestRepository();
    const saved = await repository.create('whatsapp:+94770000001', 'hotel', hotelForm);

    expect(saved).toMatchObject({
      userId: 'whatsapp:+94770000001',
      type: 'hotel',
      form: hotelForm,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['+94770000001'])
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE user_preferences'),
      expect.arrayContaining([
        'database-user-id',
        expect.stringContaining('"yanaServiceRequests"'),
      ])
    );
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'));
    expect(client.release).toHaveBeenCalled();
  });

  it('reads service requests for the requested WhatsApp user and service type', async () => {
    const createdAt = '2026-06-01T10:00:00.000Z';
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          notification_preferences: {
            yanaServiceRequests: [
              {
                id: 'request-1',
                userId: 'whatsapp:+94770000001',
                type: 'hotel',
                form: hotelForm,
                createdAt,
              },
              {
                id: 'request-2',
                userId: 'whatsapp:+94770000002',
                type: 'hotel',
                form: hotelForm,
                createdAt,
              },
            ],
          },
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const repository = new PostgresServiceRequestRepository();
    const requests = await repository.findByUserId('whatsapp:+94770000001', 'hotel');

    expect(requests).toEqual([
      {
        id: 'request-1',
        userId: 'whatsapp:+94770000001',
        type: 'hotel',
        form: hotelForm,
        createdAt: new Date(createdAt),
      },
    ]);
  });
});
