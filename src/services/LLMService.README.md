# LLMService

The `LLMService` wraps LLM interactions with two distinct modes: **decision mode** and **UI-support mode**. This service ensures that the LLM provides recommendations and content generation without having direct execution capabilities.

## Architecture Principle

**LLM decides; backend executes.**

The LLM may infer intent, extract parameters, suggest the next step, and format UI-supporting content, but all critical execution remains under backend control through the Orchestrator.

## Requirements Validated

- **Requirement 4.1**: LLM operates in decision mode producing structured output (intent, extracted parameters, identified missing fields, suggested next action, confidence metadata)
- **Requirement 4.2**: LLM operates in UI-support mode for generating wording and formatting assistance for non-critical response content
- **Requirement 4.3**: LLM shall not directly execute side effects, tool calls, bookings, or payments

## Two Operating Modes

### 1. Decision Mode

Decision mode produces structured output for the Orchestrator to validate and act upon.

**Input**: `ContextPackage` containing:
- User message
- Conversation history (optional)
- User profile (optional)
- Session state (optional)
- Available schemas (optional)

**Output**: `LLMDecisionOutput` containing:
- `intent`: Detected user intent (e.g., "search_hotels")
- `parameters`: Extracted parameters from user message
- `missingFields`: List of required fields not yet provided
- `suggestedAction`: One of "ask_missing", "execute_tool", "clarify", "handoff"
- `confidence`: Confidence score between 0 and 1
- `reasoning`: Optional explanation of the decision

**Example**:

```typescript
import { getLLMService } from './services/index.js';

const llmService = getLLMService();

const decision = await llmService.decide({
  userMessage: 'I want to book a hotel in Galle',
  sessionState: {
    currentIntent: 'search_hotels',
    collectedFields: {},
    missingFields: ['location', 'checkin_date'],
  },
});

console.log(decision);
// {
//   intent: 'search_hotels',
//   parameters: { location: 'Galle' },
//   missingFields: ['checkin_date'],
//   suggestedAction: 'ask_missing',
//   confidence: 0.93,
//   reasoning: 'User provided location but check-in date is still needed'
// }
```

### 2. UI-Support Mode

UI-support mode generates user-facing content like prompts, confirmations, and messages.

**Input**:
- `prompt`: Description of the content to generate
- `userLanguage`: Target language for the content (defaults to 'en')

**Output**: Generated content string

**Example**:

```typescript
import { getLLMService } from './services/index.js';

const llmService = getLLMService();

const content = await llmService.generateUIContent(
  'Generate a friendly confirmation message for a hotel booking at Galle Beach Hotel',
  'en'
);

console.log(content);
// "Great! Your booking at Galle Beach Hotel has been confirmed. 
//  You'll receive a confirmation message shortly."
```

## API Reference

### Constructor

```typescript
new LLMService(config?: Partial<LLMConfig>)
```

Creates a new LLMService instance with optional configuration.

**Parameters**:
- `config.provider`: LLM provider name (defaults to env.llm.provider)
- `config.apiKey`: API key for the LLM provider (required)
- `config.model`: Model name to use (defaults to env.llm.model)
- `config.confidenceThreshold`: Confidence threshold for decisions (defaults to env.llm.confidenceThreshold)

**Throws**: `LLMServiceError` if API key is missing

### decide()

```typescript
async decide(contextPackage: ContextPackage): Promise<LLMDecisionOutput>
```

Decision mode: calls LLM and returns structured decision output.

**Parameters**:
- `contextPackage`: User message and session context

**Returns**: Structured decision output for the Orchestrator

**Throws**: `LLMServiceError` if the LLM call fails

### generateUIContent()

```typescript
async generateUIContent(prompt: string, userLanguage?: string): Promise<string>
```

UI-support mode: generates wording and formatting for non-critical content.

**Parameters**:
- `prompt`: Description of the content to generate
- `userLanguage`: Target language (defaults to 'en')

**Returns**: Generated content string

**Throws**: `LLMServiceError` if the LLM call fails

## Singleton Pattern

The service provides singleton access for convenience:

```typescript
import { getLLMService, initLLMService } from './services/index.js';

// Get the singleton instance (uses default config from environment)
const llmService = getLLMService();

// Or initialize with custom configuration
const customService = initLLMService({
  provider: 'openai',
  apiKey: 'your-api-key',
  model: 'gpt-4',
  confidenceThreshold: 0.9,
});
```

