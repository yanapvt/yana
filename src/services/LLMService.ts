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
import { getMenuService } from './MenuService.js';

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
  /** true = handled by short-circuit rules or menu, no LLM call made */
  shortCircuited: boolean;
  /** Set when a main menu item with sub-items was selected — store in session */
  activeSubMenu?: string;
  /** Set when multiple intents detected — store in session for sequential handling */
  pendingIntents?: string[];
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
Do NOT make up specific prices, schedules, or contact details — say you're not sure and suggest where to check.

CRITICAL BEHAVIOUR RULES:
- When a user asks for recommendations (hotels, restaurants, places, etc.) GIVE THE ANSWER IMMEDIATELY.
  Do NOT ask clarifying questions first. Use whatever information they provided and give a direct, helpful answer.
- If they ask for "top 3 hotels in Colombo" — list 3 hotels. Do not ask what type, what area, what budget.
- Only ask a follow-up question if the request is genuinely impossible to answer without it (e.g. "book a hotel" with no location at all).
- Never ask more than ONE follow-up question per turn.
- If the user has already answered a question in the conversation history, do not ask it again.`;

// ============================================================================
// Short-circuit rules — handled without any LLM call
// ============================================================================

interface ShortCircuitRule {
  pattern: RegExp;
  intent: string;
  /** null = use the main menu reply */
  reply: string | null;
}

const SHORT_CIRCUIT_RULES: ShortCircuitRule[] = [
  {
    pattern: /^(hi|hello|hey|hiya|howdy|good\s*(morning|afternoon|evening|day)|start|menu)[!.,\s]*$/i,
    intent: 'greeting',
    reply: null, // replaced with main menu at runtime
  },
  {
    pattern: /^(thanks?|thank\s*you|thx|ty|cheers)[!.,\s]*$/i,
    intent: 'acknowledgement',
    reply: "You're welcome! 😊 Need anything else? Reply *menu* to see all options.",
  },
  {
    pattern: /^(no|nope|nah|not now|cancel|stop)[!.,\s]*$/i,
    intent: 'cancellation',
    reply: "No problem! Reply *menu* anytime to start over. 😊",
  },
  {
    pattern: /^(bye|goodbye|see\s*you|cya|take\s*care|good\s*night)[!.,\s]*$/i,
    intent: 'farewell',
    reply: "Goodbye! 🌴 Have a wonderful time in Sri Lanka. Message me anytime!",
  },
  {
    pattern: /^(help|\?|what can you do|what do you do|how does this work|menu|options)[?!.,\s]*$/i,
    intent: 'help',
    reply: null, // replaced with main menu at runtime
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
   *   1. Menu selection check → 0 LLM calls (user tapped a numbered option)
   *   2. Short-circuit check  → 0 LLM calls (greeting, thanks, bye, etc.)
   *   3. Multi-intent detect  → 0 LLM calls (user mentioned 2+ services)
   *   4. Redis cache check    → 0 LLM calls
   *   5. Single combined call → 1 LLM call  (was previously 2)
   *
   * Validates: Requirements 4.1, 4.2, 4.3
   */
  async decideAndReply(
    contextPackage: ContextPackage,
    activeSubMenu?: string
  ): Promise<DecisionWithReply> {
    const userText = contextPackage.userMessage.trim();
    const menu = getMenuService();

    // ── Optimisation 1: menu selection (number or item name) ─────────────────
    const menuSelection = menu.resolveMenuSelection(userText, activeSubMenu);
    if (menuSelection) {
      logger.debug('LLMService', 'Menu selection matched — no LLM call', {
        itemId: menuSelection.itemId,
        intent: menuSelection.intent,
      });

      const selectedItem = menu.getItemById(menuSelection.itemId);
      let replyText: string;

      if (!menuSelection.isSub && selectedItem?.subItems && selectedItem.subItems.length > 0) {
        // Show sub-menu for this item
        replyText = menu.renderSubMenu(selectedItem);
      } else {
        replyText = `Got it! Let me help you with *${menuSelection.label}*. What would you like to know? 😊`;
      }

      return {
        decision: this.buildMinimalDecision(menuSelection.intent),
        replyText,
        fromCache: false,
        shortCircuited: true,
        activeSubMenu: menuSelection.isSub ? undefined : menuSelection.itemId,
      };
    }

    // ── Optimisation 2: short-circuit for simple inputs ──────────────────────
    // Only fire when there is NO active conversation — if the user has history,
    // short words like "yes", "ok", "great" are continuations, not commands.
    const hasActiveConversation = (contextPackage.conversationHistory?.length ?? 0) > 0
      || !!contextPackage.sessionState?.currentIntent;

    if (!hasActiveConversation) {
      const shortCircuit = this.tryShortCircuit(userText);
      if (shortCircuit) {
        logger.debug('LLMService', 'Short-circuit matched — no LLM call', {
          intent: shortCircuit.intent,
        });
        return {
          decision: this.buildMinimalDecision(shortCircuit.intent),
          replyText: shortCircuit.reply,
          fromCache: false,
          shortCircuited: true,
        };
      }
    } else {
      // Even with active conversation, still short-circuit pure greetings/farewells
      const shortCircuit = this.tryShortCircuit(userText);
      if (shortCircuit && ['greeting', 'farewell', 'help'].includes(shortCircuit.intent)) {
        logger.debug('LLMService', 'Short-circuit matched (greeting/farewell) — no LLM call', {
          intent: shortCircuit.intent,
        });
        return {
          decision: this.buildMinimalDecision(shortCircuit.intent),
          replyText: shortCircuit.reply,
          fromCache: false,
          shortCircuited: true,
        };
      }
    }

    // ── Optimisation 3: multi-intent detection ────────────────────────────────
    const multiIntents = menu.detectMultipleIntents(userText);
    if (multiIntents.length >= 2) {
      logger.debug('LLMService', 'Multi-intent detected — no LLM call', {
        intents: multiIntents.map((i) => i.intent),
      });

      const intentList = multiIntents
        .map((item, idx) => `*${idx + 1}.* ${item.emoji} ${item.label}`)
        .join('\n');

      const replyText = [
        `Looks like you need help with a few things! Let's tackle them one by one 😊\n`,
        intentList,
        `\nWhich would you like to start with? Reply with a number.`,
      ].join('\n');

      return {
        decision: this.buildMinimalDecision('multi_intent'),
        replyText,
        fromCache: false,
        shortCircuited: true,
        pendingIntents: multiIntents.map((i) => i.intent),
      };
    }

    // ── Optimisation 4: Redis response cache ──────────────────────────────────
    const cacheKey = this.buildCacheKey(contextPackage);
    const cached = await this.getCachedResponse(cacheKey);
    if (cached) {
      logger.debug('LLMService', 'Cache hit — no LLM call', { cacheKey });
      return { ...cached, fromCache: true, shortCircuited: false };
    }

    // ── Optimisation 5: single combined LLM call ──────────────────────────────
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
    const menu = getMenuService();
    for (const rule of SHORT_CIRCUIT_RULES) {
      if (rule.pattern.test(text)) {
        // null reply means show the main menu
        const reply = rule.reply ?? menu.renderMainMenu();
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
      'IMPORTANT: For recommendation requests (hotels, restaurants, places, transport),',
      'set suggestedAction to "clarify" and put the actual recommendations in "reply".',
      'Do NOT set suggestedAction to "ask_missing" unless you truly cannot answer at all.',
      'If the user asked for top hotels/restaurants/places — list them directly in "reply".',
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

