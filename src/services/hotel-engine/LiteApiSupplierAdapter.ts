import crypto from 'node:crypto';
import type { HotelSupplierAdapter } from './HotelSupplierAdapter.js';
import { money } from './money.js';
import type {
  BookingRequest,
  CancellationPolicy,
  HotelSearchRequest,
  MealPlan,
  NormalizedHotelRate,
  PrebookResult,
  SupplierBooking,
  SupplierCommercialCapabilities,
  SupplierHotelSearchResult,
  YanaHotel,
  YanaRoom,
} from './types.js';

export interface LiteApiSupplierAdapterConfig {
  baseUrl: string;
  apiKey: string;
  guestNationality?: string;
  capabilities?: Partial<SupplierCommercialCapabilities>;
}

interface LiteApiMoney {
  amount?: number;
  currency?: string;
}

interface LiteApiRate {
  name?: string;
  mappedRoomId?: string | number;
  boardName?: string;
  boardType?: string;
  retailRate?: {
    total?: LiteApiMoney[] | LiteApiMoney;
    taxesAndFees?: Array<LiteApiMoney & { included?: boolean }>;
  };
  netRate?: { total?: LiteApiMoney[] | LiteApiMoney };
  cancellationPolicies?: {
    refundableTag?: string;
    cancelPolicyInfos?: Array<{
      cancelTime?: string;
      amount?: number;
      currency?: string;
    }>;
  };
}

interface LiteApiRoomType {
  offerId?: string;
  name?: string;
  mappedRoomId?: string | number;
  rates?: LiteApiRate[];
  retailRate?: LiteApiRate['retailRate'];
  netRate?: LiteApiRate['netRate'];
  boardName?: string;
  boardType?: string;
  cancellationPolicies?: LiteApiRate['cancellationPolicies'];
}

interface LiteApiHotelRate {
  hotelId?: string;
  roomTypes?: LiteApiRoomType[];
}

interface LiteApiHotelData {
  id?: string;
  hotelId?: string;
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  starRating?: number;
  main_photo?: string;
  mainPhoto?: string;
  photos?: Array<string | { url?: string; urlHd?: string }>;
  amenities?: string[];
  hotelFacilities?: string[];
}

interface LiteApiSearchResponse {
  data?: LiteApiHotelRate[];
  hotels?: LiteApiHotelData[];
  error?: unknown;
  sandbox?: boolean;
}

const DEFAULT_CAPABILITIES: SupplierCommercialCapabilities = {
  supportsNetRates: false,
  supportsMarkup: false,
  supportsDiscount: false,
  supportsPublicDisplay: true,
  requiresClosedUserGroup: false,
  requiresRedirect: false,
  supportsOnlineBooking: true,
};

export class LiteApiSupplierAdapter implements HotelSupplierAdapter {
  readonly supplier = 'liteapi' as const;
  readonly capabilities: SupplierCommercialCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly guestNationality: string;

