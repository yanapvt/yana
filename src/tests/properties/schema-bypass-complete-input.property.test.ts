/**
 * Property Test 5: Schema Bypass on Complete Input
 * 
 * **Validates: Requirements 2.3, 3.3**
 * 
 * Property Statement:
 * For any user input that already supplies all required schema fields, the Orchestrator 
 * SHALL proceed to tool execution without generating UI narrowing or field collection prompts.
 * 
 * Requirements:
 * - 2.3: WHEN user input already supplies sufficient schema fields, THE Orchestrator SHALL 
 *        bypass unnecessary UI narrowing steps and proceed directly to tool execution or 
 *        result presentation
 * - 3.3: THE Schema_Engine SHALL validate all field values against the schema validation 
 *        rules before allowing tool execution
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { SchemaEngine } from '../../services/SchemaEngine.js';
import type { SchemaDefinition, SchemaField, SchemaFieldType } from '../../types/core.js';

// Type alias for collected fields
type CollectedFields = Record<string, unknown>;

// ============================================================================
// Arbitraries for property-based testing
// ============================================================================

const fieldNameArb = fc.stringMatching(/^[a-z_][a-z0-9_]{0,15}$/);

const fieldTypeArb: fc.Arbitrary<SchemaFieldType> = fc.constantFrom(
  'text',
  'number',
  'date',
  'location',
  'location_or_text',
  'currency',
  'boolean',
  'enum'
);

/**
 * Generate a valid value for a given field type
 */
function generateValidValueForType(type: SchemaFieldType): unknown {
  switch (type) {
    case 'number':
      return 42;
    case 'date':
      return '2026-04-18';
    case 'boolean':
      return true;
    case 'location':
    case 'location_or_text':
      return 'Galle, Sri Lanka';
    case 'currency':
      return 'USD';
    case 'enum':
      return 'option_a';
    case 'text':
    default:
      return 'valid_text_value';
  }
}

/**
 * Generate a schema field with validation rules
 */
