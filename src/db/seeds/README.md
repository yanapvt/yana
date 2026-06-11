# Database Seeds

This directory contains seed data and seeding scripts for the YANA/OGO platform.

## Overview

Seeds are used to populate the database with initial data such as schema definitions, tool registrations, and reference data. All seeding scripts are idempotent and can be run multiple times safely.

## Available Seeds

### search_hotels Schema (v1.0)

**File:** `search_hotels_schema_v1.0.json`  
**Script:** `seedSearchHotelsSchema.ts`  
**Requirements:** 3.1, 3.2, 7.1, 7.2

The search_hotels schema defines the workflow for collecting hotel search parameters from users through WhatsApp.

**Fields:**
- **Required:** `location`, `checkin_date`
- **Optional:** `checkout_date`, `guests`, `budget`, `currency`

**Features:**
- Complete field definitions with types and validation rules
- WhatsApp UI metadata (buttons, lists, text input modes)
- Multilingual localization keys (English, Spanish, French)
- Fallback prompts for unsupported UI modes
- Provider mappings for external APIs
- Field collection order configuration

## Running Seeds

### Prerequisites

1. Ensure PostgreSQL is running
2. Set up environment variables (see `.env.example`)
3. Run database migrations:
   ```bash
   npm run migrate
   ```

### Execute a Seed Script

To seed the search_hotels schema:

```bash
npx tsx src/db/seeds/seedSearchHotelsSchema.ts
```

Or using Node.js with ES modules:

```bash
node --loader tsx src/db/seeds/seedSearchHotelsSchema.ts
```

### Verify Seeding

After running the seed script, you can verify the data was inserted:

```sql
-- Check schema record
SELECT * FROM schemas WHERE schema_name = 'search_hotels';

-- Check schema version
SELECT sv.* 
FROM schema_versions sv
JOIN schemas s ON sv.schema_id = s.schema_id
WHERE s.schema_name = 'search_hotels';
```

## Testing

### Unit Tests

Unit tests validate the schema definition file structure without requiring a database:

```bash
npm test src/db/seeds/seedSearchHotelsSchema.test.ts
```

These tests verify:
- JSON structure validity
- Required and optional field definitions
- Field types and validation rules
- UI metadata completeness
- Localization key coverage
- Fallback prompt availability

### Integration Tests

For integration tests that actually seed the database and verify retrieval, ensure:

1. A test database is running
2. Migrations have been applied
3. Environment variables point to the test database

Then run:

```bash
POSTGRES_DB=yana_ogo_test npm test src/db/seeds/seedSearchHotelsSchema.integration.test.ts
```

## Schema Definition Format

Schema definitions follow this structure:

```json
{
  "schemaName": "schema_name",
  "version": "1.0",
  "description": "Schema description",
  "requiredFields": ["field1", "field2"],
  "optionalFields": ["field3", "field4"],
  "fields": {
    "field1": {
      "name": "field1",
      "type": "text|number|date|location|location_or_text|currency|boolean|enum",
      "ui": {
        "promptKey": "localization.key",
        "mode": "text|buttons|list|list_or_text",
        "options": [
          {
            "id": "option_id",
            "labelKey": "option.label.key",
            "value": "option_value"
          }
        ],
        "placeholder": "Placeholder text"
      },
      "validation": {
        "required": true|false,
        "min": 0,
        "max": 100,
        "pattern": "^regex$",
        "customValidator": "validator_name"
      },
      "conditional": {
        "dependsOn": "other_field",
        "condition": "equals|not_equals|exists|not_exists",
        "value": "expected_value"
      }
    }
  },
  "metadata": {
    "collectionOrder": ["field1", "field2", "field3"],
    "toolBinding": "tool_name",
    "providerMappings": {
      "provider_name": {
        "field1": "provider_field_name"
      }
    },
    "localizationKeys": {
      "localization.key": {
        "en": "English text",
        "es": "Spanish text",
        "fr": "French text"
      }
    },
    "fallbackPrompts": {
      "field1": "Fallback prompt text"
    }
  }
}
```

## Adding New Seeds

To add a new seed:

1. Create a JSON definition file: `{name}_v{version}.json`
2. Create a seeding script: `seed{Name}.ts`
3. Create unit tests: `seed{Name}.test.ts`
4. Update this README with the new seed information

### Seeding Script Template

```typescript
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SchemaRepository } from '../repositories/SchemaRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function seedMySchema(): Promise<void> {
  const schemaRepo = new SchemaRepository();
  
  // Load definition
  const schemaFilePath = join(__dirname, 'my_schema_v1.0.json');
  const schemaDef = JSON.parse(readFileSync(schemaFilePath, 'utf-8'));
  
  // Create schema (idempotent)
  const schema = await schemaRepo.createSchema(
    schemaDef.schemaName,
    schemaDef.version,
    schemaDef.description
  );
  
  // Create version (idempotent)
  await schemaRepo.createVersion({
    schemaId: schema.schemaId,
    version: schemaDef.version,
    requiredFields: schemaDef.requiredFields,
    optionalFields: schemaDef.optionalFields,
    fields: schemaDef.fields,
    metadata: schemaDef.metadata,
    isActive: true,
  });
  
  // Update current version
  await schemaRepo.updateCurrentVersion(schema.schemaId, schemaDef.version);
  
  console.log(`✅ Successfully seeded ${schemaDef.schemaName} v${schemaDef.version}`);
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  seedMySchema()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Seed failed:', error);
      process.exit(1);
    });
}
```

## Idempotency

All seeding scripts are designed to be idempotent:

- Running a seed multiple times produces the same result
- Existing records are not duplicated
- Original values are preserved (no overwrites)
- Safe to run in any environment

This is achieved through:
- Checking for existing records before insertion
- Using unique constraints in the database
- Returning existing records when found

## Best Practices

1. **Version Control:** Always version schema definitions (e.g., v1.0, v1.1)
2. **Backward Compatibility:** Don't modify existing schema versions; create new versions instead
3. **Testing:** Write comprehensive unit tests for schema definitions
4. **Documentation:** Document all fields, validation rules, and UI behaviors
5. **Localization:** Provide translations for all user-facing text
6. **Fallbacks:** Always include fallback prompts for graceful degradation
