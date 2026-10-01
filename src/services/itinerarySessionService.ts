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
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: ItineraryCriteria,
    options: { itineraryFormResponseId?: string; originalMessage?: string; profileContext?: Partial<BasicProfileForm> } = {}
  ): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
      ...this.baseSession(userId, now, existing),
      criteria,
      itineraryFormResponseId: options.itineraryFormResponseId ?? existing?.itineraryFormResponseId,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      profileContext: options.profileContext ?? existing?.profileContext,
      additionalPreferences: undefined,
      itinerary: undefined,
      currentDay: undefined,
      state: 'awaiting_preferences',
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
    });
  }

  async saveItinerary(
    userId: string,
    criteria: ItineraryCriteria,
    itinerary: GeneratedItinerary
  ): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
      ...this.baseSession(userId, now, existing),
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      itinerary,
      currentDay: 1,
      state: 'showing_itinerary',
    });
  }

  async saveEditing(userId: string, criteria: ItineraryCriteria, itinerary: GeneratedItinerary): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
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

  async get(userId: string): Promise<ItinerarySession | null> {
    const redisSession = await this.store.getJson<ItinerarySession>(this.getKey(userId));
    if (redisSession) return normalizeSession(redisSession);

    const durableSession = await this.findDurableSession(userId);
    if (!durableSession) return null;

    const normalized = normalizeSession(durableSession);
    await this.store.setJson(this.getKey(userId), normalized, ITINERARY_SESSION_TTL_SECONDS);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
    try {
      await this.repository.clearActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('itinerary_session', 'durable_clear', 'memory_only');
    }
  }

  private async save(session: ItinerarySession): Promise<void> {
    const normalized = normalizeSession(session);
    await this.store.setJson(this.getKey(normalized.whatsappUserId), normalized, ITINERARY_SESSION_TTL_SECONDS);
    try {
      await this.repository.upsert(normalized);
    } catch (error) {
      logInfrastructureFallback('itinerary_session', 'durable_save', 'memory_only');
    }
  }

  private async findDurableSession(userId: string): Promise<ItinerarySession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('itinerary_session', 'durable_lookup', 'none');
      return null;
    }
  }

  private baseSession(
    userId: string,
    now: Date,
    existing?: ItinerarySession | null
  ): ItinerarySession {
    return {
      id: existing?.id ?? crypto.randomUUID(),
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

function normalizeSession(session: ItinerarySession): ItinerarySession {
  return {
    ...session,
    criteria: session.criteria ?? {},
    currentDay: session.currentDay,
  };
}
