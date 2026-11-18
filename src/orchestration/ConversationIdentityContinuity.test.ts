import { describe, expect, it } from 'vitest';
import { ExcursionSearchSessionService, type ExcursionSearchSession } from '../services/excursionSearchSessionService.js';
import { FormTokenService } from '../services/formTokenService.js';
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import { normalizeOpenWaInboundMessage } from '../utils/openWaMessageNormalizer.js';
import { normalizeMetaWhatsAppInboundMessage } from '../utils/metaWhatsAppMessageNormalizer.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import { createInboundConversationEvent, createWebsiteConversationEvent } from './CanonicalConversationEvent.js';
import { ConversationControlPlane } from './ConversationControlPlane.js';
import { JourneyEventCheckpointService } from '../services/JourneyEventCheckpointService.js';
import { ItinerarySessionService, type ItinerarySession } from '../services/itinerarySessionService.js';
import { ItineraryPlannerService } from '../services/ItineraryPlannerService.js';
import { ItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';

describe('traveller identity and session continuity', () => {
  it('keeps one journey through WhatsApp, UI date selection, voice date change, and WhatsApp', async () => {
    const userId = 'whatsapp:+94770000009';
    const sessions = new ExcursionSearchSessionService(new FixtureStateStore() as any,
      new FixtureSessionRepository<ExcursionSearchSession>());
    await sessions.saveAwaitingPreferences(userId, { destination: 'Ella', category: 'Nature' });
    const loader = new ActiveConversationStateLoader({
      loadExcursion: async (id) => {
        const session = await sessions.getAuthoritative(id);
        return session && { id: session.id, revision: session.revision,
          lifecycleStatus: session.lifecycleStatus, flow: 'excursion', state: session.state,
          stage: session.stage, schema: 'search_excursions', fields: session.criteria,
          requiredFields: ['destination'], updatedAt: session.updatedAt };
      },
      loadHotel: async () => null, loadRestaurant: async () => null,
      loadLogistics: async () => null, loadItinerary: async () => null,
    });
    const control = new ConversationControlPlane({ stateLoader: loader, checkpoints: new JourneyEventCheckpointService({
      saveAccepted: async () => undefined, findByUserId: async () => null,
    }, new FixtureStateStore() as any) });
    const start = await control.acceptEvent(createInboundConversationEvent(normalizeInboundMessage({
      MessageSid: 'SM-date-start', From: userId, To: 'whatsapp:+14155238886', Body: 'An excursion in Ella',
    }), 'corr-date-start'));
    const tokens = new FormTokenService();
    const token = tokens.createToken(userId, 'excursion');
    tokens.bindRevision(token, 'excursion', start.stateVersion!, start.workflowId!);
    const bound = tokens.resolveToken(token, 'excursion')!;
    const selection = await control.acceptEvent(createWebsiteConversationEvent({
      sourceEventId: bound.requestId!, correlationId: 'corr-ui-date', userId: bound.userId,
      channel: 'website_ui', eventType: 'ui_action', workflowId: bound.workflowId,
      expectedStateVersion: bound.workflowRevision,
      payload: { action: 'update_draft', fields: { preferredDate: '2026-11-10' } },
    }));
    await sessions.applyCriteriaPatch(userId, selection.expectedStateVersion!, { preferredDate: '2026-11-10' });
    const voice = await control.acceptEvent(createInboundConversationEvent(normalizeOpenWaInboundMessage({
      data: { id: 'OW-date-change', from: '94770000009@c.us', type: 'ptt',
        mimetype: 'audio/ogg', mediaUrl: 'https://example.test/date-change.ogg' },
    }), 'corr-voice-date'));
    await sessions.applyCriteriaPatch(userId, voice.expectedStateVersion!, { preferredDate: '2026-11-14' });
    const followup = await control.acceptEvent(createInboundConversationEvent(normalizeMetaWhatsAppInboundMessage({
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.date-return',
        from: '94770000009', type: 'text', text: { body: 'What is the plan now?' } }] } }] }],
    }), 'corr-date-return'));
    const events = [start, selection, voice, followup];
    expect(new Set(events.map((event) => event.eventId)).size).toBe(4);
    expect(events.map((event) => event.channel)).toEqual([
      'whatsapp_twilio', 'website_ui', 'whatsapp_openwa', 'whatsapp_meta',
    ]);
    expect(events.map((event) => event.expectedStateVersion)).toEqual([1, 1, 2, 3]);
    for (const event of events) {
      expect(event).toMatchObject({ userId, conversationId: start.conversationId,
        sessionId: start.sessionId, workflowId: start.workflowId,
        contextId: `task:${start.workflowId}` });
    }
    expect((await sessions.getAuthoritative(userId))?.criteria).toMatchObject({
      destination: 'Ella', category: 'Nature', preferredDate: '2026-11-14',
    });
  });

  it('keeps one excursion through WhatsApp, a paused website form, voice, and WhatsApp', async () => {
    const userId = 'whatsapp:+94770000001';
    const sessions = new ExcursionSearchSessionService(new FixtureStateStore() as any,
      new FixtureSessionRepository<ExcursionSearchSession>());
    await sessions.saveAwaitingPreferences(userId, { destination: 'Ella', category: 'Nature' });
    const loader = new ActiveConversationStateLoader({
      loadExcursion: async (id) => {
        const session = await sessions.getAuthoritative(id);
        return session && { id: session.id, revision: session.revision,
          lifecycleStatus: session.lifecycleStatus, flow: 'excursion', state: session.state,
          stage: session.stage, schema: 'search_excursions', fields: session.criteria,
          requiredFields: ['destination'], updatedAt: session.updatedAt };
      },
      loadHotel: async () => ({ id: 'paused-hotel', revision: 2, lifecycleStatus: 'paused',
        flow: 'hotel', state: 'awaiting_preferences', stage: 'awaiting_preferences',
        schema: 'search_hotels', fields: { location: 'Galle' }, requiredFields: ['location'],
        updatedAt: '2026-10-01T00:00:00.000Z' }),
      loadRestaurant: async () => ({ id: 'paused-restaurant', revision: 3, lifecycleStatus: 'paused',
        flow: 'restaurant', state: 'awaiting_preferences', stage: 'awaiting_preferences',
        schema: 'search_restaurants', fields: { location: 'Kandy' }, requiredFields: ['location'],
        updatedAt: '2026-10-02T00:00:00.000Z' }),
      loadLogistics: async () => null, loadItinerary: async () => null,
    });
    const control = new ConversationControlPlane({ stateLoader: loader, checkpoints: new JourneyEventCheckpointService({
      saveAccepted: async () => undefined, findByUserId: async () => null,
    }, new FixtureStateStore() as any) });
    const first = await control.acceptEvent(createInboundConversationEvent(normalizeInboundMessage({
      MessageSid: 'SM-excursion-start', From: userId, To: 'whatsapp:+14155238886', Body: 'Excursions in Ella',
    }), 'correlation-start'));
    const workflowId = first.workflowId!;
    expect(first.sessionId).toBe(first.conversationId.replace('conversation:', 'session:'));
    expect((await loader.loadWithPaused(userId)).pausedSessions).toHaveLength(2);

    const tokens = new FormTokenService();
    const token = tokens.createToken(userId, 'excursion');
    await sessions.pause(userId);
    const paused = (await sessions.getAuthoritative(userId))!;
    tokens.bindRevision(token, 'excursion', paused.revision!, paused.id);
    const bound = tokens.resolveToken(token, 'excursion')!;
    const form = await control.acceptEvent(createWebsiteConversationEvent({
      sourceEventId: bound.requestId!, correlationId: 'correlation-form', userId: bound.userId,
      channel: 'website_form', eventType: 'form_submission', workflowId: bound.workflowId,
      expectedStateVersion: bound.workflowRevision,
      payload: { formType: 'excursion', fields: { preferredDate: '2026-11-10', guests: 2 } },
    }));
    const reconciled = await control.reconcileFormSubmission(userId, 'excursion',
      { preferredDate: '2026-11-10', guests: 2 },
      { id: bound.workflowId, revision: bound.workflowRevision }, form);
    await sessions.saveAwaitingPreferences(userId, reconciled.collectedFields);
    expect((await sessions.getAuthoritative(userId))?.id).toBe(workflowId);

    const voice = await control.acceptEvent(createInboundConversationEvent(normalizeOpenWaInboundMessage({
      data: { id: 'OW-voice-change', from: '94770000001@c.us', type: 'ptt',
        mimetype: 'audio/ogg', mediaUrl: 'https://example.test/voice.ogg' },
    }), 'correlation-voice'));
    expect(voice.eventType).toBe('audio');
    await sessions.applyCriteriaPatch(userId, voice.expectedStateVersion!, { preferredTime: '09:00' });
    const last = await control.acceptEvent(createInboundConversationEvent(normalizeMetaWhatsAppInboundMessage({
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.excursion-return',
        from: '94770000001', type: 'text', text: { body: 'Continue my excursion' } }] } }] }],
    }), 'correlation-return'));

    for (const event of [first, form, voice, last]) {
      expect(event.userId).toBe(userId);
      expect(event.conversationId).toBe(first.conversationId);
      expect(event.sessionId).toBe(first.sessionId);
      expect(event.workflowId).toBe(workflowId);
    }
    expect(new Set([first, form, voice, last].map((event) => event.eventId)).size).toBe(4);
    expect([first, form, voice, last].map((event) => event.expectedStateVersion)).toEqual([1, 2, 3, 4]);
    expect((await sessions.getAuthoritative(userId))?.criteria).toMatchObject({
      destination: 'Ella', category: 'Nature', preferredDate: '2026-11-10', guests: 2,
      preferredTime: '09:00',
    });
    expect((await loader.loadWithPaused(userId)).pausedSessions).toHaveLength(2);
  });

  it('keeps one itinerary and revision from a website day selection back to WhatsApp', async () => {
    const userId = 'whatsapp:+94770000002';
    const store = new FixtureStateStore();
    const sessions = new ItinerarySessionService(store as any, new FixtureSessionRepository<ItinerarySession>());
    const criteria = { arrivalDate: '2026-12-01', departureDate: '2026-12-03', adults: 2 };
    const itinerary = await new ItineraryPlannerService().plan(criteria);
    await sessions.saveItinerary(userId, criteria, itinerary);
    const workspaces = new ItineraryWorkspaceService(store as any, sessions);
    const workspace = await workspaces.createWorkspace(userId, itinerary, criteria);
    const loader = new ActiveConversationStateLoader({
      loadHotel: async () => null, loadRestaurant: async () => null, loadExcursion: async () => null,
      loadLogistics: async () => null,
      loadItinerary: async (id) => {
        const session = await sessions.getAuthoritative(id);
        return session && { id: session.id, revision: session.revision,
          lifecycleStatus: session.lifecycleStatus, flow: 'itinerary', state: session.state,
          stage: session.state, schema: 'plan_itinerary', fields: session.criteria,
          requiredFields: ['arrivalDate', 'departureDate', 'adults'], updatedAt: session.updatedAt };
      },
    });
    const control = new ConversationControlPlane({ stateLoader: loader, checkpoints: new JourneyEventCheckpointService({
      saveAccepted: async () => undefined, findByUserId: async () => null,
    }, new FixtureStateStore() as any) });
    const selection = await control.acceptEvent(createWebsiteConversationEvent({
      sourceEventId: 'ui-select-day-2', correlationId: 'corr-ui-selection', userId,
      channel: 'website_ui', eventType: 'ui_selection', workflowId: workspace.tripId,
      expectedStateVersion: workspace.currentVersion,
      payload: { action: 'select_day', selectedDay: 2 },
    }));
    await workspaces.updateWorkspaceState(workspace.shareToken, { selectedDay: 2 });
    const whatsapp = await control.acceptEvent(createInboundConversationEvent(normalizeInboundMessage({
      MessageSid: 'SM-return-from-ui', From: userId, To: 'whatsapp:+14155238886', Body: 'Show my itinerary',
    }), 'corr-whatsapp-return'));
    expect(whatsapp).toMatchObject({ userId, conversationId: selection.conversationId,
      sessionId: selection.sessionId, workflowId: selection.workflowId,
      expectedStateVersion: selection.expectedStateVersion });
    expect(whatsapp.eventId).not.toBe(selection.eventId);
    expect((await workspaces.getWorkspace(workspace.shareToken))?.selectedDay).toBe(2);
    expect((await sessions.getAuthoritative(userId))?.criteria).toMatchObject(criteria);
  });
});
