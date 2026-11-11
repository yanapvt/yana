import { validateCriteria, canonicalField, WORKFLOW_SCHEMA_VERSION } from '../orchestration/WorkflowDefinitions.js';
import { PersistenceError } from '../storage/Persistence.js';
import crypto from 'node:crypto';
import type { BasicProfileForm } from '../types/forms.js';
import { getStateStore, type StateStore } from './StateStore.js';
import type { GeneratedItinerary } from './ItineraryPlannerService.js';
import type { ItineraryCriteria } from './itineraryRequestMapper.js';
import { logInfrastructureFallback } from './InfrastructureLog.js';
import {
  PostgresItinerarySessionRepository,
  type ItinerarySessionRepository,
} from '../storage/itinerarySessionRepository.js';

export type ItineraryState =
  | 'itinerary_form_sent'
  | 'itinerary_form_completed'
  | 'awaiting_preferences'
  | 'planning'
  | 'showing_itinerary'
  | 'editing_itinerary'
  | 'awaiting_booking'
  | 'completed';

export interface ItinerarySession {
  schemaVersion?: string;
  lifecycleStatus?: 'active' | 'paused';
  workspaceAccess?: { tokenHash: string; createdAt: string };
  revision?: number;
  id: string;
  userId: string;
  whatsappUserId: string;
  profileContext?: Partial<BasicProfileForm>;
  originalMessage?: string;
  itineraryFormResponseId?: string;
  criteria: ItineraryCriteria;
  additionalPreferences?: string;
  itinerary?: GeneratedItinerary;
  currentDay?: number;
  state: ItineraryState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const ITINERARY_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ITINERARY_SESSION_LIFETIME_MS = ITINERARY_SESSION_TTL_SECONDS * 1000;

export class ItinerarySessionService {
  constructor(
    private readonly store: StateStore = getStateStore(),
    private readonly repository: ItinerarySessionRepository = new PostgresItinerarySessionRepository()
  ) {}

