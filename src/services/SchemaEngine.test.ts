/**
 * Unit tests for SchemaEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaEngine } from './SchemaEngine.js';
import type { SchemaDefinition, SchemaField } from '../types/core.js';
import type { CollectedFields } from './SchemaEngine.js';

describe('SchemaEngine', () => {
  let engine: SchemaEngine;

  beforeEach(() => {
    engine = new SchemaEngine();
  });

  describe('getMissingFields', () => {
    it('should return all required fields when no fields are collected', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: ['checkout_date'],
        fields: {
          location: createField('location', 'location', true),
          checkin_date: createField('checkin_date', 'date', true),
          checkout_date: createField('checkout_date', 'date', false),
        },
      };

      const collectedFields: CollectedFields = {};
      const missing = engine.getMissingFields(schema, collectedFields);

      expect(missing).toEqual(['location', 'checkin_date']);
    });

    it('should return only uncollected required fields', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date', 'guests'],
        optionalFields: [],
        fields: {
          location: createField('location', 'location', true),
          checkin_date: createField('checkin_date', 'date', true),
          guests: createField('guests', 'number', true),
        },
      };

      const collectedFields: CollectedFields = {
        location: 'Galle',
      };

      const missing = engine.getMissingFields(schema, collectedFields);

      expect(missing).toEqual(['checkin_date', 'guests']);
      expect(missing).not.toContain('location');
    });

    it('should return empty array when all required fields are collected', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: [],
        fields: {
          location: createField('location', 'location', true),
          checkin_date: createField('checkin_date', 'date', true),
        },
      };

      const collectedFields: CollectedFields = {
        location: 'Galle',
        checkin_date: '2026-04-18',
      };

      const missing = engine.getMissingFields(schema, collectedFields);

      expect(missing).toEqual([]);
    });

    it('should handle conditional fields correctly', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['booking_type', 'hotel_name', 'flight_number'],
        optionalFields: [],
        fields: {
          booking_type: createField('booking_type', 'text', true),
          hotel_name: {
            ...createField('hotel_name', 'text', true),
            conditional: {
              dependsOn: 'booking_type',
              condition: 'equals',
              value: 'hotel',
            },
          },
          flight_number: {
            ...createField('flight_number', 'text', true),
            conditional: {
              dependsOn: 'booking_type',
              condition: 'equals',
              value: 'flight',
            },
          },
        },
      };

      // When booking_type is 'hotel', only hotel_name should be required
      const collectedFields1: CollectedFields = {
        booking_type: 'hotel',
      };
      const missing1 = engine.getMissingFields(schema, collectedFields1);
      expect(missing1).toEqual(['hotel_name']);
      expect(missing1).not.toContain('flight_number');

      // When booking_type is 'flight', only flight_number should be required
      const collectedFields2: CollectedFields = {
        booking_type: 'flight',
      };
      const missing2 = engine.getMissingFields(schema, collectedFields2);
      expect(missing2).toEqual(['flight_number']);
      expect(missing2).not.toContain('hotel_name');
    });
  });

  describe('validateFields', () => {
    it('should validate required fields', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
        },
      };

      const validFields: CollectedFields = {
        location: 'Galle',
      };

      const result = engine.validateFields(schema, validFields);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
        },
      };

      const invalidFields: CollectedFields = {
        location: 'Galle',
        // checkin_date is missing
      };

      const result = engine.validateFields(schema, invalidFields);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].fieldName).toBe('checkin_date');
      expect(result.errors[0].errorType).toBe('required');
    });

    it('should validate pattern constraints', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['email'],
        optionalFields: [],
        fields: {
          email: {
            name: 'email',
            type: 'text',
            validation: {
              required: true,
              pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
            },
            ui: {
              promptKey: 'email.prompt',
              mode: 'text',
            },
          },
        },
      };

      const invalidFields: CollectedFields = {
        email: 'invalid-email',
      };

      const result = engine.validateFields(schema, invalidFields);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].fieldName).toBe('email');
      expect(result.errors[0].errorType).toBe('pattern');
    });

    it('should validate min/max constraints for numbers', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['guests'],
        optionalFields: [],
        fields: {
          guests: {
            name: 'guests',
            type: 'number',
            validation: {
              required: true,
              min: 1,
              max: 10,
            },
            ui: {
              promptKey: 'guests.prompt',
              mode: 'text',
            },
          },
        },
      };

      // Test below minimum
      const belowMin: CollectedFields = { guests: 0 };
      const result1 = engine.validateFields(schema, belowMin);
      expect(result1.valid).toBe(false);
      expect(result1.errors[0].errorType).toBe('min');

      // Test above maximum
      const aboveMax: CollectedFields = { guests: 11 };
      const result2 = engine.validateFields(schema, aboveMax);
      expect(result2.valid).toBe(false);
      expect(result2.errors[0].errorType).toBe('max');

      // Test valid value
      const validValue: CollectedFields = { guests: 5 };
      const result3 = engine.validateFields(schema, validValue);
      expect(result3.valid).toBe(true);
    });

    it('should allow optional fields to be missing', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location'],
        optionalFields: ['budget'],
        fields: {
          location: createField('location', 'text', true),
          budget: createField('budget', 'number', false),
        },
      };

      const fields: CollectedFields = {
        location: 'Galle',
        // budget is optional and missing
      };

      const result = engine.validateFields(schema, fields);
      expect(result.valid).toBe(true);
    });
  });

  describe('generateFieldPrompt', () => {
    it('should generate prompt with UI metadata', () => {
      const field: SchemaField = {
        name: 'checkin_date',
        type: 'date',
        validation: { required: true },
        ui: {
          promptKey: 'hotel.checkin.prompt',
          mode: 'buttons',
          options: [
            { id: 'today', labelKey: 'Today', value: 'today' },
            { id: 'tomorrow', labelKey: 'Tomorrow', value: 'tomorrow' },
          ],
        },
      };

      const prompt = engine.generateFieldPrompt(field, 'en');

      expect(prompt.fieldName).toBe('checkin_date');
      expect(prompt.promptKey).toBe('hotel.checkin.prompt');
      expect(prompt.mode).toBe('buttons');
      expect(prompt.options).toHaveLength(2);
      expect(prompt.options?.[0].id).toBe('today');
    });

    it('should fallback to text mode when no UI metadata', () => {
      const field: SchemaField = {
        name: 'custom_field',
        type: 'text',
        validation: { required: true },
      };

      const prompt = engine.generateFieldPrompt(field, 'en');

      expect(prompt.fieldName).toBe('custom_field');
      expect(prompt.mode).toBe('text');
      expect(prompt.promptKey).toBe('field.custom_field.prompt');
    });

    it('should include placeholder when defined', () => {
      const field: SchemaField = {
        name: 'location',
        type: 'text',
        validation: { required: true },
        ui: {
          promptKey: 'location.prompt',
          mode: 'text',
          placeholder: 'Enter city or hotel name',
        },
      };

      const prompt = engine.generateFieldPrompt(field, 'en');

      expect(prompt.placeholder).toBe('Enter city or hotel name');
    });
  });

  describe('isComplete', () => {
    it('should return true when all required fields are collected and valid', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
        },
      };

      const fields: CollectedFields = {
        location: 'Galle',
        checkin_date: '2026-04-18',
      };

      expect(engine.isComplete(schema, fields)).toBe(true);
    });

    it('should return false when required fields are missing', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
        },
      };

      const fields: CollectedFields = {
        location: 'Galle',
        // checkin_date is missing
      };

      expect(engine.isComplete(schema, fields)).toBe(false);
    });

    it('should return false when fields fail validation', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['guests'],
        optionalFields: [],
        fields: {
          guests: {
            name: 'guests',
            type: 'number',
            validation: {
              required: true,
              min: 1,
              max: 10,
            },
            ui: {
              promptKey: 'guests.prompt',
              mode: 'text',
            },
          },
        },
      };

      const fields: CollectedFields = {
        guests: 0, // Below minimum
      };

      expect(engine.isComplete(schema, fields)).toBe(false);
    });
  });

  describe('getNextFieldToCollect', () => {
    it('should return first missing field when no order is defined', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date', 'guests'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
          guests: createField('guests', 'number', true),
        },
      };

      const fields: CollectedFields = {};

      const nextField = engine.getNextFieldToCollect(schema, fields);
      expect(nextField).toBe('location');
    });

    it('should follow collection order when defined', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date', 'guests'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
          guests: createField('guests', 'number', true),
        },
        metadata: {
          collectionOrder: ['checkin_date', 'location', 'guests'],
        },
      };

      const fields: CollectedFields = {};

      const nextField = engine.getNextFieldToCollect(schema, fields);
      expect(nextField).toBe('checkin_date'); // First in collection order
    });

    it('should skip collected fields in collection order', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date', 'guests'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
          guests: createField('guests', 'number', true),
        },
        metadata: {
          collectionOrder: ['checkin_date', 'location', 'guests'],
        },
      };

      const fields: CollectedFields = {
        checkin_date: '2026-04-18',
      };

      const nextField = engine.getNextFieldToCollect(schema, fields);
      expect(nextField).toBe('location'); // Second in collection order
    });

    it('should return null when all fields are collected', () => {
      const schema: SchemaDefinition = {
        schemaName: 'test_schema',
        version: '1.0',
        requiredFields: ['location', 'checkin_date'],
        optionalFields: [],
        fields: {
          location: createField('location', 'text', true),
          checkin_date: createField('checkin_date', 'date', true),
        },
      };

      const fields: CollectedFields = {
        location: 'Galle',
        checkin_date: '2026-04-18',
      };

      const nextField = engine.getNextFieldToCollect(schema, fields);
      expect(nextField).toBeNull();
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createField(name: string, type: string, required: boolean): SchemaField {
  return {
    name,
    type: type as any,
    validation: { required },
    ui: {
      promptKey: `${name}.prompt`,
      mode: 'text',
    },
  };
}
