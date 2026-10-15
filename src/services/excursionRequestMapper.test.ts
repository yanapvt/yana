import { describe, expect, it } from 'vitest';
import { mapExcursionBookingFormToRequest } from './excursionRequestMapper.js';

describe('mapExcursionBookingFormToRequest', () => {
  it('preserves the booking-form guest count when no search count is available', () => {
    const request = mapExcursionBookingFormToRequest(
      'whatsapp:+94770000000',
      { id: 'place-1', name: 'Galle Fort Walk' },
      undefined,
      {
        preferredDate: '2026-11-20',
        preferredTime: '09:00',
        pickupLocation: 'Galle Fort',
        guests: 3,
        guestNames: 'Sam, Alex, Jo',
        contactNumber: '+94770000000',
      }
    );

    expect(request.guests.count).toBe(3);
  });
});
