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
import { PromptService, type LLMPurpose } from '../orchestration/PromptService.js';
import { decisionOutputSchema } from '../orchestration/WorkflowDefinitions.js';
import { ZodError } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * Context package provided to the LLM for decision making
 */
export interface ContextPackage {
  conversationTopic?: string;
  pendingQuestion?: { text: string; expectedAnswerType?: string; workflowId?: string };
  pendingClarification?: string;
  allowedUIModes?: string[];
  workflowDefinition?: { schema: string; version: string; required: readonly string[]; fields: readonly string[]; fieldTypes: Record<string, string>; allowedValues: Record<string, readonly string[]> };
  requestId?: string;
  sessionId?: string;
  conversationId?: string;
  channel?: string;
  uiWorkspace?: { workflowId?: string; selectedDay: number; revision: number };
  pendingTransaction?: { workflowId?: string; flow: string; stage: string; confirmed: false };
  eventType?: string;
  messageType?: string;
  historyStatus?: 'available' | 'empty' | 'unavailable';
  itinerary?: { days: Array<{ day: number; date: string; location: string; morning: string; afternoon: string; evening: string }> };
  verifiedResults?: { source: string; retrievedAt: string; items: Array<{ resultId: string; position: number; name: string; rating?: number }> };
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  userProfile?: {
    preferredName?: string;
    preferredLanguage?: string;
    nationality?: string;
    preferredCurrency?: string;
    travelStyle?: string;
    dietaryRestrictions?: string;
    accessibilityNeeds?: string;
    recentActions?: string[];
  };
  travellerContext?: {
    confirmedFacts: Array<{ key: string; value: string; scope: string; updatedAt?: string; expiresAt?: string; source?: string }>;
    pendingConfirmations: Array<{ key: string; value: string; scope: string; updatedAt?: string; expiresAt?: string; source?: string }>;
  };
  sessionState?: {
    sessionId?: string;
    revision?: number;
    updatedAt?: string;
    lifecycleStatus?: 'active' | 'paused';
    state?: string;
    schemaVersion?: string;
    currentIntent?: string;
    activeSchema?: string;
    collectedFields?: Record<string, unknown>;
    requiredFields?: string[];
    missingFields?: string[];
    awaitedField?: string;
    pendingDecisions?: { locationConfirmation?: string; sourcingConsent?: boolean; humanHandoffConsent?: boolean };
  };
  pausedTasks?: Array<{
    currentIntent: string; activeSchema?: string; revision?: number; updatedAt?: string;
    lifecycleStatus?: 'active' | 'paused'; state?: string;
    collectedFields: Record<string, unknown>; missingFields: string[];
    pendingDecisions?: { locationConfirmation?: string; sourcingConsent?: boolean; humanHandoffConsent?: boolean };
  }>;
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

// The model proposes one validated decision. This function does not execute
// provider operations; DecisionEngine and the existing backend retain control.
const DECISION_TOOL_NAME = 'propose_yana_decision';
const DECISION_TOOL = {
  type: 'function' as const,
  function: {
    name: DECISION_TOOL_NAME,
    description: 'Propose a natural reply, interpreted intent, and optional backend action for YANA to validate.',
    parameters: {
      type: 'object',
      properties: {
        responseText: { type: 'string' },
        intent: { type: 'string' },
        parameters: { type: 'object', additionalProperties: true },
        fieldUpdates: { type: 'object', additionalProperties: true },
        missingFields: { type: 'array', items: { type: 'string' } },
        suggestedAction: { type: 'string', enum: ['none', 'ask_missing', 'execute_tool', 'clarify', 'handoff'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        recommendedSchema: { type: 'string' },
        taskTransition: { type: 'string', enum: ['continue', 'pause', 'resume', 'switch', 'none'] },
        clarificationRequired: { type: 'boolean' },
        clarificationQuestion: { type: 'string' },
        proposedAction: { type: 'object', properties: {
          name: { type: 'string', enum: ['none', 'search', 'open_form', 'handoff'] },
          arguments: { type: 'object', additionalProperties: true },
        }, required: ['name', 'arguments'] },
      },
      required: ['intent', 'parameters', 'missingFields', 'suggestedAction', 'confidence'],
      additionalProperties: true,
    },
  },
};

/**
 * Error thrown when LLM service encounters an issue
 */
export class LLMServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly providerDetails?: {
      status?: number;
      type?: string;
      code?: string;
      safeDetail?: string;
    }
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
  private readonly prompts = new PromptService();

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
  async decide(contextPackage: ContextPackage, systemInstructions?: string): Promise<LLMDecisionOutput> {
    try {
      // Build the decision prompt
      const prompt = JSON.stringify(contextPackage);
      let response: string;
      try {
        response = await this.callLLM(prompt, 'decision', systemInstructions);
      } catch (error) {
        // The Groq model occasionally returns HTTP 200 with no final content.
        // No decision or external action exists yet, so one model-only retry is
        // safe. Do not retry malformed or unauthorised proposals.
        if (!(error instanceof LLMServiceError) || error.code !== 'EMPTY_RESPONSE' ||
            this.config.provider !== 'groq') throw error;
        console.warn('llm_empty_decision_retry', { provider: this.config.provider });
        response = await this.callLLM(prompt, 'decision', systemInstructions);
      }

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
  async generateUIContent(prompt: string | Record<string, unknown>, userLanguage: string = 'en'): Promise<string> {
    try {
      // Build the UI content generation prompt
      const response = await this.callLLM(
        JSON.stringify({ task: prompt, targetLanguage: userLanguage }), 'response'
      );

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

  /** Structured extraction has its own instructions, separate from response wording. */
  async extractHotelCriteria(data: {
    context?: ContextPackage;
    userMessage: string;
    referenceDate: string;
    alreadyExtracted: Record<string, unknown>;
  }): Promise<string> {
    return this.callLLM(JSON.stringify(data), 'hotel-extraction');
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Calls the LLM API (provider-specific implementation)
   * 
   * Compatible providers share the same trusted-system / untrusted-data boundary.
   */
  private async callLLM(prompt: string, mode: LLMPurpose, systemInstructions?: string): Promise<string> {
    if (this.config.provider === 'mock') {
      return this.getMockResponse(prompt, mode);
    }

    if (this.config.provider === 'openai') {
      return this.callOpenAICompatible(prompt, mode, systemInstructions);
    }

    if (this.config.provider === 'openrouter' || this.config.provider === 'groq') {
      return this.callOpenAICompatible(prompt, mode, systemInstructions);
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
  private async callOpenAICompatible(prompt: string, mode: LLMPurpose, systemInstructions?: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    // The configured GPT-OSS model intermittently fails Groq's JSON validators,
    // even for a one-string strict envelope. Disallow tools, request the JSON
    // decision in the existing prompt, then validate it with YANA's Zod contract.
    // Other Groq models retain JSON Object Mode.
    const groqJsonDecision = this.config.provider === 'groq' && mode === 'decision';
    const groqPlainDecision = groqJsonDecision &&
      ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'].includes(this.config.model);
    const nativeDecisionTool = mode === 'decision' &&
      !groqJsonDecision &&
      (this.config.provider !== 'openrouter' || process.env.LLM_OPENROUTER_TOOL_CALLING_ENABLED === 'true');
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: mode === 'response' ? 0.4 : groqPlainDecision ? 0.5 : 0.1,
          ...(groqPlainDecision ? { reasoning_effort: 'low', include_reasoning: false,
            max_completion_tokens: 2048 } : {}),
          ...(nativeDecisionTool ? { tools: [DECISION_TOOL], tool_choice: 'auto' } : {}),
          ...(groqPlainDecision ? { tool_choice: 'none' } :
            groqJsonDecision ? { tool_choice: 'none', response_format: { type: 'json_object' } } : {}),
          messages: [
            {
              role: 'system',
              content: systemInstructions ?? this.prompts.buildSystemPrompt(mode),
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });
    } catch (error) {
      const timeout = error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError' || /timeout/i.test(error.message));
      throw new LLMServiceError(
        timeout ? 'Model provider timed out' : 'Model provider unavailable',
        timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        true
      );
    }

    if (!response.ok) {
      const body = await response.text();
      let providerError: { type?: unknown; code?: unknown; message?: unknown } = {};
      try { providerError = (JSON.parse(body) as { error?: typeof providerError }).error ?? {}; } catch { /* Ignore unsafe provider bodies. */ }
      const type = safeProviderCode(providerError.type);
      const code = safeProviderCode(providerError.code);
      const safeDetail = safeProviderDetail(providerError.message);
      const details = { status: response.status, type, code, safeDetail };
      console.error('llm_provider_request_failed', { provider: this.config.provider, ...details });
      const category = response.status === 429 ? 'PROVIDER_RATE_LIMITED'
        : response.status >= 500 ? 'PROVIDER_UNAVAILABLE'
        : response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH_FAILED'
        : code === 'tool_use_failed' ? 'PROVIDER_TOOL_USE_FAILED' : 'PROVIDER_BAD_REQUEST';
      throw new LLMServiceError(
        `Model provider request failed with ${response.status}`,
        category,
        response.status >= 500 || response.status === 429,
        details
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null;
        tool_calls?: Array<{ type?: string; function?: { name?: string; arguments?: string } }> } }>;
    };
    const message = data.choices?.[0]?.message;
    const calls = message?.tool_calls;
    if (calls?.length) {
      if (groqJsonDecision || mode !== 'decision' || calls.length !== 1 || calls[0].type !== 'function' ||
          calls[0].function?.name !== DECISION_TOOL_NAME || !calls[0].function.arguments) {
        throw new LLMServiceError('Model proposed an unsupported tool call', 'INVALID_TOOL_CALL', false);
      }
      return calls[0].function.arguments;
    }
    const content = message?.content;

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
      const output: unknown = JSON.parse(extractJsonResponse(response));
      // Some providers serialize absent optional properties as null. Treat
      // those as omitted while keeping action and schema validation strict.
      if (output && typeof output === 'object' && !Array.isArray(output)) {
        const candidate = output as Record<string, unknown>;
        for (const key of ['clarificationQuestion', 'recommendedSchema', 'uiRecommendation', 'proposedAction', 'reasoning', 'intentConfidence']) {
          if (candidate[key] === null) delete candidate[key];
        }
        // intentConfidence duplicates confidence in the decision contract.
        // Ignore a disagreement rather than discarding an otherwise validated
        // conversational decision; the backend uses confidence as authority.
        if (typeof candidate.intentConfidence === 'number' &&
            typeof candidate.confidence === 'number' &&
            Number.isFinite(candidate.intentConfidence) &&
            Math.abs(candidate.intentConfidence - candidate.confidence) > 0.001) {
          delete candidate.intentConfidence;
        }
        // A clarification is not an action proposal. Discard any stray action
        // payload rather than letting its untrusted arguments affect routing.
        if (candidate.suggestedAction === 'clarify' || candidate.clarificationRequired === true) {
          delete candidate.proposedAction;
        }
        if (candidate.ambiguity && typeof candidate.ambiguity === 'object' && !Array.isArray(candidate.ambiguity)) {
          const ambiguity = candidate.ambiguity as Record<string, unknown>;
          if (ambiguity.isAmbiguous === false && ambiguity.alternatives === undefined) ambiguity.alternatives = [];
          if (ambiguity.reason === null) delete ambiguity.reason;
        }
        // Groq occasionally repeats a candidate field inside the advisory
        // action arguments. Only schemaId is executable. Ignore a duplicate
        // when the identical value is already in parameters; reject anything
        // else through the strict decision contract below.
        if (candidate.proposedAction && typeof candidate.proposedAction === 'object' &&
            !Array.isArray(candidate.proposedAction)) {
          const proposed = candidate.proposedAction as Record<string, unknown>;
          if (proposed.arguments && typeof proposed.arguments === 'object' && !Array.isArray(proposed.arguments)) {
            const args = proposed.arguments as Record<string, unknown>;
            const params = candidate.parameters && typeof candidate.parameters === 'object' &&
              !Array.isArray(candidate.parameters) ? candidate.parameters as Record<string, unknown> : {};
            for (const [key, value] of Object.entries(args)) {
              if (key !== 'schemaId' && Object.hasOwn(params, key) &&
                  JSON.stringify(params[key]) === JSON.stringify(value)) delete args[key];
            }
          }
        }
      }
      const parsed = decisionOutputSchema.parse(output);

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

      if (!parsed.suggestedAction || !['none', 'ask_missing', 'execute_tool', 'clarify', 'handoff'].includes(parsed.suggestedAction)) {
        throw new Error('Missing or invalid suggestedAction field');
      }

      if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
        throw new Error('Missing or invalid confidence field');
      }

      return {
        contractVersion: parsed.contractVersion,
        responseText: parsed.responseText,
        intent: parsed.intent,
        intentConfidence: parsed.intentConfidence ?? parsed.confidence,
        ambiguity: parsed.ambiguity,
        clarificationRequired: parsed.clarificationRequired,
        clarificationQuestion: parsed.clarificationQuestion,
        parameters: parsed.parameters,
        fieldUpdates: parsed.fieldUpdates,
        memoryCandidates: parsed.memoryCandidates,
        missingFields: parsed.missingFields,
        taskTransition: parsed.taskTransition,
        recommendedSchema: parsed.recommendedSchema,
        uiRecommendation: parsed.uiRecommendation,
        proposedAction: parsed.proposedAction,
        unresolvedQuestions: parsed.unresolvedQuestions,
        suggestedAction: parsed.suggestedAction,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        console.error('llm_decision_contract_rejected', {
          provider: this.config.provider,
          issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
        });
      }
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
      intent: decision.intent,
      suggestedAction: decision.suggestedAction,
      confidence: decision.confidence,
      missingFieldsCount: decision.missingFields.length,
    });
  }

  /**
   * Returns mock responses for testing
   */
  private getMockResponse(prompt: string, mode: LLMPurpose): string {
    if (mode === 'hotel-extraction') return '{}';
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

function safeProviderCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : undefined;
}

function safeProviderDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/attempted to call tool ['"]json['"]/i.test(value)) return 'undeclared JSON tool call';
  if (/failed to validate json/i.test(value)) return 'JSON validation failed';
  if (/rate limit/i.test(value)) return 'rate limit exceeded';
  return undefined;
}

function extractJsonResponse(response: string): string {
  const trimmed = response.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fencedJson) {
    return fencedJson[1].trim();
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
