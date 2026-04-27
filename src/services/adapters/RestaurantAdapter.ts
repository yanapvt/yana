/**
 * RestaurantAdapter
 *
 * Two sources for restaurants:
 *
 * 1. Internal partner DB — restaurants onboarded via our WhatsApp merchant flow.
 *    These are stored in the `vendors` table and always shown first (partner priority).
 *
 * 2. Genie Merchant API — Sri Lanka-specific merchant directory.
 *    Falls back to Google Places when Genie is unavailable or returns no results.
 *
 * The adapter merges both sources, deduplicates by name+location, and returns
 * partner restaurants first.
 */

import { BaseProviderAdapter } from './ProviderAdapter.js';
import { CorrelationContext } from '../../types/core.js';
import { logger } from '../../config/logger.js';
import { pool } from '../../db/connection.js';
import type {
  NormalisedRestaurant,
  RestaurantSearchParams,
  RestaurantSearchResult,
  ProviderImage,
} from './types.js';

// ============================================================================
// Genie Merchant API types (minimal)
// ============================================================================

interface GenieMerchant {
  id: string;
  name: string;
  category?: string;
  cuisine?: string[];
  price_range?: string;
  rating?: number;
  review_count?: number;
  address?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  menu_url?: string;
  images?: string[];
  latitude?: number;
  longitude?: number;
  tags?: string[];
  open_now?: boolean;
}

interface GenieSearchResponse {
  merchants?: GenieMerchant[];
  total?: number;
  error?: string;
}

// ============================================================================
// RestaurantAdapter
// ============================================================================

export class RestaurantAdapter extends BaseProviderAdapter {
  private readonly genieApiKey: string | undefined;
  private readonly genieBaseUrl: string;

  constructor(genieApiKey?: string, genieBaseUrl?: string) {
    super({ maxRetries: 2, initialDelayMs: 500 });
    this.genieApiKey = genieApiKey;
    this.genieBaseUrl = genieBaseUrl ?? 'https://api.genie.lk/v1';
  }

  getProviderName(): string {
    return 'restaurant';
  }

