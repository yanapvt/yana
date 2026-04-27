/**
 * GooglePlacesAdapter
 *
 * Free-tier Google Places API adapter used as the primary fallback across
 * all verticals (hotels, restaurants, excursions, logistics).
 *
 * Free quota (as of 2024):
 *   - Text Search / Nearby Search: $0 up to $200/month credit (~6,700 calls)
 *   - Place Details: included in credit
 *   - Place Photos: included in credit
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service
 */

import { BaseProviderAdapter } from './ProviderAdapter.js';
import { CorrelationContext } from '../../types/core.js';
import { logger } from '../../config/logger.js';
import type {
  NormalisedHotel,
  NormalisedRestaurant,
  NormalisedExcursion,
  ProviderImage,
  GeoLocation,
  HotelSearchParams,
  RestaurantSearchParams,
  ExcursionSearchParams,
} from './types.js';

// ============================================================================
// Raw Google Places types (minimal — only fields we use)
// ============================================================================

interface GooglePlace {
  place_id: string;
  name: string;
  formatted_address?: string;
  vicinity?: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;   // 0–4
  geometry?: { location: { lat: number; lng: number } };
  photos?: Array<{ photo_reference: string; width: number; height: number }>;
  opening_hours?: { open_now?: boolean; weekday_text?: string[] };
  formatted_phone_number?: string;
  website?: string;
  types?: string[];
}

interface GooglePlacesResponse {
  results: GooglePlace[];
  status: string;
  next_page_token?: string;
}

interface GooglePlaceDetailsResponse {
  result: GooglePlace;
  status: string;
}

// ============================================================================
// GooglePlacesAdapter
// ============================================================================

export class GooglePlacesAdapter extends BaseProviderAdapter {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api/place';
  private readonly photoBaseUrl = 'https://maps.googleapis.com/maps/api/place/photo';

  constructor(apiKey: string) {
    super({ maxRetries: 2, initialDelayMs: 500 });
    this.apiKey = apiKey;
  }

  getProviderName(): string {
    return 'google_places';
  }

  // ==========================================================================
  // Hotels
  // ==========================================================================

  async searchHotels(params: HotelSearchParams, ctx: CorrelationContext): Promise<NormalisedHotel[]> {
    const query = `hotels in ${params.location}${params.propertyType ? ` ${params.propertyType}` : ''}`;
    const places = await this.textSearch(query, 'lodging', ctx);

    return places.map((p) => this.placeToHotel(p, params.currency ?? 'USD'));
  }

  private placeToHotel(place: GooglePlace, currency: string): NormalisedHotel {
    const geo = this.extractGeo(place);
    return {
      provider: 'google_places',
      hotelId: place.place_id,
      name: place.name,
      pricePerNight: 0,       // Google Places doesn't return prices
      providerPrice: 0,
      currency,
      rating: place.rating ?? 0,
      reviewCount: place.user_ratings_total ?? 0,
      location: place.formatted_address ?? place.vicinity ?? '',
      distanceKm: 0,
      amenities: [],
      cancellationPolicy: 'Contact property for details',
      bookingUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
      images: this.extractPhotos(place),
      geo,
      bookingComUrl: undefined,
      tripAdvisorUrl: undefined,
    };
  }

  // ==========================================================================
  // Restaurants
  // ==========================================================================

  async searchRestaurants(params: RestaurantSearchParams, ctx: CorrelationContext): Promise<NormalisedRestaurant[]> {
    const cuisineQuery = params.cuisine ? `${params.cuisine} ` : '';
    const query = `${cuisineQuery}restaurants in ${params.location}`;
    const places = await this.textSearch(query, 'restaurant', ctx);

    return places
      .filter((p) => !params.openNow || p.opening_hours?.open_now)
      .slice(0, params.maxResults ?? 10)
      .map((p) => this.placeToRestaurant(p, params));
  }

  private placeToRestaurant(place: GooglePlace, params: RestaurantSearchParams): NormalisedRestaurant {
    const geo = this.extractGeo(place);
    const priceLevel = place.price_level ?? 1;
    const priceRange = (['$', '$$', '$$$', '$$$$'][Math.min(priceLevel, 3)] ?? '$$') as '$' | '$$' | '$$$' | '$$$$';

    return {
      provider: 'google_places',
      restaurantId: place.place_id,
      name: place.name,
      cuisine: params.cuisine ? [params.cuisine] : [],
      priceRange,
      rating: place.rating ?? 0,
      reviewCount: place.user_ratings_total ?? 0,
      location: place.formatted_address ?? place.vicinity ?? '',
      openingHours: place.opening_hours?.weekday_text?.join(', '),
      phoneNumber: place.formatted_phone_number,
      bookingUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
      menuUrl: place.website,
      images: this.extractPhotos(place),
      geo,
      tags: params.tags ?? [],
      isPartner: false,
    };
  }

