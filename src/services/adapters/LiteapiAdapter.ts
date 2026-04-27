/**
 * LiteapiAdapter
 *
 * Hotel rates and inventory via liteapi.travel.
 * Supports hotels and boutique properties with real-time pricing.
 * We apply our configured margin on top of the provider price.
 *
 * Docs: https://docs.liteapi.travel
 * Actual v3 /hotels/rates response shape: { data: [{ hotelId, roomTypes, ... }] }
 */

import { BaseProviderAdapter } from './ProviderAdapter.js';
import { CorrelationContext } from '../../types/core.js';
import { env } from '../../config/environment.js';
import { logger } from '../../config/logger.js';
import type { NormalisedHotel, HotelSearchParams, HotelSearchResult, ProviderImage } from './types.js';

const LITEAPI_BASE = 'https://api.liteapi.travel/v3.0';

// ============================================================================
// Actual Liteapi v3 response types (from observed API responses)
// ============================================================================

interface LiteapiRoomType {
  offerId?: string;
  name?: string;
  boardType?: string;
  /** Direct price object: { amount: number, currency: string } */
  offerRetailRate?: { amount?: number; currency?: string };
  suggestedSellingPrice?: { amount?: number; currency?: string; source?: string };
  offerInitialPrice?: { amount?: number; currency?: string };
  cancellationPolicies?: {
    refundableTag?: string;
    cancelPolicyInfos?: Array<{ amount?: number; type?: string }>;
  };
  [key: string]: unknown;
}

interface LiteapiHotelResult {
  hotelId: string;
  roomTypes?: LiteapiRoomType[];
  hotelData?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Response from GET /data/hotel?hotelId=... */
interface LiteapiHotelDetails {
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  starRating?: number;
  rating?: number;
  reviewCount?: number;
  main_photo?: string;
  photos?: Array<{ url?: string; urlHd?: string; caption?: string }>;
  hotelFacilities?: string[];
  location?: { latitude?: number; longitude?: number };
  [key: string]: unknown;
}

interface LiteapiSearchResponse {
  data?: LiteapiHotelResult[];
  error?: string;
  [key: string]: unknown;
}

// ============================================================================
// LiteapiAdapter
// ============================================================================

export class LiteapiAdapter extends BaseProviderAdapter {
  private readonly apiKey: string;
  private readonly marginMultiplier: number;

  constructor(apiKey: string) {
    super({ maxRetries: 2, initialDelayMs: 1000 });
    this.apiKey = apiKey;
    this.marginMultiplier = 1 + (env.providers.hotelMarginPercent / 100);
  }

  getProviderName(): string {
    return 'liteapi';
  }

