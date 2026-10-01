import { describe, expect, it, vi } from 'vitest';
import { HandoffQueueService, type HandoffQueueItem, type HandoffQueueMetrics, type HandoffQueueStore } from './HandoffQueueService.js';

class MemoryQueue implements HandoffQueueStore {
  item?: HandoffQueueItem & { status: string; next?: Date };
  constructor(attemptCount = 0) { this.item = { notificationId: 'n1', handoffId: 'h1', type: 'human_handoff_requested', correlationId: 'c1', attemptCount, scheduledAt: new Date(0), status: 'scheduled' }; }
  async leaseNext(owner: string, now: Date, seconds: number) {
    if (!this.item) return undefined;
    const eligible = ['scheduled', 'failed'].includes(this.item.status) && (!this.item.next || this.item.next <= now);
    const expired = this.item.status === 'processing' && this.item.leaseExpiresAt! <= now;
    if (!eligible && !expired) return undefined;
    this.item = { ...this.item, status: 'processing', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + seconds * 1000), attemptCount: this.item.attemptCount + 1 };
    return { ...this.item };
  }
  async complete(id: string, owner: string) { return this.transition(id, owner, 'sent'); }
  async retry(id: string, owner: string, next: Date) { const ok = this.transition(id, owner, 'failed'); if (ok) this.item!.next = next; return ok; }
  async deadLetter(id: string, owner: string) { return this.transition(id, owner, 'dead_letter'); }
  async metrics(): Promise<HandoffQueueMetrics> { return { ready: 1, processing: 0, retrying: 0, deadLetters: 0, completed: 0, oldestReadyAgeSeconds: 10 }; }
  private transition(id: string, owner: string, status: string) { if (!this.item || this.item.notificationId !== id || this.item.leaseOwner !== owner || this.item.status !== 'processing') return false; this.item.status = status; this.item.leaseOwner = undefined; return true; }
}

const options = { workerId: 'worker-a', leaseSeconds: 60, maxAttempts: 3, backoffSeconds: 10 };

describe('HandoffQueueService', () => {
  it('leases once under contention and completes duplicate-safely', async () => {
    const store = new MemoryQueue(); const handler = { handle: vi.fn() };
    const a = new HandoffQueueService(store, handler, options, () => new Date(1000));
    const b = new HandoffQueueService(store, handler, { ...options, workerId: 'worker-b' }, () => new Date(1000));
    expect(await Promise.all([a.processOne(), b.processOne()])).toEqual(expect.arrayContaining(['completed', 'idle']));
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(await a.processOne()).toBe('idle');
  });

  it('recovers an expired lease after restart', async () => {
    const store = new MemoryQueue(); const handler = { handle: vi.fn() };
    await store.leaseNext('dead-worker', new Date(0), 1);
    const restarted = new HandoffQueueService(store, handler, options, () => new Date(2000));
    expect(await restarted.processOne()).toBe('completed');
  });

  it('uses bounded exponential retry without logging handler secrets', async () => {
    const store = new MemoryQueue(); const audit = { info: vi.fn(), error: vi.fn() };
    const error = Object.assign(new Error('Bearer private-token'), { code: 'TEMPORARY_FAILURE' });
    const service = new HandoffQueueService(store, { handle: vi.fn().mockRejectedValue(error) }, options, () => new Date(1000), audit);
    expect(await service.processOne()).toBe('retry_scheduled');
    expect(store.item?.next).toEqual(new Date(11000));
    expect(JSON.stringify(audit.error.mock.calls)).not.toContain('private-token');
  });

  it('dead-letters poison work at the attempt limit', async () => {
    const store = new MemoryQueue(2);
    const service = new HandoffQueueService(store, { handle: vi.fn().mockRejectedValue(new Error('poison')) }, options, () => new Date(1000));
    expect(await service.processOne()).toBe('dead_lettered');
    expect(store.item?.status).toBe('dead_letter');
  });

  it('exposes aggregate metrics without payloads', async () => {
    const metrics = await new HandoffQueueService(new MemoryQueue(), { handle: vi.fn() }, options).getMetrics();
    expect(metrics).toEqual(expect.objectContaining({ ready: 1, oldestReadyAgeSeconds: 10 }));
    expect(JSON.stringify(metrics)).not.toContain('handoffId');
  });
});
