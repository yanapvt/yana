import { describe, expect, it } from 'vitest';
import { LogisticsSearchFlowService } from './LogisticsSearchFlowService.js';

const completeCriteria = {
  pickupLocation: 'Colombo airport',
  destination: 'Galle',
  pickupDate: '2026-10-10',
  pickupTime: '10:00',
  passengers: 4,
};

describe('LogisticsSearchFlowService honest placeholder boundary', () => {
  it('labels generated options as illustrative requests without fabricated ratings or quotes', async () => {
    const result = await new LogisticsSearchFlowService().handleProviderSearch(
      completeCriteria,
      { correlationId: 'corr-transport-honesty', sessionId: 'session-1' }
    );

    expect(result.status).toBe('provider_options');
    expect(result.options).toHaveLength(9);
    expect(result.reply).toContain('illustrative transport request options');
    expect(result.reply).toContain('not live provider inventory or confirmed quotes');
    expect(result.reply).toContain('Quote status: Not quoted; an operator must confirm price');
    expect(result.reply).toContain('operator must confirm vehicle fit');
    expect(result.reply).not.toMatch(/rating|\$+|book now/i);
    expect(result.options?.every((option) => option.rating === undefined)).toBe(true);
  });

  it('shows a customer budget as an input rather than a provider price', async () => {
    const result = await new LogisticsSearchFlowService().handleProviderSearch(
      { ...completeCriteria, budget: 'USD 100' },
      { correlationId: 'corr-transport-budget', sessionId: 'session-2' }
    );

    expect(result.reply).toContain('Your stated budget is USD 100; this is not a provider quote');
    expect(result.reply).not.toContain('Estimated price:');
  });
});
