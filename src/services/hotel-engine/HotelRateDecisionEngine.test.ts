import { describe, expect, it } from 'vitest';
import { HotelRateDecisionEngine } from './HotelRateDecisionEngine.js';
import { areRatesComparable, calculateTrueAcquisitionCost } from './RateComparisonService.js';
import { applyPercentage, calculateYanaSellingPrice } from './PricingEngine.js';
import { money } from './money.js';
import type { NormalizedHotelRate, SupplierCommercialCapabilities } from './types.js';

const capabilities: SupplierCommercialCapabilities = {
  supportsNetRates: true,
  supportsMarkup: true,
  supportsDiscount: true,
  supportsPublicDisplay: true,
  requiresClosedUserGroup: false,
  requiresRedirect: false,
  supportsOnlineBooking: true,
};

const pricing = {
  defaultPercent: 15,
  minimumPercent: 5,
  maximumPercent: 15,
  percentageMode: 'MARKUP' as const,
};

function buildRate(
  supplier: string,
  net: number,
  overrides: Partial<NormalizedHotelRate> = {}
): NormalizedHotelRate {
  const currency = 'USD';
  return {
    yanaHotelId: 'yana-hotel-1',
    yanaRoomId: 'yana-room-deluxe-ocean',
    supplier,
    supplierHotelId: `${supplier}-hotel-1`,
    supplierRateId: `${supplier}-rate-1`,
    checkIn: '2026-09-20',
    checkOut: '2026-09-23',
    occupancy: { adults: 2, children: 1, rooms: 1, childAges: [7] },
    roomName: 'Deluxe Ocean View',
    normalizedRoomType: 'deluxe ocean view',
    importantRoomAttributes: ['ocean view', 'king bed'],
    mealPlan: 'BREAKFAST',
    cancellationPolicy: {
      refundable: true,
      freeCancellationUntil: '2026-09-18T00:00:00Z',
      penalties: [],
      normalizedCode: 'FREE_UNTIL_2026-09-18',
    },
    paymentType: 'PREPAID',
    taxesIncluded: true,
    feesIncluded: true,
    cost: {
      supplierNet: money(net, currency),
      mandatoryTaxes: money(10, currency),
      mandatoryFees: money(2, currency),
      paymentProcessing: money(3, currency),
      fxConversion: money(1, currency),
      supplierBookingFees: money(4, currency),
      otherUnavoidableCosts: money(0, currency),
    },
    priceBasis: 'NET',
    currency,
    available: true,
    bookable: true,
    expiresAt: '2026-09-01T00:00:00Z',
    commercialCapabilities: capabilities,
    ...overrides,
  };
}

describe('hotel rate decision domain', () => {
  it('calculates true acquisition cost from auditable components', () => {
    const calculation = calculateTrueAcquisitionCost(buildRate('liteapi', 80));
    expect(calculation.total).toEqual({ amount: 100, currency: 'USD' });
    expect(calculation.components.paymentProcessing.amount).toBe(3);
  });

  it('does not confuse 15 percent markup with 15 percent margin', () => {
    expect(applyPercentage(100, 15, 'MARKUP')).toBeCloseTo(115);
    expect(applyPercentage(100, 15, 'MARGIN')).toBeCloseTo(117.6470588);
  });

  it('does not compare different meal or cancellation conditions', () => {
    const breakfastRefundable = buildRate('liteapi', 80);
    const roomOnly = buildRate('hotelbeds', 70, { mealPlan: 'ROOM_ONLY' });
    const nonRefundable = buildRate('webbeds', 65, {
      cancellationPolicy: {
        refundable: false,
        penalties: [],
        normalizedCode: 'NON_REFUNDABLE',
      },
    });

    expect(areRatesComparable(breakfastRefundable, roomOnly)).toBe(false);
    expect(areRatesComparable(breakfastRefundable, nonRefundable)).toBe(false);
  });

  it('uses only a verified comparable reference price', () => {
    const rate = buildRate('liteapi', 80, {
      referencePrice: {
        price: money(130, 'USD'),
        source: 'supplier_public_rate',
        observedAt: '2026-08-24T00:00:00Z',
        comparableRate: true,
      },
    });
    const audit = calculateYanaSellingPrice(rate, pricing, {
      strategy: 'COMPETITIVE',
    });

    expect(audit.finalSellingPrice.amount).toBe(115);
    expect(audit.customerSaving?.amount).toBe(15);
    expect(audit.referenceSource).toBe('supplier_public_rate');
  });

  it('selects the cheapest final price among comparable bookable offers', () => {
    const decision = new HotelRateDecisionEngine().decide(
      [
        buildRate('liteapi', 90),
        buildRate('hotelbeds', 84),
        buildRate('webbeds', 80),
        buildRate('agoda', 82),
      ],
      pricing,
      { strategy: 'MAXIMUM_MARGIN' },
      new Date('2026-08-24T00:00:00Z')
    );

    expect(decision.groups).toHaveLength(1);
    expect(decision.groups[0].bestOffer.rate.supplier).toBe('webbeds');
  });

  it('keeps non-equivalent offers in separate decision groups', () => {
    const decision = new HotelRateDecisionEngine().decide(
      [
        buildRate('liteapi', 80),
        buildRate('hotelbeds', 60, { mealPlan: 'ROOM_ONLY' }),
      ],
      pricing,
      { strategy: 'MAXIMUM_MARGIN' },
      new Date('2026-08-24T00:00:00Z')
    );

    expect(decision.groups).toHaveLength(2);
  });

  it('rejects expired, unavailable, or commercially restricted offers', () => {
    const decision = new HotelRateDecisionEngine().decide(
      [
        buildRate('liteapi', 80, { expiresAt: '2026-08-23T00:00:00Z' }),
        buildRate('hotelbeds', 75, { available: false }),
        buildRate('webbeds', 70, {
          commercialCapabilities: { ...capabilities, supportsPublicDisplay: false },
        }),
      ],
      pricing,
      { strategy: 'MAXIMUM_MARGIN' },
      new Date('2026-08-24T00:00:00Z')
    );

    expect(decision.groups).toHaveLength(0);
    expect(decision.rejected.map((entry) => entry.reason)).toEqual([
      'Rate has expired',
      'Supplier hotelbeds rate is not currently bookable',
      'Supplier webbeds does not allow public rate display',
    ]);
  });
});