## Configuration

The LLMService reads configuration from environment variables:

```env
LLM_PROVIDER=openai
LLM_API_KEY=your-api-key-here
LLM_MODEL=gpt-4
LLM_CONFIDENCE_THRESHOLD=0.85
```

## Error Handling

The service throws `LLMServiceError` for all errors:

```typescript
import { LLMServiceError } from './services/index.js';

try {
  const decision = await llmService.decide(contextPackage);
} catch (error) {
  if (error instanceof LLMServiceError) {
    console.error('LLM error:', error.message);
    console.error('Error code:', error.code);
    console.error('Retryable:', error.retryable);
  }
}
```

**Error Properties**:
- `message`: Human-readable error description
- `code`: Machine-readable error code
- `retryable`: Boolean indicating if the operation can be retried

**Common Error Codes**:
- `MISSING_API_KEY`: API key not provided
- `PROVIDER_NOT_IMPLEMENTED`: LLM provider not yet implemented
- `DECISION_FAILED`: Failed to get LLM decision
- `UI_GENERATION_FAILED`: Failed to generate UI content
- `PARSE_ERROR`: Failed to parse LLM response
- `EMPTY_RESPONSE`: LLM returned empty response

## Integration with Orchestrator

The Orchestrator uses the LLMService to make decisions but always validates the output before taking action:

```typescript
import { getLLMService } from './services/index.js';
import { env } from './config/environment.js';

const llmService = getLLMService();

// Get LLM decision
const decision = await llmService.decide(contextPackage);

// Validate confidence against threshold
if (decision.confidence < env.llm.confidenceThreshold) {
  // Low confidence: fall back to UI-based narrowing
  return generateNarrowingPrompt();
}

// Validate against schema and business rules
const validationResult = schemaEngine.validate(decision.parameters);
if (!validationResult.valid) {
  // Invalid parameters: ask for clarification
  return generateClarificationPrompt(validationResult.errors);
}

// Only after validation, proceed with suggested action
if (decision.suggestedAction === 'execute_tool') {
  // Orchestrator executes the tool (not the LLM)
  return await mcpInterface.executeTool(decision.intent, decision.parameters);
}
```

## Design Principles

### 1. No Direct Execution

The LLMService does NOT have methods for:
- Executing tool calls
- Creating bookings
- Processing payments
- Directly modifying state

All execution is handled by the Orchestrator after validation.

### 2. Structured Output

Decision mode always returns structured, typed output that can be validated programmatically.

### 3. Separation of Concerns

- **LLM**: Provides recommendations and generates content
- **Orchestrator**: Validates recommendations and executes actions
- **Schema Engine**: Validates parameters against schemas
- **MCP Interface**: Executes validated tool calls

### 4. Observability

All LLM decisions are logged for debugging and audit purposes:

```typescript
console.log('[LLMService] Decision made:', {
  userMessage: contextPackage.userMessage.substring(0, 100),
  intent: decision.intent,
  suggestedAction: decision.suggestedAction,
  confidence: decision.confidence,
  missingFieldsCount: decision.missingFields.length,
});
```

## Testing

Run unit tests:

```bash
npm test src/services/LLMService.test.ts
```

The test suite covers:
- Decision mode with various context packages
- UI-support mode with different languages
- Error handling and validation
- Requirements validation
- Edge cases (empty messages, special characters, long messages)

## Usage Examples

See `src/services/LLMService.example.ts` for comprehensive usage examples including:
- Basic intent detection
- Conversation history handling
- Session state integration
- User profile context
- Confirmation message generation
- Error message generation
- Multilingual content
- Custom configuration
- Low confidence handling
- Error handling

## Future Enhancements

- Support for multiple LLM providers (OpenAI, Anthropic, etc.)
- Streaming responses for long-running generations
- Caching of common decisions
- A/B testing of different prompts
- Fine-tuning support
- Token usage tracking and optimization
- Fallback to simpler models for low-priority tasks

## Related Components

- **Orchestrator**: Uses LLMService for decision making
- **Schema Engine**: Validates LLM-extracted parameters
- **MCP Interface**: Executes validated tool calls
- **WhatsApp Renderer**: Uses UI-support mode for content generation
- **Translation Service**: May use LLM for translation tasks
