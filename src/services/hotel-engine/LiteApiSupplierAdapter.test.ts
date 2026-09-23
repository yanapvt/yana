import { afterEach, describe, expect, it, vi } from 'vitest';
import { HotelRateDecisionEngine } from './HotelRateDecisionEngine.js';
import { LiteApiSupplierAdapter } from './LiteApiSupplierAdapter.js';

describe('LiteApiSupplierAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the documented rates request and normalizes hotels, rooms, and rates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            hotelId: 'lp19fec',
            roomTypes: [
              {
                offerId: 'offer-123',
                rates: [
                  {
                    name: 'Deluxe Ocean View',
                    mappedRoomId: 456,
                    boardName: 'Breakfast included',
                    retailRate: {
                      total: [{ amount: 412.76, currency: 'USD' }],
                      taxesAndFees: [{ amount: 20, currency: 'USD', included: true }],
                    },
                    cancellationPolicies: {
                      refundableTag: 'RFN',
                      cancelPolicyInfos: [{ cancelTime: '2026-09-18T00:00:00Z' }],
                    },
                  },
                ],
              },
            ],
          },
        ],
        hotels: [
          {
            id: 'lp19fec',
            name: 'Example Bentota Resort',
            address: 'Bentota Beach',
            city: 'Bentota',
            country: 'Sri Lanka',
            rating: 8.7,
            main_photo: 'https://images.example.test/hotel.jpg',
          },
        ],
        sandbox: true,
      }),
    } as Response);
    const adapter = new LiteApiSupplierAdapter({
      baseUrl: 'https://api.liteapi.travel/v3.0',
      apiKey: 'test-key',
      marginPercent: 15,
    });
    const response = await adapter.searchHotels({
      destination: 'Bentota, Sri Lanka',
      checkIn: '2026-09-20',
      checkOut: '2026-09-23',
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'USD',
      correlationId: 'corr-liteapi-test',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.liteapi.travel/v3.0/hotels/rates',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
      })
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      checkin: '2026-09-20',
      checkout: '2026-09-23',
      currency: 'USD',
      guestNationality: 'LK',
      occupancies: [{ adults: 2, children: [] }],
      aiSearch: 'hotels in Bentota, Sri Lanka',
      roomMapping: true,
      includeHotelData: true,
      sessionId: 'corr-liteapi-test',
      margin: 15,
    });
    expect(response.hotels[0]).toMatchObject({
      name: 'Example Bentota Resort',
      destination: 'Bentota',
    });
    expect(response.rates[0]).toMatchObject({
      supplierRateId: 'offer-123',
      roomName: 'Deluxe Ocean View',
      mealPlan: 'BREAKFAST',
      priceBasis: 'RETAIL',
      currency: 'USD',
      cancellationPolicy: { refundable: true },
    });
    expect(response.rates[0].cost.supplierNet.amount).toBe(412.76);
  });

  it('does not allow an unverified retail rate into acquisition-cost pricing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          hotelId: 'hotel-1',
          roomTypes: [{
            offerId: 'offer-1',
            rates: [{
              name: 'Room',
              boardName: 'Room Only',
              retailRate: { total: [{ amount: 100, currency: 'USD' }] },
            }],
          }],
        }],
      }),
    } as Response);
    const adapter = new LiteApiSupplierAdapter({ baseUrl: 'https://example.test', apiKey: 'key' });
    const search = await adapter.searchHotels({
      destination: 'Bentota',
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'USD',
      correlationId: 'corr-retail',
    });
    const decision = new HotelRateDecisionEngine().decide(
      search.rates,
      { defaultPercent: 15, minimumPercent: 5, maximumPercent: 15, percentageMode: 'MARKUP' },
      { strategy: 'MAXIMUM_MARGIN' },
      new Date('2026-08-24T00:00:00Z')
    );

    expect(decision.groups).toHaveLength(0);
    expect(decision.rejected[0].reason).toContain('does not expose a verified net acquisition price');
  });

  it('returns a credential-safe provider error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as Response);
    const adapter = new LiteApiSupplierAdapter({ baseUrl: 'https://example.test', apiKey: 'secret' });

    await expect(adapter.searchHotels({
      destination: 'Bentota',
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'USD',
      correlationId: 'corr-error',
    })).rejects.toThrow('LiteAPI request failed with status 401');
  });

  it('prebooks the selected offer against the booking host and returns a refreshed rate', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        prebookId: 'prebook-safe-id',
        data: { hotelId: 'hotel-1', roomTypes: [{ rates: [{
          name: 'Room', boardName: 'Breakfast', netRate: { total: [{ amount: 105, currency: 'USD' }] },
        }] }] },
      }),
    } as Response);
    const adapter = new LiteApiSupplierAdapter({
      baseUrl: 'https://api.liteapi.travel/v3.0', apiKey: 'test-key',
      capabilities: { supportsNetRates: true, supportsMarkup: true },
    });
    const original = normalizedRate();
    const result = await adapter.recheckRate(original, 'corr-prebook');

    expect(fetchMock).toHaveBeenCalledWith('https://book.liteapi.travel/v3.0/rates/prebook', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ offerId: 'offer-1', usePaymentSdk: false });
    expect(result).toMatchObject({ available: true, prebookToken: 'prebook-safe-id', rate: { cost: { supplierNet: { amount: 105 } } } });
  });
});

function normalizedRate() {
  return {
    yanaHotelId: 'hotel', yanaRoomId: 'room', supplier: 'liteapi' as const, supplierHotelId: 'hotel-1', supplierRateId: 'offer-1',
    checkIn: '2026-10-01', checkOut: '2026-10-02', occupancy: { adults: 2, children: 0, rooms: 1 }, roomName: 'Room', normalizedRoomType: 'room',
    importantRoomAttributes: [], mealPlan: 'BREAKFAST' as const, cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'REF' },
    paymentType: 'PREPAID' as const, taxesIncluded: true, feesIncluded: true,
    cost: { supplierNet: { amount: 100, currency: 'USD' }, mandatoryTaxes: { amount: 0, currency: 'USD' }, mandatoryFees: { amount: 0, currency: 'USD' }, paymentProcessing: { amount: 0, currency: 'USD' }, fxConversion: { amount: 0, currency: 'USD' }, supplierBookingFees: { amount: 0, currency: 'USD' }, otherUnavoidableCosts: { amount: 0, currency: 'USD' } },
    priceBasis: 'NET' as const, currency: 'USD', available: true, bookable: true,
    commercialCapabilities: { supportsNetRates: true, supportsMarkup: true, supportsDiscount: false, supportsPublicDisplay: true, requiresClosedUserGroup: false, requiresRedirect: false, supportsOnlineBooking: true },
  };
}