  constructor(config: LiteApiSupplierAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.guestNationality = (config.guestNationality ?? 'LK').toUpperCase();
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities };
  }

  async searchHotels(request: HotelSearchRequest): Promise<SupplierHotelSearchResult> {
    if (request.occupancy.rooms !== 1) {
      throw new Error('LiteAPI live-test adapter currently requires exactly one room occupancy');
    }

    const response = await this.request<LiteApiSearchResponse>('/hotels/rates', {
      method: 'POST',
      signal: request.signal,
      body: JSON.stringify({
        checkin: request.checkIn,
        checkout: request.checkOut,
        currency: request.currency,
        guestNationality: this.guestNationality,
        occupancies: [
          {
            adults: request.occupancy.adults,
            children: request.occupancy.childAges ?? [],
          },
        ],
        ...(request.hotelIds?.length
          ? { hotelIds: request.hotelIds }
          : { aiSearch: `hotels in ${request.destination}` }),
        roomMapping: true,
        maxRatesPerHotel: 5,
        includeHotelData: true,
        sessionId: request.correlationId,
      }),
    });

    if (response.error && (!response.data || response.data.length === 0)) {
      throw new Error(`LiteAPI search error: ${safeError(response.error)}`);
    }

    return this.normalizeSearchResponse(response, request);
  }

  async getHotelDetails(supplierHotelId: string, correlationId: string): Promise<YanaHotel> {
    const response = await this.request<{ data?: LiteApiHotelData }>(
      `/data/hotel?hotelId=${encodeURIComponent(supplierHotelId)}`,
      { method: 'GET', headers: { 'X-Correlation-Id': correlationId } }
    );
    return this.normalizeHotel(response.data ?? { id: supplierHotelId }, supplierHotelId, []);
  }

  async getRates(request: HotelSearchRequest): Promise<NormalizedHotelRate[]> {
    return (await this.searchHotels(request)).rates;
  }

  async recheckRate(): Promise<PrebookResult> {
    throw new Error('LiteAPI prebook/recheck is not enabled in the live-search prerequisite slice');
  }

  async prebook(): Promise<PrebookResult> {
    throw new Error('LiteAPI prebook is not enabled in the live-search prerequisite slice');
  }

  async book(_request: BookingRequest): Promise<SupplierBooking> {
    throw new Error('LiteAPI booking is not enabled in the live-search prerequisite slice');
  }

  async cancelBooking(): Promise<SupplierBooking> {
    throw new Error('LiteAPI cancellation is not enabled in the live-search prerequisite slice');
  }

  async getBooking(): Promise<SupplierBooking> {
    throw new Error('LiteAPI booking lookup is not enabled in the live-search prerequisite slice');
  }

  private normalizeSearchResponse(
    response: LiteApiSearchResponse,
    request: HotelSearchRequest
  ): SupplierHotelSearchResult {
    const hotelData = new Map(
      (response.hotels ?? []).map((hotel) => [hotel.id ?? hotel.hotelId ?? '', hotel])
    );
    const rates: NormalizedHotelRate[] = [];
    const roomsByHotel = new Map<string, Map<string, YanaRoom>>();

    for (const hotelResult of response.data ?? []) {
      const supplierHotelId = hotelResult.hotelId;
      if (!supplierHotelId) continue;
      const yanaHotelId = stableId('hotel', supplierHotelId);
      const rooms = roomsByHotel.get(supplierHotelId) ?? new Map<string, YanaRoom>();
      roomsByHotel.set(supplierHotelId, rooms);

      for (const roomType of hotelResult.roomTypes ?? []) {
        const embeddedRates = roomType.rates?.length
          ? roomType.rates
          : [roomType as LiteApiRate];
        for (const rate of embeddedRates) {
          const supplierRateId = roomType.offerId;
          const price = readRatePrice(rate, roomType, request.currency);
          if (!supplierRateId || !price || price.amount <= 0) continue;
          const roomName = rate.name ?? roomType.name ?? 'Hotel room';
          const mappedRoomId = rate.mappedRoomId ?? roomType.mappedRoomId ?? roomName;
          const yanaRoomId = stableId('room', `${supplierHotelId}:${mappedRoomId}`);
          const room: YanaRoom = {
            yanaRoomId,
            name: roomName,
            normalizedRoomType: normalizeRoomName(roomName),
            importantAttributes: [],
          };
          rooms.set(yanaRoomId, room);
          const cancellationPolicy = normalizeCancellation(
            rate.cancellationPolicies ?? roomType.cancellationPolicies,
            price.currency
          );
          const priceBasis = price.basis;
          rates.push({
            yanaHotelId,
            yanaRoomId,
            supplier: this.supplier,
            supplierHotelId,
            supplierRateId,
            searchId: request.correlationId,
            checkIn: request.checkIn,
            checkOut: request.checkOut,
            occupancy: request.occupancy,
            roomName,
            normalizedRoomType: room.normalizedRoomType,
            importantRoomAttributes: [],
            mealPlan: normalizeMealPlan(rate.boardName ?? rate.boardType ?? roomType.boardName ?? roomType.boardType),
            cancellationPolicy,
            paymentType: 'UNKNOWN',
            taxesIncluded: price.taxesIncluded,
            feesIncluded: price.taxesIncluded,
            cost: {
              supplierNet: money(price.amount, price.currency),
              mandatoryTaxes: money(price.excludedTaxes, price.currency),
              mandatoryFees: money(0, price.currency),
              paymentProcessing: money(0, price.currency),
              fxConversion: money(0, price.currency),
              supplierBookingFees: money(0, price.currency),
              otherUnavoidableCosts: money(0, price.currency),
            },
            priceBasis,
            currency: price.currency,
            available: true,
            bookable: true,
            commercialCapabilities: {
              ...this.capabilities,
              supportsNetRates: priceBasis === 'NET' && this.capabilities.supportsNetRates,
            },
          });
        }
      }
    }

    const hotels = Array.from(roomsByHotel.entries()).map(([supplierHotelId, rooms]) =>
      this.normalizeHotel(hotelData.get(supplierHotelId) ?? {}, supplierHotelId, Array.from(rooms.values()))
    );
    return {
      supplier: this.supplier,
      hotels,
      rates,
      partial: Boolean(response.error) && rates.length > 0,
      warnings: response.error ? [`LiteAPI partial response: ${safeError(response.error)}`] : [],
    };
  }

  private normalizeHotel(
    hotel: LiteApiHotelData,
    supplierHotelId: string,
    rooms: YanaRoom[]
  ): YanaHotel {
    const images = [hotel.main_photo, hotel.mainPhoto, ...(hotel.photos ?? []).map(photoUrl)]
      .filter((value): value is string => Boolean(value));
    return {
      yanaHotelId: stableId('hotel', supplierHotelId),
      name: hotel.name ?? `Hotel ${supplierHotelId}`,
      destination: hotel.city ?? '',
      country: hotel.country ?? hotel.countryCode ?? '',
      address: hotel.address,
      location:
        typeof hotel.latitude === 'number' && typeof hotel.longitude === 'number'
          ? { latitude: hotel.latitude, longitude: hotel.longitude }
          : undefined,
      starRating: hotel.starRating,
      images,
      amenities: hotel.amenities ?? hotel.hotelFacilities ?? [],
      supplierReferences: [{ supplier: this.supplier, supplierHotelId }],
      rooms,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`LiteAPI request failed with ${response.status}: ${responseText.slice(0, 500)}`);
    }
    return (await response.json()) as T;
  }
}