  async getAuthoritative(userId: string): Promise<ItinerarySession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    }
    catch { throw new PersistenceError(); }
  }

  async getByWorkspaceToken(token: string): Promise<ItinerarySession | null> {
    try { return await this.repository.findByWorkspaceTokenHash?.(crypto.createHash('sha256').update(token).digest('hex')) ?? null; }
    catch { throw new PersistenceError(); }
  }

  async attachWorkspace(userId: string, token: string): Promise<ItinerarySession> {
    const session = await this.getAuthoritative(userId);
    if (!session?.itinerary) throw new PersistenceError();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (session.workspaceAccess?.tokenHash === tokenHash && Date.parse(session.expiresAt) > Date.now()) return session;
    const now = new Date();
    const updated = { ...session, workspaceAccess: { tokenHash, createdAt: now.toISOString() },
      expiresAt: new Date(now.getTime() + ITINERARY_SESSION_LIFETIME_MS).toISOString(), updatedAt: now.toISOString() };
    await this.save(updated);
    return { ...updated, revision: (session.revision ?? 0) + 1 };
  }

  async commitEdit(userId: string, tripId: string, expectedRevision: number, itinerary: GeneratedItinerary): Promise<ItinerarySession> {
    const session = await this.getAuthoritative(userId);
    if (!session || session.id !== tripId || (session.revision ?? 0) !== expectedRevision) throw new PersistenceError('conflict');
    const updated = { ...session, itinerary, state: 'editing_itinerary' as const, updatedAt: new Date().toISOString() };
    await this.save(updated);
    return { ...updated, revision: expectedRevision + 1 };
  }

  async saveFormSent(
    userId: string,
    originalMessage: string,
    profileContext?: Partial<BasicProfileForm>
  ): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
      ...this.baseSession(userId, now, existing),
      originalMessage,
      profileContext: profileContext ?? existing?.profileContext,
      state: 'itinerary_form_sent',
      lifecycleStatus: 'active',
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: ItineraryCriteria,
    options: { itineraryFormResponseId?: string; originalMessage?: string; profileContext?: Partial<BasicProfileForm> } = {}
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const now = new Date();
    const existing = await this.get(userId);
    return this.save({
      ...this.baseSession(userId, now, existing),
      criteria,
      itineraryFormResponseId: options.itineraryFormResponseId ?? existing?.itineraryFormResponseId,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      profileContext: options.profileContext ?? existing?.profileContext,
      additionalPreferences: undefined,
      itinerary: undefined,
      currentDay: undefined,
      state: 'awaiting_preferences',
      lifecycleStatus: 'active',
    });
  }

  async savePlanning(userId: string, criteria: ItineraryCriteria): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
      ...this.baseSession(userId, now, existing),
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      state: 'planning',
      lifecycleStatus: 'active',
    });
  }

  async saveItinerary(
    userId: string,
    criteria: ItineraryCriteria,
    itinerary: GeneratedItinerary
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const now = new Date();
    const existing = await this.get(userId);
    return this.save({
      ...this.baseSession(userId, now, existing),
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      itinerary,
      currentDay: 1,
      state: 'showing_itinerary',
      lifecycleStatus: 'active',
    });
  }

  async saveEditing(userId: string, criteria: ItineraryCriteria, itinerary: GeneratedItinerary): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const now = new Date();
    const existing = await this.get(userId);
    return this.save({
      ...this.baseSession(userId, now, existing),
      criteria,
      itinerary,
      state: 'editing_itinerary',
    });
  }

  async setCurrentDay(userId: string, currentDay: number): Promise<void> {
    const session = await this.get(userId);
    if (!session) return;
    await this.save({ ...session, currentDay, updatedAt: new Date().toISOString() });
  }

  async pause(userId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session || session.lifecycleStatus === 'paused') return;
    await this.save({ ...session, lifecycleStatus: 'paused', updatedAt: new Date().toISOString() });
  }

  async resume(userId: string): Promise<void> {
    const session = await this.getAuthoritative(userId);
    if (!session || session.lifecycleStatus !== 'paused') return;
    await this.save({ ...session, lifecycleStatus: 'active', updatedAt: new Date().toISOString() });
  }

  async applyCriteriaPatch(userId: string, expectedRevision: number, fields: Record<string, unknown>): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const current = await this.repository.findLatestActiveByUserId(userId);
    if (!current || (current.revision ?? 0) !== expectedRevision) throw new PersistenceError('conflict');
    const patch = validateCriteria('itinerary', fields);
    const criteria = { ...current.criteria, ...patch };
    validateCriteria('itinerary', Object.fromEntries(Object.entries(criteria).filter(([key]) => canonicalField('itinerary', key))));
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current.criteria[key as keyof typeof current.criteria]) === JSON.stringify(value))) return { status: 'durable' };
    await this.save({ ...current, criteria, state: 'awaiting_preferences', itinerary: undefined, updatedAt: new Date().toISOString() });
    return { status: 'durable' };
  }

  async get(userId: string): Promise<ItinerarySession | null> {
    const redisSession = await this.store.getJson<ItinerarySession>(this.getKey(userId));
    if (redisSession) {
      const cached = normalizeSession(redisSession);
      const durable = await this.findDurableSession(userId).catch(() => undefined);
      if (durable === undefined) return cached;
      if (durable === null) {
        await this.store.deleteKey(this.getKey(userId)).catch(() => false);
        return null;
      }
      if (durable.id === cached.id && (durable.revision ?? 0) === (cached.revision ?? 0)) return cached;
      const refreshed = normalizeSession(durable);
      await this.store.setJson(this.getKey(userId), refreshed, ITINERARY_SESSION_TTL_SECONDS).catch(() => undefined);
      return refreshed;
    }

    const durableSession = await this.findDurableSession(userId);
    if (!durableSession) return null;

    const normalized = normalizeSession(durableSession);
    await this.store.setJson(this.getKey(userId), normalized, ITINERARY_SESSION_TTL_SECONDS).catch(() => undefined);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
    try {
      await this.repository.clearActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('itinerary_session', 'durable_clear', 'memory_only');
      throw new PersistenceError();
    }
  }

  private async save(session: ItinerarySession): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const expectedRevision = session.revision ?? 0;
    const normalized = normalizeSession(session);
    normalized.revision = expectedRevision + 1;
    try {
      await this.repository.upsert(normalized, expectedRevision);
    } catch (error) {
      if (error instanceof PersistenceError) {
        if (error.status === 'conflict') await this.store.deleteKey(this.getKey(session.whatsappUserId)).catch(() => false);
        throw error;
      }
      throw new PersistenceError();
    }
    try { await this.store.setJson(this.getKey(normalized.whatsappUserId), normalized, ITINERARY_SESSION_TTL_SECONDS); }
    catch { return { status: 'degraded', reason: 'Saved durably; active cache unavailable' }; }
    return { status: this.store.isConnected?.() === false ? 'degraded' : 'durable', reason: this.store.isConnected?.() === false ? 'Saved durably; active cache uses memory fallback' : undefined };
  }

  private async findDurableSession(userId: string): Promise<ItinerarySession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('itinerary_session', 'durable_lookup', 'none');
      throw new PersistenceError();
    }
  }

  private baseSession(
    userId: string,
    now: Date,
    existing?: ItinerarySession | null
  ): ItinerarySession {
    return {
      schemaVersion: existing?.schemaVersion ?? WORKFLOW_SCHEMA_VERSION,
      id: existing?.id ?? crypto.randomUUID(),
      lifecycleStatus: existing?.lifecycleStatus ?? 'active',
      revision: existing?.revision ?? 0,
      workspaceAccess: existing?.workspaceAccess,
      userId,
      whatsappUserId: userId,
      profileContext: existing?.profileContext,
      originalMessage: existing?.originalMessage,
      itineraryFormResponseId: existing?.itineraryFormResponseId,
      criteria: existing?.criteria ?? {},
      additionalPreferences: existing?.additionalPreferences,
      itinerary: existing?.itinerary,
      currentDay: existing?.currentDay,
      state: existing?.state ?? 'itinerary_form_sent',
      expiresAt:
        existing?.expiresAt ??
        new Date(now.getTime() + ITINERARY_SESSION_LIFETIME_MS).toISOString(),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private getKey(userId: string): string {
    return `itinerary:${userId.replace(/[^a-zA-Z0-9:+-]/g, '_')}`;
  }
}

let itinerarySessionServiceInstance: ItinerarySessionService | null = null;

export function getItinerarySessionService(): ItinerarySessionService {
  if (!itinerarySessionServiceInstance) {
    itinerarySessionServiceInstance = new ItinerarySessionService();
  }
  return itinerarySessionServiceInstance;
}

export function initItinerarySessionService(service: ItinerarySessionService): ItinerarySessionService {
  itinerarySessionServiceInstance = service;
  return service;
}

function normalizeSession(session: ItinerarySession): ItinerarySession {
  return {
    ...session,
    schemaVersion: session.schemaVersion ?? WORKFLOW_SCHEMA_VERSION,
    criteria: session.criteria ?? {},
    currentDay: session.currentDay,
  };
}
