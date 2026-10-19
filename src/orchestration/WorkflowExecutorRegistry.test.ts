import { describe, expect, it, vi } from 'vitest';
import type { OrchestrationResult } from './Orchestrator.js';
import { WorkflowExecutorRegistry } from './WorkflowExecutorRegistry.js';

function plan(targetFlow: 'restaurant' | 'hotel', activeFlow?: 'restaurant' | 'hotel') {
  return {
    context: {
      userId: 'user-1',
      profileComplete: true,
      message: { messageId: 'm1', from: 'user-1', inputType: 'text', text: 'Kollupitiya' },
      activeSession: activeFlow ? {
        flow: activeFlow,
        collectedFields: {},
        requiredFields: [],
        missingFields: [],
      } : undefined,
      metadata: {},
    },
    analysis: {
      role: 'answer_to_current_question',
      intent: targetFlow === 'restaurant' ? 'restaurant_search' : 'hotel_search',
      targetFlow,
      entities: {},
      confidence: 1,
      rawText: 'Kollupitiya',
      shouldUseLLM: false,
    },
    decision: {
      action: 'continue_flow',
      intent: targetFlow === 'restaurant' ? 'restaurant_search' : 'hotel_search',
      targetFlow,
      confidence: 1,
      entities: {},
      missingFields: [],
      reason: 'test',
    },
    memoryUpdate: { shouldPersist: false, reason: 'test' },
  } as OrchestrationResult;
}

describe('WorkflowExecutorRegistry', () => {
  it('executes only the workflow selected by the Orchestrator', async () => {
    const restaurant = vi.fn().mockResolvedValue({ handled: true, reply: 'restaurants' });
    const hotel = vi.fn().mockResolvedValue({ handled: true, reply: 'hotels' });
    const registry = new WorkflowExecutorRegistry<Record<string, never>>();
    registry.register('restaurant', restaurant);
    registry.register('hotel', hotel);

    const result = await registry.execute(plan('restaurant', 'restaurant'), {}, {
      requireActiveFlow: true,
    });

    expect(result).toEqual({ handled: true, reply: 'restaurants' });
    expect(restaurant).toHaveBeenCalledOnce();
    expect(hotel).not.toHaveBeenCalled();
  });

  it('does not let a new intent consume the old active workflow as a continuation', async () => {
    const registry = new WorkflowExecutorRegistry<Record<string, never>>();
    const restaurant = vi.fn().mockResolvedValue({ handled: true, reply: 'restaurants' });
    registry.register('restaurant', restaurant);

    const result = await registry.execute(plan('restaurant', 'hotel'), {}, {
      requireActiveFlow: true,
    });

    expect(result).toEqual({ handled: false });
    expect(restaurant).not.toHaveBeenCalled();
  });

  it('rejects duplicate executor registration', () => {
    const registry = new WorkflowExecutorRegistry<Record<string, never>>();
    registry.register('restaurant', vi.fn());
    expect(() => registry.register('restaurant', vi.fn())).toThrow(
      'Workflow executor already registered: restaurant'
    );
  });
});
