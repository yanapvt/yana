import type { SupplierId } from '../services/hotel-engine/types.js';

export interface HotelSupplierRuntimePolicy {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
  rateLimitPerMinute: number;
}

export interface HotelSupplierProviderConfig extends HotelSupplierRuntimePolicy {
  supplier: SupplierId;
  enabled: boolean;
  priority: number;
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  affiliateId?: string;
  siteId?: string;
  marginPercent?: number;
  sandboxBookingEnabled?: boolean;
}

export interface HotelSupplierEnvironment {
  enabled: boolean;
  attributionLoggingEnabled: boolean;
  providers: HotelSupplierProviderConfig[];
}

type EnvironmentSource = Record<string, string | undefined>;

const DEFAULT_POLICY: HotelSupplierRuntimePolicy = {
  timeoutMs: 15_000,
  maxRetries: 2,
  retryDelayMs: 500,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 60_000,
  rateLimitPerMinute: 60,
};

export function loadHotelSupplierEnvironment(
  source: EnvironmentSource = process.env
): HotelSupplierEnvironment {
  const globalPolicy = readPolicy(source, 'HOTEL_SUPPLIER');
  const providers = [
    readProvider(source, 'LITEAPI', 'liteapi', 1, 'https://api.liteapi.travel/v3.0', globalPolicy),
    readProvider(source, 'HOTELBEDS', 'hotelbeds', 2, undefined, globalPolicy),
    readProvider(source, 'WEBBEDS', 'webbeds', 3, undefined, globalPolicy),
    readProvider(source, 'BOOKING_DEMAND', 'booking_demand', 4, undefined, globalPolicy),
    readProvider(source, 'AGODA', 'agoda', 5, undefined, globalPolicy),
    readProvider(source, 'YANA_DIRECT', 'yana_direct', 6, undefined, globalPolicy),
  ];

  const environment = {
    enabled: readBoolean(source.HOTEL_SUPPLIER_ORCHESTRATION_ENABLED, false),
    attributionLoggingEnabled: readBoolean(
      source.HOTEL_SUPPLIER_ATTRIBUTION_LOG_ENABLED,
      false
    ),
    providers,
  };
  validateHotelSupplierEnvironment(environment);
  return environment;
}

export function validateHotelSupplierEnvironment(
  environment: HotelSupplierEnvironment
): void {
  if (!environment.enabled) return;

  for (const provider of environment.providers.filter((entry) => entry.enabled)) {
    if (!provider.baseUrl) {
      throw new Error(`${provider.supplier} requires a configured base URL when enabled`);
    }
    assertUrl(provider.baseUrl, `${provider.supplier} base URL`);
    if (!provider.apiKey) {
      throw new Error(`${provider.supplier} requires an API key when enabled`);
    }
  }
}

export function getEffectiveHotelSupplierConfigs(
  environment: HotelSupplierEnvironment
): HotelSupplierProviderConfig[] {
  return environment.providers.map((provider) => ({
    ...provider,
    enabled: environment.enabled && provider.enabled,
  }));
}

function readProvider(
  source: EnvironmentSource,
  prefix: string,
  supplier: SupplierId,
  defaultPriority: number,
  defaultBaseUrl: string | undefined,
  globalPolicy: HotelSupplierRuntimePolicy
): HotelSupplierProviderConfig {
  return {
    supplier,
    enabled: readBoolean(source[`${prefix}_ENABLED`], false),
    priority: readInteger(source[`${prefix}_PRIORITY`], defaultPriority, 1),
    baseUrl: optional(source[`${prefix}_BASE_URL`]) ?? defaultBaseUrl,
    apiKey: optional(source[`${prefix}_API_KEY`]),
    apiSecret: optional(source[`${prefix}_API_SECRET`]),
    affiliateId: optional(source[`${prefix}_AFFILIATE_ID`]),
    siteId: optional(source[`${prefix}_SITE_ID`]),
    marginPercent: optionalPercentage(source[`${prefix}_MARGIN_PERCENT`]),
    sandboxBookingEnabled: readBoolean(source[`${prefix}_SANDBOX_BOOKING_ENABLED`], false),
    ...readPolicy(source, prefix, globalPolicy),
  };
}

function optionalPercentage(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Expected percentage between 0 and 100, received: ${value}`);
  }
  return parsed;
}

function readPolicy(
  source: EnvironmentSource,
  prefix: string,
  fallback: HotelSupplierRuntimePolicy = DEFAULT_POLICY
): HotelSupplierRuntimePolicy {
  return {
    timeoutMs: readInteger(source[`${prefix}_TIMEOUT_MS`], fallback.timeoutMs, 1),
    maxRetries: readInteger(source[`${prefix}_MAX_RETRIES`], fallback.maxRetries, 0),
    retryDelayMs: readInteger(source[`${prefix}_RETRY_DELAY_MS`], fallback.retryDelayMs, 0),
    circuitFailureThreshold: readInteger(
      source[`${prefix}_CIRCUIT_FAILURE_THRESHOLD`],
      fallback.circuitFailureThreshold,
      1
    ),
    circuitCooldownMs: readInteger(
      source[`${prefix}_CIRCUIT_COOLDOWN_MS`],
      fallback.circuitCooldownMs,
      1
    ),
    rateLimitPerMinute: readInteger(
      source[`${prefix}_RATE_LIMIT_PER_MINUTE`],
      fallback.rateLimitPerMinute,
      1
    ),
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected boolean environment value, received: ${value}`);
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`Expected integer >= ${minimum}, received: ${value}`);
  }
  return parsed;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function assertUrl(value: string, label: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}
