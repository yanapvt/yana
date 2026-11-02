import { validateCriteria, canonicalField } from '../orchestration/WorkflowDefinitions.js';
import { PersistenceError } from '../storage/Persistence.js';
import crypto from 'node:crypto';
import type { BasicProfileForm } from '../types/forms.js';
import { getStateStore, type StateStore } from './StateStore.js';
import type { ExcursionBrowseResult } from './GooglePlacesExcursionBrowsingService.js';
import type { ExcursionBookingRequest, ExcursionSearchCriteria } from './excursionRequestMapper.js';
import { logInfrastructureFallback } from './InfrastructureLog.js';
import { defaultSearchFlowEngine } from './SearchFlowEngine.js';
import {
  PostgresExcursionSearchSessionRepository,
  type ExcursionSearchSessionRepository,
} from '../storage/excursionSearchSessionRepository.js';

export type ExcursionSearchState =
  | 'profile_required'
  | 'excursion_form_sent'
  | 'excursion_form_completed'
  | 'awaiting_preferences'
  | 'searching_excursions'
  | 'showing_results'
  | 'awaiting_selection'
  | 'booking_form'
  | 'provider_pending'
  | 'reset';

export type ExcursionSearchStage =
  | 'awaiting_preferences'
  | 'searching'
  | 'results'
  | 'booking_form'
  | 'provider_pending'
  | 'reset';

export interface SelectedExperience {
  selectedExperienceId: string;
  selectedExperienceSnapshot: ExcursionBrowseResult;
  selectedFromBatchIndex: number;
  selectedDisplayNumber: number;
  selectedAt: string;
}

export interface ExcursionSearchSession {
  lifecycleStatus?: 'active' | 'paused';
  revision?: number;
  resultsRetrievedAt?: string;
  id: string;
  userId: string;
  whatsappUserId: string;
  profileContext?: Partial<BasicProfileForm>;
  originalMessage?: string;
  excursionFormResponseId?: string;
  normalizedCriteria: ExcursionSearchCriteria;
  criteria: ExcursionSearchCriteria;
  additionalPreferences?: string;
  resultBatches: ExcursionBrowseResult[][];
  latestDisplayedBatchIndex: number;
  selectedExperience?: SelectedExperience;
  bookingRequest?: ExcursionBookingRequest;
  state: ExcursionSearchState;
  stage: ExcursionSearchStage;
  results: ExcursionBrowseResult[];
  nextOffset: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const EXCURSION_SEARCH_SESSION_TTL_SECONDS = 60 * 60 * 24;
const EXCURSION_SEARCH_SESSION_LIFETIME_MS = EXCURSION_SEARCH_SESSION_TTL_SECONDS * 1000;

export class ExcursionSearchSessionService {
  constructor(
    private readonly store: StateStore = getStateStore(),
    private readonly repository: ExcursionSearchSessionRepository =
      new PostgresExcursionSearchSessionRepository()
  ) {}

  async saveExcursionFormSent(
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
      state: 'excursion_form_sent',
      lifecycleStatus: 'active',
      stage: 'awaiting_preferences',
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: ExcursionSearchCriteria,
    options: { originalMessage?: string; excursionFormResponseId?: string; profileContext?: Partial<BasicProfileForm> } = {}
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const existing = await this.get(userId);
    const now = new Date();
    return this.save({
      ...this.baseSession(userId, now, existing),
      profileContext: options.profileContext ?? existing?.profileContext,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      excursionFormResponseId: options.excursionFormResponseId ?? existing?.excursionFormResponseId,
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: undefined,
      state: 'awaiting_preferences',
      lifecycleStatus: 'active',
      stage: 'awaiting_preferences',
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      results: [],
      nextOffset: 0,
      selectedExperience: undefined,
      bookingRequest: undefined,
    });
  }

