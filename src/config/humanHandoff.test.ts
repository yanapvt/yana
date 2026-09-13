import { describe, expect, it } from 'vitest';
import { loadHumanHandoffConfig } from './humanHandoff.js';

describe('human handoff configuration', () => {
  it('is disabled with queue fallback and a deterministic SLA by default', () => {
    expect(loadHumanHandoffConfig({})).toEqual({
      enabled: false, nativeGroupEnabled: false, fallbackQueueEnabled: true,
      slaMinutes: 30, queueName: 'travel-concierge', operatorToken: undefined,
      slaPollSeconds: 60,
      queueProcessingEnabled: false, queueWorkerId: 'yana-handoff-worker', queueLeaseSeconds: 60,
      queueMaxAttempts: 5, queueBackoffSeconds: 30, queuePollSeconds: 10,
      alertQueueDepth: 100, alertOldestMinutes: 15, stagingDrillEnabled: false,
    });
  });

  it('requires a delivery path when enabled', () => {
    expect(() => loadHumanHandoffConfig({
      HUMAN_HANDOFF_ENABLED: 'true', HUMAN_HANDOFF_FALLBACK_QUEUE_ENABLED: 'false',
      HUMAN_HANDOFF_OPERATOR_TOKEN: 'test-token',
    })).toThrow('at least one delivery path');
  });

  it('requires an operator token when enabled', () => {
    expect(() => loadHumanHandoffConfig({ HUMAN_HANDOFF_ENABLED: 'true' }))
      .toThrow('HUMAN_HANDOFF_OPERATOR_TOKEN');
  });
});
