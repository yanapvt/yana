import { describe, expect, it, vi } from 'vitest';
import { appendWorkflowTransition } from './WorkflowTransitionAudit.js';

describe('workflow transition audit', () => {
  it('records only allowlisted durable state in the caller transaction', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await appendWorkflowTransition({ query } as any, 'hotel', {
      id: 'stay-1', userId: 'whatsapp:+94770000001', revision: 3,
      schemaVersion: '1.0', state: 'booking_provider_pending', lifecycleStatus: 'paused',
      criteria: { location: 'Hikkaduwa', guests: 2, hiddenModelReasoning: 'private' }, pendingSourcingConsent: true,
      selectedHotel: { selectedHotelId: 'hotel-1' },
      // A caller may carry additional private fields; the audit must not copy them.
      hiddenModelReasoning: 'private', rawProviderToken: 'private',
    } as any);
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('journey_workflow_transitions');
    expect(values).toEqual(['stay-1', 'whatsapp:+94770000001', 'hotel', 3,
      '1.0', 'booking_provider_pending', 'paused',
      JSON.stringify({ location: 'Hikkaduwa', guests: 2 }),
      JSON.stringify({ sourcingConsent: true }),
      JSON.stringify({ selectedHotelId: 'hotel-1' })]);
    expect(JSON.stringify(values)).not.toContain('private');
  });

  it('propagates a failed transition insert so the snapshot transaction can roll back', async () => {
    const error = new Error('audit unavailable');
    await expect(appendWorkflowTransition({ query: vi.fn().mockRejectedValue(error) } as any,
      'excursion', { id: 'trip-1', userId: 'traveller', revision: 2,
        state: 'awaiting_preferences', criteria: { destination: 'Ella' } })).rejects.toBe(error);
  });
});
