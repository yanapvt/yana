/**
 * BookingAffiliateAdapter
 *
 * Booking.com Affiliate Partner API v2.
 * Returns live hotel inventory with real photos and prices.
 * We apply our margin and surface the Booking.com URL for WhatsApp link previews
 * (Booking.com pages have OG tags → WhatsApp auto-generates a rich preview).
 *
 * Docs: https://developers.booking.com/affiliate/
 * Requires: Booking.com affiliate account + API token
 */

import { BaseProviderAdapter } from './ProviderAdapter.js';
import { CorrelationContext } from '../../types/core.js';
import { env } from '../../config/environment.js';
import { logger } from '../../config/logger.js';
import type { NormalisedHotel, HotelSearchParams, HotelSearchResult, ProviderImage } from './types.js';

const BOOKING_BASE = 'https://distribution-xml.booking.com/2.9/json';

interface BookingHotel {
  hotel_id: number;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  class?: number;           // star rating
  review_score?: number;
  review_nr?: number;
  latitude?: number;
  longitude?: number;
  main_photo_url?: string;
  photos?: Array<{ url_original: string }>;
  hotel_facilities?: string[];
  url?: string;
  min_total_price?: number;
  currency_code?: string;
  free_cancellation?: boolean;
}

interface BookingSearchResponse {
  result?: BookingHotel[];
  error?: { message: string };
}

export class BookingAffiliateAdapter extends BaseProviderAdapter {
  private readonly token: string;
  private readonly marginMultiplier: number;

  constructor(affiliateToken: string) {
    super({ maxRetries: 3, initialDelayMs: 1000 });
    this.token = affiliateToken;
    this.marginMultiplier = 1 + (env.providers.hotelMarginPercent / 100);
  }

  getProviderName(): string {
    return 'booking';
  }

  async execute(params: Record<string, unknown>, ctx: CorrelationContext): Promise<HotelSearchResult> {
    return this.searchHotels(params as unknown as HotelSearchParams, ctx);
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  async searchHotels(params: HotelSearchParams, ctx: CorrelationContext): Promise<HotelSearchResult> {
    logger.debug('BookingAffiliateAdapter', 'Searching hotels', {
      correlationId: ctx.correlationId,
      location: params.location,
    });

    const url = new URL(`${BOOKING_BASE}/hotels`);
    url.searchParams.set('city_ids', params.location); // caller should resolve to city_id
    url.searchParams.set('checkin', params.checkinDate);
    url.searchParams.set('checkout', params.checkoutDate ?? this.defaultCheckout(params.checkinDate));
    url.searchParams.set('guest_qty', String(params.guests ?? 2));
    url.searchParams.set('rows', '20');
    url.searchParams.set('extras', 'hotel_photos,hotel_facilities,hotel_description');
    if (params.maxBudget) url.searchParams.set('price_max', String(params.maxBudget));

    const response = await this.get<BookingSearchResponse>(url.toString(), ctx);

    if (response.error) throw new Error(`Booking.com error: ${response.error.message}`);

    const hotels = (response.result ?? []).map((h) =>
      this.normaliseHotel(h, params.currency ?? 'USD')
    );

    return { hotels, totalResults: hotels.length, provider: 'booking' };
  }

  private normaliseHotel(h: BookingHotel, currency: string): NormalisedHotel {
    const providerPrice = h.min_total_price ?? 0;
    const pricePerNight = Math.ceil(providerPrice * this.marginMultiplier);

    const images: ProviderImage[] = [];
    if (h.main_photo_url) images.push({ url: h.main_photo_url.replace('square60', 'max1280x900'), source: 'provider' });
    (h.photos ?? []).slice(0, 2).forEach((p) =>
      images.push({ url: p.url_original, source: 'provider' })
    );

    const geo = h.latitude && h.longitude
      ? { lat: h.latitude, lng: h.longitude, googleMapsUrl: `https://maps.google.com/?q=${h.latitude},${h.longitude}` }
      : undefined;

    // Booking.com listing URL — has OG tags, generates rich WhatsApp preview
    const bookingComUrl = h.url ?? `https://www.booking.com/hotel/lk/${h.hotel_id}.html`;

    return {
      provider: 'booking',
      hotelId: String(h.hotel_id),
      name: h.name,
      pricePerNight,
      providerPrice,
      currency: h.currency_code ?? currency,
      rating: h.review_score ? h.review_score / 2 : (h.class ?? 0), // normalise to 0–5
      reviewCount: h.review_nr ?? 0,
      location: [h.address, h.city, h.country].filter(Boolean).join(', '),
      distanceKm: 0,
      amenities: h.hotel_facilities ?? [],
      cancellationPolicy: h.free_cancellation ? 'Free cancellation available' : 'Check property for policy',
      bookingUrl: bookingComUrl,
      images,
      geo,
      bookingComUrl,
    };
  }

  private defaultCheckout(checkin: string): string {
    const d = new Date(checkin);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  private async get<T>(url: string, ctx: CorrelationContext): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryPolicy.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Basic ${Buffer.from(this.token + ':').toString('base64')}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) throw new Error(`Booking HTTP ${res.status}`);
        return await res.json() as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt <= this.retryPolicy.maxRetries) await this.sleep(this.calculateBackoffDelay(attempt - 1));
      }
    }
    throw lastError ?? new Error('BookingAffiliateAdapter: request failed');
  }
}
