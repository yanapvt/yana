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
      operatorDashboardEnabled: false, operatorDashboardSessionMinutes: 30, operatorDashboardSecureCookies: true,
      operatorDashboardSessionStore: 'memory', operatorDashboardSessionKeysJson: undefined, operatorDashboardActiveKeyId: undefined,
      operatorDashboardLocalTokenEnabled: false, operatorOidcEnabled: false, operatorOidcIssuer: undefined, operatorOidcClientId: undefined,
      operatorOidcRedirectUri: undefined, operatorOidcRoleClaim: 'roles', operatorOidcRoleMappingJson: '{}', operatorAuthRetentionDays: 30,
      operatorOidcAuthorizationEndpoint: undefined, operatorOidcTokenEndpoint: undefined,
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

  it('requires an explicitly enabled dashboard authentication method', () => {
    expect(() => loadHumanHandoffConfig({ HUMAN_HANDOFF_DASHBOARD_ENABLED: 'true' }))
      .toThrow('authentication method');
  });

  it('requires encryption keys for the shared Postgres session store', () => {
    expect(() => loadHumanHandoffConfig({
      HUMAN_HANDOFF_DASHBOARD_ENABLED: 'true',
      HUMAN_HANDOFF_DASHBOARD_LOCAL_TOKEN_ENABLED: 'true',
      HUMAN_HANDOFF_DASHBOARD_SESSION_STORE: 'postgres',
    })).toThrow('encryption keys');
  });

  it('requires exact OIDC configuration only when OIDC is enabled', () => {
    expect(() => loadHumanHandoffConfig({
      HUMAN_HANDOFF_DASHBOARD_ENABLED: 'true',
      HUMAN_HANDOFF_OIDC_ENABLED: 'true',
    })).toThrow('issuer, client ID, exact redirect URI, authorization endpoint, and token endpoint');
  });

  it('rejects unsafe endpoints and deny-all OIDC role configuration', () => {
    const configured = {
      HUMAN_HANDOFF_DASHBOARD_ENABLED: 'true', HUMAN_HANDOFF_OIDC_ENABLED: 'true',
      HUMAN_HANDOFF_OIDC_ISSUER: 'https://id.example', HUMAN_HANDOFF_OIDC_CLIENT_ID: 'yana',
      HUMAN_HANDOFF_OIDC_REDIRECT_URI: 'https://ops.example/operator/oidc/callback',
      HUMAN_HANDOFF_OIDC_AUTHORIZATION_ENDPOINT: 'https://id.example/authorize',
      HUMAN_HANDOFF_OIDC_TOKEN_ENDPOINT: 'https://id.example/token',
    };
    expect(() => loadHumanHandoffConfig(configured)).toThrow('role mapping');
    expect(() => loadHumanHandoffConfig({ ...configured, HUMAN_HANDOFF_OIDC_ROLE_MAPPING_JSON: '{"ops":"operator"}', HUMAN_HANDOFF_OIDC_TOKEN_ENDPOINT: 'http://id.example/token' })).toThrow('HTTPS');
    expect(loadHumanHandoffConfig({ ...configured, HUMAN_HANDOFF_OIDC_ROLE_MAPPING_JSON: '{"ops":"operator"}' }).operatorOidcEnabled).toBe(true);
  });
});
