/**
 * Unit tests for HotelSearchAdapter
 * 
 * Tests hotel search execution, response normalization, error handling,
 * and structured failure states.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotelSearchAdapter, type HotelResult, type HotelSearchResponse } from './HotelSearchAdapter.js';
import { type NangoConfig, type ProviderResponse } from './NangoAdapter.js';
import { CorrelationContext, ErrorCategory } from '../../types/core.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('HotelSearchAdapter', () => {
  let adapter: HotelSearchAdapter;
  let mockConfig: NangoConfig;
  let mockContext: CorrelationContext;

  beforeEach(() => {
    mockConfig = {
      nangoUrl: 'https://api.test-provider.com',
      secretKey: 'test-secret-key',
      integrationId: 'test-hotel-provider',
      connectionId: 'test-connection',
    };

    mockContext = {
      correlationId: 'test-correlation-id',
      sessionId: 'test-session-id',
      userId: 'test-user-id',
      requestTimestamp: new Date(),
    };

    adapter = new HotelSearchAdapter(mockConfig);
  });

  // ============================================================================
  // Provider Name Tests
  // ============================================================================

  describe('getProviderName', () => {
    it('should return the integration ID as provider name', () => {
      expect(adapter.getProviderName()).toBe('test-hotel-provider');
    });

    it('should return default name if integration ID is not set', () => {
      const configWithoutId = { ...mockConfig, integrationId: '' };
      const adapterWithoutId = new HotelSearchAdapter(configWithoutId);
      expect(adapterWithoutId.getProviderName()).toBe('hotel_search_provider');
    });
  });

  // ============================================================================
  // Build Provider Request Tests
  // ============================================================================

  describe('buildProviderRequest', () => {
    it('should build request with required parameters', () => {
      const params = {
        location: 'Galle, Sri Lanka',
        checkin_date: '2026-04-17',
      };

      const request = adapter.buildProviderRequest(params);

      expect(request.method).toBe('GET');
      expect(request.endpoint).toBe('https://api.test-provider.com/hotels/search');
      expect(request.queryParams).toEqual({
        location: 'Galle, Sri Lanka',
        checkin: '2026-04-17',
      });
      expect(request.headers).toEqual({
        'Accept': 'application/json',
      });
    });

    it('should include optional parameters when provided', () => {
      const params = {
        location: 'Galle',
        checkin_date: '2026-04-17',
        checkout_date: '2026-04-18',
        guests: 2,
        budget: 150,
        currency: 'GBP',
      };

      const request = adapter.buildProviderRequest(params);

      expect(request.queryParams).toEqual({
        location: 'Galle',
        checkin: '2026-04-17',
        checkout: '2026-04-18',
        guests: '2',
        max_price: '150',
        currency: 'GBP',
      });
    });

    it('should omit optional parameters when not provided', () => {
      const params = {
        location: 'Colombo',
        checkin_date: '2026-05-01',
      };

      const request = adapter.buildProviderRequest(params);

      expect(request.queryParams).toEqual({
        location: 'Colombo',
        checkin: '2026-05-01',
      });
      expect(request.queryParams?.checkout).toBeUndefined();
      expect(request.queryParams?.guests).toBeUndefined();
    });
  });

  // ============================================================================
  // Response Normalization Tests
  // ============================================================================

  describe('normalizeResponse', () => {
    it('should normalize provider response with hotels array', () => {
      const rawResponse = {
        hotels: [
          {
            name: 'Grand Hotel',
            price: 120,
            currency: 'USD',
            rating: 4.5,
            reviewCount: 250,
            location: 'Galle Fort',
            distance: 0.5,
            amenities: ['WiFi', 'Pool', 'Restaurant'],
            cancellationPolicy: 'Free cancellation up to 24h',
            bookingToken: 'token123',
          },
        ],
        total: 1,
        searchId: 'search-abc',
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results).toHaveLength(1);
      expect(result.totalResults).toBe(1);
      expect(result.searchId).toBe('search-abc');
      expect(result.results[0]).toEqual({
        name: 'Grand Hotel',
        price: 120,
        currency: 'USD',
        rating: 4.5,
        reviewCount: 250,
        location: 'Galle Fort',
        distance: 0.5,
        amenities: ['WiFi', 'Pool', 'Restaurant'],
        cancellationPolicy: 'Free cancellation up to 24h',
        bookingToken: 'token123',
      });
    });

    it('should handle alternative response field names', () => {
      const rawResponse = {
        results: [
          {
            hotelName: 'Beach Resort',
            pricePerNight: 200,
            currencyCode: 'GBP',
            starRating: 5,
            reviews: 500,
            address: 'Beach Road',
            distanceFromCenter: 2.5,
            facilities: ['Spa', 'Gym'],
            cancellation: 'Non-refundable',
            id: 'hotel-456',
          },
        ],
        totalResults: 1,
        search_id: 'search-xyz',
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe('Beach Resort');
      expect(result.results[0].price).toBe(200);
      expect(result.results[0].currency).toBe('GBP');
      expect(result.results[0].rating).toBe(5);
      expect(result.results[0].reviewCount).toBe(500);
      expect(result.results[0].location).toBe('Beach Road');
      expect(result.results[0].distance).toBe(2.5);
      expect(result.results[0].amenities).toEqual(['Spa', 'Gym']);
      expect(result.results[0].cancellationPolicy).toBe('Non-refundable');
      expect(result.results[0].bookingToken).toBe('hotel-456');
    });

    it('should handle empty results', () => {
      const rawResponse = {
        hotels: [],
        total: 0,
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results).toHaveLength(0);
      expect(result.totalResults).toBe(0);
    });

    it('should handle null or undefined response', () => {
      const result1 = adapter.normalizeResponse(null);
      expect(result1.results).toHaveLength(0);
      expect(result1.totalResults).toBe(0);

      const result2 = adapter.normalizeResponse(undefined);
      expect(result2.results).toHaveLength(0);
      expect(result2.totalResults).toBe(0);
    });

    it('should provide default values for missing hotel fields', () => {
      const rawResponse = {
        hotels: [
          {
            // Minimal data
            id: 'hotel-789',
          },
        ],
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        name: 'Unknown Hotel',
        price: 0,
        currency: 'USD',
        rating: 0,
        reviewCount: 0,
        location: '',
        distance: 0,
        amenities: [],
        cancellationPolicy: 'Contact hotel for details',
        bookingToken: 'hotel-789',
      });
    });

    it('should normalize price from string format', () => {
      const rawResponse = {
        hotels: [
          {
            name: 'Test Hotel',
            price: '$150.50',
            bookingToken: 'token',
          },
        ],
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results[0].price).toBe(150.50);
    });

    it('should normalize price from object format', () => {
      const rawResponse = {
        hotels: [
          {
            name: 'Test Hotel',
            price: { amount: 200, currency: 'EUR' },
            bookingToken: 'token',
          },
        ],
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results[0].price).toBe(200);
    });

    it('should clamp rating to 0-5 range', () => {
      const rawResponse = {
        hotels: [
          { name: 'Hotel 1', rating: -1, bookingToken: 'token1' },
          { name: 'Hotel 2', rating: 10, bookingToken: 'token2' },
          { name: 'Hotel 3', rating: 3.5, bookingToken: 'token3' },
        ],
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results[0].rating).toBe(0);
      expect(result.results[1].rating).toBe(5);
      expect(result.results[2].rating).toBe(3.5);
    });

    it('should normalize amenities from object array', () => {
      const rawResponse = {
        hotels: [
          {
            name: 'Test Hotel',
            amenities: [
              { name: 'WiFi', available: true },
              { name: 'Pool', available: true },
            ],
            bookingToken: 'token',
          },
        ],
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results[0].amenities).toEqual(['WiFi', 'Pool']);
    });

    it('should handle multiple hotels in response', () => {
      const rawResponse = {
        hotels: [
          { name: 'Hotel A', price: 100, bookingToken: 'token-a' },
          { name: 'Hotel B', price: 150, bookingToken: 'token-b' },
          { name: 'Hotel C', price: 200, bookingToken: 'token-c' },
        ],
        total: 3,
      };

      const result = adapter.normalizeResponse(rawResponse);

      expect(result.results).toHaveLength(3);
      expect(result.totalResults).toBe(3);
      expect(result.results[0].name).toBe('Hotel A');
      expect(result.results[1].name).toBe('Hotel B');
      expect(result.results[2].name).toBe('Hotel C');
    });
  });

  // ============================================================================
  // Parameter Validation Tests
  // ============================================================================

  describe('execute - parameter validation', () => {
    it('should throw error when location is missing', async () => {
      const params = {
        checkin_date: '2026-04-17',
      };

      // Mock executeProviderRequest to avoid actual HTTP call
      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue({
        success: true,
        data: { hotels: [] },
      });

      await expect(adapter.execute(params, mockContext)).rejects.toThrow(
        'Missing required parameter: location'
      );
    });

    it('should throw error when checkin_date is missing', async () => {
      const params = {
        location: 'Galle',
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue({
        success: true,
        data: { hotels: [] },
      });

      await expect(adapter.execute(params, mockContext)).rejects.toThrow(
        'Missing required parameter: checkin_date'
      );
    });

    it('should throw error for invalid checkin_date format', async () => {
      const params = {
        location: 'Galle',
        checkin_date: 'invalid-date',
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue({
        success: true,
        data: { hotels: [] },
      });

      await expect(adapter.execute(params, mockContext)).rejects.toThrow(
        'Invalid checkin_date format. Expected YYYY-MM-DD'
      );
    });

    it('should throw error for invalid checkout_date format', async () => {
      const params = {
        location: 'Galle',
        checkin_date: '2026-04-17',
        checkout_date: '17/04/2026',
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue({
        success: true,
        data: { hotels: [] },
      });

      await expect(adapter.execute(params, mockContext)).rejects.toThrow(
        'Invalid checkout_date format. Expected YYYY-MM-DD'
      );
    });

    it('should accept valid parameters', async () => {
      const params = {
        location: 'Galle',
        checkin_date: '2026-04-17',
        checkout_date: '2026-04-18',
      };

      const mockResponse: ProviderResponse = {
        success: true,
        data: {
          hotels: [
            {
              name: 'Test Hotel',
              price: 100,
              bookingToken: 'token',
            },
          ],
        },
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue(mockResponse);

      const result = await adapter.execute(params, mockContext);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe('Test Hotel');
    });
  });

  // ============================================================================
  // Execute Tests
  // ============================================================================

  describe('execute', () => {
    it('should execute hotel search and return normalized results', async () => {
      const params = {
        location: 'Galle',
        checkin_date: '2026-04-17',
        checkout_date: '2026-04-18',
        guests: 2,
      };

      const mockResponse: ProviderResponse = {
        success: true,
        data: {
          hotels: [
            {
              name: 'Grand Hotel',
              price: 120,
              currency: 'USD',
              rating: 4.5,
              reviewCount: 250,
              location: 'Galle Fort',
              distance: 0.5,
              amenities: ['WiFi', 'Pool'],
              cancellationPolicy: 'Free cancellation',
              bookingToken: 'token123',
            },
          ],
          total: 1,
        },
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue(mockResponse);

      const result = await adapter.execute(params, mockContext);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe('Grand Hotel');
      expect(result.results[0].price).toBe(120);
      expect(result.totalResults).toBe(1);
    });

    it('should throw error when provider request fails', async () => {
      const params = {
        location: 'Galle',
        checkin_date: '2026-04-17',
      };

      const mockResponse: ProviderResponse = {
        success: false,
        error: {
          category: ErrorCategory.PROVIDER_FAILURE,
          message: 'Provider timeout',
          retryable: false,
        },
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue(mockResponse);

      await expect(adapter.execute(params, mockContext)).rejects.toThrow(
        'Provider timeout'
      );
    });

    it('should throw generic error when provider fails without error message', async () => {
      const params = {
        location: 'Galle',
        checkin_date: '2026-04-17',
      };

      const mockResponse: ProviderResponse = {
        success: false,
      };

      vi.spyOn(adapter as any, 'executeProviderRequest').mockResolvedValue(mockResponse);

      await expect(adapter.execute(params, mockContext)).rejects.toThrow(
        'Hotel search failed after exhausting retry policy'
      );
    });
  });

  // ============================================================================
  // Retry Policy Tests
  // ============================================================================

  describe('getRetryPolicy', () => {
    it('should return configured retry policy', () => {
      const policy = adapter.getRetryPolicy();

      expect(policy.maxRetries).toBe(3);
      expect(policy.initialDelayMs).toBe(1000);
      expect(policy.maxDelayMs).toBe(10000);
      expect(policy.backoffMultiplier).toBe(2);
      expect(policy.retryableStatusCodes).toEqual([408, 429, 500, 502, 503, 504]);
      expect(policy.retryableErrorCodes).toEqual(['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND']);
    });
  });
});
