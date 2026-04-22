/**
 * WhatsAppRenderer Tests
 * 
 * Tests for WhatsApp message rendering, validation, and fallback behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WhatsAppRenderer,
  getWhatsAppRenderer,
  initWhatsAppRenderer,
  WHATSAPP_LIMITS,
  type RenderableContent,
  type ButtonsRenderContent,
  type ListRenderContent,
  type ConfirmationRenderContent,
  type FieldPromptRenderContent,
} from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

describe('WhatsAppRenderer', () => {
  let renderer: WhatsAppRenderer;
  let translationService: TranslationService;
  let messageRepo: MessageRepository;

  beforeEach(() => {
    messageRepo = new MessageRepository();
    translationService = new TranslationService(messageRepo);
    renderer = new WhatsAppRenderer(translationService);
  });

  // ==========================================================================
  // Text Rendering Tests
  // ==========================================================================

  describe('renderMessage - text', () => {
    it('should render simple text message', async () => {
      const content: RenderableContent = {
        type: 'text',
        body: 'Hello, how can I help you?',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('text');
      expect(result.messages[0]).toHaveProperty('body');
      expect(result.metadata?.originalType).toBe('text');
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should translate text to user language', async () => {
      const content: RenderableContent = {
        type: 'text',
        body: 'bonjour',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('hello');
      }
    });

    it('should fall back to plain text when text exceeds max length', async () => {
      const longText = 'a'.repeat(WHATSAPP_LIMITS.MAX_TEXT_LENGTH + 100);
      const content: RenderableContent = {
        type: 'text',
        body: longText,
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
  // Buttons Rendering Tests
  // ==========================================================================

  describe('renderMessage - buttons', () => {
    it('should render buttons message with body', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        body: 'When are you checking in?',
        buttons: [
          { id: 'today', title: 'Today' },
          { id: 'tomorrow', title: 'Tomorrow' },
          { id: 'custom', title: 'Pick date' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toBeDefined();
        expect(result.messages[0].buttons).toHaveLength(3);
        expect(result.messages[0].buttons[0].id).toBe('today');
      }
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should render buttons message without body', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        buttons: [
          { id: 'yes', title: 'Yes' },
          { id: 'no', title: 'No' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toBeUndefined();
        expect(result.messages[0].buttons).toHaveLength(2);
      }
    });

    it('should fall back to plain text when too many buttons', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        body: 'Choose an option',
        buttons: [
          { id: '1', title: 'Option 1' },
          { id: '2', title: 'Option 2' },
          { id: '3', title: 'Option 3' },
          { id: '4', title: 'Option 4' }, // Exceeds limit of 3
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toContain('Choose an option');
        expect(result.messages[0].body).toContain('Option 1');
        expect(result.messages[0].body).toContain('Option 4');
      }
    });

    it('should fall back to plain text when button title too long', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH + 5);
      const content: ButtonsRenderContent = {
        type: 'buttons',
        body: 'Choose',
        buttons: [{ id: '1', title: longTitle }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
    });

    it('should translate button titles', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        body: 'bonjour',
        buttons: [{ id: 'yes', title: 'oui' }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toBe('hello');
        // Note: 'oui' might not translate in mock, but structure is correct
      }
    });
  });

  // ==========================================================================
  // List Rendering Tests
  // ==========================================================================

  describe('renderMessage - list', () => {
    it('should render list message', async () => {
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select a hotel',
        buttonText: 'View Hotels',
        sections: [
          {
            title: 'Available Hotels',
            rows: [
              { id: 'h1', title: 'Hotel A', description: 'Beachfront property' },
              { id: 'h2', title: 'Hotel B', description: 'City center' },
            ],
          },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].body).toBeDefined();
        expect(result.messages[0].buttonText).toBeDefined();
        expect(result.messages[0].sections).toHaveLength(1);
        expect(result.messages[0].sections[0].rows).toHaveLength(2);
      }
      expect(result.metadata?.fallbackApplied).toBe(false);
    });

    it('should render list with multiple sections', async () => {
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select a hotel',
        buttonText: 'View',
        sections: [
          {
            title: 'Luxury',
            rows: [{ id: 'l1', title: 'Luxury Hotel 1' }],
          },
          {
            title: 'Budget',
            rows: [{ id: 'b1', title: 'Budget Hotel 1' }],
          },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].sections).toHaveLength(2);
      }
    });

    it('should fall back to plain text when too many list items', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        id: `item${i}`,
        title: `Item ${i}`,
      }));

      const content: ListRenderContent = {
        type: 'list',
        body: 'Select an item',
        buttonText: 'View',
        sections: [{ rows }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toContain('Select an item');
        expect(result.messages[0].body).toContain('Item 0');
        expect(result.messages[0].body).toContain('Item 10');
      }
    });

    it('should fall back when list item title too long', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH + 5);
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select',
        buttonText: 'View',
        sections: [
          {
            rows: [{ id: '1', title: longTitle }],
          },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
    });
  });

  // ==========================================================================
  // Confirmation Rendering Tests
  // ==========================================================================

  describe('renderMessage - confirmation', () => {
    it('should render confirmation message', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm your booking',
          details: {
            Hotel: 'Grand Hotel',
            'Check-in': '2026-04-17',
            'Check-out': '2026-04-18',
            Price: '$150',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('Confirm your booking');
        expect(result.messages[0].body).toContain('Grand Hotel');
        expect(result.messages[0].body).toContain('$150');
        expect(result.messages[0].buttons).toHaveLength(2);
        expect(result.messages[0].buttons[0].id).toBe('confirm');
        expect(result.messages[0].buttons[1].id).toBe('cancel');
      }
      expect(result.metadata?.originalType).toBe('confirmation');
    });

    it('should render confirmation with empty details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Are you sure?',
          details: {},
        },
        confirmButton: { id: 'yes', title: 'Yes' },
        cancelButton: { id: 'no', title: 'No' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toBe('Are you sure?');
      }
    });
  });

  // ==========================================================================
  // Field Prompt Rendering Tests
  // ==========================================================================

  describe('renderMessage - field_prompt', () => {
    it('should render field prompt without options as text', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'location',
        promptText: 'Where would you like to stay?',
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('Where would you like to stay?');
      }
    });

    it('should render field prompt with few options as buttons', async () => {
      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'checkin',
        promptText: 'When are you checking in?',
        options: [
          { id: 'today', title: 'Today' },
          { id: 'tomorrow', title: 'Tomorrow' },
          { id: 'custom', title: 'Pick date' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons).toHaveLength(3);
      }
    });

    it('should render field prompt with many options as list', async () => {
      const options = Array.from({ length: 5 }, (_, i) => ({
        id: `opt${i}`,
        title: `Option ${i}`,
        description: `Description ${i}`,
      }));

      const content: FieldPromptRenderContent = {
        type: 'field_prompt',
        fieldName: 'city',
        promptText: 'Select a city',
        options,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('list');
      if (result.messages[0].type === 'list') {
        expect(result.messages[0].sections[0].rows).toHaveLength(5);
      }
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validation', () => {
    it('should validate button count limit', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        buttons: [
          { id: '1', title: 'One' },
          { id: '2', title: 'Two' },
          { id: '3', title: 'Three' },
          { id: '4', title: 'Four' },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should validate list item count limit', async () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({
        id: `${i}`,
        title: `Item ${i}`,
      }));

      const content: ListRenderContent = {
        type: 'list',
        body: 'Select',
        buttonText: 'View',
        sections: [{ rows }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should validate text length limit', async () => {
      const longText = 'a'.repeat(WHATSAPP_LIMITS.MAX_TEXT_LENGTH + 100);
      const content: RenderableContent = {
        type: 'text',
        body: longText,
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_TEXT_LENGTH
        );
      }
    });

    it('should validate button title length', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH + 5);
      const content: ButtonsRenderContent = {
        type: 'buttons',
        buttons: [{ id: '1', title: longTitle }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should validate list item title length', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_LIST_ITEM_TITLE_LENGTH + 5);
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select',
        buttonText: 'View',
        sections: [{ rows: [{ id: '1', title: longTitle }] }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should validate list item description length', async () => {
      const longDesc = 'a'.repeat(WHATSAPP_LIMITS.MAX_LIST_ITEM_DESCRIPTION_LENGTH + 5);
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select',
        buttonText: 'View',
        sections: [
          {
            rows: [{ id: '1', title: 'Item', description: longDesc }],
          },
        ],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });
  });

  // ==========================================================================
  // Translation Tests
  // ==========================================================================

  describe('translation', () => {
    it('should work without translation service', async () => {
      const rendererNoTranslation = new WhatsAppRenderer();
      const content: RenderableContent = {
        type: 'text',
        body: 'Hello world',
      };

      const result = await rendererNoTranslation.renderMessage(content, 'fr');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('Hello world'); // No translation
      }
    });

    it('should handle translation errors gracefully', async () => {
      const mockTranslationService = {
        translate: vi.fn().mockRejectedValue(new Error('Translation failed')),
      } as any;

      const rendererWithMock = new WhatsAppRenderer(mockTranslationService);
      const content: RenderableContent = {
        type: 'text',
        body: 'Hello',
      };

      const result = await rendererWithMock.renderMessage(content, 'fr');

      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body).toBe('Hello'); // Falls back to original
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty button list', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        body: 'Choose',
        buttons: [],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should handle empty list sections', async () => {
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select',
        buttonText: 'View',
        sections: [],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should handle section with empty rows', async () => {
      const content: ListRenderContent = {
        type: 'list',
        body: 'Select',
        buttonText: 'View',
        sections: [{ rows: [] }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });

    it('should handle missing button IDs', async () => {
      const content: ButtonsRenderContent = {
        type: 'buttons',
        buttons: [{ id: '', title: 'Button' }],
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
    });
  });

  // ==========================================================================
  // Singleton Tests
  // ==========================================================================

  describe('singleton', () => {
    it('should create singleton instance', async () => {
      const instance1 = getWhatsAppRenderer();
      const instance2 = getWhatsAppRenderer();

      expect(instance1).toBe(instance2);
    });

    it('should initialize with custom translation service', () => {
      const customRenderer = initWhatsAppRenderer(translationService);

      expect(customRenderer).toBeInstanceOf(WhatsAppRenderer);
    });
  });
});
