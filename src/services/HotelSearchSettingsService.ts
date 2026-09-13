import { env } from '../config/environment.js';
import { pool } from '../db/connection.js';

export interface HotelSearchSettings {
  sltdaFilterEnabled: boolean;
  zeroResultFallbackEnabled: boolean;
  minimumGoogleRating: number | null;
  minimumGoogleReviewCount: number | null;
}

export interface HotelSearchSettingsProvider {
  getSettings(): Promise<HotelSearchSettings>;
}

export class HotelSearchSettingsService implements HotelSearchSettingsProvider {
  async getSettings(): Promise<HotelSearchSettings> {
    try {
      const result = await pool.query<{
        sltda_filter_enabled: boolean;
        zero_result_fallback_enabled: boolean;
        minimum_google_rating: string | null;
        minimum_google_review_count: number | null;
      }>(`SELECT sltda_filter_enabled, zero_result_fallback_enabled,
                 minimum_google_rating, minimum_google_review_count
          FROM hotel_search_settings WHERE id = 1`);
      const row = result.rows[0];
      if (row) return mapRow(row);
    } catch (error) {
      console.warn('[HotelSearchSettings] database_read_failed_using_environment_defaults', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
    return defaultHotelSearchSettings();
  }

  async updateSettings(settings: HotelSearchSettings): Promise<HotelSearchSettings> {
    const result = await pool.query<{
      sltda_filter_enabled: boolean;
      zero_result_fallback_enabled: boolean;
      minimum_google_rating: string | null;
      minimum_google_review_count: number | null;
    }>(`INSERT INTO hotel_search_settings (
           id, sltda_filter_enabled, zero_result_fallback_enabled,
           minimum_google_rating, minimum_google_review_count, updated_at
         ) VALUES (1, $1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE SET
           sltda_filter_enabled = EXCLUDED.sltda_filter_enabled,
           zero_result_fallback_enabled = EXCLUDED.zero_result_fallback_enabled,
           minimum_google_rating = EXCLUDED.minimum_google_rating,
           minimum_google_review_count = EXCLUDED.minimum_google_review_count,
           updated_at = NOW()
         RETURNING sltda_filter_enabled, zero_result_fallback_enabled,
                   minimum_google_rating, minimum_google_review_count`, [
      settings.sltdaFilterEnabled,
      settings.zeroResultFallbackEnabled,
      settings.minimumGoogleRating,
      settings.minimumGoogleReviewCount,
    ]);
    return mapRow(result.rows[0]);
  }
}

export function defaultHotelSearchSettings(): HotelSearchSettings {
  return {
    sltdaFilterEnabled: env.sltdaRegistry.requireVerifiedHotels,
    zeroResultFallbackEnabled: true,
    minimumGoogleRating: null,
    minimumGoogleReviewCount: null,
  };
}

function mapRow(row: {
  sltda_filter_enabled: boolean;
  zero_result_fallback_enabled: boolean;
  minimum_google_rating: string | null;
  minimum_google_review_count: number | null;
}): HotelSearchSettings {
  return {
    sltdaFilterEnabled: row.sltda_filter_enabled,
    zeroResultFallbackEnabled: row.zero_result_fallback_enabled,
    minimumGoogleRating: row.minimum_google_rating === null ? null : Number(row.minimum_google_rating),
    minimumGoogleReviewCount: row.minimum_google_review_count,
  };
}

let instance: HotelSearchSettingsService | undefined;
export function getHotelSearchSettingsService(): HotelSearchSettingsService {
  return instance ??= new HotelSearchSettingsService();
}
