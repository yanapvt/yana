/**
 * HotelSearchAdapter - Provider adapter for hotel search operations
 * 
 * Executes hotel search against configured provider via NangoAdapter,
 * normalizes raw provider response into internal HotelResult schema,
 * and returns structured failure state on provider exhaustion.
 * 
 * Requirements: 7.3, 7.4
 */

import { NangoAdapter, type NangoConfig, type ProviderRequest, type ProviderResponse } from './NangoAdapter.js';
import { CorrelationContext, ErrorCategory } from '../../types/core.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Internal hotel result schema
 * 
 * Normalized representation of hotel search results independent of provider.
 * 
 * Requirement 7.4: Normalize hotel search results into internal schema
 */
export interface HotelResult {
  /** Hotel name */
  name: string;
  /** Price per night */
  price: number;
  /** Currency code (ISO 4217) */
  currency: string;
  /** Hotel rating (0-5) */
  rating: number;
  /** Number of reviews */
  reviewCount: number;
  /** Hotel location/address */
  location: string;
  /** Distance from search location (in km) */
  distance: number;
  /** List of amenities */
  amenities: string[];
  /** Cancellation policy description */
  cancellationPolicy: string;
  /** Booking token for reservation */
  bookingToken: string;
}

/**
 * Hotel search parameters
 */
export interface HotelSearchParams {
  location: string;
  checkin_date: string;
  checkout_date?: string;
  guests?: number;
  budget?: number;
  currency?: string;
}

/**
 * Hotel search response
 */
export interface HotelSearchResponse {
  results: HotelResult[];
  totalResults: number;
  searchId?: string;
}

// ============================================================================
// HotelSearchAdapter
// ============================================================================

/**
 * Hotel search adapter implementation
 * 
 * Handles hotel search operations through Nango-based provider integration.
 * Normalizes provider-specific responses into internal HotelResult schema.
 * 
 * Requirements:
 * - 7.3: Execute hotel search when all required fields are present
 * - 7.4: Normalize hotel search results into internal schema
 */
export class HotelSearchAdapter extends NangoAdapter {
  constructor(config: NangoConfig) {
    super(config, {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      retryableErrorCodes: ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'],
    });
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return this.config.integrationId || 'hotel_search_provider';
  }

  /**
   * Execute hotel search
   * 
   * Requirement 7.3: Execute hotel search against configured provider
   * 
   * @param params - Hotel search parameters
   * @param context - Correlation context for logging
   * @returns Normalized hotel search results
   */
  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<HotelSearchResponse> {
    // Validate required parameters
    this.validateSearchParams(params);

    // Build provider-specific request
    const providerRequest = this.buildProviderRequest(params);

    // Execute request with retry logic
    const response = await this.executeProviderRequest<unknown>(
      providerRequest,
      context
    );

    // Handle failure
    if (!response.success) {
      throw new Error(
        response.error?.message || 'Hotel search failed after exhausting retry policy'
      );
    }

    // Normalize and return results
    return this.normalizeResponse(response.data) as HotelSearchResponse;
  }

  /**
   * Build provider-specific request
   * 
   * Converts normalized parameters into provider's expected format.
   * 
   * Requirement 6.2: Handle provider-specific request normalization
   * 
   * @param params - Normalized search parameters
   * @returns Provider-specific request configuration
   */
  buildProviderRequest(params: Record<string, unknown>): ProviderRequest {
    const searchParams = params as HotelSearchParams;

    // Build query parameters for provider API
    const queryParams: Record<string, string> = {
      location: searchParams.location,
      checkin: searchParams.checkin_date,
    };

    if (searchParams.checkout_date) {
      queryParams.checkout = searchParams.checkout_date;
    }

    if (searchParams.guests) {
      queryParams.guests = searchParams.guests.toString();
    }

    if (searchParams.budget) {
      queryParams.max_price = searchParams.budget.toString();
    }

    if (searchParams.currency) {
      queryParams.currency = searchParams.currency;
    }

    return {
      method: 'GET',
      endpoint: `${this.config.nangoUrl}/hotels/search`,
      queryParams,
      headers: {
        'Accept': 'application/json',
      },
    };
  }

