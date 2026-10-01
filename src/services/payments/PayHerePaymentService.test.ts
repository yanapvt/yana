import { describe, expect, it, vi } from 'vitest';
import { PaymentState } from '../../types/core.js';
import type { PayHereConfig } from '../../config/payhere.js';
import {
  callbackHash, PayHerePaymentService,
  type PayHereCallback, type PaymentBinding, type PaymentCallbackStore,
} from './PayHerePaymentService.js';

const config: PayHereConfig = {
  enabled: true, environment: 'sandbox', merchantId: 'merchant-1',
  merchantSecret: 'test-merchant-secret',
  returnUrl: 'https://yana.example/return', cancelUrl: 'https://yana.example/cancel',
  notifyUrl: 'https://yana.example/notify',
  checkoutUrl: 'https://sandbox.payhere.lk/pay/checkout',
};
const binding: PaymentBinding = {
  paymentId: 'payment-1', orderId: 'order-1', amount: '1000.00', currency: 'LKR',
  state: PaymentState.INITIATED,
};

function signedCallback(overrides: Partial<PayHereCallback> = {}): PayHereCallback {
  const callback: PayHereCallback = {
    merchant_id: 'merchant-1', order_id: 'order-1', payment_id: 'provider-payment-1',
    payhere_amount: '1000.00', payhere_currency: 'LKR', status_code: '2', md5sig: '',
    ...overrides,
  };
  callback.md5sig = callbackHash(callback, config.merchantSecret!);
  return callback;
}

function store(result: 'applied' | 'duplicate' = 'applied'): PaymentCallbackStore {
  return {
    findByOrderId: vi.fn().mockResolvedValue(binding),
    applyVerifiedCallback: vi.fn().mockResolvedValue(result),
  };
}

describe('PayHerePaymentService', () => {
  it('refuses checkout and callbacks while disabled', async () => {
    const service = new PayHerePaymentService({ ...config, enabled: false }, store());
    expect(() => service.createCheckout(checkoutRequest())).toThrow('disabled');
    expect(await service.handleCallback(signedCallback())).toEqual({ accepted: false, reason: 'disabled' });
  });

  it('generates a deterministic server-side checkout payload without exposing the secret', () => {
    const result = new PayHerePaymentService(config, store()).createCheckout(checkoutRequest());
    expect(result.action).toContain('sandbox.payhere.lk');
    expect(result.fields).toMatchObject({ order_id: 'order-1', amount: '1000.00', currency: 'LKR' });
    expect(JSON.stringify(result)).not.toContain(config.merchantSecret!);
    expect(result.fields.hash).toMatch(/^[A-F0-9]{32}$/);
  });

  it('applies a valid success callback only after verification and binding', async () => {
    const callbackStore = store();
    const result = await new PayHerePaymentService(config, callbackStore).handleCallback(signedCallback());
    expect(result).toEqual({ accepted: true, duplicate: false, state: PaymentState.SUCCEEDED });
    expect(callbackStore.applyVerifiedCallback).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'payment-1', orderId: 'order-1', providerPaymentId: 'provider-payment-1',
    }));
  });

  it('rejects an invalid signature without reading or mutating payment state', async () => {
    const callbackStore = store();
    const callback = signedCallback(); callback.md5sig = '0'.repeat(32);
    expect(await new PayHerePaymentService(config, callbackStore).handleCallback(callback))
      .toEqual({ accepted: false, reason: 'invalid_callback' });
    expect(callbackStore.findByOrderId).not.toHaveBeenCalled();
    expect(callbackStore.applyVerifiedCallback).not.toHaveBeenCalled();
  });

  it('reports an atomically rejected duplicate callback', async () => {
    const result = await new PayHerePaymentService(config, store('duplicate')).handleCallback(signedCallback());
    expect(result).toEqual({ accepted: true, duplicate: true, state: PaymentState.SUCCEEDED });
  });

  it('rejects malformed callback values without throwing or mutating state', async () => {
    const callbackStore = store();
    const result = await new PayHerePaymentService(config, callbackStore).handleCallback(
      signedCallback({ payhere_currency: 'not-currency', payhere_amount: 'NaN' })
    );
    expect(result).toEqual({ accepted: false, reason: 'invalid_callback' });
    expect(callbackStore.applyVerifiedCallback).not.toHaveBeenCalled();
  });

  it('does not reverse a terminal payment with a later conflicting callback', async () => {
    const callbackStore = store();
    vi.mocked(callbackStore.findByOrderId).mockResolvedValue({ ...binding, state: PaymentState.SUCCEEDED });
    const result = await new PayHerePaymentService(config, callbackStore).handleCallback(
      signedCallback({ status_code: '-2' })
    );
    expect(result).toEqual({ accepted: false, reason: 'binding_mismatch' });
    expect(callbackStore.applyVerifiedCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['order mismatch', { order_id: 'other-order' }],
    ['amount mismatch', { payhere_amount: '999.00' }],
    ['currency mismatch', { payhere_currency: 'USD' }],
  ])('rejects %s after authenticating the callback', async (_name, overrides) => {
    const callbackStore = store();
    const result = await new PayHerePaymentService(config, callbackStore).handleCallback(signedCallback(overrides));
    expect(result).toEqual({ accepted: false, reason: 'binding_mismatch' });
    expect(callbackStore.applyVerifiedCallback).not.toHaveBeenCalled();
  });

  it.each([
    ['2', PaymentState.SUCCEEDED], ['0', PaymentState.PENDING],
    ['-1', PaymentState.REFUNDED_OR_CANCELLED], ['-2', PaymentState.FAILED],
    ['-3', PaymentState.FAILED],
  ])('maps PayHere status %s to the bounded payment state', async (statusCode, expected) => {
    const result = await new PayHerePaymentService(config, store()).handleCallback(
      signedCallback({ status_code: statusCode })
    );
    expect(result).toEqual({ accepted: true, duplicate: false, state: expected });
  });
});

function checkoutRequest() {
  return {
    orderId: 'order-1', amount: 1000, currency: 'lkr', items: 'Travel service request',
    firstName: 'Test', lastName: 'Traveler', email: 'test@example.com', phone: '+94770000000',
    address: 'Test address', city: 'Colombo', country: 'Sri Lanka',
  };
}
