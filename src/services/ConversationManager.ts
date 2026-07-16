import type { LLMDecisionOutput } from '../types/core.js';
import { getLLMService } from './LLMService.js';

export interface ConversationManagerUserContext {
  profileName?: string;
  country?: string;
  countryCode?: string;
}

export interface ConversationManagerInput {
  userInput?: string;
  profile?: ConversationManagerUserContext | Record<string, unknown> | null;
  memory?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  interpretation?: {
    intent?: string;
    entities?: Record<string, unknown>;
    confidence?: number;
  };
  intent?: string;
  entities?: Record<string, unknown>;
  decision?:
    | string
    | Partial<LLMDecisionOutput>
    | {
        action?: string;
        type?: string;
        payload?: Record<string, unknown>;
        confidence?: number;
        source?: string;
      }
    | null;
  missingFields?: string[];
  currentFlow?: string;
  availableServices?: string[];
  constraints?: ConversationManagerConstraints;
}

export interface ConversationManagerOutput {
  text: string;
}

export interface ConversationManagerConstraints {
  doNotExposeInternalNames?: boolean;
  askOnlyUsefulNextQuestions?: boolean;
  maxQuestions?: number;
  tone?: string;
}

interface ConversationManagerLLM {
  generateText(prompt: string): Promise<string>;
}

const DEFAULT_AVAILABLE_SERVICES = [
  'hotels',
  'restaurants',
  'transport',
  'excursions',
  'itinerary planning',
  'local recommendations',
  'shopping',
  'adventure',
  'wellness',
];

const DEFAULT_CONSTRAINTS: Required<ConversationManagerConstraints> = {
  doNotExposeInternalNames: true,
  askOnlyUsefulNextQuestions: true,
  maxQuestions: 3,
  tone: 'warm personal travel concierge',
};

export class ConversationManager {
  constructor(private readonly llm: ConversationManagerLLM = defaultConversationLLM) {}

  async createMessage(input: ConversationManagerInput): Promise<ConversationManagerOutput> {
    const fallbackText = this.createFallbackMessage(input).text;

    try {
      const prompt = buildConversationPrompt(input, fallbackText);
      const llmText = await this.llm.generateText(prompt);
      const sanitizedText = sanitizeUserFacingText(llmText);

      if (!sanitizedText || containsBlockedInternalTerms(sanitizedText)) {
        return { text: sanitizeUserFacingText(fallbackText) };
      }

      return { text: sanitizedText };
    } catch (error) {
      console.warn('[ConversationManager] LLM response generation failed, using fallback:', error);
      return { text: sanitizeUserFacingText(fallbackText) };
    }
  }

  createFallbackMessage(input: ConversationManagerInput): ConversationManagerOutput {
    const intent =
      input.interpretation?.intent ?? input.intent ?? getDecisionIntent(input.decision);
    const missingFields = input.missingFields ?? getDecisionMissingFields(input.decision);
    const action = getDecisionAction(input.decision);
    const currentFlow = input.currentFlow ?? getSessionFlow(input.session);
    const profileName = getProfileName(input.profile);
    const confidence = input.interpretation?.confidence ?? getDecisionConfidence(input.decision);
    const entities = input.interpretation?.entities ?? input.entities;
    const userInput = input.userInput ?? '';

    let text: string;

    const templateText = buildTemplateResponse({
      userInput,
      intent,
      missingFields,
      currentFlow,
      confidence,
      entities,
    });

    if (action === 'answer_smalltalk' || intent === 'smalltalk' || intent === 'greeting') {
      text = profileName
        ? `Hi ${profileName}, lovely to hear from you. How can I help with your trip today?`
        : 'Hi, lovely to hear from you. How can I help with your trip today?';
    } else if (templateText) {
      text = templateText;
    } else if (missingFields.length > 0 || action === 'ask_missing') {
      text = this.buildMissingInfoText(intent, missingFields, currentFlow);
    } else if (action === 'handoff') {
      text = this.buildHandoffReply();
    } else if (action === 'clarify' || action === 'ask_clarifying_question') {
      text = this.buildClarifyingText(intent, currentFlow);
    } else if (action === 'execute_tool' || action === 'execute_search') {
      text = this.buildReadyToHelpText(intent, currentFlow);
    } else {
      text = this.buildClarifyingText(intent, currentFlow);
    }

    return { text: sanitizeUserFacingText(text) };
  }