  // ==========================================================================
  // Excursions
  // ==========================================================================

  async searchExcursions(params: ExcursionSearchParams, ctx: CorrelationContext): Promise<NormalisedExcursion[]> {
    const categoryQuery = params.category ? `${params.category} ` : 'tours activities ';
    const query = `${categoryQuery}in ${params.location}`;
    const places = await this.textSearch(query, 'tourist_attraction', ctx);

    return places.map((p) => this.placeToExcursion(p, params));
  }

  private placeToExcursion(place: GooglePlace, params: ExcursionSearchParams): NormalisedExcursion {
    const geo = this.extractGeo(place);
    return {
      provider: 'google_places',
      excursionId: place.place_id,
      title: place.name,
      description: place.formatted_address ?? place.vicinity ?? '',
      priceFrom: 0,   // Google Places doesn't return prices
      currency: params.currency ?? 'USD',
      rating: place.rating ?? 0,
      reviewCount: place.user_ratings_total ?? 0,
      location: place.formatted_address ?? place.vicinity ?? '',
      category: params.category ?? 'attraction',
      bookingUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
      images: this.extractPhotos(place),
      geo,
      highlights: [],
    };
  }

  // ==========================================================================
  // Core API methods
  // ==========================================================================

  private async textSearch(
    query: string,
    type: string,
    ctx: CorrelationContext
  ): Promise<GooglePlace[]> {
    const url = new URL(`${this.baseUrl}/textsearch/json`);
    url.searchParams.set('query', query);
    url.searchParams.set('type', type);
    url.searchParams.set('key', this.apiKey);

    logger.debug('GooglePlacesAdapter', 'Text search', {
      correlationId: ctx.correlationId,
      query,
      type,
    });

    const response = await this.fetchWithRetry(url.toString(), ctx);
    const data = response as GooglePlacesResponse;

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      logger.warn('GooglePlacesAdapter', 'Unexpected status', {
        correlationId: ctx.correlationId,
        status: data.status,
      });
    }

    return data.results ?? [];
  }

  async getPlaceDetails(placeId: string, ctx: CorrelationContext): Promise<GooglePlace | null> {
    const url = new URL(`${this.baseUrl}/details/json`);
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'name,formatted_address,rating,user_ratings_total,photos,opening_hours,formatted_phone_number,website,geometry,price_level');
    url.searchParams.set('key', this.apiKey);

    const response = await this.fetchWithRetry(url.toString(), ctx) as GooglePlaceDetailsResponse;
    return response.result ?? null;
  }

  /**
   * Build a photo URL from a photo_reference.
   * Max width 800px stays within free tier.
   */
  buildPhotoUrl(photoReference: string, maxWidth = 800): string {
    return `${this.photoBaseUrl}?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${this.apiKey}`;
  }

  // ==========================================================================
  // ProviderAdapter interface
  // ==========================================================================

  async execute(params: Record<string, unknown>, ctx: CorrelationContext): Promise<unknown> {
    const vertical = params.vertical as string;
    if (vertical === 'hotels') return this.searchHotels(params as unknown as HotelSearchParams, ctx);
    if (vertical === 'restaurants') return this.searchRestaurants(params as unknown as RestaurantSearchParams, ctx);
    if (vertical === 'excursions') return this.searchExcursions(params as unknown as ExcursionSearchParams, ctx);
    throw new Error(`GooglePlacesAdapter: unknown vertical "${vertical}"`);
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse; // already normalised per-vertical above
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private extractGeo(place: GooglePlace): GeoLocation | undefined {
    if (!place.geometry?.location) return undefined;
    const { lat, lng } = place.geometry.location;
    return {
      lat,
      lng,
      googleMapsUrl: `https://maps.google.com/?q=${lat},${lng}`,
    };
  }

  private extractPhotos(place: GooglePlace): ProviderImage[] {
    if (!place.photos?.length) return [];
    // Return first 3 photos to keep payload lean
    return place.photos.slice(0, 3).map((p) => ({
      url: this.buildPhotoUrl(p.photo_reference),
      source: 'google_places',
    }));
  }

  private async fetchWithRetry(url: string, ctx: CorrelationContext): Promise<unknown> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryPolicy.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt <= this.retryPolicy.maxRetries) {
          await this.sleep(this.calculateBackoffDelay(attempt - 1));
        }
      }
    }
    throw lastError ?? new Error('GooglePlacesAdapter: fetch failed');
  }
}
