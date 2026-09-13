import { describe, expect, it, vi } from 'vitest';
import { ErrorCategory, type ToolCallResult } from '../types/core.js';
import type { MCPInterface } from './MCPInterface.js';
import { HotelSearchFlowService } from './HotelSearchFlowService.js';
import type { ToolRegistry } from './ToolRegistry.js';

const completeCriteria = {
  location: 'Galle',
  checkinDate: '2026-06-12',
  checkoutDate: '2026-06-15',
  guests: 2,
  boardBasis: 'bnb' as const,
  budgetPerNight: {
    amount: 120,
    currency: 'USD',
  },
};

describe('HotelSearchFlowService', () => {
  it('returns provider-not-connected response when provider execution is disabled', async () => {
    const toolRegistry = {
      isToolAvailable: vi.fn().mockResolvedValue(false),
      registerTool: vi.fn(),
    } as unknown as ToolRegistry;
    const mcpInterface = {
      executeToolCall: vi.fn(),
    } as unknown as MCPInterface;

    const service = new HotelSearchFlowService({
      toolRegistry,
      mcpInterface,
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(false),
        searchHotels: vi.fn(),
      } as any,
      providerConfigured: false,
    });

    const result = await service.handleCompletedIntake(completeCriteria, {
      correlationId: 'corr-1',
    });

    expect(result.status).toBe('provider_not_connected');
    expect(result.reply).toContain('location Galle');
    expect(result.reply).toContain('I cannot complete the hotel check at this moment');
    expect(mcpInterface.executeToolCall).not.toHaveBeenCalled();
  });

  it('returns top browse links from Google Places when booking provider is disabled but browse search is configured', async () => {
    const browsingService = {
      isConfigured: vi.fn().mockReturnValue(true),
      searchHotels: vi.fn().mockResolvedValue({
        provider: 'google_places',
        results: [
          {
            name: 'Colombo Court Hotel',
            address: 'Colombo 03, Sri Lanka',
            rating: 4.3,
            reviewCount: 800,
            priceRange: '$$$',
            googleMapsUri: 'https://maps.google.com/?cid=1',
            thumbnailUrl: 'https://forms.yana.example/media/google-place-photo?name=places%2F1',
          },
          {
            name: 'Hotel MaRadha Colombo',
            address: 'Marine Drive, Colombo',
            rating: 4.4,
            reviewCount: 600,
            googleMapsUri: 'https://maps.google.com/?cid=2',
          },
          {
            name: 'Mandarina Colombo',
            address: 'Colombo 03, Sri Lanka',
            rating: 4.2,
            reviewCount: 1200,
            googleMapsUri: 'https://maps.google.com/?cid=3',
          },
          {
            name: 'Fourth Colombo Hotel',
            address: 'Colombo 03, Sri Lanka',
            rating: 4.1,
            reviewCount: 300,
            googleMapsUri: 'https://maps.google.com/?cid=4',
          },
        ],
      }),
    };
    const supplierOrchestrator = { searchHotels: vi.fn() };
    const registry = {
      findEligible: vi.fn().mockResolvedValue([{ id: 'registry-colombo' }]),
      matchGoogleResults: vi.fn().mockImplementation((results: unknown[]) => results.slice(0, 3)),
      matchHotels: vi.fn(),
    };

    const service = new HotelSearchFlowService({
      toolRegistry: {
        isToolAvailable: vi.fn().mockResolvedValue(false),
      } as unknown as ToolRegistry,
      mcpInterface: {
        executeToolCall: vi.fn(),
      } as unknown as MCPInterface,
      browsingService: browsingService as any,
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      sltdaRegistryConfigured: true,
      sltdaRegistryService: registry as any,
      providerConfigured: false,
    });

    const result = await service.handleCompletedIntake(
      {
        ...completeCriteria,
        location: 'Colombo 03',
        budgetPerNight: {
          amount: 50,
          currency: 'USD',
        },
      },
      { correlationId: 'corr-browse' }
    );

    expect(result.status).toBe('browse_results');
    expect(result.reply).toContain('Colombo Court Hotel');
    expect(result.reply).not.toContain('https://maps.google.com/?cid=1');
    expect(result.reply).not.toContain('Reply "next"');
    expect(result.reply).not.toContain('Thumbnail:');
    expect(result.browseResponse?.results[0].googleMapsUri).toBe('https://maps.google.com/?cid=1');
    expect(result.browseResponse?.results[0].thumbnailUrl).toBe(
      'https://forms.yana.example/media/google-place-photo?name=places%2F1'
    );
    expect(result.browseResponse?.results).toHaveLength(3);
    expect(result.reply).not.toContain('Fourth Colombo Hotel');
    expect(supplierOrchestrator.searchHotels).not.toHaveBeenCalled();
  });

  it('falls back to Google discovery results when the SLTDA filter removes every hotel', async () => {
    const googleHotel = {
      id: 'google-1',
      googlePlaceId: 'google-1',
      name: 'Colombo Discovery Hotel',
      address: 'Colombo',
      rating: 4.2,
      reviewCount: 200,
    };
    const service = new HotelSearchFlowService({
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(true),
        searchHotels: vi.fn().mockResolvedValue({ provider: 'google_places', results: [googleHotel] }),
      } as any,
      sltdaRegistryConfigured: true,
      sltdaRegistryService: {
        findEligible: vi.fn().mockResolvedValue([]),
        matchGoogleResults: vi.fn().mockReturnValue([]),
        matchHotels: vi.fn(),
      } as any,
      searchSettingsProvider: {
        getSettings: vi.fn().mockResolvedValue({
          sltdaFilterEnabled: true,
          zeroResultFallbackEnabled: true,
          minimumGoogleRating: null,
          minimumGoogleReviewCount: null,
        }),
      },
    });

    const result = await service.handleBrowseSearch(completeCriteria, { correlationId: 'fallback-1' });

    expect(result.status).toBe('browse_results');
    expect(result.browseResponse?.results).toEqual([googleHotel]);
    expect(result.reply).toContain('Colombo Discovery Hotel');
  });

  it('can disable SLTDA filtering while keeping registry enrichment active', async () => {
    const googleHotels = [
      { id: 'google-1', name: 'Registered Hotel', rating: 4.5 },
      { id: 'google-2', name: 'Discovery Hotel', rating: 4.1 },
    ];
    const service = new HotelSearchFlowService({
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(true),
        searchHotels: vi.fn().mockResolvedValue({ provider: 'google_places', results: googleHotels }),
      } as any,
      sltdaRegistryConfigured: true,
      sltdaRegistryService: {
        findEligible: vi.fn().mockResolvedValue([{ id: 'registry-1' }]),
        matchGoogleResults: vi.fn().mockReturnValue([{ ...googleHotels[0], sltdaVerified: true }]),
        matchHotels: vi.fn(),
      } as any,
      searchSettingsProvider: {
        getSettings: vi.fn().mockResolvedValue({
          sltdaFilterEnabled: false,
          zeroResultFallbackEnabled: true,
          minimumGoogleRating: null,
          minimumGoogleReviewCount: null,
        }),
      },
    });

    const result = await service.handleBrowseSearch(completeCriteria, { correlationId: 'filter-off' });

    expect(result.status).toBe('browse_results');
    expect(result.browseResponse?.results).toHaveLength(2);
    expect(result.browseResponse?.results.some((hotel) => hotel.name === 'Discovery Hotel')).toBe(true);
  });

  it('validates completed criteria before provider execution', async () => {
    const service = new HotelSearchFlowService({
      toolRegistry: {
        isToolAvailable: vi.fn(),
      } as unknown as ToolRegistry,
      mcpInterface: {
        executeToolCall: vi.fn(),
      } as unknown as MCPInterface,
      providerConfigured: true,
    });

    const result = await service.handleCompletedIntake(
      {
        ...completeCriteria,
        checkinDate: 'tomorrow',
      },
      { correlationId: 'corr-2' }
    );

    expect(result.status).toBe('validation_failed');
    expect(result.reply).toContain('valid check-in date');
  });

  it('does not execute the legacy live provider during completed-intake exploration', async () => {
    const toolRegistry = {
      isToolAvailable: vi.fn().mockResolvedValue(true),
      registerTool: vi.fn(),
    } as unknown as ToolRegistry;
    const successResult: ToolCallResult = {
      success: true,
      data: {
        results: [
          {
            name: 'Galle Face Hotel',
            price: 150,
            currency: 'USD',
            rating: 4.5,
            reviewCount: 1200,
            location: 'Galle',
            distance: 1.2,
            amenities: ['WiFi', 'Pool'],
            cancellationPolicy: 'Free cancellation',
            bookingToken: 'hotel-token-1',
          },
        ],
        totalResults: 1,
      },
      metadata: {
        toolName: 'search_hotels',
        executionTimeMs: 12,
        attemptNumber: 1,
        provider: 'mock_hotels',
        timestamp: new Date(),
      },
    };
    const mcpInterface = {
      executeToolCall: vi.fn().mockResolvedValue(successResult),
    } as unknown as MCPInterface;

    const service = new HotelSearchFlowService({
      toolRegistry,
      mcpInterface,
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(true),
        searchHotels: vi.fn().mockResolvedValue({
          provider: 'google_places', results: [{ name: 'Galle Face Hotel', address: 'Galle' }],
        }),
      } as any,
      providerConfigured: true,
    });

    const result = await service.handleCompletedIntake(completeCriteria, {
      correlationId: 'corr-3',
      sessionId: 'session-3',
      userId: 'user-3',
      userLanguage: 'en',
    });

    expect(result.status).toBe('browse_results');
    expect(mcpInterface.executeToolCall).not.toHaveBeenCalled();
    expect(result.reply).toContain('Galle Face Hotel');
  });

  it('ignores a legacy provider failure during Google exploration', async () => {
    const mcpInterface = {
      executeToolCall: vi.fn().mockResolvedValue({
        success: false,
        error: {
          category: ErrorCategory.PROVIDER_FAILURE,
          message: 'Provider timeout',
          retryable: false,
        },
        metadata: {
          toolName: 'search_hotels',
          executionTimeMs: 1,
          attemptNumber: 1,
          timestamp: new Date(),
        },
      } satisfies ToolCallResult),
    } as unknown as MCPInterface;

    const service = new HotelSearchFlowService({
      toolRegistry: {
        isToolAvailable: vi.fn().mockResolvedValue(true),
      } as unknown as ToolRegistry,
      mcpInterface,
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(true),
        searchHotels: vi.fn().mockResolvedValue({
          provider: 'google_places', results: [{ name: 'Explore Hotel', address: 'Galle' }],
        }),
      } as any,
      providerConfigured: true,
    });

    const result = await service.handleCompletedIntake(completeCriteria, {
      correlationId: 'corr-4',
    });

    expect(result.status).toBe('browse_results');
    expect(result.reply).toContain('Explore Hotel');
    expect(mcpInterface.executeToolCall).not.toHaveBeenCalled();
  });

  it('uses live supplier inventory only at booking check and keeps supplier tokens out of customer results', async () => {
    const supplierOrchestrator = {
      recheckRate: vi.fn(async (rate) => ({
        supplier: rate.supplier,
        status: 'success',
        originalRate: rate,
        result: { supplier: rate.supplier, supplierRateId: rate.supplierRateId, available: true, rate },
      })),
      searchHotels: vi.fn().mockResolvedValue({
        correlationId: 'corr-live-inventory',
        partialFailure: false,
        outcomes: [{ supplier: 'liteapi', status: 'success', attempts: 1, durationMs: 12 }],
        hotels: [
          {
            yanaHotelId: 'yana-hotel-1',
            name: 'Live Beach Hotel',
            destination: 'Galle',
            country: 'Sri Lanka',
            address: 'Galle Road',
            images: [],
            amenities: [],
            supplierReferences: [],
            rooms: [],
          },
        ],
        rates: [
          {
            yanaHotelId: 'yana-hotel-1',
            yanaRoomId: 'yana-room-1',
            supplier: 'liteapi',
            supplierHotelId: 'private-hotel-id',
            supplierRateId: 'private-offer-token',
            searchId: 'private-search-id',
            roomName: 'Ocean Deluxe',
            mealPlan: 'BREAKFAST',
            cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'FREE' },
            cost: { supplierNet: { amount: 240, currency: 'USD' } },
            priceBasis: 'RETAIL',
            currency: 'USD',
            available: true,
            bookable: true,
          },
        ],
      }),
    };
    const browsingService = {
      isConfigured: vi.fn().mockReturnValue(true),
      searchHotels: vi.fn(),
    };
    const service = new HotelSearchFlowService({
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      browsingService: browsingService as any,
      providerConfigured: false,
    });

    const result = await service.handleBookingCheck(
      completeCriteria,
      { name: 'Live Beach Hotel', address: 'Galle Road' },
      { correlationId: 'corr-live-inventory' }
    );

    expect(result.status).toBe('browse_results');
    expect(result.browseResponse?.provider).toBe('hotel_inventory');
    expect(result.reply).toContain('Ocean Deluxe');
    expect(result.reply).toContain('Ocean Deluxe: USD 240.00 total');
    expect(result.reply).toContain('no reservation has been made');
    expect(result.reply).not.toContain('liteapi');
    expect(JSON.stringify(result.browseResponse)).not.toContain('private-offer-token');
    expect(browsingService.searchHotels).not.toHaveBeenCalled();

    const completedResult = await service.handleBookingCheck(
      completeCriteria,
      { name: 'Live Beach Hotel', address: 'Galle Road' },
      { correlationId: 'corr-live-inventory-completed' }
    );
    expect(completedResult.browseResponse?.provider).toBe('hotel_inventory');
    expect(completedResult.reply).toContain('Ocean Deluxe');
    expect(completedResult.reply).not.toContain('liteapi');
  });

  it('falls back to another eligible supplier rate when the first recheck fails', async () => {
    const hotel = {
      yanaHotelId: 'yana-hotel-fallback', name: 'Fallback Hotel', destination: 'Galle',
      country: 'Sri Lanka', address: 'Galle Road', images: [], amenities: [],
      supplierReferences: [], rooms: [],
    };
    const makeRate = (supplier: string, roomId: string, token: string, amount: number) => ({
      yanaHotelId: hotel.yanaHotelId, yanaRoomId: roomId, supplier,
      supplierHotelId: `${supplier}-hotel`, supplierRateId: token,
      checkIn: completeCriteria.checkinDate, checkOut: completeCriteria.checkoutDate,
      occupancy: { adults: 2, children: 0, rooms: 1 }, roomName: `${supplier} room`,
      normalizedRoomType: 'standard', importantRoomAttributes: [], mealPlan: 'BREAKFAST',
      cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'FREE' },
      paymentType: 'PREPAID', taxesIncluded: true, feesIncluded: true,
      cost: { supplierNet: { amount, currency: 'USD' } }, priceBasis: 'RETAIL',
      currency: 'USD', available: true, bookable: true,
    });
    const firstRate = makeRate('liteapi', 'room-1', 'secret-first-rate', 200);
    const fallbackRate = makeRate('hotelbeds', 'room-2', 'secret-fallback-rate', 220);
    const supplierOrchestrator = {
      searchHotels: vi.fn().mockResolvedValue({
        correlationId: 'corr-recheck-fallback', partialFailure: false, outcomes: [],
        hotels: [hotel], rates: [firstRate, fallbackRate],
      }),
      recheckRate: vi.fn(async (rate) => rate.supplier === 'liteapi'
        ? { supplier: rate.supplier, status: 'failed', originalRate: rate, error: 'unavailable' }
        : {
            supplier: rate.supplier, status: 'success', originalRate: rate,
            result: { supplier: rate.supplier, supplierRateId: rate.supplierRateId, available: true, rate },
          }),
    };
    const service = new HotelSearchFlowService({
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      browsingService: { isConfigured: vi.fn().mockReturnValue(true), searchHotels: vi.fn() } as any,
      providerConfigured: false,
    });

    const result = await service.handleBookingCheck(
      completeCriteria,
      { name: hotel.name, address: hotel.address },
      { correlationId: 'corr-recheck-fallback' }
    );

    expect(supplierOrchestrator.recheckRate).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('browse_results');
    expect(result.reply).toContain('hotelbeds room: USD 220.00 total');
    expect(JSON.stringify(result)).not.toContain('secret-first-rate');
    expect(JSON.stringify(result)).not.toContain('secret-fallback-rate');
  });

  it.each([
    { recheckStatus: 'price_changed', refreshedAmount: 260, expected: 'changed the rate' },
    { recheckStatus: 'unavailable', refreshedAmount: 240, expected: 'none passed a fresh availability and price recheck' },
  ])('handles a $recheckStatus result without booking', async ({ recheckStatus, refreshedAmount, expected }) => {
    const hotel = {
      yanaHotelId: 'yana-hotel-recheck', name: 'Recheck Hotel', destination: 'Galle',
      country: 'Sri Lanka', address: 'Galle Road', images: [], amenities: [],
      supplierReferences: [], rooms: [],
    };
    const originalRate = {
      yanaHotelId: hotel.yanaHotelId, yanaRoomId: 'room-recheck', supplier: 'liteapi',
      supplierHotelId: 'supplier-hotel', supplierRateId: 'secret-original-token',
      checkIn: completeCriteria.checkinDate, checkOut: completeCriteria.checkoutDate,
      occupancy: { adults: 2, children: 0, rooms: 1 }, roomName: 'Ocean Room',
      normalizedRoomType: 'ocean', importantRoomAttributes: [], mealPlan: 'BREAKFAST',
      cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'FREE' },
      paymentType: 'PREPAID', taxesIncluded: true, feesIncluded: true,
      cost: { supplierNet: { amount: 240, currency: 'USD' } }, priceBasis: 'RETAIL',
      currency: 'USD', available: true, bookable: true,
    };
    const refreshedRate = {
      ...originalRate,
      supplierRateId: 'secret-refreshed-token',
      available: recheckStatus !== 'unavailable',
      bookable: recheckStatus !== 'unavailable',
      cost: { supplierNet: { amount: refreshedAmount, currency: 'USD' } },
    };
    const supplierOrchestrator = {
      searchHotels: vi.fn().mockResolvedValue({
        correlationId: 'corr-rate-change', partialFailure: false, outcomes: [],
        hotels: [hotel], rates: [originalRate],
      }),
      recheckRate: vi.fn().mockResolvedValue({
        supplier: 'liteapi', status: recheckStatus, originalRate,
        result: {
          supplier: 'liteapi', supplierRateId: refreshedRate.supplierRateId,
          available: refreshedRate.available, rate: refreshedRate,
          prebookToken: 'secret-prebook-token',
        },
      }),
    };
    const service = new HotelSearchFlowService({
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      browsingService: { isConfigured: vi.fn().mockReturnValue(true), searchHotels: vi.fn() } as any,
      providerConfigured: false,
    });

    const result = await service.handleBookingCheck(
      completeCriteria,
      { name: hotel.name, address: hotel.address },
      { correlationId: 'corr-rate-change' }
    );

    expect(result.status).toBe('provider_not_connected');
    expect(result.reply).toContain(expected);
    expect(result.reply).toContain('No stay was booked');
    expect(JSON.stringify(result)).not.toMatch(/secret-original-token|secret-refreshed-token|secret-prebook-token/);
  });

  it('does not call the live supplier when the enabled SLTDA gate has no eligible records', async () => {
    const supplierOrchestrator = { searchHotels: vi.fn() };
    const registry = {
      findEligible: vi.fn().mockResolvedValue([]),
      matchHotels: vi.fn(),
    };
    const service = new HotelSearchFlowService({
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      sltdaRegistryConfigured: true,
      sltdaRegistryService: registry as any,
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(false),
        searchHotels: vi.fn(),
      } as any,
      providerConfigured: false,
    });

    const result = await service.handleBookingCheck(
      completeCriteria,
      { id: 'google-selected', googlePlaceId: 'google-selected', name: 'Selected Hotel' },
      { correlationId: 'corr-no-registered-hotels' }
    );

    expect(result.status).toBe('provider_not_connected');
    expect(result.reply).toContain('have not requested live room rates');
    expect(supplierOrchestrator.searchHotels).not.toHaveBeenCalled();
  });

  it('merges verified registry, Google and live rates and removes over-budget totals', async () => {
    const hotel = {
      yanaHotelId: 'yana-hotel-verified',
      name: 'Registry Beach Hotel',
      destination: 'Galle',
      country: 'Sri Lanka',
      address: '10 Galle Road',
      images: [], amenities: [], supplierReferences: [], rooms: [],
    };
    const baseRate = {
      yanaHotelId: hotel.yanaHotelId,
      supplier: 'liteapi',
      supplierHotelId: 'supplier-hotel',
      searchId: 'supplier-search',
      mealPlan: 'BREAKFAST',
      cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'FREE' },
      priceBasis: 'RETAIL',
      currency: 'USD',
      available: true,
      bookable: true,
    };
    const supplierOrchestrator = {
      recheckRate: vi.fn(async (rate) => ({
        supplier: rate.supplier,
        status: 'success',
        originalRate: rate,
        result: { supplier: rate.supplier, supplierRateId: rate.supplierRateId, available: true, rate },
      })),
      searchHotels: vi.fn().mockResolvedValue({
        correlationId: 'corr-verified', partialFailure: false, outcomes: [], hotels: [hotel],
        rates: [
          { ...baseRate, yanaRoomId: 'room-budget', supplierRateId: 'private-1', roomName: 'Ocean Room', cost: { supplierNet: { amount: 300, currency: 'USD' } } },
          { ...baseRate, yanaRoomId: 'room-expensive', supplierRateId: 'private-2', roomName: 'Presidential Suite', cost: { supplierNet: { amount: 900, currency: 'USD' } } },
        ],
      }),
    };
    const record = {
      id: 'registry-verified', propertyName: hotel.name, normalizedName: 'registry beach hotel',
      registrationNumber: 'SLTDA-123', licenceValidUntil: '2026-12-31',
    };
    const google = { id: 'google-place-verified', googlePlaceId: 'google-place-verified', name: hotel.name, address: hotel.address, rating: 4.7, reviewCount: 500 };
    const registry = {
      findEligible: vi.fn().mockResolvedValue([record]),
      matchHotels: vi.fn().mockReturnValue([{ hotel, registry: record, google, confidence: 1 }]),
    };
    const service = new HotelSearchFlowService({
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      sltdaRegistryConfigured: true,
      sltdaRegistryService: registry as any,
      browsingService: {
        isConfigured: vi.fn().mockReturnValue(true),
        searchHotels: vi.fn().mockResolvedValue({ provider: 'google_places', results: [google] }),
      } as any,
      providerConfigured: false,
    });

    const result = await service.handleBookingCheck(
      completeCriteria,
      google,
      { correlationId: 'corr-verified' }
    );

    expect(supplierOrchestrator.searchHotels).toHaveBeenCalledOnce();
    expect(result.browseResponse?.results).toHaveLength(1);
    expect(result.reply).toContain('Sri Lanka Tourism registration: Verified');
    expect(result.reply).toContain('Ocean Room');
    expect(result.reply).not.toContain('Presidential Suite');
    expect(result.reply).not.toContain('liteapi');
    expect(result.browseResponse?.results[0].googlePlaceId).toBe('google-place-verified');
  });

  it('does not fall back to customer-visible unregistered results and logs ignored supplier inventory', async () => {
    const ignoredHotel = {
      yanaHotelId: 'yana-unregistered', name: 'Unregistered Supplier Hotel',
      destination: 'Galle', country: 'Sri Lanka', address: 'Galle Road',
      images: [], amenities: [], supplierReferences: [], rooms: [],
    };
    const supplierOrchestrator = {
      searchHotels: vi.fn().mockResolvedValue({
        correlationId: 'corr-unregistered', partialFailure: false, outcomes: [],
        hotels: [ignoredHotel],
        rates: [{
          yanaHotelId: ignoredHotel.yanaHotelId, yanaRoomId: 'room-ignored',
          supplier: 'liteapi', supplierHotelId: 'lite-hotel-1',
          supplierRateId: 'secret-rate-token', searchId: 'secret-search-token',
          roomName: 'Ignored Room', mealPlan: 'BREAKFAST',
          cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'FREE' },
          cost: { supplierNet: { amount: 250, currency: 'USD' } },
          priceBasis: 'RETAIL', currency: 'USD', available: true, bookable: true,
        }],
      }),
    };
    const browsingService = {
      isConfigured: vi.fn().mockReturnValue(true),
      searchHotels: vi.fn().mockResolvedValue({
        provider: 'google_places',
        results: [{ name: 'Unregistered Supplier Hotel', address: 'Galle Road' }],
      }),
    };
    const registry = {
      findEligible: vi.fn().mockResolvedValue([{
        id: 'another-registry-record', propertyName: 'Different Registered Hotel',
        normalizedName: 'different registered hotel', registrationNumber: 'REG-1',
      }]),
      matchHotels: vi.fn().mockReturnValue([]),
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const auditWriter = { write: vi.fn().mockResolvedValue(undefined) };
    const service = new HotelSearchFlowService({
      supplierConfigured: true,
      supplierOrchestrator: supplierOrchestrator as any,
      sltdaRegistryConfigured: true,
      sltdaRegistryService: registry as any,
      supplierAttributionLoggingEnabled: true,
      rejectedInventoryAuditEnabled: true,
      rejectedInventoryAuditWriter: auditWriter,
      browsingService: browsingService as any,
      providerConfigured: false,
    });

    const result = await service.handleBookingCheck(
      completeCriteria,
      { id: 'google-unregistered', googlePlaceId: 'google-unregistered', name: 'Unregistered Supplier Hotel', address: 'Galle Road' },
      { correlationId: 'corr-unregistered' }
    );

    expect(result.status).toBe('provider_not_connected');
    expect(result.reply).not.toContain('Unregistered Supplier Hotel');
    expect(result.reply).not.toContain('Ignored Room');
    expect(result.browseResponse).toBeUndefined();
    const ignoredLog = info.mock.calls.find(
      ([event]) => event === '[HotelSearchFlow] supplier_hotel_ignored_unregistered'
    );
    expect(ignoredLog?.[1]).toMatchObject({
      reason: 'no_eligible_sltda_match',
      hotelName: 'Unregistered Supplier Hotel',
      suppliers: ['liteapi'],
      ignoredRateCount: 1,
    });
    expect(JSON.stringify(ignoredLog)).not.toContain('secret-rate-token');
    expect(JSON.stringify(ignoredLog)).not.toContain('secret-search-token');
    expect(auditWriter.write).toHaveBeenCalledWith([
      expect.objectContaining({
        correlationId: 'corr-unregistered',
        rejectionReason: 'no_eligible_sltda_match',
        hotelName: 'Unregistered Supplier Hotel',
        supplier: 'liteapi',
        supplierHotelId: 'lite-hotel-1',
        roomName: 'Ignored Room',
        returnedAmount: 250,
        currency: 'USD',
      }),
    ]);
    expect(JSON.stringify(auditWriter.write.mock.calls)).not.toContain('secret-rate-token');
    expect(JSON.stringify(auditWriter.write.mock.calls)).not.toContain('secret-search-token');
    info.mockRestore();
  });
});
