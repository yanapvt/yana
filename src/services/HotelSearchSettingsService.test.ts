import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../db/connection.js', () => ({ pool: { query: queryMock } }));

import { HotelSearchSettingsService } from './HotelSearchSettingsService.js';

describe('HotelSearchSettingsService', () => {
  beforeEach(() => queryMock.mockReset());

  it('reads persisted runtime controls', async () => {
    queryMock.mockResolvedValue({ rows: [{
      sltda_filter_enabled: false,
      zero_result_fallback_enabled: true,
      minimum_google_rating: '4.2',
      minimum_google_review_count: 100,
    }] });

    await expect(new HotelSearchSettingsService().getSettings()).resolves.toEqual({
      sltdaFilterEnabled: false,
      zeroResultFallbackEnabled: true,
      minimumGoogleRating: 4.2,
      minimumGoogleReviewCount: 100,
    });
  });

  it('uses safe defaults when no persisted settings exist', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    const settings = await new HotelSearchSettingsService().getSettings();

    expect(settings.zeroResultFallbackEnabled).toBe(true);
    expect(settings.minimumGoogleRating).toBeNull();
    expect(settings.minimumGoogleReviewCount).toBeNull();
  });

  it('persists all controls with a single upsert', async () => {
    queryMock.mockResolvedValue({ rows: [{
      sltda_filter_enabled: true,
      zero_result_fallback_enabled: true,
      minimum_google_rating: null,
      minimum_google_review_count: null,
    }] });
    const settings = {
      sltdaFilterEnabled: true,
      zeroResultFallbackEnabled: true,
      minimumGoogleRating: null,
      minimumGoogleReviewCount: null,
    };

    await expect(new HotelSearchSettingsService().updateSettings(settings)).resolves.toEqual(settings);
    expect(queryMock).toHaveBeenCalledOnce();
  });
});
