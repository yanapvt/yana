/**
 * SchemaEngine Usage Examples
 * 
 * This file demonstrates how to use the SchemaEngine service
 * for schema-driven field collection and validation.
 */

import { SchemaEngine } from './SchemaEngine.js';
import type { SchemaDefinition } from '../types/core.js';
import type { CollectedFields } from './SchemaEngine.js';

// ============================================================================
// Example 1: Hotel Search Schema
// ============================================================================

const hotelSearchSchema: SchemaDefinition = {
  schemaName: 'search_hotels',
  version: '1.0',
  requiredFields: ['location', 'checkin_date'],
  optionalFields: ['checkout_date', 'guests', 'budget', 'currency'],
  fields: {
    location: {
      name: 'location',
      type: 'location_or_text',
      ui: {
        promptKey: 'hotel.location.prompt',
        mode: 'list_or_text',
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
        options: [
          { id: 'today', labelKey: 'Today', value: 'today' },
          { id: 'tomorrow', labelKey: 'Tomorrow', value: 'tomorrow' },
          { id: 'pick_date', labelKey: 'Pick date', value: 'custom' },
        ],
      },
      validation: {
        required: true,
      },
    },
    checkout_date: {
      name: 'checkout_date',
      type: 'date',
      ui: {
        promptKey: 'hotel.checkout.prompt',
        mode: 'text',
      },
      validation: {
        required: false,
      },
    },
    guests: {
      name: 'guests',
      type: 'number',
      ui: {
        promptKey: 'hotel.guests.prompt',
        mode: 'text',
        placeholder: 'Number of guests',
      },
      validation: {
        required: false,
        min: 1,
        max: 10,
      },
    },
    budget: {
      name: 'budget',
      type: 'number',
      ui: {
        promptKey: 'hotel.budget.prompt',
        mode: 'text',
      },
      validation: {
        required: false,
        min: 0,
      },
    },
    currency: {
      name: 'currency',
      type: 'text',
      ui: {
        promptKey: 'hotel.currency.prompt',
        mode: 'buttons',
        options: [
          { id: 'usd', labelKey: 'USD', value: 'USD' },
          { id: 'gbp', labelKey: 'GBP', value: 'GBP' },
          { id: 'eur', labelKey: 'EUR', value: 'EUR' },
        ],
      },
      validation: {
        required: false,
      },
    },
  },
  metadata: {
    collectionOrder: ['location', 'checkin_date', 'checkout_date', 'guests'],
  },
};

// ============================================================================
// Example Usage: Progressive Field Collection
// ============================================================================

function demonstrateFieldCollection() {
  const engine = new SchemaEngine();
  const collectedFields: CollectedFields = {};

  console.log('=== Hotel Search Field Collection Demo ===\n');

  // Step 1: Check initial missing fields
  console.log('Step 1: Initial state (no fields collected)');
  let missingFields = engine.getMissingFields(hotelSearchSchema, collectedFields);
  console.log('Missing required fields:', missingFields);
  console.log('Schema complete?', engine.isComplete(hotelSearchSchema, collectedFields));
  console.log();

  // Step 2: Collect location
  console.log('Step 2: User provides location');
  collectedFields.location = 'Galle';
  missingFields = engine.getMissingFields(hotelSearchSchema, collectedFields);
  console.log('Collected fields:', Object.keys(collectedFields));
  console.log('Missing required fields:', missingFields);
  console.log('Schema complete?', engine.isComplete(hotelSearchSchema, collectedFields));
  console.log();

  // Step 3: Generate prompt for next field
  console.log('Step 3: Generate prompt for next missing field');
  const nextField = engine.getNextFieldToCollect(hotelSearchSchema, collectedFields);
  if (nextField) {
    const fieldDef = hotelSearchSchema.fields[nextField];
    const prompt = engine.generateFieldPrompt(fieldDef, 'en');
    console.log('Next field to collect:', nextField);
    console.log('Prompt:', JSON.stringify(prompt, null, 2));
  }
  console.log();

  // Step 4: Collect check-in date
  console.log('Step 4: User provides check-in date');
  collectedFields.checkin_date = '2026-04-18';
  missingFields = engine.getMissingFields(hotelSearchSchema, collectedFields);
  console.log('Collected fields:', Object.keys(collectedFields));
  console.log('Missing required fields:', missingFields);
  console.log('Schema complete?', engine.isComplete(hotelSearchSchema, collectedFields));
  console.log();

  // Step 5: Validate all fields
  console.log('Step 5: Validate collected fields');
  const validation = engine.validateFields(hotelSearchSchema, collectedFields);
  console.log('Validation result:', validation);
  console.log();
}

