import { validateCriteria, canonicalField } from '../orchestration/WorkflowDefinitions.js';
import { PersistenceError } from '../storage/Persistence.js';
import crypto from 'node:crypto';
import type { BasicProfileForm } from '../types/forms.js';
import { getStateStore, type StateStore } from './StateStore.js';
import { getTwilioOutboundService } from './twilioOutboundService.js';
import type { RestaurantBrowseResult } from './GooglePlacesRestaurantBrowsingService.js';
import type { RestaurantSearchCriteria } from './restaurantRequestMapper.js';
import { logInfrastructureFallback } from './InfrastructureLog.js';
import { defaultSearchFlowEngine } from './SearchFlowEngine.js';
import {
  PostgresRestaurantSearchSessionRepository,
  type RestaurantSearchSessionRepository,
} from '../storage/restaurantSearchSessionRepository.js';

export type RestaurantSearchState =
  | 'profile_required'
  | 'restaurant_form_sent'
  | 'restaurant_form_completed'
  | 'confirming_location'
  | 'awaiting_preferences'
  | 'searching_restaurants'
  | 'showing_results'
  | 'awaiting_selection'
  | 'reservation_pending'
  | 'reset';

export type RestaurantSearchStage =
  | 'awaiting_preferences'
  | 'searching'
  | 'results'
  | 'reservation_pending'
  | 'reset';

export interface SelectedRestaurant {
  selectedRestaurantId: string;
  selectedRestaurantSnapshot: RestaurantBrowseResult;
  selectedFromBatchIndex: number;
  selectedDisplayNumber: number;
  selectedAt: string;
}

export interface RestaurantSearchSession {
  lifecycleStatus?: 'active' | 'paused';
  revision?: number;
  resultsRetrievedAt?: string;
  id: string;
  userId: string;
  whatsappUserId: string;
  profileContext?: Partial<BasicProfileForm>;
  originalMessage?: string;
  restaurantFormResponseId?: string;
  pendingLocationConfirmation?: string;
  normalizedCriteria: RestaurantSearchCriteria;
  criteria: RestaurantSearchCriteria;
  additionalPreferences?: string;
  resultBatches: RestaurantBrowseResult[][];
  latestDisplayedBatchIndex: number;
  selectedRestaurant?: SelectedRestaurant;
  state: RestaurantSearchState;
  stage: RestaurantSearchStage;
  results: RestaurantBrowseResult[];
  nextOffset: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface SaveRestaurantAwaitingPreferencesOptions {
  originalMessage?: string;
  restaurantFormResponseId?: string;
  profileContext?: Partial<BasicProfileForm>;
}

const RESTAURANT_SEARCH_SESSION_TTL_SECONDS = 60 * 60 * 24;
const RESTAURANT_SEARCH_SESSION_LIFETIME_MS = RESTAURANT_SEARCH_SESSION_TTL_SECONDS * 1000;

export class RestaurantSearchSessionService {
  constructor(
    private readonly store: StateStore = getStateStore(),
    private readonly repository: RestaurantSearchSessionRepository =
      new PostgresRestaurantSearchSessionRepository()
  ) {}

