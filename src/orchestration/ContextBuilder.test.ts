import { describe, expect, it } from 'vitest';
import type { InboundMessage, StoredProfile } from '../types/index.js';
import { ContextBuilder, modelContext } from './ContextBuilder.js';

describe('ContextBuilder', () => {
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
        requiredFields: ['location'], missingFields: [], verifiedResults: { source: 'google_places', retrievedAt: '2026-10-22T00:00:00Z',
          items: [{ position: 1, name: 'One' }, { position: 2, name: 'Two' }] } },
      pausedSessions: [{ flow: 'hotel', activeSchema: 'search_hotels', collectedFields: { location: 'Galle' },
        requiredFields: ['location', 'checkinDate'], missingFields: ['checkinDate'] }], metadata: { correlationId: 'corr-2' } });

    const projected = modelContext(context);
    expect(projected.verifiedResults?.items[1]).toEqual({ position: 2, name: 'Two' });
    expect(projected.pausedTasks?.[0]).toMatchObject({ currentIntent: 'hotel', collectedFields: { location: 'Galle' } });
  });
});
