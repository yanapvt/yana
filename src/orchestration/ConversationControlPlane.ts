import type { InboundMessage, StoredProfile, StoredServiceRequest } from '../types/index.js';
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

export interface ConversationControlInput {
  inboundMessage: InboundMessage;
  text: string;
  correlationId: string;
  profileComplete: boolean;
  profile?: StoredProfile | null;
  recentServiceRequests?: StoredServiceRequest[];
}

export interface ConversationControlPlaneDependencies {
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

  constructor(dependencies: ConversationControlPlaneDependencies = {}) {
    this.contextBuilder = dependencies.contextBuilder ?? new ContextBuilder(undefined, new PostgresTravellerMemoryRepository());
    this.stateLoader = dependencies.stateLoader ?? new ActiveConversationStateLoader();
    this.orchestrator = dependencies.orchestrator ?? new Orchestrator();
    this.interpretingOrchestrator = dependencies.interpretingOrchestrator ?? new Orchestrator({
      llmInterpreter: new LLMDecisionInterpreter(),
    });
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
    expectedWorkflow?: { id?: string; revision?: number }
  ): Promise<Pick<OrchestrationSessionSnapshot, 'collectedFields' | 'missingFields'>> {
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
      recentServiceRequests: input.recentServiceRequests,
      metadata: {
        correlationId: input.correlationId,
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
