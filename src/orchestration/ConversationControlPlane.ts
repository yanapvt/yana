import type { CanonicalConversationEvent, InboundMessage, StoredProfile, StoredServiceRequest } from '../types/index.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import {
  Orchestrator,
  type OrchestrationResult,
} from './Orchestrator.js';
import { LLMDecisionInterpreter } from './LLMDecisionInterpreter.js';
import { ContextBuilder } from './ContextBuilder.js';
import { LLMServiceError } from '../services/LLMService.js';
import type { OrchestrationFlow, OrchestrationSessionSnapshot } from './Orchestrator.js';
import { missingFields, validateCriteria, workflow } from './WorkflowDefinitions.js';
import { PostgresTravellerMemoryRepository } from '../storage/travellerMemoryRepository.js';
import { validateCanonicalConversationEvent } from './CanonicalConversationEvent.js';
import { JourneyEventCheckpointService } from '../services/JourneyEventCheckpointService.js';
import type { JourneyEventCheckpoint } from '../storage/JourneyEventCheckpointRepository.js';
import { getItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';
import { getHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { getRestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import { getExcursionSearchSessionService } from '../services/excursionSearchSessionService.js';
import { getLogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
import { getItinerarySessionService } from '../services/itinerarySessionService.js';

export interface ConversationControlInput {
  event?: CanonicalConversationEvent;
  inboundMessage: InboundMessage;
  text: string;
  correlationId: string;
  profileComplete: boolean;
  profile?: StoredProfile | null;
  recentServiceRequests?: StoredServiceRequest[];
}

export interface ConversationControlPlaneDependencies {
  checkpoints?: JourneyEventCheckpointService;
  contextBuilder?: ContextBuilder;
  stateLoader?: ActiveConversationStateLoader;
  orchestrator?: Orchestrator;
  interpretingOrchestrator?: Orchestrator;
}

/**
 * Live control-plane boundary for normalized inbound messages. It owns active
 * workflow resolution and bounded planning. Execution remains delegated to the
 * existing vertical executors while they are migrated behind this boundary.
 */
export class ConversationControlPlane {
  private readonly contextBuilder: ContextBuilder;
  private readonly stateLoader: ActiveConversationStateLoader;
  private readonly orchestrator: Orchestrator;
  private readonly interpretingOrchestrator: Orchestrator;
  private readonly checkpoints: JourneyEventCheckpointService;

  constructor(dependencies: ConversationControlPlaneDependencies = {}) {
    this.checkpoints = dependencies.checkpoints ?? new JourneyEventCheckpointService();
    this.contextBuilder = dependencies.contextBuilder ?? new ContextBuilder(undefined, new PostgresTravellerMemoryRepository());
    this.stateLoader = dependencies.stateLoader ?? new ActiveConversationStateLoader();
    this.orchestrator = dependencies.orchestrator ?? new Orchestrator();
    this.interpretingOrchestrator = dependencies.interpretingOrchestrator ?? new Orchestrator({
      llmInterpreter: new LLMDecisionInterpreter(),
    });
  }

  /** Shared ingress for every channel. It validates the event and binds server
   * workflow identity without invoking a model or executing a workflow. */
  async acceptEvent(input: CanonicalConversationEvent): Promise<CanonicalConversationEvent> {
    const event = validateCanonicalConversationEvent(input);
    const { activeSession, pausedSessions } = await this.stateLoader.loadWithPaused(event.userId);
    const matching = event.workflowId
      ? [activeSession, ...pausedSessions].find((session) => session?.id === event.workflowId)
      : event.channel.startsWith('whatsapp_') || event.channel === 'website_ui' && event.eventType === 'text'
        ? activeSession : null;
    if (event.workflowId && !matching) {
      throw new LLMServiceError('The workflow reference is no longer available', 'STALE_WORKFLOW', false);
    }
    if (event.channel.startsWith('website_') && event.eventType !== 'text' && matching &&
        event.expectedStateVersion !== matching.revision) {
      throw new LLMServiceError('The workflow version has changed', 'STALE_WORKFLOW', false);
    }
    const accepted = validateCanonicalConversationEvent({
      ...event,
      sessionId: event.conversationId.replace(/^conversation:/, 'session:'),
      workflowId: matching?.id ?? null,
      expectedStateVersion: event.expectedStateVersion ?? matching?.revision ?? null,
      stateVersion: matching?.revision ?? null,
      contextId: matching?.id ? `task:${matching.id}` : null,
    });
    if (await this.checkpoints.accept(accepted) === false) {
      throw new LLMServiceError('This interaction was already accepted', 'DUPLICATE_EVENT', false);
    }
    return accepted;
  }

  recoverLastAcceptedEvent(userId: string): Promise<JourneyEventCheckpoint | null> {
    return this.checkpoints.recover(userId);
  }

  /** Pause other durable workflows without clearing their validated fields. */
  async pauseCompetingWorkflows(
    userId: string,
    activeFlow: 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary'
  ): Promise<void> {
    await Promise.all([
      activeFlow !== 'hotel' ? getHotelSearchSessionService().pause(userId) : Promise.resolve(),
      activeFlow !== 'restaurant' ? getRestaurantSearchSessionService().pause(userId) : Promise.resolve(),
      activeFlow !== 'excursion' ? getExcursionSearchSessionService().pause(userId) : Promise.resolve(),
      activeFlow !== 'logistics' ? getLogisticsSearchSessionService().pause(userId) : Promise.resolve(),
      activeFlow !== 'itinerary' ? getItinerarySessionService().pause(userId) : Promise.resolve(),
    ]);
  }

  async plan(input: ConversationControlInput): Promise<OrchestrationResult> {
    return this.runPlan(input, this.orchestrator);
  }

  async interpret(input: ConversationControlInput): Promise<OrchestrationResult> {
    return this.runPlan(input, this.interpretingOrchestrator);
  }

  /** Deterministic CORE reconciliation for a validated form submission. */
  async reconcileFormSubmission(
    userId: string,
    flow: Exclude<OrchestrationFlow, 'none' | 'profile'>,
    submittedFields: Record<string, unknown>,
    expectedWorkflow?: { id?: string; revision?: number },
    event?: CanonicalConversationEvent
  ): Promise<Pick<OrchestrationSessionSnapshot, 'collectedFields' | 'missingFields'>> {
    const formEvent = event && (event.channel === 'website_form' && event.eventType === 'form_submission'
      || event.channel === 'whatsapp_meta' && event.eventType === 'interactive'
        && event.metadata.interactionType === 'flow_reply');
    if (event && (event.userId !== userId || !formEvent
      || event.workflowId !== (expectedWorkflow?.id ?? null)
      || event.expectedStateVersion !== (expectedWorkflow?.revision ?? null))) {
      throw new LLMServiceError('Form event identity does not match', 'INVALID_WORKFLOW_OUTPUT', false);
    }
    const { activeSession, pausedSessions } = await this.stateLoader.loadWithPaused(userId);
    const targetSession = activeSession?.flow === flow
      ? activeSession
      : pausedSessions.find((session) => session.flow === flow) ?? null;
    if (
      expectedWorkflow?.id !== undefined
      && (targetSession?.id !== expectedWorkflow.id
        || targetSession.revision !== expectedWorkflow.revision)
    ) {
      throw new LLMServiceError('The form no longer matches its workflow version', 'STALE_WORKFLOW', false);
    }
    const collectedFields = validateCriteria(flow, {
      ...(targetSession?.collectedFields ?? {}),
      ...submittedFields,
    }, false);
    const required = workflow(flow)?.requestRequired ?? workflow(flow)?.required ?? [];
    const genuinelyMissing = missingFields(flow, collectedFields, required);
    console.log('conversation_control_form_reconciled', {
      correlationId: event?.correlationId,
      flow,
      workflowRevision: targetSession?.revision ?? 0,
      resumedFromPaused: Boolean(targetSession && targetSession !== activeSession),
      submittedFieldCount: Object.keys(submittedFields).length,
      missingFieldCount: genuinelyMissing.length,
      redacted: true,
    });
    return { collectedFields, missingFields: genuinelyMissing };
  }

  private async runPlan(
    input: ConversationControlInput,
    orchestrator: Orchestrator
  ): Promise<OrchestrationResult> {
    if (input.profileComplete && input.profile === null) throw new LLMServiceError('Saved profile context is unavailable', 'CONTEXT_UNAVAILABLE', true);
    const { activeSession, pausedSessions } = await this.stateLoader.loadWithPaused(input.inboundMessage.from);
    const history = await this.contextBuilder.loadHistory(input.inboundMessage.from);
    const memory = await this.contextBuilder.loadMemories(input.inboundMessage.from, [
      'trip:current', activeSession?.id ? `task:${activeSession.id}` : '',
    ].filter(Boolean));
    const itineraryWorkflow = [activeSession, ...pausedSessions].find((session) => session?.flow === 'itinerary');
    const uiWorkspace = itineraryWorkflow
      ? await getItineraryWorkspaceService().getCurrentSelection(input.inboundMessage.from).catch(() => null)
      : null;
    if (orchestrator === this.interpretingOrchestrator && history.historyStatus === 'unavailable') {
      throw new LLMServiceError('Conversation context is temporarily unavailable', 'CONTEXT_UNAVAILABLE', true);
    }
    return orchestrator.plan({
      ...history,
      ...memory,
      inboundMessage: input.inboundMessage,
      text: input.text,
      profileComplete: input.profileComplete,
      profile: input.profile,
      activeSession,
      pausedSessions,
      uiWorkspace: uiWorkspace && uiWorkspace.workflowId === itineraryWorkflow?.id ? uiWorkspace : undefined,
      recentServiceRequests: input.recentServiceRequests,
      metadata: {
        correlationId: input.correlationId,
        ...(input.event ? {
          eventId: input.event.eventId,
          channel: input.event.channel,
          eventType: input.event.eventType,
          sessionId: input.event.sessionId,
          conversationId: input.event.conversationId,
          workflowId: input.event.workflowId,
        } : {}),
      },
    });
  }
}

let conversationControlPlane: ConversationControlPlane | null = null;

export function getConversationControlPlane(): ConversationControlPlane {
  if (!conversationControlPlane) {
    conversationControlPlane = new ConversationControlPlane();
  }
  return conversationControlPlane;
}

export function initConversationControlPlane(
  controlPlane = new ConversationControlPlane()
): ConversationControlPlane {
  conversationControlPlane = controlPlane;
  return controlPlane;
}
