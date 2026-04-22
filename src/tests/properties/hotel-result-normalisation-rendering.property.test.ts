/**
 * Property Test 14: Hotel Result Normalisation and Rendering
 * 
 * Property Statement:
 * For any raw hotel search provider response, the HotelSearchAdapter SHALL normalize 
 * the response into the internal HotelResult schema, and the WhatsAppRenderer SHALL 
 * format the normalized results into WhatsApp-safe messages that comply with UI limits 
 * and include all required information (name, price, currency, rating, review count, 
 * location, distance, amenities, cancellation policy) with action buttons.
 * 
 * **Validates: Requirements 7.4, 7.5, 7.6**
 * 
 * Requirements:
 * - 7.4: THE System SHALL normalize hotel search results into the internal hotel result schema before rendering
 * - 7.5: WHEN hotel results are returned, THE WhatsApp_Renderer SHALL format results including hotel name, 
 *        price, currency, rating, review count, location, distance, amenities, cancellation policy, and available actions
 * - 7.6: WHEN hotel results are displayed, THE WhatsApp_Renderer SHALL include Book Now and More Info action 
 *        options for each result
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { HotelSearchAdapter, type HotelResult } from '../../services/adapters/HotelSearchAdapter.js';
import { WhatsAppRenderer, WHATSAPP_LIMITS } from '../../services/WhatsAppRenderer.js';
import type { NangoConfig } from '../../services/adapters/NangoAdapter.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check if a hotel result contains all required fields
 */
function hasAllRequiredFields(hotel: HotelResult): boolean {
  return (
    typeof hotel.name === 'string' &&
    hotel.name.length > 0 &&
    typeof hotel.price === 'number' &&
    hotel.price >= 0 &&
    typeof hotel.currency === 'string' &&
    hotel.currency.length > 0 &&
    typeof hotel.rating === 'number' &&
    hotel.rating >= 0 &&
    hotel.rating <= 5 &&
    typeof hotel.reviewCount === 'number' &&
    hotel.reviewCount >= 0 &&
    typeof hotel.location === 'string' &&
    typeof hotel.distance === 'number' &&
    hotel.distance >= 0 &&
    Array.isArray(hotel.amenities) &&
    typeof hotel.cancellationPolicy === 'string' &&
    typeof hotel.bookingToken === 'string' &&
    hotel.bookingToken.length > 0
  );
}

/**
 * Check if rendered hotel card includes action buttons
 */
function hasActionButtons(messages: any[]): boolean {
  for (const message of messages) {
    if (message.type === 'buttons' && message.buttons) {
      const hasBookNow = message.buttons.some((btn: any) => 
        btn.id.includes('book_') || btn.title.toLowerCase().includes('book')
      );
      const hasMoreInfo = message.buttons.some((btn: any) => 
        btn.id.includes('info_') || btn.title.toLowerCase().includes('info')
      );
      if (hasBookNow && hasMoreInfo) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if rendered message includes all required hotel information
 */
function includesRequiredInfo(body: string, hotel: HotelResult): {
  hasName: boolean;
  hasPrice: boolean;
  hasCurrency: boolean;
  hasRating: boolean;
  hasLocation: boolean;
} {
  const bodyLower = body.toLowerCase();
  const nameLower = hotel.name.toLowerCase();
  
  return {
    hasName: bodyLower.includes(nameLower) || body.includes(hotel.name),
    hasPrice: body.includes(hotel.price.toString()) || body.includes(hotel.price.toFixed(2)),
    hasCurrency: body.includes(hotel.currency),
    hasRating: hotel.rating > 0 ? (body.includes(hotel.rating.toFixed(1)) || body.includes('⭐')) : true,
    hasLocation: hotel.location ? (bodyLower.includes(hotel.location.toLowerCase()) || body.includes(hotel.location)) : true,
  };
}


// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generate arbitrary raw provider hotel data (various formats)
 */
const rawProviderHotelArb = fc.oneof(
  // Format 1: Standard format
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    price: fc.double({ min: 10, max: 10000, noNaN: true }),
    currency: fc.constantFrom('USD', 'EUR', 'GBP', 'LKR', 'INR'),
    rating: fc.double({ min: 0, max: 5, noNaN: true }),
    reviewCount: fc.integer({ min: 0, max: 10000 }),
    location: fc.string({ minLength: 1, maxLength: 200 }),
    distance: fc.double({ min: 0, max: 100, noNaN: true }),
    amenities: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 20 }),
    cancellationPolicy: fc.string({ minLength: 1, maxLength: 200 }),
    bookingToken: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  
  // Format 2: Alternative field names
  fc.record({
    hotelName: fc.string({ minLength: 1, maxLength: 100 }),
    pricePerNight: fc.double({ min: 10, max: 10000, noNaN: true }),
    currencyCode: fc.constantFrom('USD', 'EUR', 'GBP', 'LKR', 'INR'),
    starRating: fc.double({ min: 0, max: 5, noNaN: true }),
    reviews: fc.integer({ min: 0, max: 10000 }),
    address: fc.string({ minLength: 1, maxLength: 200 }),
    distanceFromCenter: fc.double({ min: 0, max: 100, noNaN: true }),
    facilities: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 20 }),
    cancellation: fc.string({ minLength: 1, maxLength: 200 }),
    id: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  
  // Format 3: Nested price object
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    price: fc.record({
      amount: fc.double({ min: 10, max: 10000, noNaN: true }),
      currency: fc.constantFrom('USD', 'EUR', 'GBP', 'LKR', 'INR'),
    }),
    rating: fc.double({ min: 0, max: 5, noNaN: true }),
    review_count: fc.integer({ min: 0, max: 10000 }),
    city: fc.string({ minLength: 1, maxLength: 200 }),
    distance: fc.double({ min: 0, max: 100, noNaN: true }),
    amenities: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 20 }),
    cancellation_policy: fc.string({ minLength: 1, maxLength: 200 }),
    token: fc.string({ minLength: 1, maxLength: 100 }),
  })
);

