import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../connection.js', () => ({ pool: { connect: async () => ({ query: db.query, release: db.release }) } }));

import { BookingRepository } from './BookingRepository.js';
import { BookingState } from '../../types/core.js';

const booking = {
  booking_id: 'booking-1', user_id: 'user-1', session_id: 'session-1', correlation_id: 'corr-1',
  state: BookingState.CONFIRMED, service_type: 'hotel', service_details: {},
  created_at: new Date(), updated_at: new Date(),
};

describe('confirmed service feedback scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM bookings WHERE booking_id')) return { rows: [{ ...booking, state: BookingState.INITIATED }] };
      if (sql.startsWith('UPDATE bookings SET')) return { rows: [booking] };
      return { rows: [] };
    });
  });

  it('queues one feedback check when a booking becomes confirmed', async () => {
    await new BookingRepository().updateState('booking-1', BookingState.CONFIRMED);
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes("'confirmed_service_feedback'"));
    expect(insert).toBeDefined();
    expect(insert[0]).toContain("INTERVAL '30 minutes'");
    expect(insert[0]).toContain('ON CONFLICT');
  });

  it('does not queue feedback for a nonconfirmed state', async () => {
    await new BookingRepository().updateState('booking-1', BookingState.CANCELLED);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("'confirmed_service_feedback'"))).toBe(false);
  });
});
