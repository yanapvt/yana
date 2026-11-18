import type { InboundMessage, StoredProfile, StoredServiceRequest } from '../types/index.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { sanitizeConversationText } from '../utils/contextPrivacy.js';
import type { ContextPackage } from '../services/LLMService.js';
import { validateCriteria, workflow, WORKFLOW_SCHEMA_VERSION, WORKFLOW_DEFINITIONS } from './WorkflowDefinitions.js';
import type {
  OrchestrationContext,
  OrchestrationSessionSnapshot,
} from './Orchestrator.js';
import type { TravellerMemoryFact } from './TravellerMemory.js';
import { relevantMemories } from './TravellerMemory.js';
import type { TravellerMemoryRepository } from '../storage/travellerMemoryRepository.js';

export interface ContextBuilderInput {
  inboundMessage: InboundMessage;
  text: string;
  profile?: StoredProfile | null;
  profileComplete: boolean;
  activeSession?: OrchestrationSessionSnapshot | null;
  pausedSessions?: OrchestrationSessionSnapshot[];
  recentServiceRequests?: StoredServiceRequest[];
  uiWorkspace?: { workflowId?: string; selectedDay: number; revision: number };
  metadata?: Record<string, unknown>;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  historyStatus?: OrchestrationContext['historyStatus'];
  travellerMemories?: TravellerMemoryFact[];
  memoryStatus?: OrchestrationContext['memoryStatus'];
}

export class ContextBuilder {
  constructor(
    private readonly messages: Pick<MessageRepository, 'findRecentByTraveller'> = new MessageRepository(),
    private readonly memories?: Pick<TravellerMemoryRepository, 'findForContext'>
  ) {}

  async loadHistory(userId: string): Promise<Pick<ContextBuilderInput, 'conversationHistory' | 'historyStatus'>> {
    try {
      const history = await this.messages.findRecentByTraveller(userId, 12);
      return { conversationHistory: history.slice(-12).map((turn) => ({ ...turn, content: sanitizeConversationText(turn.content) })), historyStatus: history.length ? 'available' : 'empty' };
    } catch { return { conversationHistory: [], historyStatus: 'unavailable' }; }
  }

  async loadMemories(userId: string, contextIds: string[] = []): Promise<Pick<ContextBuilderInput, 'travellerMemories' | 'memoryStatus'>> {
    if (!this.memories) return { travellerMemories: [], memoryStatus: 'empty' };
    try {
      const facts = await this.memories.findForContext(userId, contextIds);
      return { travellerMemories: facts, memoryStatus: facts.length ? 'available' : 'empty' };
    } catch { return { travellerMemories: [], memoryStatus: 'unavailable' }; }
  }

  build(input: ContextBuilderInput): OrchestrationContext {
    const history = input.conversationHistory?.slice(-12) ?? [];
    let latestAssistantIndex = -1;
    for (let index = 0; index < history.length; index += 1) {
      if (history[index].role === 'assistant') latestAssistantIndex = index;
    }
    const latestAssistant = latestAssistantIndex >= 0 ? history[latestAssistantIndex].content : undefined;
    // Provider result links can contain query strings (for example ?cid=...).
    // They are not questions awaiting a traveller's answer.
    const assistantProse = latestAssistant?.replace(/https?:\/\/\S+/g, '')
      .replace(/^\[Generated reply; delivery not verified\]\s*/i, '');
    const question = assistantProse?.match(/([^\n.!?]{3,250}\?)(?![\s\S]*\?)/)?.[1]?.trim();
    const active = input.activeSession?.lifecycleStatus !== 'paused' ? input.activeSession : undefined;
    const pendingQuestion = question && latestAssistantIndex === history.length - 1 &&
      !/your saved requests are paused/i.test(latestAssistant ?? '')
      ? { text: question, ...(active?.awaitedField ? { expectedAnswerType: active.awaitedField } : {}),
          ...(active?.id ? { workflowId: active.id } : {}) }
      : undefined;
    return {
      userId: input.inboundMessage.from,
      message: {
        messageId: input.inboundMessage.messageId,
        from: input.inboundMessage.from,
        inputType: input.inboundMessage.inputType,
        text: input.text.trim(),
      },
      profileComplete: input.profileComplete,
      profile: input.profile ? structuredClone(input.profile.form) : undefined,
      travellerMemories: input.travellerMemories?.map((fact) => structuredClone(fact)),
      memoryStatus: input.memoryStatus,
      conversationHistory: history.map((turn) => ({ ...turn, content: turn.content.slice(0, 1000) })),
      conversationTopic: active?.flow,
      pendingQuestion,
      pendingClarification: pendingQuestion && !pendingQuestion.expectedAnswerType ? pendingQuestion.text : undefined,
      historyStatus: input.historyStatus,
      activeSession: input.activeSession ? cloneSession(input.activeSession) : undefined,
      pausedSessions: input.pausedSessions?.slice(0, 4).map(cloneSession),
      recentServiceRequests: input.recentServiceRequests?.map((request) => ({
        type: request.type,
        form: request.form,
        createdAt: new Date(request.createdAt),
      })),
      uiWorkspace: input.uiWorkspace ? { ...input.uiWorkspace } : undefined,
      metadata: {
        ...input.metadata,
        provider: input.metadata?.channel ?? input.inboundMessage.metadata?.provider ?? 'whatsapp',
        inboundType: input.inboundMessage.type,
        eventType: input.metadata?.eventType ?? input.inboundMessage.metadata?.eventType ?? input.inboundMessage.type,
      },
    };
  }
}

function cloneSession(session: OrchestrationSessionSnapshot): OrchestrationSessionSnapshot {
  return {
    ...structuredClone(session),
    awaitedField: session.awaitedField,
    collectedFields: structuredClone(session.collectedFields),
    requiredFields: [...session.requiredFields],
    missingFields: [...session.missingFields],
  };
}

