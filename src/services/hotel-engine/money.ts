import type { Money } from './types.js';

export function assertMoney(money: Money, expectedCurrency?: string): void {
  if (!Number.isFinite(money.amount) || money.amount < 0) {
    throw new Error(`Invalid money amount: ${money.amount}`);
  }

  if (!/^[A-Z]{3}$/.test(money.currency)) {
    throw new Error(`Invalid currency code: ${money.currency}`);
  }

  if (expectedCurrency && money.currency !== expectedCurrency) {
    throw new Error(`Currency mismatch: expected ${expectedCurrency}, received ${money.currency}`);
  }
}

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function money(amount: number, currency: string): Money {
  const value = { amount: roundMoney(amount), currency: currency.toUpperCase() };
  assertMoney(value);
  return value;
}
