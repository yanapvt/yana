import { describe, expect, it, vi } from 'vitest';
import type { HumanHandoffConfig } from '../../config/humanHandoff.js';
import {
  NearBookingHandoffService, type HandoffCase, type HandoffCaseStore,
  type HandoffSessionControl, type NativeWhatsAppGroupProvider,
} from './NearBookingHandoffService.js';

const config: HumanHandoffConfig = {
  enabled: true, nativeGroupEnabled: false, fallbackQueueEnabled: true,
  slaMinutes: 30, queueName: 'travel-concierge', operatorToken: 'test-token',
  slaPollSeconds: 60,
};
const request = {
  sessionId: 'session-1', userId: 'user-1', correlationId: 'corr-1',
  travelerConsented: true, authoritativeRecheckPassed: true, travelerIntendsToProceed: true,
  summary: { service: 'hotel' as const, selectedStayName: 'Test Stay', dates: '2026-10-01/2026-10-03', guestCount: 2 },
};

function harness(overrides: Partial<HumanHandoffConfig> = {}, provider?: NativeWhatsAppGroupProvider) {
  let existing: HandoffCase | undefined;
  const store: HandoffCaseStore = {
    createOrGetOpenCase: vi.fn(async (input) => {
      if (existing) return { case: existing, created: false };
      existing = { ...input, handoffId: 'handoff-1', createdAt: new Date('2026-09-13T00:00:00Z') };
      return { case: existing, created: true };
    }),
    updateChannel: vi.fn(async (_id, channel) => existing = { ...existing!, channel }),
    updateStatus: vi.fn(async (_id, status) => existing = { ...existing!, status }),
    assign: vi.fn(async (_id, operatorId) => existing = { ...existing!, operatorId, status: 'assigned' }),
    findById: vi.fn(async () => existing),
    findOverdue: vi.fn(async (now) => existing && existing.slaDueAt <= now && ['pending', 'assigned'].includes(existing.status) ? [existing] : []),
  };
  const sessions: HandoffSessionControl = {
    markHandedOff: vi.fn().mockResolvedValue(undefined),
    clearHandedOff: vi.fn().mockResolvedValue(undefined),
  };
  const queueNotifier = {
    capabilities: { queueNotification: true },
    notify: vi.fn().mockResolvedValue(undefined),
    escalate: vi.fn().mockResolvedValue(undefined),
  };
  const authorizer = { canAssign: vi.fn().mockResolvedValue(true), canClose: vi.fn().mockResolvedValue(true) };
  const audit = { info: vi.fn(), error: vi.fn() };
  const service = new NearBookingHandoffService(
    { ...config, ...overrides }, store, sessions, provider,
    () => new Date('2026-09-13T00:00:00Z'), queueNotifier, authorizer, audit
  );
  return { service, store, sessions, queueNotifier, authorizer, audit };
}

