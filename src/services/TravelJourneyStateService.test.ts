import { describe, expect, it } from 'vitest';
import { resolveJourneyMode, TravelJourneyStateService } from './TravelJourneyStateService.js';

class MemoryStateStore {
  private readonly values = new Map<string, unknown>();
  async getJson<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async setJson<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
  async deleteKey(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

describe('TravelJourneyStateService', () => {
  it.each([
    [{ message: 'hello' }, 'chat'],
    [{ message: 'I want to explore Sri Lanka' }, 'explore'],
    [{ message: 'Find excursions in Ella', activeService: 'excursion' }, 'explore'],
    [{ message: 'book 2', activeService: 'hotel' }, 'booking'],
    [{ message: 'done', activeService: 'restaurant', bookingStageActive: true }, 'booking'],
  ] as const)('resolves journey mode from explicit intent and active service', (input, expected) => {
    expect(resolveJourneyMode(input)).toBe(expected);
  });

  it('persists chat, explore, and booking modes with the active service', async () => {
    const service = new TravelJourneyStateService(new MemoryStateStore() as any);

    await service.set('whatsapp:test-user', 'chat');
    expect(await service.get('whatsapp:test-user')).toMatchObject({ mode: 'chat' });

    await service.set('whatsapp:test-user', 'explore', 'excursion');
    expect(await service.get('whatsapp:test-user')).toMatchObject({
      mode: 'explore',
      activeService: 'excursion',
    });

    await service.set('whatsapp:test-user', 'booking', 'hotel');
    expect(await service.get('whatsapp:test-user')).toMatchObject({
      mode: 'booking',
      activeService: 'hotel',
    });
  });

  it('clears a user journey state', async () => {
    const service = new TravelJourneyStateService(new MemoryStateStore() as any);
    await service.set('whatsapp:test-user', 'explore', 'restaurant');
    await service.clear('whatsapp:test-user');
    expect(await service.get('whatsapp:test-user')).toBeNull();
  });
});
