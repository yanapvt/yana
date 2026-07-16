import type { ExcursionSearchCriteria } from './excursionRequestMapper.js';

export interface ExcursionBrowseResult {
  id?: string;
  name: string;
  category?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  shortDescription?: string;
  googleMapsUri?: string;
  thumbnailUrl?: string;
}

export interface ExcursionBrowseResponse {
  results: ExcursionBrowseResult[];
  provider: 'google_places';
}

interface GooglePlacesExcursionBrowsingConfig {
  apiKey?: string;
}

interface GooglePlacesSearchTextResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    googleMapsUri?: string;
    photos?: Array<{ name?: string }>;
    types?: string[];
    editorialSummary?: { text?: string };
  }>;
}

export class GooglePlacesExcursionBrowsingService {
  private apiKey?: string;

  constructor(config: GooglePlacesExcursionBrowsingConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async searchExcursions(
    criteria: ExcursionSearchCriteria,
    options: { maxResults?: number } = {}
  ): Promise<ExcursionBrowseResponse> {
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
          'places.editorialSummary',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: buildTextQuery(criteria),
        includedType: inferIncludedType(criteria),
        maxResultCount: options.maxResults ?? 9,
        languageCode: 'en',
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Google Places excursion browsing failed with ${response.status}: ${await response.text()}`
      );
    }

    const data = (await response.json()) as GooglePlacesSearchTextResponse;

    return {
      provider: 'google_places',
      results: (data.places ?? []).slice(0, options.maxResults ?? 9).map((place) => ({
        id: place.id,
        name: place.displayName?.text ?? 'Experience result',
        category: inferCategoryLabel(place.types, criteria),
        address: place.formattedAddress,
        rating: place.rating,
        reviewCount: place.userRatingCount,
        priceRange: formatPriceLevel(place.priceLevel) ?? criteria.budget,
        shortDescription: place.editorialSummary?.text,
        googleMapsUri: place.googleMapsUri,
        thumbnailUrl: buildPhotoUrl(place.photos?.[0]?.name),
      })),
    };
  }
}

function buildTextQuery(criteria: ExcursionSearchCriteria): string {
  const parts = [
    criteria.category ?? 'things to do',
    criteria.tourType,
    criteria.duration,
    criteria.fitnessLevel,
    criteria.specialRequirements,
    criteria.additionalPreferences,
    criteria.destination ? `in ${criteria.destination}` : undefined,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

  return parts.join(' ');
}

function inferIncludedType(criteria: ExcursionSearchCriteria): string {
  const text = [
    criteria.category,
    criteria.tourType,
    criteria.specialRequirements,
    criteria.additionalPreferences,
    criteria.originalRequest,
  ].join(' ');

  if (/\bmuseum|history|historic|fort|culture|temple\b/i.test(text)) return 'museum';
  if (/\bwildlife|safari|elephant|leopard|zoo\b/i.test(text)) return 'zoo';
  if (/\baquarium|whale|dolphin|diving|snorkelling|snorkeling\b/i.test(text)) return 'aquarium';
  if (/\bnature|park|waterfall|hiking|trekking|mountain\b/i.test(text)) return 'park';
  if (/\bcamping|campground\b/i.test(text)) return 'campground';
  if (/\badventure|family|kids|amusement\b/i.test(text)) return 'amusement_park';
  if (/\btour|guide|private|group\b/i.test(text)) return 'travel_agency';
  return 'tourist_attraction';
}

function inferCategoryLabel(types: string[] | undefined, criteria: ExcursionSearchCriteria): string | undefined {
  if (criteria.category) return criteria.category;
  if (types?.includes('museum')) return 'Museum';
  if (types?.includes('park')) return 'Nature';
  if (types?.includes('zoo')) return 'Wildlife';
  if (types?.includes('tourist_attraction')) return 'Attraction';
  return undefined;
}

function buildPhotoUrl(photoName?: string): string | undefined {
  if (!photoName) return undefined;

  const publicBaseUrl =
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`;

  return `${publicBaseUrl.replace(/\/$/, '')}/media/google-place-photo?name=${encodeURIComponent(photoName)}`;
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
