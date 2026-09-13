import { describe, expect, it } from 'vitest';
import { HotelRecheckReceiptService, type HotelRecheckReceiptStore, type ReceiptValidation } from './HotelRecheckReceiptService.js';

const selection = { selectedHotelId: 'hotel:room', selectedFromBatchIndex: 0, selectedDisplayNumber: 1, selectedAt: '2026-09-14T00:00:00Z', selectedHotelSnapshot: { id: 'hotel:room', name: 'Safe Stay' } };
class MemoryStore implements HotelRecheckReceiptStore {
  records = new Map<string, any>();
  async issue(record: any) { this.records.set(record.receiptId, { ...record }); }
  async consume(id: string, expected: any, now: Date): Promise<ReceiptValidation> {
    const r = this.records.get(id); if (!r) return 'missing'; if (r.consumedAt) return 'replayed'; if (new Date(r.expiresAt) <= now) return 'stale';
    if (['selectionHash','stayHash','occupancyHash','providerHash'].some(k => r[k] !== expected[k])) return 'mismatch';
    r.consumedAt = now; return 'valid';
  }
}
describe('HotelRecheckReceiptService', () => {
  const criteria = { checkinDate: '2026-10-01', checkoutDate: '2026-10-03', guests: 2, rooms: 1 };
  it('issues a short-lived opaque receipt and permits exactly one matching consume', async () => {
    const store = new MemoryStore(); const service = new HotelRecheckReceiptService(store, () => new Date('2026-09-14T00:00:00Z'), 600_000);
    const receipt = await service.issue(selection, criteria, 'liteapi');
    expect(Object.keys(receipt).sort()).toEqual(['expiresAt','issuedAt','provider','receiptId']);
    expect(await service.consume(receipt, selection, criteria, 'corr-1')).toBe('valid');
    expect(await service.consume(receipt, selection, criteria, 'corr-2')).toBe('replayed');
  });
  it('rejects stale, mismatched and forged receipts', async () => {
    const store = new MemoryStore(); let now = new Date('2026-09-14T00:00:00Z'); const service = new HotelRecheckReceiptService(store, () => now, 1000);
    const stale = await service.issue(selection, criteria, 'liteapi'); now = new Date('2026-09-14T00:00:02Z'); expect(await service.consume(stale, selection, criteria, 'corr')).toBe('stale');
    now = new Date('2026-09-14T00:00:00Z'); const mismatched = await service.issue(selection, criteria, 'liteapi'); expect(await service.consume(mismatched, { ...selection, selectedHotelId: 'other' }, criteria, 'corr')).toBe('mismatch');
    expect(await service.consume({ ...mismatched, receiptId: '00000000-0000-4000-8000-000000000099' }, selection, criteria, 'corr')).toBe('missing');
  });
});
