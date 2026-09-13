import { createHash, timingSafeEqual } from 'node:crypto';
import type { PayHereConfig } from '../../config/payhere.js';
import { PaymentState } from '../../types/core.js';

export interface PayHereCheckoutRequest {
  orderId: string; amount: number; currency: string; items: string;
  firstName: string; lastName: string; email: string; phone: string;
  address: string; city: string; country: string;
}

export interface PayHereCallback {
  merchant_id: string; order_id: string; payment_id: string;
  payhere_amount: string; payhere_currency: string; status_code: string; md5sig: string;
}

export interface PaymentBinding {
  paymentId: string; orderId: string; amount: string; currency: string; state: PaymentState;
}

export interface VerifiedPaymentCallback {
  paymentId: string; orderId: string; providerPaymentId: string;
  nextState: PaymentState; statusCode: string;
}

export interface PaymentCallbackStore {
  findByOrderId(orderId: string): Promise<PaymentBinding | undefined>;
  applyVerifiedCallback(callback: VerifiedPaymentCallback): Promise<'applied' | 'duplicate'>;
}

export type PayHereCallbackResult =
  | { accepted: true; duplicate: boolean; state: PaymentState }
  | { accepted: false; reason: 'disabled' | 'invalid_callback' | 'binding_mismatch' };

export class PayHerePaymentService {
  constructor(private readonly config: PayHereConfig, private readonly store: PaymentCallbackStore) {}

  createCheckout(request: PayHereCheckoutRequest): { action: string; fields: Record<string, string> } {
    this.assertEnabled();
    const amount = formatAmount(request.amount);
    const currency = normalizeCurrency(request.currency);
    const fields = {
      merchant_id: this.config.merchantId!, return_url: this.config.returnUrl!,
      cancel_url: this.config.cancelUrl!, notify_url: this.config.notifyUrl!,
      first_name: required(request.firstName, 'firstName'), last_name: required(request.lastName, 'lastName'),
      email: required(request.email, 'email'), phone: required(request.phone, 'phone'),
      address: required(request.address, 'address'), city: required(request.city, 'city'),
      country: required(request.country, 'country'), order_id: required(request.orderId, 'orderId'),
      items: required(request.items, 'items'), currency, amount,
      hash: checkoutHash(this.config.merchantId!, request.orderId, amount, currency, this.config.merchantSecret!),
    };
    return { action: this.config.checkoutUrl, fields };
  }

  async handleCallback(callback: PayHereCallback): Promise<PayHereCallbackResult> {
    if (!this.config.enabled) return { accepted: false, reason: 'disabled' };
    if (!isCompleteCallback(callback) || callback.merchant_id !== this.config.merchantId) {
      return { accepted: false, reason: 'invalid_callback' };
    }
    const expected = callbackHash(callback, this.config.merchantSecret!);
    if (!safeEqual(expected, callback.md5sig.toUpperCase())) {
      return { accepted: false, reason: 'invalid_callback' };
    }
    const callbackAmount = normalizeCallbackAmount(callback.payhere_amount);
    const callbackCurrency = normalizeCallbackCurrency(callback.payhere_currency);
    if (!callbackAmount || !callbackCurrency || !isSupportedStatus(callback.status_code)) {
      return { accepted: false, reason: 'invalid_callback' };
    }
    const binding = await this.store.findByOrderId(callback.order_id);
    if (!binding || binding.orderId !== callback.order_id ||
        binding.amount !== callbackAmount || binding.currency !== callbackCurrency) {
      return { accepted: false, reason: 'binding_mismatch' };
    }
    const nextState = mapStatus(callback.status_code);
    if (isTerminal(binding.state) && binding.state !== nextState) {
      return { accepted: false, reason: 'binding_mismatch' };
    }
    const result = await this.store.applyVerifiedCallback({
      paymentId: binding.paymentId, orderId: binding.orderId,
      providerPaymentId: callback.payment_id, nextState, statusCode: callback.status_code,
    });
    return { accepted: true, duplicate: result === 'duplicate', state: nextState };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw new Error('PayHere checkout is disabled');
  }
}

export function checkoutHash(merchantId: string, orderId: string, amount: string, currency: string, secret: string): string {
  return md5(`${merchantId}${orderId}${amount}${currency}${md5(secret)}`);
}

export function callbackHash(callback: PayHereCallback, secret: string): string {
  return md5(`${callback.merchant_id}${callback.order_id}${callback.payhere_amount}${callback.payhere_currency}${callback.status_code}${md5(secret)}`);
}

function md5(value: string): string { return createHash('md5').update(value, 'utf8').digest('hex').toUpperCase(); }
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function formatAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('amount must be a positive finite number');
  return value.toFixed(2);
}
function normalizeCallbackAmount(value: string): string {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return '';
  return Number(value).toFixed(2);
}
function normalizeCallbackCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : '';
}
function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a three-letter code');
  return currency;
}
function required(value: string, name: string): string {
  const result = value.trim(); if (!result) throw new Error(`${name} is required`); return result;
}
function isCompleteCallback(value: PayHereCallback): boolean {
  return ['merchant_id','order_id','payment_id','payhere_amount','payhere_currency','status_code','md5sig']
    .every((key) => typeof value[key as keyof PayHereCallback] === 'string' && value[key as keyof PayHereCallback].trim() !== '');
}
function mapStatus(code: string): PaymentState {
  if (code === '2') return PaymentState.SUCCEEDED;
  if (code === '0') return PaymentState.PENDING;
  if (code === '-1') return PaymentState.REFUNDED_OR_CANCELLED;
  return PaymentState.FAILED;
}
function isSupportedStatus(code: string): boolean { return ['2', '0', '-1', '-2', '-3'].includes(code); }
function isTerminal(state: PaymentState): boolean {
  return [PaymentState.SUCCEEDED, PaymentState.FAILED, PaymentState.TIMED_OUT, PaymentState.REFUNDED_OR_CANCELLED]
    .includes(state);
}
