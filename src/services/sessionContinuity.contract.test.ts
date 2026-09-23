import { describe, expect, it, vi } from 'vitest';
import { HotelSearchSessionService } from './hotelSearchSessionService.js';
import { InMemoryHotelSearchSessionRepository } from '../storage/hotelSearchSessionRepository.js';

class InstanceStateStore {
  private values = new Map<string, unknown>();
  async getJson<T>(key: string): Promise<T | null> { return (this.values.get(key) as T) ?? null; }
  async setJson<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  async deleteKey(key: string): Promise<boolean> { return this.values.delete(key); }
  async deleteSessionState(): Promise<boolean> { return false; }
}

describe('shared session continuity contract', () => {
  it('resumes on a second app instance and after restart using the durable repository', async () => {
    const durable = new InMemoryHotelSearchSessionRepository();
    const first = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    await first.saveAwaitingPreferences('whatsapp:test-user-1', { location: 'Galle', checkinDate: '2026-10-01', checkoutDate: '2026-10-03', guests: 2 });
    const second = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect(await second.get('whatsapp:test-user-1')).toMatchObject({ stage: 'awaiting_preferences', criteria: { location: 'Galle' } });
    const restarted = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    expect((await restarted.get('whatsapp:test-user-1'))?.criteria.checkoutDate).toBe('2026-10-03');
  });
  it('propagates reset across provider or app-instance switching', async () => {
    const durable = new InMemoryHotelSearchSessionRepository(); const user = 'whatsapp:test-user-1';
    const openWaInstance = new HotelSearchSessionService(new InstanceStateStore() as any, durable);
    await openWaInstance.saveAwaitingPreferences(user, { location: 'Kandy', checkinDate: '2026-10-01', checkoutDate: '2026-10-02' });
    await new HotelSearchSessionService(new InstanceStateStore() as any, durable).clear(user);
    expect(await new HotelSearchSessionService(new InstanceStateStore() as any, durable).get(user)).toBeNull();
  });
  it('fails safely after restart when durable state is unavailable', async () => {
    const durable = { upsert: vi.fn(), clearActiveByUserId: vi.fn(), findLatestActiveByUserId: vi.fn().mockRejectedValue(new Error('secret database detail')) };
    expect(await new HotelSearchSessionService(new InstanceStateStore() as any, durable).get('whatsapp:test-user-1')).toBeNull();
  });
});
