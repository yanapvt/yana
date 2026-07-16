import { describe, expect, it } from 'vitest';
import type { InboundMessage, StoredProfile } from '../types/index.js';
import { ContextBuilder } from './ContextBuilder.js';

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
});