  async saveLocationConfirmation(userId: string, location: string, originalMessage: string): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
      ...this.baseSession(userId, now, existing),
      originalMessage,
      restaurantFormResponseId: undefined,
      pendingLocationConfirmation: location,
      normalizedCriteria: {},
      criteria: {},
      additionalPreferences: undefined,
      state: 'confirming_location',
      lifecycleStatus: 'active',
      stage: 'awaiting_preferences',
      results: [], resultBatches: [], nextOffset: 0, latestDisplayedBatchIndex: -1,
      selectedRestaurant: undefined,
    });
  }

  async saveRestaurantFormSent(
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
      state: 'restaurant_form_sent',
      lifecycleStatus: 'active',
      stage: 'awaiting_preferences',
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: RestaurantSearchCriteria,
    options: SaveRestaurantAwaitingPreferencesOptions = {}
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const existing = await this.get(userId);
    const now = new Date();
    return this.save({
      ...this.baseSession(userId, now, existing),
      profileContext: options.profileContext ?? existing?.profileContext,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      restaurantFormResponseId:
        options.restaurantFormResponseId ?? existing?.restaurantFormResponseId,
      pendingLocationConfirmation: undefined,
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
      selectedRestaurant: undefined,
    });
  }

  async saveSearching(userId: string, criteria: RestaurantSearchCriteria): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      state: 'searching_restaurants',
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
    criteria: RestaurantSearchCriteria,
    results: RestaurantBrowseResult[],
    nextOffset: number,
    expected?: { id: string; revision: number }
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const existing = await this.get(userId);
    if (expected && (!existing || existing.id !== expected.id || (existing.revision ?? 0) !== expected.revision)) throw new PersistenceError('conflict');
    const now = new Date();
    const limitedResults = defaultSearchFlowEngine.limitResults(results);
    const resultBatches = defaultSearchFlowEngine.batchResults(limitedResults);
    const latestDisplayedBatchIndex = defaultSearchFlowEngine.latestBatchIndex(
      nextOffset,
      limitedResults.length
    );

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
      selectedRestaurant: existing?.selectedRestaurant,
    });
  }

  async selectRestaurant(
    userId: string,
    displayNumber: number
  ): Promise<SelectedRestaurant | null> {
    const session = await this.get(userId);
    if (!session || session.latestDisplayedBatchIndex < 0) {
      return null;
    }

    const latestBatch = session.resultBatches[session.latestDisplayedBatchIndex] ?? [];
    const selectedRestaurantSnapshot = latestBatch[displayNumber - 1];
    if (!selectedRestaurantSnapshot) {
      return null;
    }

    const now = new Date().toISOString();
    const selectedRestaurant: SelectedRestaurant = {
      selectedRestaurantId:
        selectedRestaurantSnapshot.id ??
        selectedRestaurantSnapshot.googleMapsUri ??
        `${session.id}:${session.latestDisplayedBatchIndex}:${displayNumber}`,
      selectedRestaurantSnapshot,
      selectedFromBatchIndex: session.latestDisplayedBatchIndex,
      selectedDisplayNumber: displayNumber,
      selectedAt: now,
    };

    await this.save({
      ...session,
      selectedRestaurant,
      state: 'reservation_pending',
      stage: 'reservation_pending',
      updatedAt: now,
    });

    return selectedRestaurant;
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

  async getAuthoritative(userId: string): Promise<RestaurantSearchSession | null> {
    try {
      const session = await this.repository.findLatestActiveByUserId(userId);
      return session && Date.parse(session.expiresAt) <= Date.now() ? null : session;
    }
    catch { throw new PersistenceError(); }
  }

  async applyCriteriaPatch(userId: string, expectedRevision: number, fields: Record<string, unknown>): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const current = await this.repository.findLatestActiveByUserId(userId);
    if (!current || (current.revision ?? 0) !== expectedRevision) throw new PersistenceError('conflict');
    const patch = validateCriteria('restaurant', fields);
    const criteria = { ...current.criteria, ...patch };
    validateCriteria('restaurant', Object.fromEntries(Object.entries(criteria).filter(([key]) => canonicalField('restaurant', key))));
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current.criteria[key as keyof typeof current.criteria]) === JSON.stringify(value))) return { status: 'durable' };
    await this.save({ ...current, criteria, normalizedCriteria: criteria, results: [], resultBatches: [], nextOffset: 0, latestDisplayedBatchIndex: -1, state: 'awaiting_preferences', stage: 'awaiting_preferences', updatedAt: new Date().toISOString() });
    return { status: 'durable' };
  }

  async get(userId: string): Promise<RestaurantSearchSession | null> {
    const redisSession = await this.store.getJson<RestaurantSearchSession>(this.getKey(userId));
    if (redisSession) {
      return normalizeSession(redisSession);
    }

    const durableSession = await this.findDurableSession(userId);
    if (!durableSession) {
      return null;
    }

    const normalized = normalizeSession(durableSession);
    await this.store.setJson(this.getKey(userId), normalized, RESTAURANT_SEARCH_SESSION_TTL_SECONDS);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
    try {
      await this.repository.clearActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('restaurant_session', 'durable_clear', 'memory_only');
      throw new PersistenceError();
    }
  }

  private async save(session: RestaurantSearchSession): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
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
    try { await this.store.setJson(this.getKey(normalized.whatsappUserId), normalized, RESTAURANT_SEARCH_SESSION_TTL_SECONDS); }
    catch { return { status: 'degraded', reason: 'Saved durably; active cache unavailable' }; }
    return { status: this.store.isConnected?.() === false ? 'degraded' : 'durable', reason: this.store.isConnected?.() === false ? 'Saved durably; active cache uses memory fallback' : undefined };
  }

  private async findDurableSession(userId: string): Promise<RestaurantSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('restaurant_session', 'durable_lookup', 'none');
      throw new PersistenceError();
    }
  }

  private baseSession(
    userId: string,
    now: Date,
    existing?: RestaurantSearchSession | null
  ): RestaurantSearchSession {
    return {
      id: existing?.id ?? crypto.randomUUID(),
      lifecycleStatus: existing?.lifecycleStatus ?? 'active',
      revision: existing?.revision ?? 0,
      resultsRetrievedAt: existing?.resultsRetrievedAt,
      userId,
      whatsappUserId: userId,
      profileContext: existing?.profileContext,
      originalMessage: existing?.originalMessage,
      restaurantFormResponseId: existing?.restaurantFormResponseId,
      pendingLocationConfirmation: existing?.pendingLocationConfirmation,
      normalizedCriteria: existing?.normalizedCriteria ?? {},
      criteria: existing?.criteria ?? {},
      additionalPreferences: existing?.additionalPreferences,
      resultBatches: existing?.resultBatches ?? [],
      latestDisplayedBatchIndex: existing?.latestDisplayedBatchIndex ?? -1,
      selectedRestaurant: existing?.selectedRestaurant,
      state: existing?.state ?? 'restaurant_form_sent',
      stage: existing?.stage ?? 'awaiting_preferences',
      results: existing?.results ?? [],
      nextOffset: existing?.nextOffset ?? 0,
      expiresAt:
        existing?.expiresAt ??
        new Date(now.getTime() + RESTAURANT_SEARCH_SESSION_LIFETIME_MS).toISOString(),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private getKey(userId: string): string {
    return `restaurant-search:${normalizeUserId(userId)}`;
  }
}

let restaurantSearchSessionServiceInstance: RestaurantSearchSessionService | null = null;

export function getRestaurantSearchSessionService(): RestaurantSearchSessionService {
  if (!restaurantSearchSessionServiceInstance) {
    restaurantSearchSessionServiceInstance = new RestaurantSearchSessionService();
  }

  return restaurantSearchSessionServiceInstance;
}

export function initRestaurantSearchSessionService(
  service = new RestaurantSearchSessionService()
): RestaurantSearchSessionService {
  restaurantSearchSessionServiceInstance = service;
  return service;
}

function normalizeSession(session: RestaurantSearchSession): RestaurantSearchSession {
  const criteria = session.normalizedCriteria ?? session.criteria ?? {};
  const results = defaultSearchFlowEngine.limitResults(
    session.results ?? session.resultBatches?.flat() ?? []
  );
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

function normalizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9:+-]/g, '_');
}
