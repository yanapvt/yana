import {
  GooglePlacesRestaurantBrowsingService,
  type RestaurantBrowseResult,
  type RestaurantBrowseResponse,
} from './GooglePlacesRestaurantBrowsingService.js';
import { defaultSearchFlowEngine } from './SearchFlowEngine.js';
import type { RestaurantSearchCriteria } from './restaurantRequestMapper.js';

export interface RestaurantSearchFlowContext {
  correlationId: string;
  sessionId?: string;
  userLanguage?: string;
}

export interface RestaurantSearchFlowResult {
  status: 'browse_results' | 'validation_failed' | 'provider_not_connected';
  reply: string;
  criteria: RestaurantSearchCriteria;
  browseResponse?: RestaurantBrowseResponse;
}

interface RestaurantSearchFlowDependencies {
  browsingService?: GooglePlacesRestaurantBrowsingService;
}

export class RestaurantSearchFlowService {
  private browsingService: GooglePlacesRestaurantBrowsingService;

  constructor(dependencies: RestaurantSearchFlowDependencies = {}) {
    this.browsingService =
      dependencies.browsingService ?? new GooglePlacesRestaurantBrowsingService();
  }

  async handleBrowseSearch(
    criteria: RestaurantSearchCriteria,
    _context: RestaurantSearchFlowContext,
    maxResults = 9
  ): Promise<RestaurantSearchFlowResult> {
    const validationErrors = this.validateRequiredCriteria(criteria);

    if (validationErrors.length > 0) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your dining request, but I still need: ${validationErrors.join(', ')}.`,
      };
    }

    if (!this.browsingService.isConfigured()) {
      return {
        status: 'provider_not_connected',
        criteria,
        reply: this.buildProviderNotConnectedReply(criteria),
      };
    }

    const browseResponse = await this.browsingService.searchRestaurants(criteria, { maxResults });
    const rankedResults = rankRestaurantResults(browseResponse.results, criteria);

    if (rankedResults.length === 0) {
      return {
        status: 'provider_not_connected',
        criteria,
        browseResponse,
        reply: this.buildProviderNotConnectedReply(criteria),
      };
    }

    return {
      status: 'browse_results',
      criteria,
      browseResponse: { ...browseResponse, results: rankedResults },
      reply: this.buildBrowseResultsReply(criteria, rankedResults.slice(0, 3), {
        nextOffset: Math.min(3, rankedResults.length),
        totalResults: rankedResults.length,
      }),
    };
  }

  buildBrowseResultsPageReply(
    criteria: RestaurantSearchCriteria,
    results: RestaurantBrowseResult[],
    nextOffset: number,
    totalResults: number
  ): string {
    return this.buildBrowseResultsReply(criteria, results, { nextOffset, totalResults });
  }

  private validateRequiredCriteria(criteria: RestaurantSearchCriteria): string[] {
    const errors: string[] = [];

    if (!criteria.location?.trim()) errors.push('location');
    // Google Places is used only for exploration. Reservation details are
    // intentionally collected later and are not required to show suggestions.

    return errors;
  }

  private buildProviderNotConnectedReply(criteria: RestaurantSearchCriteria): string {
    return `I have your dining request for ${criteria.location ?? 'your destination'}, but I cannot complete the restaurant check at this moment. Please send "search again" in a moment and I will retry.`;
  }

  private buildBrowseResultsReply(
    criteria: RestaurantSearchCriteria,
    results: RestaurantBrowseResult[],
    pagination: { nextOffset: number; totalResults: number }
  ): string {
    const hasMore = pagination.nextOffset < pagination.totalResults;
    const lines = [
      `I found these restaurant matches for ${criteria.location ?? 'your search'}.`,
      criteria.additionalPreferences ? `I included your preference: ${criteria.additionalPreferences}.` : undefined,
      '',
      ...results.map((restaurant, index) => buildRestaurantResultText(index + 1, restaurant)),
      '',
      hasMore
        ? 'Reply "next" to see the next 3 suggestions or "details 1" for more information. These are discovery matches, not confirmed reservations.'
        : 'Which restaurant would you like more information about? Reply details 1, details 2, or details 3. Please contact the restaurant directly to confirm availability or reserve.',
    ].filter((line): line is string => typeof line === 'string');

    return lines.join('\n');
  }
}

export function rankRestaurantResults(
  results: RestaurantBrowseResult[],
  criteria: RestaurantSearchCriteria
): RestaurantBrowseResult[] {
  const preferenceText = [
    criteria.location,
    criteria.cuisine,
    criteria.diningStyle,
    criteria.dietaryRequirements,
    criteria.indoorOutdoor,
    criteria.specialOccasion,
    criteria.additionalPreferences,
    criteria.originalRequest,
  ]
    .filter(Boolean)
    .join(' ');
  const preferenceTerms = defaultSearchFlowEngine.tokenize(preferenceText);

  return results
    .map((restaurant, index) => {
      const searchable = `${restaurant.name} ${restaurant.address ?? ''} ${restaurant.cuisine ?? ''}`;
      let score = defaultSearchFlowEngine.scoreText(searchable, preferenceTerms, 5);

      if (criteria.location && searchable.toLowerCase().includes(criteria.location.toLowerCase())) {
        score += 20;
      }

      if (criteria.cuisine && searchable.toLowerCase().includes(criteria.cuisine.toLowerCase())) {
        score += 18;
      }

      if (criteria.priceRange && restaurant.priceRange === criteria.priceRange) {
        score += 12;
      }

      if (typeof restaurant.rating === 'number') {
        score += restaurant.rating * 8;
      }

      if (typeof restaurant.reviewCount === 'number') {
        score += Math.min(15, Math.log10(restaurant.reviewCount + 1) * 5);
      }

      if (criteria.diningStyle && styleMatches(criteria.diningStyle, searchable)) {
        score += 10;
      }

      return { restaurant, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ restaurant }) => restaurant);
}

function styleMatches(style: string, searchable: string): boolean {
  const normalized = `${style} ${searchable}`.toLowerCase();
  if (/romantic|date night/.test(normalized)) return /romantic|fine|wine|beach|roof|view/.test(normalized);
  if (/family/.test(normalized)) return /family|casual|garden|large/.test(normalized);
  if (/beachfront|rooftop|local favourite|luxury|casual|fine dining/i.test(normalized)) return true;
  return false;
}

function buildRestaurantResultText(displayNumber: number, restaurant: RestaurantBrowseResult): string {
  const rating =
    typeof restaurant.rating === 'number'
      ? `${restaurant.rating.toFixed(1)}/5${restaurant.reviewCount ? ` (${restaurant.reviewCount} reviews)` : ''}`
      : 'Rating not listed';

  return [
    `${displayNumber}. ${restaurant.name}`,
    `Rating: ${rating}`,
    restaurant.priceRange ? `Price level: ${restaurant.priceRange}` : 'Price level: confirm locally',
    restaurant.cuisine ? `Cuisine: ${restaurant.cuisine}` : undefined,
    restaurant.address,
    restaurant.googleMapsUri ? `Map: ${restaurant.googleMapsUri}` : undefined,
    `Reply "details ${displayNumber}" for more information. Contact the restaurant directly to confirm availability or reserve.`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n');
}

let restaurantSearchFlowServiceInstance: RestaurantSearchFlowService | null = null;

export function getRestaurantSearchFlowService(): RestaurantSearchFlowService {
  if (!restaurantSearchFlowServiceInstance) {
    restaurantSearchFlowServiceInstance = new RestaurantSearchFlowService();
  }

  return restaurantSearchFlowServiceInstance;
}
