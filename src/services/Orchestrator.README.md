# Orchestrator Service

## Overview

The Orchestrator is the critical validation gate between LLM recommendations and system execution. It validates all LLM decision outputs against schema definitions and business rules before allowing any action to proceed.

**Core Principle:** LLM decides; backend executes.

The LLM may infer intent, extract parameters, and suggest next steps, but the Orchestrator validates these recommendations before the system takes any action.

## Architecture

```
User Input → LLMService (decision mode)
           ↓
    LLMDecisionOutput
           ↓
    Orchestrator.validateLLMDecision()
           ↓
    ┌─────────────────────────┐
    │ Validation Checks:      │
    │ 1. Structure            │
    │ 2. Confidence threshold │
    │ 3. Schema compliance    │
    │ 4. Business rules       │
    └─────────────────────────┘
           ↓
    ValidatedDecision
           ↓
    ┌─────────────────────────┐
    │ If shouldProceed:       │
    │   → Execute action      │
    │ Else:                   │
    │   → Fallback to UI      │
    └─────────────────────────┘
```

## Requirements Validated

### Requirement 4.4: LLM Output Validation Before Execution

> THE Orchestrator SHALL validate all LLM decision outputs against schema and business rules before proceeding with any action

The Orchestrator enforces this by:
- Validating decision structure
- Checking schema field requirements
- Enforcing business rule consistency
- Preventing execution when validation fails

### Requirement 4.5: Low-Confidence LLM Fallback

> WHEN LLM output confidence is below the configured threshold, THE Orchestrator SHALL fall back to UI-based narrowing rather than proceeding with low-confidence execution

The Orchestrator enforces this by:
- Checking confidence against configured threshold
- Immediately returning fallback action when confidence is too low
- Preventing any further validation or execution
- Recommending UI-narrowing as the fallback strategy

## API Reference

### Class: Orchestrator

#### Constructor

```typescript
constructor(config?: Partial<OrchestratorConfig>)
```

**Parameters:**
- `config.confidenceThreshold` - Minimum confidence required (default: from env)
- `config.schemaEngine` - SchemaEngine instance (default: new instance)

**Example:**
```typescript
const orchestrator = new Orchestrator({
  confidenceThreshold: 0.85,
});
```

#### Method: validateLLMDecision

```typescript
validateLLMDecision(
  decision: LLMDecisionOutput,
  schema?: SchemaDefinition,
  collectedFields?: CollectedFields
): ValidatedDecision
```

Validates an LLM decision output against all validation rules.

**Parameters:**
- `decision` - LLM decision output to validate
- `schema` - Optional schema definition for the detected intent
- `collectedFields` - Optional fields already collected in the session

**Returns:** `ValidatedDecision` containing:
- `decision` - The original decision
- `validation` - Validation result with errors
- `shouldProceed` - Whether to proceed with the decision
- `fallbackAction` - Recommended fallback if validation fails
- `fallbackReason` - Human-readable reason for fallback

**Example:**
```typescript
const result = orchestrator.validateLLMDecision(
  llmDecision,
  hotelSearchSchema,
  { location: 'Galle' }
);

if (result.shouldProceed) {
  // Execute the suggested action
  await executeAction(result.decision);
} else {
  // Fall back to UI narrowing
  return generateUIPrompt(result.fallbackAction);
}
```

#### Method: getConfidenceThreshold

```typescript
getConfidenceThreshold(): number
```

Returns the current confidence threshold.

#### Method: setConfidenceThreshold

```typescript
setConfidenceThreshold(threshold: number): void
```

Updates the confidence threshold. Must be between 0 and 1.

## Validation Checks

### 1. Structure Validation

Ensures the LLM decision has valid structure:
- `intent` is a non-empty string
- `parameters` is an object (not array or null)
- `missingFields` is an array
- `suggestedAction` is one of: `ask_missing`, `execute_tool`, `clarify`, `handoff`
- `confidence` is a number between 0 and 1

**Errors:** Type `structure`, severity `error`

### 2. Confidence Validation (Requirement 4.5)

Checks if confidence meets the configured threshold.

**Behavior:**
- If `confidence < threshold`: Immediate fallback to UI narrowing
- No further validation is performed
- Returns `shouldProceed: false`

**Errors:** Type `confidence`, severity `error`

### 3. Schema Validation (Requirement 4.4)

When a schema is provided, validates:
- All required fields are present (in collected + LLM parameters)
- Field values meet validation rules (min, max, pattern)
- LLM correctly identified missing fields

**Errors:** Type `schema`, severity `error` or `warning`

### 4. Business Rules Validation (Requirement 4.4)

Enforces logical consistency:
- Cannot execute tool with missing fields
- `ask_missing` action should have missing fields
- Parameters should not contain null/undefined values

**Errors:** Type `business_rule`, severity `error` or `warning`

## Fallback Actions

When validation fails, the Orchestrator recommends a fallback action:

### ui_narrowing

Used when:
- Confidence is below threshold
- Schema validation fails
- General validation errors

**Response:** Present top-level intent options or field collection UI

### clarify

Used when:
- Business rule violations occur
- Inconsistent suggested actions

**Response:** Ask user for clarification or more information

### handoff

Used when:
- Repeated validation failures
- Unsupported intents
- Complex error scenarios

**Response:** Escalate to human operator

## Integration Patterns

### Pattern 1: Basic Validation Flow

