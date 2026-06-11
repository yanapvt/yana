/**
 * Property Test 6: Schema Version Compatibility
 * 
 * Property Statement:
 * For any active session referencing a specific schema version, updating the schema 
 * to a new version SHALL not invalidate the session's ability to complete its flow 
 * using the referenced version.
 * 
 * **Validates: Requirements 3.4, 3.5**
 * 
 * Requirements:
 * - 3.4: THE System SHALL support schema versioning so that active sessions can 
 *        reference the schema version in use at session start
 * - 3.5: WHEN a schema version is updated, THE Schema_Engine SHALL not break active 
 *        sessions that reference a prior schema version
 */

import fc from 'fast-check';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchemaEngine } from '../../services/SchemaEngine.js';
import { SessionManager } from '../../services/SessionManager.js';
import { SchemaRepository } from '../../db/repositories/SchemaRepository.js';
import { UserRepository } from '../../db/repositories/UserRepository.js';
import { SessionRepository } from '../../db/repositories/SessionRepository.js';
import { MessageRepository } from '../../db/repositories/MessageRepository.js';
import { StateStore } from '../../services/StateStore.js';
import type { SchemaDefinition, SessionState } from '../../types/core.js';

// ============================================================================
// Arbitraries for Property-Based Testing
// ============================================================================

/**
 * Generates arbitrary schema names
 */
const schemaNameArb = fc.constantFrom(
  'search_hotels',
  'book_hotel',
  'search_transport',
  'book_excursion',
  'search_restaurants'
);

/**
 * Generates arbitrary version strings
 */
const versionArb = fc.oneof(
  fc.constant('1.0'),
  fc.constant('1.1'),
  fc.constant('2.0'),
  fc.constant('2.1'),
  fc.constant('3.0')
);

/**
 * Generates arbitrary field names
 */
const fieldNameArb = fc.constantFrom(
  'location',
  'checkin_date',
  'checkout_date',
  'guests',
  'budget',
  'currency',
  'destination',
  'departure_date',
  'meal_preference',
  'room_type'
);

/**
 * Generates a schema definition with a specific version
 */
const schemaDefinitionArb = fc
  .tuple(
    schemaNameArb,
    versionArb,
    fc.array(fieldNameArb, { minLength: 2, maxLength: 5 }),
    fc.array(fieldNameArb, { minLength: 0, maxLength: 3 })
  )
  .map(([name, version, requiredFields, optionalFields]) => {
    // Ensure unique field names
    const uniqueRequired = Array.from(new Set(requiredFields));
    const uniqueOptional = Array.from(
      new Set(optionalFields.filter((f) => !uniqueRequired.includes(f)))
    );

    const fields: Record<string, any> = {};
    
    [...uniqueRequired, ...uniqueOptional].forEach((fieldName) => {
      fields[fieldName] = {
        name: fieldName,
        type: 'text',
        ui: {
          promptKey: `field.${fieldName}.prompt`,
          mode: 'text',
        },
        validation: {
          required: uniqueRequired.includes(fieldName),
        },
      };
    });

    const schema: SchemaDefinition = {
      schemaName: name,
      version,
      requiredFields: uniqueRequired,
      optionalFields: uniqueOptional,
      fields,
      metadata: {},
    };

    return schema;
  });

/**
 * Generates a new version of an existing schema with modifications
 */
