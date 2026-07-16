import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../types/index.js';
import { Orchestrator, type LLMInterpreter } from './Orchestrator.js';

function inbound(text: string): InboundMessage {
  return {
    messageId: 'SM1',
    from: 'whatsapp:+15550000000',
    to: 'whatsapp:+14155238886',
    timestamp: new Date('2026-06-22T00:00:00.000Z'),
    type: 'text',
    inputType: 'text',
    content: { type: 'text', body: text },
  };
}

describe('Orchestrator', () => {
  it('coordinates deterministic planning without invoking the LLM interpreter', async () => {
    const llmInterpreter: LLMInterpreter = {
      interpret: vi.fn(),
    };

    const result = await new Orchestrator({ llmInterpreter }).plan({
      inboundMessage: inbound('find a hotel in Colombo'),
      text: 'find a hotel in Colombo',
      profileComplete: false,
    });

    expect(result.decision.action).toBe('require_profile');
    expect(result.decision.confidence).toBe(0.9);
    expect(llmInterpreter.interpret).not.toHaveBeenCalled();
  });

  it('uses LLM as interpreter only when deterministic analysis needs help', async () => {
    const llmInterpreter: LLMInterpreter = {
      interpret: vi.fn().mockResolvedValue({
        role: 'extra_preference',
        intent: 'restaurant_search',
        entities: { guests: 2 },
        confidence: 0.88,
      }),
    };

    const result = await new Orchestrator({ llmInterpreter }).plan({
      inboundMessage: inbound('for two please'),
      text: 'for two please',
      profileComplete: true,
      activeSession: {
        flow: 'restaurant',
        state: 'collecting_required_details',
        activeSchema: 'search_restaurants',
        collectedFields: { location: 'Colombo' },
        requiredFields: ['location', 'guests'],
        missingFields: ['guests'],
      },
    });

    expect(result.prompt).toContain('Do not execute tools');
    expect(llmInterpreter.interpret).toHaveBeenCalledOnce();
    expect(result.interpretation?.entities).toEqual({ guests: 2 });
    expect(result.decision.action).toBe('execute_search');
    expect(result.memoryUpdate.shouldPersist).toBe(true);
  });
});