/** The one model projection for interpretation, extraction and wording; excludes contact data and tokens. */
export function modelContext(context: OrchestrationContext): ContextPackage {
  const profile = context.profile;
  const session = context.activeSession;
  const definition = session ? workflow(session.flow) : undefined;
  const confirmedFacts = relevantMemories(context.travellerMemories ?? [], session?.flow);
  const pendingConfirmations = (context.travellerMemories ?? []).filter((fact) =>
    fact.status === 'proposed' && (!fact.expiresAt || Date.parse(fact.expiresAt) > Date.now())).slice(0, 5);
  const result: ContextPackage = {
    allowedUIModes: ['chat_reply', 'clarification', 'clarification_form', 'results_list', 'search_editor', 'itinerary_editor', 'confirmation'],
    workflowDefinition: definition ? { ...definition, version: WORKFLOW_SCHEMA_VERSION,
      fieldTypes: Object.fromEntries(definition.fields.map((key) => [key, key.endsWith('Date') ? 'YYYY-MM-DD calendar date' : key.endsWith('Time') ? 'HH:mm'
        : ['guests', 'adults', 'children', 'rooms', 'passengers'].includes(key) ? 'integer' : key === 'interests' ? 'string[]' : key === 'budgetPerNight' ? '{amount: positive number, currency: three-letter code}' : 'string'])),
      allowedValues: session?.flow === 'hotel' ? { boardBasis: ['room_only', 'bnb', 'half_board', 'full_board', 'all_inclusive'] } : {},
    } : undefined,
    userMessage: sanitizeConversationText(context.message.text, 4000),
    requestId: context.message.messageId,
    eventType: String(context.metadata.eventType ?? context.metadata.inboundType ?? 'message'),
    messageType: context.message.inputType,
    channel: String(context.metadata.channel ?? context.metadata.provider ?? 'whatsapp'),
    sessionId: typeof context.metadata.sessionId === 'string' ? context.metadata.sessionId : undefined,
    conversationId: typeof context.metadata.conversationId === 'string' ? context.metadata.conversationId : undefined,
    historyStatus: context.historyStatus,
    conversationHistory: context.conversationHistory?.slice(-12),
    conversationTopic: context.conversationTopic,
    pendingQuestion: context.pendingQuestion,
    pendingClarification: context.pendingClarification,
    userProfile: profile ? Object.fromEntries(
      ['preferredName', 'preferredLanguage', 'preferredCurrency', 'nationality', 'travelStyle', 'dietaryRestrictions', 'accessibilityNeeds']
        .filter((key) => typeof profile[key as keyof typeof profile] === 'string')
        .map((key) => [key, String(profile[key as keyof typeof profile]).slice(0, 300)])
    ) : undefined,
    travellerContext: {
      confirmedFacts: confirmedFacts.map(({ key, value, scope, updatedAt, expiresAt }) => ({
        key, value: sanitizeConversationText(value, 300), scope, updatedAt, expiresAt,
        source: 'confirmed_traveller_memory',
      })),
      pendingConfirmations: pendingConfirmations.map(({ key, value, scope, updatedAt, expiresAt }) => ({
        key, value: sanitizeConversationText(value, 300), scope, updatedAt, expiresAt,
        source: 'pending_traveller_memory',
      })),
    },
    sessionState: session ? {
      currentIntent: session.flow, lifecycleStatus: session.lifecycleStatus ?? 'active', state: session.state,
      activeSchema: session.activeSchema, schemaVersion: WORKFLOW_SCHEMA_VERSION,
      revision: session.revision, sessionId: session.id, updatedAt: session.updatedAt,
      collectedFields: validateCriteria(session.flow, session.collectedFields, false),
      requiredFields: session.requiredFields, missingFields: session.missingFields,
      awaitedField: session.awaitedField,
      pendingDecisions: session.pendingDecisions,
    } : undefined,
    uiWorkspace: context.uiWorkspace?.workflowId && [session?.id, ...(context.pausedSessions ?? []).map((task) => task.id)]
      .includes(context.uiWorkspace.workflowId)
      ? { ...context.uiWorkspace } : undefined,
    pendingTransaction: session && /^(booking_form|booking_provider_pending|provider_pending|reservation_pending|awaiting_booking)$/.test(session.state ?? '')
      ? { workflowId: session.id, flow: session.flow, stage: session.state!, confirmed: false }
      : undefined,
    pausedTasks: context.pausedSessions?.slice(0, 4).map((paused) => ({
      currentIntent: paused.flow, activeSchema: paused.activeSchema, revision: paused.revision,
      lifecycleStatus: paused.lifecycleStatus ?? 'paused', state: paused.state,
      updatedAt: paused.updatedAt, collectedFields: validateCriteria(paused.flow, paused.collectedFields, false),
      missingFields: paused.missingFields,
      pendingDecisions: paused.pendingDecisions,
    })),
    itinerary: session?.itinerary ? { days: session.itinerary.days.slice(0, 14).map((day) => ({ day: day.day, date: day.date, location: day.location, morning: day.morning.slice(0, 250), afternoon: day.afternoon.slice(0, 250), evening: day.evening.slice(0, 250) })) } : undefined,
    verifiedResults: session?.verifiedResults,
    availableSchemas: Object.values(WORKFLOW_DEFINITIONS).map((definition) => definition.schema),
  };
  while (JSON.stringify(result).length > 24000 && result.conversationHistory?.length) result.conversationHistory.shift();
  while (JSON.stringify(result).length > 24000 && result.itinerary?.days.length) result.itinerary.days.pop();
  return result;
}
