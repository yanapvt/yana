/**
 * LLM Service
 *
 * Wraps LLM interactions with two distinct modes:
 * 1. Decision mode: produces structured output for the Orchestrator to validate and act upon
 * 2. UI-support mode: generates user-facing content like prompts and messages
 *
 * Optimisations to minimise LLM calls:
 * - Single-call mode: decide() + reply generation merged into one API call
 * - Short-circuit rules: greetings, confirmations, farewells handled without LLM
 * - Response cache: identical intent+params served from Redis (TTL 10 min)
 * - Trimmed history: only last 6 turns sent to keep prompts lean
 *
 * The LLM does not have direct execution capabilities - it only provides recommendations
 * that the Orchestrator validates before taking action.
 *
 * Validates Requirements: 4.1, 4.2, 4.3
 */

import { LLMDecisionOutput } from '../types/core.js';
import { env } from '../config/environment.js';
import { logger } from '../config/logger.js';
import { getStateStore } from './StateStore.js';

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
 * Combined decision + reply output from a single LLM call
 */
export interface DecisionWithReply {
  decision: LLMDecisionOutput;
  replyText: string;
  /** true = served from cache, no LLM call made */
  fromCache: boolean;
  /** true = handled by short-circuit rules, no LLM call made */
  shortCircuited: boolean;
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
// System Prompt
// ============================================================================

const CONCIERGE_SYSTEM_PROMPT = `You are Yana, a friendly and knowledgeable tourist concierge for Sri Lanka.
You help visitors with:
- Places to visit (beaches, temples, national parks, cities, hidden gems)
- Food and restaurants (local cuisine, street food, dietary needs)
- Transport (tuk-tuks, trains, buses, taxis, car hire)
- Culture and customs (etiquette, festivals, dress codes, tipping)
- Practical tips (weather, safety, currency, SIM cards, opening hours)

Tone: warm, helpful, and conversational — like a knowledgeable local friend.
Format: keep replies short and suitable for WhatsApp (2–4 sentences max unless a list is genuinely needed).
Language: match the user's language if possible, default to English.
Do NOT make up specific prices, schedules, or contact details — say you're not sure and suggest where to check.`;

// ============================================================================
// Short-circuit rules — handled without any LLM call
// ============================================================================

interface ShortCircuitRule {
  pattern: RegExp;
  intent: string;
  reply: string | ((match: RegExpMatchArray) => string);
}

const SHORT_CIRCUIT_RULES: ShortCircuitRule[] = [
  {
    pattern: /^(hi|hello|hey|hiya|howdy|good\s*(morning|afternoon|evening|day))[!.,\s]*$/i,
    intent: 'greeting',
    reply: "Hello! 👋 I'm Yana, your Sri Lanka concierge. Ask me about places to visit, food, transport, or anything else for your trip! 🌴",
  },
  {
    pattern: /^(thanks?|thank\s*you|thx|ty|cheers|great|awesome|perfect|wonderful)[!.,\s]*$/i,
    intent: 'acknowledgement',
    reply: "You're welcome! 😊 Anything else I can help you with?",
  },
  {
    pattern: /^(yes|yeah|yep|yup|sure|ok|okay|alright|sounds good|go ahead)[!.,\s]*$/i,
    intent: 'confirmation',
    reply: "Got it! Let me know what you'd like to do next. 😊",
  },
  {
    pattern: /^(no|nope|nah|not now|cancel|stop)[!.,\s]*$/i,
    intent: 'cancellation',
    reply: "No problem! Let me know whenever you need help. 😊",
  },
  {
    pattern: /^(bye|goodbye|see\s*you|cya|take\s*care|good\s*night)[!.,\s]*$/i,
    intent: 'farewell',
    reply: "Goodbye! 🌴 Have a wonderful time in Sri Lanka. Feel free to message me anytime!",
  },
  {
    pattern: /^(help|\?|what can you do|what do you do|how does this work)[?!.,\s]*$/i,
    intent: 'help',
    reply: "I can help you with:\n🏖 *Places* — beaches, temples, parks\n🍛 *Food* — local eats, restaurants\n🚌 *Transport* — tuk-tuks, trains, taxis\n🎭 *Culture* — customs, festivals, tips\n\nJust ask me anything!",
  },
];

// ============================================================================
// LLM Service
// ============================================================================

export class LLMService {
  private config: LLMConfig;
  /** How many recent turns to include in the prompt (each turn = 1 user + 1 assistant message) */
  private static readonly HISTORY_TURNS = 3;

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
      throw new LLMServiceError('LLM API key is required', 'MISSING_API_KEY', false);
    }