  /**
   * Normalize provider response to internal format
   * 
   * Converts raw provider response into internal HotelResult schema.
   * 
   * Requirement 7.4: Normalize hotel search results into internal schema
   * 
   * @param rawResponse - Raw response from provider
   * @returns Normalized hotel search response
   */
  normalizeResponse(rawResponse: unknown): HotelSearchResponse {
    if (!rawResponse || typeof rawResponse !== 'object') {
      return {
        results: [],
        totalResults: 0,
      };
    }

    const response = rawResponse as any;

    // Handle different provider response formats
    const hotels = response.hotels || response.results || response.data || [];
    
    const normalizedResults: HotelResult[] = hotels.map((hotel: any) => 
      this.normalizeHotelResult(hotel)
    );

    return {
      results: normalizedResults,
      totalResults: response.total || response.totalResults || normalizedResults.length,
      searchId: response.searchId || response.search_id,
    };
  }

  /**
   * Normalize a single hotel result
   * 
   * @param hotel - Raw hotel data from provider
   * @returns Normalized hotel result
   */
  private normalizeHotelResult(hotel: any): HotelResult {
    return {
      name: hotel.name || hotel.hotelName || hotel.hotel_name || 'Unknown Hotel',
      price: this.normalizePrice(hotel.price || hotel.pricePerNight || hotel.rate || 0),
      currency: hotel.currency || hotel.currencyCode || 'USD',
      rating: this.normalizeRating(hotel.rating || hotel.starRating || hotel.stars || 0),
      reviewCount: hotel.reviewCount || hotel.reviews || hotel.review_count || 0,
      location: hotel.location || hotel.address || hotel.city || '',
      distance: this.normalizeDistance(hotel.distance || hotel.distanceFromCenter || 0),
      amenities: this.normalizeAmenities(hotel.amenities || hotel.facilities || []),
      cancellationPolicy: hotel.cancellationPolicy || hotel.cancellation || hotel.cancellation_policy || 'Contact hotel for details',
      bookingToken: hotel.bookingToken || hotel.token || hotel.id || hotel.hotelId || '',
    };
  }

  /**
   * Normalize price to number
   */
  private normalizePrice(price: any): number {
    if (typeof price === 'number') {
      return price;
    }
    if (typeof price === 'string') {
      const parsed = parseFloat(price.replace(/[^0-9.]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof price === 'object' && price.amount) {
      return this.normalizePrice(price.amount);
    }
    return 0;
  }

  /**
   * Normalize rating to 0-5 scale
   */
  private normalizeRating(rating: any): number {
    const num = typeof rating === 'number' ? rating : parseFloat(rating);
    if (isNaN(num)) return 0;
    
    // Clamp to 0-5 range
    return Math.max(0, Math.min(5, num));
  }

  /**
   * Normalize distance to kilometers
   */
  private normalizeDistance(distance: any): number {
    if (typeof distance === 'number') {
      return distance;
    }
    if (typeof distance === 'string') {
      const parsed = parseFloat(distance.replace(/[^0-9.]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  /**
   * Normalize amenities to string array
   */
  private normalizeAmenities(amenities: any): string[] {
    if (Array.isArray(amenities)) {
      return amenities.map(a => {
        if (typeof a === 'string') return a;
        if (typeof a === 'object' && a.name) return a.name;
        return String(a);
      });
    }
    return [];
  }

  /**
   * Validate search parameters
   * 
   * @param params - Parameters to validate
   * @throws Error if required parameters are missing
   */
  private validateSearchParams(params: Record<string, unknown>): void {
    if (!params.location || typeof params.location !== 'string') {
      throw new Error('Missing required parameter: location');
    }

    if (!params.checkin_date || typeof params.checkin_date !== 'string') {
      throw new Error('Missing required parameter: checkin_date');
    }

    // Validate date format (basic ISO date check)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(params.checkin_date as string)) {
      throw new Error('Invalid checkin_date format. Expected YYYY-MM-DD');
    }

    if (params.checkout_date && !dateRegex.test(params.checkout_date as string)) {
      throw new Error('Invalid checkout_date format. Expected YYYY-MM-DD');
    }
  }
}
