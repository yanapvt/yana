/**
 * Database connection management
 * Provides a connection pool for Postgres database access
 */

import pg from 'pg';
import { env } from '../config/environment.js';

const { Pool } = pg;

// ============================================================================
// Connection Pool
// ============================================================================

export const pool = new Pool({
  host: env.postgres.host,
  port: env.postgres.port,
  database: env.postgres.database,
  user: env.postgres.user,
  password: env.postgres.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ============================================================================
// Connection Health Check
// ============================================================================

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection check failed:', error);
    return false;
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeDatabaseConnection(): Promise<void> {
  await pool.end();
}
