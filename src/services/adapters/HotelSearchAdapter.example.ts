/**
 * Example usage of HotelSearchAdapter
 * 
 * Demonstrates how to use the HotelSearchAdapter to search for hotels
 * through a Nango-based provider integration.
 */

import { HotelSearchAdapter, type HotelSearchResponse } from './HotelSearchAdapter.js';
import { type NangoConfig } from './NangoAdapter.js';
import { type CorrelationContext } from '../../types/core.js';

// ============================================================================
// Example 1: Basic Hotel Search
// ============================================================================

async function basicHotelSearch() {
  // Configure Nango adapter
  const config: NangoConfig = {
    nangoUrl: 'https://api.booking.com',
    secretKey: process.env.NANGO_SECRET_KEY || 'your-secret-key',
    integrationId: 'booking_com',
    connectionId: 'user-connection-123',
  };

  // Create adapter instance
  const adapter = new HotelSearchAdapter(config);

  // Create correlation context for tracing
  const context: CorrelationContext = {
    correlationId: 'search-001',
    sessionId: 'session-abc',
    userId: 'user-123',
    requestTimestamp: new Date(),
  };

  // Execute hotel search
  const params = {
    location: 'Galle, Sri Lanka',
    checkin_date: '2026-04-17',
    checkout_date: '2026-04-18',
    guests: 2,
    currency: 'GBP',
  };

  try {
    const results: HotelSearchResponse = await adapter.execute(params, context);

    console.log(`Found ${results.totalResults} hotels`);
    console.log('Search ID:', results.searchId);

    results.results.forEach((hotel, index) => {
      console.log(`\n${index + 1}. ${hotel.name}`);
      console.log(`   Price: ${hotel.currency} ${hotel.price}`);
      console.log(`   Rating: ${hotel.rating}/5 (${hotel.reviewCount} reviews)`);
      console.log(`   Location: ${hotel.location}`);
      console.log(`   Distance: ${hotel.distance} km`);
      console.log(`   Amenities: ${hotel.amenities.join(', ')}`);
      console.log(`   Cancellation: ${hotel.cancellationPolicy}`);
      console.log(`   Booking Token: ${hotel.bookingToken}`);
    });
  } catch (error) {
    console.error('Hotel search failed:', error);
  }
}

// ============================================================================
// Example 2: Search with Minimal Parameters
// ============================================================================

async function minimalHotelSearch() {
  const config: NangoConfig = {
    nangoUrl: 'https://api.booking.com',
    secretKey: process.env.NANGO_SECRET_KEY || 'your-secret-key',
    integrationId: 'booking_com',
    connectionId: 'user-connection-123',
  };

  const adapter = new HotelSearchAdapter(config);

  const context: CorrelationContext = {
    correlationId: 'search-002',
    sessionId: 'session-xyz',
    requestTimestamp: new Date(),
  };

  // Only required parameters
  const params = {
    location: 'Colombo',
    checkin_date: '2026-05-01',
  };

  try {
    const results = await adapter.execute(params, context);
    console.log(`Found ${results.totalResults} hotels in Colombo`);
  } catch (error) {
    console.error('Search failed:', error);
  }
}

// ============================================================================
// Example 3: Search with Budget Filter
// ============================================================================

async function budgetHotelSearch() {
  const config: NangoConfig = {
    nangoUrl: 'https://api.booking.com',
    secretKey: process.env.NANGO_SECRET_KEY || 'your-secret-key',
    integrationId: 'booking_com',
    connectionId: 'user-connection-123',
  };

  const adapter = new HotelSearchAdapter(config);

  const context: CorrelationContext = {
    correlationId: 'search-003',
    sessionId: 'session-budget',
    userId: 'user-456',
    requestTimestamp: new Date(),
  };

  // Search with budget constraint
  const params = {
    location: 'Galle',
    checkin_date: '2026-06-15',
    checkout_date: '2026-06-17',
    guests: 1,
    budget: 100,
    currency: 'USD',
  };

  try {
    const results = await adapter.execute(params, context);

    console.log(`Found ${results.totalResults} hotels under $100/night`);

    // Filter and display affordable options
    const affordableHotels = results.results.filter(
      hotel => hotel.price <= 100
    );

    affordableHotels.forEach(hotel => {
      console.log(`${hotel.name}: ${hotel.currency} ${hotel.price}`);
    });
  } catch (error) {
    console.error('Budget search failed:', error);
  }
}

