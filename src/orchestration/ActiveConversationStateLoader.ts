import {
  getExcursionSearchSessionService,
} from '../services/excursionSearchSessionService.js';
import { getHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { getItinerarySessionService } from '../services/itinerarySessionService.js';
import { getLogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
import { getRestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import type {
  OrchestrationFlow,
  OrchestrationSessionSnapshot,
} from './Orchestrator.js';
import { missingFields as computeMissing, validateCriteria, workflow, WORKFLOW_SCHEMA_VERSION } from './WorkflowDefinitions.js';

interface SessionCandidate {
  lifecycleStatus?: 'active' | 'paused';
  id?: string;
  revision?: number;
  itinerary?: OrchestrationSessionSnapshot['itinerary'];
  verifiedResults?: OrchestrationSessionSnapshot['verifiedResults'];
  resultBatches?: unknown[][];
  latestDisplayedBatchIndex?: number;
  resultsRetrievedAt?: string;
  flow: OrchestrationFlow;
  state: string;
  stage: string;
  schema: string;
  fields: Record<string, unknown>;
  requiredFields: string[];
  updatedAt: string;
}

export interface ActiveConversationStateLoaderDependencies {
  loadHotel?: (userId: string) => Promise<SessionCandidate | null>;
  loadRestaurant?: (userId: string) => Promise<SessionCandidate | null>;
  loadExcursion?: (userId: string) => Promise<SessionCandidate | null>;
  loadLogistics?: (userId: string) => Promise<SessionCandidate | null>;
  loadItinerary?: (userId: string) => Promise<SessionCandidate | null>;
}

/**
 * Resolves the one workflow that owns the next inbound message. Individual
 * session services remain responsible for their detailed results and booking
 * state; this loader only creates the bounded control-plane snapshot.
 */
export class ActiveConversationStateLoader {
  constructor(private readonly dependencies: ActiveConversationStateLoaderDependencies = {}) {}

  async load(userId: string): Promise<OrchestrationSessionSnapshot | null> {
    return (await this.loadWithPaused(userId)).activeSession;
  }

  async loadWithPaused(userId: string): Promise<{
    activeSession: OrchestrationSessionSnapshot | null;
    pausedSessions: OrchestrationSessionSnapshot[];
  }> {
    const candidates = (
      await Promise.all([
        this.dependencies.loadHotel?.(userId) ?? loadHotelCandidate(userId),
        this.dependencies.loadRestaurant?.(userId) ?? loadRestaurantCandidate(userId),
        this.dependencies.loadExcursion?.(userId) ?? loadExcursionCandidate(userId),
        this.dependencies.loadLogistics?.(userId) ?? loadLogisticsCandidate(userId),
        this.dependencies.loadItinerary?.(userId) ?? loadItineraryCandidate(userId),
      ])
    ).filter((candidate): candidate is SessionCandidate => candidate !== null);

    const ordered = candidates.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    );
    // Sessions written before lifecycle tracking was introduced are active by
    // default. Only an explicit pause removes a workflow from control.
    const active = ordered.find((candidate) => candidate.lifecycleStatus !== 'paused');
    if (!active) return { activeSession: null, pausedSessions: ordered.slice(0, 4).map(snapshot) };

    return {
      activeSession: snapshot(active),
      pausedSessions: ordered.filter((candidate) => candidate !== active).slice(0, 4).map(snapshot),
    };
  }
}

function snapshot(active: SessionCandidate): OrchestrationSessionSnapshot {
    const requiredFields = workflow(active.flow)?.required ?? active.requiredFields;
    const missingFields = active.stage === 'awaiting_preferences'
      ? computeMissing(active.flow, active.fields, requiredFields)
      : [];

    return {
      id: active.id, revision: active.revision, schemaVersion: WORKFLOW_SCHEMA_VERSION,
      lifecycleStatus: active.lifecycleStatus ?? 'active',
      itinerary: active.itinerary, verifiedResults: active.verifiedResults ?? buildVerifiedResults(
        active.flow,
        active.id,
        active.resultBatches,
        active.latestDisplayedBatchIndex,
        active.resultsRetrievedAt
      ),
      flow: active.flow,
      state: active.stage || active.state,
      activeSchema: workflow(active.flow)?.schema ?? active.schema,
      awaitedField: missingFields[0],
      collectedFields: validateCriteria(active.flow, active.fields, false),
      requiredFields: [...requiredFields],
      missingFields,
      updatedAt: active.updatedAt,
    };
}

async function loadHotelCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getHotelSearchSessionService().getAuthoritative(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'hotel',
    session.state,
    session.stage,
    'search_hotels',
    { ...session.criteria },
    ['location', 'checkinDate', 'checkoutDate', 'guests'],
    session.updatedAt, session
  );
}

async function loadRestaurantCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getRestaurantSearchSessionService().getAuthoritative(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'restaurant',
    session.state,
    session.stage,
    'search_restaurants',
    { ...session.criteria },
    ['location'],
    session.updatedAt, session
  );
}

