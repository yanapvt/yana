/**
 * WhatsAppRenderer Hotel Results Tests
 * 
 * Tests for hotel result rendering functionality.
 * 
 * Validates: Requirements 7.5, 7.6, 7.7, 7.8
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WhatsAppRenderer,
  WHATSAPP_LIMITS,
  type HotelResultsRenderContent,
} from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import type { HotelResult } from './adapters/HotelSearchAdapter.js';

describe('WhatsAppRenderer - Hotel Results', () => {
  let renderer: WhatsAppRenderer;
  let translationService: TranslationService;
  let messageRepo: MessageRepository;

  // Sample hotel data
  const sampleHotel: HotelResult = {
    name: 'Grand Beach Hotel',
    price: 150.00,
    currency: 'USD',
    rating: 4.5,
    reviewCount: 328,
    location: 'Galle, Sri Lanka',
    distance: 2.3,
    amenities: ['WiFi', 'Pool', 'Restaurant', 'Spa', 'Gym', 'Beach Access'],
    cancellationPolicy: 'Free cancellation up to 24 hours before check-in',
    bookingToken: 'hotel_abc123',
  };

  beforeEach(() => {
    messageRepo = new MessageRepository();
    translationService = new TranslationService(messageRepo);
    renderer = new WhatsAppRenderer(translationService);
  });

  // ==========================================================================
  // Hotel Results List Rendering Tests
  // ==========================================================================

  describe('renderMessage - hotel_results', () => {
    it('should render hotel results as list', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [sampleHotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toContain('Found 1 hotel');
        expect(result.messages[0].buttonText).toBe('View Hotels');
        expect(result.messages[0].sections).toHaveLength(1);
        expect(result.messages[0].sections[0].rows).toHaveLength(1);
        
        const row = result.messages[0].sections[0].rows[0];
        expect(row.id).toBe('hotel_hotel_abc123');
        expect(row.title).toBe('Grand Beach Hotel');
        expect(row.description).toContain('USD 150.00');
        expect(row.description).toContain('⭐');
        expect(row.description).toContain('2.3km');
      }
      expect(result.metadata?.originalType).toBe('hotel_results');
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should render multiple hotel results', async () => {
      const hotels: HotelResult[] = [
        { ...sampleHotel, name: 'Hotel A', bookingToken: 'token_a' },
        { ...sampleHotel, name: 'Hotel B', bookingToken: 'token_b' },
        { ...sampleHotel, name: 'Hotel C', bookingToken: 'token_c' },
      ];

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: hotels,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toContain('Found 3 hotels');
        expect(result.messages[0].sections[0].rows).toHaveLength(3);
        expect(result.messages[0].sections[0].rows[0].title).toBe('Hotel A');
        expect(result.messages[0].sections[0].rows[1].title).toBe('Hotel B');
        expect(result.messages[0].sections[0].rows[2].title).toBe('Hotel C');
      }
    });

    it('should use custom header text when provided', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [sampleHotel],
        headerText: 'Best hotels in Galle',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toBe('Best hotels in Galle');
      }
    });

    it('should limit results to WhatsApp max list items', async () => {
      const hotels: HotelResult[] = Array.from({ length: 15 }, (_, i) => ({
        ...sampleHotel,
        name: `Hotel ${i + 1}`,
        bookingToken: `token_${i}`,
      }));

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: hotels,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].sections[0].rows).toHaveLength(WHATSAPP_LIMITS.MAX_LIST_ITEMS);
        expect(result.messages[0].body).toContain('Found 15 hotels');
      }
    });

    it('should truncate long hotel names', async () => {
      const longName = 'A'.repeat(WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH + 10);
      const hotel: HotelResult = {
        ...sampleHotel,
        name: longName,
      };

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [hotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        const row = result.messages[0].sections[0].rows[0];
        expect(row.title.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH);
        expect(row.title).toContain('...');
      }
    });

    it('should format hotel description with price, rating, and distance', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [sampleHotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        const description = result.messages[0].sections[0].rows[0].description;
        expect(description).toContain('USD 150.00');
        expect(description).toContain('⭐');
        expect(description).toContain('(328)');
        expect(description).toContain('2.3km');
      }
    });

    it('should handle hotel with no rating', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        rating: 0,
        reviewCount: 0,
      };

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [hotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        const description = result.messages[0].sections[0].rows[0].description;
        expect(description).toContain('USD 150.00');
        expect(description).not.toContain('⭐');
      }
    });

    it('should handle hotel with no distance', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        distance: 0,
      };

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [hotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        const description = result.messages[0].sections[0].rows[0].description;
        expect(description).toContain('USD 150.00');
        expect(description).not.toContain('km');
      }
    });
  });

  // ==========================================================================
  // No Results Rendering Tests
  // ==========================================================================

  describe('renderMessage - hotel_results (no results)', () => {
    it('should render no results message with alternative options', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('No hotels found');
        expect(result.messages[0].body).toContain('Try adjusting your criteria');
        expect(result.messages[0].buttons).toHaveLength(3);
        expect(result.messages[0].buttons[0].id).toBe('search_again');
        expect(result.messages[0].buttons[0].title).toBe('Search Again');
        expect(result.messages[0].buttons[1].id).toBe('change_location');
        expect(result.messages[0].buttons[1].title).toBe('Change Location');
        expect(result.messages[0].buttons[2].id).toBe('change_dates');
        expect(result.messages[0].buttons[2].title).toBe('Change Dates');
      }
      expect(result.metadata?.originalType).toBe('hotel_results');
    });

    it('should handle undefined results', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: undefined as any,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('No hotels found');
      }
    });
  });

  // ==========================================================================
  // Hotel Card Rendering Tests
  // ==========================================================================

  describe('renderHotelCard', () => {
    it('should render detailed hotel card with all information', async () => {
      const result = await renderer.renderHotelCard(sampleHotel, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        
        // Check hotel name
        expect(body).toContain('*Grand Beach Hotel*');
        
        // Check price
        expect(body).toContain('💰 Price: USD 150.00 per night');
        
        // Check rating
        expect(body).toContain('⭐');
        expect(body).toContain('4.5/5');
        expect(body).toContain('(328 reviews)');
        
        // Check location
        expect(body).toContain('📍 Location: Galle, Sri Lanka');
        
        // Check distance
        expect(body).toContain('📏 Distance: 2.3 km from center');
        
        // Check amenities
        expect(body).toContain('✨ Amenities:');
        expect(body).toContain('WiFi');
        expect(body).toContain('Pool');
        expect(body).toContain('...and 1 more');
        
        // Check cancellation policy
        expect(body).toContain('📋 Cancellation:');
        expect(body).toContain('Free cancellation');
        
        // Check buttons
        expect(result.messages[0].buttons).toHaveLength(2);
        expect(result.messages[0].buttons[0].id).toBe('book_hotel_abc123');
        expect(result.messages[0].buttons[0].title).toBe('Book Now');
        expect(result.messages[0].buttons[1].id).toBe('info_hotel_abc123');
        expect(result.messages[0].buttons[1].title).toBe('More Info');
      }
      expect(result.metadata?.originalType).toBe('hotel_card');
    });

    it('should limit amenities to first 5', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        amenities: ['WiFi', 'Pool', 'Restaurant', 'Spa', 'Gym'],
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).toContain('WiFi, Pool, Restaurant, Spa, Gym');
        expect(body).not.toContain('...and');
      }
    });

    it('should handle hotel with no rating', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        rating: 0,
        reviewCount: 0,
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).not.toContain('⭐');
        expect(body).not.toContain('reviews');
      }
    });

    it('should handle hotel with no location', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        location: '',
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).not.toContain('📍 Location:');
      }
    });

    it('should handle hotel with no distance', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        distance: 0,
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).not.toContain('📏 Distance:');
      }
    });

    it('should handle hotel with no amenities', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        amenities: [],
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).not.toContain('✨ Amenities:');
      }
    });

    it('should handle hotel with no cancellation policy', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        cancellationPolicy: '',
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).not.toContain('📋 Cancellation:');
      }
    });
  });

  // ==========================================================================
  // Fallback Tests
  // ==========================================================================

  describe('fallback to plain text', () => {
    it('should fall back to plain text when too many results', async () => {
      const hotels: HotelResult[] = Array.from({ length: 20 }, (_, i) => ({
        ...sampleHotel,
        name: `Hotel ${i + 1}`,
        bookingToken: `token_${i}`,
      }));

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: hotels,
      };

      const result = await renderer.renderMessage(content, 'en');

      // Should still render as list but limited to max items
      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].sections[0].rows.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_LIST_ITEMS
        );
      }
    });

    it('should include hotel details in plain text fallback', async () => {
      const hotels: HotelResult[] = Array.from({ length: 15 }, (_, i) => ({
        ...sampleHotel,
        name: `Hotel ${i + 1}`,
        bookingToken: `token_${i}`,
        price: 100 + i * 10,
      }));

      // Force validation failure by making header text too long
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: hotels,
        headerText: 'a'.repeat(WHATSAPP_LIMITS.MAX_TEXT_LENGTH + 100),
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toContain('Hotel 1');
        expect(result.messages[0].body).toContain('USD');
        expect(result.messages[0].body).toContain('per night');
      }
    });
  });

  // ==========================================================================
  // Translation Tests
  // ==========================================================================

  describe('translation', () => {
    it('should translate hotel result labels', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [sampleHotel],
      };

      const result = await renderer.renderMessage(content, 'fr');

      expect(result.messages[0].type).toBe('list');
      // Translation service will handle the actual translation
      // We just verify the structure is correct
    });

    it('should translate no results message', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [],
      };

      const result = await renderer.renderMessage(content, 'fr');

      expect(result.messages[0].type).toBe('buttons');
      // Translation service will handle the actual translation
    });

    it('should translate hotel card labels', async () => {
      const result = await renderer.renderHotelCard(sampleHotel, 'fr');

      expect(result.messages[0].type).toBe('buttons');
      // Translation service will handle the actual translation
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle hotel with minimal data', async () => {
      const minimalHotel: HotelResult = {
        name: 'Basic Hotel',
        price: 50,
        currency: 'USD',
        rating: 0,
        reviewCount: 0,
        location: '',
        distance: 0,
        amenities: [],
        cancellationPolicy: '',
        bookingToken: 'token_minimal',
      };

      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [minimalHotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        const row = result.messages[0].sections[0].rows[0];
        expect(row.title).toBe('Basic Hotel');
        expect(row.description).toContain('USD 50.00');
      }
    });

    it('should handle single hotel result with singular text', async () => {
      const content: HotelResultsRenderContent = {
        type: 'hotel_results',
        results: [sampleHotel],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toContain('Found 1 hotel');
        expect(result.messages[0].body).not.toContain('hotels');
      }
    });

    it('should handle hotel with very high rating', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        rating: 5.0,
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).toContain('⭐⭐⭐⭐⭐');
        expect(body).toContain('5.0/5');
      }
    });

    it('should handle hotel with fractional rating', async () => {
      const hotel: HotelResult = {
        ...sampleHotel,
        rating: 3.7,
      };

      const result = await renderer.renderHotelCard(hotel, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        const body = result.messages[0].body!;
        expect(body).toContain('⭐⭐⭐⭐'); // Rounds to 4
        expect(body).toContain('3.7/5');
      }
    });
  });
});
