import { describe, expect, it } from 'vitest';
import { ExcursionSearchSessionService } from './excursionSearchSessionService.js';
import { LogisticsSearchSessionService } from './logisticsSearchSessionService.js';
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';

describe('booking form business effects in existing workflow sessions', () => {
  it('requires a selected excursion and persists only a pending provider request', async () => {
    const sessions = new ExcursionSearchSessionService(
      new FixtureStateStore() as any, new FixtureSessionRepository());
    const userId = 'whatsapp:test-excursion-booking';
    const form = { preferredDate: '2026-12-01', preferredTime: '09:00', pickupLocation: 'Galle',
      guests: 2, guestNames: 'Alex and Sam', contactNumber: '+94770000000' };
    await expect(sessions.submitBookingForm(userId, form)).rejects.toMatchObject({ status: 'conflict' });

    await sessions.saveResults(userId, { destination: 'Galle', guests: 2 },
      [{ id: 'experience-1', name: 'Coastal walk' }], 1);
    await sessions.selectExperience(userId, 1);
    await expect(sessions.submitBookingForm(userId, { ...form, guestNames: '' }))
      .rejects.toThrow();
    expect((await sessions.get(userId))?.stage).toBe('booking_form');
    await sessions.submitBookingForm(userId, form);

    expect(await sessions.get(userId)).toMatchObject({
      stage: 'provider_pending', bookingRequest: {
        experience: { name: 'Coastal walk' }, guests: { count: 2 },
        status: 'pending_provider_confirmation',
      },
    });
  });

  it('requires a selected transport option and persists only a pending provider request', async () => {
    const sessions = new LogisticsSearchSessionService(
      new FixtureStateStore() as any, new FixtureSessionRepository());
    const userId = 'whatsapp:test-transport-booking';
    const form = { passengerName: 'Alex', phoneNumber: '+94770000000', pickupContact: 'Sam' };
    await expect(sessions.submitBookingForm(userId, form)).rejects.toMatchObject({ status: 'conflict' });

    await sessions.saveResults(userId, { pickupLocation: 'Airport', destination: 'Galle' }, [{
      id: 'driver-1', provider: 'Driver request', vehicle: 'Car', estimatedPrice: 'Quote required',
      vehicleType: 'Car', capacity: 3, luggageCapacity: '2 bags', estimatedDuration: '2 hours',
    }], 1);
    await sessions.selectOption(userId, 1);
    await expect(sessions.submitBookingForm(userId, { ...form, passengerName: '' }))
      .rejects.toThrow();
    expect((await sessions.get(userId))?.stage).toBe('booking_form');
    await sessions.submitBookingForm(userId, form);

    expect(await sessions.get(userId)).toMatchObject({
      stage: 'provider_pending', bookingRequest: {
        provider: 'Driver request', pickup: 'Airport', destination: 'Galle',
        status: 'pending_provider_confirmation',
      },
    });
  });
});