async function loadExcursionCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getExcursionSearchSessionService().getAuthoritative(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'excursion',
    session.state,
    session.stage,
    'search_excursions',
    { ...session.criteria },
    ['destination'],
    session.updatedAt, session
  );
}

async function loadLogisticsCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getLogisticsSearchSessionService().getAuthoritative(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'logistics',
    session.state,
    session.stage,
    'search_transport',
    { ...session.criteria },
    ['pickupLocation', 'destination', 'pickupDate', 'passengers'],
    session.updatedAt, session
  );
}

async function loadItineraryCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getItinerarySessionService().getAuthoritative(userId);
  if (!session || session.state === 'completed') return null;
  return candidate(
    'itinerary',
    session.state,
    session.state,
    'plan_itinerary',
    { ...session.criteria },
    ['arrivalDate', 'departureDate', 'adults'],
    session.updatedAt, session
  );
}

function candidate(
  flow: OrchestrationFlow,
  state: string,
  stage: string,
  schema: string,
  fields: Record<string, unknown>,
  requiredFields: string[],
  updatedAt: string,
  session?: {
    lifecycleStatus?: 'active' | 'paused';
    id?: string;
    revision?: number;
    resultsRetrievedAt?: string;
    itinerary?: OrchestrationSessionSnapshot['itinerary'];
    results?: unknown[];
    resultBatches?: unknown[][];
    latestDisplayedBatchIndex?: number;
  }
): SessionCandidate {
  const verifiedResults = buildVerifiedResults(
    flow,
    session?.id,
    session?.resultBatches,
    session?.latestDisplayedBatchIndex,
    session?.resultsRetrievedAt
  );
  return { flow, state, stage, schema, fields, requiredFields, updatedAt, id: session?.id,
    lifecycleStatus: session?.lifecycleStatus ?? 'active',
    revision: session?.revision, itinerary: session?.itinerary, verifiedResults };
}

function buildVerifiedResults(
  flow: OrchestrationFlow,
  sessionId?: string,
  resultBatches?: unknown[][],
  latestDisplayedBatchIndex = -1,
  resultsRetrievedAt = 'unknown'
): OrchestrationSessionSnapshot['verifiedResults'] | undefined {
  const displayedResults = latestDisplayedBatchIndex >= 0
    ? resultBatches?.[latestDisplayedBatchIndex] ?? []
    : [];
  const items = displayedResults.slice(0, 3).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string'
      ? record.name
      : typeof record.provider === 'string'
        ? record.provider
        : undefined;
    if (!name) return [];
    const resultId = typeof record.id === 'string' && record.id
      ? record.id
      : typeof record.googlePlaceId === 'string' && record.googlePlaceId
        ? record.googlePlaceId
        : `${sessionId ?? flow}:${latestDisplayedBatchIndex}:${index + 1}`;
    return [{
      resultId,
      position: index + 1,
      name: name.slice(0, 120),
      rating: typeof record.rating === 'number' ? record.rating : undefined,
    }];
  });
  return items.length ? {
    source: 'saved_discovery_results_not_confirmed_inventory',
    retrievedAt: resultsRetrievedAt,
    items,
  } : undefined;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);
}
