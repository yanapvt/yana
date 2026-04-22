/**
 * Orchestrator Usage Examples
 * 
 * Demonstrates how to use the Orchestrator to validate LLM decision outputs
 * before taking any action.
 */

import { Orchestrator } from './Orchestrator.js';
import { SchemaEngine } from './SchemaEngine.js';
import type { LLMDecisionOutput, SchemaDefinition } from '../types/core.js';

// ============================================================================
// Example 1: Basic Validation with Confidence Check
// ============================================================================

function example1_basicValidation() {
  console.log('\n=== Example 1: Basic Validation with Confidence Check ===\n');

  const orchestrator = new Orchestrator({
    confidenceThreshold: 0.85,
  });

  // High confidence decision
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: { location: 'Galle' },
    missingFields: ['checkin_date'],
    suggestedAction: 'ask_missing',
    confidence: 0.92,
  };

  const result = orchestrator.validateLLMDecision(decision);

  console.log('Decision:', decision);
  console.log('Should proceed:', result.shouldProceed);
  console.log('Validation valid:', result.validation.valid);
  console.log('Errors:', result.validation.errors);
}

// ============================================================================
// Example 2: Low Confidence Fallback
// ============================================================================

function example2_lowConfidenceFallback() {
  console.log('\n=== Example 2: Low Confidence Fallback ===\n');

  const orchestrator = new Orchestrator({
    confidenceThreshold: 0.85,
  });

  // Low confidence decision
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {},
    missingFields: ['location', 'checkin_date'],
    suggestedAction: 'ask_missing',
    confidence: 0.65, // Below threshold
  };

  const result = orchestrator.validateLLMDecision(decision);

  console.log('Decision confidence:', decision.confidence);
  console.log('Threshold:', orchestrator.getConfidenceThreshold());
  console.log('Should proceed:', result.shouldProceed);
  console.log('Fallback action:', result.fallbackAction);
  console.log('Fallback reason:', result.fallbackReason);

  // Expected output:
  // Should proceed: false
  // Fallback action: ui_narrowing
  // Fallback reason: Confidence 0.65 below threshold 0.85
}

// ============================================================================
// Example 3: Schema Validation
// ============================================================================

function example3_schemaValidation() {
  console.log('\n=== Example 3: Schema Validation ===\n');

  const orchestrator = new Orchestrator();

  const hotelSearchSchema: SchemaDefinition = {
    schemaName: 'search_hotels',
    version: '1.0',
    requiredFields: ['location', 'checkin_date'],
    optionalFields: ['checkout_date', 'guests'],
    fields: {
      location: {
        name: 'location',
        type: 'location_or_text',
        ui: {
          promptKey: 'hotel.location.prompt',
          mode: 'text',
        },
        validation: {
          required: true,
        },
      },
      checkin_date: {
        name: 'checkin_date',
        type: 'date',
        ui: {
          promptKey: 'hotel.checkin.prompt',
          mode: 'buttons',
        },
        validation: {
          required: true,
        },
      },
      guests: {
        name: 'guests',
        type: 'number',
        ui: {
          promptKey: 'hotel.guests.prompt',
          mode: 'text',
        },
        validation: {
          required: false,
          min: 1,
          max: 10,
        },
      },
    },
  };

  // Decision with all required fields
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {
      location: 'Galle',
      checkin_date: '2026-04-17',
      guests: 2,
    },
    missingFields: [],
    suggestedAction: 'execute_tool',
    confidence: 0.95,
  };

  const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

  console.log('Schema validation passed:', result.validation.valid);
  console.log('Should proceed:', result.shouldProceed);
}

// ============================================================================
// Example 4: Schema Validation with Missing Fields
// ============================================================================

function example4_schemaValidationWithMissingFields() {
  console.log('\n=== Example 4: Schema Validation with Missing Fields ===\n');

  const orchestrator = new Orchestrator();

  const hotelSearchSchema: SchemaDefinition = {
    schemaName: 'search_hotels',
    version: '1.0',
    requiredFields: ['location', 'checkin_date'],
    optionalFields: [],
    fields: {
      location: {
        name: 'location',
        type: 'text',
        ui: { promptKey: 'location', mode: 'text' },
        validation: { required: true },
      },
      checkin_date: {
        name: 'checkin_date',
        type: 'date',
        ui: { promptKey: 'checkin', mode: 'text' },
        validation: { required: true },
      },
    },
  };

  // Decision missing required field
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {
      location: 'Galle',
      // checkin_date is missing
    },
    missingFields: ['checkin_date'],
    suggestedAction: 'ask_missing',
    confidence: 0.90,
  };

  const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

  console.log('Should proceed:', result.shouldProceed);
  console.log('Suggested action:', decision.suggestedAction);
  // Should proceed: true (because action is 'ask_missing', not 'execute_tool')
}

