import { validateCriteria, canonicalField, WORKFLOW_SCHEMA_VERSION } from '../orchestration/WorkflowDefinitions.js';
import { PersistenceError } from '../storage/Persistence.js';
import crypto from 'node:crypto';
import type { BasicProfileForm } from '../types/forms.js';
import type { HotelBrowseResult } from './GooglePlacesHotelBrowsingService.js';
import type { HotelSearchCriteria } from './HotelIntakeService.js';
import { getProfileService } from './profileService.js';
import { getStateStore, type StateStore } from './StateStore.js';
import { getTwilioOutboundService } from './twilioOutboundService.js';
import { getOpenWaOutboundService } from './OpenWaOutboundService.js';
import { getMetaWhatsAppOutboundService } from './MetaWhatsAppOutboundService.js';
import { env } from '../config/environment.js';
import {
  PostgresHotelSearchSessionRepository,
  type HotelSearchSessionRepository,
} from '../storage/hotelSearchSessionRepository.js';
import type { HotelRecheckReceipt } from './handoff/HotelRecheckReceiptService.js';
import { logInfrastructureFallback } from './InfrastructureLog.js';

export type HotelSearchState =
  | 'profile_required'
  | 'hotel_form_sent'
  | 'hotel_form_completed'
  | 'awaiting_extra_preferences'
  | 'searching_hotels'
  | 'showing_results'
  | 'awaiting_hotel_selection'
  | 'booking_provider_pending'
  | 'reset';

export type LegacyHotelSearchStage =
  | 'awaiting_preferences'
  | 'searching'
  | 'results'
  | 'booking_provider_pending'
  | 'reset';

export interface SelectedHotel {
  selectedHotelId: string;
  selectedHotelSnapshot: HotelBrowseResult;
  selectedFromBatchIndex: number;
  selectedDisplayNumber: number;
  selectedAt: string;
}

export interface HotelSearchSession {
  schemaVersion?: string;
  lifecycleStatus?: 'active' | 'paused';
  revision?: number;
  resultsRetrievedAt?: string;
  id: string;
  userId: string;
  whatsappUserId: string;
  profileId?: string;
  profileContext?: Partial<BasicProfileForm>;
  originalMessage?: string;
  hotelFormResponseId?: string;
  normalizedCriteria: HotelSearchCriteria;
  criteria: HotelSearchCriteria;
  additionalPreferences?: string;
  resultBatches: HotelBrowseResult[][];
  latestDisplayedBatchIndex: number;
  nextCount: number;
  selectedHotel?: SelectedHotel;
  recheckReceipt?: HotelRecheckReceipt;
  pendingHumanHandoffConsent?: boolean;
  pendingSourcingConsent?: boolean;
  sourcingRequestId?: string;
  humanHandoff?: { handoffId: string; status: 'handed_off' };
  state: HotelSearchState;
  stage: LegacyHotelSearchStage;
  results: HotelBrowseResult[];
  nextOffset: number;
  lastUserMessageAt?: string;
  lastYanaMessageAt?: string;
  reminderScheduledAt?: string;
  reminderDueAt?: string;
  /** Invalidates an in-flight outbound result batch without discarding saved results. */
  outboundPausedAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAwaitingPreferencesOptions {
  originalMessage?: string;
  hotelFormResponseId?: string;
  profileContext?: Partial<BasicProfileForm>;
}

const HOTEL_SEARCH_SESSION_TTL_SECONDS = 60 * 60 * 24;
const HOTEL_SEARCH_SESSION_LIFETIME_MS = HOTEL_SEARCH_SESSION_TTL_SECONDS * 1000;
const HOTEL_REMINDER_DELAY_MS = 60 * 60 * 1000;
const WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_BATCHES = 3;
const BATCH_SIZE = 3;
const reminderTimers = new Map<string, NodeJS.Timeout>();

export class HotelSearchSessionService {
  constructor(
    private readonly store: StateStore = getStateStore(),
    private readonly repository: HotelSearchSessionRepository =
      new PostgresHotelSearchSessionRepository()
  ) {}

