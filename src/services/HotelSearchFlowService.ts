import { env } from '../config/environment.js';
import { ErrorCategory, type CorrelationContext, type ToolCallResult } from '../types/core.js';
import { MCPInterface } from './MCPInterface.js';
import { ToolRegistry, type ToolDefinition } from './ToolRegistry.js';
import type { HotelSearchCriteria } from './HotelIntakeService.js';
import {
  WhatsAppRenderer,
  type WhatsAppMessage,
  type WhatsAppMessagePart,
} from './WhatsAppRenderer.js';
import {
  HotelSearchAdapter,
  type HotelResult,
  type HotelSearchResponse,
} from './adapters/HotelSearchAdapter.js';
import {
  GooglePlacesHotelBrowsingService,
  type HotelBrowseResult,
  type HotelBrowseResponse,
} from './GooglePlacesHotelBrowsingService.js';

export interface HotelSearchFlowContext {
  correlationId: string;
  sessionId?: string;
  userId?: string;
  userLanguage?: string;
}

export interface HotelSearchFlowResult {
  status:
    | 'provider_not_connected'
    | 'browse_results'
    | 'validation_failed'
    | 'provider_failed'
    | 'success';
  reply: string;
  criteria: HotelSearchCriteria;
  toolResult?: ToolCallResult;
  renderedMessage?: WhatsAppMessage;
  browseResponse?: HotelBrowseResponse;
}

interface HotelSearchFlowDependencies {
  toolRegistry?: ToolRegistry;
  mcpInterface?: MCPInterface;
  renderer?: WhatsAppRenderer;
  browsingService?: GooglePlacesHotelBrowsingService;
  providerConfigured?: boolean;
}

const SEARCH_HOTELS_TOOL: ToolDefinition = {
  name: 'search_hotels',
  version: '1.0',
  description: 'Search for hotels by location and dates',
  parameters: {
    required: [
      { name: 'location', type: 'string', description: 'Hotel location' },
      { name: 'checkin_date', type: 'date', description: 'Check-in date' },
    ],
    optional: [
      { name: 'checkout_date', type: 'date', description: 'Check-out date' },
      { name: 'guests', type: 'number', description: 'Number of guests' },
      { name: 'budget', type: 'number', description: 'Maximum price per night' },
      { name: 'currency', type: 'string', description: 'Currency code' },
    ],
  },
  providerMapping: {
    providerName: 'nango_hotels',
    adapterClass: 'HotelSearchAdapter',
  },
  executionPolicy: {
    retryCount: 2,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
    idempotent: true,
  },
  permissions: {
    requiredRoles: [],
  },
  schemaBindings: {
    triggerSchemas: ['search_hotels'],
    requiredSchemaFields: ['location', 'checkin_date'],
  },
};

export class HotelSearchFlowService {
  private toolRegistry: ToolRegistry;
  private mcpInterface: MCPInterface;
  private renderer: WhatsAppRenderer;
  private browsingService: GooglePlacesHotelBrowsingService;
  private providerConfigured: boolean;

  constructor(dependencies: HotelSearchFlowDependencies = {}) {
    this.toolRegistry = dependencies.toolRegistry ?? new ToolRegistry();
    this.mcpInterface =
      dependencies.mcpInterface ?? new MCPInterface(this.toolRegistry);
    this.renderer = dependencies.renderer ?? new WhatsAppRenderer();
    this.browsingService =
      dependencies.browsingService ?? new GooglePlacesHotelBrowsingService();
    this.providerConfigured =
      dependencies.providerConfigured ?? isHotelProviderConfigured();

    if (this.providerConfigured && !dependencies.mcpInterface) {
      this.mcpInterface.registerAdapter(
        'HotelSearchAdapter',
        new HotelSearchAdapter({
          nangoUrl: env.nango.host,
          secretKey: process.env.NANGO_SECRET_KEY ?? '',
          integrationId: process.env.HOTEL_SEARCH_NANGO_INTEGRATION_ID ?? 'hotel_search',
          connectionId: process.env.HOTEL_SEARCH_NANGO_CONNECTION_ID ?? '',
        })
      );
    }
  }

