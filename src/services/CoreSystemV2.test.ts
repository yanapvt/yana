import { describe, expect, it } from 'vitest';
import { CoreSystemV2, type CoreV2Input } from './CoreSystemV2.js';

function input(text: string, overrides: Partial<CoreV2Input['user']> = {}): CoreV2Input {
  return {
    message: {
      messageId: 'SMcorev2',
      from: 'whatsapp:+15550000000',
      inputType: 'text',
      text,
    },
    user: {
      userId: 'whatsapp:+15550000000',
      profileComplete: true,
      activeFlow: 'none',
      ...overrides,
    },
  };
}

describe('CoreSystemV2', () => {
  it('requires profile before starting service recommendations', () => {
    const plan = new CoreSystemV2().plan(
      input('find me a hotel in Colombo', { profileComplete: false })
    );

    expect(plan.intent).toBe('hotel_search');
    expect(plan.targetFlow).toBe('profile');
    expect(plan.actions).toEqual([
      {
        type: 'require_profile',
        targetFlow: 'profile',
        reason: 'Profile-first gate must run before service recommendations.',
      },
    ]);
  });

  it('routes deterministic commands without asking the LLM', () => {
    const plan = new CoreSystemV2().plan(input('next', { activeFlow: 'hotel' }));

    expect(plan.intent).toBe('command');
    expect(plan.targetFlow).toBe('hotel');
    expect(plan.shouldUseLLM).toBe(false);
    expect(plan.actions[0]).toMatchObject({
      type: 'handle_command',
      targetFlow: 'hotel',
    });
  });

  it('keeps active flow ownership for unclear follow-up messages', () => {
    const plan = new CoreSystemV2().plan(input('maybe quieter', { activeFlow: 'restaurant' }));

    expect(plan.intent).toBe('unclear');
    expect(plan.targetFlow).toBe('restaurant');
    expect(plan.shouldUseLLM).toBe(true);
    expect(plan.actions[0]).toMatchObject({
      type: 'continue_flow',
      targetFlow: 'restaurant',
    });
  });

  it('detects a clear switch from hotel to restaurant', () => {
    const plan = new CoreSystemV2().plan(
      input('actually I need a rooftop restaurant', { activeFlow: 'hotel' })
    );

    expect(plan.intent).toBe('restaurant_search');
    expect(plan.targetFlow).toBe('restaurant');
    expect(plan.actions[0]).toMatchObject({
      type: 'switch_flow',
      targetFlow: 'restaurant',
    });
  });

  it('starts a logistics flow from a fresh request', () => {
    const plan = new CoreSystemV2().plan(input('I need an airport pickup tomorrow'));

    expect(plan.intent).toBe('logistics_request');
    expect(plan.targetFlow).toBe('logistics');
    expect(plan.actions[0]).toMatchObject({
      type: 'start_flow',
      targetFlow: 'logistics',
    });
  });
});