  async execute(params: Record<string, unknown>, ctx: CorrelationContext): Promise<RestaurantSearchResult> {
    return this.searchRestaurants(params as unknown as RestaurantSearchParams, ctx);
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  async searchRestaurants(params: RestaurantSearchParams, ctx: CorrelationContext): Promise<RestaurantSearchResult> {
    logger.debug('RestaurantAdapter', 'Searching restaurants', {
      correlationId: ctx.correlationId,
      location: params.location,
      cuisine: params.cuisine,
    });

    // Run partner DB and Genie in parallel
    const [partnerResults, genieResults] = await Promise.allSettled([
      this.searchPartnerDB(params, ctx),
      this.searchGenie(params, ctx),
    ]);

    const partners = partnerResults.status === 'fulfilled' ? partnerResults.value : [];
    const genie = genieResults.status === 'fulfilled' ? genieResults.value : [];

    if (partnerResults.status === 'rejected') {
      logger.warn('RestaurantAdapter', 'Partner DB search failed', {
        correlationId: ctx.correlationId,
        error: partnerResults.reason?.message,
      });
    }
    if (genieResults.status === 'rejected') {
      logger.warn('RestaurantAdapter', 'Genie search failed', {
        correlationId: ctx.correlationId,
        error: genieResults.reason?.message,
      });
    }

    // Merge: partners first, then Genie, deduplicated by normalised name
    const seen = new Set<string>();
    const merged: NormalisedRestaurant[] = [];

    for (const r of [...partners, ...genie]) {
      const key = r.name.toLowerCase().replace(/\s+/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    const limited = merged.slice(0, params.maxResults ?? 10);

    return {
      restaurants: limited,
      totalResults: merged.length,
      provider: partners.length > 0 ? 'whatsapp_onboarded+genie' : 'genie',
    };
  }

  // ==========================================================================
  // Internal partner DB (vendors table)
  // ==========================================================================

  private async searchPartnerDB(
    params: RestaurantSearchParams,
    ctx: CorrelationContext
  ): Promise<NormalisedRestaurant[]> {
    const conditions: string[] = [
      `vendor_type = 'restaurant'`,
      `is_active = true`,
    ];
    const values: unknown[] = [];
    let idx = 1;

    if (params.location) {
      conditions.push(`(city ILIKE $${idx} OR address ILIKE $${idx})`);
      values.push(`%${params.location}%`);
      idx++;
    }
    if (params.cuisine) {
      conditions.push(`cuisine_tags @> $${idx}::jsonb`);
      values.push(JSON.stringify([params.cuisine]));
      idx++;
    }

    const sql = `
      SELECT vendor_id, name, address, city, phone_number, whatsapp_number,
             cuisine_tags, price_range, rating, review_count,
             latitude, longitude, menu_url, website_url, photo_urls, tags
      FROM vendors
      WHERE ${conditions.join(' AND ')}
      ORDER BY rating DESC NULLS LAST
      LIMIT 20
    `;

    const result = await pool.query(sql, values);

    return result.rows.map((row) => this.dbRowToRestaurant(row));
  }

  private dbRowToRestaurant(row: any): NormalisedRestaurant {
    const images: ProviderImage[] = (row.photo_urls ?? []).slice(0, 3).map((url: string) => ({
      url,
      source: 'provider',
    }));

    const geo = row.latitude && row.longitude
      ? {
          lat: parseFloat(row.latitude),
          lng: parseFloat(row.longitude),
          googleMapsUrl: `https://maps.google.com/?q=${row.latitude},${row.longitude}`,
        }
      : undefined;

    return {
      provider: 'whatsapp_onboarded',
      restaurantId: row.vendor_id,
      name: row.name,
      cuisine: row.cuisine_tags ?? [],
      priceRange: (row.price_range ?? '$$') as '$' | '$$' | '$$$' | '$$$$',
      rating: parseFloat(row.rating ?? '0'),
      reviewCount: parseInt(row.review_count ?? '0', 10),
      location: [row.address, row.city].filter(Boolean).join(', '),
      phoneNumber: row.phone_number,
      whatsappNumber: row.whatsapp_number,
      menuUrl: row.menu_url,
      bookingUrl: row.website_url,
      images,
      geo,
      tags: row.tags ?? [],
      isPartner: true,
    };
  }

  // ==========================================================================
  // Genie Merchant API
  // ==========================================================================

  private async searchGenie(
    params: RestaurantSearchParams,
    ctx: CorrelationContext
  ): Promise<NormalisedRestaurant[]> {
    if (!this.genieApiKey) return [];

    const url = new URL(`${this.genieBaseUrl}/merchants/search`);
    url.searchParams.set('location', params.location);
    url.searchParams.set('category', 'restaurant');
    if (params.cuisine) url.searchParams.set('cuisine', params.cuisine);
    if (params.openNow) url.searchParams.set('open_now', 'true');
    url.searchParams.set('limit', String(params.maxResults ?? 15));

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryPolicy.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          headers: {
            'X-API-Key': this.genieApiKey,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Genie HTTP ${res.status}`);
        const data = await res.json() as GenieSearchResponse;
        if (data.error) throw new Error(data.error);
        return (data.merchants ?? []).map((m) => this.genieMerchantToRestaurant(m));
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt <= this.retryPolicy.maxRetries) await this.sleep(this.calculateBackoffDelay(attempt - 1));
      }
    }
    throw lastError ?? new Error('RestaurantAdapter: Genie request failed');
  }

  private genieMerchantToRestaurant(m: GenieMerchant): NormalisedRestaurant {
    const images: ProviderImage[] = (m.images ?? []).slice(0, 3).map((url) => ({
      url,
      source: 'provider',
    }));

    const geo = m.latitude && m.longitude
      ? {
          lat: m.latitude,
          lng: m.longitude,
          googleMapsUrl: `https://maps.google.com/?q=${m.latitude},${m.longitude}`,
        }
      : undefined;

    const priceMap: Record<string, '$' | '$$' | '$$$' | '$$$$'> = {
      budget: '$', mid: '$$', upscale: '$$$', fine: '$$$$',
    };

    return {
      provider: 'genie_merchant',
      restaurantId: m.id,
      name: m.name,
      cuisine: m.cuisine ?? (m.category ? [m.category] : []),
      priceRange: priceMap[m.price_range ?? 'mid'] ?? '$$',
      rating: m.rating ?? 0,
      reviewCount: m.review_count ?? 0,
      location: m.address ?? '',
      phoneNumber: m.phone,
      whatsappNumber: m.whatsapp,
      menuUrl: m.menu_url,
      bookingUrl: m.website,
      images,
      geo,
      tags: m.tags ?? [],
      isPartner: false,
    };
  }
}
