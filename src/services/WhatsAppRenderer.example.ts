/**
 * WhatsAppRenderer Usage Examples
 * 
 * Demonstrates how to use the WhatsAppRenderer for rendering various
 * WhatsApp message types with validation and translation.
 */

import { WhatsAppRenderer } from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import type {
  RenderableContent,
  ButtonsRenderContent,
  ListRenderContent,
  ConfirmationRenderContent,
  FieldPromptRenderContent,
} from './WhatsAppRenderer.js';

// ============================================================================
// Example 1: Simple Text Message
// ============================================================================

async function example1_simpleText() {
  console.log('\n=== Example 1: Simple Text Message ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: RenderableContent = {
    type: 'text',
    body: 'Hello! How can I help you today?',
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 2: Buttons Message
// ============================================================================

async function example2_buttons() {
  console.log('\n=== Example 2: Buttons Message ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: ButtonsRenderContent = {
    type: 'buttons',
    body: 'When are you checking in?',
    buttons: [
      { id: 'checkin_today', title: 'Today' },
      { id: 'checkin_tomorrow', title: 'Tomorrow' },
      { id: 'checkin_custom', title: 'Pick date' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 3: List Message
// ============================================================================

async function example3_list() {
  console.log('\n=== Example 3: List Message ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: ListRenderContent = {
    type: 'list',
    body: 'Here are the available hotels in Galle:',
    buttonText: 'View Hotels',
    sections: [
      {
        title: 'Luxury Hotels',
        rows: [
          {
            id: 'hotel_1',
            title: 'Grand Galle Hotel',
            description: 'Beachfront luxury resort with spa',
          },
          {
            id: 'hotel_2',
            title: 'Ocean View Palace',
            description: '5-star hotel with infinity pool',
          },
        ],
      },
      {
        title: 'Budget Hotels',
        rows: [
          {
            id: 'hotel_3',
            title: 'Galle City Inn',
            description: 'Comfortable rooms in city center',
          },
        ],
      },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 4: Confirmation Message
// ============================================================================

async function example4_confirmation() {
  console.log('\n=== Example 4: Confirmation Message ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: ConfirmationRenderContent = {
    type: 'confirmation',
    summary: {
      title: 'Please confirm your booking',
      details: {
        Hotel: 'Grand Galle Hotel',
        'Check-in': 'April 17, 2026',
        'Check-out': 'April 18, 2026',
        Guests: '2 adults',
        Price: '$150 USD',
      },
    },
    confirmButton: { id: 'confirm_booking', title: 'Confirm' },
    cancelButton: { id: 'cancel_booking', title: 'Cancel' },
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 5: Field Prompt with Buttons
// ============================================================================

async function example5_fieldPromptButtons() {
  console.log('\n=== Example 5: Field Prompt with Buttons ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'guests',
    promptText: 'How many guests?',
    options: [
      { id: 'guests_1', title: '1 guest' },
      { id: 'guests_2', title: '2 guests' },
      { id: 'guests_more', title: 'More' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 6: Field Prompt with List
// ============================================================================

async function example6_fieldPromptList() {
  console.log('\n=== Example 6: Field Prompt with List ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'city',
    promptText: 'Which city would you like to visit?',
    options: [
      { id: 'city_colombo', title: 'Colombo', description: 'Capital city' },
      { id: 'city_galle', title: 'Galle', description: 'Historic coastal city' },
      { id: 'city_kandy', title: 'Kandy', description: 'Cultural capital' },
      { id: 'city_ella', title: 'Ella', description: 'Mountain town' },
      { id: 'city_jaffna', title: 'Jaffna', description: 'Northern city' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 7: Translation to French
// ============================================================================

async function example7_translation() {
  console.log('\n=== Example 7: Translation to French ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: ButtonsRenderContent = {
    type: 'buttons',
    body: 'hello',
    buttons: [
      { id: 'yes', title: 'yes' },
      { id: 'no', title: 'no' },
    ],
  };

  // Render in French (mock translation will keep English for most words)
  const result = await renderer.renderMessage(content, 'fr');
  console.log('Rendered message (French):', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 8: Fallback to Plain Text (Too Many Buttons)
// ============================================================================

async function example8_fallbackTooManyButtons() {
  console.log('\n=== Example 8: Fallback - Too Many Buttons ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  const content: ButtonsRenderContent = {
    type: 'buttons',
    body: 'Choose your preferred time',
    buttons: [
      { id: 'morning', title: 'Morning' },
      { id: 'afternoon', title: 'Afternoon' },
      { id: 'evening', title: 'Evening' },
      { id: 'night', title: 'Night' }, // Exceeds limit of 3
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message (fallback):', JSON.stringify(result, null, 2));
  console.log('Fallback applied:', result.metadata?.fallbackApplied);
}

// ============================================================================
// Example 9: Fallback to Plain Text (Too Many List Items)
// ============================================================================

async function example9_fallbackTooManyListItems() {
  console.log('\n=== Example 9: Fallback - Too Many List Items ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  // Create 11 items (exceeds limit of 10)
  const rows = Array.from({ length: 11 }, (_, i) => ({
    id: `hotel_${i}`,
    title: `Hotel ${i + 1}`,
    description: `Description for hotel ${i + 1}`,
  }));

  const content: ListRenderContent = {
    type: 'list',
    body: 'Available hotels',
    buttonText: 'View',
    sections: [{ rows }],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Rendered message (fallback):', JSON.stringify(result, null, 2));
  console.log('Fallback applied:', result.metadata?.fallbackApplied);
}

// ============================================================================
// Example 10: Without Translation Service
// ============================================================================

async function example10_noTranslation() {
  console.log('\n=== Example 10: Without Translation Service ===\n');

  const renderer = new WhatsAppRenderer(); // No translation service

  const content: RenderableContent = {
    type: 'text',
    body: 'This message will not be translated',
  };

  const result = await renderer.renderMessage(content, 'fr');
  console.log('Rendered message:', JSON.stringify(result, null, 2));
  console.log('Note: Text remains in original language');
}

// ============================================================================
// Example 11: Complete Booking Flow
// ============================================================================

async function example11_bookingFlow() {
  console.log('\n=== Example 11: Complete Booking Flow ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  // Step 1: Collect location
  console.log('\nStep 1: Collect location');
  const locationPrompt: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'location',
    promptText: 'Where would you like to stay?',
    options: [
      { id: 'galle', title: 'Galle' },
      { id: 'colombo', title: 'Colombo' },
      { id: 'kandy', title: 'Kandy' },
    ],
  };
  const step1 = await renderer.renderMessage(locationPrompt, 'en');
  console.log(JSON.stringify(step1, null, 2));

  // Step 2: Collect check-in date
  console.log('\nStep 2: Collect check-in date');
  const checkinPrompt: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'checkin',
    promptText: 'When are you checking in?',
    options: [
      { id: 'today', title: 'Today' },
      { id: 'tomorrow', title: 'Tomorrow' },
      { id: 'custom', title: 'Pick date' },
    ],
  };
  const step2 = await renderer.renderMessage(checkinPrompt, 'en');
  console.log(JSON.stringify(step2, null, 2));

  // Step 3: Show hotel results
  console.log('\nStep 3: Show hotel results');
  const hotelResults: ListRenderContent = {
    type: 'list',
    body: 'Here are available hotels in Galle:',
    buttonText: 'View Hotels',
    sections: [
      {
        rows: [
          {
            id: 'hotel_1',
            title: 'Grand Galle Hotel',
            description: '$150/night - Beachfront',
          },
          {
            id: 'hotel_2',
            title: 'City Center Inn',
            description: '$80/night - Downtown',
          },
        ],
      },
    ],
  };
  const step3 = await renderer.renderMessage(hotelResults, 'en');
  console.log(JSON.stringify(step3, null, 2));

  // Step 4: Confirm booking
  console.log('\nStep 4: Confirm booking');
  const confirmation: ConfirmationRenderContent = {
    type: 'confirmation',
    summary: {
      title: 'Confirm your booking',
      details: {
        Hotel: 'Grand Galle Hotel',
        'Check-in': 'Tomorrow',
        Guests: '2',
        Price: '$150',
      },
    },
    confirmButton: { id: 'confirm', title: 'Confirm' },
    cancelButton: { id: 'cancel', title: 'Cancel' },
  };
  const step4 = await renderer.renderMessage(confirmation, 'en');
  console.log(JSON.stringify(step4, null, 2));

  // Step 5: Booking confirmed
  console.log('\nStep 5: Booking confirmed');
  const confirmed: RenderableContent = {
    type: 'text',
    body: '✅ Your booking is confirmed! You will receive a confirmation message shortly.',
  };
  const step5 = await renderer.renderMessage(confirmed, 'en');
  console.log(JSON.stringify(step5, null, 2));
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExamples() {
  try {
    await example1_simpleText();
    await example2_buttons();
    await example3_list();
    await example4_confirmation();
    await example5_fieldPromptButtons();
    await example6_fieldPromptList();
    await example7_translation();
    await example8_fallbackTooManyButtons();
    await example9_fallbackTooManyListItems();
    await example10_noTranslation();
    await example11_bookingFlow();
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Uncomment to run examples
// runExamples();
