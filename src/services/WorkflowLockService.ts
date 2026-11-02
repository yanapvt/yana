import { pool } from '../db/connection.js';
import { PersistenceError } from '../storage/Persistence.js';

/** Shared per-traveller mutation lock. CAS remains necessary for work completed after this request. */
export async function withWorkflowLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const client = await pool.connect().catch(() => { throw new PersistenceError(); });
  let held = false;
  let discarded = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired', [userId]
    ).catch(() => { throw new PersistenceError(); });
    held = result.rows[0]?.acquired === true;
    if (!held) throw new PersistenceError('conflict');
    return await operation();
  } finally {
    if (held) {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [userId]); }
      catch { client.release(new Error('Workflow lock connection discarded')); discarded = true; }
    }
    if (!discarded) client.release();
  }
}