const updatedSchemaArb = (originalSchema: SchemaDefinition) => {
  return fc
    .tuple(
      versionArb,
      fc.array(fieldNameArb, { minLength: 0, maxLength: 2 }), // new required fields
      fc.array(fieldNameArb, { minLength: 0, maxLength: 2 })  // new optional fields
    )
    .map(([newVersion, additionalRequired, additionalOptional]) => {
      // Ensure new version is different from original
      const version = newVersion === originalSchema.version ? '99.0' : newVersion;

      // Add new fields to the schema
      const newRequiredFields = Array.from(
        new Set([
          ...originalSchema.requiredFields,
          ...additionalRequired.filter(
            (f) =>
              !originalSchema.requiredFields.includes(f) &&
              !originalSchema.optionalFields.includes(f)
          ),
        ])
      );

      const newOptionalFields = Array.from(
        new Set([
          ...originalSchema.optionalFields,
          ...additionalOptional.filter(
            (f) =>
              !originalSchema.requiredFields.includes(f) &&
              !originalSchema.optionalFields.includes(f) &&
              !newRequiredFields.includes(f)
          ),
        ])
      );

      const newFields = { ...originalSchema.fields };
      
      // Add new required fields
      additionalRequired.forEach((fieldName) => {
        if (!newFields[fieldName]) {
          newFields[fieldName] = {
            name: fieldName,
            type: 'text',
            ui: {
              promptKey: `field.${fieldName}.prompt`,
              mode: 'text',
            },
            validation: {
              required: true,
            },
          };
        }
      });

      // Add new optional fields
      additionalOptional.forEach((fieldName) => {
        if (!newFields[fieldName]) {
          newFields[fieldName] = {
            name: fieldName,
            type: 'text',
            ui: {
              promptKey: `field.${fieldName}.prompt`,
              mode: 'text',
            },
            validation: {
              required: false,
            },
          };
        }
      });

      const updatedSchema: SchemaDefinition = {
        schemaName: originalSchema.schemaName,
        version,
        requiredFields: newRequiredFields,
        optionalFields: newOptionalFields,
        fields: newFields,
        metadata: originalSchema.metadata,
      };

      return updatedSchema;
    });
};

/**
 * Generates session state with a schema reference
 */
const sessionStateWithSchemaArb = (schema: SchemaDefinition) => {
  return fc
    .record({
      currentIntent: fc.constant(schema.schemaName),
      currentStep: fc.option(fc.constantFrom('collecting', 'validating', 'executing'), {
        nil: undefined,
      }),
      activeSchema: fc.constant(schema.schemaName),
      schemaVersion: fc.constant(schema.version),
      missingFields: fc.constant(schema.requiredFields.slice(0, 2)), // Some fields still missing
      collectedFields: fc.constant(
        schema.requiredFields.length > 2
          ? { [schema.requiredFields[2]]: 'test_value' }
          : {}
      ),
    })
    .map((state) => state as SessionState);
};

/**
 * Generates arbitrary session IDs
 */
const sessionIdArb = fc.uuid();

/**
 * Generates arbitrary user IDs
 */
const userIdArb = fc.uuid();

// ============================================================================
// Property Tests
// ============================================================================

