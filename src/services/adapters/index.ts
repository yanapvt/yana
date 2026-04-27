/**
 * Provider Adapters - Exports for Nango and Provider Adapter interfaces
 * 
 * This module provides the base classes and interfaces for implementing
 * provider-specific adapters that integrate with external services.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

// Export NangoAdapter base class and related types
export {
  NangoAdapter,
  type NangoConfig,
  type OAuthToken,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderError,
  type RetryPolicy,
} from './NangoAdapter.js';

// Export ProviderAdapter interface and related types
export {
  type ProviderAdapter,
  type ProviderAdapterResult,
  type ProviderAdapterError,
  BaseProviderAdapter,
} from './ProviderAdapter.js';

// Export HotelSearchAdapter and related types
export {
  HotelSearchAdapter,
  type HotelResult,
  type HotelSearchParams as LegacyHotelSearchParams,
  type HotelSearchResponse,
} from './HotelSearchAdapter.js';

// ── New multi-vertical provider system ──────────────────────────────────────

// Shared normalised types
export type {
  ProviderImage,
  GeoLocation,
  NormalisedHotel,
  HotelSearchParams,
  HotelSearchResult,
  NormalisedTransportOption,
  TransportMode,
  TransportSearchParams,
  TransportSearchResult,
  NormalisedExcursion,
  ExcursionSearchParams,
  ExcursionSearchResult,
  NormalisedRestaurant,
  RestaurantSource,
  RestaurantSearchParams,
  RestaurantSearchResult,
} from './types.js';

// Individual adapters
export { GooglePlacesAdapter } from './GooglePlacesAdapter.js';
export { LiteapiAdapter } from './LiteapiAdapter.js';
export { BookingAffiliateAdapter } from './BookingAffiliateAdapter.js';
export { LogisticsAdapter } from './LogisticsAdapter.js';
export { ViatorAdapter } from './ViatorAdapter.js';
export { RestaurantAdapter } from './RestaurantAdapter.js';

// Router — use this in the webhook / tool handlers
export { ProviderRouter, getProviderRouter } from './ProviderRouter.js';
