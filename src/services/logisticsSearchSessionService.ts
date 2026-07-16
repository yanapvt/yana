import crypto from 'node:crypto';
import type { BasicProfileForm } from '../types/forms.js';
import { getStateStore, type StateStore } from './StateStore.js';
import { defaultSearchFlowEngine } from './SearchFlowEngine.js';
import type { LogisticsBookingRequest, LogisticsSearchCriteria } from './logisticsRequestMapper.js';
import type { TransportOption } from './TransportProvider.js';
import {
  PostgresLogisticsSearchSessionRepository,
  type LogisticsSearchSessionRepository,
} from '../storage/logisticsSearchSessionRepository.js';

export type LogisticsSearchState =
  | 'profile_required'
  | 'transport_form_sent'
  | 'transport_form_completed'
  | 'awaiting_preferences'
  | 'searching_transport'
  | 'showing_results'
  | 'awaiting_selection'
  | 'booking_form'
  | 'provider_pending'
  | 'reset';

export type LogisticsSearchStage =
  | 'awaiting_preferences'
  | 'searching'
  | 'results'
  | 'booking_form'
  | 'provider_pending'
  | 'reset';

export interface SelectedTransportOption {
  selectedOptionId: string;
  selectedOptionSnapshot: TransportOption;
  selectedFromBatchIndex: number;
  selectedDisplayNumber: number;
  selectedAt: string;
}

export interface LogisticsSearchSession {
  id: string;
  userId: string;
  whatsappUserId: string;
  profileContext?: Partial<BasicProfileForm>;
  originalMessage?: string;
  logisticsFormResponseId?: string;
  normalizedCriteria: LogisticsSearchCriteria;
  criteria: LogisticsSearchCriteria;
  additionalPreferences?: string;
  resultBatches: TransportOption[][];
  latestDisplayedBatchIndex: number;
  selectedOption?: SelectedTransportOption;
  bookingRequest?: LogisticsBookingRequest;
  state: LogisticsSearchState;
  stage: LogisticsSearchStage;
  results: TransportOption[];
  nextOffset: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const LOGISTICS_SEARCH_SESSION_TTL_SECONDS = 60 * 60 * 24;
const LOGISTICS_SEARCH_SESSION_LIFETIME_MS = LOGISTICS_SEARCH_SESSION_TTL_SECONDS * 1000;

export class LogisticsSearchSessionService {
  constructor(
    private readonly store: StateStore = getStateStore(),
    private readonly repository: LogisticsSearchSessionRepository =
      new PostgresLogisticsSearchSessionRepository()
  ) {}

