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
  type HotelSearchParams,
  type HotelSearchResponse,
} from './HotelSearchAdapter.js';
