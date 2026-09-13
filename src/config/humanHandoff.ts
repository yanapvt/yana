export interface HumanHandoffConfig {
  enabled: boolean;
  nativeGroupEnabled: boolean;
  fallbackQueueEnabled: boolean;
  slaMinutes: number;
  queueName: string;
  operatorToken?: string;
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
}

type EnvironmentSource = Record<string, string | undefined>;

export function loadHumanHandoffConfig(source: EnvironmentSource = process.env): HumanHandoffConfig {
  const config = {
    enabled: readBoolean(source.HUMAN_HANDOFF_ENABLED, false),
    nativeGroupEnabled: readBoolean(source.HUMAN_HANDOFF_NATIVE_GROUP_ENABLED, false),
    fallbackQueueEnabled: readBoolean(source.HUMAN_HANDOFF_FALLBACK_QUEUE_ENABLED, true),
    slaMinutes: readPositiveInteger(source.HUMAN_HANDOFF_SLA_MINUTES, 30),
    queueName: source.HUMAN_HANDOFF_QUEUE_NAME?.trim() || 'travel-concierge',
    operatorToken: source.HUMAN_HANDOFF_OPERATOR_TOKEN?.trim() || undefined,
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
  };
  if (config.enabled && !config.nativeGroupEnabled && !config.fallbackQueueEnabled) {
    throw new Error('Enabled human handoff requires at least one delivery path');
  }
  if (config.enabled && !config.operatorToken) {
    throw new Error('Enabled human handoff requires HUMAN_HANDOFF_OPERATOR_TOKEN');
  }
  return config;
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
