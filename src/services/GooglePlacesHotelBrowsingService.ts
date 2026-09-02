import type { HotelSearchCriteria } from './HotelIntakeService.js';

export interface HotelBrowseResult {
  id?: string;
  name: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  googleMapsUri?: string;
  thumbnailUrl?: string;
  roomName?: string;
  mealPlan?: string;
  refundable?: boolean;
  rateAmount?: number;
  rateCurrency?: string;
  priceBasis?: 'NET' | 'RETAIL' | 'UNKNOWN';
  sltdaVerified?: boolean;
  sltdaLicenceValidUntil?: string;
}

export interface HotelBrowseResponse {
  results: HotelBrowseResult[];
  provider: 'google_places' | 'hotel_inventory';
}

interface GooglePlacesHotelBrowsingConfig {
  apiKey?: string;
  enabled?: boolean;
}

interface GooglePlacesSearchTextResponse {
  places?: Array<{
    id?: string;
    displayName?: {
      text?: string;
    };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    googleMapsUri?: string;
    photos?: Array<{
      name?: string;
    }>;
  }>;
}

interface SearchHotelsOptions {
  maxResults?: number;
}

export class GooglePlacesHotelBrowsingService {
  private apiKey?: string;
  private enabled: boolean;

  constructor(config: GooglePlacesHotelBrowsingConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
    this.enabled =
      config.enabled ?? process.env.HOTEL_GOOGLE_PLACES_ENABLED !== 'false';
  }

  isConfigured(): boolean {
    return this.enabled && Boolean(this.apiKey);
  }

  async searchHotels(
    criteria: HotelSearchCriteria,
    options: SearchHotelsOptions = {}
  ): Promise<HotelBrowseResponse> {
    const apiKey = this.apiKey;
    if (!this.enabled || !apiKey) {
      return { provider: 'google_places', results: [] };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.userRatingCount',
          'places.priceLevel',
          'places.googleMapsUri',
          'places.photos',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: this.buildTextQuery(criteria),
        includedType: 'lodging',
        maxResultCount: options.maxResults ?? 9,
        languageCode: 'en',
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Places hotel browsing failed with ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as GooglePlacesSearchTextResponse;

    return {
      provider: 'google_places',
      results: (data.places ?? []).slice(0, options.maxResults ?? 9).map((place) => ({
        id: place.id,
        name: place.displayName?.text ?? 'Hotel result',
        address: place.formattedAddress,
        rating: place.rating,
        reviewCount: place.userRatingCount,
        priceRange: formatPriceLevel(place.priceLevel),
        googleMapsUri: place.googleMapsUri,
        thumbnailUrl: this.buildPhotoUrl(place.photos?.[0]?.name),
      })),
    };
  }

  private buildTextQuery(criteria: HotelSearchCriteria): string {
    const parts = ['hotels'];

    if (criteria.location) {
      parts.push(`in ${criteria.location}`);
    }

    if (criteria.budgetPerNight) {
      parts.push(`under ${criteria.budgetPerNight.currency} ${criteria.budgetPerNight.amount} per night`);
    }

    if (criteria.starRating) {
      parts.push(criteria.starRating);
    }

    if (criteria.guests) {
      parts.push(`for ${criteria.guests} guests`);
    }

    if (criteria.rooms) {
      parts.push(`${criteria.rooms} room${criteria.rooms === 1 ? '' : 's'}`);
    }

    if (criteria.boardBasis) {
      parts.push(formatBoardBasis(criteria.boardBasis));
    }

    if (criteria.hotelType) {
      parts.push(criteria.hotelType);
    }

    if (criteria.facilities) {
      parts.push(criteria.facilities);
    }

    if (criteria.bedPreference) {
      parts.push(criteria.bedPreference);
    }

    if (criteria.specialOccasion) {
      parts.push(criteria.specialOccasion);
    }

    if (criteria.additionalPreferences) {
      parts.push(criteria.additionalPreferences);
    }

    return parts.join(' ');
  }

  private buildPhotoUrl(photoName?: string): string | undefined {
    if (!photoName) {
      return undefined;
    }

    const publicBaseUrl =
      process.env.FORM_PUBLIC_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      `http://localhost:${process.env.PORT || '3000'}`;

    return `${publicBaseUrl.replace(/\/$/, '')}/media/google-place-photo?name=${encodeURIComponent(photoName)}`;
  }
}

function formatPriceLevel(priceLevel?: string): string | undefined {
  const labels: Record<string, string> = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };

  return priceLevel ? labels[priceLevel] : undefined;
}

function formatBoardBasis(boardBasis: NonNullable<HotelSearchCriteria['boardBasis']>): string {
  const labels = {
    room_only: 'room only',
    bnb: 'breakfast included',
    half_board: 'half board',
    full_board: 'full board',
    all_inclusive: 'all inclusive',
  };

  return labels[boardBasis];
}

let googlePlacesHotelBrowsingServiceInstance: GooglePlacesHotelBrowsingService | null = null;

export function getGooglePlacesHotelBrowsingService(): GooglePlacesHotelBrowsingService {
  if (!googlePlacesHotelBrowsingServiceInstance) {
    googlePlacesHotelBrowsingServiceInstance = new GooglePlacesHotelBrowsingService();
  }

  return googlePlacesHotelBrowsingServiceInstance;
}