  async saveHotelFormSent(
    userId: string,
    originalMessage: string,
    profileContext?: Partial<BasicProfileForm>,
    initialCriteria: HotelSearchCriteria = {}
  ): Promise<void> {
    const now = new Date();
    const existing = await this.get(userId);
    await this.save({
      ...this.baseSession(userId, now, existing),
      originalMessage,
      profileContext: profileContext ?? existing?.profileContext,
      state: 'hotel_form_sent',
      lifecycleStatus: 'active',
      stage: 'awaiting_preferences',
      lastUserMessageAt: now.toISOString(),
      lastYanaMessageAt: now.toISOString(),
      normalizedCriteria: { ...(existing?.normalizedCriteria ?? {}), ...initialCriteria },
      criteria: { ...(existing?.criteria ?? {}), ...initialCriteria },
    });
  }

  async saveProfileRequired(userId: string, originalMessage?: string): Promise<void> {
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, await this.get(userId)),
      originalMessage,
      state: 'profile_required',
      stage: 'awaiting_preferences',
      lastUserMessageAt: now.toISOString(),
      lastYanaMessageAt: now.toISOString(),
    });
  }

  async saveAwaitingPreferences(
    userId: string,
    criteria: HotelSearchCriteria,
    options: SaveAwaitingPreferencesOptions = {}
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const existing = await this.get(userId);
    const now = new Date();
    return this.save({
      ...this.baseSession(userId, now, existing),
      profileContext: options.profileContext ?? existing?.profileContext,
      originalMessage: options.originalMessage ?? existing?.originalMessage,
      hotelFormResponseId: options.hotelFormResponseId ?? existing?.hotelFormResponseId,
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: undefined,
      state: 'awaiting_extra_preferences',
      lifecycleStatus: 'active',
      stage: 'awaiting_preferences',
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      nextCount: 0,
      results: [],
      nextOffset: 0,
      selectedHotel: undefined,
      lastYanaMessageAt: now.toISOString(),
    });
  }

  async saveSearching(userId: string, criteria: HotelSearchCriteria): Promise<void> {
    const existing = await this.get(userId);
    const now = new Date();
    await this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      additionalPreferences: criteria.additionalPreferences,
      state: 'searching_hotels',
      lifecycleStatus: 'active',
      stage: 'searching',
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      nextCount: existing?.nextCount ?? 0,
      results: [],
      nextOffset: 0,
      outboundPausedAt: undefined,
      lastUserMessageAt: now.toISOString(),
      lastYanaMessageAt: now.toISOString(),
    });
  }

  async saveResults(
    userId: string,
    criteria: HotelSearchCriteria,
    results: HotelBrowseResult[],
    nextOffset: number,
    expected?: { id: string; revision: number }
  ): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const existing = await this.get(userId);
    if (expected && (!existing || existing.id !== expected.id || (existing.revision ?? 0) !== expected.revision)) throw new PersistenceError('conflict');
    const now = new Date();
    const limitedResults = results.slice(0, MAX_BATCHES * BATCH_SIZE);
    const resultBatches = chunk(limitedResults, BATCH_SIZE);
    const latestDisplayedBatchIndex =
      nextOffset <= 0 ? -1 : Math.min(resultBatches.length - 1, Math.ceil(nextOffset / BATCH_SIZE) - 1);

    return this.save({
      ...this.baseSession(userId, now, existing),
      normalizedCriteria: criteria,
      criteria,
      resultsRetrievedAt: new Date().toISOString(),
      additionalPreferences: criteria.additionalPreferences,
      state: latestDisplayedBatchIndex >= 0 ? 'awaiting_hotel_selection' : 'showing_results',
      lifecycleStatus: 'active',
      stage: 'results',
      resultBatches,
      latestDisplayedBatchIndex,
      nextCount: Math.max(0, latestDisplayedBatchIndex),
      results: limitedResults,
      nextOffset,
      outboundPausedAt: undefined,
      selectedHotel: existing?.selectedHotel,
      lastYanaMessageAt: now.toISOString(),
    });
  }

  async saveDisplayedBatch(userId: string, batchIndex: number): Promise<void> {
    const session = await this.get(userId);
    if (!session) {
      return;
    }

    const nextOffset = Math.min((batchIndex + 1) * BATCH_SIZE, session.results.length);
    await this.save({
      ...session,
      state: 'awaiting_hotel_selection',
      stage: 'results',
      latestDisplayedBatchIndex: batchIndex,
      nextCount: Math.max(0, batchIndex),
      nextOffset,
      outboundPausedAt: undefined,
      lastYanaMessageAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async pauseOutbound(userId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session) return;
    const now = new Date().toISOString();
    await this.save({
      ...session,
      outboundPausedAt: now,
      lifecycleStatus: 'paused',
      lastUserMessageAt: now,
      updatedAt: now,
    });
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

  async selectHotel(userId: string, displayNumber: number): Promise<SelectedHotel | null> {
    const session = await this.get(userId);
    if (!session || session.latestDisplayedBatchIndex < 0) {
      return null;
    }

    const latestBatch = session.resultBatches[session.latestDisplayedBatchIndex] ?? [];
    const selectedHotelSnapshot = latestBatch[displayNumber - 1];
    if (!selectedHotelSnapshot) {
      return null;
    }

    const now = new Date().toISOString();
    const selectedHotel: SelectedHotel = {
      selectedHotelId:
        selectedHotelSnapshot.id ??
        selectedHotelSnapshot.googleMapsUri ??
        `${session.id}:${session.latestDisplayedBatchIndex}:${displayNumber}`,
      selectedHotelSnapshot,
      selectedFromBatchIndex: session.latestDisplayedBatchIndex,
      selectedDisplayNumber: displayNumber,
      selectedAt: now,
    };

    await this.save({
      ...session,
      selectedHotel,
      recheckReceipt: undefined,
      pendingHumanHandoffConsent: false,
      pendingSourcingConsent: false,
      sourcingRequestId: undefined,
      state: 'booking_provider_pending',
      stage: 'booking_provider_pending',
      updatedAt: now,
      lastUserMessageAt: now,
      lastYanaMessageAt: now,
    });

    return selectedHotel;
  }

  async markHandoffConsentPending(userId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session?.selectedHotel) throw new Error('Selected hotel session is unavailable');
    await this.save({ ...session, pendingHumanHandoffConsent: true, updatedAt: new Date().toISOString() });
  }

  async markSourcingConsentPending(userId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session?.selectedHotel) throw new Error('Selected hotel session is unavailable');
    await this.save({ ...session, pendingSourcingConsent: true, updatedAt: new Date().toISOString() });
  }

  async markSourcingRequestSaved(userId: string, requestId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session?.selectedHotel) throw new Error('Selected hotel session is unavailable');
    await this.save({ ...session, pendingSourcingConsent: false, sourcingRequestId: requestId, updatedAt: new Date().toISOString() });
  }

  async clearSourcingConsentPending(userId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session) return;
    await this.save({ ...session, pendingSourcingConsent: false, updatedAt: new Date().toISOString() });
  }

  async saveRecheckReceipt(userId: string, receipt: HotelRecheckReceipt): Promise<void> {
    const session = await this.get(userId);
    if (!session?.selectedHotel) throw new Error('Selected hotel session is unavailable');
    await this.save({ ...session, recheckReceipt: receipt, updatedAt: new Date().toISOString() });
  }

  async clearHandoffConsentPending(userId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session) return;
    await this.save({ ...session, pendingHumanHandoffConsent: false, updatedAt: new Date().toISOString() });
  }

  async markHandedOff(userId: string, handoffId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session) throw new Error('Hotel session is unavailable for handoff lock');
    await this.save({
      ...session,
      pendingHumanHandoffConsent: false,
      humanHandoff: { handoffId, status: 'handed_off' },
      updatedAt: new Date().toISOString(),
    });
  }

  async clearHandedOff(userId: string, handoffId: string): Promise<void> {
    const session = await this.get(userId);
    if (!session || session.humanHandoff?.handoffId !== handoffId) return;
    const { humanHandoff: _closed, ...preserved } = session;
    await this.save({ ...preserved, updatedAt: new Date().toISOString() });
  }

  async getAuthoritative(userId: string): Promise<HotelSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    }
    catch { throw new PersistenceError(); }
  }

  async applyCriteriaPatch(userId: string, expectedRevision: number, fields: Record<string, unknown>): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const current = await this.repository.findLatestActiveByUserId(userId);
    if (!current || (current.revision ?? 0) !== expectedRevision) throw new PersistenceError('conflict');
    const patch = validateCriteria('hotel', fields);
    const criteria = { ...current.criteria, ...patch };
    validateCriteria('hotel', Object.fromEntries(Object.entries(criteria).filter(([key]) => canonicalField('hotel', key))));
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current.criteria[key as keyof typeof current.criteria]) === JSON.stringify(value))) return { status: 'durable' };
    await this.save({ ...current, criteria, normalizedCriteria: criteria, state: 'awaiting_extra_preferences', stage: 'awaiting_preferences', updatedAt: new Date().toISOString() });
    return { status: 'durable' };
  }

  async get(userId: string): Promise<HotelSearchSession | null> {
    const redisSession = await this.store.getJson<HotelSearchSession>(this.getKey(userId));
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
      await this.store.setJson(this.getKey(userId), refreshed, HOTEL_SEARCH_SESSION_TTL_SECONDS).catch(() => undefined);
      return refreshed;
    }

    const durableSession = await this.findDurableSession(userId);
    if (!durableSession) {
      return null;
    }

    const normalized = normalizeSession(durableSession);
    await this.store.setJson(this.getKey(userId), normalized, HOTEL_SEARCH_SESSION_TTL_SECONDS).catch(() => undefined);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
    await this.clearLegacyHotelIntakeState(userId);
    try {
      await this.repository.clearActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('hotel_session', 'durable_clear', 'memory_only');
      throw new PersistenceError();
    }
  }

  private async save(session: HotelSearchSession): Promise<import('../storage/Persistence.js').PersistenceOutcome> {
    const expectedRevision = session.revision ?? 0;
    const normalized = this.withReminderSchedule(normalizeSession(session));
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
    await this.clearLegacyHotelIntakeState(normalized.whatsappUserId);
    try { await this.store.setJson(this.getKey(normalized.whatsappUserId), normalized, HOTEL_SEARCH_SESSION_TTL_SECONDS); }
    catch { return { status: 'degraded', reason: 'Saved durably; active cache unavailable' }; }
    this.scheduleReminder(normalized);
    return { status: this.store.isConnected?.() === false ? 'degraded' : 'durable', reason: this.store.isConnected?.() === false ? 'Saved durably; active cache uses memory fallback' : undefined };
  }

  private async findDurableSession(userId: string): Promise<HotelSearchSession | null> {
    try {
      return await this.repository.findLatestActiveByUserId(userId);
    } catch (error) {
      logInfrastructureFallback('hotel_session', 'durable_lookup', 'none');
      throw new PersistenceError();
    }
  }

  private baseSession(
    userId: string,
    now: Date,
    existing?: HotelSearchSession | null
  ): HotelSearchSession {
    return {
      schemaVersion: existing?.schemaVersion ?? WORKFLOW_SCHEMA_VERSION,
      id: existing?.id ?? crypto.randomUUID(),
      lifecycleStatus: existing?.lifecycleStatus ?? 'active',
      revision: existing?.revision ?? 0,
      resultsRetrievedAt: existing?.resultsRetrievedAt,
      userId,
      whatsappUserId: userId,
      profileId: existing?.profileId,
      profileContext: existing?.profileContext,
      originalMessage: existing?.originalMessage,
      hotelFormResponseId: existing?.hotelFormResponseId,
      normalizedCriteria: existing?.normalizedCriteria ?? {},
      criteria: existing?.criteria ?? {},
      additionalPreferences: existing?.additionalPreferences,
      resultBatches: existing?.resultBatches ?? [],
      latestDisplayedBatchIndex: existing?.latestDisplayedBatchIndex ?? -1,
      nextCount: existing?.nextCount ?? 0,
      selectedHotel: existing?.selectedHotel,
      recheckReceipt: existing?.recheckReceipt,
      pendingHumanHandoffConsent: existing?.pendingHumanHandoffConsent,
      pendingSourcingConsent: existing?.pendingSourcingConsent,
      sourcingRequestId: existing?.sourcingRequestId,
      humanHandoff: existing?.humanHandoff,
      state: existing?.state ?? 'hotel_form_sent',
      stage: existing?.stage ?? 'awaiting_preferences',
      results: existing?.results ?? [],
      nextOffset: existing?.nextOffset ?? 0,
      lastUserMessageAt: existing?.lastUserMessageAt,
      lastYanaMessageAt: existing?.lastYanaMessageAt,
      reminderScheduledAt: existing?.reminderScheduledAt,
      reminderDueAt: existing?.reminderDueAt,
      outboundPausedAt: existing?.outboundPausedAt,
      expiresAt:
        existing?.expiresAt ?? new Date(now.getTime() + HOTEL_SEARCH_SESSION_LIFETIME_MS).toISOString(),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private async clearLegacyHotelIntakeState(userId: string): Promise<void> {
    await this.store.deleteKey(`traveler:${this.normalizePhoneKey(userId)}:hotel-intake`);
  }

  private getKey(userId: string): string {
    return `hotel-search:${normalizeUserId(userId)}`;
  }

  private normalizePhoneKey(userId: string): string {
    return userId.replace(/^whatsapp:/, '').replace(/[^\d+]/g, '');
  }

  private withReminderSchedule(session: HotelSearchSession): HotelSearchSession {
    if (!isIncompleteState(session.state) || session.reminderScheduledAt) {
      return session;
    }

    const now = new Date();
    return {
      ...session,
      reminderScheduledAt: now.toISOString(),
      reminderDueAt: new Date(now.getTime() + HOTEL_REMINDER_DELAY_MS).toISOString(),
    };
  }

  private scheduleReminder(session: HotelSearchSession): void {
    // The concierge reminder queue owns follow-up when the new layer is active.
    if (env.features.conciergeEnabled) return;
    if (!isIncompleteState(session.state) || !session.reminderDueAt) {
      const timer = reminderTimers.get(session.whatsappUserId);
      if (timer) {
        clearTimeout(timer);
        reminderTimers.delete(session.whatsappUserId);
      }
      return;
    }

    const dueAt = new Date(session.reminderDueAt).getTime();
    const delayMs = Math.max(0, dueAt - Date.now());
    const existingTimer = reminderTimers.get(session.whatsappUserId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.sendReminderIfStillEligible(session.whatsappUserId, session.reminderScheduledAt);
    }, delayMs);
    timer.unref?.();
    reminderTimers.set(session.whatsappUserId, timer);
  }

  private async sendReminderIfStillEligible(
    userId: string,
    scheduledAt?: string
  ): Promise<void> {
    const session = await this.get(userId);
    if (!session || !scheduledAt || !isIncompleteState(session.state)) {
      return;
    }

    if (session.lastUserMessageAt && session.lastUserMessageAt > scheduledAt) {
      return;
    }

    const lastUserMessageAt = session.lastUserMessageAt
      ? new Date(session.lastUserMessageAt).getTime()
      : 0;
    if (!lastUserMessageAt || Date.now() - lastUserMessageAt > WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS) {
      return;
    }

    const profile = await getProfileService().getProfile(userId);
    const preferredName = profile?.form.preferredName || profile?.form.fullName || 'there';
    const destination = session.normalizedCriteria.location || 'your destination';
    await getHotelReminderOutboundService().sendWhatsAppText(
      userId,
      `Hi ${preferredName}, would you like to continue your hotel search for ${destination}? I saved your progress, so you can reply 'resume' to continue or 'reset' to start over.`
    );
  }
}

