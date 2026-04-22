/**
 * WhatsAppRenderer Confirmation Example (Task 12.2)
 * 
 * Demonstrates how to use the confirmation message renderer for booking/payment confirmations.
 * Validates: Requirement 15.4
 */

import { WhatsAppRenderer, type ConfirmationRenderContent } from './WhatsAppRenderer.js';
import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

async function main() {
  // Initialize services
  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);
  const renderer = new WhatsAppRenderer(translationService);

  console.log('='.repeat(80));
  console.log('WhatsApp Confirmation Message Renderer Examples (Task 12.2)');
  console.log('='.repeat(80));

  // ============================================================================
  // Example 1: Booking Confirmation
  // ============================================================================
  console.log('\n📋 Example 1: Hotel Booking Confirmation\n');

  const bookingConfirmation: ConfirmationRenderContent = {
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

  const bookingResult = await renderer.renderMessage(bookingConfirmation, 'en');
  console.log('Rendered Message:');
  console.log(JSON.stringify(bookingResult, null, 2));

  // ============================================================================
  // Example 2: Payment Confirmation
  // ============================================================================
  console.log('\n💳 Example 2: Payment Confirmation\n');

  const paymentConfirmation: ConfirmationRenderContent = {
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

  const paymentResult = await renderer.renderMessage(paymentConfirmation, 'en');
  console.log('Rendered Message:');
  console.log(JSON.stringify(paymentResult, null, 2));

  // ============================================================================
  // Example 3: Transport Booking Confirmation with Date and Time
  // ============================================================================
  console.log('\n🚗 Example 3: Transport Booking Confirmation\n');

  const transportConfirmation: ConfirmationRenderContent = {
    type: 'confirmation',
    summary: {
      title: 'Confirm your transfer',
      details: {
        Service: 'Airport Transfer',
        Date: '2026-04-20',
        Time: '14:30',
        Location: 'Colombo Airport to Galle',
        Passengers: '2',
        Price: '45.00',
        Currency: 'USD',
      },
    },
    confirmButton: { id: 'confirm_transfer', title: 'Confirm' },
    cancelButton: { id: 'cancel_transfer', title: 'Cancel' },
  };

  const transportResult = await renderer.renderMessage(transportConfirmation, 'en');
  console.log('Rendered Message:');
  console.log(JSON.stringify(transportResult, null, 2));

  // ============================================================================
  // Example 4: Multilingual Confirmation (French)
  // ============================================================================
  console.log('\n🌍 Example 4: Multilingual Confirmation (French)\n');

  const multilingualConfirmation: ConfirmationRenderContent = {
    type: 'confirmation',
    summary: {
      title: 'Confirmez votre réservation',
      details: {
        Hôtel: 'Grand Beach Resort',
        Lieu: 'Galle, Sri Lanka',
        Arrivée: '2026-04-17',
        Départ: '2026-04-18',
        Prix: '150.00',
        Devise: 'GBP',
      },
    },
    confirmButton: { id: 'confirm', title: 'Confirmer' },
    cancelButton: { id: 'cancel', title: 'Annuler' },
  };

  const multilingualResult = await renderer.renderMessage(multilingualConfirmation, 'fr');
  console.log('Rendered Message (French):');
  console.log(JSON.stringify(multilingualResult, null, 2));

  // ============================================================================
  // Example 5: Minimal Confirmation
  // ============================================================================
  console.log('\n✅ Example 5: Minimal Confirmation\n');

  const minimalConfirmation: ConfirmationRenderContent = {
    type: 'confirmation',
    summary: {
      title: 'Are you sure?',
      details: {},
    },
    confirmButton: { id: 'yes', title: 'Yes' },
    cancelButton: { id: 'no', title: 'No' },
  };

  const minimalResult = await renderer.renderMessage(minimalConfirmation, 'en');
  console.log('Rendered Message:');
  console.log(JSON.stringify(minimalResult, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('✅ All examples completed successfully!');
  console.log('='.repeat(80) + '\n');
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as runConfirmationExamples };
