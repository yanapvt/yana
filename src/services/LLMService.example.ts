/**
 * Example usage of LLMService
 * 
 * This file demonstrates how to use the LLMService for both decision mode
 * and UI-support mode.
 */

import { getLLMService, initLLMService, type ContextPackage } from './LLMService.js';

// ============================================================================
// Example 1: Decision Mode - Basic Intent Detection
// ============================================================================

async function example1_basicIntentDetection() {
  console.log('\n=== Example 1: Basic Intent Detection ===\n');

  const llmService = getLLMService();

  const contextPackage: ContextPackage = {
    userMessage: 'I want to book a hotel in Galle for next week',
  };

  const decision = await llmService.decide(contextPackage);

  console.log('User message:', contextPackage.userMessage);
  console.log('Detected intent:', decision.intent);
  console.log('Extracted parameters:', decision.parameters);
  console.log('Missing fields:', decision.missingFields);
  console.log('Suggested action:', decision.suggestedAction);
  console.log('Confidence:', decision.confidence);
  if (decision.reasoning) {
    console.log('Reasoning:', decision.reasoning);
  }
}

// ============================================================================
// Example 2: Decision Mode - With Conversation History
// ============================================================================

async function example2_withConversationHistory() {
  console.log('\n=== Example 2: Decision Mode with Conversation History ===\n');

  const llmService = getLLMService();

  const contextPackage: ContextPackage = {
    userMessage: 'Yes, Galle',
    conversationHistory: [
      { role: 'assistant', content: 'Where would you like to stay?' },
      { role: 'user', content: 'I want to book a hotel' },
      { role: 'assistant', content: 'Great! Which city are you interested in?' },
    ],
  };

  const decision = await llmService.decide(contextPackage);

  console.log('User message:', contextPackage.userMessage);
  console.log('Detected intent:', decision.intent);
  console.log('Extracted parameters:', decision.parameters);
  console.log('Missing fields:', decision.missingFields);
  console.log('Suggested action:', decision.suggestedAction);
}

// ============================================================================
// Example 3: Decision Mode - With Session State
// ============================================================================

async function example3_withSessionState() {
  console.log('\n=== Example 3: Decision Mode with Session State ===\n');

  const llmService = getLLMService();

  const contextPackage: ContextPackage = {
    userMessage: 'Tomorrow',
    sessionState: {
      currentIntent: 'search_hotels',
      activeSchema: 'hotel_search',
      collectedFields: {
        location: 'Galle',
        guests: 2,
      },
      missingFields: ['checkin_date', 'checkout_date'],
    },
  };

  const decision = await llmService.decide(contextPackage);

  console.log('User message:', contextPackage.userMessage);
  console.log('Current intent:', contextPackage.sessionState?.currentIntent);
  console.log('Collected fields:', contextPackage.sessionState?.collectedFields);
  console.log('Decision:', {
    intent: decision.intent,
    parameters: decision.parameters,
    missingFields: decision.missingFields,
    suggestedAction: decision.suggestedAction,
  });
}

// ============================================================================
// Example 4: Decision Mode - With User Profile
// ============================================================================

async function example4_withUserProfile() {
  console.log('\n=== Example 4: Decision Mode with User Profile ===\n');

  const llmService = getLLMService();

  const contextPackage: ContextPackage = {
    userMessage: 'Book my usual',
    userProfile: {
      preferredLanguage: 'en',
      nationality: 'GB',
      recentActions: ['search_hotels', 'book_hotel'],
    },
  };

  const decision = await llmService.decide(contextPackage);

  console.log('User message:', contextPackage.userMessage);
  console.log('User profile:', contextPackage.userProfile);
  console.log('Decision:', {
    intent: decision.intent,
    suggestedAction: decision.suggestedAction,
    confidence: decision.confidence,
  });
}

// ============================================================================
// Example 5: UI-Support Mode - Generate Confirmation Message
// ============================================================================

async function example5_generateConfirmation() {
  console.log('\n=== Example 5: UI-Support Mode - Confirmation Message ===\n');

  const llmService = getLLMService();

  const prompt = 'Generate a friendly confirmation message for a hotel booking at Galle Beach Hotel for 2 nights starting April 17, 2026. Total cost is £150.';
  const userLanguage = 'en';

  const content = await llmService.generateUIContent(prompt, userLanguage);

  console.log('Prompt:', prompt);
  console.log('Generated content:', content);
}