// ============================================================================
// Example 5: Business Rule Violation
// ============================================================================

function example5_businessRuleViolation() {
  console.log('\n=== Example 5: Business Rule Violation ===\n');

  const orchestrator = new Orchestrator();

  // Invalid: trying to execute tool with missing fields
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: { location: 'Galle' },
    missingFields: ['checkin_date'],
    suggestedAction: 'execute_tool', // Invalid!
    confidence: 0.90,
  };

  const result = orchestrator.validateLLMDecision(decision);

  console.log('Should proceed:', result.shouldProceed);
  console.log('Fallback action:', result.fallbackAction);
  console.log('Fallback reason:', result.fallbackReason);
  console.log('Errors:', result.validation.errors);

  // Expected:
  // Should proceed: false
  // Fallback action: clarify
  // Errors include business rule violation
}

// ============================================================================
// Example 6: Merging Collected Fields with LLM Parameters
// ============================================================================

function example6_mergingCollectedFields() {
  console.log('\n=== Example 6: Merging Collected Fields ===\n');

  const orchestrator = new Orchestrator();

  const hotelSearchSchema: SchemaDefinition = {
    schemaName: 'search_hotels',
    version: '1.0',
    requiredFields: ['location', 'checkin_date'],
    optionalFields: [],
    fields: {
      location: {
        name: 'location',
        type: 'text',
        ui: { promptKey: 'location', mode: 'text' },
        validation: { required: true },
      },
      checkin_date: {
        name: 'checkin_date',
        type: 'date',
        ui: { promptKey: 'checkin', mode: 'text' },
        validation: { required: true },
      },
    },
  };

  // Previously collected fields
  const collectedFields = {
    location: 'Galle',
  };

  // LLM provides the remaining field
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {
      checkin_date: '2026-04-17',
    },
    missingFields: [],
    suggestedAction: 'execute_tool',
    confidence: 0.92,
  };

  const result = orchestrator.validateLLMDecision(
    decision,
    hotelSearchSchema,
    collectedFields
  );

  console.log('Should proceed:', result.shouldProceed);
  console.log('Validation valid:', result.validation.valid);
  // Should proceed: true (all required fields present when merged)
}

// ============================================================================
// Example 7: Field Value Validation
// ============================================================================

function example7_fieldValueValidation() {
  console.log('\n=== Example 7: Field Value Validation ===\n');

  const orchestrator = new Orchestrator();

  const hotelSearchSchema: SchemaDefinition = {
    schemaName: 'search_hotels',
    version: '1.0',
    requiredFields: ['location', 'guests'],
    optionalFields: [],
    fields: {
      location: {
        name: 'location',
        type: 'text',
        ui: { promptKey: 'location', mode: 'text' },
        validation: { required: true },
      },
      guests: {
        name: 'guests',
        type: 'number',
        ui: { promptKey: 'guests', mode: 'text' },
        validation: {
          required: true,
          min: 1,
          max: 10,
        },
      },
    },
  };

  // Invalid guest count
  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {
      location: 'Galle',
      guests: 15, // Exceeds max of 10
    },
    missingFields: [],
    suggestedAction: 'execute_tool',
    confidence: 0.90,
  };

  const result = orchestrator.validateLLMDecision(decision, hotelSearchSchema);

  console.log('Should proceed:', result.shouldProceed);
  console.log('Validation errors:', result.validation.errors);
  // Should proceed: false (guests value exceeds max)
}

// ============================================================================
// Example 8: Dynamic Confidence Threshold
// ============================================================================

