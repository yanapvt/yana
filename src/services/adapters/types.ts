/**
 * Shared types for all provider adapters.
 *
 * Every vertical (hotels, logistics, excursions, restaurants) normalises its
 * raw provider response into one of these internal schemas before the result
 * is handed back to the LLM / WhatsApp renderer.
 */

// ============================================================================
// Common
// ============================================================================

export interface ProviderImage {
  url: string;
  caption?: string;
  /** 'google_places' | 'provider' | 'unsplash' */
  source: string;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  googleMapsUrl: string;
}

// ============================================================================
// Hotels
// ============================================================================

export interface NormalisedHotel {
  /** Internal provider that returned this result */
  provider: 'liteapi' | 'cloudbeds' | 'booking' | 'expedia' | 'google_places';
  hotelId: string;
  name: string;
  /** Price per night AFTER our margin has been applied */
  pricePerNight: number;
  /** Original provider price before margin */
  providerPrice: number;
  currency: string;
  rating: number;       // 0–5
  reviewCount: number;
  location: string;
  distanceKm: number;
  amenities: string[];
  cancellationPolicy: string;
  /** Deep-link or booking URL to complete the reservation */
  bookingUrl: string;
  images: ProviderImage[];
  geo?: GeoLocation;
  /** Booking.com listing URL for WhatsApp link preview */
  bookingComUrl?: string;
  /** TripAdvisor URL for WhatsApp link preview */
  tripAdvisorUrl?: string;
}

export interface HotelSearchParams {
  location: string;
  checkinDate: string;   // YYYY-MM-DD
  checkoutDate?: string; // YYYY-MM-DD
  guests?: number;
  maxBudget?: number;
  currency?: string;
  /** 'hotel' | 'boutique' | 'hostel' | 'villa' | 'resort' | any */
  propertyType?: string;
}

export interface HotelSearchResult {
  hotels: NormalisedHotel[];
  totalResults: number;
  provider: string;
  searchId?: string;
}

// ============================================================================
// Logistics / Transport
// ============================================================================

export type TransportMode = 'taxi' | 'rideshare' | 'car_hire' | 'tuk_tuk' | 'train' | 'bus' | 'private_driver';

export interface NormalisedTransportOption {
  provider: 'uber' | 'pickme' | 'google_maps' | 'internal';
  mode: TransportMode;
  label: string;
  description: string;
  /** Deep-link that opens the provider app pre-filled with origin/destination */
  deepLink?: string;
  /** Estimated fare range (display string, e.g. "LKR 800–1,200") */
  estimatedFare?: string;
  /** Estimated duration in minutes */
  estimatedMinutes?: number;
  /** Google Maps directions URL */
  directionsUrl?: string;
  images: ProviderImage[];
}

export interface TransportSearchParams {
  origin: string;
  destination: string;
  /** ISO datetime string */
  departureTime?: string;
  passengerCount?: number;
  modes?: TransportMode[];
}

export interface TransportSearchResult {
  options: NormalisedTransportOption[];
  provider: string;
}

// ============================================================================
// Excursions / Activities
// ============================================================================

export interface NormalisedExcursion {
  provider: 'viator' | 'guidegeek' | 'google_places' | 'internal';
  excursionId: string;
  title: string;
  description: string;
  durationHours?: number;
  priceFrom: number;
  currency: string;
  rating: number;
  reviewCount: number;
  location: string;
  category: string;   // 'tour' | 'adventure' | 'cultural' | 'water_sports' | etc.
  bookingUrl: string;
  images: ProviderImage[];
  geo?: GeoLocation;
  highlights: string[];
  cancellationPolicy?: string;
}

export interface ExcursionSearchParams {
  location: string;
  category?: string;
  date?: string;        // YYYY-MM-DD
  maxBudget?: number;
  currency?: string;
  durationMaxHours?: number;
}

export interface ExcursionSearchResult {
  excursions: NormalisedExcursion[];
  totalResults: number;
  provider: string;
}

// ============================================================================
// Restaurants
// ============================================================================

export type RestaurantSource = 'whatsapp_onboarded' | 'genie_merchant' | 'google_places';

export interface NormalisedRestaurant {
  provider: RestaurantSource;
  restaurantId: string;
  name: string;
  cuisine: string[];
  priceRange: '$' | '$$' | '$$$' | '$$$$';
  rating: number;
  reviewCount: number;
  location: string;
  openingHours?: string;
  phoneNumber?: string;
  whatsappNumber?: string;
  bookingUrl?: string;
  menuUrl?: string;
  images: ProviderImage[];
  geo?: GeoLocation;
  tags: string[];       // 'vegetarian' | 'seafood' | 'halal' | 'rooftop' | etc.
  /** True if this restaurant was onboarded via our WhatsApp merchant flow */
  isPartner: boolean;
}

export interface RestaurantSearchParams {
  location: string;
  cuisine?: string;
  priceRange?: '$' | '$$' | '$$$' | '$$$$';
  tags?: string[];
  openNow?: boolean;
  maxResults?: number;
}

export interface RestaurantSearchResult {
  restaurants: NormalisedRestaurant[];
  totalResults: number;
  provider: string;
}
