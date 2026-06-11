# ToolRegistry

The `ToolRegistry` service manages tool definitions and provides tool lookup functionality for the YANA / OGO platform. It serves as the central registry for all MCP-style tools that can be called by the Orchestrator.

## Purpose

The ToolRegistry enables:
- **Contract-driven tool management**: Each tool has a well-defined contract with parameters, validation rules, and execution policies
- **Dynamic tool registration**: New tools can be added without modifying the Orchestrator core
- **Provider abstraction**: Tools are mapped to provider adapters, allowing provider implementations to be swapped
- **Execution control**: Retry policies, timeouts, and idempotency settings are defined per tool
- **Schema integration**: Tools can be bound to specific schemas for automatic triggering

## Requirements

- **5.6**: Load and store tool definitions from/to Durable_Store (tool_registry table)
- **5.7**: Support adding new tools without modifying Orchestrator
- **22.1**: Support adding new service verticals by registering new schemas and tools
- **22.2**: Support adding new provider adapters without modifying the MCP_Interface or Orchestrator

## Core Concepts

### Tool Definition

A tool definition includes:

1. **Basic metadata**: name, version, description
2. **Parameters**: required and optional parameters with types and validation rules
3. **Provider mapping**: which provider adapter to use and how to map parameters
4. **Execution policy**: retry count, retry delay, idempotency, timeout
5. **Permissions**: role-based access control and rate limiting
6. **Schema bindings**: which schemas trigger this tool

### Tool Contract

The tool contract is stored as JSONB in the database and contains all the metadata needed for:
- Parameter validation before execution
- Provider adapter routing
- Error handling and retry logic
- Access control enforcement

### Execution Policy

Each tool defines its execution policy:
- **retryCount**: Number of retry attempts on failure
- **retryDelayMs**: Initial delay between retries
- **retryBackoffMultiplier**: Exponential backoff multiplier (optional)
- **idempotent**: Whether the tool can be safely retried
- **timeoutMs**: Maximum execution time (optional)

## API

### Constructor

```typescript
const toolRegistry = new ToolRegistry(toolRepository?: ToolRepository);
```

Creates a new ToolRegistry instance. Optionally accepts a custom ToolRepository for testing.

### registerTool

```typescript
async registerTool(definition: ToolDefinition): Promise<ToolRegistrationResult>
```

Registers a new tool or updates an existing tool. Validates the tool definition before storing.

**Returns**: `ToolRegistrationResult` with success status, tool name, message, and any validation errors.

**Example**:
```typescript
const result = await toolRegistry.registerTool({
  name: 'search_hotels',
  version: '1.0',
  description: 'Search for hotels by location and date',
  parameters: {
    required: [
      { name: 'location', type: 'string', description: 'Hotel location' },
      { name: 'checkin_date', type: 'date', description: 'Check-in date' },
    ],
    optional: [
      { name: 'guests', type: 'number', description: 'Number of guests' },
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
```

### getTool

```typescript
async getTool(toolName: string): Promise<ToolDefinition | null>
```

Retrieves a tool definition by name. Returns null if the tool doesn't exist.

**Example**:
```typescript
const tool = await toolRegistry.getTool('search_hotels');
if (tool) {
  console.log(`Found tool: ${tool.name} v${tool.version}`);
}
```

### listTools

```typescript
async listTools(includeDisabled = false): Promise<ToolDefinition[]>
```

Lists all enabled tools. Set `includeDisabled` to true to include disabled tools.

**Example**:
```typescript
const tools = await toolRegistry.listTools();
console.log(`Found ${tools.length} tools`);
```

### setToolEnabled

```typescript
async setToolEnabled(toolName: string, enabled: boolean): Promise<void>
```

Enables or disables a tool without removing it from the registry.

**Example**:
```typescript
await toolRegistry.setToolEnabled('search_hotels', false);
```

### isToolAvailable

```typescript
async isToolAvailable(toolName: string): Promise<boolean>
```

Checks if a tool exists and is enabled.

**Example**:
```typescript
const available = await toolRegistry.isToolAvailable('search_hotels');
if (available) {
  // Tool can be used
}
```

### getExecutionPolicy

```typescript
async getExecutionPolicy(toolName: string): Promise<ExecutionPolicy | null>
```

Retrieves the execution policy for a tool.