  async handleCompletedIntake(
    criteria: HotelSearchCriteria,
    context: HotelSearchFlowContext
  ): Promise<HotelSearchFlowResult> {
    const params = this.toToolParams(criteria);
    const validationErrors = this.validateRequiredCriteria(params);

    if (validationErrors.length > 0) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your hotel request, but I still need: ${validationErrors.join(', ')}.`,
      };
    }

    await this.ensureSearchHotelsTool();

    if (!this.providerConfigured || !(await this.toolRegistry.isToolAvailable('search_hotels'))) {
      if (this.browsingService.isConfigured()) {
        const browseResponse = await this.browsingService.searchHotels(criteria, {
          maxResults: 9,
        });
        const rankedResults = rankHotelResults(browseResponse.results, criteria);
        if (rankedResults.length > 0) {
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
      }

      return {
        status: 'provider_not_connected',
        criteria,
        reply: this.buildProviderNotConnectedReply(criteria),
      };
    }

    const correlationCtx: CorrelationContext = {
      correlationId: context.correlationId,
      sessionId: context.sessionId,
      userId: context.userId,
      requestTimestamp: new Date(),
    };

    const toolResult = await this.mcpInterface.executeToolCall(
      {
        tool: 'search_hotels',
        params,
        context: {
          userLanguage: context.userLanguage ?? 'en',
          canonicalLanguage: 'en',
          sessionId: context.sessionId ?? context.correlationId,
          requestId: context.correlationId,
          userId: context.userId,
        },
      },
      correlationCtx
    );

    if (!toolResult.success) {
      return {
        status: 'provider_failed',
        criteria,
        toolResult,
        reply: this.buildProviderFailureReply(toolResult),
      };
    }

    const response = this.normalizeToolData(toolResult.data);
    const renderedMessage = await this.renderer.renderMessage(
      {
        type: 'hotel_results',
        results: response.results,
        headerText: `Found ${response.totalResults} hotel${response.totalResults === 1 ? '' : 's'} for ${criteria.location}`,
      },
      context.userLanguage ?? 'en'
    );

    return {
      status: 'success',
      criteria,
      toolResult,
      renderedMessage,
      reply: this.flattenWhatsAppMessage(renderedMessage),
    };
  }

  async handleBrowseSearch(
    criteria: HotelSearchCriteria,
    _context: HotelSearchFlowContext,
    maxResults = 9
  ): Promise<HotelSearchFlowResult> {
    const params = this.toToolParams(criteria);
    const validationErrors = this.validateRequiredCriteria(params);

    if (validationErrors.length > 0) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your hotel request, but I still need: ${validationErrors.join(', ')}.`,
      };
    }

    if (!this.browsingService.isConfigured()) {
      return {
        status: 'provider_not_connected',
        criteria,
        reply: this.buildProviderNotConnectedReply(criteria),
      };
    }

    const browseResponse = await this.browsingService.searchHotels(criteria, { maxResults });
    const rankedResults = rankHotelResults(browseResponse.results, criteria);

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
    criteria: HotelSearchCriteria,
    results: HotelBrowseResult[],
    nextOffset: number,
    totalResults: number
  ): string {
    return this.buildBrowseResultsReply(criteria, results, { nextOffset, totalResults });
  }

  private async ensureSearchHotelsTool(): Promise<void> {
    if (await this.toolRegistry.isToolAvailable('search_hotels')) {
      return;
    }

    if (!this.providerConfigured) {
      return;
    }

    const registration = await this.toolRegistry.registerTool(SEARCH_HOTELS_TOOL);
    if (!registration.success) {
      throw new Error(
        `Unable to register search_hotels tool: ${registration.errors?.join(', ') ?? registration.message}`
      );
    }
  }

  private toToolParams(criteria: HotelSearchCriteria): Record<string, unknown> {
    return {
      location: criteria.location,
      checkin_date: criteria.checkinDate,
      checkout_date: criteria.checkoutDate,
      guests: criteria.guests,
      budget: criteria.budgetPerNight?.amount,
      currency: criteria.budgetPerNight?.currency,
    };
  }

  private validateRequiredCriteria(params: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (typeof params.location !== 'string' || !params.location.trim()) {
      errors.push('location');
    }

    if (
      typeof params.checkin_date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(params.checkin_date)
    ) {
      errors.push('valid check-in date');
    }

    return errors;
  }

  private normalizeToolData(data: unknown): HotelSearchResponse {
    if (!data || typeof data !== 'object') {
      return { results: [], totalResults: 0 };
    }

    const response = data as Partial<HotelSearchResponse>;
    const results = Array.isArray(response.results)
      ? (response.results as HotelResult[])
      : [];

    return {
      results,
      totalResults:
        typeof response.totalResults === 'number'
          ? response.totalResults
          : results.length,
      searchId: response.searchId,
    };
  }

  private buildProviderNotConnectedReply(criteria: HotelSearchCriteria): string {
    return `Perfect, I have the hotel search details: ${this.formatCriteria(criteria)}. I am ready to search, but live property browsing is not configured in this environment yet. Once Google Places is enabled, I will return the top 3 matches with thumbnails, quick details, and a booking option.`;
  }

  private buildBrowseResultsReply(
    criteria: HotelSearchCriteria,
    results: HotelBrowseResult[],
    pagination: { nextOffset: number; totalResults: number }
  ): string {
    const hasMore = pagination.nextOffset < pagination.totalResults;
    const lines = [
      `I found these hotel matches for ${this.formatCriteria(criteria)}.`,
      'Price range is estimated from Google Places signals where available. Please confirm live rates and availability before booking.',
      '',
      ...results.map((hotel, index) => {
        const rating =
          typeof hotel.rating === 'number'
            ? ` - ${hotel.rating.toFixed(1)}/5${hotel.reviewCount ? ` (${hotel.reviewCount} reviews)` : ''}`
            : '';
        const price = hotel.priceRange ? `\nPrice signal: ${hotel.priceRange}` : '';
        const address = hotel.address ? `\n${hotel.address}` : '';

        return `${index + 1}. ${hotel.name}${rating}${price}${address}\nReply "book ${index + 1}" or "details ${index + 1}".`;
      }),
      '',
      hasMore
        ? 'Reply "next" to see the next 3 suggestions, "details 1", or "book 1" to start booking an option.'
        : 'Which hotel would you like me to help you book? Reply book 1, book 2, or book 3 from the latest list.',
    ];

    return lines.join('\n');
  }

  private buildProviderFailureReply(toolResult: ToolCallResult): string {
    if (toolResult.error?.category === ErrorCategory.SCHEMA_ERROR) {
      return `I could not run the hotel search because the saved criteria failed validation: ${toolResult.error.message}`;
    }

    return 'I tried to search live hotel inventory, but the hotel provider failed. Your criteria are saved, so we can retry once the provider is healthy.';
  }

  private flattenWhatsAppMessage(message: WhatsAppMessage): string {
    return message.messages.map((part) => this.flattenMessagePart(part)).join('\n\n');
  }

  private flattenMessagePart(part: WhatsAppMessagePart): string {
    if (part.type === 'text') {
      return part.body;
    }

    if (part.type === 'buttons') {
      const options = part.buttons
        .map((button, index) => `${index + 1}. ${button.title}`)
        .join('\n');
      return [part.body, options].filter(Boolean).join('\n\n');
    }

    return [
      part.body,
      ...part.sections.flatMap((section) =>
        section.rows.map((row, index) => {
          const description = row.description ? ` - ${row.description}` : '';
          return `${index + 1}. ${row.title}${description}`;
        })
      ),
    ].join('\n');
  }

  private formatCriteria(criteria: HotelSearchCriteria): string {
    const parts: string[] = [];

    if (criteria.location) parts.push(`location ${criteria.location}`);
    if (criteria.checkinDate) parts.push(`check-in ${criteria.checkinDate}`);
    if (criteria.checkoutDate) parts.push(`check-out ${criteria.checkoutDate}`);
    if (criteria.guests) parts.push(`${criteria.guests} guest${criteria.guests === 1 ? '' : 's'}`);
    if (criteria.boardBasis) parts.push(`meal plan ${this.formatBoardBasis(criteria.boardBasis)}`);
    if (criteria.budgetPerNight) {
      parts.push(`budget ${criteria.budgetPerNight.currency} ${criteria.budgetPerNight.amount} per night`);
    }
    if (criteria.additionalPreferences) {
      parts.push(`preference ${criteria.additionalPreferences}`);
    }

    return parts.join(', ');
  }

  private formatBoardBasis(
    boardBasis: NonNullable<HotelSearchCriteria['boardBasis']>
  ): string {
    const labels = {
      room_only: 'room only',
      bnb: 'B&B',
      half_board: 'half board',
      full_board: 'full board',
      all_inclusive: 'all inclusive',
    };

    return labels[boardBasis];
  }
}

