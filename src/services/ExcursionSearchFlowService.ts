import {
  GooglePlacesExcursionBrowsingService,
  type ExcursionBrowseResult,
  type ExcursionBrowseResponse,
} from './GooglePlacesExcursionBrowsingService.js';
import { defaultSearchFlowEngine } from './SearchFlowEngine.js';
import type { ExcursionSearchCriteria } from './excursionRequestMapper.js';

export interface ExcursionSearchFlowContext {
  correlationId: string;
  sessionId?: string;
  userLanguage?: string;
}

export interface ExcursionSearchFlowResult {
  status: 'browse_results' | 'validation_failed' | 'provider_not_connected';
  reply: string;
  criteria: ExcursionSearchCriteria;
  browseResponse?: ExcursionBrowseResponse;
}

export class ExcursionSearchFlowService {
  private browsingService: GooglePlacesExcursionBrowsingService;

  constructor(dependencies: { browsingService?: GooglePlacesExcursionBrowsingService } = {}) {
    this.browsingService =
      dependencies.browsingService ?? new GooglePlacesExcursionBrowsingService();
  }

  async handleBrowseSearch(
    criteria: ExcursionSearchCriteria,
    _context: ExcursionSearchFlowContext,
    maxResults = 9
  ): Promise<ExcursionSearchFlowResult> {
    const validationErrors = validateRequiredCriteria(criteria);
    if (validationErrors.length > 0) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your excursion request, but I still need: ${validationErrors.join(', ')}.`,
      };
    }

    if (!this.browsingService.isConfigured()) {
      return {
        status: 'provider_not_connected',
        criteria,
        reply: buildProviderNotConnectedReply(criteria),
      };
    }

    const browseResponse = await this.browsingService.searchExcursions(criteria, { maxResults });
    const rankedResults = rankExcursionResults(browseResponse.results, criteria);

    if (rankedResults.length === 0) {
      return {
        status: 'provider_not_connected',
        criteria,
        browseResponse,
        reply: buildProviderNotConnectedReply(criteria),
      };
    }

    return {
      status: 'browse_results',
      criteria,
      browseResponse: { ...browseResponse, results: rankedResults },
      reply: this.buildBrowseResultsPageReply(
        criteria,
        rankedResults.slice(0, 3),
        Math.min(3, rankedResults.length),
        rankedResults.length
      ),
    };
  }

  buildBrowseResultsPageReply(
    criteria: ExcursionSearchCriteria,
    results: ExcursionBrowseResult[],
    nextOffset: number,
    totalResults: number
  ): string {
    const hasMore = nextOffset < totalResults;
    const lines = [
      `I found these experience matches for ${criteria.destination ?? 'your search'}.`,
      criteria.additionalPreferences ? `I included your preference: ${criteria.additionalPreferences}.` : undefined,
      '',
      ...results.map((experience, index) => buildExperienceResultText(index + 1, experience)),
      '',
      hasMore
        ? 'Reply "next" to see the next 3 suggestions, "details 1", or "book 1".'
        : 'Which experience would you like me to help you book? Reply book 1, book 2, or book 3 from the latest list.',
    ].filter((line): line is string => typeof line === 'string');

    return lines.join('\n');
  }
}

export function rankExcursionResults(
  results: ExcursionBrowseResult[],
  criteria: ExcursionSearchCriteria
): ExcursionBrowseResult[] {
  const preferenceText = [
    criteria.destination,
    criteria.category,
    criteria.tourType,
    criteria.duration,
    criteria.fitnessLevel,
    criteria.specialRequirements,
    criteria.additionalPreferences,
    criteria.originalRequest,
  ].filter(Boolean).join(' ');
  const preferenceTerms = defaultSearchFlowEngine.tokenize(preferenceText);

  return results
    .map((experience, index) => {
      const searchable = `${experience.name} ${experience.address ?? ''} ${experience.category ?? ''} ${experience.shortDescription ?? ''}`;
      let score = defaultSearchFlowEngine.scoreText(searchable, preferenceTerms, 5);

      if (criteria.destination && searchable.toLowerCase().includes(criteria.destination.toLowerCase())) {
        score += 20;
      }
      if (criteria.category && searchable.toLowerCase().includes(criteria.category.toLowerCase())) {
        score += 18;
      }
      if (criteria.budget && experience.priceRange === criteria.budget) {
        score += 10;
      }
      if (criteria.duration && searchable.toLowerCase().includes(criteria.duration.toLowerCase())) {
        score += 8;
      }
      if (criteria.tourType && /family|couple|private|group|luxury|budget/i.test(criteria.tourType)) {
        score += defaultSearchFlowEngine.scoreText(searchable, defaultSearchFlowEngine.tokenize(criteria.tourType), 8);
      }
      if (typeof experience.rating === 'number') {
        score += experience.rating * 8;
      }
      if (typeof experience.reviewCount === 'number') {
        score += Math.min(18, Math.log10(experience.reviewCount + 1) * 6);
      }

      return { experience, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ experience }) => experience);
}

function validateRequiredCriteria(criteria: ExcursionSearchCriteria): string[] {
  const errors: string[] = [];
  if (!criteria.destination?.trim()) errors.push('destination');
  if (!criteria.preferredDate?.trim()) errors.push('preferred date');
  if (!criteria.preferredTime?.trim()) errors.push('preferred time');
  if (!criteria.guests) errors.push('number of guests');
  return errors;
}

function buildProviderNotConnectedReply(criteria: ExcursionSearchCriteria): string {
  return `I have your excursion request for ${criteria.destination ?? 'your destination'}, but I cannot complete the experience check at this moment. Please send "search again" in a moment and I will retry.`;
}

function buildExperienceResultText(displayNumber: number, experience: ExcursionBrowseResult): string {
  const rating =
    typeof experience.rating === 'number'
      ? `${experience.rating.toFixed(1)}/5${experience.reviewCount ? ` (${experience.reviewCount} reviews)` : ''}`
      : 'Rating not listed';

  return [
    `${displayNumber}. ${experience.name}`,
    experience.category ? `Category: ${experience.category}` : undefined,
    `Rating: ${rating}`,
    experience.priceRange ? `Estimated price: ${experience.priceRange}` : 'Estimated price: confirm locally',
    experience.shortDescription,
    experience.address,
    experience.googleMapsUri ? `Map: ${experience.googleMapsUri}` : undefined,
    `Reply "book ${displayNumber}" or "details ${displayNumber}".`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0).join('\n');
}

let excursionSearchFlowServiceInstance: ExcursionSearchFlowService | null = null;

export function getExcursionSearchFlowService(): ExcursionSearchFlowService {
  if (!excursionSearchFlowServiceInstance) {
    excursionSearchFlowServiceInstance = new ExcursionSearchFlowService();
  }

  return excursionSearchFlowServiceInstance;
}