  async saveTransportFormSent(
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
      state: 'transport_form_sent',
      stage: 'awaiting_preferences',
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: LogisticsSearchCriteria,
    options: { originalMessage?: string; logisticsFormResponseId?: string; profileContext?: Partial<BasicProfileForm> } = {}
  ): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      profileContext: options.profileContext ?? existing?.profileContext,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      logisticsFormResponseId: options.logisticsFormResponseId ?? existing?.logisticsFormResponseId,
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: undefined,
      state: 'awaiting_preferences',
      stage: 'awaiting_preferences',
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      results: [],
      nextOffset: 0,
      selectedOption: undefined,
      bookingRequest: undefined,
    });
  }

  async saveSearching(userId: string, criteria: LogisticsSearchCriteria): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      state: 'searching_transport',
      stage: 'searching',
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      results: [],
      nextOffset: 0,
    });
  }

  async saveResults(
    userId: string,
    criteria: LogisticsSearchCriteria,
    results: TransportOption[],
    nextOffset: number
  ): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    const limitedResults = defaultSearchFlowEngine.limitResults(results);
    const resultBatches = defaultSearchFlowEngine.batchResults(limitedResults);
    const latestDisplayedBatchIndex = defaultSearchFlowEngine.latestBatchIndex(
      nextOffset,
      limitedResults.length
    );

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
      selectedOption: existing?.selectedOption,
    });
  }

  async selectOption(userId: string, displayNumber: number): Promise<SelectedTransportOption | null> {
    const session = await this.get(userId);
    if (!session || session.latestDisplayedBatchIndex < 0) return null;

    const latestBatch = session.resultBatches[session.latestDisplayedBatchIndex] ?? [];
    const selectedOptionSnapshot = latestBatch[displayNumber - 1];
    if (!selectedOptionSnapshot) return null;

    const now = new Date().toISOString();
    const selectedOption: SelectedTransportOption = {
      selectedOptionId: selectedOptionSnapshot.id,
      selectedOptionSnapshot,
      selectedFromBatchIndex: session.latestDisplayedBatchIndex,
      selectedDisplayNumber: displayNumber,
      selectedAt: now,
    };

    await this.save({
      ...session,
      selectedOption,
      state: 'booking_form',
      stage: 'booking_form',
      updatedAt: now,
    });

    return selectedOption;
  }

  async saveProviderPending(userId: string, bookingRequest: LogisticsBookingRequest): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      bookingRequest,
      state: 'provider_pending',
      stage: 'provider_pending',
    });
  }

  async get(userId: string): Promise<LogisticsSearchSession | null> {
    const redisSession = await this.store.getJson<LogisticsSearchSession>(this.getKey(userId));
    if (redisSession) return normalizeSession(redisSession);

    const durableSession = await this.findDurableSession(userId);
    if (!durableSession) return null;

    const normalized = normalizeSession(durableSession);
    await this.store.setJson(this.getKey(userId), normalized, LOGISTICS_SEARCH_SESSION_TTL_SECONDS);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
    try {
      await this.repository.clearActiveByUserId(userId);
    } catch (error) {
      console.warn('[LogisticsSearchSessionService] Durable session clear failed:', error);
    }
  }

  private async save(session: LogisticsSearchSession): Promise<void> {
    const normalized = normalizeSession(session);
    await this.store.setJson(
      this.getKey(normalized.whatsappUserId),
      normalized,
      LOGISTICS_SEARCH_SESSION_TTL_SECONDS
    );
    try {
      await this.repository.upsert(normalized);
    } catch (error) {
      console.warn('[LogisticsSearchSessionService] Durable session save failed:', error);
    }
  }

  private async findDurableSession(userId: string): Promise<LogisticsSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      console.warn('[LogisticsSearchSessionService] Durable session lookup failed:', error);
      return null;
    }
  }

  private baseSession(
    userId: string,
    now: Date,
    existing?: LogisticsSearchSession | null
  ): LogisticsSearchSession {
    return {
      id: existing?.id ?? crypto.randomUUID(),
      userId,
      whatsappUserId: userId,
      profileContext: existing?.profileContext,
      originalMessage: existing?.originalMessage,
      logisticsFormResponseId: existing?.logisticsFormResponseId,
      normalizedCriteria: existing?.normalizedCriteria ?? {},
      criteria: existing?.criteria ?? {},
      additionalPreferences: existing?.additionalPreferences,
      resultBatches: existing?.resultBatches ?? [],
      latestDisplayedBatchIndex: existing?.latestDisplayedBatchIndex ?? -1,
      selectedOption: existing?.selectedOption,
      bookingRequest: existing?.bookingRequest,
      state: existing?.state ?? 'transport_form_sent',
      stage: existing?.stage ?? 'awaiting_preferences',
      results: existing?.results ?? [],
      nextOffset: existing?.nextOffset ?? 0,
      expiresAt:
        existing?.expiresAt ??
        new Date(now.getTime() + LOGISTICS_SEARCH_SESSION_LIFETIME_MS).toISOString(),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private getKey(userId: string): string {
    return `logistics-search:${userId.replace(/[^a-zA-Z0-9:+-]/g, '_')}`;
  }
}

let logisticsSearchSessionServiceInstance: LogisticsSearchSessionService | null = null;

export function getLogisticsSearchSessionService(): LogisticsSearchSessionService {
  if (!logisticsSearchSessionServiceInstance) {
    logisticsSearchSessionServiceInstance = new LogisticsSearchSessionService();
  }

  return logisticsSearchSessionServiceInstance;
}

function normalizeSession(session: LogisticsSearchSession): LogisticsSearchSession {
  return {
    ...session,
    normalizedCriteria: session.normalizedCriteria ?? {},
    criteria: session.criteria ?? {},
    resultBatches: session.resultBatches ?? [],
    latestDisplayedBatchIndex:
      typeof session.latestDisplayedBatchIndex === 'number' ? session.latestDisplayedBatchIndex : -1,
    results: session.results ?? [],
    nextOffset: typeof session.nextOffset === 'number' ? session.nextOffset : 0,
  };
}