describe('NearBookingHandoffService', () => {
  it('does nothing when disabled', async () => {
    const { service, store, sessions } = harness({ enabled: false });
    expect((await service.requestHandoff(request)).status).toBe('disabled');
    expect(store.createOrGetOpenCase).not.toHaveBeenCalled();
    expect(sessions.markHandedOff).not.toHaveBeenCalled();
  });

  it('requires traveler consent before sharing or creating a case', async () => {
    const { service, store } = harness();
    expect((await service.requestHandoff({ ...request, travelerConsented: false })).status).toBe('consent_required');
    expect(store.createOrGetOpenCase).not.toHaveBeenCalled();
  });

  it.each([
    ['missing authoritative recheck', { authoritativeRecheckPassed: false }],
    ['missing intent to proceed', { travelerIntendsToProceed: false }],
  ])('rejects %s', async (_name, patch) => {
    const { service, store } = harness();
    expect((await service.requestHandoff({ ...request, ...patch })).status).toBe('not_ready');
    expect(store.createOrGetOpenCase).not.toHaveBeenCalled();
  });

  it('creates a minimal queue case and marks the session handed off', async () => {
    const { service, store, sessions } = harness();
    const result = await service.requestHandoff(request);
    expect(result.status).toBe('handed_off');
    expect(store.createOrGetOpenCase).toHaveBeenCalledWith(expect.objectContaining({
      summary: request.summary, channel: 'agent_queue', status: 'pending',
      slaDueAt: new Date('2026-09-13T00:30:00Z'),
    }));
    expect(sessions.markHandedOff).toHaveBeenCalledWith('session-1', 'handoff-1');
    expect(result.reply).toContain('will not book or charge');
  });

  it('does not claim native group support when the adapter lacks the capability', async () => {
    const provider = { capabilities: { nativeGroupCreation: false }, createHandoffGroup: vi.fn() };
    const { service } = harness({ nativeGroupEnabled: true }, provider);
    const result = await service.requestHandoff(request);
    expect(result.status).toBe('handed_off');
    expect(provider.createHandoffGroup).not.toHaveBeenCalled();
    expect(result.reply).toContain('concierge queue');
  });

  it('uses a capable native group provider', async () => {
    const provider = { capabilities: { nativeGroupCreation: true }, createHandoffGroup: vi.fn().mockResolvedValue(undefined) };
    const { service } = harness({ nativeGroupEnabled: true }, provider);
    const result = await service.requestHandoff(request);
    expect(provider.createHandoffGroup).toHaveBeenCalled();
    expect(result.status === 'handed_off' && result.case.channel).toBe('native_whatsapp_group');
  });

  it('falls back to the agent queue when native group creation fails', async () => {
    const provider = { capabilities: { nativeGroupCreation: true }, createHandoffGroup: vi.fn().mockRejectedValue(new Error('secret provider failure')) };
    const { service, store } = harness({ nativeGroupEnabled: true }, provider);
    const result = await service.requestHandoff(request);
    expect(store.updateChannel).toHaveBeenCalledWith('handoff-1', 'agent_queue');
    expect(result.status === 'handed_off' && result.case.channel).toBe('agent_queue');
    expect(result.reply).not.toContain('secret provider failure');
  });

  it('returns the existing case for duplicate requests without creating another', async () => {
    const { service, store, sessions } = harness();
    await service.requestHandoff(request);
    const duplicate = await service.requestHandoff(request);
    expect(duplicate.status === 'handed_off' && duplicate.duplicate).toBe(true);
    expect(store.createOrGetOpenCase).toHaveBeenCalledTimes(2);
    expect(sessions.markHandedOff).toHaveBeenCalledTimes(2);
  });

  it('converges concurrent retries on the same open case', async () => {
    const { service, store } = harness();
    const results = await Promise.all([service.requestHandoff(request), service.requestHandoff(request)]);
    expect(results.every((result) => result.status === 'handed_off' && result.case.handoffId === 'handoff-1')).toBe(true);
    expect(store.createOrGetOpenCase).toHaveBeenCalledTimes(2);
  });

  it('clears handed-off safety only when a case is closed', async () => {
    const { service, sessions } = harness();
    await service.requestHandoff(request);
    await service.close('handoff-1', 'resolved', 'actor-1');
    expect(sessions.clearHandedOff).toHaveBeenCalledWith('session-1', 'handoff-1');
  });

  it('fails safely without locking the session when storage fails', async () => {
    const { service, store, sessions } = harness();
    vi.mocked(store.createOrGetOpenCase).mockRejectedValueOnce(new Error('postgres password=secret'));
    const result = await service.requestHandoff(request);
    expect(result.status).toBe('delivery_unavailable');
    expect(sessions.markHandedOff).not.toHaveBeenCalled();
    expect(result.reply).not.toMatch(/password|secret|postgres/i);
  });

  it('fails safely and preserves the unlocked session when queue notification fails', async () => {
    const { service, queueNotifier, sessions, store } = harness();
    queueNotifier.notify.mockRejectedValueOnce(new Error('Bearer secret-token'));
    const result = await service.requestHandoff(request);
    expect(result.status).toBe('delivery_unavailable');
    expect(store.updateStatus).toHaveBeenCalledWith('handoff-1', 'cancelled');
    expect(sessions.markHandedOff).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('does not create a case when no notifier advertises queue capability', async () => {
    const { service, store, sessions } = harness();
    const unavailable = new NearBookingHandoffService(config, store, sessions);
    const result = await unavailable.requestHandoff(request);
    expect(result.status).toBe('delivery_unavailable');
    expect(sessions.markHandedOff).not.toHaveBeenCalled();
  });

  it('requires authorization for assignment', async () => {
    const { service, authorizer, store } = harness();
    authorizer.canAssign.mockResolvedValueOnce(false);
    expect(await service.assign('handoff-1', 'actor-1', 'operator-1')).toEqual({ status: 'forbidden' });
    expect(store.assign).not.toHaveBeenCalled();
  });

  it('treats assignment replay for the same operator as idempotent', async () => {
    const { service } = harness();
    await service.requestHandoff(request);
    await service.assign('handoff-1', 'actor-1', 'operator-1');
    const replay = await service.assign('handoff-1', 'actor-1', 'operator-1');
    expect(replay.status === 'updated' && replay.case.operatorId).toBe('operator-1');
  });

  it('requires authorization before closing an active case', async () => {
    const { service, authorizer, store, sessions } = harness();
    await service.requestHandoff(request);
    authorizer.canClose.mockResolvedValueOnce(false);
    expect(await service.close('handoff-1', 'cancelled', 'actor-1')).toEqual({ status: 'forbidden' });
    expect(store.updateStatus).not.toHaveBeenCalledWith('handoff-1', 'cancelled');
    expect(sessions.clearHandedOff).not.toHaveBeenCalled();
  });

  it('redacts notification failures from audit metadata', async () => {
    const { service, queueNotifier, audit } = harness();
    queueNotifier.notify.mockRejectedValueOnce(new Error('Authorization: Bearer queue-secret'));
    await service.requestHandoff(request);
    expect(JSON.stringify(audit.error.mock.calls)).not.toMatch(/queue-secret|Authorization|Bearer/);
    expect(audit.error).toHaveBeenCalledWith('handoff_queue_notification_failed', expect.objectContaining({ correlationId: 'corr-1' }));
  });

  it.each(['resolved', 'cancelled'] as const)('authorizes and closes a case as %s', async (status) => {
    const { service, store, sessions } = harness();
    await service.requestHandoff(request);
    const result = await service.close('handoff-1', status, 'actor-1');
    expect(result.status).toBe('updated');
    expect(store.updateStatus).toHaveBeenCalledWith('handoff-1', status);
    expect(sessions.clearHandedOff).toHaveBeenCalled();
  });

  it('notifies the configured queue and escalates overdue cases at the SLA boundary', async () => {
    const { service, queueNotifier, store } = harness();
    await service.requestHandoff(request);
    expect(queueNotifier.notify).toHaveBeenCalledWith(expect.objectContaining({ queueName: 'travel-concierge' }));
    vi.mocked(store.findOverdue).mockResolvedValueOnce([{
      handoffId: 'handoff-1', sessionId: 'session-1', status: 'pending', channel: 'agent_queue',
      createdAt: new Date('2026-09-13T00:00:00Z'), slaDueAt: new Date('2026-09-13T00:30:00Z'),
    }]);
    expect(await service.escalateOverdue()).toBe(1);
    expect(queueNotifier.escalate).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'handoff-1' }));
  });
});
