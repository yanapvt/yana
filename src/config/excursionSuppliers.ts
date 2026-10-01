import type { ExcursionSupplierId } from '../services/excursion-engine/types.js';

export interface ExcursionSupplierConfig {
  supplier: ExcursionSupplierId;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  affiliateId?: string;
  partnerModel?: 'affiliate' | 'merchant' | 'b2b';
  supportsNetRates: boolean;
  supportsMarkup: boolean;
  supportsPublicDisplay: boolean;
  supportsOnlineBooking: boolean;
}

export interface ExcursionSupplierEnvironment {
  enabled: boolean;
  commissionPercent: 15;
  providers: ExcursionSupplierConfig[];
}

type EnvironmentSource = Record<string, string | undefined>;

export function loadExcursionSupplierEnvironment(
  source: EnvironmentSource = process.env
): ExcursionSupplierEnvironment {
  const providers = [
    readProvider(source, 'GOODPASS', 'goodpass', 'https://partner-api.staging.goodpass.co/v1', 'b2b'),
    readProvider(source, 'VIATOR', 'viator', undefined),
    readProvider(source, 'GETYOURGUIDE', 'getyourguide', undefined),
    readProvider(source, 'DMC_QUOTE', 'dmc_quote', undefined),
    readProvider(source, 'YANA_DIRECT', 'yana_direct', undefined),
  ];
  const environment = {
    enabled: readBoolean(source.EXCURSION_SUPPLIER_ORCHESTRATION_ENABLED, false),
    commissionPercent: 15 as const,
    providers,
  };

  validateExcursionSupplierEnvironment(environment);
  return environment;
}

export function validateExcursionSupplierEnvironment(
  environment: ExcursionSupplierEnvironment
): void {
  if (!environment.enabled) return;

  for (const provider of environment.providers.filter((item) => item.enabled)) {
    if (!provider.baseUrl) {
      throw new Error(`${provider.supplier} requires a configured API base URL when enabled`);
    }
    assertUrl(provider.baseUrl, `${provider.supplier} API base URL`);
    if (!provider.apiKey) {
      throw new Error(`${provider.supplier} requires an API key when enabled`);
    }
  }
}

function readProvider(
  source: EnvironmentSource,
  prefix: string,
  supplier: ExcursionSupplierId,
  defaultBaseUrl?: string,
  defaultPartnerModel?: 'affiliate' | 'merchant' | 'b2b'
): ExcursionSupplierConfig {
  return {
    supplier,
    enabled: readBoolean(source[`${prefix}_ENABLED`], false),
    baseUrl: optional(source[`${prefix}_BASE_URL`]) ?? defaultBaseUrl,
    apiKey: optional(source[`${prefix}_API_KEY`]),
    apiSecret: optional(source[`${prefix}_API_SECRET`]),
    affiliateId: optional(source[`${prefix}_AFFILIATE_ID`]),
    partnerModel: readPartnerModel(source[`${prefix}_PARTNER_MODEL`], defaultPartnerModel),
    supportsNetRates: readBoolean(source[`${prefix}_SUPPORTS_NET_RATES`], false),
    supportsMarkup: readBoolean(source[`${prefix}_SUPPORTS_MARKUP`], false),
    supportsPublicDisplay: readBoolean(source[`${prefix}_SUPPORTS_PUBLIC_DISPLAY`], false),
    supportsOnlineBooking: readBoolean(source[`${prefix}_SUPPORTS_ONLINE_BOOKING`], false),
  };
}

function readPartnerModel(
  value: string | undefined,
  fallback?: 'affiliate' | 'merchant' | 'b2b'
): 'affiliate' | 'merchant' | 'b2b' | undefined {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'affiliate' || normalized === 'merchant' || normalized === 'b2b') {
    return normalized;
  }
  throw new Error('Excursion supplier partner model must be affiliate, merchant, or b2b');
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected boolean environment value, received: ${value}`);
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function assertUrl(value: string, label: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}
