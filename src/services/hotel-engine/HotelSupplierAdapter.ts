import type {
  BookingRequest,
  HotelSearchRequest,
  NormalizedHotelRate,
  PrebookResult,
  SupplierBooking,
  SupplierCommercialCapabilities,
  SupplierHotelSearchResult,
  SupplierId,
  YanaHotel,
} from './types.js';

export interface HotelSupplierAdapter {
  readonly supplier: SupplierId;
  readonly capabilities: SupplierCommercialCapabilities;

  searchHotels(request: HotelSearchRequest): Promise<SupplierHotelSearchResult>;
  getHotelDetails(supplierHotelId: string, correlationId: string): Promise<YanaHotel>;
  getRates(request: HotelSearchRequest): Promise<NormalizedHotelRate[]>;
  recheckRate(rate: NormalizedHotelRate, correlationId: string): Promise<PrebookResult>;
  prebook(rate: NormalizedHotelRate, correlationId: string): Promise<PrebookResult>;
  book(request: BookingRequest, correlationId: string): Promise<SupplierBooking>;
  cancelBooking(supplierBookingId: string, correlationId: string): Promise<SupplierBooking>;
  getBooking(supplierBookingId: string, correlationId: string): Promise<SupplierBooking>;
}