```typescript
import { Orchestrator } from './services/Orchestrator.js';
import { LLMService } from './services/LLMService.js';

const orchestrator = new Orchestrator();
const llmService = new LLMService();

// Get LLM decision
const decision = await llmService.decide(contextPackage);

// Validate before proceeding
const validated = orchestrator.validateLLMDecision(decision);

if (!validated.shouldProceed) {
  // Fall back to UI
  return handleFallback(validated.fallbackAction, validated.fallbackReason);
}

// Proceed with validated decision
return executeDecision(validated.decision);
```

### Pattern 2: Schema-Aware Validation

```typescript
// Load schema for the detected intent
const schema = await schemaRepository.getSchema(
  decision.intent,
  session.schemaVersion
);

// Validate with schema
const validated = orchestrator.validateLLMDecision(
  decision,
  schema,
  session.collectedFields
);

if (!validated.shouldProceed) {
  if (validated.fallbackAction === 'ui_narrowing') {
    // Generate field collection UI
    const nextField = schemaEngine.getNextFieldToCollect(
      schema,
      session.collectedFields
    );
    return generateFieldPrompt(nextField);
  }
}
```

### Pattern 3: Progressive Field Collection

```typescript
// Merge previously collected fields with new LLM parameters
const allFields = {
  ...session.collectedFields,
  ...decision.parameters,
};

// Validate complete field set
const validated = orchestrator.validateLLMDecision(
  decision,
  schema,
  session.collectedFields
);

if (validated.shouldProceed && decision.suggestedAction === 'execute_tool') {
  // All fields collected and validated - execute tool
  return await mcpInterface.executeToolCall({
    tool: decision.intent,
    params: allFields,
    context: session.context,
  });
}
```

### Pattern 4: Dynamic Confidence Thresholds

```typescript
// Use higher threshold for critical operations
if (isCriticalOperation(decision.intent)) {
  orchestrator.setConfidenceThreshold(0.95);
} else {
  orchestrator.setConfidenceThreshold(0.85);
}

const validated = orchestrator.validateLLMDecision(decision);
```

## Configuration

### Environment Variables

```bash
# Confidence threshold (0-1)
LLM_CONFIDENCE_THRESHOLD=0.85
```

### Runtime Configuration

```typescript
const orchestrator = new Orchestrator({
  confidenceThreshold: 0.85,
  schemaEngine: customSchemaEngine,
});

// Update threshold dynamically
orchestrator.setConfidenceThreshold(0.90);
```

## Error Handling

### Validation Errors

All validation errors include:
- `type`: Error category (`structure`, `confidence`, `schema`, `business_rule`)
- `field`: Field name (if applicable)
- `message`: Human-readable error message
- `severity`: `error` or `warning`

**Errors** prevent execution (`shouldProceed: false`)
**Warnings** are logged but may allow execution

### Example Error Handling

```typescript
const validated = orchestrator.validateLLMDecision(decision, schema);

if (!validated.validation.valid) {
  // Log all errors
  for (const error of validated.validation.errors) {
    console.error(`[${error.type}] ${error.message}`, {
      field: error.field,
      severity: error.severity,
    });
  }

  // Handle based on fallback action
  switch (validated.fallbackAction) {
    case 'ui_narrowing':
      return generateUIPrompt();
    case 'clarify':
      return askForClarification();
    case 'handoff':
      return escalateToOperator();
  }
}
```

## Testing

### Unit Tests

```typescript
import { Orchestrator } from './Orchestrator.js';

describe('Orchestrator', () => {
  it('should reject low confidence decisions', () => {
    const orchestrator = new Orchestrator({ confidenceThreshold: 0.85 });
    
    const decision = {
      intent: 'search_hotels',
      parameters: {},
      missingFields: [],
      suggestedAction: 'ask_missing',
      confidence: 0.70,
    };

    const result = orchestrator.validateLLMDecision(decision);
    
    expect(result.shouldProceed).toBe(false);
    expect(result.fallbackAction).toBe('ui_narrowing');
  });
});
```

### Integration Tests

```typescript
it('should validate complete hotel search flow', async () => {
  const llmService = new LLMService();
  const orchestrator = new Orchestrator();
  const schema = await loadHotelSearchSchema();

  // Get LLM decision
  const decision = await llmService.decide(contextPackage);

  // Validate
  const validated = orchestrator.validateLLMDecision(decision, schema);

  // Should proceed if all fields present and confidence high
  expect(validated.shouldProceed).toBe(true);
});
```

## Design Principles

### 1. Fail-Safe Validation

When in doubt, fall back to UI narrowing rather than proceeding with uncertain execution.

### 2. Separation of Concerns

- **LLM**: Provides recommendations
- **Orchestrator**: Validates recommendations
- **Executor**: Executes validated actions

### 3. Explicit Over Implicit

All validation rules are explicit and documented. No hidden validation logic.

### 4. Confidence-First

Confidence threshold is checked first. Low confidence immediately triggers fallback, regardless of other validation results.

### 5. Schema-Driven

When a schema is available, it is the source of truth for field requirements and validation rules.

## Future Enhancements

- [ ] Support for custom validation rules
- [ ] Validation rule versioning
- [ ] A/B testing of confidence thresholds
- [ ] Validation metrics and analytics
- [ ] Machine learning for dynamic threshold adjustment
- [ ] Validation rule explanations for debugging

## Related Components

- **LLMService**: Generates decisions that Orchestrator validates
- **SchemaEngine**: Provides schema validation logic
- **MCPInterface**: Executes validated tool calls
- **WhatsAppRenderer**: Generates UI fallback prompts

## References

- Requirements: 4.4, 4.5
- Design Document: LLM Decision Layer section
- Property 8: LLM Output Validation Before Execution
- Property 9: Low-Confidence LLM Fallback