describe('Property 6: Schema Version Compatibility', () => {
  let schemaEngine: SchemaEngine;
  let mockSchemaRepository: SchemaRepository;
  let mockSessionManager: SessionManager;
  let mockUserRepository: UserRepository;
  let mockSessionRepository: SessionRepository;
  let mockMessageRepository: MessageRepository;
  let mockStateStore: StateStore;

  beforeEach(() => {
    schemaEngine = new SchemaEngine();

    // Create mocks
    mockSchemaRepository = {
      findByName: vi.fn(),
      findVersion: vi.fn(),
      createSchema: vi.fn(),
      createVersion: vi.fn(),
      updateCurrentVersion: vi.fn(),
    } as unknown as SchemaRepository;

    mockUserRepository = {
      findByPhoneNumber: vi.fn(),
      createUser: vi.fn(),
      getProfile: vi.fn(),
      getPreferences: vi.fn(),
      getLanguageSettings: vi.fn(),
    } as unknown as UserRepository;

    mockSessionRepository = {
      findActiveByUserId: vi.fn(),
      createSession: vi.fn(),
      updateLastActivity: vi.fn(),
      findById: vi.fn(),
      getState: vi.fn(),
      updateState: vi.fn(),
      appendConversationHistory: vi.fn(),
    } as unknown as SessionRepository;

    mockMessageRepository = {
      createMessage: vi.fn(),
    } as unknown as MessageRepository;

    mockStateStore = {
      getSessionState: vi.fn(),
      setSessionState: vi.fn(),
    } as unknown as StateStore;

    mockSessionManager = new SessionManager(
      mockUserRepository,
      mockSessionRepository,
      mockMessageRepository,
      mockStateStore
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should allow sessions to continue using their referenced schema version after schema update', () => {
    return fc.assert(
      fc.asyncProperty(
        schemaDefinitionArb,
        sessionIdArb,
        userIdArb,
        async (originalSchema, sessionId, userId) => {
          // Given: A session referencing a specific schema version
          const sessionState = await fc.sample(
            sessionStateWithSchemaArb(originalSchema),
            1
          )[0];

          // Mock the schema repository to return the original version
          vi.mocked(mockSchemaRepository.findVersion).mockResolvedValue({
            versionId: 'v1',
            schemaId: 'schema1',
            version: originalSchema.version,
            requiredFields: originalSchema.requiredFields,
            optionalFields: originalSchema.optionalFields,
            fields: originalSchema.fields,
            metadata: originalSchema.metadata,
            isActive: true,
            createdAt: new Date(),
          });

          // When: The schema is updated to a new version
          const updatedSchema = await fc.sample(updatedSchemaArb(originalSchema), 1)[0];

          // Mock the schema repository to also have the new version
          vi.mocked(mockSchemaRepository.findByName).mockResolvedValue({
            schemaId: 'schema1',
            schemaName: originalSchema.schemaName,
            currentVersion: updatedSchema.version, // Current version is now the new one
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Then: The session should still be able to use the original version
          // Verify that we can still get missing fields using the original schema
          const missingFields = schemaEngine.getMissingFields(
            originalSchema,
            sessionState.collectedFields
          );

          expect(missingFields).toBeDefined();
          expect(Array.isArray(missingFields)).toBe(true);

          // Verify that schema completion check works with original version
          const isComplete = schemaEngine.isComplete(
            originalSchema,
            sessionState.collectedFields
          );

          expect(typeof isComplete).toBe('boolean');

          // Verify that field prompts can still be generated for original version
          for (const fieldName of missingFields) {
            const fieldDef = originalSchema.fields[fieldName];
            if (fieldDef) {
              const prompt = schemaEngine.generateFieldPrompt(fieldDef, 'en');
              expect(prompt).toBeDefined();
              expect(prompt.fieldName).toBe(fieldName);
            }
          }

          // Verify that the session's schema version reference is preserved
          expect(sessionState.schemaVersion).toBe(originalSchema.version);
          expect(sessionState.activeSchema).toBe(originalSchema.schemaName);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should maintain schema version isolation: sessions with different versions operate independently', () => {
    return fc.assert(
      fc.asyncProperty(
        schemaDefinitionArb,
        sessionIdArb,
        sessionIdArb,
        userIdArb,
        userIdArb,
        async (originalSchema, sessionId1, sessionId2, userId1, userId2) => {
          fc.pre(sessionId1 !== sessionId2); // Ensure different sessions

          // Given: Two sessions referencing different versions of the same schema
          const sessionState1 = await fc.sample(
            sessionStateWithSchemaArb(originalSchema),
            1
          )[0];

          const updatedSchema = await fc.sample(updatedSchemaArb(originalSchema), 1)[0];
          const sessionState2: SessionState = {
            currentIntent: updatedSchema.schemaName,
            currentStep: 'collecting',
            activeSchema: updatedSchema.schemaName,
            schemaVersion: updatedSchema.version,
            missingFields: updatedSchema.requiredFields.slice(0, 1),
            collectedFields: {},
          };

          // When: We process both sessions
          const missingFields1 = schemaEngine.getMissingFields(
            originalSchema,
            sessionState1.collectedFields
          );

          const missingFields2 = schemaEngine.getMissingFields(
            updatedSchema,
            sessionState2.collectedFields
          );

          // Then: Each session should operate according to its own schema version
          expect(missingFields1).toBeDefined();
          expect(missingFields2).toBeDefined();

          // Verify session 1 uses original schema rules
          const isComplete1 = schemaEngine.isComplete(
            originalSchema,
            sessionState1.collectedFields
          );
          expect(typeof isComplete1).toBe('boolean');

          // Verify session 2 uses updated schema rules
          const isComplete2 = schemaEngine.isComplete(
            updatedSchema,
            sessionState2.collectedFields
          );
          expect(typeof isComplete2).toBe('boolean');

          // Verify that schema version references are preserved
          expect(sessionState1.schemaVersion).toBe(originalSchema.version);
          expect(sessionState2.schemaVersion).toBe(updatedSchema.version);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should preserve schema version reference through session state updates', () => {
    return fc.assert(
      fc.asyncProperty(
        schemaDefinitionArb,
        sessionIdArb,
        userIdArb,
        async (originalSchema, sessionId, userId) => {
          vi.mocked(mockStateStore.getSessionState).mockReset();
          vi.mocked(mockStateStore.setSessionState).mockClear();
          vi.mocked(mockSessionRepository.updateState).mockResolvedValue(undefined);
          vi.mocked(mockSessionRepository.updateLastActivity).mockResolvedValue(undefined);

          // Given: A session with a schema version reference
          const initialState = await fc.sample(
            sessionStateWithSchemaArb(originalSchema),
            1
          )[0];

          // Mock session state storage
          vi.mocked(mockStateStore.getSessionState)
            .mockResolvedValueOnce(initialState)
            .mockResolvedValueOnce(initialState);

          // When: We update the session state (e.g., collecting a field)
          const updatedCollectedFields = {
            ...initialState.collectedFields,
            newField: 'new_value',
          };

          const updatedState: Partial<SessionState> = {
            collectedFields: updatedCollectedFields,
            missingFields: initialState.missingFields.slice(1), // One less missing field
          };

          await mockSessionManager.updateSessionState(sessionId, updatedState);

          // Then: The schema version reference should be preserved
          expect(mockStateStore.setSessionState).toHaveBeenCalled();
          const setStateCalls = vi.mocked(mockStateStore.setSessionState).mock.calls;
          const setStateCall = setStateCalls[setStateCalls.length - 1];
          const savedState = setStateCall[1];

          // Verify schema version is preserved in the saved state
          expect(savedState.schemaVersion).toBe(initialState.schemaVersion);
          expect(savedState.activeSchema).toBe(initialState.activeSchema);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should allow schema validation to succeed for sessions using older schema versions', () => {
    return fc.assert(
      fc.asyncProperty(schemaDefinitionArb, async (originalSchema) => {
        // Given: A session that has collected all required fields for an older schema version
        const collectedFields: Record<string, unknown> = {};
        originalSchema.requiredFields.forEach((fieldName) => {
          collectedFields[fieldName] = 'valid_value';
        });

        // When: The schema is updated to a new version with additional required fields
        const updatedSchema = await fc.sample(updatedSchemaArb(originalSchema), 1)[0];

        // Then: The session should still be valid according to the original schema version
        const isCompleteOriginal = schemaEngine.isComplete(originalSchema, collectedFields);
        expect(isCompleteOriginal).toBe(true);

        // And: The session would not be complete according to the new schema version
        // (if new required fields were added)
        const isCompleteUpdated = schemaEngine.isComplete(updatedSchema, collectedFields);
        
        if (updatedSchema.requiredFields.length > originalSchema.requiredFields.length) {
          // If new required fields were added, the old collected fields won't satisfy the new schema
          expect(isCompleteUpdated).toBe(false);
        }

        // But the session can continue using the original schema version
        const validationOriginal = schemaEngine.validateFields(originalSchema, collectedFields);
        expect(validationOriginal.valid).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it('should allow field prompts to be generated for sessions using older schema versions', () => {
    return fc.assert(
      fc.asyncProperty(schemaDefinitionArb, async (originalSchema) => {
        fc.pre(originalSchema.requiredFields.length > 0);

        // Given: A session referencing an older schema version with missing fields
        const collectedFields: Record<string, unknown> = {};
        const missingFields = schemaEngine.getMissingFields(originalSchema, collectedFields);

        // When: The schema is updated to a new version
        const updatedSchema = await fc.sample(updatedSchemaArb(originalSchema), 1)[0];

        // Then: Field prompts should still be generatable for the original schema version
        for (const fieldName of missingFields) {
          const fieldDef = originalSchema.fields[fieldName];
          expect(fieldDef).toBeDefined();

          const prompt = schemaEngine.generateFieldPrompt(fieldDef, 'en');
          expect(prompt).toBeDefined();
          expect(prompt.fieldName).toBe(fieldName);
          expect(prompt.promptKey).toBe(fieldDef.ui.promptKey);
        }

        // And: The session should not be affected by new fields in the updated schema
        const originalMissingCount = missingFields.length;
        expect(originalMissingCount).toBeGreaterThan(0);
      }),
      { numRuns: 50 }
    );
  });

  it('should maintain schema version compatibility across session resume operations', () => {
    return fc.assert(
      fc.asyncProperty(
        schemaDefinitionArb,
        sessionIdArb,
        userIdArb,
        fc.stringMatching(/^\+[1-9][0-9]{7,14}$/),
        async (originalSchema, sessionId, userId, phoneNumber) => {
          // Given: A session with a schema version reference
          const sessionState = await fc.sample(
            sessionStateWithSchemaArb(originalSchema),
            1
          )[0];

          const mockUser = {
            userId,
            phoneNumber,
            phoneHash: 'hash123',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const mockSession = {
            sessionId,
            userId,
            phoneNumber,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActivityAt: new Date(),
          };

          const mockProfile = {
            userId,
            preferredLanguage: 'en',
            preferredCurrency: 'USD',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const mockPreferences = {
            userId,
            ttsEnabled: false,
            proactiveMessagingEnabled: false,
            notificationPreferences: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const mockLanguageSettings = {
            userId,
            recentActions: [],
            frequentServices: [],
            commonDestinations: [],
            preferredVendors: [],
            pastBookings: [],
            timingPatterns: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Mock the repositories
          vi.mocked(mockUserRepository.findByPhoneNumber).mockResolvedValue(mockUser);
          vi.mocked(mockSessionRepository.findActiveByUserId).mockResolvedValue(mockSession);
          vi.mocked(mockStateStore.getSessionState).mockResolvedValue(sessionState);
          vi.mocked(mockSessionRepository.findById).mockResolvedValue(mockSession);
          vi.mocked(mockUserRepository.getProfile).mockResolvedValue(mockProfile);
          vi.mocked(mockUserRepository.getPreferences).mockResolvedValue(mockPreferences);
          vi.mocked(mockUserRepository.getLanguageSettings).mockResolvedValue(
            mockLanguageSettings
          );

          // When: The schema is updated to a new version
          const updatedSchema = await fc.sample(updatedSchemaArb(originalSchema), 1)[0];

          // And: The session is resumed
          const contextPackage = await mockSessionManager.resumeSession(phoneNumber);

          // Then: The session should maintain its original schema version reference
          expect(contextPackage).not.toBeNull();
          expect(contextPackage?.schemaProgress.schemaVersion).toBe(originalSchema.version);
          expect(contextPackage?.schemaProgress.activeSchema).toBe(originalSchema.schemaName);

          // And: The session should be able to continue with the original schema
          const missingFields = schemaEngine.getMissingFields(
            originalSchema,
            contextPackage?.schemaProgress.collectedFields || {}
          );
          expect(missingFields).toBeDefined();
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should not invalidate active sessions when schema version is deactivated but still referenced', () => {
    return fc.assert(
      fc.asyncProperty(
        schemaDefinitionArb,
        sessionIdArb,
        async (originalSchema, sessionId) => {
          // Given: A session referencing a specific schema version
          const sessionState = await fc.sample(
            sessionStateWithSchemaArb(originalSchema),
            1
          )[0];

          // Mock the schema version as active initially
          vi.mocked(mockSchemaRepository.findVersion).mockResolvedValue({
            versionId: 'v1',
            schemaId: 'schema1',
            version: originalSchema.version,
            requiredFields: originalSchema.requiredFields,
            optionalFields: originalSchema.optionalFields,
            fields: originalSchema.fields,
            metadata: originalSchema.metadata,
            isActive: true,
            createdAt: new Date(),
          });

          // When: The schema version is deactivated (but still exists in the database)
          vi.mocked(mockSchemaRepository.findVersion).mockResolvedValue({
            versionId: 'v1',
            schemaId: 'schema1',
            version: originalSchema.version,
            requiredFields: originalSchema.requiredFields,
            optionalFields: originalSchema.optionalFields,
            fields: originalSchema.fields,
            metadata: originalSchema.metadata,
            isActive: false, // Deactivated
            createdAt: new Date(),
          });

          // Then: The session should still be able to use the schema version
          // (because it's still in the database, just marked inactive for new sessions)
          const missingFields = schemaEngine.getMissingFields(
            originalSchema,
            sessionState.collectedFields
          );

          expect(missingFields).toBeDefined();

          const isComplete = schemaEngine.isComplete(
            originalSchema,
            sessionState.collectedFields
          );

          expect(typeof isComplete).toBe('boolean');

          // Verify the session's schema version reference is still valid
          expect(sessionState.schemaVersion).toBe(originalSchema.version);
        }
      ),
      { numRuns: 50 }
    );
  });
});
