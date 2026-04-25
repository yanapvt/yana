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
import { logger } from '../config/logger.js';

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
      confidenceThreshold: config?.confidenceThreshold ?? env.llm.confidenceThreshold,
    };

    logger.debug('LLMService', 'Initializing LLM Service', {
      provider: this.config.provider,
      model: this.config.model,
      confidenceThreshold: this.config.confidenceThreshold,
    });

    if (!this.config.apiKey) {
      logger.error('LLMService', 'LLM API key is required');
      throw new LLMServiceError(
        'LLM API key is required',
        'MISSING_API_KEY',
        false
      );
    }

    logger.info('LLMService', 'LLM Service initialized successfully');
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
    logger.debug('LLMService', 'Making LLM decision', {
      userMessage: contextPackage.userMessage.substring(0, 50),
      hasConversationHistory: !!contextPackage.conversationHistory?.length,
      hasSessionState: !!contextPackage.sessionState,
    });

    try {
      // Build the decision prompt
      const prompt = this.buildDecisionPrompt(contextPackage);

      // Call the LLM (implementation depends on provider)
      const response = await this.callLLM(prompt, 'decision');

      // Parse and validate the structured output
      const decision = this.parseDecisionOutput(response);

      logger.info('LLMService', 'LLM decision made successfully', {
        intent: decision.intent,
        suggestedAction: decision.suggestedAction,
        confidence: decision.confidence,
        missingFieldsCount: decision.missingFields.length,
      });

      return decision;
    } catch (error) {
      if (error instanceof LLMServiceError) {
        logger.error('LLMService', 'LLM decision error', {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
        throw error;
      }

      logger.error('LLMService', 'Failed to get LLM decision', {
        error: error instanceof Error ? error.message : String(error),
      });

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
    logger.debug('LLMService', 'Generating UI content', {
      promptLength: prompt.length,
      userLanguage,
    });

    try {
      // Build the UI content generation prompt
      const fullPrompt = this.buildUIContentPrompt(prompt, userLanguage);

      // Call the LLM
      const response = await this.callLLM(fullPrompt, 'ui-support');

      // Extract and validate the content
      const content = this.parseUIContentOutput(response);

      logger.debug('LLMService', 'UI content generated successfully', {
        contentLength: content.length,
      });

      return content;
    } catch (error) {
      if (error instanceof LLMServiceError) {
        logger.error('LLMService', 'UI content generation error', {
          code: error.code,
          message: error.message,
        });
        throw error;
      }

      logger.error('LLMService', 'Failed to generate UI content', {
        error: error instanceof Error ? error.message : String(error),
      });

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
   */
  private async callLLM(prompt: string, mode: 'decision' | 'ui-support'): Promise<string> {
    logger.debug('LLMService', 'Calling LLM API', {
      provider: this.config.provider,
      model: this.config.model,
      mode,
      promptLength: prompt.length,
    });

    if (this.config.provider === 'mock') {
      logger.debug('LLMService', 'Using mock LLM response');
      return this.getMockResponse(prompt, mode);
    }

    // Groq and OpenAI-compatible providers
    if (this.config.provider === 'groq' || this.config.provider === 'openai') {
      return this.callOpenAICompatible(prompt, mode);
    }

    logger.error('LLMService', 'LLM provider not implemented', {
      provider: this.config.provider,
    });

    throw new LLMServiceError(
      `LLM provider '${this.config.provider}' not yet implemented`,
      'PROVIDER_NOT_IMPLEMENTED',
      false
    );
  }

  /**
   * Calls an OpenAI-compatible API (works for Groq, OpenAI, etc.)
   */
  private async callOpenAICompatible(prompt: string, mode: 'decision' | 'ui-support'): Promise<string> {
    const baseUrl = this.config.provider === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';

    const systemPrompt = mode === 'decision'
      ? 'You are an intent detection assistant. Always respond with valid JSON only, no markdown, no extra text.'
      : 'You are a helpful assistant generating user-facing content for a WhatsApp booking platform. Be concise and friendly.';

    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: mode === 'decision' ? 0.1 : 0.7,
      max_tokens: mode === 'decision' ? 512 : 256,
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('LLMService', 'LLM API request failed', {
        status: response.status,
        provider: this.config.provider,
        error: errorText.substring(0, 200),
      });
      throw new LLMServiceError(
        `LLM API request failed with status ${response.status}`,
        'API_ERROR',
        response.status >= 500 // Retryable for server errors
      );
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMServiceError('LLM returned empty response', 'EMPTY_RESPONSE', true);
    }

    return content.trim();
  }

  /**
   * Parses the LLM response into structured decision output
   */
  private parseDecisionOutput(response: string): LLMDecisionOutput {
    logger.debug('LLMService', 'Parsing LLM decision output', {
      responseLength: response.length,
    });

    try {
      const parsed = JSON.parse(response);

      // Validate required fields
      if (!parsed.intent || typeof parsed.intent !== 'string') {
        logger.warn('LLMService', 'Missing or invalid intent field in LLM response');
        throw new Error('Missing or invalid intent field');
      }

      if (!parsed.parameters || typeof parsed.parameters !== 'object') {
        logger.warn('LLMService', 'Missing or invalid parameters field in LLM response');
        throw new Error('Missing or invalid parameters field');
      }

      if (!Array.isArray(parsed.missingFields)) {
        logger.warn('LLMService', 'Missing or invalid missingFields field in LLM response');
        throw new Error('Missing or invalid missingFields field');
      }

      if (!parsed.suggestedAction || !['ask_missing', 'execute_tool', 'clarify', 'handoff'].includes(parsed.suggestedAction)) {
        logger.warn('LLMService', 'Missing or invalid suggestedAction field in LLM response');
        throw new Error('Missing or invalid suggestedAction field');
      }

      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
        logger.warn('LLMService', 'Missing or invalid confidence field in LLM response');
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
      logger.error('LLMService', 'Failed to parse LLM decision output', {
        error: error instanceof Error ? error.message : String(error),
      });

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
    const trimmed = response.trim();

    if (!trimmed) {
      logger.warn('LLMService', 'LLM returned empty UI content');
      throw new LLMServiceError(
        'LLM returned empty UI content',
        'EMPTY_RESPONSE',
        true
      );
    }

    return trimmed;
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

// ============================================================================
// Singleton Instance
// ============================================================================

let llmServiceInstance: LLMService | null = null;

/**
 * Gets the singleton LLMService instance
 */
export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    logger.debug('LLMService', 'Creating singleton LLMService instance');
    llmServiceInstance = new LLMService();
  }
  return llmServiceInstance;
}

/**
 * Initializes the LLMService with custom configuration
 */
export function initLLMService(config?: Partial<LLMConfig>): LLMService {
  logger.info('LLMService', 'Initializing LLMService with custom configuration');
  llmServiceInstance = new LLMService(config);
  return llmServiceInstance;
}
