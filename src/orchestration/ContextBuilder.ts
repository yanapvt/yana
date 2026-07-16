import type { InboundMessage, StoredProfile, StoredServiceRequest } from '../types/index.js';
import type {
  OrchestrationContext,
  OrchestrationSessionSnapshot,
} from './Orchestrator.js';

export interface ContextBuilderInput {
  inboundMessage: InboundMessage;
  text: string;
  profile?: StoredProfile | null;
  profileComplete: boolean;
  activeSession?: OrchestrationSessionSnapshot | null;
  recentServiceRequests?: StoredServiceRequest[];
  metadata?: Record<string, unknown>;
}

export class ContextBuilder {
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
      profile: input.profile?.form,
      activeSession: input.activeSession ? cloneSession(input.activeSession) : undefined,
      recentServiceRequests: input.recentServiceRequests?.map((request) => ({
        type: request.type,
        form: request.form,
        createdAt: new Date(request.createdAt),
      })),
      metadata: {
        ...input.metadata,
        inboundType: input.inboundMessage.type,
      },
    };
  }
}

function cloneSession(session: OrchestrationSessionSnapshot): OrchestrationSessionSnapshot {
  return {
    ...session,
    collectedFields: { ...session.collectedFields },
    requiredFields: [...session.requiredFields],
    missingFields: [...session.missingFields],
  };
}
