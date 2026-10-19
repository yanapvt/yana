import type { InboundMessage, StoredProfile, StoredServiceRequest } from '../types/index.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import {
  Orchestrator,
  type OrchestrationResult,
} from './Orchestrator.js';
import { LLMDecisionInterpreter } from './LLMDecisionInterpreter.js';

export interface ConversationControlInput {
  inboundMessage: InboundMessage;
  text: string;
  correlationId: string;
  profileComplete: boolean;
  profile?: StoredProfile | null;
  recentServiceRequests?: StoredServiceRequest[];
}

export interface ConversationControlPlaneDependencies {
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
  private readonly stateLoader: ActiveConversationStateLoader;
  private readonly orchestrator: Orchestrator;
  private readonly interpretingOrchestrator: Orchestrator;

  constructor(dependencies: ConversationControlPlaneDependencies = {}) {
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

  private async runPlan(
    input: ConversationControlInput,
    orchestrator: Orchestrator
  ): Promise<OrchestrationResult> {
    const activeSession = await this.stateLoader.load(input.inboundMessage.from);
    return orchestrator.plan({
      inboundMessage: input.inboundMessage,
      text: input.text,
      profileComplete: input.profileComplete,
      profile: input.profile,
      activeSession,
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
