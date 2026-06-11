/**
 * Seed script for search_hotels schema v1.0
 * 
 * This script seeds the search_hotels schema definition into the database.
 * It is idempotent and can be run multiple times safely.
 * 
 * Requirements: 3.1, 3.2, 7.1, 7.2
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SchemaRepository } from '../repositories/SchemaRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface SchemaDefinitionFile {
  schemaName: string;
  version: string;
  description?: string;
  requiredFields: string[];
  optionalFields: string[];
  fields: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Seed Function
// ============================================================================

/**
 * Seed the search_hotels schema v1.0 into the database
 * 
 * This function:
 * 1. Loads the schema definition from JSON file
 * 2. Creates the schema record (idempotent)
 * 3. Creates the schema version record (idempotent)
 * 4. Updates the schema's current version
 * 
 * @returns Promise<void>
 */
export async function seedSearchHotelsSchema(): Promise<void> {
  const schemaRepo = new SchemaRepository();

  // Load schema definition from JSON file
  const schemaFilePath = join(__dirname, 'search_hotels_schema_v1.0.json');
  const schemaFileContent = readFileSync(schemaFilePath, 'utf-8');
  const schemaDef: SchemaDefinitionFile = JSON.parse(schemaFileContent);

  console.log(`Seeding schema: ${schemaDef.schemaName} v${schemaDef.version}`);

  // Step 1: Create schema record (idempotent)
  const schema = await schemaRepo.createSchema(
    schemaDef.schemaName,
    schemaDef.version,
    schemaDef.description
  );

  console.log(`✓ Schema record created/found: ${schema.schemaId}`);

  // Step 2: Create schema version record (idempotent)
  const schemaVersion = await schemaRepo.createVersion({
    schemaId: schema.schemaId,
    version: schemaDef.version,
    requiredFields: schemaDef.requiredFields,
    optionalFields: schemaDef.optionalFields,
    fields: schemaDef.fields,
    metadata: schemaDef.metadata,
    isActive: true,
  });

  console.log(`✓ Schema version created/found: ${schemaVersion.versionId}`);

  // Step 3: Update current version (idempotent)
  await schemaRepo.updateCurrentVersion(schema.schemaId, schemaDef.version);

  console.log(`✓ Current version updated to: ${schemaDef.version}`);
  console.log(`\n✅ Successfully seeded search_hotels schema v1.0`);
}

// ============================================================================
// CLI Execution
// ============================================================================

/**
 * Run the seed script if executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  seedSearchHotelsSchema()
    .then(() => {
      console.log('\n✅ Seed completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Seed failed:', error);
      process.exit(1);
    });
}
