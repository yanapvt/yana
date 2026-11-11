import { describe, expect, it } from 'vitest';
import { assertLegacyRoutingConfiguration } from './environment.js';

describe('legacy conversational routing configuration', () => {
  it.each(['development', 'staging', 'production'])(
    'rejects the compatibility fallback in %s', (nodeEnv) => {
      expect(() => assertLegacyRoutingConfiguration(nodeEnv, 'true'))
        .toThrow('LEGACY_CONVERSATION_ROUTING_FALLBACK is not supported outside tests');
      expect(() => assertLegacyRoutingConfiguration(nodeEnv, 'false')).not.toThrow();
      expect(() => assertLegacyRoutingConfiguration(nodeEnv, undefined)).not.toThrow();
    }
  );

  it('allows the compatibility fixture only in the test environment', () => {
    expect(() => assertLegacyRoutingConfiguration('test', 'true')).not.toThrow();
  });
});