function rankHotelResults(
  results: HotelBrowseResult[],
  criteria: HotelSearchCriteria
): HotelBrowseResult[] {
  const preferenceText = [
    criteria.location,
    criteria.starRating,
    criteria.hotelType,
    criteria.facilities,
    criteria.bedPreference,
    criteria.specialOccasion,
    criteria.additionalPreferences,
    criteria.boardBasis ? criteria.boardBasis.replace(/_/g, ' ') : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const preferenceTerms = tokenize(preferenceText);
  const expectedRating = parseStarRating(criteria.starRating);
  const familyIntent = /\b(family|kid|kids|child|children|connecting|club)\b/i.test(
    preferenceText
  );
  const coupleIntent = /\b(couple|romantic|honeymoon|anniversary)\b/i.test(preferenceText);
  const businessIntent = /\b(business|work|conference|meeting)\b/i.test(preferenceText);

  return results
    .map((hotel, index) => {
      const searchable = `${hotel.name} ${hotel.address ?? ''}`.toLowerCase();
      let score = 0;

      if (criteria.location && searchable.includes(criteria.location.toLowerCase())) {
        score += 20;
      }

      for (const term of preferenceTerms) {
        if (searchable.includes(term)) {
          score += 4;
        }
      }

      if (typeof hotel.rating === 'number') {
        score += hotel.rating * 8;
        if (expectedRating && hotel.rating >= expectedRating - 0.35) {
          score += 12;
        }
      }

      if (typeof hotel.reviewCount === 'number') {
        score += Math.min(15, Math.log10(hotel.reviewCount + 1) * 5);
      }

      if (criteria.budgetPerNight && hotel.priceRange) {
        score += scoreBudgetFit(criteria.budgetPerNight.amount, hotel.priceRange);
      }

      if (criteria.boardBasis && preferenceTerms.includes(criteria.boardBasis.replace(/_/g, ' '))) {
        score += 3;
      }

      if (familyIntent && /\b(family|villa|resort|suite|apartment)\b/i.test(searchable)) {
        score += 8;
      }
      if (coupleIntent && /\b(boutique|villa|spa|fort|grand)\b/i.test(searchable)) {
        score += 8;
      }
      if (businessIntent && /\b(city|business|central|hotel)\b/i.test(searchable)) {
        score += 8;
      }

      return { hotel, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ hotel }) => hotel);
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3)
    )
  );
}

function parseStarRating(starRating?: string): number | null {
  const match = starRating?.match(/[3-5]/);
  return match ? Number(match[0]) : null;
}

function scoreBudgetFit(amount: number, priceRange: string): number {
  const normalized = priceRange.trim();
  const priceWeight = normalized === '$' ? 1 : normalized === '$$' ? 2 : normalized === '$$$' ? 3 : 4;
  const budgetWeight = amount <= 75 ? 1 : amount <= 175 ? 2 : amount <= 350 ? 3 : 4;
  return Math.max(0, 10 - Math.abs(priceWeight - budgetWeight) * 4);
}

function isHotelProviderConfigured(): boolean {
  return (
    process.env.HOTEL_SEARCH_PROVIDER_ENABLED === 'true' &&
    Boolean(process.env.NANGO_SECRET_KEY) &&
    Boolean(process.env.HOTEL_SEARCH_NANGO_CONNECTION_ID)
  );
}

let hotelSearchFlowServiceInstance: HotelSearchFlowService | null = null;

export function getHotelSearchFlowService(): HotelSearchFlowService {
  if (!hotelSearchFlowServiceInstance) {
    hotelSearchFlowServiceInstance = new HotelSearchFlowService();
  }

  return hotelSearchFlowServiceInstance;
}
