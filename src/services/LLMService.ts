/**
 * LLM Service
 * 
 * Wraps LLM interactions with two distinct modes:
 * 1. Decision mode: produces structured output for the Orchestrator to validate and act upon
 * 2. UI-support mode: generates user-facing content like prompts and messages
 * 
 * The LLM does not have direct execution capabilities - it only provides recommendations
 * that the Orchestrator validates before taking action.
 * 
 * Validates Requirements: 4.1, 4.2, 4.3
 */

import { LLMDecisionOutput } from '../types/core.js';
import { env } from '../config/environment.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context package provided to the LLM for decision making
 */
export interface ContextPackage {
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  userProfile?: {
    preferredLanguage?: string;
    nationality?: string;
    recentActions?: string[];
  };
  sessionState?: {
    currentIntent?: string;
    activeSchema?: string;
    collectedFields?: Record<string, unknown>;
    missingFields?: string[];
  };
  availableSchemas?: string[];
}

/**
 * Configuration for LLM API calls
 */
export interface LLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  confidenceThreshold: number;
}

/**
 * Error thrown when LLM service encounters an issue
 */
export class LLMServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'LLMServiceError';
  }
}

// ============================================================================
// LLM Service
// ============================================================================

export class LLMService {
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      provider: config?.provider ?? env.llm.provider,
      apiKey: config?.apiKey ?? env.llm.apiKey,
      model: config?.model ?? env.llm.model,
      baseUrl: config?.baseUrl ?? env.llm.baseUrl,
      confidenceThreshold: config?.confidenceThreshold ?? env.llm.confidenceThreshold,
    };

    if (!this.config.apiKey) {
      throw new LLMServiceError(
        'LLM API key is required',
        'MISSING_API_KEY',
        false
      );
    }
  }

  /**
   * Decision mode: calls LLM and returns structured decision output
   * 
   * The LLM analyzes the user message and context to produce:
   * - Detected intent
   * - Extracted parameters
   * - Identified missing fields
   * - Suggested next action
   * - Confidence score
   * 
   * The Orchestrator validates this output before taking any action.
   * 
   * Validates: Requirement 4.1
   * 
   * @param contextPackage - User message and session context
   * @returns Structured decision output for the Orchestrator
   * @throws LLMServiceError if the LLM call fails
   */
  async decide(contextPackage: ContextPackage): Promise<LLMDecisionOutput> {
    try {
      // Build the decision prompt
      const prompt = this.buildDecisionPrompt(contextPackage);

      // Call the LLM (implementation depends on provider)
      const response = await this.callLLM(prompt, 'decision');

      // Parse and validate the structured output
      const decision = this.parseDecisionOutput(response);

      // Log the decision for observability
      this.logDecision(contextPackage, decision);

      return decision;
    } catch (error) {
      if (error instanceof LLMServiceError) {
        throw error;
      }

      throw new LLMServiceError(
        `Failed to get LLM decision: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DECISION_FAILED',
        true // Retryable
      );
    }
  }

  /**
   * UI-support mode: generates wording and formatting for non-critical content
   * 
   * This mode is used for:
   * - Generating friendly confirmation messages
   * - Formatting result summaries
   * - Creating conversational responses
   * - Translating technical terms to user-friendly language
   * 
   * This mode does NOT trigger tool calls, bookings, or payments.
   * 
   * Validates: Requirement 4.2
   * 
   * @param prompt - Description of the content to generate
   * @param userLanguage - Target language for the content
   * @returns Generated content string
   * @throws LLMServiceError if the LLM call fails
   */
  async generateUIContent(prompt: string, userLanguage: string = 'en'): Promise<string> {
    try {
      // Build the UI content generation prompt
      const fullPrompt = this.buildUIContentPrompt(prompt, userLanguage);

      // Call the LLM
      const response = await this.callLLM(fullPrompt, 'ui-support');

      // Extract and validate the content
      const content = this.parseUIContentOutput(response);

      return content;
    } catch (error) {
      if (error instanceof LLMServiceError) {
        throw error;
      }

      throw new LLMServiceError(
        `Failed to generate UI content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UI_GENERATION_FAILED',
        true // Retryable
      );
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Builds the prompt for decision mode
   */
  private buildDecisionPrompt(contextPackage: ContextPackage): string {
    const parts: string[] = [
      'You are an intent detection and parameter extraction assistant for a WhatsApp-based booking platform.',
      'Analyze the user message and context, then provide a structured decision output.',
      '',
      'User message:',
      contextPackage.userMessage,
    ];

    if (contextPackage.conversationHistory && contextPackage.conversationHistory.length > 0) {
      parts.push('', 'Conversation history:');
      contextPackage.conversationHistory.forEach((msg) => {
        parts.push(`${msg.role}: ${msg.content}`);
      });
    }

    if (contextPackage.sessionState) {
      parts.push('', 'Current session state:');
      if (contextPackage.sessionState.currentIntent) {
        parts.push(`Current intent: ${contextPackage.sessionState.currentIntent}`);
      }
      if (contextPackage.sessionState.activeSchema) {
        parts.push(`Active schema: ${contextPackage.sessionState.activeSchema}`);
      }
      if (contextPackage.sessionState.collectedFields) {
        parts.push(`Collected fields: ${JSON.stringify(contextPackage.sessionState.collectedFields)}`);
      }
      if (contextPackage.sessionState.missingFields) {
        parts.push(`Missing fields: ${contextPackage.sessionState.missingFields.join(', ')}`);
      }
    }

    if (contextPackage.availableSchemas && contextPackage.availableSchemas.length > 0) {
      parts.push('', `Available schemas: ${contextPackage.availableSchemas.join(', ')}`);
    }

    parts.push(
      '',
      'Respond with a JSON object containing:',
      '- intent: detected user intent (string)',
      '- parameters: extracted parameters (object)',
      '- missingFields: list of required fields not yet provided (array of strings)',
      '- suggestedAction: one of "ask_missing", "execute_tool", "clarify", "handoff"',
      '- confidence: confidence score between 0 and 1 (number)',
      '- reasoning: brief explanation of your decision (string, optional)',
      '',
      'Respond ONLY with valid JSON, no additional text.'
    );

    return parts.join('\n');
  }

  /**
   * Builds the prompt for UI content generation
   */
  private buildUIContentPrompt(prompt: string, userLanguage: string): string {
    return [
      `You are a helpful assistant generating user-facing content for a WhatsApp booking platform.`,
      `Target language: ${userLanguage}`,
      ``,
      `Task: ${prompt}`,
      ``,
      `Generate clear, friendly, concise content suitable for WhatsApp.`,
      `Keep messages short and actionable.`,
      `Do not include any instructions to execute actions, bookings, or payments.`,
    ].join('\n');
  }

  /**
   * Calls the LLM API (provider-specific implementation)
   * 
   * NOTE: This is a placeholder implementation. In production, this would
   * integrate with the actual LLM provider (OpenAI, Anthropic, etc.)
   */
  private async callLLM(prompt: string, mode: 'decision' | 'ui-support'): Promise<string> {
    if (this.config.provider === 'mock') {
      return this.getMockResponse(prompt, mode);
    }

    if (this.config.provider === 'openai') {
      return this.callOpenAICompatible(prompt, mode);
    }

    if (this.config.provider === 'openrouter' || this.config.provider === 'groq') {
      return this.callOpenAICompatible(prompt, mode);
    }

    throw new LLMServiceError(
      `LLM provider '${this.config.provider}' not yet implemented`,
      'PROVIDER_NOT_IMPLEMENTED',
      false
    );
  }

  /**
   * Calls OpenAI-compatible Chat Completions APIs.
   */
  private async callOpenAICompatible(prompt: string, mode: 'decision' | 'ui-support'): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: mode === 'decision' ? 0.1 : 0.4,
        messages: [
          {
            role: 'system',
            content:
              mode === 'decision'
                ? 'Return only valid JSON matching the requested schema.'
                : 'Return concise WhatsApp-ready text only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new LLMServiceError(
        `OpenAI request failed with ${response.status}: ${errorBody}`,
        'PROVIDER_REQUEST_FAILED',
        response.status >= 500 || response.status === 429
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new LLMServiceError(
        'OpenAI returned an empty response',
        'EMPTY_RESPONSE',
        true
      );
    }

    return content;
  }

  /**
   * Parses the LLM response into structured decision output
   */
  private parseDecisionOutput(response: string): LLMDecisionOutput {
    try {
      const parsed = JSON.parse(extractJsonResponse(response));

      // Validate required fields
      if (!parsed.intent || typeof parsed.intent !== 'string') {
        throw new Error('Missing or invalid intent field');
      }

      if (!parsed.parameters || typeof parsed.parameters !== 'object') {
        throw new Error('Missing or invalid parameters field');
      }

      if (!Array.isArray(parsed.missingFields)) {
        throw new Error('Missing or invalid missingFields field');
      }

      if (!parsed.suggestedAction || !['ask_missing', 'execute_tool', 'clarify', 'handoff'].includes(parsed.suggestedAction)) {
        throw new Error('Missing or invalid suggestedAction field');
      }

      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
        throw new Error('Missing or invalid confidence field');
      }

      return {
        intent: parsed.intent,
        parameters: parsed.parameters,
        missingFields: parsed.missingFields,
        suggestedAction: parsed.suggestedAction,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      throw new LLMServiceError(
        `Failed to parse LLM decision output: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PARSE_ERROR',
        false
      );
    }
  }

  /**
   * Parses the LLM response for UI content
   */
  private parseUIContentOutput(response: string): string {
    // For UI content, we expect plain text (not JSON)
    const trimmed = stripSurroundingQuotes(response.trim());

    if (!trimmed) {
      throw new LLMServiceError(
        'LLM returned empty UI content',
        'EMPTY_RESPONSE',
        true
      );
    }

    return trimmed;
  }

  /**
   * Logs the decision for observability
   */
  private logDecision(contextPackage: ContextPackage, decision: LLMDecisionOutput): void {
    console.log('[LLMService] Decision made:', {
      userMessage: contextPackage.userMessage.substring(0, 100),
      intent: decision.intent,
      suggestedAction: decision.suggestedAction,
      confidence: decision.confidence,
      missingFieldsCount: decision.missingFields.length,
    });
  }

  /**
   * Returns mock responses for testing
   */
  private getMockResponse(prompt: string, mode: 'decision' | 'ui-support'): string {
    if (mode === 'decision') {
      return JSON.stringify({
        intent: 'search_hotels',
        parameters: {},
        missingFields: ['location', 'checkin_date'],
        suggestedAction: 'ask_missing',
        confidence: 0.9,
        reasoning: 'User wants to search for hotels but has not provided location or dates',
      });
    } else {
      return 'Thank you for your message. How can I help you today?';
    }
  }
}

function extractJsonResponse(response: string): string {
  const trimmed = response.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fencedJson) {
    return fencedJson[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function stripSurroundingQuotes(response: string): string {
  if (
    (response.startsWith('"') && response.endsWith('"')) ||
    (response.startsWith("'") && response.endsWith("'"))
  ) {
    return response.slice(1, -1).trim();
  }

  return response;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let llmServiceInstance: LLMService | null = null;

/**
 * Gets the singleton LLMService instance
 */
export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService();
  }
  return llmServiceInstance;
}

/**
 * Initializes the LLMService with custom configuration
 */
export function initLLMService(config?: Partial<LLMConfig>): LLMService {
  llmServiceInstance = new LLMService(config);
  return llmServiceInstance;
}
