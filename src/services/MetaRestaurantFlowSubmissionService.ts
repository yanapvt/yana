import type { InboundMessage, InteractiveContent } from '../types/core.js';
import type { RestaurantRequestForm } from '../types/forms.js';
import { restaurantRequestFormSchema } from '../validation/formSchemas.js';
import { getFormTokenService } from './formTokenService.js';
import { getProfileService } from './profileService.js';
import { mapRestaurantRequestFormToCriteria } from './restaurantRequestMapper.js';
import { getRestaurantSearchSessionService } from './restaurantSearchSessionService.js';

export interface MetaRestaurantFlowSubmissionResult {
  handled: boolean;
  reply?: string;
}

export async function handleMetaRestaurantFlowSubmission(
  message: InboundMessage
): Promise<MetaRestaurantFlowSubmissionResult> {
  const content = message.content as InteractiveContent;
  if (content.type !== 'interactive' || content.interactionType !== 'flow_reply') {
    return { handled: false };
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

  const parsed = restaurantRequestFormSchema.safeParse(response);
  if (!parsed.success) {
    return {
      handled: true,
      reply: 'I could not validate all dining details. Please reopen the form and check the required fields.',
    };
  }

  const form = parsed.data as RestaurantRequestForm;
  const saved = await getProfileService().saveServiceRequest(message.from, 'restaurant', form);
  const criteria = mapRestaurantRequestFormToCriteria(form);
  await getRestaurantSearchSessionService().saveAwaitingPreferences(message.from, criteria, {
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
