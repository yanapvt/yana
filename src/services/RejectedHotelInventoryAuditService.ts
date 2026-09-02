import { pool } from '../db/connection.js';

export interface RejectedHotelInventoryAuditRecord {
  correlationId: string;
  rejectionReason: 'no_eligible_sltda_match';
  yanaHotelId: string;
  hotelName: string;
  destination?: string;
  supplier?: string;
  supplierHotelId?: string;
  roomName?: string;
  returnedAmount?: number;
  currency?: string;
  available?: boolean;
  bookable?: boolean;
  sanitizedDetails?: Record<string, unknown>;
}

export interface RejectedHotelInventoryAuditWriter {
  write(records: RejectedHotelInventoryAuditRecord[]): Promise<void>;
}

export class PostgresRejectedHotelInventoryAuditWriter
implements RejectedHotelInventoryAuditWriter {
  async write(records: RejectedHotelInventoryAuditRecord[]): Promise<void> {
    for (const record of records) {
      await pool.query({
        text: `INSERT INTO rejected_hotel_inventory_audit (
                 correlation_id, rejection_reason, yana_hotel_id, hotel_name,
                 destination, supplier, supplier_hotel_id, room_name,
                 returned_amount, currency, available, bookable, sanitized_details
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        values: [
          record.correlationId,
          record.rejectionReason,
          record.yanaHotelId,
          record.hotelName,
          record.destination ?? null,
          record.supplier ?? null,
          record.supplierHotelId ?? null,
          record.roomName ?? null,
          record.returnedAmount ?? null,
          record.currency ?? null,
          record.available ?? null,
          record.bookable ?? null,
          JSON.stringify(record.sanitizedDetails ?? {}),
        ],
      });
    }
  }
}
