import { describe, expect, it, vi } from 'vitest';
import { createHotelPurchaseProof } from './HotelPurchaseProofService.js';
import type { NormalizedHotelRate } from './types.js';

describe('HotelPurchaseProofService', () => {
  it('selects the cheapest comparable rate, applies 15% markup, and creates a mock link', async () => {
    const cheap = rate('cheap', 100);
    const expensive = rate('expensive', 120);
    const recheck = vi.fn(async (selected: NormalizedHotelRate) => ({
      supplier: selected.supplier,
      supplierRateId: selected.supplierRateId,
      available: true,
      rate: selected,
      prebookToken: 'mock-token',
    }));

    const result = await createHotelPurchaseProof({
      rates: [expensive, cheap],
      correlationId: 'corr-proof',
      expiresAt: '2026-09-23T16:00:00.000Z',
    }, recheck);

    expect(result.supplierRateId).toBe('cheap');
    expect(result.acquisitionCost).toBe(100);
    expect(result.sellingPrice).toBe(115);
    expect(result.markupPercent).toBe(15);
    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.test\.yana\.local\/mock\/[a-f0-9]{24}$/);
    expect(result.mode).toBe('mock');
    expect(recheck).toHaveBeenCalledOnce();
  });

  it('fails closed when the mock recheck is unavailable', async () => {
    await expect(createHotelPurchaseProof({
      rates: [rate('cheap', 100)],
      correlationId: 'corr-proof',
      expiresAt: '2026-09-23T16:00:00.000Z',
    }, async (selected) => ({
      supplier: selected.supplier,
      supplierRateId: selected.supplierRateId,
      available: false,
      rate: { ...selected, available: false },
    }))).rejects.toThrow('unavailable');
  });
});

function rate(supplierRateId: string, amount: number): NormalizedHotelRate {
  return {
    yanaHotelId: 'hotel-1', yanaRoomId: 'room-1', supplier: 'liteapi', supplierHotelId: 'supplier-hotel',
    supplierRateId, checkIn: '2026-10-01', checkOut: '2026-10-03',
    occupancy: { adults: 2, children: 0, rooms: 1 }, roomName: 'Deluxe room', normalizedRoomType: 'DELUXE',
    importantRoomAttributes: [], mealPlan: 'BREAKFAST', cancellationPolicy: { refundable: true, penalties: [], normalizedCode: 'REF' },
    paymentType: 'PREPAID', taxesIncluded: true, feesIncluded: true,
    cost: { supplierNet: { amount, currency: 'USD' }, mandatoryTaxes: { amount: 0, currency: 'USD' }, mandatoryFees: { amount: 0, currency: 'USD' }, paymentProcessing: { amount: 0, currency: 'USD' }, fxConversion: { amount: 0, currency: 'USD' }, supplierBookingFees: { amount: 0, currency: 'USD' }, otherUnavoidableCosts: { amount: 0, currency: 'USD' } },
    priceBasis: 'NET', currency: 'USD', available: true, bookable: true,
    commercialCapabilities: { supportsNetRates: true, supportsMarkup: true, supportsDiscount: false, supportsPublicDisplay: true, requiresClosedUserGroup: false, requiresRedirect: false, supportsOnlineBooking: true },
  };
}
