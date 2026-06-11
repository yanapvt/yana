/**
 * SchemaEngine - Schema-driven workflow field collection and validation
 * 
 * Responsibilities:
 * - Identify missing required fields in a schema
 * - Validate collected field values against schema rules
 * - Generate WhatsApp UI prompts for missing fields
 * - Determine schema completion status
 * - Enforce field collection order and conditional fields
 * 
 * Requirements: 2.4, 2.5, 2.6, 2.7, 3.2, 3.3
 */

import type { SchemaDefinition, SchemaField } from '../types/core.js';

// ============================================================================
// Types
// ============================================================================

export interface CollectedFields {
  [fieldName: string]: unknown;
}

export interface FieldPrompt {
  fieldName: string;
  promptKey: string;
  mode: 'text' | 'buttons' | 'list' | 'list_or_text';
  options?: FieldPromptOption[];
  placeholder?: string;
}

export interface FieldPromptOption {
  id: string;
  label: string;
  value: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

export interface FieldValidationError {
  fieldName: string;
  errorType: 'required' | 'pattern' | 'min' | 'max' | 'custom';
  message: string;
}

// ============================================================================
// SchemaEngine Class
// ============================================================================

export class SchemaEngine {
  /**
   * Get list of missing required fields
   * 
   * Returns fields that are:
   * 1. Marked as required in the schema
   * 2. Not present in collectedFields
   * 3. Pass conditional checks (if field has conditional rules)
   * 
   * Requirement 2.4: Identify missing required fields
   * Requirement 2.6: Handle conditional fields
   */
  getMissingFields(schema: SchemaDefinition, collectedFields: CollectedFields): string[] {
    const missing: string[] = [];

    for (const fieldName of schema.requiredFields) {
      // Check if field is already collected
      if (fieldName in collectedFields) {
        continue;
      }

      // Check if field is conditionally required
      const fieldDef = schema.fields[fieldName];
      if (fieldDef?.conditional) {
        // Only include if conditional dependency is satisfied
        if (!this.isConditionalSatisfied(fieldDef.conditional, collectedFields)) {
          continue;
        }
      }

      missing.push(fieldName);
    }

    return missing;
  }