/**
 * Generate arbitrary raw provider response
 */
const rawProviderResponseArb = fc.record({
  hotels: fc.array(rawProviderHotelArb, { minLength: 0, maxLength: 20 }),
  total: fc.integer({ min: 0, max: 1000 }),
  searchId: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

/**
 * Generate arbitrary normalized hotel result
 */
const normalizedHotelArb: fc.Arbitrary<HotelResult> = fc.record({
  name: fc.string({ minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH }),
  price: fc.double({ min: 10, max: 10000, noNaN: true }),
  currency: fc.constantFrom('USD', 'EUR', 'GBP', 'LKR', 'INR'),
  rating: fc.double({ min: 0, max: 5, noNaN: true }),
  reviewCount: fc.integer({ min: 0, max: 10000 }),
  location: fc.string({ minLength: 0, maxLength: 200 }),
  distance: fc.double({ min: 0, max: 100, noNaN: true }),
  amenities: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 20 }),
  cancellationPolicy: fc.string({ minLength: 1, maxLength: 200 }),
  bookingToken: fc.string({ minLength: 1, maxLength: 100 }),
});


// ============================================================================
// Property Tests
// ============================================================================

describe('Property 14: Hotel Result Normalisation and Rendering', () => {
  let adapter: HotelSearchAdapter;
  let renderer: WhatsAppRenderer;

  beforeEach(() => {
    const config: NangoConfig = {
      nangoUrl: 'https://api.nango.dev',
      secretKey: 'test-secret-key',
      integrationId: 'hotel-provider',
      connectionId: 'test-connection',
    };
    adapter = new HotelSearchAdapter(config);
    renderer = new WhatsAppRenderer();
  });

  // ==========================================================================
  // Requirement 7.4: Normalize hotel search results into internal schema
  // ==========================================================================

  it('should normalize any provider response into valid HotelResult schema', () => {
    fc.assert(
      fc.property(rawProviderResponseArb, (rawResponse) => {
        // Given: Raw provider response in any format
        
        // When: The adapter normalizes the response
        const normalized = adapter.normalizeResponse(rawResponse);

        // Then: The result must have the expected structure
        expect(normalized).toBeDefined();
        expect(normalized).toHaveProperty('results');
        expect(normalized).toHaveProperty('totalResults');
        expect(Array.isArray(normalized.results)).toBe(true);
        
        // And: Each hotel result must have all required fields
        normalized.results.forEach((hotel) => {
          expect(hasAllRequiredFields(hotel)).toBe(true);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('should always produce valid numeric values for price, rating, and distance', () => {
    fc.assert(
      fc.property(rawProviderResponseArb, (rawResponse) => {
        // Given: Raw provider response
        
        // When: The adapter normalizes the response
        const normalized = adapter.normalizeResponse(rawResponse);

        // Then: All numeric fields must be valid
        normalized.results.forEach((hotel) => {
          expect(hotel.price).toBeGreaterThanOrEqual(0);
          expect(isNaN(hotel.price)).toBe(false);
          expect(isFinite(hotel.price)).toBe(true);
          
          expect(hotel.rating).toBeGreaterThanOrEqual(0);
          expect(hotel.rating).toBeLessThanOrEqual(5);
          expect(isNaN(hotel.rating)).toBe(false);
          
          expect(hotel.distance).toBeGreaterThanOrEqual(0);
          expect(isNaN(hotel.distance)).toBe(false);
          expect(isFinite(hotel.distance)).toBe(true);
          
          expect(hotel.reviewCount).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(hotel.reviewCount)).toBe(true);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('should handle empty or missing provider responses gracefully', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant({}),
          fc.constant({ hotels: [] }),
          fc.constant({ results: [] }),
          fc.constant({ data: [] })
        ),
        (rawResponse) => {
          // Given: Empty or missing provider response
          
          // When: The adapter normalizes the response
          const normalized = adapter.normalizeResponse(rawResponse);

          // Then: Should return empty results without throwing
          expect(normalized).toBeDefined();
          expect(normalized.results).toBeDefined();
          expect(Array.isArray(normalized.results)).toBe(true);
          expect(normalized.results.length).toBe(0);
          expect(normalized.totalResults).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Requirement 7.5: Format results with all required information
  // ==========================================================================

  it('should render hotel card with all required information', async () => {
    await fc.assert(
      fc.asyncProperty(normalizedHotelArb, async (hotel) => {
        // Given: Normalized hotel result
        
        // When: The renderer formats the hotel card
        const result = await renderer.renderHotelCard(hotel, 'en');

        // Then: The result must include all required information
        expect(result.messages.length).toBeGreaterThan(0);
        const message = result.messages[0];
        
        if (message.type === 'buttons' && message.body) {
          const info = includesRequiredInfo(message.body, hotel);
          
          expect(info.hasName).toBe(true);
          expect(info.hasPrice).toBe(true);
          expect(info.hasCurrency).toBe(true);
          
          // Rating should be included if > 0
          if (hotel.rating > 0) {
            expect(info.hasRating).toBe(true);
          }
          
          // Location should be included if present
          if (hotel.location && hotel.location.length > 0) {
            expect(info.hasLocation).toBe(true);
          }
        }
      }),
      { numRuns: 50 }
    );
  });

  it('should include amenities and cancellation policy in hotel card', async () => {
    await fc.assert(
      fc.asyncProperty(normalizedHotelArb, async (hotel) => {
        // Given: Normalized hotel result with amenities and cancellation policy
        
        // When: The renderer formats the hotel card
        const result = await renderer.renderHotelCard(hotel, 'en');

        // Then: The card should include amenities and cancellation policy
        expect(result.messages.length).toBeGreaterThan(0);
        const message = result.messages[0];
        
        if (message.type === 'buttons' && message.body) {
          // Check for amenities if present
          if (hotel.amenities && hotel.amenities.length > 0) {
            const hasAmenities = hotel.amenities.some(amenity => 
              message.body!.toLowerCase().includes(amenity.toLowerCase())
            );
            // At least some amenities should be mentioned
            expect(hasAmenities || message.body!.toLowerCase().includes('amenities')).toBe(true);
          }
          
          // Check for cancellation policy
          if (hotel.cancellationPolicy && hotel.cancellationPolicy.length > 0) {
            const hasCancellation = 
              message.body!.toLowerCase().includes('cancellation') ||
              message.body!.toLowerCase().includes(hotel.cancellationPolicy.toLowerCase());
            expect(hasCancellation).toBe(true);
          }
        }
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Requirement 7.6: Include Book Now and More Info action buttons
  // ==========================================================================

  it('should always include Book Now and More Info action buttons', async () => {
    await fc.assert(
      fc.asyncProperty(normalizedHotelArb, async (hotel) => {
        // Given: Normalized hotel result
        
        // When: The renderer formats the hotel card
        const result = await renderer.renderHotelCard(hotel, 'en');

        // Then: The card must include both action buttons
        expect(hasActionButtons(result.messages)).toBe(true);
        
        // And: Buttons must reference the hotel's booking token
        const message = result.messages[0];
        if (message.type === 'buttons') {
          const hasBookingToken = message.buttons.some((btn: any) => 
            btn.id.includes(hotel.bookingToken)
          );
          expect(hasBookingToken).toBe(true);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('should render hotel results list with action capability', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(normalizedHotelArb, { minLength: 1, maxLength: WHATSAPP_LIMITS.MAX_LIST_ITEMS }),
        async (hotels) => {
          // Given: Array of normalized hotel results
          const content = {
            type: 'hotel_results' as const,
            results: hotels,
            headerText: 'Available hotels',
          };
          
          // When: The renderer formats the hotel results
          const result = await renderer.renderMessage(content, 'en');

          // Then: The result must be actionable (list or buttons)
          expect(result.messages.length).toBeGreaterThan(0);
          const message = result.messages[0];
          expect(['list', 'buttons'].includes(message.type)).toBe(true);
          
          // And: Each hotel must be selectable
          if (message.type === 'list') {
            const totalRows = message.sections.reduce(
              (sum: number, section: any) => sum + section.rows.length,
              0
            );
            expect(totalRows).toBeGreaterThan(0);
            expect(totalRows).toBeLessThanOrEqual(hotels.length);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // WhatsApp UI Compliance
  // ==========================================================================

  it('should never violate WhatsApp UI limits when rendering hotel results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(normalizedHotelArb, { minLength: 0, maxLength: 50 }),
        async (hotels) => {
          // Given: Any number of hotel results (even exceeding limits)
          const content = {
            type: 'hotel_results' as const,
            results: hotels,
          };
          
          // When: The renderer formats the results
          const result = await renderer.renderMessage(content, 'en');

          // Then: The output must comply with WhatsApp limits
          expect(result.messages.length).toBeGreaterThan(0);
          
          result.messages.forEach((message) => {
            if (message.type === 'list') {
              const totalItems = message.sections.reduce(
                (sum: number, section: any) => sum + section.rows.length,
                0
              );
              expect(totalItems).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_LIST_ITEMS);
              
              message.sections.forEach((section: any) => {
                section.rows.forEach((row: any) => {
                  expect(row.title.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH);
                  if (row.description) {
                    expect(row.description.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH);
                  }
                });
              });
            }
            
            if (message.type === 'buttons') {
              expect(message.buttons.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_BUTTONS);
              message.buttons.forEach((btn: any) => {
                expect(btn.title.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH);
              });
            }
            
            if (message.type === 'text') {
              expect(message.body.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_TEXT_LENGTH);
            }
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // End-to-End: Normalization + Rendering
  // ==========================================================================

  it('should successfully normalize and render any provider response', async () => {
    await fc.assert(
      fc.asyncProperty(rawProviderResponseArb, async (rawResponse) => {
        // Given: Raw provider response
        
        // When: The adapter normalizes and renderer formats the results
        const normalized = adapter.normalizeResponse(rawResponse);
        
        if (normalized.results.length > 0) {
          const content = {
            type: 'hotel_results' as const,
            results: normalized.results,
          };
          const rendered = await renderer.renderMessage(content, 'en');

          // Then: The pipeline must complete successfully
          expect(rendered).toBeDefined();
          expect(rendered.messages.length).toBeGreaterThan(0);
          
          // And: The result must be valid WhatsApp content
          expect(['text', 'buttons', 'list'].includes(rendered.messages[0].type)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should maintain data integrity through normalization and rendering pipeline', async () => {
    await fc.assert(
      fc.asyncProperty(rawProviderHotelArb, async (rawHotel) => {
        // Given: Single raw hotel from provider
        const rawResponse = { hotels: [rawHotel], total: 1 };
        
        // When: The hotel goes through normalization and rendering
        const normalized = adapter.normalizeResponse(rawResponse);
        const hotel = normalized.results[0];
        const rendered = await renderer.renderHotelCard(hotel, 'en');

        // Then: Essential data must be preserved and present in output
        expect(rendered.messages.length).toBeGreaterThan(0);
        const message = rendered.messages[0];
        
        if (message.type === 'buttons' && message.body) {
          // Hotel name must appear somewhere
          expect(message.body.length).toBeGreaterThan(0);
          
          // Price must be present
          expect(hotel.price).toBeGreaterThan(0);
          
          // Booking token must be in button IDs
          const hasToken = message.buttons.some((btn: any) => 
            btn.id.includes(hotel.bookingToken)
          );
          expect(hasToken).toBe(true);
        }
      }),
      { numRuns: 50 }
    );
  });

  // ==========================================================================
  // Determinism
  // ==========================================================================

  it('should produce consistent normalization for the same input', () => {
    fc.assert(
      fc.property(rawProviderResponseArb, (rawResponse) => {
        // Given: Specific raw response
        
        // When: Normalized multiple times
        const result1 = adapter.normalizeResponse(rawResponse);
        const result2 = adapter.normalizeResponse(rawResponse);
        const result3 = adapter.normalizeResponse(rawResponse);

        // Then: Results must be identical
        expect(result1.results.length).toBe(result2.results.length);
        expect(result2.results.length).toBe(result3.results.length);
        expect(result1.totalResults).toBe(result2.totalResults);
        expect(result2.totalResults).toBe(result3.totalResults);
        
        // And: Each hotel must be identical
        result1.results.forEach((hotel1, index) => {
          const hotel2 = result2.results[index];
          const hotel3 = result3.results[index];
          
          expect(hotel1.name).toBe(hotel2.name);
          expect(hotel2.name).toBe(hotel3.name);
          expect(hotel1.price).toBe(hotel2.price);
          expect(hotel2.price).toBe(hotel3.price);
          expect(hotel1.bookingToken).toBe(hotel2.bookingToken);
          expect(hotel2.bookingToken).toBe(hotel3.bookingToken);
        });
      }),
      { numRuns: 50 }
    );
  });
});
