import { describe, expect, it, vi } from 'vitest';
import { createInboundConversationEvent, createWebsiteConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { getCanonicalMessageProcessor } from './CanonicalMessageProcessor.js';

vi.mock('./WorkflowLockService.js', () => ({
  withWorkflowLock: async (_userId: string, operation: () => Promise<unknown>) => operation(),
}));

describe('CanonicalMessageProcessor', () => {
  it('passes WhatsApp and website text through the same accepted session and workflow boundary', async () => {
    const userId = 'whatsapp:+94770000001';
    const whatsapp = createInboundConversationEvent({
      messageId: 'wa-1', from: userId, to: 'whatsapp:yana', timestamp: new Date(),
      type: 'text', content: { type: 'text', body: 'Plan a trip' },
    }, 'corr-wa');
    const website = createWebsiteConversationEvent({
      sourceEventId: 'web-1', correlationId: 'corr-web', userId,
      channel: 'website_ui', eventType: 'text',
      payload: { content: { type: 'text', body: 'Saturday works' } },
    });
    const accept = vi.spyOn(getConversationControlPlane(), 'acceptEvent').mockImplementation(async (event) => ({
      ...event, sessionId: 'session:shared', workflowId: 'trip-1', stateVersion: 4,
    }));
    try {
      const processor = getCanonicalMessageProcessor();
      const first = await processor.process(whatsapp, async (event) => event);
      const second = await processor.process(website, async (event) => event);
      expect(first).toMatchObject({ sessionId: 'session:shared', workflowId: 'trip-1', stateVersion: 4 });
      expect(second).toMatchObject({ sessionId: 'session:shared', workflowId: 'trip-1', stateVersion: 4 });
      expect(first.eventId).not.toBe(second.eventId);
      expect(accept).toHaveBeenCalledTimes(2);
    } finally { accept.mockRestore(); }
  });

  it('does not execute a deterministic UI action after an idempotency rejection', async () => {
    const event = createWebsiteConversationEvent({
      sourceEventId: 'selection-1', correlationId: 'corr-ui', userId: 'whatsapp:+94770000001',
      channel: 'website_ui', eventType: 'ui_selection', workflowId: 'trip-1',
      expectedStateVersion: 2, payload: { action: 'select_day', selectedDay: 2 },
    });
    const accept = vi.spyOn(getConversationControlPlane(), 'acceptEvent')
      .mockResolvedValueOnce({ ...event, sessionId: 'session:shared', stateVersion: 2 })
      .mockRejectedValueOnce(new Error('duplicate'));
    const execute = vi.fn().mockResolvedValue('selected');
    try {
      const processor = getCanonicalMessageProcessor();
      await expect(processor.process(event, execute)).resolves.toBe('selected');
      await expect(processor.process(event, execute)).rejects.toThrow('duplicate');
      expect(execute).toHaveBeenCalledTimes(1);
    } finally { accept.mockRestore(); }
  });
});