// ============================================================================
// Example 6: UI-Support Mode - Generate Error Message
// ============================================================================

async function example6_generateErrorMessage() {
  console.log('\n=== Example 6: UI-Support Mode - Error Message ===\n');

  const llmService = getLLMService();

  const prompt = 'Generate a friendly error message explaining that the hotel is fully booked for the selected dates. Suggest trying different dates or a nearby hotel.';
  const userLanguage = 'en';

  const content = await llmService.generateUIContent(prompt, userLanguage);

  console.log('Prompt:', prompt);
  console.log('Generated content:', content);
}

// ============================================================================
// Example 7: UI-Support Mode - Multilingual Content
// ============================================================================

async function example7_multilingualContent() {
  console.log('\n=== Example 7: UI-Support Mode - Multilingual Content ===\n');

  const llmService = getLLMService();

  const prompt = 'Generate a welcome message for a new user';

  // Generate in English
  const englishContent = await llmService.generateUIContent(prompt, 'en');
  console.log('English:', englishContent);

  // Generate in Spanish
  const spanishContent = await llmService.generateUIContent(prompt, 'es');
  console.log('Spanish:', spanishContent);

  // Generate in French
  const frenchContent = await llmService.generateUIContent(prompt, 'fr');
  console.log('French:', frenchContent);
}

// ============================================================================
// Example 8: Custom Configuration
// ============================================================================

async function example8_customConfiguration() {
  console.log('\n=== Example 8: Custom Configuration ===\n');

  // Initialize with custom configuration
  const llmService = initLLMService({
    provider: 'mock',
    apiKey: 'custom-api-key',
    model: 'custom-model',
    confidenceThreshold: 0.9,
  });

  const contextPackage: ContextPackage = {
    userMessage: 'Find hotels',
  };

  const decision = await llmService.decide(contextPackage);

  console.log('Using custom configuration');
  console.log('Decision confidence:', decision.confidence);
  console.log('Suggested action:', decision.suggestedAction);
}

// ============================================================================
// Example 9: Low Confidence Handling
// ============================================================================

async function example9_lowConfidenceHandling() {
  console.log('\n=== Example 9: Low Confidence Handling ===\n');

  const llmService = getLLMService();

  const contextPackage: ContextPackage = {
    userMessage: 'xyz abc 123', // Ambiguous message
  };

  const decision = await llmService.decide(contextPackage);

  console.log('User message:', contextPackage.userMessage);
  console.log('Confidence:', decision.confidence);

  // The Orchestrator should check confidence against threshold
  const confidenceThreshold = 0.85;
  if (decision.confidence < confidenceThreshold) {
    console.log('⚠️  Low confidence detected!');
    console.log('Suggested action: Fall back to UI-based narrowing');
  } else {
    console.log('✓ Confidence is acceptable');
    console.log('Suggested action:', decision.suggestedAction);
  }
}

// ============================================================================
// Example 10: Error Handling
// ============================================================================

async function example10_errorHandling() {
  console.log('\n=== Example 10: Error Handling ===\n');

  try {
    // Try to create service with invalid configuration
    const invalidService = initLLMService({
      provider: 'unsupported-provider',
      apiKey: 'test-key',
      model: 'test-model',
    });

    const contextPackage: ContextPackage = {
      userMessage: 'Test',
    };

    await invalidService.decide(contextPackage);
  } catch (error) {
    console.log('Error caught:', error);
    if (error instanceof Error) {
      console.log('Error message:', error.message);
      console.log('Error name:', error.name);
    }
  }
}

// ============================================================================
// Run All Examples
// ============================================================================

async function runAllExamples() {
  try {
    await example1_basicIntentDetection();
    await example2_withConversationHistory();
    await example3_withSessionState();
    await example4_withUserProfile();
    await example5_generateConfirmation();
    await example6_generateErrorMessage();
    await example7_multilingualContent();
    await example8_customConfiguration();
    await example9_lowConfidenceHandling();
    await example10_errorHandling();

    console.log('\n=== All examples completed successfully! ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}
