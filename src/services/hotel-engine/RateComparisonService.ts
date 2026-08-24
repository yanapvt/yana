import { assertMoney, money } from './money.js';
import type { Money, NormalizedHotelRate, RateCostComponents } from './types.js';

export interface AcquisitionCostCalculation {
  total: Money;
  components: RateCostComponents;
}

export function calculateTrueAcquisitionCost(
  rate: NormalizedHotelRate
): AcquisitionCostCalculation {
  const components = rate.cost;
  const currency = rate.currency;
  const values = Object.values(components);

  values.forEach((value) => assertMoney(value, currency));

  return {
    total: money(
      values.reduce((total, component) => total + component.amount, 0),
      currency
    ),
    components: { ...components },
  };
}

export function createComparableRateKey(rate: NormalizedHotelRate): string {
  return JSON.stringify({
    hotel: rate.yanaHotelId,
    room: rate.yanaRoomId,
    roomType: normalizeText(rate.normalizedRoomType),
    roomAttributes: [...rate.importantRoomAttributes].map(normalizeText).sort(),
    checkIn: rate.checkIn,
    checkOut: rate.checkOut,
    occupancy: {
      adults: rate.occupancy.adults,
      children: rate.occupancy.children,
      rooms: rate.occupancy.rooms,
      childAges: [...(rate.occupancy.childAges ?? [])].sort((a, b) => a - b),
    },
    mealPlan: rate.mealPlan,
    refundable: rate.cancellationPolicy.refundable,
    cancellation: rate.cancellationPolicy.normalizedCode,
    paymentType: rate.paymentType,
    taxesIncluded: rate.taxesIncluded,
    feesIncluded: rate.feesIncluded,
    currency: rate.currency,
  });
}

export function areRatesComparable(
  left: NormalizedHotelRate,
  right: NormalizedHotelRate
): boolean {
  return createComparableRateKey(left) === createComparableRateKey(right);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
