import type { RestaurantSearchCriteria } from './restaurantRequestMapper.js';

export interface RestaurantBrowseResult {
  id?: string;
  name: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  cuisine?: string;
  googleMapsUri?: string;
  thumbnailUrl?: string;
}

export interface RestaurantBrowseResponse {
  results: RestaurantBrowseResult[];
  provider: 'google_places';
}

interface GooglePlacesRestaurantBrowsingConfig {
  apiKey?: string;
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
    types?: string[];
  }>;
}

interface SearchRestaurantsOptions {
  maxResults?: number;
}

export class GooglePlacesRestaurantBrowsingService {
  private apiKey?: string;

  constructor(config: GooglePlacesRestaurantBrowsingConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async searchRestaurants(
    criteria: RestaurantSearchCriteria,
    options: SearchRestaurantsOptions = {}
  ): Promise<RestaurantBrowseResponse> {
    if (!this.apiKey) {
      return { provider: 'google_places', results: [] };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.userRatingCount',
          'places.priceLevel',
          'places.googleMapsUri',
          'places.photos',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: this.buildTextQuery(criteria),
        includedType: inferIncludedType(criteria),
        maxResultCount: options.maxResults ?? 9,
        languageCode: 'en',
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Google Places restaurant browsing failed with ${response.status}: ${await response.text()}`
      );
    }

    const data = (await response.json()) as GooglePlacesSearchTextResponse;

    return {
      provider: 'google_places',
      results: (data.places ?? []).slice(0, options.maxResults ?? 9).map((place) => ({
        id: place.id,
        name: place.displayName?.text ?? 'Restaurant result',
        address: place.formattedAddress,
        rating: place.rating,
        reviewCount: place.userRatingCount,
        priceRange: formatPriceLevel(place.priceLevel),
        cuisine: inferCuisineLabel(place.types, criteria),
        googleMapsUri: place.googleMapsUri,
        thumbnailUrl: this.buildPhotoUrl(place.photos?.[0]?.name),
      })),
    };
  }

  private buildTextQuery(criteria: RestaurantSearchCriteria): string {
    const parts = [inferQueryPrefix(criteria)];

    if (criteria.cuisine) parts.push(criteria.cuisine);
    if (criteria.diningStyle) parts.push(criteria.diningStyle);
    if (criteria.dietaryRequirements) parts.push(criteria.dietaryRequirements);
    if (criteria.indoorOutdoor) parts.push(criteria.indoorOutdoor);
    if (criteria.specialOccasion) parts.push(criteria.specialOccasion);
    if (criteria.additionalPreferences) parts.push(criteria.additionalPreferences);
    if (criteria.location) parts.push(`in ${criteria.location}`);

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

function inferIncludedType(criteria: RestaurantSearchCriteria): string {
  const text = `${criteria.cuisine ?? ''} ${criteria.diningStyle ?? ''} ${criteria.additionalPreferences ?? ''}`;
  if (/\b(cafe|coffee|dessert|brunch|breakfast)\b/i.test(text)) return 'cafe';
  if (/\bbar|nightlife|cocktail|drinks\b/i.test(text)) return 'bar';
  return 'restaurant';
}

function inferQueryPrefix(criteria: RestaurantSearchCriteria): string {
  const text = `${criteria.cuisine ?? ''} ${criteria.diningStyle ?? ''} ${criteria.additionalPreferences ?? ''}`;
  if (/\b(cafe|coffee)\b/i.test(text)) return 'cafe';
  if (/\bbar|cocktail|drinks\b/i.test(text)) return 'bar';
  if (/\bfine dining|romantic|luxury\b/i.test(text)) return 'fine dining restaurant';
  return 'restaurant';
}

function inferCuisineLabel(types: string[] | undefined, criteria: RestaurantSearchCriteria): string | undefined {
  if (criteria.cuisine) {
    return criteria.cuisine;
  }

  if (types?.includes('cafe')) {
    return 'Cafe';
  }

  if (types?.includes('bar')) {
    return 'Bar';
  }

  return undefined;
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
