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
  id: string;
  userId: string;
  whatsappUserId: string;
  profileContext?: Partial<BasicProfileForm>;
  originalMessage?: string;
  restaurantFormResponseId?: string;
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
      stage: 'awaiting_preferences',
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: RestaurantSearchCriteria,
    options: SaveRestaurantAwaitingPreferencesOptions = {}
  ): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      profileContext: options.profileContext ?? existing?.profileContext,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      restaurantFormResponseId:
        options.restaurantFormResponseId ?? existing?.restaurantFormResponseId,
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: undefined,
      state: 'awaiting_preferences',
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
    }
  }

  private async save(session: RestaurantSearchSession): Promise<void> {
    const normalized = normalizeSession(session);
    await this.store.setJson(
      this.getKey(normalized.whatsappUserId),
      normalized,
      RESTAURANT_SEARCH_SESSION_TTL_SECONDS
    );
    try {
      await this.repository.upsert(normalized);
    } catch (error) {
      logInfrastructureFallback('restaurant_session', 'durable_save', 'memory_only');
    }
  }

  private async findDurableSession(userId: string): Promise<RestaurantSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('restaurant_session', 'durable_lookup', 'none');
      return null;
    }
  }

  private baseSession(
    userId: string,
    now: Date,
    existing?: RestaurantSearchSession | null
  ): RestaurantSearchSession {
    return {
      id: existing?.id ?? crypto.randomUUID(),
      userId,
      whatsappUserId: userId,
      profileContext: existing?.profileContext,
      originalMessage: existing?.originalMessage,
      restaurantFormResponseId: existing?.restaurantFormResponseId,
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
