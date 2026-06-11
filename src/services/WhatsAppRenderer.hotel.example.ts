/**
 * WhatsAppRenderer Hotel Results - Example Usage
 * 
 * Demonstrates how to render hotel search results using WhatsAppRenderer.
 * 
 * Validates: Requirements 7.5, 7.6, 7.7, 7.8
 */

import { WhatsAppRenderer } from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import type { HotelResult } from './adapters/HotelSearchAdapter.js';
import type { HotelResultsRenderContent } from './WhatsAppRenderer.js';

// Initialize services
const messageRepo = new MessageRepository();
const translationService = new TranslationService(messageRepo);
const renderer = new WhatsAppRenderer(translationService);

// Sample hotel data
const sampleHotels: HotelResult[] = [
  {
    name: 'Grand Beach Resort',
    price: 150.00,
    currency: 'USD',
    rating: 4.5,
    reviewCount: 328,
    location: 'Galle, Sri Lanka',
    distance: 2.3,
    amenities: ['WiFi', 'Pool', 'Restaurant', 'Spa', 'Gym', 'Beach Access'],
    cancellationPolicy: 'Free cancellation up to 24 hours before check-in',
    bookingToken: 'hotel_abc123',
  },
  {
    name: 'City Center Hotel',
    price: 95.00,
    currency: 'USD',
    rating: 4.2,
    reviewCount: 156,
    location: 'Galle Fort, Sri Lanka',
    distance: 0.5,
    amenities: ['WiFi', 'Restaurant', 'Parking'],
    cancellationPolicy: 'Non-refundable',
    bookingToken: 'hotel_def456',
  },
  {
    name: 'Budget Inn',
    price: 45.00,
    currency: 'USD',
    rating: 3.8,
    reviewCount: 89,
    location: 'Galle, Sri Lanka',
    distance: 3.1,
    amenities: ['WiFi', 'Parking'],
    cancellationPolicy: 'Free cancellation up to 48 hours before check-in',
    bookingToken: 'hotel_ghi789',
  },
];

// =============================================================================
// Example 1: Render hotel search results as list
// =============================================================================

async function example1_renderHotelResultsList() {
  console.log('\n=== Example 1: Render Hotel Results List ===\n');

  const content: HotelResultsRenderContent = {
    type: 'hotel_results',
    results: sampleHotels,
  };

  const result = await renderer.renderMessage(content, 'en');

  console.log('Message Type:', result.messages[0].type);
  console.log('Metadata:', result.metadata);
  
  if (result.messages[0].type === 'list') {
    console.log('Body:', result.messages[0].body);
    console.log('Button Text:', result.messages[0].buttonText);
    console.log('Number of Hotels:', result.messages[0].sections[0].rows.length);
    console.log('\nHotel List Items:');
    result.messages[0].sections[0].rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.title}`);
      console.log(`     ${row.description}`);
      console.log(`     ID: ${row.id}`);
    });
  }
}

// =============================================================================
// Example 2: Render hotel results with custom header
// =============================================================================

async function example2_renderWithCustomHeader() {
  console.log('\n=== Example 2: Render with Custom Header ===\n');

  const content: HotelResultsRenderContent = {
    type: 'hotel_results',
    results: sampleHotels,
    headerText: 'Best hotels in Galle for your dates',
  };

  const result = await renderer.renderMessage(content, 'en');

  if (result.messages[0].type === 'list') {
    console.log('Custom Header:', result.messages[0].body);
    console.log('Number of Results:', result.messages[0].sections[0].rows.length);
  }
}

// =============================================================================
// Example 3: Render no results message
// =============================================================================

async function example3_renderNoResults() {
  console.log('\n=== Example 3: Render No Results ===\n');

  const content: HotelResultsRenderContent = {
    type: 'hotel_results',
    results: [],
  };

  const result = await renderer.renderMessage(content, 'en');

  console.log('Message Type:', result.messages[0].type);
  
  if (result.messages[0].type === 'buttons') {
    console.log('Body:', result.messages[0].body);
    console.log('\nAlternative Options:');
    result.messages[0].buttons.forEach((button) => {
      console.log(`  - ${button.title} (${button.id})`);
    });
  }
}

// =============================================================================
// Example 4: Render detailed hotel card
// =============================================================================

async function example4_renderHotelCard() {
  console.log('\n=== Example 4: Render Detailed Hotel Card ===\n');

  const hotel = sampleHotels[0];
  const result = await renderer.renderHotelCard(hotel, 'en');

  console.log('Message Type:', result.messages[0].type);
  
  if (result.messages[0].type === 'buttons') {
    console.log('\nHotel Details:');
    console.log(result.messages[0].body);
    console.log('\nAction Buttons:');
    result.messages[0].buttons.forEach((button) => {
      console.log(`  - ${button.title} (${button.id})`);
    });
  }
}

// =============================================================================
// Example 5: Render hotel results in different language
// =============================================================================

async function example5_renderInFrench() {
  console.log('\n=== Example 5: Render in French ===\n');

  const content: HotelResultsRenderContent = {
    type: 'hotel_results',
    results: [sampleHotels[0]],
  };

  const result = await renderer.renderMessage(content, 'fr');

  if (result.messages[0].type === 'list') {
    console.log('Body (French):', result.messages[0].body);
    console.log('Button Text (French):', result.messages[0].buttonText);
  }
}

// =============================================================================
// Example 6: Handle large number of results
// =============================================================================

async function example6_handleManyResults() {
  console.log('\n=== Example 6: Handle Many Results ===\n');

  // Create 15 hotels
  const manyHotels: HotelResult[] = Array.from({ length: 15 }, (_, i) => ({
    ...sampleHotels[0],
    name: `Hotel ${i + 1}`,
    price: 50 + i * 10,
    bookingToken: `hotel_${i}`,
  }));

  const content: HotelResultsRenderContent = {
    type: 'hotel_results',
    results: manyHotels,
  };

  const result = await renderer.renderMessage(content, 'en');

  if (result.messages[0].type === 'list') {
    console.log('Total Hotels Found:', manyHotels.length);
    console.log('Hotels Displayed:', result.messages[0].sections[0].rows.length);
    console.log('Note: Results limited to WhatsApp max list items (10)');
  }
}

// =============================================================================
// Example 7: Render hotel with minimal data
// =============================================================================

async function example7_renderMinimalHotel() {
  console.log('\n=== Example 7: Render Hotel with Minimal Data ===\n');

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
    bookingToken: 'hotel_minimal',
  };

  const result = await renderer.renderHotelCard(minimalHotel, 'en');

  if (result.messages[0].type === 'buttons') {
    console.log('Hotel Card (Minimal Data):');
    console.log(result.messages[0].body);
  }
}

// =============================================================================
// Run all examples
// =============================================================================

async function runAllExamples() {
  try {
    await example1_renderHotelResultsList();
    await example2_renderWithCustomHeader();
    await example3_renderNoResults();
    await example4_renderHotelCard();
    await example5_renderInFrench();
    await example6_handleManyResults();
    await example7_renderMinimalHotel();
    
    console.log('\n=== All Examples Completed Successfully ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  example1_renderHotelResultsList,
  example2_renderWithCustomHeader,
  example3_renderNoResults,
  example4_renderHotelCard,
  example5_renderInFrench,
  example6_handleManyResults,
  example7_renderMinimalHotel,
};
