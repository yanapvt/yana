import { describe, expect, it } from 'vitest';
import { loadHumanHandoffConfig } from './humanHandoff.js';

describe('human handoff configuration', () => {
  it('is disabled with queue fallback and a deterministic SLA by default', () => {
    expect(loadHumanHandoffConfig({})).toEqual({
      enabled: false, nativeGroupEnabled: false, fallbackQueueEnabled: true,
      slaMinutes: 30, queueName: 'travel-concierge', operatorIdentitiesJson: undefined,
      slaPollSeconds: 60,
      queueProcessingEnabled: false, queueWorkerId: 'yana-handoff-worker', queueLeaseSeconds: 60,
      queueMaxAttempts: 5, queueBackoffSeconds: 30, queuePollSeconds: 10,
      alertQueueDepth: 100, alertOldestMinutes: 15, stagingDrillEnabled: false,
      staffPublicationEnabled: false, staffPublicationProvider: 'none', staffPublicationEndpoint: undefined, staffPublicationAuthToken: undefined,
      providerTimeoutMs: 10000, alertDeliveryEnabled: false, alertDeliveryProvider: 'none', alertDeliveryEndpoint: undefined, alertDeliveryAuthToken: undefined,
    });
  });

  it('requires a delivery path when enabled', () => {
    expect(() => loadHumanHandoffConfig({
      HUMAN_HANDOFF_ENABLED: 'true', HUMAN_HANDOFF_FALLBACK_QUEUE_ENABLED: 'false',
      HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON: '[]',
    })).toThrow('at least one delivery path');
  });

  it('requires scoped operator identities when enabled', () => {
    expect(() => loadHumanHandoffConfig({ HUMAN_HANDOFF_ENABLED: 'true' }))
      .toThrow('HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON');
  });
  it('requires explicit supported providers only when a delivery path is enabled', () => {
    expect(() => loadHumanHandoffConfig({ HUMAN_HANDOFF_STAFF_PUBLICATION_ENABLED:'true', HUMAN_HANDOFF_STAFF_PUBLICATION_PROVIDER:'none' })).toThrow('provider and endpoint');
    expect(() => loadHumanHandoffConfig({ HUMAN_HANDOFF_ALERT_DELIVERY_ENABLED:'true', HUMAN_HANDOFF_ALERT_DELIVERY_PROVIDER:'other', HUMAN_HANDOFF_ALERT_DELIVERY_ENDPOINT:'https://example.test' })).toThrow('provider and endpoint');
    expect(() => loadHumanHandoffConfig({ HUMAN_HANDOFF_ALERT_DELIVERY_ENABLED:'true', HUMAN_HANDOFF_ALERT_DELIVERY_PROVIDER:'http', HUMAN_HANDOFF_ALERT_DELIVERY_ENDPOINT:'http://example.test' })).toThrow('HTTPS');
  });
});
