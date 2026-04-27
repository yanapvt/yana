/**
 * ToolExecutor
 *
 * Bridges the LLM decision layer and the ProviderRouter.
 * When the LLM returns suggestedAction: "execute_tool", the webhook calls
 * ToolExecutor.run() which:
 *   1. Maps the intent to the correct ProviderRouter method
 *   2. Extracts and validates parameters from the LLM decision + session state
 *   3. Calls the provider and formats the result as a WhatsApp-ready string
 *
 * Returns null if the intent is not handled here (falls back to LLM reply text).
 */

import { CorrelationContext } from '../types/core.js';
import { getProviderRouter } from './adapters/ProviderRouter.js';
import { logger } from '../config/logger.js';
import { UserRepository } from '../db/repositories/UserRepository.js';
import type {
  NormalisedHotel,
  NormalisedTransportOption,
  NormalisedExcursion,
  NormalisedRestaurant,
} from './adapters/types.js';

// ============================================================================
// Intent → vertical mapping
// ============================================================================

const TRANSPORT_INTENTS = new Set([
  'book_transport', 'book_taxi', 'book_tuktuk', 'book_car_hire',
  'book_airport_pickup', 'book_airport_dropoff', 'book_private_driver',
  'get_transport_details', 'explore_trains', 'plan_route',
]);

const HOTEL_INTENTS = new Set([
  'search_hotels', 'book_hotel', 'find_accommodation',
]);

const EXCURSION_INTENTS = new Set([
  'explore_tours', 'explore_activities', 'explore_adventure',
  'explore_water_sports', 'explore_hiking', 'explore_safari',
  'explore_culture', 'book_tickets',
]);

const RESTAURANT_INTENTS = new Set([
  'explore_food', 'explore_restaurants', 'explore_local_food',
  'explore_fine_dining', 'explore_casual_dining', 'explore_budget_food',
  'explore_seafood', 'explore_vegetarian', 'explore_street_food',
]);

// ============================================================================
// ToolExecutor
// ============================================================================

export interface ToolExecutorInput {
  intent: string;
  parameters: Record<string, unknown>;
  /** Collected fields from the session — supplements LLM-extracted params */
  collectedFields: Record<string, unknown>;
  correlationContext: CorrelationContext;
  /** User ID for persisting behavioral memory — optional, best-effort */
  userId?: string;
}

export class ToolExecutor {
  private userRepo = new UserRepository();

