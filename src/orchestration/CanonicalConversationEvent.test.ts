import { describe, expect, it } from 'vitest';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import { normalizeOpenWaInboundMessage } from '../utils/openWaMessageNormalizer.js';
import { normalizeMetaWhatsAppInboundMessage } from '../utils/metaWhatsAppMessageNormalizer.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import { ConversationControlPlane } from './ConversationControlPlane.js';
import { JourneyEventCheckpointService } from '../services/JourneyEventCheckpointService.js';
import { createInboundConversationEvent, createWebsiteConversationEvent, validateCanonicalConversationEvent } from './CanonicalConversationEvent.js';

const userId = 'whatsapp:+94770000001';
const loader = new ActiveConversationStateLoader({
  loadHotel: async () => ({ flow: 'hotel', id: 'hotel-workflow-1', revision: 4,
    lifecycleStatus: 'active', state: 'awaiting_preferences', stage: 'awaiting_preferences',
    schema: 'search_hotels', fields: { location: 'Galle' }, requiredFields: [],
    updatedAt: '2026-11-02T10:00:00.000Z' }),
  loadRestaurant: async () => null, loadExcursion: async () => null,
  loadLogistics: async () => null, loadItinerary: async () => ({ flow: 'itinerary', id: 'itinerary-workflow-1',
    revision: 2, lifecycleStatus: 'paused', state: 'awaiting_preferences', stage: 'awaiting_preferences',
    schema: 'plan_itinerary', fields: {}, requiredFields: [], updatedAt: '2026-11-01T10:00:00.000Z' }),
});
const checkpoints = new JourneyEventCheckpointService({
  saveAccepted: async () => undefined, findByUserId: async () => null,
}, { setJson: async () => undefined } as any);
const control = new ConversationControlPlane({ stateLoader: loader, checkpoints });