  buildMissingInfoReply(decision: LLMDecisionOutput): string {
    return this.createFallbackMessage({
      intent: decision.intent,
      decision,
      missingFields: decision.missingFields,
    }).text;
  }

  buildUnsupportedToolReply(decision: LLMDecisionOutput): string {
    return this.createFallbackMessage({
      intent: decision.intent,
      decision,
      missingFields: decision.missingFields,
    }).text;
  }

  buildClarifyingReply(decision: LLMDecisionOutput): string {
    return this.createFallbackMessage({ intent: decision.intent, decision }).text;
  }

  buildHandoffReply(): string {
    return 'Thanks. This may need a human concierge to step in, but handoff routing is not connected yet.';
  }

  private buildMissingInfoText(
    intent: string | undefined,
    missingFields: string[],
    currentFlow?: string
  ): string {
    const service = describeService(intent, currentFlow);
    const fields = missingFields.map(describeField).filter(Boolean);

    if (fields.length === 0) {
      return `I can help with ${service}. Could you share a little more detail so I can guide you properly?`;
    }

    return `I can help with ${service}. Could you share ${formatList(fields)}?`;
  }

  private buildClarifyingText(intent?: string, currentFlow?: string): string {
    const service = describeService(intent, currentFlow);

    if (service === 'your trip') {
      return 'I can help with that. Could you tell me a little more about what you need for this trip?';
    }

    return `I can help with ${service}. Could you tell me a little more about what you have in mind?`;
  }

  private buildReadyToHelpText(intent?: string, currentFlow?: string): string {
    const service = describeService(intent, currentFlow);

    if (service === 'your hotel search') {
      return 'Great, I can help with your hotel search. Tell me the city or area, dates, guests, rooms, and budget, and I will take it from there.';
    }

    return `Great, I can help with ${service}. Tell me what you need and I will guide you from there.`;
  }
}

let conversationManagerInstance: ConversationManager | null = null;

export function getConversationManager(): ConversationManager {
  if (!conversationManagerInstance) {
    conversationManagerInstance = new ConversationManager();
  }

  return conversationManagerInstance;
}

export function initConversationManager(
  service = new ConversationManager()
): ConversationManager {
  conversationManagerInstance = service;
  return service;
}

function isHotelIntent(intent?: string): boolean {
  return Boolean(intent && /hotel|stay|accommodation|room|resort/i.test(intent));
}

function describeService(intent?: string, currentFlow?: string): string {
  const normalized = `${intent ?? ''} ${currentFlow ?? ''}`.toLowerCase();

  if (isHotelIntent(normalized)) return 'your hotel search';
  if (/restaurant|dining|food|meal|eat/.test(normalized)) return 'restaurant recommendations';
  if (/transport|logistics|transfer|pickup|taxi|car/.test(normalized)) return 'transport planning';
  if (/profile/.test(normalized)) return 'your travel profile';
  if (/greeting|smalltalk|general|inquiry|unknown|unclear/.test(normalized)) return 'your travel plans';

  return 'your travel plans';
}

function describeField(field: string): string {
  const normalized = field
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

  const fieldLabels: Record<string, string> = {
    destination: 'where you would like to go',
    location: 'the city or area',
    city: 'the city or area',
    area: 'the city or area',
    travel_dates: 'your travel dates',
    dates: 'your travel dates',
    date: 'the date',
    checkin_date: 'your check-in date',
    check_in: 'your check-in date',
    checkout_date: 'your check-out date',
    check_out: 'your check-out date',
    guests: 'how many guests are travelling',
    guest_count: 'how many guests are travelling',
    adults: 'how many adults are travelling',
    children: 'whether any children are travelling',
    rooms: 'how many rooms you need',
    room_count: 'how many rooms you need',
    budget: 'your budget',
    budget_per_night: 'your budget per night',
    preferred_rating: 'your preferred hotel rating',
    star_rating: 'your preferred hotel rating',
    meal_plan: 'your preferred meal plan',
    hotel_type: 'the style of hotel you prefer',
    facilities: 'any must-have facilities',
    accessibility_needs: 'any accessibility needs',
    dietary_restrictions: 'any dietary preferences',
    allergies: 'any allergies I should keep in mind',
    time: 'the time',
    pickup_location: 'the pickup location',
    dropoff_location: 'the drop-off location',
    drop_off_location: 'the drop-off location',
    vehicle_type: 'the vehicle style you prefer',
    passengers: 'how many passengers are travelling',
    luggage_count: 'how much luggage you will have',
  };

  return fieldLabels[normalized] ?? 'one more detail';
}

