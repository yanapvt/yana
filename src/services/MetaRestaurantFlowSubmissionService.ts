import type { CanonicalConversationEvent, InboundMessage, InteractiveContent } from '../types/core.js';
import type { RestaurantRequestForm } from '../types/forms.js';
import { restaurantRequestFormSchema } from '../validation/formSchemas.js';
import { getFormTokenService } from './formTokenService.js';
import { getProfileService } from './profileService.js';
import { mapRestaurantRequestFormToCriteria } from './restaurantRequestMapper.js';
import { getRestaurantSearchSessionService } from './restaurantSearchSessionService.js';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { createInboundConversationEvent, validateCanonicalConversationEvent } from '../orchestration/CanonicalConversationEvent.js';

export interface MetaRestaurantFlowSubmissionResult {
  handled: boolean;
  reply?: string;
}

export async function handleMetaRestaurantFlowSubmission(
  message: InboundMessage,
  correlationId: string,
  acceptedEvent?: CanonicalConversationEvent
): Promise<MetaRestaurantFlowSubmissionResult> {
  const content = message.content as InteractiveContent;
  if (content.type !== 'interactive' || content.interactionType !== 'flow_reply') {
    return { handled: false };
  }

  const event = acceptedEvent
    ? validateCanonicalConversationEvent(acceptedEvent)
    : await getConversationControlPlane().acceptEvent(createInboundConversationEvent(message, correlationId));
  if (event.userId !== message.from || event.sourceEventId !== message.messageId ||
      event.correlationId !== correlationId || event.channel !== 'whatsapp_meta' ||
      event.eventType !== 'interactive' || event.metadata.interactionType !== 'flow_reply') {
    return { handled: true, reply: 'I could not safely match that dining form to this chat. Please ask me to open it again.' };
  }

  const response = normalizeResponse(content.responseData ?? {});
  const token = readString(response.flow_token);
  const tokenRecord = token
    ? getFormTokenService().resolveToken(token, 'restaurant')
    : null;
  if (!tokenRecord || tokenRecord.userId !== message.from) {
    return {
      handled: true,
      reply: 'That dining form has expired or does not belong to this chat. Please ask me to open it again.',
    };
  }

  const sessions = getRestaurantSearchSessionService();
  const current = await sessions.getAuthoritative(message.from);
  if (!current || !tokenRecord.workflowId || tokenRecord.workflowId !== current.id ||
      tokenRecord.workflowRevision !== current.revision || event.workflowId !== current.id ||
      event.expectedStateVersion !== current.revision) {
    return { handled: true,
      reply: 'That dining form is out of date. Please ask me to open it again so your latest details are preserved.' };
  }

  const parsed = restaurantRequestFormSchema.safeParse(response);
  if (!parsed.success) {
    return {
      handled: true,
      reply: 'I could not validate all dining details. Please reopen the form and check the required fields.',
    };
  }

  const form = parsed.data as RestaurantRequestForm;
  const criteria = mapRestaurantRequestFormToCriteria(form);
  const reconciled = await getConversationControlPlane().reconcileFormSubmission(message.from, 'restaurant',
    { ...criteria }, { id: current.id, revision: current.revision }, event);
  const saved = await getProfileService().saveServiceRequest(message.from, 'restaurant', form, token);
  await sessions.saveAwaitingPreferences(message.from, reconciled.collectedFields, {
    restaurantFormResponseId: saved.id,
  });
  getFormTokenService().consumeToken(token!, 'restaurant');

  return {
    handled: true,
    reply: 'Perfect, I have your dining preferences and allergy information. Reply “no other preferences” to search now, or add anything else I should consider.',
  };
}

function normalizeResponse(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...value };
  if (typeof normalized.guests === 'string' && /^\d+$/.test(normalized.guests)) {
    normalized.guests = Number(normalized.guests);
  }
  for (const field of ['dietaryRequirements', 'allergies']) {
    if (Array.isArray(normalized[field])) {
      normalized[field] = normalized[field].map(String).join(', ');
    }
  }
  return normalized;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