describe('canonical conversation event boundary', () => {
  it('accepts Twilio text with a generated event ID and stable source idempotency', async () => {
    const message = normalizeInboundMessage({ MessageSid: 'SM123', From: userId, To: 'whatsapp:+14155238886', Body: 'Hello' });
    const first = await control.acceptEvent(createInboundConversationEvent(message, 'correlation-1'));
    const retry = createInboundConversationEvent(message, 'correlation-2');
    expect(first).toMatchObject({ sourceEventId: 'SM123', channel: 'whatsapp_twilio', eventType: 'text',
      correlationId: 'correlation-1', userId, workflowId: 'hotel-workflow-1',
      expectedStateVersion: 4 });
    expect(first.sessionId).toBe(first.conversationId.replace('conversation:', 'session:'));
    expect(first.eventId).not.toBe(retry.eventId);
    expect(first.idempotencyKey).toBe(retry.idempotencyKey);
    expect(first.conversationId).toBe(retry.conversationId);
    expect(first.receivedAt).toBeInstanceOf(Date);
    expect(first.occurredAt).toBeInstanceOf(Date);
    expect(JSON.stringify(first)).not.toContain('rawPayload');
  });

  it('accepts OpenWA interactive selections without flattening the provider event type', async () => {
    const message = normalizeOpenWaInboundMessage({ data: { id: 'OW123', from: '94770000001@c.us',
      type: 'buttons_response', selectedButtonId: 'details 2', body: 'Option two' } });
    const event = await control.acceptEvent(createInboundConversationEvent(message, 'correlation-openwa'));
    expect(event).toMatchObject({ sourceEventId: 'OW123', channel: 'whatsapp_openwa', eventType: 'interactive',
      metadata: { inputType: 'interactive', interactionType: 'button_reply' },
      payload: { content: { selectedId: 'details 2' } } });
  });

  it('accepts Meta replies and preserves the provider message ID', async () => {
    const message = normalizeMetaWhatsAppInboundMessage({ entry: [{ changes: [{ value: {
      messages: [{ id: 'wamid.123', from: '94770000001', type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'book 1', title: 'First option' } } }],
    } }] }] });
    const event = await control.acceptEvent(createInboundConversationEvent(message, 'correlation-meta'));
    expect(event).toMatchObject({ sourceEventId: 'wamid.123', channel: 'whatsapp_meta', eventType: 'interactive',
      metadata: { interactionType: 'list_reply' }, payload: { content: { selectedId: 'book 1' } } });
  });

  it('accepts a Meta dining Flow response as the original interactive event', async () => {
    const message = normalizeMetaWhatsAppInboundMessage({ entry: [{ changes: [{ value: {
      messages: [{ id: 'wamid.flow.1', from: '94770000001', type: 'interactive',
        interactive: { type: 'nfm_reply', nfm_reply: { body: 'Sent',
          response_json: JSON.stringify({ flow_token: 'opaque-form-token', location: 'Galle' }) } } }],
    } }] }] });
    const event = await control.acceptEvent(createInboundConversationEvent(message, 'correlation-meta-flow'));
    expect(event).toMatchObject({ channel: 'whatsapp_meta', eventType: 'interactive', sourceEventId: 'wamid.flow.1',
      metadata: { interactionType: 'flow_reply' }, payload: { content: { responseData: { location: 'Galle' } } } });
    expect(JSON.stringify(event)).not.toContain('rawPayload');
  });

  it('keeps a voice note as an audio event even after transcription changes its content to text', async () => {
    const message = normalizeOpenWaInboundMessage({ data: { id: 'voice-123', from: '94770000001@c.us',
      type: 'ptt', mimetype: 'audio/ogg', mediaUrl: 'https://example.test/voice.ogg' } });
    const event = await control.acceptEvent(createInboundConversationEvent(message, 'correlation-voice'));
    expect(event).toMatchObject({ sourceEventId: 'voice-123', channel: 'whatsapp_openwa', eventType: 'audio',
      metadata: { inputType: 'voice' } });
    expect(event.payload.content).toMatchObject({ type: 'audio' });
  });

  it('accepts validated website form submissions with a stable retry key and bound workflow version', async () => {
    const input = { sourceEventId: 'form-request-1', correlationId: 'form-correlation-1', userId,
      channel: 'website_form' as const, eventType: 'form_submission' as const,
      workflowId: 'hotel-workflow-1', expectedStateVersion: 4,
      payload: { formType: 'hotel', fields: { destination: 'Galle' } } };
    const event = await control.acceptEvent(createWebsiteConversationEvent(input));
    expect(event).toMatchObject({ channel: 'website_form', eventType: 'form_submission',
      sourceEventId: 'form-request-1', workflowId: 'hotel-workflow-1', expectedStateVersion: 4 });
    expect(event.sessionId).toBe(event.conversationId.replace('conversation:', 'session:'));
    expect(event.idempotencyKey).toBe(createWebsiteConversationEvent({ ...input, correlationId: 'retry' }).idempotencyKey);
  });

  it('normalizes authenticated website text into the active journey', async () => {
    const event = await control.acceptEvent(createWebsiteConversationEvent({
      sourceEventId: 'web-chat-1', correlationId: 'corr-web-chat', userId,
      channel: 'website_ui', eventType: 'text',
      payload: { content: { type: 'text', body: 'Could we stay near the beach?' } },
    }));
    expect(event).toMatchObject({ channel: 'website_ui', eventType: 'text',
      workflowId: 'hotel-workflow-1', expectedStateVersion: 4, stateVersion: 4,
      contextId: 'task:hotel-workflow-1' });
  });

  it('assigns a stable conversation session before the first workflow exists', async () => {
    const noWorkflow = new ConversationControlPlane({ checkpoints, stateLoader: new ActiveConversationStateLoader({
      loadHotel: async () => null, loadRestaurant: async () => null, loadExcursion: async () => null,
      loadLogistics: async () => null, loadItinerary: async () => null,
    }) });
    const event = await noWorkflow.acceptEvent(createWebsiteConversationEvent({
      sourceEventId: 'profile-request-1', correlationId: 'profile-correlation-1', userId,
      channel: 'website_form', eventType: 'form_submission',
      payload: { formType: 'profile', fields: { preferredName: 'Sam' } },
    }));
    expect(event.sessionId).toBe(event.conversationId.replace('conversation:', 'session:'));
    expect(event.workflowId).toBeNull();
    expect(event.expectedStateVersion).toBeNull();
  });

  it('accepts website itinerary selection and edit actions through the same boundary', async () => {
    for (const eventType of ['ui_selection', 'ui_action'] as const) {
      const event = await control.acceptEvent(createWebsiteConversationEvent({ sourceEventId: `ui-${eventType}`,
        correlationId: `correlation-${eventType}`, userId, channel: 'website_ui', eventType,
        workflowId: 'itinerary-workflow-1', expectedStateVersion: 2,
        payload: { action: eventType === 'ui_selection' ? 'select_day' : 'edit_itinerary', selectedDay: 2 } }));
      expect(event).toMatchObject({ channel: 'website_ui', eventType, workflowId: 'itinerary-workflow-1', expectedStateVersion: 2 });
      expect(event.conversationId).toBe(createWebsiteConversationEvent({ sourceEventId: 'another',
        correlationId: 'another', userId, channel: 'website_form', eventType: 'form_submission',
        payload: { formType: 'profile', fields: {} } }).conversationId);
    }
  });

  it('rejects invalid events and does not copy raw provider metadata', () => {
    const inbound = normalizeInboundMessage({ MessageSid: 'SMsecret', From: userId,
      To: 'whatsapp:+14155238886', Body: 'Hello' });
    inbound.metadata = { provider: 'twilio', rawPayload: { secret: 'private-provider-field' } };
    const event = createInboundConversationEvent(inbound, 'correlation-safe');
    expect(JSON.stringify(event)).not.toContain('private-provider-field');
    expect(() => validateCanonicalConversationEvent({ ...event, payload: {} })).toThrow();
    expect(() => validateCanonicalConversationEvent({ ...event, payload: { content: { type: 'text', body: 'Hi', rawPayload: 'secret' } } })).toThrow();
    expect(() => validateCanonicalConversationEvent({ ...event, channel: 'website_form' })).toThrow();
    expect(() => createWebsiteConversationEvent({ sourceEventId: '', correlationId: 'c', userId,
      channel: 'website_form', eventType: 'form_submission', payload: { formType: 'hotel', fields: {} } })).toThrow();
  });

  it('rejects unknown or stale website workflow references', async () => {
    const input = { sourceEventId: 'form-request-2', correlationId: 'form-correlation-2', userId,
      channel: 'website_form' as const, eventType: 'form_submission' as const,
      payload: { formType: 'hotel', fields: { destination: 'Galle' } } };
    await expect(control.acceptEvent(createWebsiteConversationEvent({ ...input,
      workflowId: 'another-traveller-workflow', expectedStateVersion: 4 }))).rejects.toMatchObject({ code: 'STALE_WORKFLOW' });
    await expect(control.acceptEvent(createWebsiteConversationEvent({ ...input,
      workflowId: 'hotel-workflow-1', expectedStateVersion: 3 }))).rejects.toMatchObject({ code: 'STALE_WORKFLOW' });
  });
});
