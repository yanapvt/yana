import { pool } from '../src/db/connection.js';

interface SourcingLeadRow {
  request_id: string;
  whatsapp_user_id: string;
  hotel_name: string;
  destination: string;
  check_in: string;
  check_out: string;
  guests: number;
  budget: string;
  created_at: string;
}

try {
  const result = await pool.query<SourcingLeadRow>(`
    SELECT
      request.value ->> 'id' AS request_id,
      request.value ->> 'userId' AS whatsapp_user_id,
      request.value -> 'form' ->> 'preferredHotelName' AS hotel_name,
      request.value -> 'form' ->> 'destination' AS destination,
      request.value -> 'form' ->> 'checkIn' AS check_in,
      request.value -> 'form' ->> 'checkOut' AS check_out,
      (request.value -> 'form' ->> 'adults')::integer AS guests,
      request.value -> 'form' ->> 'budget' AS budget,
      request.value ->> 'createdAt' AS created_at
    FROM user_preferences
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(notification_preferences -> 'yanaServiceRequests', '[]'::jsonb)
    ) AS request(value)
    WHERE request.value ->> 'type' = 'hotel'
      AND request.value -> 'form' ->> 'sourcingStatus' = 'awaiting_quote'
    ORDER BY (request.value ->> 'createdAt')::timestamptz DESC
    LIMIT 50
  `);
  console.table(result.rows);
} catch {
  console.error('Could not read the hotel sourcing queue. Check the local Postgres connection.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
