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
import {
  createConfiguredHotelSupplierOrchestrator,
  type HotelSupplierOrchestrationResult,
  type HotelSupplierOrchestrator,
  type NormalizedHotelRate,
  type RateRecheckOutcome,
} from './hotel-engine/index.js';
import {
  SltdaRegistryService,
  type RegisteredAccommodation,
  type VerifiedHotelMatch,
} from './SltdaRegistryService.js';
import {
  PostgresRejectedHotelInventoryAuditWriter,
  type RejectedHotelInventoryAuditRecord,
  type RejectedHotelInventoryAuditWriter,
} from './RejectedHotelInventoryAuditService.js';
import {
  getHotelSearchSettingsService,
  type HotelSearchSettingsProvider,
} from './HotelSearchSettingsService.js';
import { logSafeOperatorFailure } from './SafeFailureService.js';

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
  supplierOrchestrator?: Pick<HotelSupplierOrchestrator, 'searchHotels' | 'recheckRate'>;
  supplierConfigured?: boolean;
  sltdaRegistryService?: Pick<SltdaRegistryService, 'findEligible' | 'matchHotels' | 'matchGoogleResults'>;
  sltdaRegistryConfigured?: boolean;
  supplierAttributionLoggingEnabled?: boolean;
  rejectedInventoryAuditWriter?: RejectedHotelInventoryAuditWriter;
  rejectedInventoryAuditEnabled?: boolean;
  providerConfigured?: boolean;
  searchSettingsProvider?: HotelSearchSettingsProvider;
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
  private supplierOrchestrator?: Pick<HotelSupplierOrchestrator, 'searchHotels' | 'recheckRate'>;
  private supplierConfigured: boolean;
  private sltdaRegistryService?: Pick<SltdaRegistryService, 'findEligible' | 'matchHotels' | 'matchGoogleResults'>;
  private sltdaRegistryConfigured: boolean;
  private supplierAttributionLoggingEnabled: boolean;
  private rejectedInventoryAuditWriter?: RejectedHotelInventoryAuditWriter;
  private rejectedInventoryAuditEnabled: boolean;
  private providerConfigured: boolean;
  private searchSettingsProvider: HotelSearchSettingsProvider;

  constructor(dependencies: HotelSearchFlowDependencies = {}) {
    this.toolRegistry = dependencies.toolRegistry ?? new ToolRegistry();
    this.mcpInterface =
      dependencies.mcpInterface ?? new MCPInterface(this.toolRegistry);
    this.renderer = dependencies.renderer ?? new WhatsAppRenderer();
    this.browsingService =
      dependencies.browsingService ?? new GooglePlacesHotelBrowsingService();
    this.supplierConfigured =
      dependencies.supplierConfigured ?? env.hotelSuppliers.enabled;
    this.supplierOrchestrator =
      dependencies.supplierOrchestrator ??
      (this.supplierConfigured ? createConfiguredHotelSupplierOrchestrator() : undefined);
    this.sltdaRegistryConfigured =
      dependencies.sltdaRegistryConfigured ?? env.sltdaRegistry.enabled;
    this.supplierAttributionLoggingEnabled =
      dependencies.supplierAttributionLoggingEnabled ??
      env.hotelSuppliers.attributionLoggingEnabled;
    this.rejectedInventoryAuditEnabled =
      dependencies.rejectedInventoryAuditEnabled ??
      env.sltdaRegistry.rejectedInventoryAuditEnabled;
    this.rejectedInventoryAuditWriter =
      dependencies.rejectedInventoryAuditWriter ??
      (this.rejectedInventoryAuditEnabled
        ? new PostgresRejectedHotelInventoryAuditWriter()
        : undefined);
    this.sltdaRegistryService =
      dependencies.sltdaRegistryService ??
      (this.sltdaRegistryConfigured
        ? new SltdaRegistryService(
            undefined,
            env.sltdaRegistry.minimumMatchConfidence
          )
        : undefined);
    this.providerConfigured =
      dependencies.providerConfigured ?? isHotelProviderConfigured();
    this.searchSettingsProvider =
      dependencies.searchSettingsProvider ??
      ((process.env.NODE_ENV === 'test' || process.env.VITEST === 'true')
        ? { getSettings: async () => ({
            sltdaFilterEnabled: env.sltdaRegistry.requireVerifiedHotels,
            zeroResultFallbackEnabled: true,
            minimumGoogleRating: null,
            minimumGoogleReviewCount: null,
          }) }
        : getHotelSearchSettingsService());

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

    // Completed intake is still exploration. Live providers are invoked only
    // after the customer selects an option through handleBookingCheck.
    return this.handleBrowseSearch(criteria, context, 9);
  }

  async handleBrowseSearch(
    criteria: HotelSearchCriteria,
    context: HotelSearchFlowContext,
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
    const settings = await this.searchSettingsProvider.getSettings();
    const unfilteredGoogleResults = browseResponse.results;
    let explorationResults = unfilteredGoogleResults.filter((hotel) =>
      (settings.minimumGoogleRating === null ||
        (typeof hotel.rating === 'number' && hotel.rating >= settings.minimumGoogleRating)) &&
      (settings.minimumGoogleReviewCount === null ||
        (typeof hotel.reviewCount === 'number' && hotel.reviewCount >= settings.minimumGoogleReviewCount))
    );
    let strictSltdaFilterApplied = false;
    if (this.sltdaRegistryConfigured && this.sltdaRegistryService) {
      const registryRecords = await this.sltdaRegistryService.findEligible(
        criteria.location!,
        context.correlationId
      );
      const verifiedGoogleResults = this.sltdaRegistryService.matchGoogleResults(
        explorationResults,
        registryRecords,
        context.correlationId
      );
      if (settings.sltdaFilterEnabled) {
        strictSltdaFilterApplied = true;
        explorationResults = verifiedGoogleResults;
      } else {
        const verifiedIds = new Set(
          verifiedGoogleResults.map((result) => result.googlePlaceId ?? result.id)
        );
        explorationResults = explorationResults.map((result) =>
          verifiedIds.has(result.googlePlaceId ?? result.id) ?
            verifiedGoogleResults.find(
              (verified) => (verified.googlePlaceId ?? verified.id) === (result.googlePlaceId ?? result.id)
            ) ?? result : result
        );
      }
    }
    // Customer exploration must never become empty solely because operational
    // filters rejected every Google candidate.
    if (explorationResults.length === 0 && unfilteredGoogleResults.length > 0) {
      console.info('[HotelSearchFlow] exploration_filter_fallback_applied', {
        correlationId: context.correlationId,
        location: criteria.location,
        googleResultCount: unfilteredGoogleResults.length,
        sltdaFilterEnabled: settings.sltdaFilterEnabled,
        minimumGoogleRating: settings.minimumGoogleRating,
        minimumGoogleReviewCount: settings.minimumGoogleReviewCount,
      });
      explorationResults = unfilteredGoogleResults;
      strictSltdaFilterApplied = false;
    }
    const rankedResults = rankHotelResults(explorationResults, criteria);

    if (rankedResults.length === 0) {
      return {
        status: 'provider_not_connected',
        criteria,
        browseResponse: { ...browseResponse, results: [] },
        reply: strictSltdaFilterApplied
          ? `I found Google hotel candidates for ${criteria.location}, but none could be confidently matched to an eligible Sri Lanka Tourism registration.`
          : this.buildProviderNotConnectedReply(criteria),
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

  async handleBookingCheck(
    criteria: HotelSearchCriteria,
    selectedHotel: HotelBrowseResult,
    context: HotelSearchFlowContext
  ): Promise<HotelSearchFlowResult> {
    const validationErrors = this.validateRequiredCriteria(this.toToolParams(criteria));
    const checkoutError = this.validateCheckoutDate(criteria.checkoutDate);
    if (checkoutError) validationErrors.push(checkoutError);
    if (validationErrors.length > 0) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your hotel selection, but I still need: ${validationErrors.join(', ')}.`,
      };
    }
    if (!this.supplierConfigured || !this.supplierOrchestrator) {
      return {
        status: 'provider_not_connected',
        criteria,
        reply: 'Live room and rate providers are not currently available for this booking check.',
      };
    }
    return (await this.searchSupplierInventory(criteria, context, 9, selectedHotel)) ?? {
      status: 'provider_not_connected',
      criteria,
      reply: `I could not find live bookable rooms for ${selectedHotel.name} for those dates.`,
    };
  }

  private validateCheckoutDate(value?: string): string | undefined {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? undefined
      : 'valid check-out date';
  }

  private async searchSupplierInventory(
    criteria: HotelSearchCriteria,
    context: HotelSearchFlowContext,
    maxResults: number,
    selectedHotel?: HotelBrowseResult
  ): Promise<HotelSearchFlowResult | undefined> {
    if (!this.supplierConfigured || !this.supplierOrchestrator) return undefined;

    const checkoutError = this.validateCheckoutDate(criteria.checkoutDate);
    if (checkoutError) {
      return {
        status: 'validation_failed',
        criteria,
        reply: `I have your hotel request, but I still need: ${checkoutError}.`,
      };
    }

    let registryRecords: RegisteredAccommodation[] = [];
    let googleResults: HotelBrowseResult[] = [];
    if (this.sltdaRegistryConfigured && this.sltdaRegistryService) {
      if (selectedHotel) {
        googleResults = [selectedHotel];
      } else if (this.browsingService.isConfigured()) {
        googleResults = (
          await this.browsingService.searchHotels(criteria, { maxResults: Math.max(maxResults, 20) })
        ).results;
      }
      registryRecords = await this.sltdaRegistryService.findEligible(
        criteria.location!,
        context.correlationId
      );
      if (registryRecords.length === 0 && env.sltdaRegistry.requireVerifiedHotels) {
        console.info('[HotelSearchFlow] live_supplier_gate_stopped', {
          correlationId: context.correlationId,
          reason: 'no_eligible_sltda_records',
          location: criteria.location,
        });
        return {
          status: 'provider_not_connected',
          criteria,
          reply: `I could not find an eligible registered accommodation match for ${criteria.location}. I have not requested live room rates.`,
        };
      }
    }

    const inventory = await this.supplierOrchestrator.searchHotels({
      destination: criteria.location!,
      checkIn: criteria.checkinDate!,
      checkOut: criteria.checkoutDate!,
      occupancy: {
        adults: criteria.guests ?? 2,
        children: 0,
        rooms: criteria.rooms ?? 1,
      },
      currency: criteria.budgetPerNight?.currency ?? 'USD',
      correlationId: context.correlationId,
    });
    let verifiedMatches: VerifiedHotelMatch[] = [];
    if (this.sltdaRegistryConfigured && this.sltdaRegistryService) {
      verifiedMatches = this.sltdaRegistryService.matchHotels(
        inventory.hotels,
        registryRecords,
        googleResults,
        context.correlationId
      );
    }
    const requireVerified =
      this.sltdaRegistryConfigured && env.sltdaRegistry.requireVerifiedHotels;
    if (requireVerified) {
      await this.auditIgnoredUnregisteredSupplierHotels(
        inventory,
        verifiedMatches,
        context.correlationId
      );
    }
    const inventoryResponse = this.toInventoryBrowseResponse(
      inventory,
      criteria,
      maxResults,
      verifiedMatches,
      selectedHotel
    );
    console.info('[HotelSearchFlow] verified_inventory_merge_completed', {
      correlationId: context.correlationId,
      googleCandidates: googleResults.length,
      registryCandidates: registryRecords.length,
      supplierHotels: inventory.hotels.length,
      supplierRates: inventory.rates.length,
      verifiedHotels: verifiedMatches.length,
      customerResults: inventoryResponse.results.length,
    });
    if (inventoryResponse.results.length === 0) {
      if (requireVerified) {
        console.info('[HotelSearchFlow] verified_inventory_gate_stopped', {
          correlationId: context.correlationId,
          reason: 'no_verified_supplier_inventory',
          supplierHotels: inventory.hotels.length,
          supplierRates: inventory.rates.length,
          ignoredHotels: inventory.hotels.length - verifiedMatches.length,
        });
        return {
          status: 'provider_not_connected',
          criteria,
          reply: `I could not find live room availability for an eligible registered accommodation in ${criteria.location}. Please try different dates or preferences.`,
        };
      }
      return undefined;
    }

    const recheckResult = await this.recheckEligibleRates(
      inventory,
      inventoryResponse,
      criteria,
      context,
      verifiedMatches,
      selectedHotel
    );
    if (recheckResult) {
      return recheckResult;
    }

    return {
      status: 'provider_not_connected',
      criteria,
      reply: `I found possible supplier rates for ${selectedHotel?.name ?? criteria.location}, but none passed a fresh availability and price recheck. No stay was booked.`,
    };
  }

  private async recheckEligibleRates(
    inventory: HotelSupplierOrchestrationResult,
    inventoryResponse: HotelBrowseResponse,
    criteria: HotelSearchCriteria,
    context: HotelSearchFlowContext,
    verifiedMatches: VerifiedHotelMatch[],
    selectedHotel?: HotelBrowseResult
  ): Promise<HotelSearchFlowResult | undefined> {
    if (!this.supplierOrchestrator) return undefined;

    for (const displayedResult of inventoryResponse.results) {
      const rate = findInventoryRate(inventory.rates, displayedResult);
      if (!rate) continue;

      const outcome = await this.supplierOrchestrator.recheckRate(
        rate,
        context.correlationId
      );
      if (outcome.status === 'price_changed' && outcome.result) {
        return this.buildPriceChangedResult(criteria, selectedHotel, outcome);
      }
      if (outcome.status !== 'success' || !outcome.result) continue;

      const recheckedInventory: HotelSupplierOrchestrationResult = {
        ...inventory,
        rates: [outcome.result.rate],
      };
      const recheckedBrowseResponse = this.toInventoryBrowseResponse(
        recheckedInventory,
        criteria,
        1,
        verifiedMatches,
        selectedHotel
      );
      const recheckedResult = recheckedBrowseResponse.results[0];
      if (!recheckedResult) continue;

      return {
        status: 'browse_results',
        criteria,
        browseResponse: recheckedBrowseResponse,
        reply: [
          `I rechecked the selected stay with the room supplier for ${selectedHotel?.name ?? recheckedResult.name}.`,
          recheckedResult.sltdaVerified
            ? 'Sri Lanka Tourism registration: Verified.'
            : undefined,
          `${recheckedResult.roomName ?? 'Room'}: ${recheckedResult.rateCurrency} ${recheckedResult.rateAmount?.toFixed(2)} total.`,
          'The supplier currently reports this rate as available, but no reservation has been made and availability can still change.',
          'This is a stay request boundary only. Final booking and payment remain disabled until provider and commercial approval is complete.',
        ].filter((line): line is string => typeof line === 'string').join('\n'),
      };
    }

    return undefined;
  }

  private buildPriceChangedResult(
    criteria: HotelSearchCriteria,
    selectedHotel: HotelBrowseResult | undefined,
    outcome: RateRecheckOutcome
  ): HotelSearchFlowResult {
    const oldRate = outcome.originalRate;
    const newRate = outcome.result!.rate;
    return {
      status: 'provider_not_connected',
      criteria,
      reply: [
        `The supplier changed the rate for ${selectedHotel?.name ?? 'this stay'} during recheck.`,
        `Previously returned: ${oldRate.currency} ${oldRate.cost.supplierNet.amount.toFixed(2)} total.`,
        `Rechecked rate: ${newRate.currency} ${newRate.cost.supplierNet.amount.toFixed(2)} total.`,
        'No stay was booked or charged. Please review the changed price before making a new stay request.',
      ].join('\n'),
    };
  }

  private async auditIgnoredUnregisteredSupplierHotels(
    inventory: HotelSupplierOrchestrationResult,
    verifiedMatches: VerifiedHotelMatch[],
    correlationId: string
  ): Promise<void> {
    const verifiedHotelIds = new Set(verifiedMatches.map((match) => match.hotel.yanaHotelId));
    const auditRecords: RejectedHotelInventoryAuditRecord[] = [];
    for (const hotel of inventory.hotels) {
      if (verifiedHotelIds.has(hotel.yanaHotelId)) continue;
      const rates = inventory.rates.filter((rate) => rate.yanaHotelId === hotel.yanaHotelId);
      if (this.supplierAttributionLoggingEnabled) {
        console.info('[HotelSearchFlow] supplier_hotel_ignored_unregistered', {
          correlationId,
          reason: 'no_eligible_sltda_match',
          yanaHotelId: hotel.yanaHotelId,
          hotelName: hotel.name,
          destination: hotel.destination,
          suppliers: [...new Set(rates.map((rate) => rate.supplier))],
          supplierHotelIds: [...new Set(rates.map((rate) => rate.supplierHotelId))],
          ignoredRateCount: rates.length,
          ignoredRates: rates.slice(0, 20).map((rate) => ({
            supplier: rate.supplier,
            roomName: rate.roomName,
            amount: rate.cost.supplierNet.amount,
            currency: rate.currency,
            available: rate.available,
            bookable: rate.bookable,
          })),
        });
      }
      if (rates.length === 0) {
        auditRecords.push({
          correlationId, rejectionReason: 'no_eligible_sltda_match',
          yanaHotelId: hotel.yanaHotelId, hotelName: hotel.name,
          destination: hotel.destination,
        });
      } else {
        auditRecords.push(...rates.map((rate) => ({
          correlationId,
          rejectionReason: 'no_eligible_sltda_match' as const,
          yanaHotelId: hotel.yanaHotelId,
          hotelName: hotel.name,
          destination: hotel.destination,
          supplier: rate.supplier,
          supplierHotelId: rate.supplierHotelId,
          roomName: rate.roomName,
          returnedAmount: rate.cost.supplierNet.amount,
          currency: rate.currency,
          available: rate.available,
          bookable: rate.bookable,
          sanitizedDetails: {
            mealPlan: rate.mealPlan,
            refundable: rate.cancellationPolicy.refundable,
            priceBasis: rate.priceBasis,
          },
        })));
      }
    }
    if (this.rejectedInventoryAuditEnabled && this.rejectedInventoryAuditWriter && auditRecords.length) {
      try {
        await this.rejectedInventoryAuditWriter.write(auditRecords);
      } catch (error) {
        logSafeOperatorFailure(console, 'rejected_inventory_audit_write_failed', correlationId, error, {
          rejectedRecords: auditRecords.length,
        });
      }
    }
  }

  private toInventoryBrowseResponse(
    inventory: HotelSupplierOrchestrationResult,
    criteria: HotelSearchCriteria,
    maxResults: number,
    verifiedMatches: VerifiedHotelMatch[] = [],
    selectedHotel?: HotelBrowseResult
  ): HotelBrowseResponse {
    const hotels = new Map(inventory.hotels.map((hotel) => [hotel.yanaHotelId, hotel]));
    const verified = new Map(verifiedMatches.map((match) => [match.hotel.yanaHotelId, match]));
    const requireVerified = this.sltdaRegistryConfigured && env.sltdaRegistry.requireVerifiedHotels;
    const nights = calculateNights(criteria.checkinDate!, criteria.checkoutDate!);
    const maximumTotal = criteria.budgetPerNight
      ? criteria.budgetPerNight.amount * nights * (criteria.rooms ?? 1)
      : undefined;
    const results = inventory.rates
      .filter((rate) => rate.available && rate.bookable)
      .filter((rate) => !requireVerified || verified.has(rate.yanaHotelId))
      .filter((rate) => {
        if (!selectedHotel) return true;
        const match = verified.get(rate.yanaHotelId);
        const selectedPlaceId = selectedHotel.googlePlaceId ?? selectedHotel.id;
        const matchedPlaceId = match?.google?.googlePlaceId ?? match?.google?.id;
        if (selectedPlaceId && matchedPlaceId) return matchedPlaceId === selectedPlaceId;
        return normalizeHotelIdentity(hotels.get(rate.yanaHotelId)?.name ?? '') ===
          normalizeHotelIdentity(selectedHotel.name);
      })
      .filter(
        (rate) =>
          maximumTotal === undefined ||
          rate.currency !== criteria.budgetPerNight?.currency ||
          rate.cost.supplierNet.amount <= maximumTotal
      )
      .map((rate): HotelBrowseResult => {
        const hotel = hotels.get(rate.yanaHotelId);
        const match = verified.get(rate.yanaHotelId);
        return {
          id: `${rate.yanaHotelId}:${rate.yanaRoomId}`,
          googlePlaceId: match?.google?.googlePlaceId ?? match?.google?.id,
          name: match?.google?.name ?? hotel?.name ?? 'Hotel option',
          address: match?.google?.address ?? hotel?.address ?? hotel?.destination,
          rating: match?.google?.rating ?? hotel?.starRating,
          reviewCount: match?.google?.reviewCount,
          googleMapsUri: match?.google?.googleMapsUri,
          thumbnailUrl: match?.google?.thumbnailUrl,
          roomName: rate.roomName,
          mealPlan: rate.mealPlan,
          refundable: rate.cancellationPolicy.refundable,
          rateAmount: rate.cost.supplierNet.amount,
          rateCurrency: rate.currency,
          priceBasis: rate.priceBasis,
          priceRange: `${rate.currency} ${rate.cost.supplierNet.amount.toFixed(2)} total`,
          sltdaVerified: Boolean(match),
          sltdaLicenceValidUntil: match?.registry.licenceValidUntil,
        };
      })
      .sort((left, right) => {
        if (left.sltdaVerified !== right.sltdaVerified) return left.sltdaVerified ? -1 : 1;
        const leftBudget = left.rateAmount ?? Number.POSITIVE_INFINITY;
        const rightBudget = right.rateAmount ?? Number.POSITIVE_INFINITY;
        return leftBudget - rightBudget || (right.rating ?? 0) - (left.rating ?? 0);
      })
      .slice(0, maxResults);

    return { provider: 'hotel_inventory', results };
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
    return `Perfect, I have the hotel search details: ${this.formatCriteria(criteria)}. I cannot complete the hotel check at this moment, but I have saved the request. Please send "search again" in a moment and I will retry.`;
  }

  private buildBrowseResultsReply(
    criteria: HotelSearchCriteria,
    results: HotelBrowseResult[],
    pagination: { nextOffset: number; totalResults: number }
  ): string {
    const hasMore = pagination.nextOffset < pagination.totalResults;
    const lines = [
      `I found these hotel matches for ${this.formatCriteria(criteria)}.`,
      results.some((result) => result.rateAmount !== undefined)
        ? 'These are live returned room rates. Final price and availability must be rechecked before booking.'
        : 'Price range is estimated where available. Please confirm live rates and availability before booking.',
      '',
      ...results.map((hotel, index) => {
        const rating =
          typeof hotel.rating === 'number'
            ? ` - ${hotel.rating.toFixed(1)}/5${hotel.reviewCount ? ` (${hotel.reviewCount} reviews)` : ''}`
            : '';
        const price = hotel.priceRange
          ? `\n${hotel.rateAmount !== undefined ? 'Returned total' : 'Price signal'}: ${hotel.priceRange}`
          : '';
        const address = hotel.address ? `\n${hotel.address}` : '';
        const room = hotel.roomName ? `\nRoom: ${hotel.roomName}` : '';
        const meal = hotel.mealPlan ? `\nMeal plan: ${formatMealPlan(hotel.mealPlan)}` : '';
        const cancellation =
          hotel.refundable === undefined
            ? ''
            : `\nCancellation: ${hotel.refundable ? 'Refundable' : 'Non-refundable'}`;
        const verification = hotel.sltdaVerified
          ? `\nSri Lanka Tourism registration: Verified${hotel.sltdaLicenceValidUntil ? ` (licence valid to ${hotel.sltdaLicenceValidUntil})` : ''}`
          : '';

        return `${index + 1}. ${hotel.name}${rating}${verification}${room}${meal}${cancellation}${price}${address}\nReply "book ${index + 1}" to request this stay, or "details ${index + 1}".`;
      }),
      '',
      hasMore
        ? 'Reply "next" to see the next 3 suggestions, "details 1", or "book 1" to request a stay.'
        : 'Which stay would you like me to request? Reply book 1, book 2, or book 3 from the latest list.',
    ];

    return lines.join('\n');
  }

  private buildProviderFailureReply(toolResult: ToolCallResult): string {
    if (toolResult.error?.category === ErrorCategory.SCHEMA_ERROR) {
      return 'I could not run the hotel search safely with those details. Your request is saved; please review the dates and guest details, then try again.';
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

function formatMealPlan(mealPlan: string): string {
  return mealPlan.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function calculateNights(checkIn: string, checkOut: string): number {
  const milliseconds = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.max(1, Math.round(milliseconds / 86_400_000));
}

function normalizeHotelIdentity(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function findInventoryRate(
  rates: NormalizedHotelRate[],
  displayedResult: HotelBrowseResult
): NormalizedHotelRate | undefined {
  return rates.find((rate) =>
    displayedResult.id === `${rate.yanaHotelId}:${rate.yanaRoomId}` &&
    displayedResult.rateCurrency === rate.currency &&
    displayedResult.rateAmount === rate.cost.supplierNet.amount
  );
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