**Example**:
```typescript
const policy = await toolRegistry.getExecutionPolicy('search_hotels');
if (policy) {
  console.log(`Retry count: ${policy.retryCount}`);
}
```

### getToolsForSchema

```typescript
async getToolsForSchema(schemaName: string): Promise<ToolDefinition[]>
```

Returns all tools that are bound to a specific schema.

**Example**:
```typescript
const tools = await toolRegistry.getToolsForSchema('search_hotels');
console.log(`Found ${tools.length} tools for this schema`);
```

## Usage Patterns

### Pattern 1: Register a new vertical

When adding a new service vertical (e.g., flights, restaurants):

1. Define the schema for the vertical
2. Register tools for the vertical operations (search, book, cancel)
3. Implement provider adapters for the tools
4. The Orchestrator automatically discovers and uses the new tools

```typescript
// Register flight search tool
await toolRegistry.registerTool({
  name: 'search_flights',
  version: '1.0',
  description: 'Search for flights',
  parameters: { /* ... */ },
  providerMapping: {
    providerName: 'amadeus',
    adapterClass: 'FlightSearchAdapter',
  },
  executionPolicy: { /* ... */ },
  schemaBindings: {
    triggerSchemas: ['search_flights'],
  },
});
```

### Pattern 2: Update a tool without downtime

Tools can be updated by registering a new version:

```typescript
// Update to version 2.0 with new parameters
await toolRegistry.registerTool({
  name: 'search_hotels',
  version: '2.0',
  description: 'Search for hotels with enhanced filters',
  parameters: {
    required: [ /* existing + new */ ],
    optional: [ /* existing + new */ ],
  },
  // ... rest of definition
});
```

### Pattern 3: Temporarily disable a tool

Disable a tool during maintenance without removing it:

```typescript
// Disable tool
await toolRegistry.setToolEnabled('search_hotels', false);

// Perform maintenance...

// Re-enable tool
await toolRegistry.setToolEnabled('search_hotels', true);
```

### Pattern 4: Query tools for orchestration

The Orchestrator can query tools based on the active schema:

```typescript
// Get all tools for the current schema
const tools = await toolRegistry.getToolsForSchema(activeSchema);

// Check if a specific tool is available
const canSearch = await toolRegistry.isToolAvailable('search_hotels');

// Get execution policy for retry logic
const policy = await toolRegistry.getExecutionPolicy('search_hotels');
```

## Validation

The ToolRegistry validates tool definitions before registration:

- **Name**: Required, non-empty string
- **Version**: Required, non-empty string
- **Description**: Required, non-empty string
- **Parameters**: Must have required and optional arrays
- **Parameter definitions**: Each parameter must have name and type
- **Provider mapping**: Must specify providerName and adapterClass
- **Execution policy**: Must specify retryCount, retryDelayMs, and idempotent flag

Invalid tool definitions are rejected with detailed error messages.

## Database Schema

Tools are stored in the `tool_registry` table:

```sql
CREATE TABLE tool_registry (
  tool_id UUID PRIMARY KEY,
  tool_name VARCHAR(255) UNIQUE NOT NULL,
  tool_version VARCHAR(50) NOT NULL,
  contract JSONB NOT NULL,
  execution_policy JSONB NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

The `contract` JSONB field contains:
- name, version, description
- parameters (required and optional)
- providerMapping
- permissions
- schemaBindings

The `execution_policy` JSONB field contains:
- retryCount, retryDelayMs, retryBackoffMultiplier
- idempotent, timeoutMs

## Integration with MCP Interface

The ToolRegistry is used by the MCP Interface to:

1. **Validate tool calls**: Check that the tool exists and is enabled
2. **Validate parameters**: Ensure all required parameters are provided
3. **Route to provider**: Use the provider mapping to select the correct adapter
4. **Apply retry logic**: Use the execution policy for retry behavior
5. **Enforce permissions**: Check role-based access control

## Testing

The ToolRegistry includes comprehensive unit tests covering:

- Tool registration with valid and invalid definitions
- Tool retrieval by name
- Listing all tools
- Enabling/disabling tools
- Checking tool availability
- Getting execution policies
- Querying tools by schema

Run tests with:
```bash
npm test -- src/services/ToolRegistry.test.ts
```

## See Also

- `ToolRepository`: Database access layer for tool storage
- `MCPInterface`: Tool execution and validation layer
- `SchemaEngine`: Schema-driven workflow management
- `Orchestrator`: Main decision and state transition loop