// ============================================================================
// Example 4: Handle Provider Failures
// ============================================================================

async function handleProviderFailure() {
  const config: NangoConfig = {
    nangoUrl: 'https://api.booking.com',
    secretKey: process.env.NANGO_SECRET_KEY || 'your-secret-key',
    integrationId: 'booking_com',
    connectionId: 'user-connection-123',
  };

  const adapter = new HotelSearchAdapter(config);

  const context: CorrelationContext = {
    correlationId: 'search-004',
    sessionId: 'session-error',
    requestTimestamp: new Date(),
  };

  const params = {
    location: 'Galle',
    checkin_date: '2026-04-17',
  };

  try {
    const results = await adapter.execute(params, context);
    console.log('Search succeeded:', results);
  } catch (error) {
    // Handle different error scenarios
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        console.error('Provider timeout - please try again');
      } else if (error.message.includes('exhausting retry policy')) {
        console.error('Provider unavailable after retries');
        // Trigger fallback or human handoff
      } else if (error.message.includes('Missing required parameter')) {
        console.error('Invalid parameters:', error.message);
        // Request missing fields from user
      } else {
        console.error('Unexpected error:', error.message);
      }
    }
  }
}

// ============================================================================
// Example 5: Check Retry Policy
// ============================================================================

function checkRetryPolicy() {
  const config: NangoConfig = {
    nangoUrl: 'https://api.booking.com',
    secretKey: 'test-key',
    integrationId: 'booking_com',
    connectionId: 'test-connection',
  };

  const adapter = new HotelSearchAdapter(config);
  const policy = adapter.getRetryPolicy();

  console.log('Retry Policy Configuration:');
  console.log('  Max Retries:', policy.maxRetries);
  console.log('  Initial Delay:', policy.initialDelayMs, 'ms');
  console.log('  Max Delay:', policy.maxDelayMs, 'ms');
  console.log('  Backoff Multiplier:', policy.backoffMultiplier);
  console.log('  Retryable Status Codes:', policy.retryableStatusCodes);
  console.log('  Retryable Error Codes:', policy.retryableErrorCodes);
}

// ============================================================================
// Example 6: Normalize Raw Provider Response
// ============================================================================

function normalizeProviderResponse() {
  const config: NangoConfig = {
    nangoUrl: 'https://api.booking.com',
    secretKey: 'test-key',
    integrationId: 'booking_com',
    connectionId: 'test-connection',
  };

  const adapter = new HotelSearchAdapter(config);

  // Simulate raw provider response
  const rawResponse = {
    hotels: [
      {
        name: 'Grand Hotel',
        price: '$120.00',
        rating: 4.5,
        reviewCount: 250,
        location: 'Galle Fort',
        amenities: ['WiFi', 'Pool', 'Restaurant'],
        bookingToken: 'token123',
      },
    ],
    total: 1,
  };

  // Normalize to internal format
  const normalized = adapter.normalizeResponse(rawResponse);

  console.log('Normalized Response:');
  console.log(JSON.stringify(normalized, null, 2));
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExamples() {
  console.log('=== HotelSearchAdapter Examples ===\n');

  console.log('Example 1: Basic Hotel Search');
  // await basicHotelSearch();

  console.log('\nExample 2: Minimal Hotel Search');
  // await minimalHotelSearch();

  console.log('\nExample 3: Budget Hotel Search');
  // await budgetHotelSearch();

  console.log('\nExample 4: Handle Provider Failure');
  // await handleProviderFailure();

  console.log('\nExample 5: Check Retry Policy');
  checkRetryPolicy();

  console.log('\nExample 6: Normalize Provider Response');
  normalizeProviderResponse();
}

// Uncomment to run examples
// runExamples();

export {
  basicHotelSearch,
  minimalHotelSearch,
  budgetHotelSearch,
  handleProviderFailure,
  checkRetryPolicy,
  normalizeProviderResponse,
};
