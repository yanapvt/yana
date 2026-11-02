import { describe, expect, it, vi } from 'vitest';
import { WeatherContextService } from './WeatherContextService.js';

describe('WeatherContextService', () => {
  it('adds a rain warning only from a matching dated forecast', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ name: 'Galle', latitude: 6.03, longitude: 80.22 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ daily: { time: ['2026-10-30'], precipitation_probability_max: [75] } }) });
    const service = new WeatherContextService(request as unknown as typeof fetch, () => new Date('2026-10-29T12:00:00Z'));
    expect(await service.outdoorAdvice('Hiking in Galle tomorrow')).toContain('75% chance of rain');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('degrades quietly when a provider fails', async () => {
    const service = new WeatherContextService(vi.fn().mockRejectedValue(new Error('unavailable')) as unknown as typeof fetch);
    expect(await service.outdoorAdvice('Hiking in Galle tomorrow')).toBeNull();
  });
});
