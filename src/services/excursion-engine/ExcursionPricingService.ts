import type {
  ExcursionCommercialCapabilities,
  ExcursionMoney,
  ExcursionSupplierQuote,
} from './types.js';

export interface ExcursionPriceAudit {
  supplierTotal: ExcursionMoney;
  yanaCommission: ExcursionMoney;
  customerTotal: ExcursionMoney;
  commissionPercent: 15;
  pricingBasis: '15_PERCENT_MARKUP_ON_VERIFIED_NET';
}

const YANA_COMMISSION_PERCENT = 15 as const;

/** Applies YANA's agreed 15% markup only to a verified supplier net quote. */
export function priceExcursionQuote(
  quote: ExcursionSupplierQuote,
  capabilities: ExcursionCommercialCapabilities,
  now = new Date()
): ExcursionPriceAudit {
  assertMoney(quote.supplierTotal);

  if (!quote.available || !quote.bookable) {
    throw new Error('Supplier quote is not currently available to book');
  }
  if (quote.priceBasis !== 'NET' || !capabilities.supportsNetRates) {
    throw new Error('Supplier quote does not contain a verified net rate');
  }
  if (!capabilities.supportsMarkup) {
    throw new Error('Supplier terms do not allow YANA markup');
  }
  if (!capabilities.supportsPublicDisplay) {
    throw new Error('Supplier terms do not allow public price display');
  }
  if (quote.bookingMode !== capabilities.bookingMode) {
    throw new Error('Supplier quote booking mode does not match configured capabilities');
  }
  if (quote.expiresAt) {
    const expiry = Date.parse(quote.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      throw new Error('Supplier quote has expired');
    }
  }

  const commissionAmount = roundMoney(quote.supplierTotal.amount * YANA_COMMISSION_PERCENT / 100);
  const commission = { amount: commissionAmount, currency: quote.supplierTotal.currency };
  return {
    supplierTotal: { ...quote.supplierTotal },
    yanaCommission: commission,
    customerTotal: {
      amount: roundMoney(quote.supplierTotal.amount + commissionAmount),
      currency: quote.supplierTotal.currency,
    },
    commissionPercent: YANA_COMMISSION_PERCENT,
    pricingBasis: '15_PERCENT_MARKUP_ON_VERIFIED_NET',
  };
}

function assertMoney(value: ExcursionMoney): void {
  if (!Number.isFinite(value.amount) || value.amount <= 0) {
    throw new Error('Supplier quote total must be a positive finite amount');
  }
  if (!/^[A-Z]{3}$/.test(value.currency)) {
    throw new Error('Supplier quote currency must be an ISO-style three-letter code');
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
