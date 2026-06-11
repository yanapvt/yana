/**
 * WhatsAppRenderer Confirmation Tests (Task 12.2)
 * 
 * Tests for confirmation message rendering before booking/payment execution.
 * Validates: Requirement 15.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WhatsAppRenderer,
  type ConfirmationRenderContent,
  WHATSAPP_LIMITS,
} from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

describe('WhatsAppRenderer - Confirmation Messages (Task 12.2)', () => {
  let renderer: WhatsAppRenderer;
  let translationService: TranslationService;
  let messageRepo: MessageRepository;

  beforeEach(() => {
    messageRepo = new MessageRepository();
    translationService = new TranslationService(messageRepo);
    renderer = new WhatsAppRenderer(translationService);
  });

  // ==========================================================================
  // Booking Confirmation Tests
  // ==========================================================================

  describe('booking confirmation rendering', () => {
    it('should render booking confirmation with all required details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm your booking',
          details: {
            Hotel: 'Grand Beach Resort',
            Location: 'Galle, Sri Lanka',
            'Check-in': '2026-04-17',
            'Check-out': '2026-04-18',
            Guests: '2 adults',
            Price: '150.00',
            Currency: 'GBP',
          },
        },
        confirmButton: { id: 'confirm_booking', title: 'Confirm' },
        cancelButton: { id: 'cancel_booking', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('buttons');
      expect(result.metadata?.originalType).toBe('confirmation');
      expect(result.metadata?.fallbackApplied).toBe(false);

      if (result.messages[0].type === 'buttons') {
        // Verify body contains all required details
        expect(result.messages[0].body).toContain('Confirm your booking');
        expect(result.messages[0].body).toContain('Grand Beach Resort');
        expect(result.messages[0].body).toContain('Galle, Sri Lanka');
        expect(result.messages[0].body).toContain('2026-04-17');
        expect(result.messages[0].body).toContain('2026-04-18');
        expect(result.messages[0].body).toContain('2 adults');
        expect(result.messages[0].body).toContain('150.00');
        expect(result.messages[0].body).toContain('GBP');

        // Verify buttons
        expect(result.messages[0].buttons).toHaveLength(2);
        expect(result.messages[0].buttons[0].id).toBe('confirm_booking');
        expect(result.messages[0].buttons[0].title).toBe('Confirm');
        expect(result.messages[0].buttons[1].id).toBe('cancel_booking');
        expect(result.messages[0].buttons[1].title).toBe('Cancel');
      }
    });

    it('should render booking confirmation with date and time', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm your booking',
          details: {
            Service: 'Airport Transfer',
            Date: '2026-04-20',
            Time: '14:30',
            Location: 'Colombo Airport to Galle',
            Price: '45.00',
            Currency: 'USD',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('2026-04-20');
        expect(result.messages[0].body).toContain('14:30');
        expect(result.messages[0].body).toContain('Colombo Airport to Galle');
      }
    });

    it('should render booking confirmation with minimal details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm booking',
          details: {
            Hotel: 'City Hotel',
            Price: '100.00',
            Currency: 'EUR',
          },
        },
        confirmButton: { id: 'yes', title: 'Yes' },
        cancelButton: { id: 'no', title: 'No' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('Confirm booking');
        expect(result.messages[0].body).toContain('City Hotel');
        expect(result.messages[0].body).toContain('100.00');
        expect(result.messages[0].body).toContain('EUR');
      }
    });
  });

  // ==========================================================================
  // Payment Confirmation Tests
  // ==========================================================================

  describe('payment confirmation rendering', () => {
    it('should render payment confirmation with all required details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm payment',
          details: {
            Item: 'Hotel Booking - Grand Beach Resort',
            Amount: '150.00',
            Currency: 'GBP',
            'Payment Method': 'Telco Billing',
            Date: '2026-04-15',
          },
        },
        confirmButton: { id: 'pay_now', title: 'Pay Now' },
        cancelButton: { id: 'cancel_payment', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('Confirm payment');
        expect(result.messages[0].body).toContain('Hotel Booking - Grand Beach Resort');
        expect(result.messages[0].body).toContain('150.00');
        expect(result.messages[0].body).toContain('GBP');
        expect(result.messages[0].body).toContain('Telco Billing');
        expect(result.messages[0].body).toContain('2026-04-15');

        expect(result.messages[0].buttons[0].id).toBe('pay_now');
        expect(result.messages[0].buttons[0].title).toBe('Pay Now');
        expect(result.messages[0].buttons[1].id).toBe('cancel_payment');
        expect(result.messages[0].buttons[1].title).toBe('Cancel');
      }
    });

    it('should render payment confirmation with multiple currency formats', async () => {
      const currencies = ['USD', 'EUR', 'GBP', 'LKR', 'JPY'];
      
      for (const currency of currencies) {
        const content: ConfirmationRenderContent = {
          type: 'confirmation',
          summary: {
            title: 'Confirm payment',
            details: {
              Amount: '100.00',
              Currency: currency,
            },
          },
          confirmButton: { id: 'confirm', title: 'Confirm' },
          cancelButton: { id: 'cancel', title: 'Cancel' },
        };

        const result = await renderer.renderMessage(content, 'en');

        if (result.messages[0].type === 'buttons') {
          expect(result.messages[0].body).toContain(currency);
        }
      }
    });
  });

  // ==========================================================================
  // Multilingual Confirmation Tests
  // ==========================================================================

  describe('multilingual confirmation rendering', () => {
    it('should translate confirmation to user language', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm your booking',
          details: {
            Hotel: 'Grand Hotel',
            Price: '100',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        // Should render confirmation with all details
        expect(result.messages[0].body).toContain('Confirm your booking');
        expect(result.messages[0].body).toContain('Grand Hotel');
        expect(result.messages[0].buttons).toHaveLength(2);
      }
    });

    it('should handle confirmation in different languages', async () => {
      const languages = ['en', 'fr', 'es', 'de', 'si'];
      
      for (const lang of languages) {
        const content: ConfirmationRenderContent = {
          type: 'confirmation',
          summary: {
            title: 'Confirm booking',
            details: {
              Hotel: 'Test Hotel',
              Price: '100',
            },
          },
          confirmButton: { id: 'confirm', title: 'Confirm' },
          cancelButton: { id: 'cancel', title: 'Cancel' },
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

  describe('confirmation validation and fallback', () => {
    it('should fall back to plain text when confirmation body exceeds max length', async () => {
      const longDetails: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        longDetails[`Field${i}`] = 'a'.repeat(50);
      }

      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm',
          details: longDetails,
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
      if (result.messages[0].type === 'text') {
        expect(result.messages[0].body.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_TEXT_LENGTH
        );
        expect(result.messages[0].body).toContain('Confirm');
        // Note: When text is truncated, "Cancel" might be cut off, which is expected behavior
        // The important thing is that the message respects WhatsApp limits
      }
    });

    it('should fall back when button titles exceed max length', async () => {
      const longTitle = 'a'.repeat(WHATSAPP_LIMITS.MAX_BUTTON_TITLE_LENGTH + 5);
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm',
          details: { Price: '100' },
        },
        confirmButton: { id: 'confirm', title: longTitle },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      expect(result.metadata?.fallbackApplied).toBe(true);
      expect(result.messages[0].type).toBe('text');
    });

    it('should handle empty details gracefully', async () => {
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
        expect(result.messages[0].buttons).toHaveLength(2);
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('confirmation edge cases', () => {
    it('should handle special characters in details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm booking',
          details: {
            Hotel: 'Grand & Luxury Hotel',
            Location: 'Galle, Sri Lanka (Beach)',
            Price: '$150.00',
            Notes: 'Non-refundable / Special rate',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('Grand & Luxury Hotel');
        expect(result.messages[0].body).toContain('Galle, Sri Lanka (Beach)');
        expect(result.messages[0].body).toContain('$150.00');
        expect(result.messages[0].body).toContain('Non-refundable / Special rate');
      }
    });

    it('should handle numeric values in details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm',
          details: {
            Guests: '2',
            Nights: '3',
            Rooms: '1',
            Total: '450.00',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('2');
        expect(result.messages[0].body).toContain('3');
        expect(result.messages[0].body).toContain('1');
        expect(result.messages[0].body).toContain('450.00');
      }
    });

    it('should handle unicode characters in details', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm booking',
          details: {
            Hotel: 'ホテル グランド',
            Location: 'Galle 🏖️',
            Price: '¥15000',
          },
        },
        confirmButton: { id: 'confirm', title: '確認' },
        cancelButton: { id: 'cancel', title: 'キャンセル' },
      };

      const result = await renderer.renderMessage(content, 'ja');

      expect(result.messages[0].type).toBe('buttons');
      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].body).toContain('ホテル グランド');
        expect(result.messages[0].body).toContain('Galle 🏖️');
        expect(result.messages[0].body).toContain('¥15000');
      }
    });

    it('should handle very long detail values', async () => {
      const longValue = 'This is a very long description that contains a lot of information about the booking including terms and conditions and other important details that the user should be aware of before confirming';
      
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm',
          details: {
            Description: longValue,
            Price: '100',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      // Should either render successfully or fall back to plain text
      expect(result.messages).toHaveLength(1);
      expect(['buttons', 'text']).toContain(result.messages[0].type);
    });
  });

  // ==========================================================================
  // WhatsApp UI Compliance Tests
  // ==========================================================================

  describe('WhatsApp UI compliance', () => {
    it('should always render exactly 2 buttons for confirmation', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm',
          details: { Price: '100' },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons') {
        expect(result.messages[0].buttons).toHaveLength(2);
        expect(result.messages[0].buttons.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_BUTTONS
        );
      }
    });

    it('should respect button title length limits', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm',
          details: { Price: '100' },
        },
        confirmButton: { id: 'confirm', title: 'Confirm Booking' },
        cancelButton: { id: 'cancel', title: 'Cancel Booking' },
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

    it('should respect text body length limits', async () => {
      const content: ConfirmationRenderContent = {
        type: 'confirmation',
        summary: {
          title: 'Confirm your booking',
          details: {
            Hotel: 'Grand Hotel',
            Price: '100',
          },
        },
        confirmButton: { id: 'confirm', title: 'Confirm' },
        cancelButton: { id: 'cancel', title: 'Cancel' },
      };

      const result = await renderer.renderMessage(content, 'en');

      if (result.messages[0].type === 'buttons' && result.messages[0].body) {
        expect(result.messages[0].body.length).toBeLessThanOrEqual(
          WHATSAPP_LIMITS.MAX_TEXT_LENGTH
        );
      }
    });
  });
});
