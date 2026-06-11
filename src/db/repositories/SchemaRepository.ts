/**
 * SchemaRepository - Data access layer for schema entities
 * Handles schemas and schema_versions
 * Requirements: 16.2, 21.2
 */

import { pool } from '../connection.js';

// ============================================================================
// Types
// ============================================================================

export interface Schema {
  schemaId: string;
  schemaName: string;
  currentVersion: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SchemaVersion {
  versionId: string;
  schemaId: string;
  version: string;
  requiredFields: string[];
  optionalFields: string[];
  fields: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
}

// ============================================================================
// SchemaRepository Class
// ============================================================================

export class SchemaRepository {
  /**
   * Create a new schema
   * Idempotent: If schema with name exists, returns existing schema
   */
  async createSchema(
    schemaName: string,
    currentVersion: string,
    description?: string
  ): Promise<Schema> {
    // Check if schema exists (idempotency)
    const existing = await pool.query<Schema>(
      'SELECT * FROM schemas WHERE schema_name = $1',
      [schemaName]
    );

    if (existing.rows.length > 0) {
      return this.mapSchema(existing.rows[0]);
    }

    const result = await pool.query<Schema>(
      `INSERT INTO schemas (schema_name, current_version, description, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING schema_id, schema_name, current_version, description, created_at, updated_at`,
      [schemaName, currentVersion, description]
    );

    return this.mapSchema(result.rows[0]);
  }

  /**
   * Find schema by name
   */
  async findByName(schemaName: string): Promise<Schema | null> {
    const result = await pool.query<Schema>(
      `SELECT schema_id, schema_name, current_version, description, created_at, updated_at
       FROM schemas WHERE schema_name = $1`,
      [schemaName]
    );

    return result.rows.length > 0 ? this.mapSchema(result.rows[0]) : null;
  }

  /**
   * Find schema by ID
   */
  async findById(schemaId: string): Promise<Schema | null> {
    const result = await pool.query<Schema>(
      `SELECT schema_id, schema_name, current_version, description, created_at, updated_at
       FROM schemas WHERE schema_id = $1`,
      [schemaId]
    );

    return result.rows.length > 0 ? this.mapSchema(result.rows[0]) : null;
  }

  /**
   * Update schema current version
   * Idempotent: Can be called multiple times with same version
   */
  async updateCurrentVersion(schemaId: string, currentVersion: string): Promise<Schema> {
    const result = await pool.query<Schema>(
      `UPDATE schemas SET current_version = $1, updated_at = NOW()
       WHERE schema_id = $2
       RETURNING schema_id, schema_name, current_version, description, created_at, updated_at`,
      [currentVersion, schemaId]
    );

    return this.mapSchema(result.rows[0]);
  }

  /**
   * Create a schema version
   * Idempotent: If version exists for schema, returns existing version
   */
  async createVersion(data: {
    schemaId: string;
    version: string;
    requiredFields: string[];
    optionalFields: string[];
    fields: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    isActive?: boolean;
  }): Promise<SchemaVersion> {
    // Check if version exists (idempotency)
    const existing = await pool.query<SchemaVersion>(
      'SELECT * FROM schema_versions WHERE schema_id = $1 AND version = $2',
      [data.schemaId, data.version]
    );

    if (existing.rows.length > 0) {
      return this.mapSchemaVersion(existing.rows[0]);
    }

    const result = await pool.query<SchemaVersion>(
      `INSERT INTO schema_versions (schema_id, version, required_fields, optional_fields, fields, metadata, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING version_id, schema_id, version, required_fields, optional_fields, fields, metadata, is_active, created_at`,
      [
        data.schemaId,
        data.version,
        JSON.stringify(data.requiredFields),
        JSON.stringify(data.optionalFields),
        JSON.stringify(data.fields),
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.isActive ?? true,
      ]
    );

    return this.mapSchemaVersion(result.rows[0]);
  }

  /**
   * Find schema version by schema ID and version
   */
  async findVersion(schemaId: string, version: string): Promise<SchemaVersion | null> {
    const result = await pool.query<SchemaVersion>(
      `SELECT version_id, schema_id, version, required_fields, optional_fields, fields, metadata, is_active, created_at
       FROM schema_versions WHERE schema_id = $1 AND version = $2`,
      [schemaId, version]
    );

    return result.rows.length > 0 ? this.mapSchemaVersion(result.rows[0]) : null;
  }

  /**
   * Find all versions for a schema
   */
  async findVersionsBySchemaId(schemaId: string): Promise<SchemaVersion[]> {
    const result = await pool.query<SchemaVersion>(
      `SELECT version_id, schema_id, version, required_fields, optional_fields, fields, metadata, is_active, created_at
       FROM schema_versions WHERE schema_id = $1
       ORDER BY created_at DESC`,
      [schemaId]
    );

    return result.rows.map((row) => this.mapSchemaVersion(row));
  }

  /**
   * Find active versions for a schema
   */
  async findActiveVersions(schemaId: string): Promise<SchemaVersion[]> {
    const result = await pool.query<SchemaVersion>(
      `SELECT version_id, schema_id, version, required_fields, optional_fields, fields, metadata, is_active, created_at
       FROM schema_versions WHERE schema_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [schemaId]
    );

    return result.rows.map((row) => this.mapSchemaVersion(row));
  }

  /**
   * Deactivate a schema version
   * Idempotent: Can be called multiple times
   */
  async deactivateVersion(versionId: string): Promise<void> {
    await pool.query('UPDATE schema_versions SET is_active = false WHERE version_id = $1', [
      versionId,
    ]);
  }

  // ============================================================================
  // Private Mapping Methods
  // ============================================================================

  private mapSchema(row: any): Schema {
    return {
      schemaId: row.schema_id,
      schemaName: row.schema_name,
      currentVersion: row.current_version,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSchemaVersion(row: any): SchemaVersion {
    return {
      versionId: row.version_id,
      schemaId: row.schema_id,
      version: row.version,
      requiredFields: row.required_fields,
      optionalFields: row.optional_fields,
      fields: row.fields,
      metadata: row.metadata,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  }
}