function example8_dynamicConfidenceThreshold() {
  console.log('\n=== Example 8: Dynamic Confidence Threshold ===\n');

  const orchestrator = new Orchestrator({
    confidenceThreshold: 0.85,
  });

  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {},
    missingFields: ['location'],
    suggestedAction: 'ask_missing',
    confidence: 0.80,
  };

  // First validation with default threshold
  let result = orchestrator.validateLLMDecision(decision);
  console.log('With threshold 0.85, should proceed:', result.shouldProceed);

  // Lower threshold for less critical operations
  orchestrator.setConfidenceThreshold(0.75);
  result = orchestrator.validateLLMDecision(decision);
  console.log('With threshold 0.75, should proceed:', result.shouldProceed);
}

// ============================================================================
// Example 9: Complete Validation Flow
// ============================================================================

function example9_completeValidationFlow() {
  console.log('\n=== Example 9: Complete Validation Flow ===\n');

  const orchestrator = new Orchestrator();

  const schema: SchemaDefinition = {
    schemaName: 'search_hotels',
    version: '1.0',
    requiredFields: ['location', 'checkin_date'],
    optionalFields: ['guests'],
    fields: {
      location: {
        name: 'location',
        type: 'text',
        ui: { promptKey: 'location', mode: 'text' },
        validation: { required: true },
      },
      checkin_date: {
        name: 'checkin_date',
        type: 'date',
        ui: { promptKey: 'checkin', mode: 'text' },
        validation: { required: true },
      },
      guests: {
        name: 'guests',
        type: 'number',
        ui: { promptKey: 'guests', mode: 'text' },
        validation: { required: false, min: 1, max: 10 },
      },
    },
  };

  const decision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: {
      location: 'Galle',
      checkin_date: '2026-04-17',
      guests: 2,
    },
    missingFields: [],
    suggestedAction: 'execute_tool',
    confidence: 0.95,
  };

  const result = orchestrator.validateLLMDecision(decision, schema);

  if (result.shouldProceed) {
    console.log('✓ Validation passed - ready to execute tool');
    console.log('  Intent:', decision.intent);
    console.log('  Parameters:', decision.parameters);
    console.log('  Confidence:', decision.confidence);
  } else {
    console.log('✗ Validation failed');
    console.log('  Fallback action:', result.fallbackAction);
    console.log('  Reason:', result.fallbackReason);
    console.log('  Errors:', result.validation.errors);
  }
}

// ============================================================================
// Example 10: Integration with LLMService
// ============================================================================

async function example10_integrationWithLLMService() {
  console.log('\n=== Example 10: Integration with LLMService ===\n');

  // This example shows how Orchestrator integrates with LLMService
  // in a real request flow

  const orchestrator = new Orchestrator({
    confidenceThreshold: 0.85,
  });

  // Simulated LLM decision output
  const llmDecision: LLMDecisionOutput = {
    intent: 'search_hotels',
    parameters: { location: 'Galle' },
    missingFields: ['checkin_date'],
    suggestedAction: 'ask_missing',
    confidence: 0.92,
  };

  // Validate the LLM decision
  const validated = orchestrator.validateLLMDecision(llmDecision);

  if (!validated.shouldProceed) {
    console.log('Falling back to:', validated.fallbackAction);
    console.log('Reason:', validated.fallbackReason);
    
    if (validated.fallbackAction === 'ui_narrowing') {
      // Generate UI prompt to narrow intent
      console.log('→ Generating UI narrowing options');
    } else if (validated.fallbackAction === 'clarify') {
      // Ask user for clarification
      console.log('→ Asking user for clarification');
    }
    return;
  }

  // Proceed based on suggested action
  switch (llmDecision.suggestedAction) {
    case 'ask_missing':
      console.log('→ Collecting missing fields:', llmDecision.missingFields);
      break;
    
    case 'execute_tool':
      console.log('→ Executing tool:', llmDecision.intent);
      console.log('  Parameters:', llmDecision.parameters);
      break;
    
    case 'clarify':
      console.log('→ Requesting clarification from user');
      break;
    
    case 'handoff':
      console.log('→ Escalating to human operator');
      break;
  }
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  example1_basicValidation();
  example2_lowConfidenceFallback();
  example3_schemaValidation();
  example4_schemaValidationWithMissingFields();
  example5_businessRuleViolation();
  example6_mergingCollectedFields();
  example7_fieldValueValidation();
  example8_dynamicConfidenceThreshold();
  example9_completeValidationFlow();
  example10_integrationWithLLMService();
}