  async run(input: ToolExecutorInput): Promise<string | null> {
    const { intent, parameters, collectedFields, correlationContext, userId } = input;

    // Normalize intent: replace spaces with underscores for consistent matching
    const normalizedIntent = intent.toLowerCase().replace(/\s+/g, '_');

    // Merge session fields + LLM params (LLM params take precedence)
    const params = { ...collectedFields, ...parameters };

    try {
      let result: string | null = null;
      let vertical: string | null = null;
      let location: string | null = null;

      if (TRANSPORT_INTENTS.has(normalizedIntent) || normalizedIntent.includes('taxi') || normalizedIntent.includes('transport') || normalizedIntent.includes('ride') || normalizedIntent.includes('driver') || normalizedIntent.includes('pickup') || normalizedIntent.includes('dropoff')) {
        result = await this.handleTransport(params, correlationContext);
        vertical = 'transport';
        location = (params.destination ?? params.to ?? null) as string | null;
      } else if (HOTEL_INTENTS.has(normalizedIntent) || normalizedIntent.includes('hotel') || normalizedIntent.includes('accommodation') || normalizedIntent.includes('stay')) {
        result = await this.handleHotels(params, correlationContext);
        vertical = 'hotels';
        location = (params.location ?? params.city ?? params.destination ?? null) as string | null;
      } else if (EXCURSION_INTENTS.has(normalizedIntent) || normalizedIntent.includes('tour') || normalizedIntent.includes('activit') || normalizedIntent.includes('excursion') || normalizedIntent.includes('safari') || normalizedIntent.includes('hiking')) {
        result = await this.handleExcursions(params, correlationContext);
        vertical = 'excursions';
        location = (params.location ?? params.city ?? null) as string | null;
      } else if (RESTAURANT_INTENTS.has(normalizedIntent) || normalizedIntent.includes('restaurant') || normalizedIntent.includes('food') || normalizedIntent.includes('dining') || normalizedIntent.includes('eat')) {
        result = await this.handleRestaurants(params, correlationContext);
        vertical = 'restaurants';
        location = (params.location ?? params.city ?? params.area ?? null) as string | null;
      }

      // Persist behavioral memory when tool succeeded and we have a user
      if (result && userId && vertical) {
        this.persistBehavioralMemory(userId, vertical, location, normalizedIntent).catch(() => {
          // Non-fatal — don't block the response
        });
      }

      return result;
    } catch (err) {
      logger.warn('ToolExecutor', 'Tool execution failed', {
        correlationId: correlationContext.correlationId,
        intent: normalizedIntent,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    return null;
  }

  /**
   * Persist behavioral memory after a successful tool call.
   * Updates frequent_services, common_destinations, and recent_actions.
   */
  private async persistBehavioralMemory(
    userId: string,
    vertical: string,
    location: string | null,
    action: string
  ): Promise<void> {
    await Promise.allSettled([
      this.userRepo.appendFrequentService(userId, vertical),
      this.userRepo.appendRecentAction(userId, action),
      ...(location ? [this.userRepo.appendDestination(userId, location)] : []),
    ]);
  }

  // ==========================================================================
  // Transport
  // ==========================================================================

  private async handleTransport(
    params: Record<string, unknown>,
    ctx: CorrelationContext
  ): Promise<string | null> {
    const origin = (params.origin ?? params.from ?? params.pickup_location ?? '') as string;
    const destination = (params.destination ?? params.to ?? params.dropoff_location ?? '') as string;

    if (!origin || !destination) {
      // Not enough info — let LLM reply handle it
      return null;
    }

    const router = getProviderRouter();
    const result = await router.searchTransport(
      {
        origin,
        destination,
        passengerCount: params.guests as number | undefined,
      },
      ctx
    );

    if (!result.options.length) return null;

    return this.formatTransportOptions(origin, destination, result.options);
  }

  private formatTransportOptions(
    origin: string,
    destination: string,
    options: NormalisedTransportOption[]
  ): string {
    const lines: string[] = [
      `🚗 *Transport: ${origin} → ${destination}*\n`,
    ];

    for (const opt of options) {
      lines.push(`*${opt.label}*`);
      if (opt.estimatedFare) lines.push(`💰 Est. fare: ${opt.estimatedFare}`);
      if (opt.estimatedMinutes) lines.push(`⏱ Est. time: ~${opt.estimatedMinutes} min`);
      if (opt.description && opt.description !== opt.label) lines.push(`_${opt.description}_`);
      if (opt.deepLink) lines.push(`👉 ${opt.deepLink}`);
      lines.push('');
    }

    lines.push('_Tap a link above to open the app and confirm your ride._');
    return lines.join('\n');
  }

  // ==========================================================================
  // Hotels
  // ==========================================================================

  private async handleHotels(
    params: Record<string, unknown>,
    ctx: CorrelationContext
  ): Promise<string | null> {
    const location = (params.location ?? params.city ?? params.destination ?? '') as string;
    const checkinDate = (params.checkin_date ?? params.checkin ?? params.check_in ?? '') as string;

    if (!location) return null;

    // Default checkin to tomorrow if not provided
    const checkin = checkinDate || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    })();
    const router = getProviderRouter();
    const result = await router.searchHotels(
      {
        location,
        checkinDate: checkin,
        checkoutDate: (params.checkout_date ?? params.checkout) as string | undefined,
        guests: params.guests as number | undefined,
        maxBudget: params.budget as number | undefined,
        currency: (params.currency ?? 'USD') as string,
        propertyType: params.property_type as string | undefined,
      },
      ctx
    );

    if (!result.hotels.length) return null;

    return this.formatHotelResults(location, result.hotels.slice(0, 3));
  }

  private formatHotelResults(location: string, hotels: NormalisedHotel[]): string {
    const lines: string[] = [
      `🏨 *Hotels in ${location}*\n`,
    ];

    hotels.forEach((h, i) => {
      const stars = '⭐'.repeat(Math.round(h.rating));
      const price = h.pricePerNight > 0
        ? `${h.currency} ${h.pricePerNight.toLocaleString()}/night`
        : 'Price on request';

      lines.push(`*${i + 1}. ${h.name}*`);
      lines.push(`${stars} ${h.rating > 0 ? h.rating.toFixed(1) : ''} ${h.reviewCount > 0 ? `(${h.reviewCount.toLocaleString()} reviews)` : ''}`);
      lines.push(`💰 ${price}`);
      if (h.location) lines.push(`📍 ${h.location}`);
      if (h.amenities.length) lines.push(`✅ ${h.amenities.slice(0, 3).join(' · ')}`);
      lines.push(`🔗 ${h.bookingComUrl ?? h.bookingUrl}`);
      lines.push('');
    });

    lines.push('_Reply with a number to get more details, or ask about a specific hotel._');
    return lines.join('\n');
  }

  // ==========================================================================
  // Excursions
  // ==========================================================================

  private async handleExcursions(
    params: Record<string, unknown>,
    ctx: CorrelationContext
  ): Promise<string | null> {
    const location = (params.location ?? params.city ?? params.destination ?? '') as string;
    if (!location) return null;

    const router = getProviderRouter();
    const result = await router.searchExcursions(
      {
        location,
        category: params.category as string | undefined,
        date: params.date as string | undefined,
        maxBudget: params.budget as number | undefined,
        currency: (params.currency ?? 'USD') as string,
      },
      ctx
    );

    if (!result.excursions.length) return null;

    return this.formatExcursionResults(location, result.excursions.slice(0, 3));
  }

  private formatExcursionResults(location: string, excursions: NormalisedExcursion[]): string {
    const lines: string[] = [
      `🎯 *Activities & Tours in ${location}*\n`,
    ];

    excursions.forEach((e, i) => {
      const stars = '⭐'.repeat(Math.round(e.rating));
      const price = e.priceFrom > 0
        ? `From ${e.currency} ${e.priceFrom.toLocaleString()}`
        : 'Price on request';
      const duration = e.durationHours
        ? `⏱ ${e.durationHours < 1 ? `${e.durationHours * 60}min` : `${e.durationHours}h`}`
        : '';

      lines.push(`*${i + 1}. ${e.title}*`);
      lines.push(`${stars} ${e.rating > 0 ? e.rating.toFixed(1) : ''} ${e.reviewCount > 0 ? `(${e.reviewCount.toLocaleString()} reviews)` : ''}`);
      lines.push(`💰 ${price} ${duration}`);
      if (e.highlights.length) lines.push(`✨ ${e.highlights.slice(0, 2).join(' · ')}`);
      lines.push(`🔗 ${e.bookingUrl}`);
      lines.push('');
    });

    lines.push('_Reply with a number for more details or to book._');
    return lines.join('\n');
  }

  // ==========================================================================
  // Restaurants
  // ==========================================================================

  private async handleRestaurants(
    params: Record<string, unknown>,
    ctx: CorrelationContext
  ): Promise<string | null> {
    const location = (params.location ?? params.city ?? params.area ?? '') as string;
    if (!location) return null;

    const router = getProviderRouter();
    const result = await router.searchRestaurants(
      {
        location,
        cuisine: params.cuisine as string | undefined,
        tags: params.tags as string[] | undefined,
        openNow: params.open_now as boolean | undefined,
        maxResults: 5,
      },
      ctx
    );

    if (!result.restaurants.length) return null;

    return this.formatRestaurantResults(location, result.restaurants);
  }

  private formatRestaurantResults(location: string, restaurants: NormalisedRestaurant[]): string {
    const lines: string[] = [
      `🍽️ *Restaurants in ${location}*\n`,
    ];

    restaurants.forEach((r, i) => {
      const stars = '⭐'.repeat(Math.round(r.rating));
      const partnerBadge = r.isPartner ? ' 🤝 _Partner_' : '';

      lines.push(`*${i + 1}. ${r.name}*${partnerBadge}`);
      lines.push(`${stars} ${r.rating > 0 ? r.rating.toFixed(1) : ''} ${r.priceRange}`);
      if (r.cuisine.length) lines.push(`🍴 ${r.cuisine.join(', ')}`);
      if (r.location) lines.push(`📍 ${r.location}`);
      if (r.whatsappNumber) lines.push(`💬 WhatsApp: ${r.whatsappNumber}`);
      else if (r.phoneNumber) lines.push(`📞 ${r.phoneNumber}`);
      if (r.bookingUrl) lines.push(`🔗 ${r.bookingUrl}`);
      lines.push('');
    });

    lines.push('_Reply with a number for more details or to make a reservation._');
    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let toolExecutorInstance: ToolExecutor | null = null;

export function getToolExecutor(): ToolExecutor {
  if (!toolExecutorInstance) {
    toolExecutorInstance = new ToolExecutor();
  }
  return toolExecutorInstance;
}