  async saveSearching(userId: string, criteria: ExcursionSearchCriteria): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      state: 'searching_excursions',
      lifecycleStatus: 'active',
      stage: 'searching',
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      results: [],
      nextOffset: 0,
    });
  }

  async saveResults(
    userId: string,
    criteria: ExcursionSearchCriteria,
    results: ExcursionBrowseResult[],
    nextOffset: number,
    expected?: { id: string; revision: number }
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const existing = await this.get(userId);
    if (expected && (!existing || existing.id !== expected.id || (existing.revision ?? 0) !== expected.revision)) throw new PersistenceError('conflict');
    const now = new Date();
    const limitedResults = defaultSearchFlowEngine.limitResults(results);
    const resultBatches = defaultSearchFlowEngine.batchResults(limitedResults);
    const latestDisplayedBatchIndex = defaultSearchFlowEngine.latestBatchIndex(nextOffset, limitedResults.length);

    return this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      resultsRetrievedAt: new Date().toISOString(),
      additionalPreferences: criteria.additionalPreferences,
      state: latestDisplayedBatchIndex >= 0 ? 'awaiting_selection' : 'showing_results',
      lifecycleStatus: 'active',
      stage: 'results',
      resultBatches,
      latestDisplayedBatchIndex,
      results: limitedResults,
      nextOffset,
      selectedExperience: existing?.selectedExperience,
    });
  }

  async selectExperience(userId: string, displayNumber: number): Promise<SelectedExperience | null> {
    const session = await this.get(userId);
    if (!session || session.latestDisplayedBatchIndex < 0) return null;

    const latestBatch = session.resultBatches[session.latestDisplayedBatchIndex] ?? [];
    const selectedExperienceSnapshot = latestBatch[displayNumber - 1];
    if (!selectedExperienceSnapshot) return null;

    const now = new Date().toISOString();
    const selectedExperience: SelectedExperience = {
      selectedExperienceId:
        selectedExperienceSnapshot.id ??
        selectedExperienceSnapshot.googleMapsUri ??
        `${session.id}:${session.latestDisplayedBatchIndex}:${displayNumber}`,
      selectedExperienceSnapshot,
      selectedFromBatchIndex: session.latestDisplayedBatchIndex,
      selectedDisplayNumber: displayNumber,
      selectedAt: now,
    };

    await this.save({
      ...session,
      selectedExperience,
      state: 'booking_form',
      stage: 'booking_form',
      updatedAt: now,
    });

    return selectedExperience;
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

  async saveProviderPending(userId: string, bookingRequest: ExcursionBookingRequest): Promise<void> {
    const session = await this.get(userId);
    if (!session) return;

    await this.save({
      ...session,
      bookingRequest,
      state: 'provider_pending',
      stage: 'provider_pending',
      updatedAt: new Date().toISOString(),
    });
  }

  async getAuthoritative(userId: string): Promise<ExcursionSearchSession | null> {
    try {
      const session = await this.repository.findLatestActiveByUserId(userId);
      return session && Date.parse(session.expiresAt) <= Date.now() ? null : session;
    }
    catch { throw new PersistenceError(); }
  }

  async applyCriteriaPatch(userId: string, expectedRevision: number, fields: Record<string, unknown>): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const current = await this.repository.findLatestActiveByUserId(userId);
    if (!current || (current.revision ?? 0) !== expectedRevision) throw new PersistenceError('conflict');
    const patch = validateCriteria('excursion', fields);
    const criteria = { ...current.criteria, ...patch };
    validateCriteria('excursion', Object.fromEntries(Object.entries(criteria).filter(([key]) => canonicalField('excursion', key))));
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current.criteria[key as keyof typeof current.criteria]) === JSON.stringify(value))) return { status: 'durable' };
    await this.save({ ...current, criteria, normalizedCriteria: criteria, results: [], resultBatches: [], nextOffset: 0, latestDisplayedBatchIndex: -1, state: 'awaiting_preferences', stage: 'awaiting_preferences', updatedAt: new Date().toISOString() });
    return { status: 'durable' };
  }

  async get(userId: string): Promise<ExcursionSearchSession | null> {
    const redisSession = await this.store.getJson<ExcursionSearchSession>(this.getKey(userId));
    if (redisSession) return normalizeSession(redisSession);

    const durableSession = await this.findDurableSession(userId);
    if (!durableSession) return null;

    const normalized = normalizeSession(durableSession);
    await this.store.setJson(this.getKey(userId), normalized, EXCURSION_SEARCH_SESSION_TTL_SECONDS);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
    try {
      await this.repository.clearActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('excursion_session', 'durable_clear', 'memory_only');
      throw new PersistenceError();
    }
  }

  private async save(session: ExcursionSearchSession): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
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
    try { await this.store.setJson(this.getKey(normalized.whatsappUserId), normalized, EXCURSION_SEARCH_SESSION_TTL_SECONDS); }
    catch { return { status: 'degraded', reason: 'Saved durably; active cache unavailable' }; }
    return { status: this.store.isConnected?.() === false ? 'degraded' : 'durable', reason: this.store.isConnected?.() === false ? 'Saved durably; active cache uses memory fallback' : undefined };
  }

  private async findDurableSession(userId: string): Promise<ExcursionSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('excursion_session', 'durable_lookup', 'none');
      throw new PersistenceError();
    }
  }

  private baseSession(userId: string, now: Date, existing?: ExcursionSearchSession | null): ExcursionSearchSession {
    return {
      id: existing?.id ?? crypto.randomUUID(),
      lifecycleStatus: existing?.lifecycleStatus ?? 'active',
      revision: existing?.revision ?? 0,
      resultsRetrievedAt: existing?.resultsRetrievedAt,
      userId,
      whatsappUserId: userId,
      profileContext: existing?.profileContext,
      originalMessage: existing?.originalMessage,
      excursionFormResponseId: existing?.excursionFormResponseId,
      normalizedCriteria: existing?.normalizedCriteria ?? {},
      criteria: existing?.criteria ?? {},
      additionalPreferences: existing?.additionalPreferences,
      resultBatches: existing?.resultBatches ?? [],
      latestDisplayedBatchIndex: existing?.latestDisplayedBatchIndex ?? -1,
      selectedExperience: existing?.selectedExperience,
      bookingRequest: existing?.bookingRequest,
      state: existing?.state ?? 'excursion_form_sent',
      stage: existing?.stage ?? 'awaiting_preferences',
      results: existing?.results ?? [],
      nextOffset: existing?.nextOffset ?? 0,
      expiresAt:
        existing?.expiresAt ?? new Date(now.getTime() + EXCURSION_SEARCH_SESSION_LIFETIME_MS).toISOString(),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private getKey(userId: string): string {
    return `excursion-search:${userId.replace(/[^a-zA-Z0-9:+-]/g, '_')}`;
  }
}

let excursionSearchSessionServiceInstance: ExcursionSearchSessionService | null = null;
export function initExcursionSearchSessionService(service: ExcursionSearchSessionService): ExcursionSearchSessionService {
  excursionSearchSessionServiceInstance = service;
  return service;
}

export function getExcursionSearchSessionService(): ExcursionSearchSessionService {
  if (!excursionSearchSessionServiceInstance) {
    excursionSearchSessionServiceInstance = new ExcursionSearchSessionService();
  }

  return excursionSearchSessionServiceInstance;
}

function normalizeSession(session: ExcursionSearchSession): ExcursionSearchSession {
  const criteria = session.normalizedCriteria ?? session.criteria ?? {};
  const results = defaultSearchFlowEngine.limitResults(session.results ?? session.resultBatches?.flat() ?? []);
  const resultBatches = session.resultBatches?.length
    ? session.resultBatches
    : defaultSearchFlowEngine.batchResults(results);

  return {
    ...session,
    userId: session.userId ?? session.whatsappUserId,
    whatsappUserId: session.whatsappUserId ?? session.userId,
    normalizedCriteria: criteria,
    criteria,
    resultBatches,
    results,
    latestDisplayedBatchIndex:
      typeof session.latestDisplayedBatchIndex === 'number'
        ? session.latestDisplayedBatchIndex
        : defaultSearchFlowEngine.latestBatchIndex(session.nextOffset ?? 0, results.length),
    nextOffset: session.nextOffset ?? 0,
  };
}
