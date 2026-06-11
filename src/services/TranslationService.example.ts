/**
 * TranslationService Usage Examples
 * 
 * Demonstrates how to use the TranslationService for language detection,
 * translation, canonical form normalization, and translation record storage.
 */

import { TranslationService } from './TranslationService.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';

// ============================================================================
// Example 1: Basic Language Detection
// ============================================================================

async function example1_detectLanguage() {
  console.log('\n=== Example 1: Language Detection ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  // Detect English
  const english = await translationService.detectLanguage('Hello, I need a hotel');
  console.log('English detection:', english);
  // { language: 'en', confidence: 0.85, alternatives: [...] }

  // Detect French
  const french = await translationService.detectLanguage('Bonjour, je cherche un hôtel');
  console.log('French detection:', french);
  // { language: 'fr', confidence: 0.9, alternatives: [...] }

  // Detect Spanish
  const spanish = await translationService.detectLanguage('Hola, busco un hotel');
  console.log('Spanish detection:', spanish);
  // { language: 'es', confidence: 0.9, alternatives: [...] }
}

// ============================================================================
// Example 2: Canonical Form Normalization
// ============================================================================

async function example2_canonicalForm() {
  console.log('\n=== Example 2: Canonical Form Normalization ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  // Normalize English text
  const canonical1 = await translationService.toCanonicalForm(
    'Hello, I need a HOTEL!',
    'en'
  );
  console.log('Canonical form (English):', canonical1);
  // 'hello i need a hotel'

  // Normalize French text (translates to English first)
  const canonical2 = await translationService.toCanonicalForm('Bonjour', 'fr');
  console.log('Canonical form (French):', canonical2);
  // 'hello'

  // Normalize with extra whitespace and punctuation
  const canonical3 = await translationService.toCanonicalForm(
    'Hello    world   !!!',
    'en'
  );
  console.log('Canonical form (with whitespace):', canonical3);
  // 'hello world'
}

// ============================================================================
// Example 3: Translation
// ============================================================================

async function example3_translation() {
  console.log('\n=== Example 3: Translation ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  // Translate French to English (with known source language)
  const result1 = await translationService.translate('Bonjour', 'en', 'fr');
  console.log('Translation (French to English):', result1);
  // {
  //   translatedText: 'hello',
  //   detectedLanguage: 'fr',
  //   targetLanguage: 'en',
  //   confidence: 0.95,
  //   canonicalForm: 'hello',
  //   metadata: { ... }
  // }

  // Translate with automatic language detection
  const result2 = await translationService.translate('Hola', 'en');
  console.log('Translation (auto-detect to English):', result2);
  // {
  //   translatedText: 'hello',
  //   detectedLanguage: 'es',
  //   targetLanguage: 'en',
  //   confidence: 0.855,
  //   canonicalForm: 'hello',
  //   metadata: { ... }
  // }

  // Same language (no translation needed)
  const result3 = await translationService.translate('Hello world', 'en', 'en');
  console.log('Translation (same language):', result3);
  // {
  //   translatedText: 'Hello world',
  //   detectedLanguage: 'en',
  //   targetLanguage: 'en',
  //   confidence: 1.0,
  //   canonicalForm: 'hello world',
  //   metadata: { noTranslationNeeded: true }
  // }
}

// ============================================================================
// Example 4: Store Translation Record
// ============================================================================

async function example4_storeTranslationRecord() {
  console.log('\n=== Example 4: Store Translation Record ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  // Translate and store
  const translation = await translationService.translate('Bonjour', 'en', 'fr');

  const record = await translationService.storeTranslationRecord('session_123', {
    messageId: 'msg_123',
    originalText: 'Bonjour',
    detectedLanguage: translation.detectedLanguage,
    translatedText: translation.translatedText,
    canonicalForm: translation.canonicalForm,
    translationConfidence: translation.confidence,
    translatorMetadata: translation.metadata,
  });

  console.log('Stored translation record:', record);
  // {
  //   translationId: 'trans_...',
  //   messageId: 'msg_123',
  //   originalText: 'Bonjour',
  //   detectedLanguage: 'fr',
  //   translatedText: 'hello',
  //   canonicalForm: 'hello',
  //   translationConfidence: 0.95,
  //   translatorMetadata: { sessionId: 'session_123', ... },
  //   createdAt: Date
  // }
}

// ============================================================================
// Example 5: Complete Translation Workflow
// ============================================================================

async function example5_completeWorkflow() {
  console.log('\n=== Example 5: Complete Translation Workflow ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  const userMessage = 'Bonjour, je cherche un hôtel';
  const messageId = 'msg_456';
  const sessionId = 'session_456';

  // Step 1: Detect language
  console.log('Step 1: Detecting language...');
  const detection = await translationService.detectLanguage(userMessage);
  console.log(`Detected: ${detection.language} (confidence: ${detection.confidence})`);

  // Step 2: Translate to English
  console.log('\nStep 2: Translating to English...');
  const translation = await translationService.translate(
    userMessage,
    'en',
    detection.language
  );
  console.log(`Translated: "${translation.translatedText}"`);
  console.log(`Canonical form: "${translation.canonicalForm}"`);

  // Step 3: Store translation record
  console.log('\nStep 3: Storing translation record...');
  const record = await translationService.storeTranslationRecord(sessionId, {
    messageId,
    originalText: userMessage,
    detectedLanguage: translation.detectedLanguage,
    translatedText: translation.translatedText,
    canonicalForm: translation.canonicalForm,
    translationConfidence: translation.confidence,
    translatorMetadata: translation.metadata,
  });
  console.log(`Stored with ID: ${record.translationId}`);

  // Step 4: Use canonical form for schema processing
  console.log('\nStep 4: Using canonical form for schema processing...');
  console.log(`Schema will process: "${translation.canonicalForm}"`);
  // The Orchestrator would use this canonical form to match against schema fields
}

// ============================================================================
// Example 6: Error Handling
// ============================================================================

async function example6_errorHandling() {
  console.log('\n=== Example 6: Error Handling ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  try {
    // This will throw an error
    await translationService.detectLanguage('');
  } catch (error: any) {
    console.log('Error caught:', {
      name: error.name,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
    });
    // {
    //   name: 'TranslationServiceError',
    //   message: 'Cannot detect language from empty text',
    //   code: 'EMPTY_TEXT',
    //   retryable: false
    // }
  }
}

// ============================================================================
// Example 7: Custom Configuration
// ============================================================================

async function example7_customConfiguration() {
  console.log('\n=== Example 7: Custom Configuration ===\n');

  const messageRepo = new MessageRepository();

  // Create service with custom configuration
  const translationService = new TranslationService(messageRepo, {
    provider: 'mock',
    confidenceThreshold: 0.8,
    defaultLanguage: 'en',
    canonicalLanguage: 'en',
  });

  const result = await translationService.detectLanguage('Hello world');
  console.log('Detection with custom config:', result);
}

// ============================================================================
// Example 8: Integration with Orchestrator
// ============================================================================

async function example8_orchestratorIntegration() {
  console.log('\n=== Example 8: Orchestrator Integration ===\n');

  const messageRepo = new MessageRepository();
  const translationService = new TranslationService(messageRepo);

  // Simulate orchestrator receiving a user message
  const userMessage = 'Je cherche un hôtel à Galle';
  const sessionId = 'session_789';
  const messageId = 'msg_789';

  // 1. Detect and translate
  const translation = await translationService.translate(userMessage, 'en');

  // 2. Store translation record
  await translationService.storeTranslationRecord(sessionId, {
    messageId,
    originalText: userMessage,
    detectedLanguage: translation.detectedLanguage,
    translatedText: translation.translatedText,
    canonicalForm: translation.canonicalForm,
    translationConfidence: translation.confidence,
    translatorMetadata: translation.metadata,
  });

  // 3. Use canonical form for schema matching
  console.log('Canonical form for schema:', translation.canonicalForm);
  // 'je cherche un hotel a galle'

  // 4. The Orchestrator would now:
  //    - Match canonical form against schema fields
  //    - Extract parameters (e.g., location: 'galle')
  //    - Determine missing fields
  //    - Generate prompts in user's language (fr)

  console.log('\nOrchestrator would:');
  console.log('- Use canonical form for schema matching');
  console.log('- Extract location: "galle"');
  console.log('- Generate prompts in French (user language)');
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExamples() {
  try {
    await example1_detectLanguage();
    await example2_canonicalForm();
    await example3_translation();
    // await example4_storeTranslationRecord(); // Requires database
    // await example5_completeWorkflow(); // Requires database
    await example6_errorHandling();
    await example7_customConfiguration();
    // await example8_orchestratorIntegration(); // Requires database
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Uncomment to run examples
// runExamples();
