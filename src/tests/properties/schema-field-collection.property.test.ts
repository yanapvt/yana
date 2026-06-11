/**
 * Property Test 4: Schema Field Collection Completeness
 * 
 * **Validates: Requirements 2.4, 2.7, 3.3**
 * 
 * Property Statement:
 * For any schema with one or more missing required fields, the Schema_Engine SHALL 
 * generate a prompt for each missing field, and once all required fields are collected, 
 * the Schema_Engine SHALL not generate further field prompts for already-supplied fields.
 * 
 * Requirements:
 * - 2.4: WHEN a required schema field is missing, THE Schema_Engine SHALL generate a 
 *        WhatsApp UI prompt to collect that field using buttons or lists where possible
 * - 2.7: WHEN schema collection is complete, THE Orchestrator SHALL proceed to tool 
 *        execution without requesting already-supplied fields again
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
        pattern: fc.option(fc.constant('[a-zA-Z0-9]+'), { nil: undefined }),
        min: fc.option(fc.nat({ max: 100 }), { nil: undefined }),
        max: fc.option(fc.nat({ max: 1000 }), { nil: undefined }),
        customValidator: fc.option(fc.constant('customValidator'), { nil: undefined }),
      }),
      conditional: fc.constant(undefined), // Simplify: no conditional fields for now
    });
  });

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
  .filter((schema) => schema.requiredFields.length > 0)
  .filter((schema) =>
    Object.values(schema.fields).every((field) =>
      field.validation.min === undefined ||
      field.validation.max === undefined ||
      field.validation.min <= field.validation.max
    )
  );

function generateValidValueForField(field: SchemaField): unknown {
  switch (field.type) {
    case 'number':
      return field.validation.max !== undefined
        ? Math.min(field.validation.max, Math.max(field.validation.min ?? field.validation.max, field.validation.max))
        : Math.max(42, field.validation.min ?? 42);
    case 'date':
      return '2026-04-18';
    case 'boolean':
      return true;
    case 'location':
    case 'location_or_text':
      return 'Galle';
    case 'currency':
      return 'USD';
    case 'text':
    case 'enum':
    default:
      return 'validvalue';
  }
}

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 4: Schema Field Collection Completeness', () => {
  const engine = new SchemaEngine();

  it('should generate prompts for all missing required fields', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with required fields and no collected fields
        const collectedFields: CollectedFields = {};

        // When: We check for missing fields
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: All required fields should be identified as missing
        expect(missingFields.sort()).toEqual(schema.requiredFields.sort());

        // And: We should be able to generate a prompt for each missing field
        for (const fieldName of missingFields) {
          const fieldDef = schema.fields[fieldName];
          const prompt = engine.generateFieldPrompt(fieldDef, 'en');
          expect(prompt).toBeDefined();
          expect(prompt.fieldName).toBe(fieldName);
          expect(prompt.promptKey).toBe(fieldDef.ui.promptKey);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should not request already-supplied fields', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, fc.array(fc.string()), (schema, values) => {
        // Given: A schema with some required fields already collected
        const collectedFields: CollectedFields = {};

        // Collect a subset of required fields (at least half)
        const numToCollect = Math.max(1, Math.ceil(schema.requiredFields.length / 2));
        const fieldsToCollect = schema.requiredFields.slice(0, numToCollect);
        
        fieldsToCollect.forEach((fieldName, idx) => {
          collectedFields[fieldName] = values[idx] || 'test_value';
        });

        // When: We check for missing fields
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: Already-supplied fields should not be in the missing list
        for (const suppliedField of fieldsToCollect) {
          expect(missingFields).not.toContain(suppliedField);
        }

        // And: Only unsupplied required fields should be missing
        const expectedMissing = schema.requiredFields.filter(
          (f) => !fieldsToCollect.includes(f)
        );
        expect(missingFields.sort()).toEqual(expectedMissing.sort());
      }),
      { numRuns: 100 }
    );
  });

  it('should mark schema as complete when all required fields are collected and valid', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with all required fields collected with valid values
        const collectedFields: CollectedFields = {};

        schema.requiredFields.forEach((fieldName) => {
          const fieldDef = schema.fields[fieldName];

          collectedFields[fieldName] = generateValidValueForField(fieldDef);
        });

        // When: We check if schema is complete
        const isComplete = engine.isComplete(schema, collectedFields);

        // Then: Schema should be marked as complete
        expect(isComplete).toBe(true);

        // And: No missing fields should be reported
        const missingFields = engine.getMissingFields(schema, collectedFields);
        expect(missingFields).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should not mark schema as complete when required fields are missing', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with at least one required field missing
        const collectedFields: CollectedFields = {};

        // Collect all but one required field
        const fieldsToCollect = schema.requiredFields.slice(0, -1);
        fieldsToCollect.forEach((fieldName) => {
          collectedFields[fieldName] = 'test_value';
        });

        // When: We check if schema is complete
        const isComplete = engine.isComplete(schema, collectedFields);

        // Then: Schema should not be marked as complete
        expect(isComplete).toBe(false);

        // And: At least one missing field should be reported
        const missingFields = engine.getMissingFields(schema, collectedFields);
        expect(missingFields.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should generate prompts only for missing fields, not for collected fields', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        // Given: A schema with half the required fields collected
        const collectedFields: CollectedFields = {};
        const midpoint = Math.ceil(schema.requiredFields.length / 2);
        const collectedFieldNames = schema.requiredFields.slice(0, midpoint);
        const uncollectedFieldNames = schema.requiredFields.slice(midpoint);

        collectedFieldNames.forEach((fieldName) => {
          collectedFields[fieldName] = 'collected_value';
        });

        // When: We get missing fields
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: Missing fields should only include uncollected fields
        expect(missingFields.sort()).toEqual(uncollectedFieldNames.sort());

        // And: We can generate prompts for all missing fields
        for (const fieldName of missingFields) {
          const fieldDef = schema.fields[fieldName];
          const prompt = engine.generateFieldPrompt(fieldDef, 'en');
          expect(prompt).toBeDefined();
          expect(prompt.fieldName).toBe(fieldName);
        }

        // And: Collected fields should not be in missing list
        for (const collectedField of collectedFieldNames) {
          expect(missingFields).not.toContain(collectedField);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should maintain idempotency: checking missing fields multiple times yields same result', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, fc.array(fc.string()), (schema, values) => {
        // Given: A schema with some collected fields
        const collectedFields: CollectedFields = {};
        const numToCollect = Math.ceil(schema.requiredFields.length / 2);
        const fieldsToCollect = schema.requiredFields.slice(0, numToCollect);
        
        fieldsToCollect.forEach((fieldName, idx) => {
          collectedFields[fieldName] = values[idx] || 'test_value';
        });

        // When: We check missing fields multiple times
        const missingFields1 = engine.getMissingFields(schema, collectedFields);
        const missingFields2 = engine.getMissingFields(schema, collectedFields);
        const missingFields3 = engine.getMissingFields(schema, collectedFields);

        // Then: Results should be identical
        expect(missingFields1.sort()).toEqual(missingFields2.sort());
        expect(missingFields2.sort()).toEqual(missingFields3.sort());
      }),
      { numRuns: 100 }
    );
  });

  it('should transition from incomplete to complete as fields are progressively collected', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        fc.pre(schema.requiredFields.length > 1); // Need at least 2 fields for progression

        // Given: Starting with no collected fields
        const collectedFields: CollectedFields = {};

        // Initially incomplete
        expect(engine.isComplete(schema, collectedFields)).toBe(false);

        // When: We progressively collect each required field
        for (let i = 0; i < schema.requiredFields.length; i++) {
          const fieldName = schema.requiredFields[i];
          collectedFields[fieldName] = 'valid_value';

          const missingFields = engine.getMissingFields(schema, collectedFields);
          const isComplete = engine.isComplete(schema, collectedFields);

          // Then: Missing fields should decrease
          expect(missingFields.length).toBe(schema.requiredFields.length - (i + 1));

          // And: Should be complete only when all fields are collected
          if (i === schema.requiredFields.length - 1) {
            expect(isComplete).toBe(true);
          } else {
            expect(isComplete).toBe(false);
          }
        }
      }),
      { numRuns: 50 }
    );
  });

  it('should not generate prompts for already-supplied fields after partial collection', () => {
    fc.assert(
      fc.property(schemaDefinitionArb, (schema) => {
        fc.pre(schema.requiredFields.length >= 3); // Need at least 3 fields

        // Given: A schema with some fields collected
        const collectedFields: CollectedFields = {};
        const firstField = schema.requiredFields[0];
        const secondField = schema.requiredFields[1];
        
        collectedFields[firstField] = 'value1';
        collectedFields[secondField] = 'value2';

        // When: We get missing fields
        const missingFields = engine.getMissingFields(schema, collectedFields);

        // Then: Already-supplied fields should not be in missing list
        expect(missingFields).not.toContain(firstField);
        expect(missingFields).not.toContain(secondField);

        // And: Only remaining required fields should be missing
        const expectedMissing = schema.requiredFields.filter(
          (f) => f !== firstField && f !== secondField
        );
        expect(missingFields.sort()).toEqual(expectedMissing.sort());
      }),
      { numRuns: 100 }
    );
  });
});
