import { describe, expect, it, vi } from 'vitest';
import type { HotelSupplierProviderConfig } from '../../config/hotelSuppliers.js';
import type { HotelSupplierAdapter } from './HotelSupplierAdapter.js';
import { HotelSupplierOrchestrator } from './HotelSupplierOrchestrator.js';
import type {
  HotelSearchRequest,
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
  searchHotels: HotelSupplierAdapter['searchHotels']
): HotelSupplierAdapter {
  return {
    supplier,
    capabilities,
    searchHotels,
    getHotelDetails: vi.fn(),
    getRates: vi.fn(),
    recheckRate: vi.fn(),
    prebook: vi.fn(),
    book: vi.fn(),
    cancelBooking: vi.fn(),
    getBooking: vi.fn(),
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
        expect.objectContaining({ supplier: 'hotelbeds', status: 'failed', error: 'HBX unavailable' }),
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
});
