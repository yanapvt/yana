/**
 * WhatsAppRenderer Missing-Field Prompt Examples (Task 12.3)
 * 
 * Demonstrates how to use the WhatsAppRenderer to render missing field prompts
 * with multilingual support and one-tap options.
 * 
 * Validates: Requirement 15.3
 */

import { WhatsAppRenderer, type FieldPromptRenderContent } from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

// Initialize services
const messageRepo = new MessageRepository();
const translationService = new TranslationService(messageRepo);
const renderer = new WhatsAppRenderer(translationService);

// ============================================================================
// Example 1: Text-Only Field Prompt (No Options)
// ============================================================================

async function example1_TextOnlyPrompt() {
  console.log('\n=== Example 1: Text-Only Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'location',
    promptText: 'Where would you like to stay?',
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 2: Button-Based Field Prompt (One-Tap Options)
// ============================================================================

async function example2_ButtonPrompt() {
  console.log('\n=== Example 2: Button-Based Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'checkin_date',
    promptText: 'When are you checking in?',
    options: [
      { id: 'checkin_today', title: 'Today' },
      { id: 'checkin_tomorrow', title: 'Tomorrow' },
      { id: 'checkin_custom', title: 'Pick date' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 3: List-Based Field Prompt (Many Options)
// ============================================================================

async function example3_ListPrompt() {
  console.log('\n=== Example 3: List-Based Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'city',
    promptText: 'Which city would you like to visit?',
    options: [
      { id: 'colombo', title: 'Colombo', description: 'Capital city' },
      { id: 'galle', title: 'Galle', description: 'Historic coastal city' },
      { id: 'kandy', title: 'Kandy', description: 'Cultural capital' },
      { id: 'ella', title: 'Ella', description: 'Mountain town' },
      { id: 'mirissa', title: 'Mirissa', description: 'Beach resort' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 4: Multilingual Field Prompt
// ============================================================================

async function example4_MultilingualPrompt() {
  console.log('\n=== Example 4: Multilingual Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'room_type',
    promptText: 'What type of room would you like?',
    options: [
      { id: 'single', title: 'Single' },
      { id: 'double', title: 'Double' },
      { id: 'suite', title: 'Suite' },
    ],
  };

  // Render in French
  const resultFr = await renderer.renderMessage(content, 'fr');
  console.log('French Result:', JSON.stringify(resultFr, null, 2));

  // Render in Spanish
  const resultEs = await renderer.renderMessage(content, 'es');
  console.log('Spanish Result:', JSON.stringify(resultEs, null, 2));
}

// ============================================================================
// Example 5: Yes/No Field Prompt
// ============================================================================

async function example5_YesNoPrompt() {
  console.log('\n=== Example 5: Yes/No Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'breakfast_included',
    promptText: 'Would you like breakfast included?',
    options: [
      { id: 'breakfast_yes', title: 'Yes' },
      { id: 'breakfast_no', title: 'No' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 6: Budget Range Field Prompt
// ============================================================================

async function example6_BudgetPrompt() {
  console.log('\n=== Example 6: Budget Range Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'budget',
    promptText: 'What is your budget per night?',
    options: [
      { id: 'budget_low', title: 'Under $50' },
      { id: 'budget_mid', title: '$50-$150' },
      { id: 'budget_high', title: 'Over $150' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 7: Guests Count Field Prompt
// ============================================================================

async function example7_GuestsPrompt() {
  console.log('\n=== Example 7: Guests Count Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'guests',
    promptText: 'How many guests?',
    options: [
      { id: '1', title: '1 guest' },
      { id: '2', title: '2 guests' },
      { id: '3', title: '3+ guests' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 8: Currency Selection Field Prompt
// ============================================================================

async function example8_CurrencyPrompt() {
  console.log('\n=== Example 8: Currency Selection Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'currency',
    promptText: 'What currency would you like to use?',
    options: [
      { id: 'usd', title: 'USD', description: 'US Dollar' },
      { id: 'eur', title: 'EUR', description: 'Euro' },
      { id: 'gbp', title: 'GBP', description: 'British Pound' },
      { id: 'lkr', title: 'LKR', description: 'Sri Lankan Rupee' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 9: Amenities Selection Field Prompt
// ============================================================================

async function example9_AmenitiesPrompt() {
  console.log('\n=== Example 9: Amenities Selection Field Prompt ===\n');

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'amenities',
    promptText: 'What amenities are important to you?',
    options: [
      { id: 'wifi', title: 'Free WiFi', description: 'High-speed internet' },
      { id: 'pool', title: 'Swimming Pool', description: 'Outdoor pool' },
      { id: 'gym', title: 'Fitness Center', description: '24/7 access' },
      { id: 'spa', title: 'Spa Services', description: 'Massage and treatments' },
      { id: 'restaurant', title: 'Restaurant', description: 'On-site dining' },
    ],
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
}

// ============================================================================
// Example 10: Fallback to Plain Text (Too Many Options)
// ============================================================================

async function example10_FallbackPrompt() {
  console.log('\n=== Example 10: Fallback to Plain Text ===\n');

  const options = Array.from({ length: 12 }, (_, i) => ({
    id: `opt${i}`,
    title: `Option ${i}`,
  }));

  const content: FieldPromptRenderContent = {
    type: 'field_prompt',
    fieldName: 'option',
    promptText: 'Choose an option',
    options,
  };

  const result = await renderer.renderMessage(content, 'en');
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('Fallback applied:', result.metadata?.fallbackApplied);
}

// ============================================================================
// Run All Examples
// ============================================================================

async function runAllExamples() {
  try {
    await example1_TextOnlyPrompt();
    await example2_ButtonPrompt();
    await example3_ListPrompt();
    await example4_MultilingualPrompt();
    await example5_YesNoPrompt();
    await example6_BudgetPrompt();
    await example7_GuestsPrompt();
    await example8_CurrencyPrompt();
    await example9_AmenitiesPrompt();
    await example10_FallbackPrompt();

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
  example1_TextOnlyPrompt,
  example2_ButtonPrompt,
  example3_ListPrompt,
  example4_MultilingualPrompt,
  example5_YesNoPrompt,
  example6_BudgetPrompt,
  example7_GuestsPrompt,
  example8_CurrencyPrompt,
  example9_AmenitiesPrompt,
  example10_FallbackPrompt,
};
