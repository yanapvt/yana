export type PayHereEnvironmentName = 'sandbox' | 'live';

export interface PayHereConfig {
  enabled: boolean;
  environment: PayHereEnvironmentName;
  merchantId?: string;
  merchantSecret?: string;
  returnUrl?: string;
  cancelUrl?: string;
  notifyUrl?: string;
  checkoutUrl: string;
}

type EnvironmentSource = Record<string, string | undefined>;

const CHECKOUT_URLS: Record<PayHereEnvironmentName, string> = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
};

export function loadPayHereConfig(source: EnvironmentSource = process.env): PayHereConfig {
  const environment = readEnvironment(source.PAYHERE_ENVIRONMENT);
  const config: PayHereConfig = {
    enabled: readBoolean(source.PAYHERE_ENABLED, false),
    environment,
    merchantId: optional(source.PAYHERE_MERCHANT_ID),
    merchantSecret: optional(source.PAYHERE_MERCHANT_SECRET),
    returnUrl: optional(source.PAYHERE_RETURN_URL),
    cancelUrl: optional(source.PAYHERE_CANCEL_URL),
    notifyUrl: optional(source.PAYHERE_NOTIFY_URL),
    checkoutUrl: CHECKOUT_URLS[environment],
  };
  validatePayHereConfig(config);
  return config;
}

export function validatePayHereConfig(config: PayHereConfig): void {
  if (!config.enabled) return;
  const required: Array<[keyof PayHereConfig, string]> = [
    ['merchantId', 'PAYHERE_MERCHANT_ID'],
    ['merchantSecret', 'PAYHERE_MERCHANT_SECRET'],
    ['returnUrl', 'PAYHERE_RETURN_URL'],
    ['cancelUrl', 'PAYHERE_CANCEL_URL'],
    ['notifyUrl', 'PAYHERE_NOTIFY_URL'],
  ];
  for (const [key, name] of required) {
    if (!config[key]) throw new Error(`${name} is required when PayHere is enabled`);
  }
  for (const [key, name] of required.slice(2)) {
    const url = new URL(config[key] as string);
    if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  }
  if (config.environment === 'live' && config.checkoutUrl !== CHECKOUT_URLS.live) {
    throw new Error('Live PayHere must use the official HTTPS checkout endpoint');
  }
  if (config.environment === 'sandbox' && config.checkoutUrl !== CHECKOUT_URLS.sandbox) {
    throw new Error('Sandbox PayHere must use the official sandbox checkout endpoint');
  }
}

function readEnvironment(value?: string): PayHereEnvironmentName {
  const normalized = value?.trim() || 'sandbox';
  if (normalized === 'sandbox' || normalized === 'live') return normalized;
  throw new Error(`PAYHERE_ENVIRONMENT must be sandbox or live, received: ${normalized}`);
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`PAYHERE_ENABLED must be true or false, received: ${value}`);
}

function optional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