  /**
   * Validate all collected field values against schema rules
   * 
   * Returns validation result with:
   * - valid: true if all fields pass validation
   * - errors: array of validation errors for fields that failed
   * 
   * Requirement 3.3: Validate field values against schema validation rules
   */
  validateFields(schema: SchemaDefinition, fields: CollectedFields): ValidationResult {
    const errors: FieldValidationError[] = [];

    // Validate each collected field
    for (const [fieldName, value] of Object.entries(fields)) {
      const fieldDef = schema.fields[fieldName];
      
      // Skip if field not in schema (could be extra data)
      if (!fieldDef) {
        continue;
      }

      // Validate the field
      const fieldErrors = this.validateField(fieldName, value, fieldDef);
      errors.push(...fieldErrors);
    }

    // Check for missing required fields
    const missingFields = this.getMissingFields(schema, fields);
    for (const fieldName of missingFields) {
      errors.push({
        fieldName,
        errorType: 'required',
        message: `Required field '${fieldName}' is missing`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate WhatsApp UI prompt descriptor for a missing field
   * 
   * Returns a prompt descriptor containing:
   * - fieldName: the field being collected
   * - promptKey: localization key for the prompt text
   * - mode: UI interaction mode (text, buttons, list, list_or_text)
   * - options: available options for button/list modes
   * - placeholder: placeholder text for text input mode
   * 
   * Requirement 2.4: Generate WhatsApp UI prompts for missing fields
   * Requirement 2.5: Use buttons or lists where possible
   */
  generateFieldPrompt(
    field: SchemaField,
    userLanguage: string
  ): FieldPrompt {
    if (!field.ui) {
      // Fallback to text input if no UI metadata
      return {
        fieldName: field.name,
        promptKey: `field.${field.name}.prompt`,
        mode: 'text',
        placeholder: `Enter ${field.name}`,
      };
    }

    const prompt: FieldPrompt = {
      fieldName: field.name,
      promptKey: field.ui.promptKey,
      mode: field.ui.mode,
      placeholder: field.ui.placeholder,
    };

    // Map schema field options to prompt options
    if (field.ui.options && field.ui.options.length > 0) {
      prompt.options = field.ui.options.map((opt) => ({
        id: opt.id,
        label: opt.labelKey, // In production, this would be translated using userLanguage
        value: opt.value,
      }));
    }

    return prompt;
  }

  /**
   * Check if all required fields are collected and valid
   * 
   * Returns true when:
   * 1. All required fields are present
   * 2. All conditional requirements are satisfied
   * 3. All field values pass validation
   * 
   * Requirement 2.7: Determine when schema collection is complete
   */
  isComplete(schema: SchemaDefinition, fields: CollectedFields): boolean {
    // Check for missing required fields
    const missingFields = this.getMissingFields(schema, fields);
    if (missingFields.length > 0) {
      return false;
    }

    // Validate all collected fields
    const validation = this.validateFields(schema, fields);
    return validation.valid;
  }

  /**
   * Get the next field to collect based on field collection order
   * 
   * Returns the first missing required field, respecting:
   * 1. Field collection order (if defined in schema metadata)
   * 2. Conditional field dependencies
   * 3. Required vs optional field priority
   * 
   * Requirement 2.6: Enforce field collection order
   */
  getNextFieldToCollect(
    schema: SchemaDefinition,
    collectedFields: CollectedFields
  ): string | null {
    const missingFields = this.getMissingFields(schema, collectedFields);
    
    if (missingFields.length === 0) {
      return null;
    }

    // Check if schema defines a collection order
    const collectionOrder = schema.metadata?.collectionOrder as string[] | undefined;
    
    if (collectionOrder && Array.isArray(collectionOrder)) {
      // Follow the defined order
      for (const fieldName of collectionOrder) {
        if (missingFields.includes(fieldName)) {
          return fieldName;
        }
      }
    }

    // Default: return first missing required field
    return missingFields[0];
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Validate a single field value against its schema definition
   */
  private validateField(
    fieldName: string,
    value: unknown,
    fieldDef: SchemaField
  ): FieldValidationError[] {
    const errors: FieldValidationError[] = [];
    const validation = fieldDef.validation;

    if (!validation) {
      return errors;
    }

    // Check required
    if (validation.required) {
      if (value === null || value === undefined || value === '') {
        errors.push({
          fieldName,
          errorType: 'required',
          message: `Field '${fieldName}' is required`,
        });
        return errors; // No point checking other rules if value is missing
      }
    }

    // Check pattern for string values
    if (validation.pattern && typeof value === 'string') {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        errors.push({
          fieldName,
          errorType: 'pattern',
          message: `Field '${fieldName}' does not match required pattern`,
        });
      }
    }

    // Check min/max for numeric values
    if (typeof value === 'number') {
      if (validation.min !== undefined && value < validation.min) {
        errors.push({
          fieldName,
          errorType: 'min',
          message: `Field '${fieldName}' must be at least ${validation.min}`,
        });
      }
      if (validation.max !== undefined && value > validation.max) {
        errors.push({
          fieldName,
          errorType: 'max',
          message: `Field '${fieldName}' must be at most ${validation.max}`,
        });
      }
    }

    // Check custom validator if defined
    if (validation.customValidator) {
      // In production, this would execute a registered custom validator function
      // For now, we just note that custom validation is defined
      // Custom validators would be registered separately and looked up by name
    }

    return errors;
  }

  /**
   * Check if a conditional field requirement is satisfied
   */
  private isConditionalSatisfied(
    conditional: {
      dependsOn: string;
      condition: 'equals' | 'not_equals' | 'exists' | 'not_exists';
      value?: unknown;
    },
    collectedFields: CollectedFields
  ): boolean {
    const dependencyValue = collectedFields[conditional.dependsOn];

    switch (conditional.condition) {
      case 'exists':
        return conditional.dependsOn in collectedFields;
      
      case 'not_exists':
        return !(conditional.dependsOn in collectedFields);
      
      case 'equals':
        return dependencyValue === conditional.value;
      
      case 'not_equals':
        return dependencyValue !== conditional.value;
      
      default:
        return false;
    }
  }
}
