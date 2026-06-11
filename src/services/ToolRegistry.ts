/**
 * ToolRegistry - Manages tool definitions and provides tool lookup
 * 
 * Responsibilities:
 * - Register new tools with contract definitions
 * - Retrieve tool definitions by name
 * - List available tools
 * - Validate tool definitions
 * - Support adding new tools without modifying Orchestrator
 * 
 * Requirements: 5.6, 5.7, 22.1, 22.2
 */

import { ToolRepository, type Tool } from '../db/repositories/ToolRepository.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Tool definition with full contract specification
 */
export interface ToolDefinition {
  name: string;
  version: string;
  description: string;
  parameters: ToolParameters;
  providerMapping: ProviderMapping;
  executionPolicy: ExecutionPolicy;
  permissions?: ToolPermissions;
  schemaBindings?: SchemaBindings;
  isEnabled?: boolean;
}

/**
 * Tool parameter definitions (required and optional)
 */
export interface ToolParameters {
  required: ParameterDefinition[];
  optional: ParameterDefinition[];
}

/**
 * Individual parameter definition
 */
export interface ParameterDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  description: string;
  validation?: ParameterValidation;
  defaultValue?: unknown;
}

/**
 * Parameter validation rules
 */
export interface ParameterValidation {
  min?: number;
  max?: number;
  pattern?: string;
  enum?: unknown[];
  customValidator?: string;
}

/**
 * Provider mapping configuration
 */
export interface ProviderMapping {
  providerName: string;
  adapterClass: string;
  endpoint?: string;
  method?: string;
  requestMapping?: Record<string, string>;
  responseMapping?: Record<string, string>;
}

/**
 * Execution policy for retry and idempotency
 */
export interface ExecutionPolicy {
  retryCount: number;
  retryDelayMs: number;
  retryBackoffMultiplier?: number;
  idempotent: boolean;
  timeoutMs?: number;
}

/**
 * Tool permissions and access control
 */
export interface ToolPermissions {
  requiredRoles?: string[];
  allowedUsers?: string[];
  rateLimit?: {
    maxCallsPerMinute: number;
    maxCallsPerHour: number;
  };
}

/**
 * Schema bindings for tool-schema associations
 */
export interface SchemaBindings {
  triggerSchemas: string[];
  requiredSchemaFields?: string[];
  outputSchemaMapping?: Record<string, string>;
}

/**
 * Tool registration result
 */
export interface ToolRegistrationResult {
  success: boolean;
  toolName: string;
  message: string;
  errors?: string[];
}

// ============================================================================
// ToolRegistry Class
// ============================================================================

export class ToolRegistry {
  private toolRepository: ToolRepository;

  constructor(toolRepository?: ToolRepository) {
    this.toolRepository = toolRepository || new ToolRepository();
  }

