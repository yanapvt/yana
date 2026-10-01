import { describe, expect, it } from 'vitest';
import { loadPayHereConfig } from './payhere.js';

const complete = {
  PAYHERE_ENABLED: 'true', PAYHERE_MERCHANT_ID: 'merchant-1',
  PAYHERE_MERCHANT_SECRET: 'secret-for-tests',
  PAYHERE_RETURN_URL: 'https://yana.example/payments/return',
  PAYHERE_CANCEL_URL: 'https://yana.example/payments/cancel',
  PAYHERE_NOTIFY_URL: 'https://yana.example/payments/payhere/notify',
};

describe('PayHere configuration', () => {
  it('is disabled and sandboxed by default', () => {
    expect(loadPayHereConfig({})).toMatchObject({
      enabled: false, environment: 'sandbox',
      checkoutUrl: 'https://sandbox.payhere.lk/pay/checkout',
    });
  });

  it('requires checkout credentials and HTTPS URLs only when enabled', () => {
    expect(() => loadPayHereConfig({ PAYHERE_ENABLED: 'true' })).toThrow('PAYHERE_MERCHANT_ID');
    expect(() => loadPayHereConfig({ ...complete, PAYHERE_NOTIFY_URL: 'http://localhost/notify' }))
      .toThrow('PAYHERE_NOTIFY_URL must use HTTPS');
  });

  it('keeps sandbox and live checkout endpoints separate', () => {
    expect(loadPayHereConfig(complete).checkoutUrl).toContain('sandbox.payhere.lk');
    expect(loadPayHereConfig({ ...complete, PAYHERE_ENVIRONMENT: 'live' }).checkoutUrl)
      .toBe('https://www.payhere.lk/pay/checkout');
  });
});
