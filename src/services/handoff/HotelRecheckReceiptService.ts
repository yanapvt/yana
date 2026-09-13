import crypto from 'node:crypto';
import { pool } from '../../db/connection.js';
import type { HotelSearchCriteria } from '../HotelIntakeService.js';
import type { SelectedHotel } from '../hotelSearchSessionService.js';

export interface HotelRecheckReceipt { receiptId: string; issuedAt: string; expiresAt: string; provider: string }
export type ReceiptValidation = 'valid' | 'missing' | 'stale' | 'mismatch' | 'replayed';
interface ReceiptRecord extends HotelRecheckReceipt { selectionHash: string; stayHash: string; occupancyHash: string; providerHash: string; consumedAt?: Date }
type ExpectedBindings = Pick<ReceiptRecord, 'selectionHash' | 'stayHash' | 'occupancyHash' | 'providerHash'>;

export interface HotelRecheckReceiptStore {
  issue(record: ReceiptRecord): Promise<void>;
  consume(receiptId: string, expected: ExpectedBindings, now: Date, correlationId: string): Promise<ReceiptValidation>;
}

export class PostgresHotelRecheckReceiptStore implements HotelRecheckReceiptStore {
  async issue(r: ReceiptRecord): Promise<void> {
    await pool.query(`INSERT INTO hotel_recheck_receipts(receipt_id, selection_hash, stay_hash, occupancy_hash, provider_hash, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.receiptId, r.selectionHash, r.stayHash, r.occupancyHash, r.providerHash, r.issuedAt, r.expiresAt]);
  }
  async consume(receiptId: string, expected: ExpectedBindings, now: Date, correlationId: string): Promise<ReceiptValidation> {
    const result = await pool.query(
      `UPDATE hotel_recheck_receipts SET consumed_at=$2, consumed_correlation_id=$3 WHERE receipt_id=$1 AND consumed_at IS NULL AND expires_at>$2 AND selection_hash=$4 AND stay_hash=$5 AND occupancy_hash=$6 AND provider_hash=$7 RETURNING receipt_id`,
      [receiptId, now, correlationId, expected.selectionHash, expected.stayHash, expected.occupancyHash, expected.providerHash]);
    if (result.rowCount === 1) return 'valid';
    const found = await pool.query(`SELECT expires_at, consumed_at FROM hotel_recheck_receipts WHERE receipt_id=$1`, [receiptId]);
    if (!found.rows[0]) return 'missing';
    if (found.rows[0].consumed_at) return 'replayed';
    if (new Date(found.rows[0].expires_at) <= now) return 'stale';
    return 'mismatch';
  }
}

export class HotelRecheckReceiptService {
  constructor(private readonly store: HotelRecheckReceiptStore = new PostgresHotelRecheckReceiptStore(), private readonly clock: () => Date = () => new Date(), private readonly ttlMs = 10 * 60_000) {}
  async issue(selection: SelectedHotel, criteria: HotelSearchCriteria, provider: string): Promise<HotelRecheckReceipt> {
    const now = this.clock();
    const receipt: HotelRecheckReceipt = { receiptId: crypto.randomUUID(), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(), provider };
    await this.store.issue({ ...receipt, ...bindings(selection, criteria, provider) });
    return receipt;
  }
  consume(receipt: HotelRecheckReceipt | undefined, selection: SelectedHotel, criteria: HotelSearchCriteria, correlationId: string): Promise<ReceiptValidation> {
    if (!receipt) return Promise.resolve('missing');
    return this.store.consume(receipt.receiptId, bindings(selection, criteria, receipt.provider), this.clock(), correlationId);
  }
}

function bindings(selection: SelectedHotel, criteria: HotelSearchCriteria, provider: string): ExpectedBindings {
  return {
    selectionHash: hash(`${selection.selectedHotelId}|${selection.selectedHotelSnapshot.id ?? ''}|${selection.selectedAt}`),
    stayHash: hash(`${criteria.checkinDate ?? ''}|${criteria.checkoutDate ?? ''}`),
    occupancyHash: hash(`${criteria.guests ?? 2}|${criteria.rooms ?? 1}`), providerHash: hash(provider),
  };
}
function hash(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

let receiptService: HotelRecheckReceiptService | undefined;
export function getHotelRecheckReceiptService(): HotelRecheckReceiptService { return receiptService ??= new HotelRecheckReceiptService(); }