    logger.info('LLMService', 'LLM Service initialized successfully');
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Primary entry point: decide intent AND generate reply in a single LLM call.
   *
   * Optimisation order:
   *   1. Short-circuit check  → 0 LLM calls
   *   2. Redis cache check    → 0 LLM calls
   *   3. Single combined call → 1 LLM call  (was previously 2)
   *
   * Validates: Requirements 4.1, 4.2, 4.3
   */
  async decideAndReply(contextPackage: ContextPackage): Promise<DecisionWithReply> {
    const userText = contextPackage.userMessage.trim();

    // ── Optimisation 1: short-circuit for simple inputs ──────────────────────
    const shortCircuit = this.tryShortCircuit(userText);
    if (shortCircuit) {
      logger.debug('LLMService', 'Short-circuit matched — no LLM call', {
        intent: shortCircuit.intent,
        pattern: userText.substring(0, 30),
      });
      return {
        decision: this.buildMinimalDecision(shortCircuit.intent),
        replyText: shortCircuit.reply,
        fromCache: false,
        shortCircuited: true,
      };
    }

    // ── Optimisation 2: Redis response cache ──────────────────────────────────
    const cacheKey = this.buildCacheKey(contextPackage);
    const cached = await this.getCachedResponse(cacheKey);
    if (cached) {
      logger.debug('LLMService', 'Cache hit — no LLM call', { cacheKey });
      return { ...cached, fromCache: true, shortCircuited: false };
    }

    // ── Optimisation 3: single combined LLM call ──────────────────────────────
    logger.debug('LLMService', 'Making combined decide+reply LLM call', {
      userMessage: userText.substring(0, 50),
      historyLength: contextPackage.conversationHistory?.length ?? 0,
    });

    const trimmedContext = this.trimHistory(contextPackage);
    const prompt = this.buildCombinedPrompt(trimmedContext);
    const response = await this.callLLM(prompt, 'combined');
    const { decision, replyText } = this.parseCombinedOutput(response);

    logger.info('LLMService', 'Combined LLM call succeeded', {
      intent: decision.intent,
      suggestedAction: decision.suggestedAction,
      confidence: decision.confidence,
      replyLength: replyText.length,
    });

    const result: DecisionWithReply = { decision, replyText, fromCache: false, shortCircuited: false };

    // Cache the result (only for general/informational intents — not transactional ones)
    if (this.isCacheable(decision)) {
      await this.cacheResponse(cacheKey, result);
    }

    return result;
  }

  /**
   * Legacy decide() — kept for compatibility but now delegates to decideAndReply().
   * Callers that only need the decision can still use this.
   */
  async decide(contextPackage: ContextPackage): Promise<LLMDecisionOutput> {
    const result = await this.decideAndReply(contextPackage);
    return result.decision;
  }