// ============================================================================
// Example 2: Conditional Fields
// ============================================================================

const bookingSchema: SchemaDefinition = {
  schemaName: 'create_booking',
  version: '1.0',
  requiredFields: ['booking_type', 'hotel_name', 'flight_number'],
  optionalFields: [],
  fields: {
    booking_type: {
      name: 'booking_type',
      type: 'enum',
      ui: {
        promptKey: 'booking.type.prompt',
        mode: 'buttons',
        options: [
          { id: 'hotel', labelKey: 'Hotel', value: 'hotel' },
          { id: 'flight', labelKey: 'Flight', value: 'flight' },
        ],
      },
      validation: {
        required: true,
      },
    },
    hotel_name: {
      name: 'hotel_name',
      type: 'text',
      ui: {
        promptKey: 'booking.hotel.prompt',
        mode: 'text',
      },
      validation: {
        required: true,
      },
      conditional: {
        dependsOn: 'booking_type',
        condition: 'equals',
        value: 'hotel',
      },
    },
    flight_number: {
      name: 'flight_number',
      type: 'text',
      ui: {
        promptKey: 'booking.flight.prompt',
        mode: 'text',
      },
      validation: {
        required: true,
      },
      conditional: {
        dependsOn: 'booking_type',
        condition: 'equals',
        value: 'flight',
      },
    },
  },
};

function demonstrateConditionalFields() {
  const engine = new SchemaEngine();

  console.log('=== Conditional Fields Demo ===\n');

  // Scenario 1: Hotel booking
  console.log('Scenario 1: User selects hotel booking');
  const hotelFields: CollectedFields = {
    booking_type: 'hotel',
  };
  let missing = engine.getMissingFields(bookingSchema, hotelFields);
  console.log('Missing fields:', missing);
  console.log('(flight_number is not required because booking_type is "hotel")');
  console.log();

  // Scenario 2: Flight booking
  console.log('Scenario 2: User selects flight booking');
  const flightFields: CollectedFields = {
    booking_type: 'flight',
  };
  missing = engine.getMissingFields(bookingSchema, flightFields);
  console.log('Missing fields:', missing);
  console.log('(hotel_name is not required because booking_type is "flight")');
  console.log();
}

// ============================================================================
// Example 3: Validation Errors
// ============================================================================

function demonstrateValidation() {
  const engine = new SchemaEngine();

  console.log('=== Validation Demo ===\n');

  // Test 1: Missing required field
  console.log('Test 1: Missing required field');
  const fields1: CollectedFields = {
    location: 'Galle',
    // checkin_date is missing
  };
  const result1 = engine.validateFields(hotelSearchSchema, fields1);
  console.log('Valid?', result1.valid);
  console.log('Errors:', result1.errors);
  console.log();

  // Test 2: Invalid number (below minimum)
  console.log('Test 2: Invalid number (below minimum)');
  const fields2: CollectedFields = {
    location: 'Galle',
    checkin_date: '2026-04-18',
    guests: 0, // Below minimum of 1
  };
  const result2 = engine.validateFields(hotelSearchSchema, fields2);
  console.log('Valid?', result2.valid);
  console.log('Errors:', result2.errors);
  console.log();

  // Test 3: Valid fields
  console.log('Test 3: All valid fields');
  const fields3: CollectedFields = {
    location: 'Galle',
    checkin_date: '2026-04-18',
    guests: 2,
  };
  const result3 = engine.validateFields(hotelSearchSchema, fields3);
  console.log('Valid?', result3.valid);
  console.log('Errors:', result3.errors);
  console.log();
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateFieldCollection();
  console.log('\n' + '='.repeat(60) + '\n');
  demonstrateConditionalFields();
  console.log('\n' + '='.repeat(60) + '\n');
  demonstrateValidation();
}