  async execute(params: Record<string, unknown>, ctx: CorrelationContext): Promise<HotelSearchResult> {
    return this.searchHotels(params as unknown as HotelSearchParams, ctx);
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  async searchHotels(params: HotelSearchParams, ctx: CorrelationContext): Promise<HotelSearchResult> {
    const checkin = this.normaliseDate(params.checkinDate);

    // If checkout looks like a computed expression ("tomorrow + 2 days"), ignore it
    const checkoutRaw = params.checkoutDate ?? '';
    const checkoutIsComputed = /[+\-]/.test(checkoutRaw) && !/^\d{4}-\d{2}-\d{2}$/.test(checkoutRaw);
    const checkout = checkoutIsComputed
      ? this.defaultCheckout(checkin || params.checkinDate)
      : this.normaliseDate(checkoutRaw || this.defaultCheckout(checkin || params.checkinDate));

    if (!checkin || !checkout) {
      throw new Error(`Liteapi: unparseable dates — checkin: "${params.checkinDate}", checkout: "${params.checkoutDate}"`);
    }

    logger.debug('LiteapiAdapter', 'Searching hotels', {
      correlationId: ctx.correlationId,
      location: params.location,
      checkin,
      checkout,
    });

    const body: Record<string, unknown> = {
      checkin,
      checkout,
      currency: params.currency ?? 'USD',
      guestNationality: 'LK',
      occupancies: [{ adults: params.guests ?? 2, children: [] }],
      limit: 10,
      aiSearch: `hotels in ${params.location}`,
      includeHotelData: true,   // returns hotel name, address, photos inline
    };

    const response = await this.post<LiteapiSearchResponse>('/hotels/rates', body, ctx);

    if (response.error) {
      const errMsg = typeof response.error === 'string'
        ? response.error
        : JSON.stringify(response.error);
      throw new Error(`Liteapi error: ${errMsg}`);
    }

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      logger.info('LiteapiAdapter', 'No hotels returned from Liteapi', {
        correlationId: ctx.correlationId,
        location: params.location,
      });
      return { hotels: [], totalResults: 0, provider: 'liteapi' };
    }

    // Take top 5 results with rates, then fetch hotel details in parallel
    const topResults = response.data
      .filter(item => item.hotelId && item.roomTypes && item.roomTypes.length > 0)
      .slice(0, 5);

    // Fetch hotel details for all top results in parallel (max 5 concurrent)
    const detailsMap = await this.fetchHotelDetailsBatch(
      topResults.map(r => r.hotelId),
      ctx
    );

    const hotels = topResults.map(item =>
      this.normaliseHotelResult(item, detailsMap[item.hotelId] ?? null, params.currency ?? 'USD')
    );

    const filtered = params.maxBudget
      ? hotels.filter(h => h.pricePerNight <= params.maxBudget!)
      : hotels;

    logger.info('LiteapiAdapter', 'Hotels found', {
      correlationId: ctx.correlationId,
      total: response.data.length,
      withRates: topResults.length,
      afterBudgetFilter: filtered.length,
    });

    return { hotels: filtered, totalResults: filtered.length, provider: 'liteapi' };
  }

  private normaliseHotelResult(
    item: LiteapiHotelResult,
    details: LiteapiHotelDetails | null,
    currency: string
  ): NormalisedHotel {
    // Price is at roomTypes[n].offerRetailRate.amount (direct object, not array)
    const getRoomPrice = (r: LiteapiRoomType): number => {
      const price = (r.offerRetailRate as any)?.amount
        ?? (r.suggestedSellingPrice as any)?.amount
        ?? (r.offerInitialPrice as any)?.amount
        ?? Infinity;
      return typeof price === 'number' ? price : Infinity;
    };

    const getRoomCurrency = (r: LiteapiRoomType): string => {
      return (r.offerRetailRate as any)?.currency
        ?? (r.suggestedSellingPrice as any)?.currency
        ?? currency;
    };

    const cheapestRoom = (item.roomTypes ?? [])
      .filter(r => getRoomPrice(r) < Infinity)
      .sort((a, b) => getRoomPrice(a) - getRoomPrice(b))[0];

    const providerPrice = cheapestRoom ? getRoomPrice(cheapestRoom) : 0;
    const roomCurrency = cheapestRoom ? getRoomCurrency(cheapestRoom) : currency;
    const pricePerNight = providerPrice > 0
      ? Math.ceil(providerPrice * this.marginMultiplier)
      : 0;

    const refundable = cheapestRoom?.cancellationPolicies?.refundableTag === 'FREECANCELLATION';
    const cancellationPolicy = refundable ? 'Free cancellation' : 'Non-refundable';

    // Hotel metadata — prefer fetched details, fall back to inline data
    const h = details ?? (item.hotelData ?? item);
    const images: ProviderImage[] = [];
    const mainPhoto = details?.main_photo ?? (h as any).mainPhoto;
    if (mainPhoto) images.push({ url: mainPhoto, source: 'provider' });
    (details?.photos ?? (h as any).photos ?? []).slice(0, 2).forEach((p: any) => {
      const url = typeof p === 'string' ? p : (p.url ?? p.urlHd);
      if (url) images.push({ url, source: 'provider' });
    });

    const lat = details?.location?.latitude ?? (h as any).latitude;
    const lng = details?.location?.longitude ?? (h as any).longitude;
    const geo = lat && lng
      ? { lat, lng, googleMapsUrl: `https://maps.google.com/?q=${lat},${lng}` }
      : undefined;

    const name = details?.name ?? (h as any).name ?? `Hotel ${item.hotelId}`;
    const address = details?.address ?? (h as any).address ?? '';
    const city = details?.city ?? (h as any).city ?? '';
    const country = details?.country ?? (h as any).country ?? '';
    const location = [address, city, country].filter(Boolean).join(', ');
    const rating = details?.rating ?? details?.starRating ?? (h as any).reviewScore ?? (h as any).starRating ?? 0;
    const reviewCount = details?.reviewCount ?? (h as any).reviewCount ?? 0;
    const amenities = details?.hotelFacilities?.slice(0, 5) ?? (h as any).amenities ?? [];

    // Build a working booking URL using the Liteapi booking flow
    const bookingUrl = `https://app.liteapi.travel/hotels/${item.hotelId}`;

    return {
      provider: 'liteapi',
      hotelId: item.hotelId,
      name,
      pricePerNight,
      providerPrice,
      currency: roomCurrency,
      rating,
      reviewCount,
      location,
      distanceKm: 0,
      amenities,
      cancellationPolicy,
      bookingUrl,
      images,
      geo,
    };
  }