  /**
   * generateUIContent() — kept for cases where a standalone reply is needed
   * (e.g. tool result formatting). Uses a lightweight single call.
   */
  async generateUIContent(prompt: string, userLanguage: string = 'en'): Promise<string> {
    logger.debug('LLMService', 'Generating UI content', { promptLength: prompt.length, userLanguage });

    try {
      const fullPrompt = this.buildUIContentPrompt(prompt, userLanguage);
      const response = await this.callLLM(fullPrompt, 'ui-support');
      const content = response.trim();

      if (!content) {
        throw new LLMServiceError('LLM returned empty UI content', 'EMPTY_RESPONSE', true);
      }

      logger.debug('LLMService', 'UI content generated', { contentLength: content.length });
      return content;
    } catch (error) {
      if (error instanceof LLMServiceError) throw error;
      throw new LLMServiceError(
        `Failed to generate UI content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UI_GENERATION_FAILED',
        true
      );
    }
  }

  // ==========================================================================
  // Short-circuit logic
  // ==========================================================================

  private tryShortCircuit(text: string): { intent: string; reply: string } | null {
    for (const rule of SHORT_CIRCUIT_RULES) {
      const match = text.match(rule.pattern);
      if (match) {
        const reply = typeof rule.reply === 'function' ? rule.reply(match) : rule.reply;
        return { intent: rule.intent, reply };
      }
    }
    return null;
  }

  private buildMinimalDecision(intent: string): LLMDecisionOutput {
    return {
      intent,
      parameters: {},
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 1.0,
    };
  }

  // ==========================================================================
  // Response cache (Redis)
  // ==========================================================================

  /**
   * Cache key: hash of (intent-relevant words + session state).
   * Excludes filler words so "best beach near Colombo?" and
   * "what's the best beach near Colombo" hit the same cache entry.
   */
  private buildCacheKey(ctx: ContextPackage): string {
    const normalized = ctx.userMessage
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\b(what|is|the|a|an|are|can|you|i|me|my|please|tell|about|some|any)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const stateKey = ctx.sessionState?.currentIntent ?? '';
    return `llm:reply:${Buffer.from(normalized + stateKey).toString('base64').substring(0, 40)}`;
  }

  private async getCachedResponse(key: string): Promise<Omit<DecisionWithReply, 'fromCache' | 'shortCircuited'> | null> {
    try {
      const store = getStateStore();
      if (!store.isConnected()) return null;
      const raw = await store.getClient().get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async cacheResponse(key: string, result: DecisionWithReply): Promise<void> {
    try {
      const store = getStateStore();
      if (!store.isConnected()) return;
      const ttl = 600; // 10 minutes
      await store.getClient().setEx(key, ttl, JSON.stringify({
        decision: result.decision,
        replyText: result.replyText,
      }));
      logger.debug('LLMService', 'Response cached', { key, ttl });
    } catch {
      // Cache write failure is non-fatal
    }
  }

  /**
   * Only cache informational/general intents.
   * Never cache transactional intents (booking, payment, personal data).
   */
  private isCacheable(decision: LLMDecisionOutput): boolean {
    const nonCacheable = ['book_hotel', 'make_payment', 'cancel_booking', 'handoff', 'clarify'];
    return !nonCacheable.includes(decision.intent) && decision.suggestedAction !== 'execute_tool';
  }

  // ==========================================================================
  // History trimming
  // ==========================================================================

  /**
   * Trim conversation history to the last N turns to keep prompts lean.
   * Each "turn" = 1 user message + 1 assistant message = 2 entries.
   */
  private trimHistory(ctx: ContextPackage): ContextPackage {
    if (!ctx.conversationHistory || ctx.conversationHistory.length === 0) return ctx;
    const maxEntries = LLMService.HISTORY_TURNS * 2;
    return {
      ...ctx,
      conversationHistory: ctx.conversationHistory.slice(-maxEntries),
    };
  }

  // ==========================================================================
  // Combined prompt builder
  // ==========================================================================

  /**
   * Builds a single prompt that asks the LLM to return BOTH the structured
   * decision AND the user-facing reply in one JSON response.
   * This replaces the previous two-call pattern (decide + generateUIContent).
   */
  private buildCombinedPrompt(ctx: ContextPackage): string {
    const parts: string[] = [
      'Analyze the user message and respond with a single JSON object containing:',
      '- intent: detected user intent (string)',
      '- parameters: extracted parameters (object)',
      '- missingFields: required fields not yet provided (array of strings)',
      '- suggestedAction: one of "ask_missing", "execute_tool", "clarify", "handoff"',
      '- confidence: score 0–1 (number)',
      '- reply: your actual WhatsApp reply to the user (string, 2–4 sentences max)',
      '',
      'User message:',
      ctx.userMessage,
    ];

    if (ctx.conversationHistory && ctx.conversationHistory.length > 0) {
      parts.push('', 'Recent conversation:');
      ctx.conversationHistory.forEach((msg) => {
        parts.push(`${msg.role}: ${msg.content}`);
      });
    }

    if (ctx.sessionState) {
      const s = ctx.sessionState;
      const stateLines: string[] = [];
      if (s.currentIntent) stateLines.push(`intent: ${s.currentIntent}`);
      if (s.collectedFields && Object.keys(s.collectedFields).length > 0) {
        stateLines.push(`collected: ${JSON.stringify(s.collectedFields)}`);
      }
      if (s.missingFields && s.missingFields.length > 0) {
        stateLines.push(`still needed: ${s.missingFields.join(', ')}`);
      }
      if (stateLines.length > 0) {
        parts.push('', `Session: ${stateLines.join(' | ')}`);
      }
    }

    parts.push('', 'Respond ONLY with valid JSON, no markdown, no extra text.');
    return parts.join('\n');
  }

  private buildUIContentPrompt(prompt: string, userLanguage: string): string {
    return [
      CONCIERGE_SYSTEM_PROMPT,
      `Target language: ${userLanguage}`,
      '',
      `Task: ${prompt}`,
      '',
      'Reply directly to the user. Keep it short — 2 to 4 sentences max unless a list genuinely helps.',
    ].join('\n');
  }

  // ==========================================================================
  // LLM API calls
  // ==========================================================================

  private async callLLM(prompt: string, mode: 'combined' | 'ui-support' | 'decision'): Promise<string> {
    logger.debug('LLMService', 'Calling LLM API', {
      provider: this.config.provider,
      model: this.config.model,
      mode,
      promptLength: prompt.length,
    });

    if (this.config.provider === 'mock') {
      return this.getMockResponse(prompt, mode);
    }

    if (this.config.provider === 'groq' || this.config.provider === 'openai') {
      return this.callOpenAICompatible(prompt, mode);
    }

    throw new LLMServiceError(
      `LLM provider '${this.config.provider}' not yet implemented`,
      'PROVIDER_NOT_IMPLEMENTED',
      false
    );
  }

  private async callOpenAICompatible(prompt: string, mode: 'combined' | 'ui-support' | 'decision'): Promise<string> {
    const baseUrl = this.config.provider === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';

    const systemPrompt = mode === 'combined'
      ? `${CONCIERGE_SYSTEM_PROMPT}\n\nAlways respond with valid JSON only — no markdown, no extra text.`
      : mode === 'decision'
        ? `${CONCIERGE_SYSTEM_PROMPT}\n\nYou are in INTENT DETECTION mode. Always respond with valid JSON only.`
        : CONCIERGE_SYSTEM_PROMPT;

    const maxTokens = mode === 'ui-support' ? 256 : 512;
    const temperature = mode === 'combined' || mode === 'decision' ? 0.2 : 0.7;

    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
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
        response.status >= 500
      );
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMServiceError('LLM returned empty response', 'EMPTY_RESPONSE', true);
    }

    return content.trim();
  }

  // ==========================================================================
  // Response parsers
  // ==========================================================================

  private parseCombinedOutput(response: string): { decision: LLMDecisionOutput; replyText: string } {
    // Strip markdown code fences if the model wraps in ```json ... ```
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);

      if (!parsed.intent || typeof parsed.intent !== 'string') throw new Error('Missing intent');
      if (!parsed.parameters || typeof parsed.parameters !== 'object') throw new Error('Missing parameters');
      if (!Array.isArray(parsed.missingFields)) throw new Error('Missing missingFields');
      if (!['ask_missing', 'execute_tool', 'clarify', 'handoff'].includes(parsed.suggestedAction)) throw new Error('Invalid suggestedAction');
      if (typeof parsed.confidence !== 'number') throw new Error('Missing confidence');
      if (!parsed.reply || typeof parsed.reply !== 'string') throw new Error('Missing reply');

      return {
        decision: {
          intent: parsed.intent,
          parameters: parsed.parameters,
          missingFields: parsed.missingFields,
          suggestedAction: parsed.suggestedAction,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
        },
        replyText: parsed.reply.trim(),
      };
    } catch (error) {
      logger.error('LLMService', 'Failed to parse combined LLM output', {
        error: error instanceof Error ? error.message : String(error),
        response: response.substring(0, 200),
      });
      throw new LLMServiceError(
        `Failed to parse combined LLM output: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PARSE_ERROR',
        false
      );
    }
  }

