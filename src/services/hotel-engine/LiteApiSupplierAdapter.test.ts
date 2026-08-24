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
    })).rejects.toThrow('LiteAPI request failed with 401: unauthorized');
  });
});
