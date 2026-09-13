export interface HumanHandoffConfig {
  enabled: boolean;
  nativeGroupEnabled: boolean;
  fallbackQueueEnabled: boolean;
  slaMinutes: number;
  queueName: string;
  operatorIdentitiesJson?: string;
  slaPollSeconds: number;
  queueProcessingEnabled: boolean;
  queueWorkerId: string;
  queueLeaseSeconds: number;
  queueMaxAttempts: number;
  queueBackoffSeconds: number;
  queuePollSeconds: number;
  alertQueueDepth: number;
  alertOldestMinutes: number;
  stagingDrillEnabled: boolean;
  staffPublicationEnabled: boolean;
  staffPublicationProvider: string;
  staffPublicationEndpoint?: string;
  staffPublicationAuthToken?: string;
  providerTimeoutMs: number;
  alertDeliveryEnabled: boolean;
  alertDeliveryProvider: string;
  alertDeliveryEndpoint?: string;
  alertDeliveryAuthToken?: string;
  operatorDashboardEnabled: boolean;
  operatorDashboardSessionMinutes: number;
  operatorDashboardSecureCookies: boolean;
  operatorDashboardSessionStore: string;
  operatorDashboardSessionKeysJson?: string;
  operatorDashboardActiveKeyId?: string;
  operatorDashboardLocalTokenEnabled: boolean;
  operatorOidcEnabled: boolean;
  operatorOidcIssuer?: string;
  operatorOidcClientId?: string;
  operatorOidcRedirectUri?: string;
  operatorOidcRoleClaim: string;
  operatorOidcRoleMappingJson: string;
  operatorAuthRetentionDays: number;
}

type EnvironmentSource = Record<string, string | undefined>;

