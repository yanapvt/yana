/**
 * Database Migration Runner
 *
 * Runs PostgreSQL migrations in order, tracking applied migrations
 * in a `schema_migrations` table so each file is only applied once.
 *
 * Requirements: 23.5
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import pg from 'pg';
import { config } from 'dotenv';

// Load .env so this script works when run directly (outside the app)
config();

const { Pool } = pg;

interface MigrationFile {
  filename: string;
  order: number;
  sql: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
  const files = await readdir(migrationsDir);

  const migrations: MigrationFile[] = [];

  for (const filename of files.filter((f) => f.endsWith('.sql'))) {
    const orderMatch = filename.match(/^(\d+)_/);
    if (!orderMatch) continue;

    const order = parseInt(orderMatch[1], 10);
    const sql = await readFile(join(migrationsDir, filename), 'utf-8');
    migrations.push({ filename, order, sql });
  }

  return migrations.sort((a, b) => a.order - b.order);
}

export async function runMigrations(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'yana_ogo',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '',
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrations = await loadMigrations();
    console.log(`Found ${migrations.length} migration files.`);

    let applied = 0;
    let skipped = 0;

    for (const migration of migrations) {
      // Check if already applied
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [migration.filename]
      );

      if (rows.length > 0) {
        console.log(`  SKIP  ${migration.filename}`);
        skipped++;
        continue;
      }

      // Apply migration in a transaction
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [migration.filename]
        );
        await client.query('COMMIT');
        console.log(`  APPLY ${migration.filename}`);
        applied++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  FAIL  ${migration.filename}:`, err instanceof Error ? err.message : err);
        throw err;
      }
    }

    console.log(`\nDone. Applied: ${applied}, Skipped: ${skipped}`);
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}
