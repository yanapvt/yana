import { describe, expect, it, vi } from 'vitest';
import type { HotelSupplierProviderConfig } from '../../config/hotelSuppliers.js';
import type { HotelSupplierAdapter } from './HotelSupplierAdapter.js';
import { HotelSupplierOrchestrator } from './HotelSupplierOrchestrator.js';
import type {
  HotelSearchRequest,
  NormalizedHotelRate,
  SupplierCommercialCapabilities,
  SupplierHotelSearchResult,
  SupplierId,
} from './types.js';

const capabilities: SupplierCommercialCapabilities = {
  supportsNetRates: true,
  supportsMarkup: true,
  supportsDiscount: true,
  supportsPublicDisplay: true,
  requiresClosedUserGroup: false,
  requiresRedirect: false,
  supportsOnlineBooking: true,
};

const request: HotelSearchRequest = {
  destination: 'Bentota',
  checkIn: '2026-09-20',
  checkOut: '2026-09-23',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'USD',
  correlationId: 'corr-supplier-test',
};

function config(
  supplier: SupplierId,
  overrides: Partial<HotelSupplierProviderConfig> = {}
): HotelSupplierProviderConfig {
  return {
    supplier,
    enabled: true,
    priority: 1,
    baseUrl: 'https://supplier.example.test',
    apiKey: 'test-key',
    timeoutMs: 100,
    maxRetries: 0,
    retryDelayMs: 0,
    circuitFailureThreshold: 3,
    circuitCooldownMs: 60_000,
    rateLimitPerMinute: 60,
    ...overrides,
  };
}

function result(supplier: SupplierId): SupplierHotelSearchResult {
  return { supplier, hotels: [], rates: [], partial: false, warnings: [] };
}

function adapter(
  supplier: SupplierId,
  searchHotels: HotelSupplierAdapter['searchHotels'],
  recheckRate: HotelSupplierAdapter['recheckRate'] = vi.fn()
): HotelSupplierAdapter {
  return {
    supplier,
    capabilities,
    searchHotels,
    getHotelDetails: vi.fn(),
    getRates: vi.fn(),
    recheckRate,
    prebook: vi.fn(),
    book: vi.fn(),
    cancelBooking: vi.fn(),
    getBooking: vi.fn(),
  };
}

function rate(overrides: Partial<NormalizedHotelRate> = {}): NormalizedHotelRate {
  return {
    yanaHotelId: 'yana-hotel-1',
    yanaRoomId: 'yana-room-1',
    supplier: 'liteapi',
    supplierHotelId: 'supplier-hotel-1',
    supplierRateId: 'sensitive-rate-token',
    checkIn: '2026-09-20',
    checkOut: '2026-09-23',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    roomName: 'Deluxe Room',
    normalizedRoomType: 'deluxe',
    importantRoomAttributes: [],
    mealPlan: 'BREAKFAST',
    cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'FREE' },
    paymentType: 'PREPAID',
    taxesIncluded: true,
    feesIncluded: true,
    cost: {
      supplierNet: { amount: 300, currency: 'USD' },
      mandatoryTaxes: { amount: 0, currency: 'USD' },
      mandatoryFees: { amount: 0, currency: 'USD' },
      paymentProcessing: { amount: 0, currency: 'USD' },
      fxConversion: { amount: 0, currency: 'USD' },
      supplierBookingFees: { amount: 0, currency: 'USD' },
      otherUnavoidableCosts: { amount: 0, currency: 'USD' },
    },
    priceBasis: 'NET',
    currency: 'USD',
    available: true,
    bookable: true,
    commercialCapabilities: capabilities,
    ...overrides,
  };
}

const silentLogger = { info: vi.fn(), warn: vi.fn() };