export function loadHumanHandoffConfig(source: EnvironmentSource = process.env): HumanHandoffConfig {
  const config = {
    enabled: readBoolean(source.HUMAN_HANDOFF_ENABLED, false),
    nativeGroupEnabled: readBoolean(source.HUMAN_HANDOFF_NATIVE_GROUP_ENABLED, false),
    fallbackQueueEnabled: readBoolean(source.HUMAN_HANDOFF_FALLBACK_QUEUE_ENABLED, true),
    slaMinutes: readPositiveInteger(source.HUMAN_HANDOFF_SLA_MINUTES, 30),
    queueName: source.HUMAN_HANDOFF_QUEUE_NAME?.trim() || 'travel-concierge',
    operatorIdentitiesJson: source.HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON?.trim() || undefined,
    slaPollSeconds: readPositiveInteger(source.HUMAN_HANDOFF_SLA_POLL_SECONDS, 60),
    queueProcessingEnabled: readBoolean(source.HUMAN_HANDOFF_QUEUE_PROCESSING_ENABLED, false),
    queueWorkerId: source.HUMAN_HANDOFF_QUEUE_WORKER_ID?.trim() || 'yana-handoff-worker',
    queueLeaseSeconds: readPositiveInteger(source.HUMAN_HANDOFF_QUEUE_LEASE_SECONDS, 60),
    queueMaxAttempts: readPositiveInteger(source.HUMAN_HANDOFF_QUEUE_MAX_ATTEMPTS, 5),
    queueBackoffSeconds: readPositiveInteger(source.HUMAN_HANDOFF_QUEUE_BACKOFF_SECONDS, 30),
    queuePollSeconds: readPositiveInteger(source.HUMAN_HANDOFF_QUEUE_POLL_SECONDS, 10),
    alertQueueDepth: readPositiveInteger(source.HUMAN_HANDOFF_ALERT_QUEUE_DEPTH, 100),
    alertOldestMinutes: readPositiveInteger(source.HUMAN_HANDOFF_ALERT_OLDEST_MINUTES, 15),
    stagingDrillEnabled: readBoolean(source.HUMAN_HANDOFF_STAGING_DRILL_ENABLED, false),
    staffPublicationEnabled: readBoolean(source.HUMAN_HANDOFF_STAFF_PUBLICATION_ENABLED, false),
    staffPublicationProvider: source.HUMAN_HANDOFF_STAFF_PUBLICATION_PROVIDER?.trim() || 'none',
    staffPublicationEndpoint: source.HUMAN_HANDOFF_STAFF_PUBLICATION_ENDPOINT?.trim() || undefined,
    staffPublicationAuthToken: source.HUMAN_HANDOFF_STAFF_PUBLICATION_AUTH_TOKEN?.trim() || undefined,
    providerTimeoutMs: readPositiveInteger(source.HUMAN_HANDOFF_PROVIDER_TIMEOUT_MS, 10000),
    alertDeliveryEnabled: readBoolean(source.HUMAN_HANDOFF_ALERT_DELIVERY_ENABLED, false),
    alertDeliveryProvider: source.HUMAN_HANDOFF_ALERT_DELIVERY_PROVIDER?.trim() || 'none',
    alertDeliveryEndpoint: source.HUMAN_HANDOFF_ALERT_DELIVERY_ENDPOINT?.trim() || undefined,
    alertDeliveryAuthToken: source.HUMAN_HANDOFF_ALERT_DELIVERY_AUTH_TOKEN?.trim() || undefined,
    operatorDashboardEnabled: readBoolean(source.HUMAN_HANDOFF_DASHBOARD_ENABLED, false),
    operatorDashboardSessionMinutes: readPositiveInteger(source.HUMAN_HANDOFF_DASHBOARD_SESSION_MINUTES, 30),
    operatorDashboardSecureCookies: readBoolean(source.HUMAN_HANDOFF_DASHBOARD_SECURE_COOKIES, true),
    operatorDashboardSessionStore: source.HUMAN_HANDOFF_DASHBOARD_SESSION_STORE?.trim() || 'memory',
    operatorDashboardSessionKeysJson: source.HUMAN_HANDOFF_DASHBOARD_SESSION_KEYS_JSON?.trim() || undefined,
    operatorDashboardActiveKeyId: source.HUMAN_HANDOFF_DASHBOARD_ACTIVE_KEY_ID?.trim() || undefined,
    operatorDashboardLocalTokenEnabled: readBoolean(source.HUMAN_HANDOFF_DASHBOARD_LOCAL_TOKEN_ENABLED, false),
    operatorOidcEnabled: readBoolean(source.HUMAN_HANDOFF_OIDC_ENABLED, false),
    operatorOidcIssuer: source.HUMAN_HANDOFF_OIDC_ISSUER?.trim() || undefined,
    operatorOidcClientId: source.HUMAN_HANDOFF_OIDC_CLIENT_ID?.trim() || undefined,
    operatorOidcRedirectUri: source.HUMAN_HANDOFF_OIDC_REDIRECT_URI?.trim() || undefined,
    operatorOidcRoleClaim: source.HUMAN_HANDOFF_OIDC_ROLE_CLAIM?.trim() || 'roles',
    operatorOidcRoleMappingJson: source.HUMAN_HANDOFF_OIDC_ROLE_MAPPING_JSON?.trim() || '{}',
    operatorAuthRetentionDays: readPositiveInteger(source.HUMAN_HANDOFF_AUTH_RETENTION_DAYS, 30),
  };
  if (config.enabled && !config.nativeGroupEnabled && !config.fallbackQueueEnabled) {
    throw new Error('Enabled human handoff requires at least one delivery path');
  }
  if (config.enabled && !hasOperatorIdentities(config.operatorIdentitiesJson)) {
    throw new Error('Enabled human handoff requires HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON');
  }
  if (config.staffPublicationEnabled && (config.staffPublicationProvider !== 'http' || !config.staffPublicationEndpoint)) {
    throw new Error('Enabled staff publication requires a provider and endpoint');
  }
  if (config.alertDeliveryEnabled && (config.alertDeliveryProvider !== 'http' || !config.alertDeliveryEndpoint)) {
    throw new Error('Enabled handoff alert delivery requires a provider and endpoint');
  }
  if (config.staffPublicationEnabled) requireSafeEndpoint(config.staffPublicationEndpoint!);
  if (config.alertDeliveryEnabled) requireSafeEndpoint(config.alertDeliveryEndpoint!);
  if (!['memory','postgres'].includes(config.operatorDashboardSessionStore)) throw new Error('Unsupported dashboard session store');
  if (config.operatorDashboardEnabled && !config.operatorDashboardLocalTokenEnabled && !config.operatorOidcEnabled) throw new Error('Dashboard requires an explicitly enabled authentication method');
  if (config.operatorDashboardEnabled && config.operatorDashboardSessionStore === 'postgres' && (!config.operatorDashboardSessionKeysJson || !config.operatorDashboardActiveKeyId)) throw new Error('Postgres dashboard sessions require encryption keys and an active key ID');
  if (config.operatorOidcEnabled && (!config.operatorOidcIssuer || !config.operatorOidcClientId || !config.operatorOidcRedirectUri)) throw new Error('OIDC requires issuer, client ID, and redirect URI');
  if (config.operatorOidcEnabled) { requireSafeEndpoint(config.operatorOidcIssuer!); requireSafeEndpoint(config.operatorOidcRedirectUri!); }
  return config;
}

function requireSafeEndpoint(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Handoff provider endpoint must be a valid URL'); }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Handoff provider endpoint must use HTTPS');
}

function hasOperatorIdentities(value?: string): boolean {
  if (!value) return false;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) && parsed.length > 0; } catch { return false; }
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received: ${value}`);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}
