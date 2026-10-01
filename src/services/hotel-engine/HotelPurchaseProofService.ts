import { createHash } from 'node:crypto';
import { HotelRateDecisionEngine, type PricedHotelOffer } from './HotelRateDecisionEngine.js';
import type { PricingConfiguration } from './PricingEngine.js';
import type { NormalizedHotelRate, PrebookResult } from './types.js';

export interface HotelPurchaseProofRequest {
  rates: NormalizedHotelRate[];
  correlationId: string;
  expiresAt: string;
  pricing?: PricingConfiguration;
  checkoutBaseUrl?: string;
}

export interface HotelPurchaseProofResult {
  supplier: string;
  supplierRateId: string;
  roomName: string;
  currency: string;
  acquisitionCost: number;
  sellingPrice: number;
  markupPercent: number;
  expiresAt: string;
  checkoutUrl: string;
  rechecked: boolean;
  mode: 'mock';
}

export type HotelPurchaseProofRechecker = (
  rate: NormalizedHotelRate,
  correlationId: string
) => Promise<PrebookResult>;

/**
 * Deterministic, no-charge proof of the purchase boundary.
 * It intentionally creates a test URL only; it never calls a payment or booking API.
 */
export async function createHotelPurchaseProof(
  request: HotelPurchaseProofRequest,
  recheck: HotelPurchaseProofRechecker,
  decisionEngine = new HotelRateDecisionEngine()
): Promise<HotelPurchaseProofResult> {
  const decision = decisionEngine.decide(
    request.rates,
    request.pricing ?? {
      defaultPercent: 15,
      minimumPercent: 15,
      maximumPercent: 15,
      percentageMode: 'MARKUP',
    },
    { strategy: 'BEST_PRICE' }
  );
  const offer = cheapestOffer(decision.groups.flatMap((group) => group.offers));
  if (!offer) throw new Error('No comparable bookable hotel rate passed pricing checks');

  const checked = await recheck(offer.rate, request.correlationId);
  if (!checked.available || !checked.rate.available || !checked.rate.bookable) {
    throw new Error('Selected hotel rate was unavailable during mock recheck');
  }
  const finalDecision = decisionEngine.decide(
    [checked.rate],
    request.pricing ?? {
      defaultPercent: 15,
      minimumPercent: 15,
      maximumPercent: 15,
      percentageMode: 'MARKUP',
    },
    { strategy: 'BEST_PRICE' }
  );
  const finalOffer = cheapestOffer(finalDecision.groups.flatMap((group) => group.offers));
  if (!finalOffer) throw new Error('Rechecked hotel rate could not be priced');

  const baseUrl = (request.checkoutBaseUrl ?? 'https://checkout.test.yana.local').replace(/\/$/, '');
  const token = createHash('sha256')
    .update(`${request.correlationId}|${finalOffer.rate.supplier}|${finalOffer.rate.supplierRateId}|${request.expiresAt}`)
    .digest('hex')
    .slice(0, 24);
  return {
    supplier: finalOffer.rate.supplier,
    supplierRateId: finalOffer.rate.supplierRateId,
    roomName: finalOffer.rate.roomName,
    currency: finalOffer.rate.currency,
    acquisitionCost: finalOffer.price.acquisitionCost.amount,
    sellingPrice: finalOffer.price.finalSellingPrice.amount,
    markupPercent: finalOffer.price.effectiveMarkupPercent,
    expiresAt: request.expiresAt,
    checkoutUrl: `${baseUrl}/mock/${token}`,
    rechecked: true,
    mode: 'mock',
  };
}

function cheapestOffer(offers: PricedHotelOffer[]): PricedHotelOffer | undefined {
  return [...offers].sort((left, right) =>
    left.price.finalSellingPrice.amount - right.price.finalSellingPrice.amount
  )[0];
}