function getHotelReminderOutboundService(): {
  sendWhatsAppText(to: string, body: string): Promise<boolean>;
} {
  if (env.whatsapp.provider === 'openwa') {
    return getOpenWaOutboundService();
  }

  if (env.whatsapp.provider === 'meta') {
    return getMetaWhatsAppOutboundService();
  }

  return getTwilioOutboundService();
}

let hotelSearchSessionServiceInstance: HotelSearchSessionService | null = null;

export function getHotelSearchSessionService(): HotelSearchSessionService {
  if (!hotelSearchSessionServiceInstance) {
    hotelSearchSessionServiceInstance = new HotelSearchSessionService();
  }

  return hotelSearchSessionServiceInstance;
}

export function initHotelSearchSessionService(
  service = new HotelSearchSessionService()
): HotelSearchSessionService {
  hotelSearchSessionServiceInstance = service;
  return service;
}

function normalizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9:+-]/g, '_');
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function normalizeSession(session: HotelSearchSession): HotelSearchSession {
  const criteria = session.normalizedCriteria ?? session.criteria ?? {};
  const results = (session.results ?? session.resultBatches?.flat() ?? []).slice(0, MAX_BATCHES * BATCH_SIZE);
  const resultBatches = session.resultBatches?.length ? session.resultBatches : chunk(results, BATCH_SIZE);
  const state = session.state ?? stateFromLegacyStage(session.stage);

  return {
    ...session,
    schemaVersion: session.schemaVersion ?? WORKFLOW_SCHEMA_VERSION,
    userId: session.userId ?? session.whatsappUserId,
    whatsappUserId: session.whatsappUserId ?? session.userId,
    normalizedCriteria: criteria,
    criteria,
    resultBatches,
    latestDisplayedBatchIndex:
      typeof session.latestDisplayedBatchIndex === 'number'
        ? session.latestDisplayedBatchIndex
        : inferLatestDisplayedBatchIndex(session.nextOffset),
    nextCount: typeof session.nextCount === 'number' ? session.nextCount : 0,
    state,
    stage: session.stage ?? legacyStageFromState(state),
    results,
    nextOffset: session.nextOffset ?? 0,
  };
}