describe('HotelSupplierOrchestrator', () => {
  it('starts enabled supplier requests concurrently', async () => {
    const started: string[] = [];
    const resolvers: Array<() => void> = [];
    const buildSearch = (supplier: SupplierId) => async () => {
      started.push(supplier);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return result(supplier);
    };
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi'), config('hotelbeds', { priority: 2 })],
      [adapter('liteapi', buildSearch('liteapi')), adapter('hotelbeds', buildSearch('hotelbeds'))],
      silentLogger
    );

    const pending = orchestrator.searchHotels(request);
    await vi.waitFor(() => expect(started).toEqual(['liteapi', 'hotelbeds']));
    resolvers.forEach((resolve) => resolve());
    const response = await pending;

    expect(response.outcomes.map((outcome) => outcome.status)).toEqual(['success', 'success']);
  });

  it('returns successful suppliers when another supplier fails', async () => {
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi'), config('hotelbeds', { priority: 2 })],
      [
        adapter('liteapi', async () => result('liteapi')),
        adapter('hotelbeds', async () => {
          throw new Error('HBX unavailable');
        }),
      ],
      silentLogger
    );
    const response = await orchestrator.searchHotels(request);

    expect(response.partialFailure).toBe(true);
    expect(response.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supplier: 'liteapi', status: 'success' }),
        expect.objectContaining({ supplier: 'hotelbeds', status: 'failed', error: 'supplier_search_provider_outage' }),
      ])
    );
  });

  it('retries according to supplier policy', async () => {
    const search = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(result('liteapi'));
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi', { maxRetries: 1 })],
      [adapter('liteapi', search)],
      silentLogger
    );
    const response = await orchestrator.searchHotels(request);

    expect(search).toHaveBeenCalledTimes(2);
    expect(response.outcomes[0]).toMatchObject({ status: 'success', attempts: 2 });
  });

  it('times out and aborts a slow supplier request', async () => {
    let aborted = false;
    const search = vi.fn(async (supplierRequest: HotelSearchRequest) => {
      await new Promise<void>((_resolve, reject) => {
        supplierRequest.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
      return result('liteapi');
    });
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi', { timeoutMs: 5 })],
      [adapter('liteapi', search)],
      silentLogger
    );
    const response = await orchestrator.searchHotels(request);

    expect(aborted).toBe(true);
    expect(response.outcomes[0]).toMatchObject({ status: 'timeout', attempts: 1 });
  });

  it('opens the circuit after the configured failure threshold', async () => {
    const search = vi.fn().mockRejectedValue(new Error('supplier down'));
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi', { circuitFailureThreshold: 1 })],
      [adapter('liteapi', search)],
      silentLogger
    );

    expect((await orchestrator.searchHotels(request)).outcomes[0].status).toBe('failed');
    expect((await orchestrator.searchHotels(request)).outcomes[0].status).toBe('circuit_open');
    expect(search).toHaveBeenCalledTimes(1);
    expect(orchestrator.getHealth()[0]).toMatchObject({ circuit: 'open', consecutiveFailures: 1 });
  });

  it('enforces the supplier request rate limit', async () => {
    const search = vi.fn().mockResolvedValue(result('liteapi'));
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi', { rateLimitPerMinute: 1 })],
      [adapter('liteapi', search)],
      silentLogger
    );

    expect((await orchestrator.searchHotels(request)).outcomes[0].status).toBe('success');
    expect((await orchestrator.searchHotels(request)).outcomes[0].status).toBe('rate_limited');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('reports disabled and unregistered suppliers without calling them', async () => {
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi', { enabled: false }), config('hotelbeds', { priority: 2 })],
      [],
      silentLogger
    );
    const response = await orchestrator.searchHotels(request);

    expect(response.outcomes.map((outcome) => outcome.status)).toEqual([
      'disabled',
      'not_registered',
    ]);
  });

  it('fails closed when rate recheck is disabled or the adapter is not registered', async () => {
    const selectedRate = rate();
    const disabled = new HotelSupplierOrchestrator(
      [config('liteapi', { enabled: false })],
      [adapter('liteapi', async () => result('liteapi'))],
      silentLogger
    );
    const unregistered = new HotelSupplierOrchestrator(
      [config('liteapi')],
      [],
      silentLogger
    );

    expect((await disabled.recheckRate(selectedRate, 'corr-disabled')).status).toBe('disabled');
    expect((await unregistered.recheckRate(selectedRate, 'corr-unregistered')).status).toBe('not_registered');
  });

  it.each([
    { name: 'unchanged', amount: 300, available: true, bookable: true, expected: 'success' },
    { name: 'price change', amount: 340, available: true, bookable: true, expected: 'price_changed' },
    { name: 'unavailable', amount: 300, available: false, bookable: false, expected: 'unavailable' },
  ])('classifies a $name rate recheck', async ({ amount, available, bookable, expected }) => {
    const selectedRate = rate();
    const refreshedRate = rate({
      available,
      bookable,
      cost: {
        ...selectedRate.cost,
        supplierNet: { amount, currency: 'USD' },
      },
    });
    const recheck = vi.fn().mockResolvedValue({
      supplier: 'liteapi',
      supplierRateId: 'refreshed-sensitive-token',
      available,
      rate: refreshedRate,
      prebookToken: 'sensitive-prebook-token',
    });
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi')],
      [adapter('liteapi', async () => result('liteapi'), recheck)],
      silentLogger
    );

    expect((await orchestrator.recheckRate(selectedRate, 'corr-recheck')).status).toBe(expected);
    expect(recheck).toHaveBeenCalledWith(selectedRate, 'corr-recheck');
  });

  it('returns a sanitized failure outcome when a supplier recheck fails', async () => {
    const selectedRate = rate();
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi')],
      [adapter('liteapi', async () => result('liteapi'), vi.fn().mockRejectedValue(new Error('prebook unavailable')))],
      silentLogger
    );

    const outcome = await orchestrator.recheckRate(selectedRate, 'corr-recheck-failed');

    expect(outcome).toMatchObject({ status: 'failed', error: 'supplier_rate_recheck_provider_outage' });
    expect(JSON.stringify(silentLogger.warn.mock.calls.at(-1))).not.toContain('sensitive-rate-token');
  });

  it('logs internal rate attribution without exposing the supplier offer token', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const rate = {
      supplier: 'liteapi',
      supplierHotelId: 'supplier-hotel-1',
      supplierRateId: 'sensitive-offer-token',
      searchId: 'supplier-search-1',
      yanaHotelId: 'yana-hotel-1',
      yanaRoomId: 'yana-room-1',
      roomName: 'Deluxe Room',
      mealPlan: 'BREAKFAST',
      priceBasis: 'RETAIL',
      currency: 'USD',
    } as NormalizedHotelRate;
    const orchestrator = new HotelSupplierOrchestrator(
      [config('liteapi')],
      [adapter('liteapi', async () => ({ ...result('liteapi'), rates: [rate] }))],
      logger,
      undefined,
      true
    );

    await orchestrator.searchHotels(request);

    const attribution = logger.info.mock.calls.find(
      ([event]) => event === 'supplier_rate_attributed'
    );
    expect(attribution?.[1]).toMatchObject({
      supplier: 'liteapi',
      yanaHotelId: 'yana-hotel-1',
      yanaRoomId: 'yana-room-1',
      supplierHotelId: 'supplier-hotel-1',
      roomName: 'Deluxe Room',
    });
    expect(attribution?.[1]).not.toHaveProperty('supplierRateId');
    expect(JSON.stringify(attribution?.[1])).not.toContain('sensitive-offer-token');
  });
});
