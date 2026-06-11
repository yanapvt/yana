/**
 * LanguagePreferenceManager Usage Examples
 * 
 * Demonstrates how to use the LanguagePreferenceManager service
 * for language detection, persistence, and application.
 */

import { LanguagePreferenceManager } from './LanguagePreferenceManager.js';
import { TranslationService } from './TranslationService.js';
import { SessionManager } from './SessionManager.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { UserRepository } from '../db/repositories/UserRepository.js';
import { SessionRepository } from '../db/repositories/SessionRepository.js';
import { StateStore } from './StateStore.js';

// ============================================================================
// Example 1: Basic Setup
// ============================================================================

async function example1_basicSetup() {
  console.log('\n=== Example 1: Basic Setup ===\n');

  // Initialize dependencies
  const messageRepository = new MessageRepository();
  const userRepository = new UserRepository();
  const sessionRepository = new SessionRepository();
  const stateStore = new StateStore();

  const translationService = new TranslationService(messageRepository);
  const sessionManager = new SessionManager(
    userRepository,
    sessionRepository,
    messageRepository,
    stateStore
  );

  // Create LanguagePreferenceManager
  const languageManager = new LanguagePreferenceManager(
    translationService,
    sessionManager
  );

  console.log('LanguagePreferenceManager initialized successfully');
}

// ============================================================================
// Example 2: First-Time User Language Detection
// ============================================================================

async function example2_firstTimeDetection() {
  console.log('\n=== Example 2: First-Time User Language Detection ===\n');

  // Assume we have a languageManager instance
  const languageManager = {} as LanguagePreferenceManager;
  const userId = 'user_123';

  // User sends first message in French
  const firstMessage = 'Bonjour, je cherche un hôtel à Paris';

  const result = await languageManager.detectAndPersistLanguagePreference(
    userId,
    firstMessage
  );

  console.log('Language detection result:', {
    detectedLanguage: result.detectedLanguage,
    confidence: result.confidence,
    isFirstDetection: result.isFirstDetection,
    preferredLanguage: result.preferredLanguage,
  });

  // Output:
  // {
  //   detectedLanguage: 'fr',
  //   confidence: 0.95,
  //   isFirstDetection: true,
  //   preferredLanguage: 'fr'
  // }
}

// ============================================================================
// Example 3: Returning User with Stored Preference
// ============================================================================

async function example3_returningUser() {
  console.log('\n=== Example 3: Returning User with Stored Preference ===\n');

  const languageManager = {} as LanguagePreferenceManager;
  const userId = 'user_456';

  // User previously set preference to Spanish
  // Now sends message in English
  const message = 'Hello, I need a hotel';

  const result = await languageManager.detectAndPersistLanguagePreference(
    userId,
    message
  );

  console.log('Language preference result:', {
    detectedLanguage: result.detectedLanguage,
    isFirstDetection: result.isFirstDetection,
    preferredLanguage: result.preferredLanguage,
  });

  // Output:
  // {
  //   detectedLanguage: 'es',  // Uses stored preference, not detected 'en'
  //   isFirstDetection: false,
  //   preferredLanguage: 'es'
  // }
}

// ============================================================================
// Example 4: Integration with Message Processing Flow
// ============================================================================

async function example4_messageProcessingFlow() {
  console.log('\n=== Example 4: Integration with Message Processing Flow ===\n');

  const languageManager = {} as LanguagePreferenceManager;

  async function processInboundMessage(
    userId: string,
    messageText: string,
    sessionId: string
  ) {
    console.log(`Processing message from user ${userId}: "${messageText}"`);

    // Step 1: Detect and persist language preference
    const languagePreference = await languageManager.detectAndPersistLanguagePreference(
      userId,
      messageText
    );

    if (languagePreference.isFirstDetection) {
      console.log(
        `✓ New user language detected: ${languagePreference.detectedLanguage} (confidence: ${languagePreference.confidence})`
      );
    } else {
      console.log(`✓ Using stored language preference: ${languagePreference.preferredLanguage}`);
    }

    // Step 2: Process message with LLM (using canonical form)
    // const canonicalForm = await translationService.toCanonicalForm(
    //   messageText,
    //   languagePreference.preferredLanguage
    // );

    // Step 3: Generate response
    const responseContent = {
      type: 'text',
      body: 'Your booking has been confirmed',
    };

    // Step 4: Render response in user's preferred language
    const preferredLanguage = languagePreference.preferredLanguage;
    console.log(`✓ Rendering response in ${preferredLanguage}`);

    // const translatedResponse = await translateResponse(
    //   responseContent,
    //   preferredLanguage
    // );

    return {
      language: preferredLanguage,
      response: responseContent,
    };
  }

  // Simulate processing messages
  await processInboundMessage('user_789', 'Hola, busco un hotel', 'session_123');
}

// ============================================================================
// Example 5: WhatsApp Renderer Integration
// ============================================================================