function readRatePrice(
  rate: LiteApiRate,
  roomType: LiteApiRoomType,
  fallbackCurrency: string
): { amount: number; currency: string; basis: 'NET' | 'RETAIL'; taxesIncluded: boolean; excludedTaxes: number } | null {
  const net = firstMoney(rate.netRate?.total ?? roomType.netRate?.total);
  const retailContainer = rate.retailRate ?? roomType.retailRate;
  const retail = firstMoney(retailContainer?.total);
  const selected = net ?? retail;
  if (!selected || typeof selected.amount !== 'number') return null;
  const taxes = retailContainer?.taxesAndFees ?? [];
  const excludedTaxes = taxes
    .filter((tax) => tax.included === false)
    .reduce((total, tax) => total + (tax.amount ?? 0), 0);
  return {
    amount: selected.amount,
    currency: (selected.currency ?? fallbackCurrency).toUpperCase(),
    basis: net ? 'NET' : 'RETAIL',
    taxesIncluded: !taxes.some((tax) => tax.included === false),
    excludedTaxes,
  };
}

function firstMoney(value: LiteApiMoney[] | LiteApiMoney | undefined): LiteApiMoney | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeCancellation(
  policy: LiteApiRate['cancellationPolicies'],
  currency: string
): CancellationPolicy {
  const refundable = !/NRFN|NON.?REFUND/i.test(policy?.refundableTag ?? '');
  const firstCancelTime = policy?.cancelPolicyInfos?.find((entry) => entry.cancelTime)?.cancelTime;
  return {
    refundable,
    freeCancellationUntil: refundable ? firstCancelTime : undefined,
    penalties: (policy?.cancelPolicyInfos ?? []).map((penalty) => ({
      from: penalty.cancelTime ?? '',
      amount:
        typeof penalty.amount === 'number'
          ? money(penalty.amount, (penalty.currency ?? currency).toUpperCase())
          : undefined,
    })),
    normalizedCode: refundable
      ? `REFUNDABLE:${firstCancelTime ?? 'UNSPECIFIED'}`
      : 'NON_REFUNDABLE',
  };
}

function normalizeMealPlan(value?: string): MealPlan {
  const normalized = value?.toLowerCase() ?? '';
  if (/all.?inclusive/.test(normalized)) return 'ALL_INCLUSIVE';
  if (/full.?board/.test(normalized)) return 'FULL_BOARD';
  if (/half.?board/.test(normalized)) return 'HALF_BOARD';
  if (/breakfast|bed.?and.?breakfast|b&b/.test(normalized)) return 'BREAKFAST';
  if (/room.?only/.test(normalized)) return 'ROOM_ONLY';
  return 'UNKNOWN';
}

function normalizeRoomName(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function stableId(kind: 'hotel' | 'room', value: string): string {
  return `yana_${kind}_${crypto.createHash('sha256').update(`liteapi:${value}`).digest('hex').slice(0, 16)}`;
}

function photoUrl(photo: string | { url?: string; urlHd?: string }): string | undefined {
  return typeof photo === 'string' ? photo : photo.urlHd ?? photo.url;
}

function safeError(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 500);
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return 'Unknown supplier error';
  }
}