function formatList(items: string[]): string {
  const unique = Array.from(new Set(items));

  if (unique.length === 0) return 'a few more details';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;

  return `${unique.slice(0, -1).join(', ')}, and ${unique.at(-1)}`;
}

const defaultConversationLLM: ConversationManagerLLM = {
  async generateText(prompt: string): Promise<string> {
    return getLLMService().generateUIContent(prompt, 'en');
  },
};

function buildConversationPrompt(input: ConversationManagerInput, fallbackText: string): string {
  const interpretation = {
    intent: input.interpretation?.intent ?? input.intent ?? getDecisionIntent(input.decision),
    entities: input.interpretation?.entities ?? input.entities ?? {},
    confidence: input.interpretation?.confidence ?? getDecisionConfidence(input.decision),
  };
  const decision = normalizeDecisionForPrompt(input.decision, input.missingFields);
  const constraints = {
    ...DEFAULT_CONSTRAINTS,
    ...(input.constraints ?? {}),
  };

  return [
    'You are Yana, a warm personal travel concierge.',
    '',
    'Write the next user-facing WhatsApp reply.',
    '',
    'Use the provided interpretation and decision, but do not expose them.',
    '',
    'Rules:',
    '- Do not mention intent names, schemas, actions, confidence, or internal tools.',
    '- Do not say "I understood this as...".',
    '- Do not say "Could you share more detail?" if the user already gave useful details.',
    '- Acknowledge specific details the user shared.',
    '- Ask only the next useful question or questions.',
    '- Keep it natural and concise.',
    '- If user asks what you can do, explain available services naturally.',
    '- If user is planning a trip, guide them like a human concierge.',
    '- If the decision is ASK_MISSING_FIELDS, ask for those fields in natural language.',
    '- If the decision is EXECUTE_SEARCH, briefly confirm and proceed.',
    '- If the decision is RESET_FLOW, reassure the user and start fresh.',
    '- Return only the final message text.',
    '',
    'ConversationManager must not choose the next action. The action below is already decided.',
    '',
    `User input: ${input.userInput ?? ''}`,
    `Profile: ${JSON.stringify(input.profile ?? {})}`,
    `Memory: ${JSON.stringify(input.memory ?? {})}`,
    `Session: ${JSON.stringify(input.session ?? {})}`,
    `Interpretation: ${JSON.stringify(interpretation)}`,
    `Decision: ${JSON.stringify(decision)}`,
    `Available services: ${(input.availableServices ?? DEFAULT_AVAILABLE_SERVICES).join(', ')}`,
    `Constraints: ${JSON.stringify(constraints)}`,
    `Deterministic fallback style reference: ${fallbackText}`,
  ].join('\n');
}

function normalizeDecisionForPrompt(
  decision: ConversationManagerInput['decision'],
  missingFields: string[] | undefined
): Record<string, unknown> {
  if (typeof decision === 'string') {
    return { action: normalizeActionName(decision), payload: {}, source: 'backend' };
  }

  if (!decision || typeof decision !== 'object') {
    return { action: 'CLARIFY', payload: {}, source: 'backend' };
  }

  const action = getDecisionAction(decision);
  const payload =
    'payload' in decision && decision.payload && typeof decision.payload === 'object'
      ? decision.payload
      : {
          parameters: 'parameters' in decision ? decision.parameters : undefined,
          missingFields: missingFields ?? getDecisionMissingFields(decision),
        };

  return {
    action: normalizeActionName(action),
    payload,
    confidence: getDecisionConfidence(decision),
    source: 'source' in decision && typeof decision.source === 'string' ? decision.source : 'backend',
  };
}

