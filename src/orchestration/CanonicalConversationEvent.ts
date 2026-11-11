import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CanonicalConversationEvent, InboundMessage } from '../types/core.js';

const messageContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), body: z.string() }).strict(),
  z.object({ type: z.literal('audio'), audioUrl: z.string().min(1), contentType: z.string().optional() }).strict(),
  z.object({ type: z.literal('media'), mediaType: z.enum(['image', 'video', 'document']),
    mediaUrl: z.string().min(1), caption: z.string().optional() }).strict(),
  z.object({ type: z.literal('interactive'), interactionType: z.enum(['button_reply', 'list_reply', 'flow_reply']),
    selectedId: z.string().min(1), selectedTitle: z.string().optional(), responseData: z.record(z.unknown()).optional() }).strict(),
]);

const eventSchema = z.object({
  eventId: z.string().uuid(),
  sourceEventId: z.string().min(1).max(512),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  correlationId: z.string().min(1).max(150),
  userId: z.string().min(1).max(255),
  channel: z.enum(['whatsapp_twilio', 'whatsapp_openwa', 'whatsapp_meta', 'website_form', 'website_ui']),
  eventType: z.enum(['text', 'audio', 'media', 'interactive', 'form_submission', 'ui_selection', 'ui_action']),
  occurredAt: z.date(),
  receivedAt: z.date(),
  conversationId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  workflowId: z.string().min(1).nullable(),
  expectedStateVersion: z.number().int().nonnegative().nullable(),
  stateVersion: z.number().int().nonnegative().nullable(),
  contextId: z.string().min(1).max(255).nullable(),
  payload: z.record(z.unknown()),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict().superRefine((event, ctx) => {
  const message = ['text', 'audio', 'media', 'interactive'].includes(event.eventType);
  if (message && !messageContentSchema.safeParse(event.payload.content).success) {
    ctx.addIssue({ code: 'custom', path: ['payload', 'content'], message: 'Valid message content is required' });
  }
  if (message && event.payload.content && typeof event.payload.content === 'object' &&
      (event.payload.content as { type?: string }).type !== event.eventType &&
      !(event.eventType === 'audio' && (event.payload.content as { type?: string }).type === 'text')) {
    ctx.addIssue({ code: 'custom', path: ['eventType'], message: 'Message type does not match event type' });
  }
  if (event.eventType === 'form_submission' &&
      (typeof event.payload.formType !== 'string' || !event.payload.formType ||
        typeof event.payload.fields !== 'object' || event.payload.fields === null || Array.isArray(event.payload.fields))) {
    ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Validated form fields are required' });
  }
  if ((event.eventType === 'ui_selection' || event.eventType === 'ui_action') &&
      typeof event.payload.action !== 'string') {
    ctx.addIssue({ code: 'custom', path: ['payload', 'action'], message: 'A UI action is required' });
  }
  if (event.eventType === 'ui_selection' &&
      (!Number.isInteger(event.payload.selectedDay) || (event.payload.selectedDay as number) < 1)) {
    ctx.addIssue({ code: 'custom', path: ['payload', 'selectedDay'], message: 'A valid selected day is required' });
  }
  if (event.channel.startsWith('whatsapp_') && !message ||
      event.channel === 'website_form' && message ||
      event.channel === 'website_ui' && message && event.eventType !== 'text') {
    ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Channel and event type do not match' });
  }
  if (event.channel.startsWith('whatsapp_') && !event.userId.startsWith('whatsapp:')) {
    ctx.addIssue({ code: 'custom', path: ['userId'], message: 'A resolved WhatsApp identity is required' });
  }
  if (event.channel === 'website_form' && event.eventType !== 'form_submission' ||
      event.channel === 'website_ui' && !['text', 'ui_selection', 'ui_action'].includes(event.eventType)) {
    ctx.addIssue({ code: 'custom', path: ['eventType'], message: 'Website event type does not match channel' });
  }
});

export function validateCanonicalConversationEvent(value: unknown): CanonicalConversationEvent {
  return eventSchema.parse(value) as CanonicalConversationEvent;
}

export function createInboundConversationEvent(message: InboundMessage, correlationId: string): CanonicalConversationEvent {
  const provider = message.metadata?.provider;
  const channel = provider === 'openwa' ? 'whatsapp_openwa' : provider === 'meta' ? 'whatsapp_meta' : 'whatsapp_twilio';
  const eventType = message.inputType === 'voice' ? 'audio' : message.type;
  return createEvent({
    sourceEventId: message.messageId,
    correlationId,
    userId: message.from,
    channel,
    eventType,
    occurredAt: message.timestamp,
    payload: { content: message.content },
    metadata: {
      inputType: message.inputType ?? message.type,
      ...(message.content.type === 'interactive' ? { interactionType: message.content.interactionType } : {}),
    },
  });
}

export function createWebsiteConversationEvent(input: {
  sourceEventId: string;
  correlationId: string;
  userId: string;
  channel: 'website_form' | 'website_ui';
  eventType: 'text' | 'form_submission' | 'ui_selection' | 'ui_action';
  payload: Record<string, unknown>;
  workflowId?: string;
  expectedStateVersion?: number;
}): CanonicalConversationEvent {
  return createEvent({ ...input, occurredAt: new Date(), metadata: {} });
}

function createEvent(input: {
  sourceEventId: string;
  correlationId: string;
  userId: string;
  channel: CanonicalConversationEvent['channel'];
  eventType: CanonicalConversationEvent['eventType'];
  occurredAt: Date;
  payload: Record<string, unknown>;
  metadata: CanonicalConversationEvent['metadata'];
  workflowId?: string;
  expectedStateVersion?: number;
}): CanonicalConversationEvent {
  const userId = input.userId.trim();
  const sourceEventId = input.sourceEventId.trim();
  const identityHash = sha256(userId);
  return validateCanonicalConversationEvent({
    eventId: randomUUID(), sourceEventId,
    idempotencyKey: sha256(`${input.channel}\0${sourceEventId}`),
    correlationId: input.correlationId,
    userId, channel: input.channel, eventType: input.eventType,
    occurredAt: input.occurredAt, receivedAt: new Date(),
    conversationId: `conversation:${identityHash}`,
    sessionId: null, workflowId: input.workflowId ?? null,
    expectedStateVersion: input.expectedStateVersion ?? null,
    stateVersion: null, contextId: null,
    payload: input.payload, metadata: input.metadata,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
