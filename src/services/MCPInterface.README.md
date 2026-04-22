# MCPInterface

The `MCPInterface` service is the MCP (Model Context Protocol) tool interface layer for the YANA / OGO platform. It validates tool calls against registered contracts, normalizes inputs, routes calls to provider adapters, logs all executions, and handles retry logic.

## Purpose

The MCPInterface enables:
- **Contract validation**: Every tool call is validated against the tool's registered contract before execution
- **Input normalization**: Tool inputs are normalized at the interface boundary for consistent provider handling
- **Provider routing**: Tool calls are routed to the correct provider adapter without business logic in the interface
- **Comprehensive logging**: Every tool call (success or failure) is logged with correlation IDs for observability
- **Retry handling**: Failed tool calls are retried according to the tool's execution policy

## Requirements

- **5.1**: Validate every tool call against the tool's registered contract before execution
- **5.2**: Normalize tool inputs and outputs at the interface boundary
- **5.3**: Log every tool call with Correlation_ID, tool name, input, output, status, and timestamp
- **5.4**: Return structured error state on validation failure without executing
- **5.5**: Apply retry policies to failed tool calls as defined in the tool's execution policy

## Core Concepts

### Tool Call Flow

1. **Validation**: Check tool exists, is enabled, and all required parameters are provided with correct types
2. **Normalization**: Convert inputs to canonical format (e.g., dates to ISO strings)
3. **Routing**: Select the correct provider adapter based on tool definition
4. **Execution**: Call the adapter's execute method with normalized parameters
5. **Retry**: On failure, retry according to the tool's retry policy with exponential backoff
6. **Logging**: Log every attempt (success or failure) to the tool_runs table

### Provider Adapter Interface

All provider adapters must implement the `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown>;
  
  getProviderName(): string;
}
```

### Validation

The MCPInterface validates:
- Tool exists and is enabled
- All required parameters are present
- Parameter types match the tool definition
- Optional parameters (if provided) have correct types

Validation failures return a structured error without executing the tool.

### Retry Policy

Each tool defines its retry policy:
- **retryCount**: Number of retry attempts (0 = no retries)
- **retryDelayMs**: Initial delay between retries
- **retryBackoffMultiplier**: Exponential backoff multiplier (default: 2)

Retries are only attempted for retryable errors (timeouts, network errors, rate limits).

### Error Categorization

Errors are categorized into:
- **SCHEMA_ERROR**: Validation failures, invalid parameters
- **PROVIDER_FAILURE**: Provider timeouts, network errors
- **PAYMENT_FAILURE**: Payment-related errors
- **TRANSLATION_FAILURE**: Translation errors
- **INTERNAL_SYSTEM_ERROR**: Unexpected system errors

## API

### Constructor

```typescript
const mcpInterface = new MCPInterface(
  toolRegistry?: ToolRegistry,
  toolRepository?: ToolRepository,
  adapters?: Map<string, ProviderAdapter>
);
```

Creates a new MCPInterface instance. All parameters are optional for testing.

### registerAdapter

```typescript
registerAdapter(adapterClass: string, adapter: ProviderAdapter): void
```

Registers a provider adapter for a specific adapter class name.

**Example**:
```typescript
const hotelAdapter = new HotelSearchAdapter();
mcpInterface.registerAdapter('HotelSearchAdapter', hotelAdapter);
```

### executeToolCall

```typescript
async executeToolCall(
  toolCallRequest: ToolCallRequest,
  correlationCtx: CorrelationContext
): Promise<ToolCallResult>
```

Executes a tool call with full validation, routing, logging, and retry logic.

**Parameters**:
- `toolCallRequest`: The tool call request with tool name, parameters, and context
- `correlationCtx`: Correlation context for tracing and logging

**Returns**: `ToolCallResult` with success/failure state, data/error, and metadata

**Example**:
```typescript
const request: ToolCallRequest = {
  tool: 'search_hotels',
  params: {
    location: 'Galle',
    checkin_date: '2026-04-17',
    guests: 2,
  },
  context: {
    userLanguage: 'en',
    canonicalLanguage: 'en',
    sessionId: 'sess_123',
    requestId: 'req_456',
  },
};

const correlationCtx: CorrelationContext = {
  correlationId: 'corr_789',
  sessionId: 'sess_123',
  userId: 'user_123',
  requestTimestamp: new Date(),
};

const result = await mcpInterface.executeToolCall(request, correlationCtx);

if (result.success) {
  console.log('Tool call succeeded:', result.data);
} else {
  console.error('Tool call failed:', result.error);
}
```

## Usage Patterns

### Pattern 1: Register and execute a tool

