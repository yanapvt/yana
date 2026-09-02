/**
 * Migration Validation Script
 *
 * Validates that all required tables and indexes are present in migration files.
 * Requirements: 16.2, 16.4, 16.5, 16.6, 23.5
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join } from 'path';

const REQUIRED_TABLES = [
  'users',
  'user_profiles',
  'user_preferences',
  'user_language_settings',
  'sessions',
  'session_state',
  'messages',
  'message_translations',
  'schemas',
  'schema_versions',
  'tool_registry',
  'tool_runs',
  'provider_integrations',
  'bookings',
  'booking_events',
  'payments',
  'payment_events',
  'vendors',
  'vendor_preferences',
  'vendor_language_settings',
  'human_handoffs',
  'notifications',
  'audit_logs',
  'decision_logs',
  'tts_assets',
  'registered_accommodations',
  'srilanka_accommodations',
  'rejected_hotel_inventory_audit',
];

const REQUIRED_INDEX_TYPES = {
  session_lookup: [
    'idx_sessions_user_id',
    'idx_sessions_phone_number',
    'idx_sessions_last_activity',
  ],
  user_lookup: ['idx_users_phone_number', 'idx_users_phone_hash'],
  booking_payment_state: ['idx_bookings_state', 'idx_payments_state'],
  correlation_id: [
    'idx_messages_correlation_id',
    'idx_tool_runs_correlation_id',
    'idx_bookings_correlation_id',
    'idx_payments_correlation_id',
    'idx_audit_logs_correlation_id',
    'idx_decision_logs_correlation_id',
    'idx_human_handoffs_correlation_id',
  ],
  registered_accommodation_lookup: [
    'registered_accommodations_normalized_name_idx',
    'registered_accommodations_district_idx',
    'registered_accommodations_licence_validity_idx',
  ],
  srilanka_accommodation_lookup: [
    'srilanka_accommodations_record_key_idx',
    'srilanka_accommodations_registration_no_idx',
    'srilanka_accommodations_name_idx',
    'srilanka_accommodations_local_authority_idx',
  ],
  rejected_hotel_inventory_audit_lookup: [
    'rejected_hotel_inventory_audit_correlation_idx',
    'rejected_hotel_inventory_audit_occurred_at_idx',
    'rejected_hotel_inventory_audit_supplier_idx',
    'rejected_hotel_inventory_audit_reason_idx',
  ],
};

async function validateMigrations(): Promise<void> {
  console.log('Validating migration files...\n');

  // Read all migration files
  const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
  const migrationFiles = [
    '001_create_users_and_profiles.sql',
    '002_create_sessions.sql',
    '003_create_messages.sql',
    '004_create_schemas.sql',
    '005_create_tools.sql',
    '006_create_provider_integrations.sql',
    '007_create_bookings.sql',
    '008_create_payments.sql',
    '009_create_vendors.sql',
    '010_create_human_handoffs.sql',
    '011_create_notifications.sql',
    '012_create_audit_logs.sql',
    '013_create_tts_assets.sql',
    '014_create_registered_accommodations.sql',
    '015_support_srilanka_accommodations.sql',
    '016_create_rejected_hotel_inventory_audit.sql',
  ];

  let allContent = '';
  for (const file of migrationFiles) {
    const filepath = join(migrationsDir, file);
    const content = await readFile(filepath, 'utf-8');
    allContent += content + '\n';
  }

  // Validate tables
  console.log('Checking required tables:');
  const missingTables: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const regex = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(`, 'i');
    if (regex.test(allContent)) {
      console.log(`  ✅ ${table}`);
    } else {
      console.log(`  ❌ ${table} - MISSING`);
      missingTables.push(table);
    }
  }

  // Validate indexes
  console.log('\nChecking required indexes:');
  const missingIndexes: string[] = [];
  for (const [category, indexes] of Object.entries(REQUIRED_INDEX_TYPES)) {
    console.log(`\n  ${category}:`);
    for (const index of indexes) {
      const regex = new RegExp(`CREATE INDEX (?:IF NOT EXISTS )?${index}`, 'i');
      if (regex.test(allContent)) {
        console.log(`    ✅ ${index}`);
      } else {
        console.log(`    ❌ ${index} - MISSING`);
        missingIndexes.push(index);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (missingTables.length === 0 && missingIndexes.length === 0) {
    console.log('✅ All required tables and indexes are present!');
    console.log(`\nTotal tables: ${REQUIRED_TABLES.length}`);
    console.log(`Total required indexes: ${Object.values(REQUIRED_INDEX_TYPES).flat().length}`);
  } else {
    console.log('❌ Validation failed!');
    if (missingTables.length > 0) {
      console.log(`\nMissing tables (${missingTables.length}):`, missingTables);
    }
    if (missingIndexes.length > 0) {
      console.log(`\nMissing indexes (${missingIndexes.length}):`, missingIndexes);
    }
    process.exit(1);
  }
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  validateMigrations().catch(console.error);
}
