import { describe, expect, it } from 'vitest';
import { ConversationAnalyzer } from './ConversationAnalyzer.js';
import type { OrchestrationContext } from './Orchestrator.js';

function context(text: string): OrchestrationContext {
  return {
    userId: 'whatsapp:+15550000000',
    profileComplete: true,
    message: {
      messageId: 'SM1',
      from: 'whatsapp:+15550000000',
      inputType: 'text',
      text,
    },
    metadata: {},
  };
}

describe('ConversationAnalyzer', () => {
  it('detects deterministic commands with selection entities', () => {
    const result = new ConversationAnalyzer().analyze(context('details 2'));

    expect(result.role).toBe('command');
    expect(result.command).toBe('details');
    expect(result.entities).toEqual({ selection: 2 });
    expect(result.shouldUseLLM).toBe(false);
  });

  it('detects restaurant intent and extracts common entities', () => {
    const result = new ConversationAnalyzer().analyze(
      context('Find a vegetarian rooftop restaurant in Colombo for 4')
    );

    expect(result.intent).toBe('restaurant_search');
    expect(result.targetFlow).toBe('restaurant');
    expect(result.entities).toMatchObject({
      location: 'Colombo',
      guests: 4,
      seatingPreference: 'Rooftop',
      dietaryPreferences: 'Vegetarian',
    });
  });

  it('marks side questions for LLM interpretation', () => {
    const result = new ConversationAnalyzer().analyze(context('does that include breakfast?'));

    expect(result.role).toBe('question_or_faq');
    expect(result.question).toBe('does that include breakfast?');
    expect(result.shouldUseLLM).toBe(true);
  });
});
