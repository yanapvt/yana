# Property-Based Tests

This directory contains property-based tests using fast-check for the YANA/OGO platform.

## Setup

Before running the property tests, install the required dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

This will install `fast-check` which is required for property-based testing.

## Running Tests

Run all property tests:

```bash
npm test
```

Run property tests in watch mode:

```bash
npm run test:watch
```

Run only property tests:

```bash
npm test -- src/tests/properties
```

## Property Tests

### 1. Webhook Signature Validation (`webhook-signature-validation.property.test.ts`)

**Property Statement:** For any inbound webhook request, the AI_Gateway SHALL accept the request if and only if the signature is valid; requests with invalid signatures SHALL be rejected and logged.

**Validates:** Requirements 1.1, 1.2

**Test Coverage:**
- Accepts all requests with valid signatures
- Rejects all requests with invalid signatures
- Rejects requests with missing signatures
- Validates deterministic behavior (same input → same output)
- Validates signature against complete URL including query parameters
- Rejects signatures valid for different body parameters
- Rejects signatures valid for different URLs
- Always logs Correlation_ID for rejections
- Uses timing-safe comparison to prevent timing attacks

### 4. Schema Field Collection Completeness (`schema-field-collection.property.test.ts`)

**Property Statement:** For any schema with one or more missing required fields, the Schema_Engine SHALL generate a prompt for each missing field, and once all required fields are collected, the Schema_Engine SHALL not generate further field prompts for already-supplied fields.

**Validates:** Requirements 2.4, 2.7, 3.3

### 8. LLM Output Validation Before Execution (`llm-output-validation.property.test.ts`)

**Property Statement:** For any LLM decision output, the Orchestrator SHALL validate the output against schema and business rules before taking any action; invalid LLM outputs SHALL not result in tool execution, booking, or payment actions.

**Validates:** Requirements 4.3, 4.4

**Test Coverage:**
- Rejects all LLM outputs with invalid structure
- Rejects all LLM outputs with confidence below threshold
- Rejects all LLM outputs that violate business rules
- Rejects all LLM outputs with missing required schema fields
- Always performs validation before indicating execution readiness
- Validates structure before checking other rules
- Validates confidence threshold early in the validation process
- Validates against schema when schema is provided
- Merges collected fields with LLM parameters during schema validation
- Rejects execute_tool action when missing fields are present
- Detects parameters with null or undefined values
- Always recommends a fallback action when validation fails
- Recommends ui_narrowing for low confidence decisions
- Allows execution for valid high-confidence decisions with complete fields
- Produces consistent validation results for the same input
- Never throws exceptions during validation

### 15. WhatsApp UI Limit Compliance (`whatsapp-ui-limit-compliance.property.test.ts`)

**Property Statement:** For any outbound WhatsApp message, the WhatsApp_Renderer SHALL validate the message against WhatsApp UI limits (button counts, list item counts, text lengths) before delivery; messages that exceed limits SHALL be reformatted or fall back to plain text.

**Validates:** Requirements 7.7, 15.1, 15.2

**Test Coverage:**
- Never produces messages that violate WhatsApp UI limits for valid content
- Always validates content before rendering
- Enforces button count limit (≤ 3 buttons)
- Enforces button title length limit (≤ 20 characters)
- Enforces list item count limit (≤ 10 items total across all sections)
- Enforces list item title length limit (≤ 24 characters)
- Enforces list item description length limit (≤ 72 characters)
- Enforces text length limit (≤ 4096 characters)
- Falls back to plain text when content violates limits
- Preserves content information in plain text fallback
- Does not apply fallback when content is within limits
- Handles hotel result formatting within WhatsApp limits
- Produces consistent results for the same input
- Never throws exceptions during rendering
- Handles empty button arrays by falling back
- Handles empty list sections by falling back
- Handles exactly at limit values correctly

**WhatsApp Limits Tested:**
- `MAX_BUTTONS`: 3
- `MAX_LIST_ITEMS`: 10
- `MAX_LIST_SECTIONS`: 10
- `MAX_TEXT_LENGTH`: 4096
- `MAX_BUTTON_TITLE_LENGTH`: 20
- `MAX_LIST_ITEM_TITLE_LENGTH`: 24
- `MAX_LIST_ITEM_DESCRIPTION_LENGTH`: 72
- `MAX_LIST_SECTION_TITLE_LENGTH`: 24

## Writing New Property Tests

When writing new property tests:

1. Start with the property statement from the design document
2. Create arbitraries (generators) for your test data using fast-check
3. Write properties that should hold for all generated inputs
4. Use `fc.assert()` with appropriate `numRuns` (typically 50-100)
5. Include the requirement validation comment at the top
6. Test both positive and negative cases
7. Test edge cases and boundary conditions

Example structure:

```typescript
/**
 * Property Test X: [Property Name]
 * 
 * Property Statement:
 * [Full property statement from design doc]
 * 
 * **Validates: Requirements X.Y, X.Z**
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Property X: [Property Name]', () => {
  it('should [property description]', () => {
    fc.assert(
      fc.property(
        // arbitraries here
        (generatedData) => {
          // Given: setup
          // When: action
          // Then: assertion
        }
      ),
      { numRuns: 100 }
    );
  });
});
```
