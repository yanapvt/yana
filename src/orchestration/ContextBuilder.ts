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
      conversationHistory: input.conversationHistory?.slice(-12).map((turn) => ({ ...turn, content: turn.content.slice(0, 1000) })),
      historyStatus: input.historyStatus,
      activeSession: input.activeSession ? cloneSession(input.activeSession) : undefined,
      pausedSessions: input.pausedSessions?.slice(0, 4).map(cloneSession),
      recentServiceRequests: input.recentServiceRequests?.map((request) => ({
        type: request.type,
        form: request.form,
        createdAt: new Date(request.createdAt),
      })),
      metadata: {
        ...input.metadata,
        provider: input.inboundMessage.metadata?.provider ?? 'whatsapp',
        inboundType: input.inboundMessage.type,
        eventType: input.inboundMessage.metadata?.eventType ?? input.inboundMessage.type,
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
  const pendingConfirmations = (context.travellerMemories ?? []).filter((fact) => fact.status === 'proposed').slice(0, 5);
  const result: ContextPackage = {
    allowedUIModes: ['chat_reply', 'clarification', 'clarification_form', 'results_list', 'itinerary_editor', 'confirmation'],
    workflowDefinition: definition ? { ...definition, version: WORKFLOW_SCHEMA_VERSION,
      fieldTypes: Object.fromEntries(definition.fields.map((key) => [key, key.endsWith('Date') ? 'YYYY-MM-DD calendar date' : key.endsWith('Time') ? 'HH:mm'
        : ['guests', 'adults', 'children', 'rooms', 'passengers'].includes(key) ? 'integer' : key === 'interests' ? 'string[]' : key === 'budgetPerNight' ? '{amount: positive number, currency: three-letter code}' : 'string'])),
      allowedValues: session?.flow === 'hotel' ? { boardBasis: ['room_only', 'bnb', 'half_board', 'full_board', 'all_inclusive'] } : {},
    } : undefined,
    userMessage: sanitizeConversationText(context.message.text, 4000),
    requestId: context.message.messageId,
    eventType: String(context.metadata.eventType ?? context.metadata.inboundType ?? 'message'),
    messageType: context.message.inputType,
    channel: String(context.metadata.provider ?? 'whatsapp'),
    historyStatus: context.historyStatus,
    conversationHistory: context.conversationHistory?.slice(-12),
    userProfile: profile ? Object.fromEntries(
      ['preferredName', 'preferredLanguage', 'preferredCurrency', 'nationality', 'travelStyle', 'dietaryRestrictions', 'accessibilityNeeds']
        .filter((key) => typeof profile[key as keyof typeof profile] === 'string')
        .map((key) => [key, String(profile[key as keyof typeof profile]).slice(0, 300)])
    ) : undefined,
    travellerContext: {
      confirmedFacts: confirmedFacts.map(({ key, value, scope }) => ({ key, value: sanitizeConversationText(value, 300), scope })),
      pendingConfirmations: pendingConfirmations.map(({ key, value, scope }) => ({ key, value: sanitizeConversationText(value, 300), scope })),
    },
    sessionState: session ? {
      currentIntent: session.flow, lifecycleStatus: session.lifecycleStatus ?? 'active', state: session.state,
      activeSchema: session.activeSchema, schemaVersion: WORKFLOW_SCHEMA_VERSION,
      revision: session.revision, sessionId: session.id, updatedAt: session.updatedAt,
      collectedFields: validateCriteria(session.flow, session.collectedFields, false),
      requiredFields: session.requiredFields, missingFields: session.missingFields,
    } : undefined,
    pausedTasks: context.pausedSessions?.slice(0, 4).map((paused) => ({
      currentIntent: paused.flow, activeSchema: paused.activeSchema, revision: paused.revision,
      lifecycleStatus: paused.lifecycleStatus ?? 'paused', state: paused.state,
      updatedAt: paused.updatedAt, collectedFields: validateCriteria(paused.flow, paused.collectedFields, false),
      missingFields: paused.missingFields,
    })),
    itinerary: session?.itinerary ? { days: session.itinerary.days.slice(0, 14).map((day) => ({ day: day.day, date: day.date, location: day.location, morning: day.morning.slice(0, 250), afternoon: day.afternoon.slice(0, 250), evening: day.evening.slice(0, 250) })) } : undefined,
    verifiedResults: session?.verifiedResults,
    availableSchemas: Object.values(WORKFLOW_DEFINITIONS).map((definition) => definition.schema),
  };
  while (JSON.stringify(result).length > 24000 && result.conversationHistory?.length) result.conversationHistory.shift();
  while (JSON.stringify(result).length > 24000 && result.itinerary?.days.length) result.itinerary.days.pop();
  return result;
}
