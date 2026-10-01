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
      stage: 'awaiting_preferences',
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: ExcursionSearchCriteria,
    options: { originalMessage?: string; excursionFormResponseId?: string; profileContext?: Partial<BasicProfileForm> } = {}
  ): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      profileContext: options.profileContext ?? existing?.profileContext,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      excursionFormResponseId: options.excursionFormResponseId ?? existing?.excursionFormResponseId,
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: undefined,
      state: 'awaiting_preferences',
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
    nextOffset: number
  ): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    const limitedResults = defaultSearchFlowEngine.limitResults(results);
    const resultBatches = defaultSearchFlowEngine.batchResults(limitedResults);
    const latestDisplayedBatchIndex = defaultSearchFlowEngine.latestBatchIndex(nextOffset, limitedResults.length);

    await this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      state: latestDisplayedBatchIndex >= 0 ? 'awaiting_selection' : 'showing_results',
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
    }
  }

  private async save(session: ExcursionSearchSession): Promise<void> {
    const normalized = normalizeSession(session);
    await this.store.setJson(this.getKey(normalized.whatsappUserId), normalized, EXCURSION_SEARCH_SESSION_TTL_SECONDS);
    try {
      await this.repository.upsert(normalized);
    } catch (error) {
      logInfrastructureFallback('excursion_session', 'durable_save', 'memory_only');
    }
  }

  private async findDurableSession(userId: string): Promise<ExcursionSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('excursion_session', 'durable_lookup', 'none');
      return null;
    }
  }

  private baseSession(userId: string, now: Date, existing?: ExcursionSearchSession | null): ExcursionSearchSession {
    return {
      id: existing?.id ?? crypto.randomUUID(),
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
