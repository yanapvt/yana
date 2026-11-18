import type { CanonicalConversationEvent } from '../types/core.js';
import { validateCanonicalConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { withWorkflowLock } from './WorkflowLockService.js';

/** Shared application ingress. Channel adapters validate their own credentials and
 * map provider data before calling this boundary. The accepted event contains
 * the server-resolved session, workflow and revision used by the handler. */
export class CanonicalMessageProcessor {
  async process<T>(
    input: CanonicalConversationEvent,
    handle: (accepted: CanonicalConversationEvent) => Promise<T>,
    options: { alreadyLocked?: boolean } = {}
  ): Promise<T> {
    const event = validateCanonicalConversationEvent(input);
    const run = async (): Promise<T> => {
      const accepted = await getConversationControlPlane().acceptEvent(event);
      if (accepted.userId !== event.userId || accepted.idempotencyKey !== event.idempotencyKey) {
        throw new Error('Accepted event does not match the inbound interaction');
      }
      return handle(accepted);
    };
    return options.alreadyLocked ? run() : withWorkflowLock(event.userId, run);
  }
}

let processor: CanonicalMessageProcessor | null = null;

export function getCanonicalMessageProcessor(): CanonicalMessageProcessor {
  return processor ??= new CanonicalMessageProcessor();
}