function normalizeActionName(action?: string): string {
  const normalized = action?.toLowerCase();

  if (normalized === 'ask_missing' || normalized === 'ask_missing_fields') {
    return 'ASK_MISSING_FIELDS';
  }

  if (normalized === 'execute_tool' || normalized === 'execute_search') {
    return 'EXECUTE_SEARCH';
  }

  if (normalized === 'reset' || normalized === 'reset_flow') {
    return 'RESET_FLOW';
  }

  if (normalized === 'handoff') {
    return 'HANDOFF';
  }

  if (normalized === 'answer_smalltalk') {
    return 'SMALLTALK';
  }

  return normalized?.toUpperCase() ?? 'CLARIFY';
}

interface TemplateResponseInput {
  userInput: string;
  intent?: string;
  missingFields: string[];
  currentFlow?: string;
  confidence?: number;
  entities?: Record<string, unknown>;
}

function buildTemplateResponse(input: TemplateResponseInput): string | undefined {
  const normalized = normalizeText(input.userInput);

  if (isCapabilityQuestion(normalized)) {
    return 'I can help with hotels, transport, restaurants, excursions, itinerary planning, local recommendations, shopping, wellness, nightlife, and practical travel support. What would you like to organize first?';
  }

  if (isLowConfidence(input)) {
    return 'Sure — just so I guide you properly, are you looking for help with accommodation, transport, food, activities, or a full itinerary?';
  }

  if (isSriLankaTripPlanningRequest(normalized, input.intent)) {
    const duration = describeTripDuration(input.entities);
    const durationPrefix = duration ? ` Since you'll be here for ${duration},` : '';
    return `Wonderful — I'd love to help you plan your trip in Sri Lanka.${durationPrefix} We can build this around hotels, transport, experiences, restaurants, and a day-by-day itinerary. Are you looking for a relaxing trip, adventure, culture, beaches, wildlife, or a mix of everything?`;
  }

  if (isHotelRequest(normalized, input.intent, input.currentFlow)) {
    if (isOnlyMissingDates(input.missingFields)) {
      return 'Great, I can work with that. What are your check-in and check-out dates?';
    }

    if (
      userTextHasHotelRequest(normalized) &&
      (input.missingFields.length === 0 || isBroadHotelMissingSet(input.missingFields))
    ) {
      return 'Of course — I can help you find a great place to stay. Which area are you thinking of, and what dates should I check?';
    }
  }

  return undefined;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCapabilityQuestion(normalized: string): boolean {
  return /\b(what else can you do|what can you do|how can you help|what do you do|your services)\b/.test(
    normalized
  );
}

function isLowConfidence(input: TemplateResponseInput): boolean {
  if (typeof input.confidence === 'number' && input.confidence < 0.5) {
    return true;
  }

  return /\b(unclear|unknown)\b/i.test(`${input.intent ?? ''} ${input.currentFlow ?? ''}`);
}

function isSriLankaTripPlanningRequest(normalized: string, intent?: string): boolean {
  const asksToPlanTrip = /\b(plan|planning|itinerary|trip|holiday|vacation|tour)\b/.test(normalized);
  const mentionsSriLanka = /\b(sri lanka|srilanka|ceylon)\b/.test(normalized);
  const isItineraryIntent = /\b(itinerary|trip|general|inquiry|unclear)\b|general_inquiry/i.test(
    intent ?? ''
  );
  return asksToPlanTrip && mentionsSriLanka && isItineraryIntent;
}

function describeTripDuration(entities?: Record<string, unknown>): string | undefined {
  const duration = entities?.duration ?? entities?.tripDuration ?? entities?.days;

  if (typeof duration === 'number') {
    return duration === 7 ? 'a week' : `${duration} days`;
  }

  if (typeof duration !== 'string') {
    return undefined;
  }

  const normalized = duration.toLowerCase();
  if (/\b(week|7\s*days|seven\s*days)\b/.test(normalized)) {
    return 'a week';
  }

  return duration.trim() || undefined;
}

function isHotelRequest(normalized: string, intent?: string, currentFlow?: string): boolean {
  return isHotelIntent(intent) || isHotelIntent(currentFlow) || userTextHasHotelRequest(normalized);
}

function userTextHasHotelRequest(normalized: string): boolean {
  return /\b(hotel|stay|accommodation|room|resort|place to stay)\b/.test(normalized);
}

function isOnlyMissingDates(missingFields: string[]): boolean {
  const normalized = missingFields.map(normalizeFieldName);
  return (
    normalized.length > 0 &&
    normalized.every((field) =>
      ['checkin_date', 'check_in', 'checkout_date', 'check_out', 'travel_dates', 'dates'].includes(
        field
      )
    )
  );
}

function isBroadHotelMissingSet(missingFields: string[]): boolean {
  if (missingFields.length === 0) {
    return true;
  }

  const normalized = missingFields.map(normalizeFieldName);
  const hasArea = normalized.some((field) =>
    ['destination', 'location', 'city', 'area'].includes(field)
  );
  const hasDates = normalized.some((field) =>
    ['travel_dates', 'dates', 'checkin_date', 'check_in', 'checkout_date', 'check_out'].includes(
      field
    )
  );

  return hasArea && hasDates;
}

function normalizeFieldName(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function getDecisionIntent(input: ConversationManagerInput['decision']): string | undefined {
  return input && typeof input === 'object' && 'intent' in input && typeof input.intent === 'string'
    ? input.intent
    : undefined;
}

function getDecisionMissingFields(input: ConversationManagerInput['decision']): string[] {
  return input &&
    typeof input === 'object' &&
    'missingFields' in input &&
    Array.isArray(input.missingFields)
    ? input.missingFields.filter((field): field is string => typeof field === 'string')
    : [];
}

function getDecisionAction(input: ConversationManagerInput['decision']): string | undefined {
  if (typeof input === 'string') {
    return input;
  }

  if (!input || typeof input !== 'object') {
    return undefined;
  }

  if ('suggestedAction' in input && typeof input.suggestedAction === 'string') {
    return input.suggestedAction;
  }

  if ('action' in input && typeof input.action === 'string') {
    return input.action;
  }

  if ('type' in input && typeof input.type === 'string') {
    return input.type;
  }

  return undefined;
}

function getDecisionConfidence(input: ConversationManagerInput['decision']): number | undefined {
  return input &&
    typeof input === 'object' &&
    'confidence' in input &&
    typeof input.confidence === 'number'
    ? input.confidence
    : undefined;
}

function getSessionFlow(session: ConversationManagerInput['session']): string | undefined {
  if (!session) {
    return undefined;
  }

  const flow = session.flow ?? session.currentFlow ?? session.activeFlow;
  return typeof flow === 'string' ? flow : undefined;
}

function getProfileName(profile: ConversationManagerInput['profile']): string | undefined {
  if (!profile) {
    return undefined;
  }

  const profileRecord = profile as Record<string, unknown>;
  const preferredName =
    profileRecord.preferredName ?? profileRecord.profileName ?? profileRecord.fullName;
  return typeof preferredName === 'string' && preferredName.trim() ? preferredName.trim() : undefined;
}

function sanitizeUserFacingText(text: string): string {
  return INTERNAL_TERM_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  )
    .replace(/\bI understood this as\b/gi, 'I can help with')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function containsBlockedInternalTerms(text: string): boolean {
  return BLOCKED_INTERNAL_TERMS.some((pattern) => pattern.test(text));
}

const INTERNAL_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bsearch_hotels\b/gi, 'your hotel search'],
  [/\bgeneral_inquiry\b/gi, 'your trip'],
  [/\btravelDates\b/g, 'your travel dates'],
  [/\bdestination\b/gi, 'where you would like to go'],
  [/\bmissingFields\b/g, 'the details I need'],
  [/\bsuggestedAction\b/g, 'next step'],
  [/\bexecute_tool\b/g, 'continue'],
  [/\bask_missing\b/g, 'ask for details'],
  [/\bexecute_search\b/g, 'start searching'],
  [/\bsearch_restaurants\b/gi, 'restaurant recommendations'],
  [/\blogistics_request\b/gi, 'transport planning'],
];

const BLOCKED_INTERNAL_TERMS = [
  /\bsearch_hotels\b/i,
  /\bgeneral_inquiry\b/i,
  /\bASK_MISSING_FIELDS\b/,
  /\bEXECUTE_SEARCH\b/,
  /\bconfidence\b/i,
  /\btravelDates\b/,
  /\bschema\b/i,
  /\bintent\b/i,
];
