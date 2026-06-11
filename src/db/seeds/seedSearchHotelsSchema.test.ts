/**
 * Tests for search_hotels schema definition
 * 
 * Validates:
 * - Schema definition structure
 * - Field definitions and validation rules
 * - UI metadata
 * - Localization keys
 * 
 * Requirements: 3.1, 3.2, 7.1, 7.2
 * 
 * NOTE: These are unit tests that validate the schema definition file structure.
 * For integration tests that seed the database, see seedSearchHotelsSchema.integration.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('search_hotels Schema Definition', () => {
  let schemaDef: any;

  // Load schema definition once for all tests
  const schemaFilePath = join(__dirname, 'search_hotels_schema_v1.0.json');
  const schemaFileContent = readFileSync(schemaFilePath, 'utf-8');
  schemaDef = JSON.parse(schemaFileContent);

  describe('Basic Structure', () => {
    it('should have valid JSON structure', () => {
      expect(schemaDef).toBeDefined();
      expect(schemaDef.schemaName).toBe('search_hotels');
      expect(schemaDef.version).toBe('1.0');
      expect(schemaDef.description).toBeDefined();
    });

    it('should include all required fields', () => {
      expect(schemaDef.requiredFields).toEqual(['location', 'checkin_date']);
    });

    it('should include all optional fields', () => {
      expect(schemaDef.optionalFields).toEqual([
        'checkout_date',
        'guests',
        'budget',
        'currency',
      ]);
    });

    it('should define all fields with proper structure', () => {
      const allFields = [...schemaDef.requiredFields, ...schemaDef.optionalFields];
      
      for (const fieldName of allFields) {
        expect(schemaDef.fields[fieldName]).toBeDefined();
        expect(schemaDef.fields[fieldName].name).toBe(fieldName);
        expect(schemaDef.fields[fieldName].type).toBeDefined();
        expect(schemaDef.fields[fieldName].ui).toBeDefined();
        expect(schemaDef.fields[fieldName].validation).toBeDefined();
      }
    });
  });

  describe('Field Definitions', () => {
    it('should have location field with proper configuration', () => {
      const locationField = schemaDef.fields.location;
      
      expect(locationField).toBeDefined();
      expect(locationField.type).toBe('location_or_text');
      expect(locationField.ui.promptKey).toBe('hotel.location.prompt');
      expect(locationField.ui.mode).toBe('list_or_text');
      expect(locationField.validation.required).toBe(true);
    });

    it('should have checkin_date field with button options', () => {
      const checkinField = schemaDef.fields.checkin_date;
      
      expect(checkinField).toBeDefined();
      expect(checkinField.type).toBe('date');
      expect(checkinField.ui.mode).toBe('buttons');
      expect(checkinField.ui.options).toBeDefined();
      expect(checkinField.ui.options.length).toBe(3);
      expect(checkinField.validation.required).toBe(true);
    });

    it('should have checkout_date field as optional', () => {
      const checkoutField = schemaDef.fields.checkout_date;
      
      expect(checkoutField).toBeDefined();
      expect(checkoutField.validation.required).toBe(false);
    });

    it('should have guests field with numeric validation', () => {
      const guestsField = schemaDef.fields.guests;
      
      expect(guestsField).toBeDefined();
      expect(guestsField.type).toBe('number');
      expect(guestsField.validation.min).toBe(1);
      expect(guestsField.validation.max).toBe(20);
      expect(guestsField.validation.required).toBe(false);
    });

    it('should have budget field with list options', () => {
      const budgetField = schemaDef.fields.budget;
      
      expect(budgetField).toBeDefined();
      expect(budgetField.ui.mode).toBe('list');
      expect(budgetField.ui.options).toBeDefined();
      expect(budgetField.ui.options.length).toBeGreaterThan(0);
    });

    it('should have currency field with pattern validation', () => {
      const currencyField = schemaDef.fields.currency;
      
      expect(currencyField).toBeDefined();
      expect(currencyField.validation.pattern).toBe('^[A-Z]{3}$');
      expect(currencyField.validation.required).toBe(false);
    });
  });

  describe('UI Metadata', () => {
    it('should have prompt keys for all fields', () => {
      const fields = schemaDef.fields;
      
      expect(fields.location.ui.promptKey).toBe('hotel.location.prompt');
      expect(fields.checkin_date.ui.promptKey).toBe('hotel.checkin.prompt');
      expect(fields.checkout_date.ui.promptKey).toBe('hotel.checkout.prompt');
      expect(fields.guests.ui.promptKey).toBe('hotel.guests.prompt');
      expect(fields.budget.ui.promptKey).toBe('hotel.budget.prompt');
      expect(fields.currency.ui.promptKey).toBe('hotel.currency.prompt');
    });

    it('should have UI modes for all fields', () => {
      const fields = schemaDef.fields;
      
      expect(fields.location.ui.mode).toBe('list_or_text');
      expect(fields.checkin_date.ui.mode).toBe('buttons');
      expect(fields.checkout_date.ui.mode).toBe('buttons');
      expect(fields.guests.ui.mode).toBe('buttons');
      expect(fields.budget.ui.mode).toBe('list');
      expect(fields.currency.ui.mode).toBe('list');
    });

    it('should have options for button/list fields', () => {
      const fields = schemaDef.fields;
      
      expect(fields.checkin_date.ui.options).toBeDefined();
      expect(fields.checkin_date.ui.options.length).toBe(3);
      
      expect(fields.guests.ui.options).toBeDefined();
      expect(fields.guests.ui.options.length).toBe(5);
      
      expect(fields.budget.ui.options).toBeDefined();
      expect(fields.budget.ui.options.length).toBe(4);
      
      expect(fields.currency.ui.options).toBeDefined();
      expect(fields.currency.ui.options.length).toBe(4);
    });
  });

  describe('Validation Rules', () => {
    it('should mark required fields correctly', () => {
      expect(schemaDef.fields.location.validation.required).toBe(true);
      expect(schemaDef.fields.checkin_date.validation.required).toBe(true);
      expect(schemaDef.fields.checkout_date.validation.required).toBe(false);
      expect(schemaDef.fields.guests.validation.required).toBe(false);
      expect(schemaDef.fields.budget.validation.required).toBe(false);
      expect(schemaDef.fields.currency.validation.required).toBe(false);
    });

    it('should have pattern validation for text fields', () => {
      expect(schemaDef.fields.location.validation.pattern).toBe('^.{2,}$');
      expect(schemaDef.fields.currency.validation.pattern).toBe('^[A-Z]{3}$');
    });

    it('should have min/max validation for numeric fields', () => {
      expect(schemaDef.fields.guests.validation.min).toBe(1);
      expect(schemaDef.fields.guests.validation.max).toBe(20);
      expect(schemaDef.fields.budget.validation.min).toBe(0);
    });
  });

  describe('Localization Keys', () => {
    it('should have localization keys in metadata', () => {
      expect(schemaDef.metadata.localizationKeys).toBeDefined();
    });

    it('should have multilingual support for prompt keys', () => {
      const locKeys = schemaDef.metadata.localizationKeys;
      
      expect(locKeys['hotel.location.prompt']).toBeDefined();
      expect(locKeys['hotel.location.prompt'].en).toBeDefined();
      expect(locKeys['hotel.location.prompt'].es).toBeDefined();
      expect(locKeys['hotel.location.prompt'].fr).toBeDefined();
    });

    it('should have translations for all option labels', () => {
      const locKeys = schemaDef.metadata.localizationKeys;
      
      // Check-in options
      expect(locKeys['hotel.checkin.today']).toBeDefined();
      expect(locKeys['hotel.checkin.tomorrow']).toBeDefined();
      expect(locKeys['hotel.checkin.pick_date']).toBeDefined();
      
      // Guest options
      expect(locKeys['hotel.guests.one']).toBeDefined();
      expect(locKeys['hotel.guests.two']).toBeDefined();
      
      // Currency options
      expect(locKeys['currency.usd']).toBeDefined();
      expect(locKeys['currency.eur']).toBeDefined();
      expect(locKeys['currency.gbp']).toBeDefined();
      expect(locKeys['currency.lkr']).toBeDefined();
    });
  });

  describe('Fallback Prompts', () => {
    it('should have fallback prompts for all fields', () => {
      const fallbacks = schemaDef.metadata.fallbackPrompts;
      
      expect(fallbacks).toBeDefined();
      expect(fallbacks.location).toBeDefined();
      expect(fallbacks.checkin_date).toBeDefined();
      expect(fallbacks.checkout_date).toBeDefined();
      expect(fallbacks.guests).toBeDefined();
      expect(fallbacks.budget).toBeDefined();
      expect(fallbacks.currency).toBeDefined();
    });

    it('should have meaningful fallback text', () => {
      const fallbacks = schemaDef.metadata.fallbackPrompts;
      
      expect(fallbacks.location).toContain('city or location');
      expect(fallbacks.checkin_date).toContain('check-in date');
      expect(fallbacks.guests).toContain('number of guests');
    });
  });

  describe('Metadata', () => {
    it('should have collection order defined', () => {
      expect(schemaDef.metadata.collectionOrder).toBeDefined();
      expect(schemaDef.metadata.collectionOrder).toEqual([
        'location',
        'checkin_date',
        'checkout_date',
        'guests',
        'budget',
        'currency',
      ]);
    });

    it('should have tool binding', () => {
      expect(schemaDef.metadata.toolBinding).toBe('search_hotels');
    });

    it('should have provider mappings', () => {
      expect(schemaDef.metadata.providerMappings).toBeDefined();
      expect(schemaDef.metadata.providerMappings.booking_com).toBeDefined();
    });
  });
});
