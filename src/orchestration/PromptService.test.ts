import { describe, expect, it } from 'vitest';
import { PromptService } from './PromptService.js';
import type { ConversationAnalysis, OrchestrationContext } from './Orchestrator.js';

describe('PromptService', () => {
  it('builds an interpreter prompt that keeps LLM in interpreter mode only', () => {
    const context: OrchestrationContext = {
      userId: 'whatsapp:+15550000000',
      profileComplete: true,
      message: {
        messageId: 'SM1',
        from: 'whatsapp:+15550000000',
        inputType: 'text',
        text: 'rooftop please',
      },
      activeSession: {
        flow: 'restaurant',
        state: 'collecting_extra_preferences',
        collectedFields: { location: 'Colombo', guests: 2 },
        requiredFields: ['location', 'guests'],
        missingFields: [],
      },
      metadata: {},
    };
    const analysis: ConversationAnalysis = {
      role: 'extra_preference',
      intent: 'unclear',
      targetFlow: 'restaurant',
      entities: {},
      confidence: 0.55,
      rawText: 'rooftop please',
      shouldUseLLM: true,
    };

    const prompt = new PromptService().buildInterpreterPrompt(context, analysis);

    expect(prompt).toContain('Interpret the user message only');
    expect(prompt).toContain('Do not execute tools');
    expect(prompt).toContain('Active flow: restaurant');
    expect(prompt).toContain('rooftop please');
  });

  it('builds response guidance with profile preferences', () => {
    const prompt = new PromptService().buildResponseGuidance({
      userId: 'whatsapp:+15550000000',
      profileComplete: true,
      profile: {
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
      message: {
        messageId: 'SM1',
        from: 'whatsapp:+15550000000',
        inputType: 'text',
        text: 'hi',
      },
      metadata: {},
    });

    expect(prompt).toContain('Preferred name: Sam');
    expect(prompt).toContain('Preferred language: English');
  });
});
