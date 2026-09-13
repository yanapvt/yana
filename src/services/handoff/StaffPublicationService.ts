import type { HandoffQueueHandler, HandoffQueueItem } from './HandoffQueueService.js';

export interface StaffPublicationAdapter { publish(event: { eventId: string; handoffId: string; type: string; correlationId: string }): Promise<{ receiptId: string }>; }

export class StaffPublicationHandler implements HandoffQueueHandler {
  constructor(private readonly enabled: boolean, private readonly primary: StaffPublicationAdapter, private readonly fallback?: StaffPublicationAdapter) {}
  async handle(item: HandoffQueueItem): Promise<void> {
    if (!this.enabled) throw Object.assign(new Error('disabled'), { code: 'PUBLICATION_DISABLED' });
    const event = { eventId: item.notificationId, handoffId: item.handoffId, type: item.type, correlationId: item.correlationId };
    try { await this.primary.publish(event); }
    catch (primaryError) {
      if (!this.fallback) throw primaryError;
      await this.fallback.publish(event);
    }
  }
}

export class HttpStaffPublicationAdapter implements StaffPublicationAdapter {
  constructor(private readonly endpoint: string, private readonly authToken?: string, private readonly request: typeof fetch = fetch) {}
  async publish(event: { eventId: string; handoffId: string; type: string; correlationId: string }): Promise<{ receiptId: string }> {
    const response = await this.request(this.endpoint, { method: 'POST', headers: {
      'content-type': 'application/json', 'idempotency-key': event.eventId, ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {}),
    }, body: JSON.stringify(event) });
    if (!response.ok) throw Object.assign(new Error('publication failed'), { code: response.status >= 500 ? 'STAFF_PROVIDER_UNAVAILABLE' : 'STAFF_PROVIDER_REJECTED' });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.receiptId !== 'string' || !body.receiptId) throw Object.assign(new Error('missing receipt'), { code: 'STAFF_PROVIDER_INVALID_RESPONSE' });
    return { receiptId: body.receiptId };
  }
}
