import { calculateTrueAcquisitionCost } from './RateComparisonService.js';
import { assertMoney, money } from './money.js';
import type { Money, NormalizedHotelRate } from './types.js';

export type PricingStrategy =
  | 'MAXIMUM_MARGIN'
  | 'COMPETITIVE'
  | 'BEST_PRICE'
  | 'DIRECT_HOTEL_PRIORITY';

export type PercentageMode = 'MARKUP' | 'MARGIN';

export interface PricingConfiguration {
  defaultPercent: number;
  minimumPercent: number;
  maximumPercent: number;
  percentageMode: PercentageMode;
  fixedMarkup?: Money;
  competitiveUndercutPercent?: number;
}

export interface PriceAudit {
  acquisitionCost: Money;
  baseSellingPrice: Money;
  fixedMarkup: Money;
  discount: Money;
  finalSellingPrice: Money;
  effectiveMarkupPercent: number;
  effectiveMarginPercent: number;
  strategy: PricingStrategy;
  referencePrice?: Money;
  referenceSource?: string;
  customerSaving?: Money;
  warnings: string[];
}

export interface PricingContext {
  strategy: PricingStrategy;
  customerDiscount?: Money;
}

export function calculateYanaSellingPrice(
  rate: NormalizedHotelRate,
  configuration: PricingConfiguration,
  context: PricingContext
): PriceAudit {
  validateConfiguration(configuration);
  enforceCommercialRules(rate, context);

  const acquisitionCost = calculateTrueAcquisitionCost(rate).total;
  const selectedPercent = selectPercent(configuration, context.strategy);
  const baseAmount = applyPercentage(
    acquisitionCost.amount,
    selectedPercent,
    configuration.percentageMode
  );
  const fixedMarkup = configuration.fixedMarkup ?? money(0, rate.currency);
  assertMoney(fixedMarkup, rate.currency);

  const discount = context.customerDiscount ?? money(0, rate.currency);
  assertMoney(discount, rate.currency);
  if (discount.amount > 0 && !rate.commercialCapabilities.supportsDiscount) {
    throw new Error(`Supplier ${rate.supplier} does not allow customer discounts`);
  }

  const minimumPrice = applyPercentage(
    acquisitionCost.amount,
    configuration.minimumPercent,
    configuration.percentageMode
  );
  let candidate = baseAmount + fixedMarkup.amount - discount.amount;
  const warnings: string[] = [];
  const validReference = rate.referencePrice?.comparableRate === true
    ? rate.referencePrice
    : undefined;

  if (validReference) {
    assertMoney(validReference.price, rate.currency);
  }

  if (context.strategy === 'COMPETITIVE' && validReference) {
    const undercut = configuration.competitiveUndercutPercent ?? 1;
    const competitiveTarget = validReference.price.amount * (1 - undercut / 100);
    candidate = Math.min(candidate, competitiveTarget);
  }

  candidate = Math.max(candidate, minimumPrice);
  const finalSellingPrice = money(candidate, rate.currency);
  const customerSaving = validReference && validReference.price.amount > finalSellingPrice.amount
    ? money(validReference.price.amount - finalSellingPrice.amount, rate.currency)
    : undefined;

  if (rate.referencePrice && !validReference) {
    warnings.push('Reference price was not used because comparable rate conditions were not verified');
  }

  const profit = finalSellingPrice.amount - acquisitionCost.amount;
  return {
    acquisitionCost,
    baseSellingPrice: money(baseAmount, rate.currency),
    fixedMarkup,
    discount,
    finalSellingPrice,
    effectiveMarkupPercent:
      acquisitionCost.amount === 0 ? 0 : (profit / acquisitionCost.amount) * 100,
    effectiveMarginPercent:
      finalSellingPrice.amount === 0 ? 0 : (profit / finalSellingPrice.amount) * 100,
    strategy: context.strategy,
    referencePrice: validReference?.price,
    referenceSource: validReference?.source,
    customerSaving,
    warnings,
  };
}

export function applyPercentage(
  acquisitionCost: number,
  percent: number,
  mode: PercentageMode
): number {
  if (mode === 'MARKUP') {
    return acquisitionCost * (1 + percent / 100);
  }

  if (percent >= 100) {
    throw new Error('Margin percentage must be less than 100');
  }

  return acquisitionCost / (1 - percent / 100);
}

function selectPercent(
  configuration: PricingConfiguration,
  strategy: PricingStrategy
): number {
  if (strategy === 'BEST_PRICE') {
    return configuration.minimumPercent;
  }

  return Math.min(configuration.maximumPercent, configuration.defaultPercent);
}

function enforceCommercialRules(
  rate: NormalizedHotelRate,
  context: PricingContext
): void {
  const capabilities = rate.commercialCapabilities;
  if (rate.priceBasis !== 'NET' || !capabilities.supportsNetRates) {
    throw new Error(
      `Supplier ${rate.supplier} rate does not expose a verified net acquisition price`
    );
  }
  if (!capabilities.supportsPublicDisplay) {
    throw new Error(`Supplier ${rate.supplier} does not allow public rate display`);
  }
  if (capabilities.requiresClosedUserGroup) {
    throw new Error(`Supplier ${rate.supplier} rate requires a closed user group`);
  }
  if (!capabilities.supportsMarkup) {
    throw new Error(`Supplier ${rate.supplier} does not allow markup`);
  }
  if (!rate.available || !rate.bookable) {
    throw new Error(`Supplier ${rate.supplier} rate is not currently bookable`);
  }
  if (context.customerDiscount && !capabilities.supportsDiscount) {
    throw new Error(`Supplier ${rate.supplier} does not allow customer discounts`);
  }
}

function validateConfiguration(configuration: PricingConfiguration): void {
  const percentages = [
    configuration.minimumPercent,
    configuration.defaultPercent,
    configuration.maximumPercent,
  ];
  if (percentages.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Pricing percentages must be non-negative finite numbers');
  }
  if (
    configuration.minimumPercent > configuration.defaultPercent ||
    configuration.defaultPercent > configuration.maximumPercent
  ) {
    throw new Error('Pricing percentages must satisfy minimum <= default <= maximum');
  }
}