function inferLatestDisplayedBatchIndex(nextOffset?: number): number {
  if (!nextOffset || nextOffset <= 0) {
    return -1;
  }

  return Math.ceil(nextOffset / BATCH_SIZE) - 1;
}

function stateFromLegacyStage(stage?: LegacyHotelSearchStage): HotelSearchState {
  if (stage === 'awaiting_preferences') return 'awaiting_extra_preferences';
  if (stage === 'searching') return 'searching_hotels';
  if (stage === 'results') return 'showing_results';
  if (stage === 'booking_provider_pending') return 'booking_provider_pending';
  if (stage === 'reset') return 'reset';
  return 'hotel_form_sent';
}

function legacyStageFromState(state: HotelSearchState): LegacyHotelSearchStage {
  if (state === 'awaiting_extra_preferences' || state === 'hotel_form_completed') {
    return 'awaiting_preferences';
  }
  if (state === 'searching_hotels') return 'searching';
  if (state === 'showing_results' || state === 'awaiting_hotel_selection') return 'results';
  if (state === 'booking_provider_pending') return 'booking_provider_pending';
  if (state === 'reset') return 'reset';
  return 'awaiting_preferences';
}

function isIncompleteState(state: HotelSearchState): boolean {
  return [
    'profile_required',
    'hotel_form_sent',
    'hotel_form_completed',
    'awaiting_extra_preferences',
    'searching_hotels',
    'showing_results',
    'awaiting_hotel_selection',
  ].includes(state);
}
