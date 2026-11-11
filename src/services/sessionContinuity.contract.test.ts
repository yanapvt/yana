import { describe, expect, it, vi } from 'vitest';
import { HotelSearchSessionService } from './hotelSearchSessionService.js';
import { ExcursionSearchSessionService } from './excursionSearchSessionService.js';
import { RestaurantSearchSessionService } from './restaurantSearchSessionService.js';
import { InMemoryHotelSearchSessionRepository } from '../storage/hotelSearchSessionRepository.js';
import { InMemoryRestaurantSearchSessionRepository } from '../storage/restaurantSearchSessionRepository.js';

class InstanceStateStore {
  private values = new Map<string, unknown>();
  async getJson<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async setJson<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  async deleteKey(key: string): Promise<boolean> { return this.values.delete(key); }
  async deleteSessionState(): Promise<boolean> { return false; }
}

describe('shared session continuity contract', () => {
  it('keeps a confirmed dining location across app instances and restart', async () => {
    const durable = new InMemoryRestaurantSearchSessionRepository();
    const user = 'whatsapp:test-dining-handoff';
    await new RestaurantSearchSessionService(new InstanceStateStore() as any, durable)
      .saveLocationConfirmation(user, 'Hikkaduwa', 'What can I do for dinner there?');
    const second = new RestaurantSearchSessionService(new InstanceStateStore() as any, durable);
    expect(await second.get(user)).toMatchObject({
      state: 'confirming_location', pendingLocationConfirmation: 'Hikkaduwa', criteria: {},
    });
    await second.saveAwaitingPreferences(user, { location: 'Hikkaduwa' });
    expect(await new RestaurantSearchSessionService(new InstanceStateStore() as any, durable).get(user))
      .toMatchObject({ state: 'awaiting_preferences', criteria: { location: 'Hikkaduwa' } });
  });
  it('keeps a remembered location in the hotel form session across restart', async () => {
    const durable = new InMemoryHotelSearchSessionRepository();
    const user = 'whatsapp:test-location-prefill';
    await new HotelSearchSessionService(new InstanceStateStore() as any, durable)
      .saveHotelFormSent(user, 'Find a hotel near me', undefined, { location: 'Galle' });
    const restarted = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect((await restarted.get(user))?.criteria.location).toBe('Galle');
  });
  it('resumes on a second app instance and after restart using the durable repository', async () => {
    const durable = new InMemoryHotelSearchSessionRepository();
    const first = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    await first.saveAwaitingPreferences('whatsapp:test-user-1', { location: 'Galle', checkinDate: '2026-10-01', checkoutDate: '2026-10-03', guests: 2 });
    const second = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect(await second.get('whatsapp:test-user-1')).toMatchObject({ stage: 'awaiting_preferences', criteria: { location: 'Galle' } });
    const restarted = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect((await restarted.get('whatsapp:test-user-1'))?.criteria.checkoutDate).toBe('2026-10-03');
  });
  it('preserves a paused journey and its collected fields across restart', async () => {
    const durable = new InMemoryHotelSearchSessionRepository();
    const user = 'whatsapp:test-paused-user';
    const first = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    await first.saveAwaitingPreferences(user, {
      location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-03', guests: 2,
      additionalPreferences: 'Anniversary trip',
    });

    await first.pause(user);

    const restarted = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect(await restarted.get(user)).toMatchObject({
      lifecycleStatus: 'paused',
      criteria: {
        location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-03', guests: 2,
        additionalPreferences: 'Anniversary trip',
      },
    });
    await restarted.resume(user);
    expect(await new HotelSearchSessionService(new InstanceStateStore() as any, durable).get(user)).toMatchObject({
      lifecycleStatus: 'active',
      criteria: { location: 'Galle', additionalPreferences: 'Anniversary trip' },
    });
  });

  it('preserves a completed sourcing transaction when its journey is paused and resumed', async () => {
    const durable = new InMemoryHotelSearchSessionRepository();
    const user = 'whatsapp:test-completed-transaction';
    const first = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    const criteria = { location: 'Galle', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 };
    await first.saveResults(user, criteria, [{ id: 'place-1', name: 'Selected Stay' }], 1);
    await first.selectHotel(user, 1);
    await first.markSourcingConsentPending(user);
    await first.markSourcingRequestSaved(user, 'durable-request-1');
    await first.pause(user);

    const resumed = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    await resumed.resume(user);

    expect(await resumed.get(user)).toMatchObject({
      lifecycleStatus: 'active',
      sourcingRequestId: 'durable-request-1',
      selectedHotel: { selectedHotelSnapshot: { name: 'Selected Stay' } },
    });
  });
  it('propagates reset across provider or app-instance switching', async () => {
    const durable = new InMemoryHotelSearchSessionRepository(); const user = 'whatsapp:test-user-1';
    const openWaInstance = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    await openWaInstance.saveAwaitingPreferences(user, { location: 'Kandy', checkinDate: '2026-10-01', checkoutDate: '2026-10-02' });
    await new HotelSearchSessionService(new InstanceStateStore() as any, durable).clear(user);
    expect(await new HotelSearchSessionService(new InstanceStateStore() as any, durable).get(user)).toBeNull();
  });
  it('preserves a consented hotel sourcing lead across app instances', async () => {
    const durable = new InMemoryHotelSearchSessionRepository();
    const user = 'whatsapp:test-sourcing-user';
    const first = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    const criteria = { location: 'Galle', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 };
    await first.saveResults(user, criteria, [{ id: 'google-place-1', name: 'Selected Stay' }], 1);
    await first.selectHotel(user, 1);
    await first.markSourcingConsentPending(user);
    const second = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect((await second.get(user))?.pendingSourcingConsent).toBe(true);
    await second.markSourcingRequestSaved(user, 'request-1');
    const restarted = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect(await restarted.get(user)).toMatchObject({
      sourcingRequestId: 'request-1', pendingSourcingConsent: false,
      selectedHotel: { selectedHotelSnapshot: { name: 'Selected Stay' } },
    });
  });
  it('fails safely after restart when durable state is unavailable', async () => {
    const durable = { upsert: vi.fn(), clearActiveByUserId: vi.fn(), findLatestActiveByUserId: vi.fn().mockRejectedValue(new Error('secret database detail')) };
    await expect(new HotelSearchSessionService(new InstanceStateStore() as any, durable).get('whatsapp:test-user-1')).rejects.toThrow('could not save');
  });

  it('moves an excursion session out of searching when a search has no results', async () => {
    const store = new InstanceStateStore();
    const repository = { upsert: vi.fn(), findLatestActiveByUserId: vi.fn(), clearActiveByUserId: vi.fn() };
    const sessions = new ExcursionSearchSessionService(store as any, repository);
    const userId = 'whatsapp:test-user-2';

    await sessions.saveSearching(userId, { destination: 'Colombo' });
    await sessions.saveResults(userId, { destination: 'Colombo' }, [], 0);

    expect(await sessions.get(userId)).toMatchObject({
      stage: 'results',
      state: 'showing_results',
      results: [],
      nextOffset: 0,
    });
  });
});
