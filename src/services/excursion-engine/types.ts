import type { ExcursionSearchCriteria } from '../excursionRequestMapper.js';

export type ExcursionSupplierId =
  | 'goodpass'
  | 'viator'
  | 'getyourguide'
  | 'dmc_quote'
  | 'yana_direct'
  | (string & {});

export interface ExcursionMoney {
  amount: number;
  currency: string;
}

export type ExcursionPriceBasis = 'NET' | 'RETAIL' | 'UNKNOWN';
export type ExcursionBookingMode = 'API' | 'REDIRECT' | 'MANUAL_QUOTE';

export interface ExcursionCommercialCapabilities {
  supportsNetRates: boolean;
  supportsMarkup: boolean;
  supportsPublicDisplay: boolean;
  supportsOnlineBooking: boolean;
  bookingMode: ExcursionBookingMode;
}

export interface ExcursionSupplierProduct {
  supplier: ExcursionSupplierId;
  supplierProductId: string;
  name: string;
  destination: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  supplierUrl?: string;
  rating?: number;
  reviewCount?: number;
  rawSnapshotReference?: string;
}

export interface ExcursionQuoteRequest {
  product: ExcursionSupplierProduct;
  criteria: ExcursionSearchCriteria;
  correlationId: string;
}

export interface ExcursionSupplierQuote {
  supplier: ExcursionSupplierId;
  supplierProductId: string;
  supplierRateId: string;
  priceBasis: ExcursionPriceBasis;
  supplierTotal: ExcursionMoney;
  available: boolean;
  bookable: boolean;
  quotedAt: string;
  expiresAt?: string;
  bookingMode: ExcursionBookingMode;
  redirectUrl?: string;
  supplierBookingToken?: string;
  cancellationTerms?: string;
  conditions?: string[];
  rawSnapshotReference?: string;
}

export interface PricedExcursionOffer {
  product: ExcursionSupplierProduct;
  quote: ExcursionSupplierQuote;
  supplierTotal: ExcursionMoney;
  yanaCommission: ExcursionMoney;
  customerTotal: ExcursionMoney;
  commissionPercent: number;
  priceValidUntil?: string;
}

export interface ExcursionSupplierAdapter {
  readonly supplier: ExcursionSupplierId;
  readonly capabilities: ExcursionCommercialCapabilities;
  search(criteria: ExcursionSearchCriteria, correlationId: string): Promise<ExcursionSupplierProduct[]>;
  quote(request: ExcursionQuoteRequest): Promise<ExcursionSupplierQuote>;
}
