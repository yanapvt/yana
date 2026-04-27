/**
 * ProviderRouter
 *
 * Single entry point for all external provider calls.
 * Selects the best available provider per vertical and falls back gracefully.
 *
 * Fallback chains:
 *
 *   Hotels:      Liteapi → Booking.com Affiliate → Google Places
 *   Logistics:   Uber deeplink + PickMe deeplink + Google Maps (all returned together)
 *   Excursions:  Viator → Google Places (tourist_attraction)
 *   Restaurants: Partner DB + Genie Merchant → Google Places
 *
 * Provider selection is driven by which API keys are configured in .env.
 * If a paid provider key is missing, the router silently skips it and uses
 * the next available option — the system always returns something.
 */

import { env } from '../../config/environment.js';
import { logger } from '../../config/logger.js';
import { CorrelationContext } from '../../types/core.js';

import { GooglePlacesAdapter } from './GooglePlacesAdapter.js';
import { LiteapiAdapter } from './LiteapiAdapter.js';
import { BookingAffiliateAdapter } from './BookingAffiliateAdapter.js';
import { LogisticsAdapter } from './LogisticsAdapter.js';
import { ViatorAdapter } from './ViatorAdapter.js';
import { RestaurantAdapter } from './RestaurantAdapter.js';

import type {
  HotelSearchParams,
  HotelSearchResult,
  TransportSearchParams,
  TransportSearchResult,
  ExcursionSearchParams,
  ExcursionSearchResult,
  RestaurantSearchParams,
  RestaurantSearchResult,
} from './types.js';

// ============================================================================
// ProviderRouter
// ============================================================================

export class ProviderRouter {
  private googlePlaces: GooglePlacesAdapter | null;
  private liteapi: LiteapiAdapter | null;
  private booking: BookingAffiliateAdapter | null;
  private logistics: LogisticsAdapter;
  private viator: ViatorAdapter | null;
  private restaurants: RestaurantAdapter;

  constructor() {
    const p = env.providers;

    this.googlePlaces = p.googlePlacesApiKey
      ? new GooglePlacesAdapter(p.googlePlacesApiKey)
      : null;

    this.liteapi = p.literapiKey
      ? new LiteapiAdapter(p.literapiKey)
      : null;

    this.booking = p.bookingAffiliateToken
      ? new BookingAffiliateAdapter(p.bookingAffiliateToken)
      : null;

    this.logistics = new LogisticsAdapter(
      p.googlePlacesApiKey,   // reuses same key for Directions API
      p.uberClientId
    );

    this.viator = p.viatorApiKey
      ? new ViatorAdapter(p.viatorApiKey)
      : null;

    this.restaurants = new RestaurantAdapter(
      p.genieMerchantApiKey,
      p.genieMerchantBaseUrl
    );

    logger.info('ProviderRouter', 'Initialised', {
      googlePlaces: !!this.googlePlaces,
      liteapi: !!this.liteapi,
      booking: !!this.booking,
      viator: !!this.viator,
      genie: !!p.genieMerchantApiKey,
    });
  }

  // ==========================================================================
  // Hotels
  // ==========================================================================

  async searchHotels(params: HotelSearchParams, ctx: CorrelationContext): Promise<HotelSearchResult> {
    // Try Liteapi first (real-time pricing + margin)
    if (this.liteapi) {
      try {
        const result = await this.liteapi.searchHotels(params, ctx);
        if (result.hotels.length > 0) {
          logger.info('ProviderRouter', 'Hotels from Liteapi', {
            correlationId: ctx.correlationId,
            count: result.hotels.length,
          });
          return result;
        }
      } catch (err) {
        logger.warn('ProviderRouter', 'Liteapi failed, trying Booking.com', {
          correlationId: ctx.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Try Booking.com affiliate
    if (this.booking) {
      try {
        const result = await this.booking.searchHotels(params, ctx);
        if (result.hotels.length > 0) {
          logger.info('ProviderRouter', 'Hotels from Booking.com', {
            correlationId: ctx.correlationId,
            count: result.hotels.length,
          });
          return result;
        }
      } catch (err) {
        logger.warn('ProviderRouter', 'Booking.com failed, falling back to Google Places', {
          correlationId: ctx.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Final fallback: Google Places (no pricing, but always available)
    if (this.googlePlaces) {
      const hotels = await this.googlePlaces.searchHotels(params, ctx);
      logger.info('ProviderRouter', 'Hotels from Google Places (fallback)', {
        correlationId: ctx.correlationId,
        count: hotels.length,
      });
      return { hotels, totalResults: hotels.length, provider: 'google_places' };
    }

    logger.warn('ProviderRouter', 'No hotel provider available', { correlationId: ctx.correlationId });
    return { hotels: [], totalResults: 0, provider: 'none' };
  }

  // ==========================================================================
  // Logistics
  // ==========================================================================

  async searchTransport(params: TransportSearchParams, ctx: CorrelationContext): Promise<TransportSearchResult> {
    // Logistics adapter always returns results (deeplinks + Google Maps)
    return this.logistics.searchTransport(params, ctx);
  }

  // ==========================================================================
  // Excursions
  // ==========================================================================

  async searchExcursions(params: ExcursionSearchParams, ctx: CorrelationContext): Promise<ExcursionSearchResult> {
    // Try Viator first (bookable, with pricing)
    if (this.viator) {
      try {
        const result = await this.viator.searchExcursions(params, ctx);
        if (result.excursions.length > 0) {
          logger.info('ProviderRouter', 'Excursions from Viator', {
            correlationId: ctx.correlationId,
            count: result.excursions.length,
          });
          return result;
        }
      } catch (err) {
        logger.warn('ProviderRouter', 'Viator failed, falling back to Google Places', {
          correlationId: ctx.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: Google Places tourist attractions
    if (this.googlePlaces) {
      const excursions = await this.googlePlaces.searchExcursions(params, ctx);
      logger.info('ProviderRouter', 'Excursions from Google Places (fallback)', {
        correlationId: ctx.correlationId,
        count: excursions.length,
      });
      return { excursions, totalResults: excursions.length, provider: 'google_places' };
    }

    return { excursions: [], totalResults: 0, provider: 'none' };
  }

  // ==========================================================================
  // Restaurants
  // ==========================================================================

  async searchRestaurants(params: RestaurantSearchParams, ctx: CorrelationContext): Promise<RestaurantSearchResult> {
    // Try partner DB + Genie first
    try {
      const result = await this.restaurants.searchRestaurants(params, ctx);
      if (result.restaurants.length > 0) {
        logger.info('ProviderRouter', 'Restaurants from partner/Genie', {
          correlationId: ctx.correlationId,
          count: result.restaurants.length,
        });
        return result;
      }
    } catch (err) {
      logger.warn('ProviderRouter', 'Restaurant adapter failed, falling back to Google Places', {
        correlationId: ctx.correlationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Fallback: Google Places
    if (this.googlePlaces) {
      const restaurants = await this.googlePlaces.searchRestaurants(params, ctx);
      logger.info('ProviderRouter', 'Restaurants from Google Places (fallback)', {
        correlationId: ctx.correlationId,
        count: restaurants.length,
      });
      return { restaurants, totalResults: restaurants.length, provider: 'google_places' };
    }

    return { restaurants: [], totalResults: 0, provider: 'none' };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let routerInstance: ProviderRouter | null = null;

export function getProviderRouter(): ProviderRouter {
  if (!routerInstance) {
    routerInstance = new ProviderRouter();
  }
  return routerInstance;
}
