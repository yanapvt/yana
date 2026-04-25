/**
 * Database connection management
 * Provides a connection pool for Postgres database access
 */

import pg from 'pg';
import { env } from '../config/environment.js';
import { logger } from '../config/logger.js';

const { Pool } = pg;

logger.debug('Database', 'Initializing connection pool', {
  host: env.postgres.host,
  port: env.postgres.port,
  database: env.postgres.database,
  user: env.postgres.user,
  maxConnections: 20,
});

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

pool.on('connect', () => {
  logger.debug('Database', 'New connection established');
});

pool.on('error', (err: Error) => {
  logger.error('Database', 'Unexpected error in connection pool', {
    error: err.message,
    stack: err.stack,
  });
});

// ============================================================================
// Connection Health Check
// ============================================================================

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    logger.debug('Database', 'Checking database connection...');
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info('Database', 'Connection check successful');
    return true;
  } catch (error) {
    logger.error('Database', 'Connection check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeDatabaseConnection(): Promise<void> {
  try {
    logger.info('Database', 'Closing database connection pool');
    await pool.end();
    logger.info('Database', 'Database connection pool closed successfully');
  } catch (error) {
    logger.error('Database', 'Error closing database connection', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