  /**
   * Register a new tool or update an existing tool
   * 
   * Validates the tool definition and stores it in the Durable_Store.
   * If a tool with the same name exists, it will be updated (idempotent).
   * 
   * Requirement 5.7: Support adding new tools without modifying Orchestrator
   * Requirement 22.1: Support adding new service verticals by registering new tools
   */
  async registerTool(definition: ToolDefinition): Promise<ToolRegistrationResult> {
    // Validate tool definition
    const validationErrors = this.validateToolDefinition(definition);
    if (validationErrors.length > 0) {
      return {
        success: false,
        toolName: definition.name,
        message: 'Tool definition validation failed',
        errors: validationErrors,
      };
    }

    try {
      // Convert ToolDefinition to storage format
      const contract = this.buildToolContract(definition);
      const executionPolicy = definition.executionPolicy;

      // Store in database (idempotent - will update if exists)
      await this.toolRepository.registerTool({
        toolName: definition.name,
        toolVersion: definition.version,
        contract,
        executionPolicy: executionPolicy as unknown as Record<string, unknown>,
        isEnabled: definition.isEnabled ?? true,
      });

      return {
        success: true,
        toolName: definition.name,
        message: `Tool '${definition.name}' registered successfully`,
      };
    } catch (error) {
      return {
        success: false,
        toolName: definition.name,
        message: `Failed to register tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * Retrieve a tool definition by name
   * 
   * Returns the full tool definition if found, null otherwise.
   * 
   * Requirement 5.6: Load tool definitions from Durable_Store
   */
  async getTool(toolName: string): Promise<ToolDefinition | null> {
    const tool = await this.toolRepository.findByName(toolName);
    
    if (!tool) {
      return null;
    }

    return this.convertToToolDefinition(tool);
  }

  /**
   * List all enabled tools
   * 
   * Returns an array of all enabled tool definitions.
   * 
   * Requirement 5.6: Load and store tool definitions from/to Durable_Store
   */
  async listTools(includeDisabled = false): Promise<ToolDefinition[]> {
    let tools: Tool[];
    
    if (includeDisabled) {
      // For now, we'll just get enabled tools
      // In a full implementation, we'd add a findAll method to ToolRepository
      tools = await this.toolRepository.findEnabled();
    } else {
      tools = await this.toolRepository.findEnabled();
    }

    return tools.map((tool) => this.convertToToolDefinition(tool));
  }

  /**
   * Enable or disable a tool
   * 
   * Allows tools to be enabled/disabled without removing them from the registry.
   */
  async setToolEnabled(toolName: string, enabled: boolean): Promise<void> {
    await this.toolRepository.setEnabled(toolName, enabled);
  }

  /**
   * Check if a tool exists and is enabled
   */
  async isToolAvailable(toolName: string): Promise<boolean> {
    const tool = await this.toolRepository.findByName(toolName);
    return tool !== null && tool.isEnabled;
  }

  /**
   * Get tool execution policy
   * 
   * Returns the execution policy for a tool, which includes retry configuration
   * and idempotency settings.
   */
  async getExecutionPolicy(toolName: string): Promise<ExecutionPolicy | null> {
    const tool = await this.toolRepository.findByName(toolName);
    
    if (!tool) {
      return null;
    }

    return tool.executionPolicy as unknown as ExecutionPolicy;
  }

  /**
   * Get tools associated with a specific schema
   * 
   * Returns all tools that are bound to the given schema name.
   */
  async getToolsForSchema(schemaName: string): Promise<ToolDefinition[]> {
    const allTools = await this.listTools();
    
    return allTools.filter((tool) => {
      return tool.schemaBindings?.triggerSchemas.includes(schemaName);
    });
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Validate a tool definition
   * 
   * Returns an array of validation error messages.
   * Empty array means validation passed.
   */
  private validateToolDefinition(definition: ToolDefinition): string[] {
    const errors: string[] = [];

    // Validate name
    if (!definition.name || definition.name.trim().length === 0) {
      errors.push('Tool name is required');
    }

    // Validate version
    if (!definition.version || definition.version.trim().length === 0) {
      errors.push('Tool version is required');
    }

    // Validate description
    if (!definition.description || definition.description.trim().length === 0) {
      errors.push('Tool description is required');
    }

    // Validate parameters
    if (!definition.parameters) {
      errors.push('Tool parameters definition is required');
    } else {
      if (!Array.isArray(definition.parameters.required)) {
        errors.push('Tool parameters.required must be an array');
      }
      if (!Array.isArray(definition.parameters.optional)) {
        errors.push('Tool parameters.optional must be an array');
      }

      // Validate parameter definitions
      const allParams = [
        ...(definition.parameters.required || []),
        ...(definition.parameters.optional || []),
      ];

      for (const param of allParams) {
        if (!param.name || param.name.trim().length === 0) {
          errors.push('Parameter name is required');
        }
        if (!param.type) {
          errors.push(`Parameter '${param.name}' must have a type`);
        }
      }
    }

    // Validate provider mapping
    if (!definition.providerMapping) {
      errors.push('Provider mapping is required');
    } else {
      if (!definition.providerMapping.providerName) {
        errors.push('Provider name is required in provider mapping');
      }
      if (!definition.providerMapping.adapterClass) {
        errors.push('Adapter class is required in provider mapping');
      }
    }

    // Validate execution policy
    if (!definition.executionPolicy) {
      errors.push('Execution policy is required');
    } else {
      if (typeof definition.executionPolicy.retryCount !== 'number') {
        errors.push('Execution policy retryCount must be a number');
      }
      if (typeof definition.executionPolicy.retryDelayMs !== 'number') {
        errors.push('Execution policy retryDelayMs must be a number');
      }
      if (typeof definition.executionPolicy.idempotent !== 'boolean') {
        errors.push('Execution policy idempotent must be a boolean');
      }
    }

    return errors;
  }

  /**
   * Build a tool contract object from a tool definition
   * 
   * The contract is stored as JSONB in the database and contains all
   * the tool metadata needed for validation and execution.
   */
  private buildToolContract(definition: ToolDefinition): Record<string, unknown> {
    return {
      name: definition.name,
      version: definition.version,
      description: definition.description,
      parameters: definition.parameters,
      providerMapping: definition.providerMapping,
      permissions: definition.permissions,
      schemaBindings: definition.schemaBindings,
    };
  }

  /**
   * Convert a database Tool record to a ToolDefinition
   */
  private convertToToolDefinition(tool: Tool): ToolDefinition {
    const contract = tool.contract as any;

    return {
      name: tool.toolName,
      version: tool.toolVersion,
      description: contract.description || '',
      parameters: contract.parameters || { required: [], optional: [] },
      providerMapping: contract.providerMapping || {
        providerName: '',
        adapterClass: '',
      },
      executionPolicy: tool.executionPolicy as unknown as ExecutionPolicy,
      permissions: contract.permissions,
      schemaBindings: contract.schemaBindings,
      isEnabled: tool.isEnabled,
    };
  }
}
