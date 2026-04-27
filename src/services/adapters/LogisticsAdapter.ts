/**
 * LogisticsAdapter
 *
 * Handles transport options for Sri Lanka:
 *   - Uber  — deeplink to open Uber app pre-filled with origin/destination
 *   - PickMe — Sri Lanka's dominant ride-hailing app, deeplink
 *   - Google Maps Directions — free, returns route + duration estimate
 *
 * No API keys required for Uber/PickMe deeplinks.
 * Google Maps Directions API uses the same GOOGLE_PLACES_API_KEY.
 *
 * Uber deeplink docs: https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction
 * PickMe deeplink: https://pickme.lk (standard app deeplink pattern)
 */

import { BaseProviderAdapter } from './ProviderAdapter.js';
import { CorrelationContext } from '../../types/core.js';
import { logger } from '../../config/logger.js';
import type {
  NormalisedTransportOption,
  TransportSearchParams,
  TransportSearchResult,
} from './types.js';

const DIRECTIONS_BASE = 'https://maps.googleapis.com/maps/api/directions/json';

interface DirectionsResponse {
  routes: Array<{
    legs: Array<{
      duration: { value: number; text: string };
      distance: { value: number; text: string };
    }>;
  }>;
  status: string;
}

export class LogisticsAdapter extends BaseProviderAdapter {
  private readonly googleApiKey: string | undefined;
  private readonly uberClientId: string | undefined;

  constructor(googleApiKey?: string, uberClientId?: string) {
    super({ maxRetries: 2, initialDelayMs: 500 });
    this.googleApiKey = googleApiKey;
    this.uberClientId = uberClientId;
  }

  getProviderName(): string {
    return 'logistics';
  }

  async execute(params: Record<string, unknown>, ctx: CorrelationContext): Promise<TransportSearchResult> {
    return this.searchTransport(params as unknown as TransportSearchParams, ctx);
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  async searchTransport(params: TransportSearchParams, ctx: CorrelationContext): Promise<TransportSearchResult> {
    logger.debug('LogisticsAdapter', 'Building transport options', {
      correlationId: ctx.correlationId,
      origin: params.origin,
      destination: params.destination,
    });

    const options: NormalisedTransportOption[] = [];

    // ── Google Maps route estimate (free) ──────────────────────────────────
    const routeInfo = await this.getRouteInfo(params.origin, params.destination, ctx);

    // ── Uber deeplink ──────────────────────────────────────────────────────
    options.push(this.buildUberOption(params, routeInfo));

    // ── PickMe deeplink ────────────────────────────────────────────────────
    options.push(this.buildPickMeOption(params, routeInfo));

    // ── Google Maps walking/transit directions ─────────────────────────────
    options.push(this.buildGoogleMapsOption(params, routeInfo));

    // Filter by requested modes if specified
    const filtered = params.modes?.length
      ? options.filter((o) => params.modes!.includes(o.mode))
      : options;

    return { options: filtered, provider: 'logistics' };
  }

  // ==========================================================================
  // Uber
  // ==========================================================================

  private buildUberOption(
    params: TransportSearchParams,
    route: RouteInfo | null
  ): NormalisedTransportOption {
    // Uber universal deeplink — works on iOS, Android, and web
    const uberUrl = new URL('https://m.uber.com/ul/');
    uberUrl.searchParams.set('action', 'setPickup');
    uberUrl.searchParams.set('pickup[formatted_address]', params.origin);
    uberUrl.searchParams.set('dropoff[formatted_address]', params.destination);
    if (this.uberClientId) uberUrl.searchParams.set('client_id', this.uberClientId);

    return {
      provider: 'uber',
      mode: 'rideshare',
      label: '🚗 Uber',
      description: 'Book a ride with Uber',
      deepLink: uberUrl.toString(),
      estimatedMinutes: route?.durationMinutes,
      estimatedFare: route ? this.estimateUberFare(route.distanceKm) : undefined,
      directionsUrl: route?.googleMapsUrl,
      images: [],
    };
  }

  private estimateUberFare(distanceKm: number): string {
    // Rough Sri Lanka Uber estimate: base LKR 150 + LKR 60/km
    const low = Math.round(150 + distanceKm * 60);
    const high = Math.round(low * 1.3);
    return `LKR ${low.toLocaleString()}–${high.toLocaleString()}`;
  }

  // ==========================================================================
  // PickMe
  // ==========================================================================

  private buildPickMeOption(
    params: TransportSearchParams,
    route: RouteInfo | null
  ): NormalisedTransportOption {
    // PickMe universal deeplink
    const pickmeUrl = new URL('https://pickme.lk/ride');
    pickmeUrl.searchParams.set('pickup', params.origin);
    pickmeUrl.searchParams.set('dropoff', params.destination);

    return {
      provider: 'pickme',
      mode: 'rideshare',
      label: '🛺 PickMe',
      description: 'Sri Lanka\'s #1 ride-hailing app',
      deepLink: pickmeUrl.toString(),
      estimatedMinutes: route?.durationMinutes,
      estimatedFare: route ? this.estimatePickMeFare(route.distanceKm) : undefined,
      directionsUrl: route?.googleMapsUrl,
      images: [],
    };
  }

  private estimatePickMeFare(distanceKm: number): string {
    // PickMe Sri Lanka estimate: base LKR 100 + LKR 50/km (slightly cheaper than Uber)
    const low = Math.round(100 + distanceKm * 50);
    const high = Math.round(low * 1.25);
    return `LKR ${low.toLocaleString()}–${high.toLocaleString()}`;
  }

  // ==========================================================================
  // Google Maps
  // ==========================================================================

  private buildGoogleMapsOption(
    params: TransportSearchParams,
    route: RouteInfo | null
  ): NormalisedTransportOption {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(params.origin)}&destination=${encodeURIComponent(params.destination)}&travelmode=driving`;

    return {
      provider: 'google_maps',
      mode: 'taxi',
      label: '🗺️ Google Maps',
      description: route
        ? `~${route.durationText} · ${route.distanceText}`
        : 'View directions on Google Maps',
      deepLink: mapsUrl,
      estimatedMinutes: route?.durationMinutes,
      directionsUrl: mapsUrl,
      images: [],
    };
  }

  // ==========================================================================
  // Google Directions API
  // ==========================================================================

  private async getRouteInfo(
    origin: string,
    destination: string,
    ctx: CorrelationContext
  ): Promise<RouteInfo | null> {
    if (!this.googleApiKey) return null;

    try {
      const url = new URL(DIRECTIONS_BASE);
      url.searchParams.set('origin', origin);
      url.searchParams.set('destination', destination);
      url.searchParams.set('key', this.googleApiKey);

      const res = await fetch(url.toString());
      if (!res.ok) return null;

      const data = await res.json() as DirectionsResponse;
      if (data.status !== 'OK' || !data.routes[0]?.legs[0]) return null;

      const leg = data.routes[0].legs[0];
      const distanceKm = leg.distance.value / 1000;
      const durationMinutes = Math.round(leg.duration.value / 60);

      return {
        distanceKm,
        distanceText: leg.distance.text,
        durationMinutes,
        durationText: leg.duration.text,
        googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`,
      };
    } catch (err) {
      logger.warn('LogisticsAdapter', 'Could not fetch route info', {
        correlationId: ctx.correlationId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

interface RouteInfo {
  distanceKm: number;
  distanceText: string;
  durationMinutes: number;
  durationText: string;
  googleMapsUrl: string;
}
