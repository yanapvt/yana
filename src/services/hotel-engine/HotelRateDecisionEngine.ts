import { createComparableRateKey } from './RateComparisonService.js';
import {
  calculateYanaSellingPrice,
  type PriceAudit,
  type PricingConfiguration,
  type PricingContext,
} from './PricingEngine.js';
import type { NormalizedHotelRate } from './types.js';

export interface PricedHotelOffer {
  rate: NormalizedHotelRate;
  price: PriceAudit;
  comparisonKey: string;
}

export interface RejectedHotelOffer {
  rate: NormalizedHotelRate;
  reason: string;
}

export interface HotelRateDecision {
  groups: Array<{
    comparisonKey: string;
    offers: PricedHotelOffer[];
    bestOffer: PricedHotelOffer;
  }>;
  rejected: RejectedHotelOffer[];
}

export class HotelRateDecisionEngine {
  decide(
    rates: NormalizedHotelRate[],
    pricing: PricingConfiguration,
    context: PricingContext,
    now = new Date()
  ): HotelRateDecision {
    const accepted: PricedHotelOffer[] = [];
    const rejected: RejectedHotelOffer[] = [];

    for (const rate of rates) {
      if (rate.expiresAt && new Date(rate.expiresAt).getTime() <= now.getTime()) {
        rejected.push({ rate, reason: 'Rate has expired' });
        continue;
      }

      try {
        accepted.push({
          rate,
          price: calculateYanaSellingPrice(rate, pricing, context),
          comparisonKey: createComparableRateKey(rate),
        });
      } catch (error) {
        rejected.push({
          rate,
          reason: error instanceof Error ? error.message : 'Rate could not be priced',
        });
      }
    }

    const grouped = new Map<string, PricedHotelOffer[]>();
    for (const offer of accepted) {
      const group = grouped.get(offer.comparisonKey) ?? [];
      group.push(offer);
      grouped.set(offer.comparisonKey, group);
    }

    return {
      groups: Array.from(grouped.entries()).map(([comparisonKey, offers]) => {
        const ranked = [...offers].sort((left, right) => {
          const priceDifference =
            left.price.finalSellingPrice.amount - right.price.finalSellingPrice.amount;
          if (priceDifference !== 0) return priceDifference;
          return supplierTieBreak(left.rate.supplier) - supplierTieBreak(right.rate.supplier);
        });
        return { comparisonKey, offers: ranked, bestOffer: ranked[0] };
      }),
      rejected,
    };
  }
}

const SUPPLIER_PRIORITY = [
  'liteapi',
  'hotelbeds',
  'webbeds',
  'booking_demand',
  'agoda',
  'yana_direct',
];

function supplierTieBreak(supplier: string): number {
  const index = SUPPLIER_PRIORITY.indexOf(supplier);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