```typescript
// 1. Register the tool in ToolRegistry
await toolRegistry.registerTool({
  name: 'search_hotels',
  version: '1.0',
  description: 'Search for hotels',
  parameters: {
    required: [
      { name: 'location', type: 'string' },
      { name: 'checkin_date', type: 'date' },
    ],
    optional: [
      { name: 'guests', type: 'number' },
    ],
  },
  providerMapping: {
    providerName: 'booking_com',
    adapterClass: 'HotelSearchAdapter',
  },
  executionPolicy: {
    retryCount: 3,
    retryDelayMs: 1000,
    idempotent: true,
  },
});

// 2. Register the provider adapter
const adapter = new HotelSearchAdapter();
mcpInterface.registerAdapter('HotelSearchAdapter', adapter);

// 3. Execute the tool call
const result = await mcpInterface.executeToolCall(request, correlationCtx);
```

### Pattern 2: Handle validation errors

```typescript
const result = await mcpInterface.executeToolCall(request, correlationCtx);

if (!result.success && result.error?.category === ErrorCategory.SCHEMA_ERROR) {
  // Validation failed - inform user about missing/invalid parameters
  console.error('Invalid parameters:', result.error.message);
  // Do not retry - validation errors are not retryable
}
```

### Pattern 3: Handle provider failures with retry

```typescript
const result = await mcpInterface.executeToolCall(request, correlationCtx);

if (!result.success && result.error?.category === ErrorCategory.PROVIDER_FAILURE) {
  // Provider failed after retries
  console.error('Provider unavailable:', result.error.message);
  console.log('Attempts made:', result.metadata.attemptNumber);
  
  // Trigger human handoff or degraded mode
  await orchestrator.triggerHumanHandoff(sessionId, 'provider_failure');
}
```

### Pattern 4: Implement a custom provider adapter

```typescript
class CustomAdapter implements ProviderAdapter {
  async execute(
    params: Record<string, unknown>,
    context: CorrelationContext
  ): Promise<unknown> {
    // Call external API
    const response = await fetch('https://api.example.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': context.correlationId,
      },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) {
      throw new Error(`Provider error: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  getProviderName(): string {
    return 'custom_provider';
  }
}

// Register the adapter
mcpInterface.registerAdapter('CustomAdapter', new CustomAdapter());
```

## Logging

Every tool call is logged to the `tool_runs` table with:
- **correlation_id**: For end-to-end tracing
- **session_id**: For session-level analysis
- **user_id**: For user-level analysis
- **tool_name**: The tool that was called
- **input_params**: The input parameters (JSONB)
- **output_data**: The output data on success (JSONB)
- **error_data**: The error data on failure (JSONB)
- **execution_status**: 'success', 'failure', or 'pending'
- **execution_time_ms**: Execution duration
- **attempt_number**: Which attempt (1 for first, 2+ for retries)
- **provider_name**: The provider that was used

## Error Handling

### Validation Errors

Validation errors are returned immediately without execution:
- Missing required parameters
- Invalid parameter types
- Tool not found or disabled

These errors are not retryable.

### Provider Errors

Provider errors trigger retry logic:
- Network timeouts
- Connection refused
- Rate limit errors
- 502/503 HTTP errors

Non-retryable provider errors:
- 400 Bad Request (client error)
- 401 Unauthorized
- 404 Not Found

### Retry Behavior

Retries use exponential backoff:
- Attempt 1: Execute immediately
- Attempt 2: Wait `retryDelayMs` (e.g., 1000ms)
- Attempt 3: Wait `retryDelayMs * backoffMultiplier` (e.g., 2000ms)
- Attempt 4: Wait `retryDelayMs * backoffMultiplier^2` (e.g., 4000ms)

After exhausting retries, the final failure state is returned.

## Integration with Other Services

### ToolRegistry

The MCPInterface uses ToolRegistry to:
- Check if a tool exists and is enabled
- Get tool definitions for validation
- Get execution policies for retry logic

### ToolRepository

The MCPInterface uses ToolRepository to:
- Log every tool call to the tool_runs table
- Support audit trail and observability

### Orchestrator

The Orchestrator uses MCPInterface to:
- Execute tool calls after schema validation
- Handle tool call results (success or failure)
- Trigger human handoff on repeated failures

## Testing

The MCPInterface includes comprehensive unit tests covering:
- Successful tool execution
- Validation errors (missing parameters, invalid types)
- Tool not found or disabled
- Provider failures with retry
- Retry exhaustion
- Logging of all calls
- Error categorization
- Exponential backoff timing

Run tests with:
```bash
npm test -- src/services/MCPInterface.test.ts
```

## See Also

- `ToolRegistry`: Tool definition management
- `ToolRepository`: Database access for tool storage and logging
- `Orchestrator`: Main decision and state transition loop
- `ProviderAdapter`: Interface for provider implementations
