import { defaultSearchFlowEngine } from './SearchFlowEngine.js';
import {
  PlaceholderTransportProvider,
  type TransportOption,
  type TransportProvider,
} from './TransportProvider.js';
import type { LogisticsSearchCriteria } from './logisticsRequestMapper.js';

export interface LogisticsSearchFlowContext {
  correlationId: string;
  sessionId: string;
  userLanguage?: string;
}

export interface LogisticsSearchFlowResult {
  status: 'validation_failed' | 'provider_options';
  criteria: LogisticsSearchCriteria;
  options?: TransportOption[];
  reply: string;
}

export class LogisticsSearchFlowService {
  constructor(private readonly provider: TransportProvider = new PlaceholderTransportProvider()) {}

  async handleProviderSearch(
    criteria: LogisticsSearchCriteria,
    _context: LogisticsSearchFlowContext,
    options: { maxResults?: number } = {}
  ): Promise<LogisticsSearchFlowResult> {
    const validationErrors = validateRequiredCriteria(criteria);
    if (validationErrors.length > 0) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your transport request, but I still need: ${validationErrors.join(', ')}.`,
      };
    }

    const providerOptions = await this.provider.search({
      criteria,
      maxResults: options.maxResults ?? 9,
    });
    const rankedOptions = rankTransportOptions(providerOptions, criteria);

    return {
      status: 'provider_options',
      criteria,
      options: rankedOptions,
      reply: this.buildOptionsPageReply(
        criteria,
        rankedOptions.slice(0, 3),
        Math.min(3, rankedOptions.length),
        rankedOptions.length
      ),
    };
  }

  buildOptionsPageReply(
    criteria: LogisticsSearchCriteria,
    options: TransportOption[],
    nextOffset: number,
    totalResults: number
  ): string {
    const hasMore = nextOffset < totalResults;
    const lines = [
      `I found these transport options from ${criteria.pickupLocation ?? 'your pickup'} to ${criteria.destination ?? 'your destination'}.`,
      criteria.additionalPreferences ? `I included your preference: ${criteria.additionalPreferences}.` : undefined,
      '',
      ...options.map((option, index) => buildTransportOptionText(index + 1, option)),
      '',
      hasMore
        ? 'Reply "next" to see the next 3 suggestions, "details 1", or "book 1".'
        : 'Which transport option would you like me to arrange? Reply book 1, book 2, or book 3 from the latest list.',
    ].filter((line): line is string => typeof line === 'string');

    return lines.join('\n');
  }
}

export function rankTransportOptions(
  options: TransportOption[],
  criteria: LogisticsSearchCriteria
): TransportOption[] {
  const preferenceText = [
    criteria.pickupLocation,
    criteria.destination,
    criteria.vehicleType,
    criteria.luggage,
    criteria.journeyType,
    criteria.preferredProvider,
    criteria.specialRequirements,
    criteria.additionalPreferences,
    criteria.originalRequest,
  ].filter(Boolean).join(' ');
  const preferenceTerms = defaultSearchFlowEngine.tokenize(preferenceText);

  return options
    .map((option, index) => {
      const searchable = `${option.provider} ${option.vehicle} ${option.vehicleType} ${option.luggageCapacity} ${option.notes ?? ''}`;
      let score = defaultSearchFlowEngine.scoreText(searchable, preferenceTerms, 6);

      if (criteria.vehicleType && searchable.toLowerCase().includes(criteria.vehicleType.toLowerCase())) {
        score += 20;
      }
      if (criteria.preferredProvider && searchable.toLowerCase().includes(criteria.preferredProvider.toLowerCase())) {
        score += 18;
      }
      if (typeof criteria.passengers === 'number' && option.capacity >= criteria.passengers) {
        score += 16;
      }
      if (criteria.luggage && searchable.toLowerCase().includes(criteria.luggage.toLowerCase())) {
        score += 10;
      }
      if (criteria.journeyType && searchable.toLowerCase().includes(criteria.journeyType.toLowerCase())) {
        score += 8;
      }
      if (typeof option.rating === 'number') {
        score += option.rating * 7;
      }

      return { option, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ option }) => option);
}

function validateRequiredCriteria(criteria: LogisticsSearchCriteria): string[] {
  const errors: string[] = [];
  if (!criteria.pickupLocation?.trim()) errors.push('pickup location');
  if (!criteria.destination?.trim()) errors.push('destination');
  if (!criteria.pickupDate?.trim()) errors.push('pickup date');
  if (!criteria.pickupTime?.trim()) errors.push('pickup time');
  if (!criteria.passengers) errors.push('passengers');
  return errors;
}

function buildTransportOptionText(displayNumber: number, option: TransportOption): string {
  return [
    `${displayNumber}. ${option.provider}`,
    `Vehicle: ${option.vehicle}`,
    `Estimated price: ${option.estimatedPrice}`,
    `Vehicle type: ${option.vehicleType}`,
    `Capacity: ${option.capacity}`,
    `Estimated duration: ${option.estimatedDuration}`,
  ].join('\n');
}

let logisticsSearchFlowServiceInstance: LogisticsSearchFlowService | null = null;

export function getLogisticsSearchFlowService(): LogisticsSearchFlowService {
  if (!logisticsSearchFlowServiceInstance) {
    logisticsSearchFlowServiceInstance = new LogisticsSearchFlowService();
  }

  return logisticsSearchFlowServiceInstance;
}