  /**
   * Fetch hotel details for multiple hotel IDs in parallel.
   * Returns a map of hotelId → details. Missing entries mean the fetch failed.
   */
  private async fetchHotelDetailsBatch(
    hotelIds: string[],
    ctx: CorrelationContext
  ): Promise<Record<string, LiteapiHotelDetails>> {
    const results = await Promise.allSettled(
      hotelIds.map(id => this.fetchHotelDetails(id, ctx))
    );

    const map: Record<string, LiteapiHotelDetails> = {};
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        map[hotelIds[i]] = result.value;
      }
    });
    return map;
  }

  private async fetchHotelDetails(
    hotelId: string,
    ctx: CorrelationContext
  ): Promise<LiteapiHotelDetails | null> {
    try {
      const url = `${LITEAPI_BASE}/data/hotel?hotelId=${encodeURIComponent(hotelId)}`;
      const res = await fetch(url, {
        headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = await res.json() as { data?: LiteapiHotelDetails };
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  private defaultCheckout(checkin: string): string {
    const d = new Date(checkin);
    if (isNaN(d.getTime())) {
      // fallback: tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  /**
   * Normalise a date string to YYYY-MM-DD.
   * Handles ordinals ("30th April"), relative terms ("tomorrow", "this weekend").
   */
  private normaliseDate(input: string): string {
    if (!input) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

    // Check relative terms FIRST before any Date parsing
    const lower = input.toLowerCase().trim();
    const today = new Date();
    if (lower === 'today') return today.toISOString().split('T')[0];
    if (lower === 'tomorrow') { today.setDate(today.getDate() + 1); return today.toISOString().split('T')[0]; }
    if (lower.includes('day after tomorrow') || lower.includes('day after')) {
      today.setDate(today.getDate() + 2); return today.toISOString().split('T')[0];
    }
    if (lower.includes('weekend')) {
      const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
      today.setDate(today.getDate() + daysUntilSat);
      return today.toISOString().split('T')[0];
    }
    if (lower.includes('next week')) { today.setDate(today.getDate() + 7); return today.toISOString().split('T')[0]; }

    // Strip ordinal suffixes: "30th" → "30", "1st" → "1"
    const stripped = input.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
    const withYear = /\d{4}/.test(stripped) ? stripped : `${stripped} ${new Date().getFullYear()}`;
    const parsed = new Date(withYear);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

    return '';
  }

  private async post<T>(path: string, body: unknown, ctx: CorrelationContext): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryPolicy.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(`${LITEAPI_BASE}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Liteapi HTTP ${res.status}: ${errText.substring(0, 200)}`);
        }
        return await res.json() as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('LiteapiAdapter', `Attempt ${attempt} failed`, {
          correlationId: ctx.correlationId,
          error: lastError.message,
        });
        if (attempt <= this.retryPolicy.maxRetries) {
          await this.sleep(this.calculateBackoffDelay(attempt - 1));
        }
      }
    }
    throw lastError ?? new Error('LiteapiAdapter: request failed');
  }
}
