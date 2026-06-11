/**
 * WhatsAppRenderer Missing-Field Prompt Tests (Task 12.3)
 * 
 * Tests for missing field prompt rendering with multilingual support and one-tap options.
 * Validates: Requirement 15.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WhatsAppRenderer,
  type FieldPromptRenderContent,
  WHATSAPP_LIMITS,
} from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

describe('WhatsAppRenderer - Missing-Field Prompts (Task 12.3)', () => {
  let renderer: WhatsAppRenderer;
  let translationService: TranslationService;
  let messageRepo: MessageRepository;

  beforeEach(() => {
    messageRepo = new MessageRepository();
    translationService = new TranslationService(messageRepo);
    renderer = new WhatsAppRenderer(translationService);
  });

  // ==========================================================================
  // Text-Only Field Prompts (No Options)
  // ==========================================================================

  describe('text-only field prompts', () => {
    it('should render text prompt for location field', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'Where would you like to stay?',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('Where would you like to stay?');
      }
      expect(result.metadata?.originalType).toBe('field_prompt');
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should render text prompt for custom date field', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'custom_date',
        promptText: 'Please enter your preferred date (YYYY-MM-DD)',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toContain('YYYY-MM-DD');
      }
    });

    it('should render text prompt for guest count field', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'guests',
        promptText: 'How many guests will be staying?',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('How many guests will be staying?');
      }
    });

    it('should render text prompt for special requests field', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'special_requests',
        promptText: 'Do you have any special requests or requirements?',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
    });
  });

  // ==========================================================================
  // Button-Based Field Prompts (One-Tap Options)
  // ==========================================================================

  describe('button-based field prompts with one-tap options', () => {
    it('should render check-in date prompt with button options', async () => {
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

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toBe('When are you checking in?');
        expect(result.messages[0].buttons).toHaveLength(3);
        expect(result.messages[0].buttons[0].id).toBe('checkin_today');
        expect(result.messages[0].buttons[0].title).toBe('Today');
        expect(result.messages[0].buttons[1].id).toBe('checkin_tomorrow');
        expect(result.messages[0].buttons[1].title).toBe('Tomorrow');
        expect(result.messages[0].buttons[2].id).toBe('checkin_custom');
        expect(result.messages[0].buttons[2].title).toBe('Pick date');
      }
      expect(result.metadata?.originalType).toBe('field_prompt');
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should render room type prompt with button options', async () => {
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

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons).toHaveLength(3);
        expect(result.messages[0].buttons.map(b => b.title)).toEqual(['Single', 'Double', 'Suite']);
      }
    });

    it('should render yes/no confirmation prompt with button options', async () => {
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

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons).toHaveLength(2);
      }
    });

    it('should render budget range prompt with button options', async () => {
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

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons[0].title).toBe('Under $50');
        expect(result.messages[0].buttons[1].title).toBe('$50-$150');
        expect(result.messages[0].buttons[2].title).toBe('Over $150');
      }
    });
  });

  // ==========================================================================
  // List-Based Field Prompts (Many Options)
  // ==========================================================================

  describe('list-based field prompts with many options', () => {
    it('should render city selection prompt with list options', async () => {
      const options = [
        { id: 'colombo', title: 'Colombo', description: 'Capital city' },
        { id: 'galle', title: 'Galle', description: 'Historic coastal city' },
        { id: 'kandy', title: 'Kandy', description: 'Cultural capital' },
        { id: 'ella', title: 'Ella', description: 'Mountain town' },
        { id: 'mirissa', title: 'Mirissa', description: 'Beach resort' },
      ];

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'city',
        promptText: 'Which city would you like to visit?',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toBe('Which city would you like to visit?');
        expect(result.messages[0].buttonText).toBe('Select');
        expect(result.messages[0].sections).toHaveLength(1);
        expect(result.messages[0].sections[0].rows).toHaveLength(5);
        expect(result.messages[0].sections[0].rows[0].id).toBe('colombo');
        expect(result.messages[0].sections[0].rows[0].title).toBe('Colombo');
        expect(result.messages[0].sections[0].rows[0].description).toBe('Capital city');
      }
      expect(result.metadata?.originalType).toBe('field_prompt');
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should render hotel amenities prompt with list options', async () => {
      const options = [
        { id: 'wifi', title: 'Free WiFi', description: 'High-speed internet' },
        { id: 'pool', title: 'Swimming Pool', description: 'Outdoor pool' },
        { id: 'gym', title: 'Fitness Center', description: '24/7 access' },
        { id: 'spa', title: 'Spa Services', description: 'Massage and treatments' },
        { id: 'restaurant', title: 'Restaurant', description: 'On-site dining' },
        { id: 'parking', title: 'Free Parking', description: 'Secure parking' },
      ];

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'amenities',
        promptText: 'What amenities are important to you?',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].sections[0].rows).toHaveLength(6);
      }
    });

    it('should render nationality selection with list options', async () => {
      const options = [
        { id: 'uk', title: 'United Kingdom' },
        { id: 'us', title: 'United States' },
        { id: 'de', title: 'Germany' },
        { id: 'fr', title: 'France' },
        { id: 'in', title: 'India' },
        { id: 'au', title: 'Australia' },
        { id: 'jp', title: 'Japan' },
      ];

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'nationality',
        promptText: 'What is your nationality?',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].sections[0].rows).toHaveLength(7);
      }
    });
  });

  // ==========================================================================
  // Multilingual Field Prompts
  // ==========================================================================

  describe('multilingual field prompts', () => {
    it('should translate text prompt to user language', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'bonjour',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('hello');
      }
    });

    it('should translate button prompt and options to user language', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'checkin',
        promptText: 'bonjour',
        options: [
          { id: 'today', title: 'oui' },
          { id: 'tomorrow', title: 'non' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toBe('hello');
        // Note: Translation service may not translate 'oui'/'non' in mock
      }
    });

    it('should translate list prompt and options to user language', async () => {
      const options = [
        { id: 'opt1', title: 'bonjour', description: 'oui' },
        { id: 'opt2', title: 'merci', description: 'non' },
        { id: 'opt3', title: 'au revoir' },
        { id: 'opt4', title: 'salut' },
      ];

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'city',
        promptText: 'bonjour',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toBe('hello');
        expect(result.messages[0].sections[0].rows).toHaveLength(4);
      }
    });

    it('should handle field prompts in multiple languages', async () => {
      const languages = ['en', 'fr', 'es', 'de', 'si', 'ja'];

      for (const lang of languages) {
        const content: FieldPromptRenderContent = {
          type: 'field_prompt',
          fieldName: 'location',
          promptText: 'Where would you like to stay?',
          options: [
            { id: 'city', title: 'City' },
            { id: 'beach', title: 'Beach' },
          ],
        };

        const result = await renderer.renderMessage(content, lang);

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].type).toBe('buttons');
      }
    });
  });

  // ==========================================================================
  // Validation and Fallback Tests
  // ==========================================================================

  describe('field prompt validation and fallback', () => {
    it('should fall back to plain text when too many button options', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose an option',
        options: [
          { id: '1', title: 'Option 1' },
          { id: '2', title: 'Option 2' },
          { id: '3', title: 'Option 3' },
          { id: '4', title: 'Option 4' }, // Exceeds button limit
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      // Should render as list instead of buttons
      expect(result.messages[0].type).toBe('list');
    });

    it('should fall back to plain text when too many list options', async () => {
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

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toContain('Choose an option');
        expect(result.messages[0].body).toContain('Option 0');
        expect(result.messages[0].body).toContain('Option 11');
      }
    });

    it('should fall back when button title exceeds max length', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH + 5);
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options: [{ id: '1', title: longTitle }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
    });

    it('should fall back when list item title exceeds max length', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH + 5);
      const options = Array.from({ length: 5 }, (_, i) => ({
        id: `opt${i}`,
        title: i === 0 ? longTitle : `Option ${i}`,
      }));

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
    });

    it('should fall back when prompt text exceeds max length', async () => {
      const longPrompt = 'a'.repeat(WHATSAPP_LIMITS.MAX_TEXT_LENGTH + 100);
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: longPrompt,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_TEXT_LENGTH
        );
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('field prompt edge cases', () => {
    it('should handle empty options array', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Enter your choice',
        options: [],
      };

      const result = await renderer.renderMessage(content, 'en');

      // Should render as text when no options
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('Enter your choice');
      }
    });

    it('should handle special characters in prompt text', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'Where would you like to stay? (City/Beach/Mountain)',
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toContain('(City/Beach/Mountain)');
      }
    });

    it('should handle special characters in option titles', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'room',
        promptText: 'Select room type',
        options: [
          { id: 'deluxe', title: 'Deluxe ($150)' },
          { id: 'suite', title: 'Suite ($250)' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons[0].title).toBe('Deluxe ($150)');
        expect(result.messages[0].buttons[1].title).toBe('Suite ($250)');
      }
    });

    it('should handle unicode characters in prompts', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'どこに泊まりたいですか？ 🏨',
        options: [
          { id: 'tokyo', title: '東京' },
          { id: 'osaka', title: '大阪' },
        ],
      };

      const result = await renderer.renderMessage(content, 'ja');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('🏨');
      }
    });

    it('should handle numeric option titles', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'guests',
        promptText: 'How many guests?',
        options: [
          { id: '1', title: '1' },
          { id: '2', title: '2' },
          { id: '3', title: '3' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons.map(b => b.title)).toEqual(['1', '2', '3']);
      }
    });

    it('should handle missing option IDs gracefully', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options: [
          { id: '', title: 'Option 1' },
          { id: 'opt2', title: 'Option 2' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      // Should fall back due to validation error
      expect(result.metadata?.fallbackApplied).toBe(true);
    });
  });

  // ==========================================================================
  // WhatsApp UI Compliance Tests
  // ==========================================================================

  describe('WhatsApp UI compliance', () => {
    it('should respect button count limit (max 3)', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options: [
          { id: '1', title: 'One' },
          { id: '2', title: 'Two' },
          { id: '3', title: 'Three' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_BUTTONS
        );
      }
    });

    it('should respect list item count limit (max 10)', async () => {
      const options = Array.from({ length: 10 }, (_, i) => ({
        id: `opt${i}`,
        title: `Option ${i}`,
      }));

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'list') {
        const totalItems = result.messages[0].sections.reduce(
          (sum, section) => sum + section.rows.length,
          0
        );
        expect(totalItems).toBeLessThanOrEqual(WHATSAPP_LIMITS.MAX_LIST_ITEMS);
      }
    });

    it('should respect button title length limit', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options: [
          { id: '1', title: 'Short' },
          { id: '2', title: 'Medium Length' },
          { id: '3', title: 'Exactly 20 Chars!!' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        result.messages[0].buttons.forEach((button) => {
          expect(button.title.length).toBeLessThanOrEqual(
            WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH
          );
        });
      }
    });

    it('should respect list item title length limit', async () => {
      const options = Array.from({ length: 5 }, (_, i) => ({
        id: `opt${i}`,
        title: `Option ${i}`,
        description: 'Description',
      }));

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'option',
        promptText: 'Choose',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'list') {
        result.messages[0].sections.forEach((section) => {
          section.rows.forEach((row) => {
            expect(row.title.length).toBeLessThanOrEqual(
              WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH
            );
          });
        });
      }
    });

    it('should respect text body length limit', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'Where would you like to stay?',
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_TEXT_LENGTH
        );
      }
    });
  });

  // ==========================================================================
  // Schema Field Collection Scenarios
  // ==========================================================================

  describe('schema field collection scenarios', () => {
    it('should render location field prompt', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'Where would you like to stay?',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
    });

    it('should render check-in date field prompt', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'checkin_date',
        promptText: 'When are you checking in?',
        options: [
          { id: 'today', title: 'Today' },
          { id: 'tomorrow', title: 'Tomorrow' },
          { id: 'custom', title: 'Pick date' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
    });

    it('should render check-out date field prompt', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'checkout_date',
        promptText: 'When are you checking out?',
        options: [
          { id: 'next_day', title: 'Next day' },
          { id: 'two_days', title: 'In 2 days' },
          { id: 'custom', title: 'Pick date' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
    });

    it('should render guests field prompt', async () => {
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

      expect(result.messages[0].type).toBe('buttons');
    });

    it('should render currency field prompt', async () => {
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

      expect(result.messages[0].type).toBe('list');
    });
  });
});
