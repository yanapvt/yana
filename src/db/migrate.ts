/**
 * Database Migration Runner
 *
 * This utility runs PostgreSQL migrations in order.
 * Requirements: 23.5
 */

import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { pool } from './connection.js';

interface MigrationFile {
  filename: string;
  order: number;
  sql: string;
}

/**
 * Load all migration files from the migrations directory
 */
async function loadMigrations(): Promise<MigrationFile[]> {
  const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
  const files = await readdir(migrationsDir);

  const sqlFiles = files.filter((f) => f.endsWith('.sql'));

  const migrations: MigrationFile[] = [];

  for (const filename of sqlFiles) {
    const orderMatch = filename.match(/^(\d+)_/);
    if (!orderMatch) continue;

    const order = parseInt(orderMatch[1], 10);
    const filepath = join(migrationsDir, filename);
    const sql = await readFile(filepath, 'utf-8');

    migrations.push({ filename, order, sql });
  }

  // Sort by order
  migrations.sort((a, b) => a.order - b.order);

  return migrations;
}

/**
 * Run migrations against a PostgreSQL database.
 */
export async function runMigrations(): Promise<void> {
  const migrations = await loadMigrations();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedResult = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations'
  );
  const applied = new Set(appliedResult.rows.map((row) => row.filename));

  console.log(`Found ${migrations.length} migration files.`);

  for (const migration of migrations) {
    if (applied.has(migration.filename)) {
      console.log(`Skipping ${migration.filename}`);
      continue;
    }

    const client = await pool.connect();
    try {
      console.log(`Applying ${migration.filename}`);
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
        migration.filename,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log('Migrations complete.');
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