const schemaFieldArb: fc.Arbitrary<SchemaField> = fc
  .tuple(fieldNameArb, fieldTypeArb, fc.boolean())
  .chain(([name, type, isRequired]) => {
    return fc.record({
      name: fc.constant(name),
      type: fc.constant(type),
      ui: fc.record({
        promptKey: fc.constant(`field.${name}.prompt`),
        mode: fc.constantFrom('text', 'buttons', 'list', 'list_or_text'),
        options: fc.option(
          fc.array(
            fc.record({
              id: fc.string(),
              labelKey: fc.string(),
              value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          { nil: undefined }
        ),
        placeholder: fc.option(fc.string(), { nil: undefined }),
      }),
      validation: fc.record({
        required: fc.constant(isRequired),
        pattern: fc.option(fc.constant('[a-zA-Z0-9_]+'), { nil: undefined }),
        min: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
        max: fc.option(fc.nat({ min: 100, max: 1000 }), { nil: undefined }),
        customValidator: fc.option(fc.constant('customValidator'), { nil: undefined }),
      }),
      conditional: fc.constant(undefined), // No conditional fields for simplicity
    });
  });

/**
 * Generate a schema definition with at least one required field
 */
const schemaDefinitionArb: fc.Arbitrary<SchemaDefinition> = fc
  .array(schemaFieldArb, { minLength: 1, maxLength: 8 })
  .chain((fields) => {
    // Ensure unique field names
    const uniqueFields = Array.from(
      new Map(fields.map((f) => [f.name, f])).values()
    );

    const requiredFields = uniqueFields
      .filter((f) => f.validation.required)
      .map((f) => f.name);
    const optionalFields = uniqueFields
      .filter((f) => !f.validation.required)
      .map((f) => f.name);
    const fieldsMap = Object.fromEntries(uniqueFields.map((f) => [f.name, f]));

    return fc.constant({
      schemaName: 'test_schema',
      version: '1.0',
      requiredFields,
      optionalFields,
      fields: fieldsMap,
      metadata: {},
    });
  })
  .filter((schema) => schema.requiredFields.length > 0); // Ensure at least one required field

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 5: Schema Bypass on Complete Input', () => {
  const engine = new SchemaEngine();

  it('should report no missing fields when all required fields are supplied', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with all required fields collected with valid values
        const collectedFields: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check for missing fields
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: No fields should be reported as missing
        expect(missingFields).toHaveLength(0);
        expect(missingFields).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it('should mark schema as complete when all required fields are supplied with valid values', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with all required fields collected with valid values
        const collectedFields: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check if schema is complete
        const isComplete = engine.isComplete(schema, collectedFields);

        // Then: Schema should be marked as complete
        expect(isComplete).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should validate successfully when all required fields have valid values', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with all required fields collected with valid values
        const collectedFields: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We validate the fields
        const validation = engine.validateFields(schema, collectedFields);

        // Then: Validation should pass
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should not generate field prompts when all required fields are complete', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with all required fields collected with valid values
        const collectedFields: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check for the next field to collect
        const nextField = engine.getNextFieldToCollect(schema, collectedFields);

        // Then: No next field should be needed
        expect(nextField).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('should bypass field collection when complete input is provided upfront', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: User provides all required fields in a single input
        const completeInput: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          completeInput[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We process this complete input
        const missingFields = engine.getMissingFields(schema, completeInput);
        const isComplete = engine.isComplete(schema, completeInput);
        const nextField = engine.getNextFieldToCollect(schema, completeInput);

        // Then: System should indicate readiness to proceed without prompts
        expect(missingFields).toHaveLength(0);
        expect(isComplete).toBe(true);
        expect(nextField).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('should allow optional fields without affecting completeness', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        fc.pre(schema.optionalFields.length > 0); // Need at least one optional field

        // Given: A schema with only required fields collected (no optional fields)
        const collectedFields: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check completeness without optional fields
        const isComplete = engine.isComplete(schema, collectedFields);
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: Schema should still be complete
        expect(isComplete).toBe(true);
        expect(missingFields).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should handle complete input with extra optional fields', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        fc.pre(schema.optionalFields.length > 0); // Need at least one optional field

        // Given: A schema with all required fields AND some optional fields
        const collectedFields: CollectedFields = {};

        // Collect all required fields
        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // Also collect some optional fields
        const optionalToCollect = schema.optionalFields.slice(0, Math.ceil(schema.optionalFields.length / 2));
        optionalToCollect.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check completeness
        const isComplete = engine.isComplete(schema, collectedFields);
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: Schema should be complete
        expect(isComplete).toBe(true);
        expect(missingFields).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should transition immediately to complete state when all fields provided at once', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: Starting with no fields
        const emptyFields: CollectedFields = {};
        expect(engine.isComplete(schema, emptyFields)).toBe(false);

        // When: All required fields are provided in a single step
        const completeFields: CollectedFields = {};
        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          completeFields[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // Then: Should immediately transition to complete
        expect(engine.isComplete(schema, completeFields)).toBe(true);
        expect(engine.getMissingFields(schema, completeFields)).toHaveLength(0);
        expect(engine.getNextFieldToCollect(schema, completeFields)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('should maintain bypass behavior across multiple checks', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: Complete input with all required fields
        const completeInput: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          completeInput[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check completeness multiple times
        const check1 = engine.isComplete(schema, completeInput);
        const check2 = engine.isComplete(schema, completeInput);
        const check3 = engine.isComplete(schema, completeInput);

        const missing1 = engine.getMissingFields(schema, completeInput);
        const missing2 = engine.getMissingFields(schema, completeInput);

        // Then: Results should be consistent (idempotent)
        expect(check1).toBe(true);
        expect(check2).toBe(true);
        expect(check3).toBe(true);
        expect(missing1).toEqual(missing2);
        expect(missing1).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should distinguish between complete and incomplete input', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        fc.pre(schema.requiredFields.length >= 2); // Need at least 2 fields

        // Given: Two inputs - one complete, one incomplete
        const completeInput: CollectedFields = {};
        const incompleteInput: CollectedFields = {};

        // Complete input has all required fields
        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          completeInput[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // Incomplete input has all but one required field
        schema.requiredFields.slice(0, -1).forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          incompleteInput[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We check both inputs
        const completeCheck = engine.isComplete(schema, completeInput);
        const incompleteCheck = engine.isComplete(schema, incompleteInput);

        const completeMissing = engine.getMissingFields(schema, completeInput);
        const incompleteMissing = engine.getMissingFields(schema, incompleteInput);

        // Then: Complete input should bypass, incomplete should not
        expect(completeCheck).toBe(true);
        expect(incompleteCheck).toBe(false);
        expect(completeMissing).toHaveLength(0);
        expect(incompleteMissing.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should validate complete input before allowing bypass', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: Complete input with all required fields
        const completeInput: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          completeInput[fieldName] = generateValidValueForType(fieldDef.type);
        });

        // When: We validate and check completeness
        const validation = engine.validateFields(schema, completeInput);
        const isComplete = engine.isComplete(schema, completeInput);

        // Then: Both validation and completeness should pass
        expect(validation.valid).toBe(true);
        expect(isComplete).toBe(true);

        // And: isComplete should imply valid validation
        if (isComplete) {
          expect(validation.valid).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should not bypass when fields are present but invalid', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        fc.pre(
          schema.requiredFields.some((fieldName) => {
            const field = schema.fields[fieldName];
            return field.type === 'number' && field.validation.min !== undefined;
          })
        );

        // Given: A schema with a numeric field that has min validation
        const numericField = schema.requiredFields.find((fieldName) => {
          const field = schema.fields[fieldName];
          return field.type === 'number' && field.validation.min !== undefined;
        })!;

        const collectedFields: CollectedFields = {};

        // Collect all required fields
        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];
          if (fieldName === numericField) {
            // Provide invalid value (below min)
            const minValue = fieldDef.validation.min!;
            collectedFields[fieldName] = minValue - 1;
          } else {
            collectedFields[fieldName] = generateValidValueForType(fieldDef.type);
          }
        });

        // When: We check completeness with invalid data
        const isComplete = engine.isComplete(schema, collectedFields);
        const validation = engine.validateFields(schema, collectedFields);

        // Then: Schema should not be complete due to validation failure
        expect(isComplete).toBe(false);
        expect(validation.valid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 }
    );
  });
});
