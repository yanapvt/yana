import { describe, expect, it } from 'vitest';
import type { InboundMessage, StoredProfile } from '../types/index.js';
import { ContextBuilder, modelContext } from './ContextBuilder.js';

describe('ContextBuilder', () => {
  it('keeps a conversational question with an active task and ignores a stale one', () => {
    const inboundMessage: InboundMessage = {
      messageId: 'SM-question', from: 'whatsapp:+15550000000', to: 'whatsapp:+14155238886',
      timestamp: new Date('2026-11-09T00:00:00Z'), type: 'text', inputType: 'text',
      content: { type: 'text', body: 'A quiet one' },
    };
    const activeSession = { id: 'restaurant-task', flow: 'restaurant' as const, state: 'awaiting_preferences',
      collectedFields: { location: 'Mirissa' }, requiredFields: ['location'], missingFields: [] };
    const builder = new ContextBuilder();
    const current = builder.build({ inboundMessage, text: 'A quiet one', profileComplete: true,
      activeSession, conversationHistory: [
        { role: 'user', content: 'Mirissa' },
        { role: 'assistant', content: 'Would you prefer a quiet place or somewhere lively?' },
      ] });
    expect(modelContext(current).pendingQuestion?.text).toContain('Would you prefer');
    expect(modelContext(current).conversationTopic).toBe('restaurant');

    const stale = builder.build({ inboundMessage, text: 'A quiet one', profileComplete: true,
      activeSession, conversationHistory: [
        { role: 'assistant', content: 'Would you prefer a quiet place or somewhere lively?' },
        { role: 'user', content: 'I will decide later' },
      ] });
    expect(modelContext(stale).pendingQuestion).toBeUndefined();
  });

  it('does not mistake a provider result URL query for an outstanding question', () => {
    const inboundMessage: InboundMessage = {
      messageId: 'SM-url', from: 'whatsapp:+15550000000', to: 'whatsapp:+14155238886',
      timestamp: new Date(), type: 'text', inputType: 'text',
      content: { type: 'text', body: 'Somewhere romantic' },
    };
    const context = new ContextBuilder().build({ inboundMessage, text: 'Somewhere romantic',
      profileComplete: true, conversationHistory: [{ role: 'assistant',
        content: '[Generated reply; delivery not verified] Here are options: https://maps.google.com/?cid=123' }] });
    expect(context.pendingQuestion).toBeUndefined();
  });

  it('builds an immutable orchestration context from inbound input', () => {
    const inboundMessage: InboundMessage = {
      messageId: 'SM1',
      from: 'whatsapp:+15550000000',
      to: 'whatsapp:+14155238886',
      timestamp: new Date('2026-06-22T00:00:00.000Z'),
      type: 'text',
      inputType: 'text',
      content: { type: 'text', body: ' Find a hotel in Colombo ' },
    };
    const profile: StoredProfile = {
      userId: inboundMessage.from,
      createdAt: new Date(),
      updatedAt: new Date(),
      form: {
        fullName: 'Sam Traveler',
        preferredName: 'Sam',
        email: 'sam@example.com',
        phone: '+15550000000',
        preferredLanguage: 'English',
        nationality: 'Sri Lankan',
        countryOfResidence: 'Sri Lanka',
        city: 'Colombo',
        dateOfBirth: '1990-01-01',
        preferredCurrency: 'USD',
        travelStyle: 'Boutique',
        consent: true,
      },
    };

    const activeSession = {
      flow: 'hotel' as const,
      state: 'awaiting_extra_preferences',
      collectedFields: { location: 'Colombo' },
      requiredFields: ['location', 'guests'],
      missingFields: ['guests'],
    };

    const context = new ContextBuilder().build({
      inboundMessage,
      text: ' Find a hotel in Colombo ',
      profile,
      profileComplete: true,
      activeSession,
      metadata: { correlationId: 'corr-1' },
    });

    expect(context.message.text).toBe('Find a hotel in Colombo');
    expect(context.profile?.preferredName).toBe('Sam');
    expect(context.activeSession?.collectedFields).toEqual({ location: 'Colombo' });

    activeSession.collectedFields.location = 'Kandy';
    expect(context.activeSession?.collectedFields).toEqual({ location: 'Colombo' });
  });

  it('projects paused tasks and grounded result positions into bounded model context', () => {
    const inboundMessage: InboundMessage = {
      messageId: 'SM2', from: 'whatsapp:+15550000000', to: 'whatsapp:+14155238886',
      timestamp: new Date('2026-10-22T00:00:00.000Z'), type: 'text', inputType: 'text',
      content: { type: 'text', body: 'What about the second one?' },
    };
    const context = new ContextBuilder().build({ inboundMessage, text: 'What about the second one?', profileComplete: true,
      activeSession: { flow: 'restaurant', activeSchema: 'search_restaurants', collectedFields: { location: 'Colombo' },
        pendingDecisions: { locationConfirmation: 'Hikkaduwa' },
        requiredFields: ['location'], missingFields: [], verifiedResults: { source: 'google_places', retrievedAt: '2026-10-22T00:00:00Z',
          items: [{ position: 1, name: 'One' }, { position: 2, name: 'Two' }] } },
      pausedSessions: [{ flow: 'hotel', activeSchema: 'search_hotels', collectedFields: { location: 'Galle' },
        requiredFields: ['location', 'checkinDate'], missingFields: ['checkinDate'] }],
      metadata: { correlationId: 'corr-2', channel: 'website_ui', eventType: 'ui_selection' } });

    const projected = modelContext(context);
    expect(projected.verifiedResults?.items[1]).toEqual({ position: 2, name: 'Two' });
    expect(projected.sessionState?.pendingDecisions).toEqual({ locationConfirmation: 'Hikkaduwa' });
    expect(projected.pausedTasks?.[0]).toMatchObject({ currentIntent: 'hotel', collectedFields: { location: 'Galle' } });
    expect(projected).toMatchObject({ channel: 'website_ui', eventType: 'ui_selection' });
  });

  it('projects the current itinerary UI selection and an unconfirmed transaction without tokens', () => {
    const inboundMessage: InboundMessage = {
      messageId: 'SM-context', from: 'whatsapp:+15550000000', to: 'whatsapp:+14155238886',
      timestamp: new Date('2026-11-09T00:00:00Z'), type: 'text', inputType: 'text',
      content: { type: 'text', body: 'Continue day two' },
    };
    const itinerary = new ContextBuilder().build({ inboundMessage, text: 'Continue day two',
      profileComplete: true,
      activeSession: { id: 'trip-1', flow: 'itinerary', state: 'editing_itinerary',
        collectedFields: { destination: 'Galle' }, requiredFields: [], missingFields: [] },
      uiWorkspace: { workflowId: 'trip-1', selectedDay: 2, revision: 6 },
      metadata: { channel: 'whatsapp_openwa', sessionId: 'session:one', conversationId: 'conversation:one' },
    });
    expect(modelContext(itinerary)).toMatchObject({
      sessionId: 'session:one', conversationId: 'conversation:one',
      uiWorkspace: { workflowId: 'trip-1', selectedDay: 2, revision: 6 },
    });
    const pending = new ContextBuilder().build({ inboundMessage, text: 'Is it booked?', profileComplete: true,
      activeSession: { id: 'hotel-1', flow: 'hotel', state: 'booking_provider_pending',
        collectedFields: { location: 'Galle' }, requiredFields: [], missingFields: [] },
      uiWorkspace: { workflowId: 'trip-1', selectedDay: 2, revision: 6 },
    });
    expect(modelContext(pending).pendingTransaction).toEqual({
      workflowId: 'hotel-1', flow: 'hotel', stage: 'booking_provider_pending', confirmed: false,
    });
    expect(modelContext(pending).uiWorkspace).toBeUndefined();
    const pausedItinerary = new ContextBuilder().build({ inboundMessage, text: 'What about day two?',
      profileComplete: true, activeSession: pending.activeSession,
      pausedSessions: [{ id: 'trip-1', flow: 'itinerary', state: 'editing_itinerary',
        collectedFields: {}, requiredFields: [], missingFields: [] }],
      uiWorkspace: { workflowId: 'trip-1', selectedDay: 2, revision: 6 },
    });
    expect(modelContext(pausedItinerary).uiWorkspace?.selectedDay).toBe(2);
  });

  it('labels memory provenance and excludes expired location and pending confirmation facts', () => {
    const inboundMessage: InboundMessage = {
      messageId: 'SM-fresh', from: 'whatsapp:+15550000000', to: 'whatsapp:+14155238886',
      timestamp: new Date('2026-11-06T00:00:00Z'), type: 'text', inputType: 'text',
      content: { type: 'text', body: 'Where can we eat near me?' },
    };
    const fact = (id: string, status: 'confirmed' | 'proposed', expiresAt: string) => ({
      id, userId: inboundMessage.from, key: 'current_location' as const,
      value: id === 'fresh' ? 'Galle' : 'Colombo', scope: 'trip' as const,
      confidence: 1, explicit: true, sensitive: false, sourceMessageId: 'SM-old',
      status, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', expiresAt,
    });
    const context = new ContextBuilder().build({ inboundMessage,
      text: 'Where can we eat near me?', profileComplete: true,
      travellerMemories: [fact('fresh', 'confirmed', '2099-01-01T00:00:00Z'),
        fact('expired', 'confirmed', '2000-01-01T00:00:00Z'),
        fact('pending-expired', 'proposed', '2000-01-01T00:00:00Z')],
    });
    const projected = modelContext(context);
    expect(projected.userMessage).toBe('Where can we eat near me?');
    expect(projected.travellerContext?.confirmedFacts).toEqual([expect.objectContaining({
      key: 'current_location', value: 'Galle', source: 'confirmed_traveller_memory',
      updatedAt: '2026-11-02T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
    })]);
    expect(projected.travellerContext?.pendingConfirmations).toEqual([]);
    expect(JSON.stringify(projected)).not.toContain('SM-old');
  });
});