  private parseDecisionOutput(response: string): LLMDecisionOutput {
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed.intent) throw new Error('Missing intent');
      if (!parsed.parameters) throw new Error('Missing parameters');
      if (!Array.isArray(parsed.missingFields)) throw new Error('Missing missingFields');
      if (!['ask_missing', 'execute_tool', 'clarify', 'handoff'].includes(parsed.suggestedAction)) throw new Error('Invalid suggestedAction');
      if (typeof parsed.confidence !== 'number') throw new Error('Missing confidence');
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
        `Failed to parse decision output: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PARSE_ERROR',
        false
      );
    }
  }

  // ==========================================================================
  // Mock responses
  // ==========================================================================

  private getMockResponse(prompt: string, mode: string): string {
    if (mode === 'combined') {
      return JSON.stringify({
        intent: 'explore_places',
        parameters: {},
        missingFields: [],
        suggestedAction: 'clarify',
        confidence: 0.9,
        reply: "Welcome to Sri Lanka! 🌴 I'm Yana, your local concierge. Ask me about places to visit, food, transport, or anything else for your trip!",
      });
    }
    if (mode === 'decision') {
      return JSON.stringify({
        intent: 'search_hotels',
        parameters: {},
        missingFields: ['location', 'checkin_date'],
        suggestedAction: 'ask_missing',
        confidence: 0.9,
      });
    }
    return "Welcome to Sri Lanka! 🌴 I'm Yana, your local concierge. Ask me about places to visit, food, transport, or anything else for your trip!";
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let llmServiceInstance: LLMService | null = null;

export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    logger.debug('LLMService', 'Creating singleton LLMService instance');
    llmServiceInstance = new LLMService();
  }
  return llmServiceInstance;
}

export function initLLMService(config?: Partial<LLMConfig>): LLMService {
  logger.info('LLMService', 'Initializing LLMService with custom configuration');
  llmServiceInstance = new LLMService(config);
  return llmServiceInstance;
}

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
// System Prompt
// ============================================================================

/**
 * Core persona for the concierge assistant.
 * Injected into both decision and UI-support modes so the LLM
 * understands its role when classifying intents AND when replying.
 */
const CONCIERGE_SYSTEM_PROMPT = `You are Yana, a friendly and knowledgeable tourist concierge for Sri Lanka. 
You help visitors with:
- Places to visit (beaches, temples, national parks, cities, hidden gems)
- Food and restaurants (local cuisine, street food, dietary needs)
- Transport (tuk-tuks, trains, buses, taxis, car hire)
- Culture and customs (etiquette, festivals, dress codes, tipping)
- Practical tips (weather, safety, currency, SIM cards, opening hours)

Tone: warm, helpful, and conversational — like a knowledgeable local friend.
Format: keep replies short and suitable for WhatsApp (2–4 sentences max unless a list is genuinely needed).
Language: match the user's language if possible, default to English.
Do NOT make up specific prices, schedules, or contact details — say you're not sure and suggest where to check.`;

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
      // Persona context so intent classification is tourism-aware
      CONCIERGE_SYSTEM_PROMPT,
      '',
      '---',
      'Your current task is INTENT DETECTION. Analyze the user message below and return a structured JSON decision.',
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
   * Builds the prompt for UI content generation (the actual user-facing reply)
   */
  private buildUIContentPrompt(prompt: string, userLanguage: string): string {
    return [
      CONCIERGE_SYSTEM_PROMPT,
      `Target language: ${userLanguage}`,
      '',
      `Task: ${prompt}`,
      '',
      'Reply directly to the user. Do not include meta-commentary or explain what you are doing.',
      'Keep it short — 2 to 4 sentences max unless a list genuinely helps.',
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
      ? `${CONCIERGE_SYSTEM_PROMPT}\n\nYou are now in INTENT DETECTION mode. Always respond with valid JSON only, no markdown, no extra text.`
      : CONCIERGE_SYSTEM_PROMPT;

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
      return 'Welcome to Sri Lanka! 🌴 I\'m Yana, your local concierge. Ask me about places to visit, food, transport, or anything else you need for your trip!';
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