async function example5_whatsappRendererIntegration() {
  console.log('\n=== Example 5: WhatsApp Renderer Integration ===\n');

  const languageManager = {} as LanguagePreferenceManager;

  async function renderWhatsAppMessage(userId: string, content: any) {
    // Get user's preferred language for rendering
    const language = await languageManager.getPreferredLanguageForRendering(userId);

    console.log(`Rendering WhatsApp message in ${language}`);

    // Translate UI labels and messages
    const translations: Record<string, Record<string, string>> = {
      en: {
        confirm: 'Confirm',
        cancel: 'Cancel',
        bookNow: 'Book Now',
      },
      fr: {
        confirm: 'Confirmer',
        cancel: 'Annuler',
        bookNow: 'Réserver maintenant',
      },
      es: {
        confirm: 'Confirmar',
        cancel: 'Cancelar',
        bookNow: 'Reservar ahora',
      },
    };

    const labels = translations[language] || translations['en'];

    return {
      type: 'buttons',
      body: content.body,
      buttons: [
        { id: 'confirm', title: labels.confirm },
        { id: 'cancel', title: labels.cancel },
      ],
    };
  }

  // Render message for French user
  const message = await renderWhatsAppMessage('user_fr', {
    body: 'Voulez-vous confirmer votre réservation?',
  });

  console.log('Rendered message:', JSON.stringify(message, null, 2));
}

// ============================================================================
// Example 6: Manual Language Preference Update
// ============================================================================

async function example6_manualUpdate() {
  console.log('\n=== Example 6: Manual Language Preference Update ===\n');

  const languageManager = {} as LanguagePreferenceManager;
  const userId = 'user_999';

  // User explicitly changes language preference
  console.log('User requests language change to French');

  await languageManager.updatePreferredLanguage(userId, 'fr');

  console.log('✓ Language preference updated to French');

  // Verify the update
  const language = await languageManager.getPreferredLanguageForRendering(userId);
  console.log(`Current language preference: ${language}`);
}

// ============================================================================
// Example 7: Multi-Language Support (Sri Lankan Tourism)
// ============================================================================

async function example7_sriLankanTourism() {
  console.log('\n=== Example 7: Multi-Language Support (Sri Lankan Tourism) ===\n');

  const languageManager = {} as LanguagePreferenceManager;

  // Sinhala user
  const sinhalaUser = 'user_si';
  const sinhalaMessage = 'හෝටලයක් සොයනවා';

  const sinhalaResult = await languageManager.detectAndPersistLanguagePreference(
    sinhalaUser,
    sinhalaMessage
  );

  console.log('Sinhala user:', {
    language: sinhalaResult.detectedLanguage,
    confidence: sinhalaResult.confidence,
  });

  // Tamil user
  const tamilUser = 'user_ta';
  const tamilMessage = 'ஹோட்டல் தேடுகிறேன்';

  const tamilResult = await languageManager.detectAndPersistLanguagePreference(
    tamilUser,
    tamilMessage
  );

  console.log('Tamil user:', {
    language: tamilResult.detectedLanguage,
    confidence: tamilResult.confidence,
  });

  // English user
  const englishUser = 'user_en';
  const englishMessage = 'I need a hotel in Colombo';

  const englishResult = await languageManager.detectAndPersistLanguagePreference(
    englishUser,
    englishMessage
  );

  console.log('English user:', {
    language: englishResult.detectedLanguage,
    confidence: englishResult.confidence,
  });
}

// ============================================================================
// Example 8: Error Handling and Fallback
// ============================================================================

async function example8_errorHandling() {
  console.log('\n=== Example 8: Error Handling and Fallback ===\n');

  const languageManager = {} as LanguagePreferenceManager;
  const userId = 'user_error';

  try {
    // Attempt to detect language
    const result = await languageManager.detectAndPersistLanguagePreference(
      userId,
      'Hello world'
    );

    console.log('Language detected:', result.detectedLanguage);
  } catch (error: any) {
    console.error('Language detection failed:', error.message);

    // Fall back to getting language for rendering (which defaults to 'en')
    const fallbackLanguage = await languageManager.getPreferredLanguageForRendering(userId);

    console.log(`✓ Using fallback language: ${fallbackLanguage}`);
  }
}

// ============================================================================
// Example 9: Complete User Journey
// ============================================================================

async function example9_completeUserJourney() {
  console.log('\n=== Example 9: Complete User Journey ===\n');

  const languageManager = {} as LanguagePreferenceManager;
  const userId = 'user_journey';

  // Day 1: User sends first message in Spanish
  console.log('Day 1: First message');
  const day1Result = await languageManager.detectAndPersistLanguagePreference(
    userId,
    'Hola, busco un hotel en Barcelona'
  );
  console.log(`✓ Language detected: ${day1Result.detectedLanguage}`);

  // Day 2: User returns, sends message in English
  console.log('\nDay 2: Returning user');
  const day2Result = await languageManager.detectAndPersistLanguagePreference(
    userId,
    'Hello, I need a hotel'
  );
  console.log(`✓ Using stored preference: ${day2Result.preferredLanguage}`);
  console.log(`  (Message was in English, but preference is ${day2Result.preferredLanguage})`);

  // Day 3: User explicitly changes to French
  console.log('\nDay 3: Manual language change');
  await languageManager.updatePreferredLanguage(userId, 'fr');
  console.log('✓ Language preference updated to French');

  // Day 4: User returns
  console.log('\nDay 4: Returning user after manual change');
  const language = await languageManager.getPreferredLanguageForRendering(userId);
  console.log(`✓ Current language preference: ${language}`);
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExamples() {
  try {
    await example1_basicSetup();
    // await example2_firstTimeDetection();
    // await example3_returningUser();
    // await example4_messageProcessingFlow();
    // await example5_whatsappRendererIntegration();
    // await example6_manualUpdate();
    // await example7_sriLankanTourism();
    // await example8_errorHandling();
    // await example9_completeUserJourney();
  } catch (error) {
    console.error('Example error:', error);
  }
}

// Uncomment to run examples
// runExamples();
