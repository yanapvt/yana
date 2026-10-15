import { describe, expect, it, vi } from 'vitest';
import { OutOfScopeSupportService } from './OutOfScopeSupportService.js';

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

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('OutOfScopeSupportService', () => {
  it('sets a safety boundary and requests approximate location for a flat tyre', async () => {
    const fetcher = vi.fn();
    const service = new OutOfScopeSupportService({ store: new MemoryStateStore() as any, apiKey: 'test-key', fetcher });

    const reply = await service.handleMessage('user-1', 'I have a flat tyre');

    expect(reply).toContain('doesn’t provide tyre repair or roadside assistance');
    expect(reply).toContain('Are you somewhere safe now?');
    expect(reply).toContain('nearest town or landmark');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not call Places for possible medical emergencies', async () => {
    const fetcher = vi.fn();
    const service = new OutOfScopeSupportService({ store: new MemoryStateStore() as any, apiKey: 'test-key', fetcher });

    const reply = await service.handleMessage('user-1', 'I have a sudden severe headache');

    expect(reply).toContain('local emergency number');
    expect(reply).toContain('Please don’t wait for a Places search');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('looks up nearby clinics only after the tourist supplies an approximate area', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      places: [{
        displayName: { text: 'Colombo Medical Centre' },
        formattedAddress: 'Colombo',
        rating: 4.4,
        userRatingCount: 82,
        googleMapsUri: 'https://maps.google.com/?q=clinic',
      }],
    }));
    const service = new OutOfScopeSupportService({ store: new MemoryStateStore() as any, apiKey: 'test-key', fetcher });

    await service.handleMessage('user-1', 'I have a headache');
    const reply = await service.handleMessage('user-1', "I'm safe in Colombo");

    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      textQuery: 'medical clinic near Colombo',
      maxResultCount: 3,
    });
    expect(reply).toContain('Colombo Medical Centre');
    expect(reply).toContain('not recommendations or verified services');
    expect(reply).toContain('YANA travel transport or accommodation');
    expect(await service.handleMessage('user-1', 'Colombo')).toBeNull();
  });

  it('provides a safe Maps fallback when Places fails and accepts a new need after cancellation', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('provider details must stay private'));
    const service = new OutOfScopeSupportService({ store: new MemoryStateStore() as any, apiKey: 'test-key', fetcher });

    await service.handleMessage('user-1', 'I have a flat tire');
    const fallback = await service.handleMessage('user-1', 'Colombo');
    expect(fallback).toContain('search Google Maps');
    expect(fallback).not.toContain('provider details must stay private');

    await service.handleMessage('user-1', 'I have a headache');
    expect(await service.handleMessage('user-1', 'never mind')).toContain('I’ll leave that there');
  });
});
