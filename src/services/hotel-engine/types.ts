export type SupplierId =
  | 'liteapi'
  | 'hotelbeds'
  | 'webbeds'
  | 'booking_demand'
  | 'agoda'
  | 'yana_direct'
  | (string & {});

export interface Money {
  amount: number;
  currency: string;
}

export interface HotelOccupancy {
  adults: number;
  children: number;
  rooms: number;
  childAges?: number[];
}

export type MealPlan =
  | 'ROOM_ONLY'
  | 'BREAKFAST'
  | 'HALF_BOARD'
  | 'FULL_BOARD'
  | 'ALL_INCLUSIVE'
  | 'UNKNOWN';

export type PaymentType =
  | 'PREPAID'
  | 'PAY_AT_PROPERTY'
  | 'PARTIAL_PREPAYMENT'
  | 'UNKNOWN';

export interface CancellationPenalty {
  from: string;
  amount?: Money;
  nights?: number;
  description?: string;
}

export interface CancellationPolicy {
  refundable: boolean;
  freeCancellationUntil?: string;
  penalties: CancellationPenalty[];
  normalizedCode: string;
}

export interface SupplierCommercialCapabilities {
  supportsNetRates: boolean;
  supportsMarkup: boolean;
  supportsDiscount: boolean;
  supportsPublicDisplay: boolean;
  requiresClosedUserGroup: boolean;
  requiresRedirect: boolean;
  supportsOnlineBooking: boolean;
}

export interface SupplierReference {
  supplier: SupplierId;
  supplierHotelId: string;
}

export interface YanaHotel {
  yanaHotelId: string;
  name: string;
  destination: string;
  country: string;
  address?: string;
  phone?: string;
  website?: string;
  location?: { latitude: number; longitude: number };
  starRating?: number;
  images: string[];
  amenities: string[];
  supplierReferences: SupplierReference[];
  rooms: YanaRoom[];
}

export interface YanaRoom {
  yanaRoomId: string;
  name: string;
  normalizedRoomType: string;
  importantAttributes: string[];
  maxOccupancy?: HotelOccupancy;
}

export interface RateCostComponents {
  supplierNet: Money;
  mandatoryTaxes: Money;
  mandatoryFees: Money;
  paymentProcessing: Money;
  fxConversion: Money;
  supplierBookingFees: Money;
  otherUnavoidableCosts: Money;
}

export interface VerifiedReferencePrice {
  price: Money;
  source: string;
  observedAt: string;
  comparableRate: boolean;
}

export interface NormalizedHotelRate {
  yanaHotelId: string;
  yanaRoomId: string;
  supplier: SupplierId;
  supplierHotelId: string;
  supplierRateId: string;
  searchId?: string;
  checkIn: string;
  checkOut: string;
  occupancy: HotelOccupancy;
  roomName: string;
  normalizedRoomType: string;
  importantRoomAttributes: string[];
  mealPlan: MealPlan;
  cancellationPolicy: CancellationPolicy;
  paymentType: PaymentType;
  taxesIncluded: boolean;
  feesIncluded: boolean;
  cost: RateCostComponents;
  priceBasis: 'NET' | 'RETAIL' | 'UNKNOWN';
  currency: string;
  available: boolean;
  bookable: boolean;
  expiresAt?: string;
  referencePrice?: VerifiedReferencePrice;
  commercialCapabilities: SupplierCommercialCapabilities;
  rawSnapshotReference?: string;
}

export interface HotelSearchRequest {
  destination: string;
  checkIn: string;
  checkOut: string;
  occupancy: HotelOccupancy;
  currency: string;
  hotelIds?: string[];
  correlationId: string;
  signal?: AbortSignal;
}

export interface SupplierHotelSearchResult {
  supplier: SupplierId;
  hotels: YanaHotel[];
  rates: NormalizedHotelRate[];
  partial: boolean;
  warnings: string[];
}

export interface PrebookResult {
  supplier: SupplierId;
  supplierRateId: string;
  available: boolean;
  rate: NormalizedHotelRate;
  prebookToken?: string;
}

export interface BookingRequest {
  supplierRateId: string;
  prebookToken?: string;
  customerReference: string;
  guestDetails: Array<Record<string, unknown>>;
}

export interface SupplierBooking {
  supplier: SupplierId;
  supplierBookingId: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'FAILED';
  confirmationCode?: string;
}
