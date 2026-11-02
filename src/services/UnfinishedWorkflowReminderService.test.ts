import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), send: vi.fn(), configured: vi.fn(), load: vi.fn(), profileCheck: vi.fn(), generate: vi.fn(),
  env: { features: { proactiveMessagingEnabled: false }, whatsapp: { provider: 'openwa' } },
}));
vi.mock('../db/connection.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../config/environment.js', () => ({ env: mocks.env }));
vi.mock('./OpenWaOutboundService.js', () => ({ getOpenWaOutboundService: () => ({
  isConfigured: mocks.configured, sendWhatsAppReply: mocks.send,
}) }));
vi.mock('../orchestration/ActiveConversationStateLoader.js', () => ({
  ActiveConversationStateLoader: class { loadWithPaused = mocks.load; },
}));
vi.mock('./profileGate.js', () => ({ getProfileGate: () => ({ check: mocks.profileCheck }) }));
vi.mock('./LLMService.js', () => ({ getLLMService: () => ({ generateUIContent: mocks.generate }) }));

import { UnfinishedWorkflowReminderService } from './UnfinishedWorkflowReminderService.js';

describe('UnfinishedWorkflowReminderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.features.proactiveMessagingEnabled = false;
    mocks.env.whatsapp.provider = 'openwa';
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.generate.mockRejectedValue(new Error('model offline'));
    mocks.load.mockResolvedValue({ activeSession: null, pausedSessions: [] });
  });

  it('does not schedule or send without the global opt-in', async () => {
    const service = new UnfinishedWorkflowReminderService();
    await service.scheduleFromReply('+94770000000', 'https://yana.test/forms/profile/token');
    expect(await service.processOne()).toBe('idle');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('schedules an unfinished form only when enabled', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    const service = new UnfinishedWorkflowReminderService();
    await service.scheduleFromReply('whatsapp:+94770000000', 'https://yana.test/forms/hotel/token');
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][1][0]).toBe('+94770000000');
    expect(mocks.query.mock.calls[0][1][1]).toContain('hotel');
    expect(mocks.query.mock.calls[0][1][3]).toBe('30 minutes');
  });

  it('checks the live workflow and preference again before sending', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    mocks.query.mockResolvedValueOnce({ rows: [{ notification_id: 'n1', phone_number: '+94770000000', flow: 'hotel', notification_type: 'unfinished_workflow', attempt_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] }).mockResolvedValue({ rows: [] });
    mocks.load.mockResolvedValue({ activeSession: { flow: 'hotel', state: 'awaiting_preferences', missingFields: ['location'] }, pausedSessions: [] });
    mocks.configured.mockReturnValue(true);
    mocks.send.mockResolvedValue(true);
    expect(await new UnfinishedWorkflowReminderService().processOne()).toBe('sent');
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('skips a completed workflow', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    mocks.query.mockResolvedValueOnce({ rows: [{ notification_id: 'n1', phone_number: '+94770000000', flow: 'hotel', notification_type: 'unfinished_workflow', attempt_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] }).mockResolvedValue({ rows: [] });
    mocks.load.mockResolvedValue({ activeSession: null, pausedSessions: [] });
    expect(await new UnfinishedWorkflowReminderService().processOne()).toBe('skipped');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('lets a traveller opt in to one unfinished-request reminder', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: 'u1' }] }).mockResolvedValue({ rowCount: 1, rows: [] });
    mocks.load.mockResolvedValue({ activeSession: { flow: 'hotel', state: 'hotel_form_sent', missingFields: ['location'] }, pausedSessions: [] });
    const reply = await new UnfinishedWorkflowReminderService().handlePreferenceMessage('+94770000000', 'remind me tomorrow');
    expect(reply).toContain('one reminder tomorrow');
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1][1][3]).toBe('24 hours');
  });

  it('does not create a second reminder for the same opt-in message', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    await new UnfinishedWorkflowReminderService().scheduleFromReply('+94770000000', 'I will remind you', 'remind me tomorrow');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('lets a traveller stop reminders', async () => {
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ user_id: 'u1' }] });
    const reply = await new UnfinishedWorkflowReminderService().handlePreferenceMessage('+94770000000', 'stop reminders');
    expect(reply).toContain("won't send");
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it('reschedules a pending follow-up when the traveller becomes active again', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    await new UnfinishedWorkflowReminderService().onInbound('+94770000000');
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1][0]).toContain("INTERVAL '30 minutes'");
  });

  it('asks for feedback only when the booking remains confirmed', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    mocks.query.mockResolvedValueOnce({ rows: [{ notification_id: 'n2', phone_number: '+94770000000', flow: 'hotel',
      notification_type: 'confirmed_service_feedback', booking_id: 'b1', attempt_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ state: 'confirmed' }] })
      .mockResolvedValue({ rows: [] });
    mocks.configured.mockReturnValue(true);
    mocks.send.mockResolvedValue(true);
    expect(await new UnfinishedWorkflowReminderService().processOne()).toBe('sent');
    expect(mocks.send.mock.calls[0][1]).toContain('How did your hotel service go?');
  });

  it('does not ask for satisfaction after a cancelled booking', async () => {
    mocks.env.features.proactiveMessagingEnabled = true;
    mocks.query.mockResolvedValueOnce({ rows: [{ notification_id: 'n2', phone_number: '+94770000000', flow: 'hotel',
      notification_type: 'confirmed_service_feedback', booking_id: 'b1', attempt_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ state: 'cancelled' }] })
      .mockResolvedValue({ rows: [] });
    expect(await new UnfinishedWorkflowReminderService().processOne()).toBe('skipped');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
