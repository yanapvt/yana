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

interface SessionCandidate {
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
    const candidates = (
      await Promise.all([
        this.dependencies.loadHotel?.(userId) ?? loadHotelCandidate(userId),
        this.dependencies.loadRestaurant?.(userId) ?? loadRestaurantCandidate(userId),
        this.dependencies.loadExcursion?.(userId) ?? loadExcursionCandidate(userId),
        this.dependencies.loadLogistics?.(userId) ?? loadLogisticsCandidate(userId),
        this.dependencies.loadItinerary?.(userId) ?? loadItineraryCandidate(userId),
      ])
    ).filter((candidate): candidate is SessionCandidate => candidate !== null);

    const active = candidates.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0];
    if (!active) return null;

    const missingFields = active.stage === 'awaiting_preferences'
      ? active.requiredFields.filter((field) => isMissing(active.fields[field]))
      : [];

    return {
      flow: active.flow,
      state: active.stage || active.state,
      activeSchema: active.schema,
      awaitedField: missingFields[0],
      collectedFields: { ...active.fields },
      requiredFields: [...active.requiredFields],
      missingFields,
      updatedAt: active.updatedAt,
    };
  }
}

async function loadHotelCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getHotelSearchSessionService().get(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'hotel',
    session.state,
    session.stage,
    'search_hotels',
    { ...session.criteria },
    ['location', 'checkinDate', 'checkoutDate', 'guests'],
    session.updatedAt
  );
}

async function loadRestaurantCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getRestaurantSearchSessionService().get(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'restaurant',
    session.state,
    session.stage,
    'search_restaurants',
    { ...session.criteria },
    ['location'],
    session.updatedAt
  );
}

async function loadExcursionCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getExcursionSearchSessionService().get(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'excursion',
    session.state,
    session.stage,
    'search_excursions',
    { ...session.criteria },
    ['destination'],
    session.updatedAt
  );
}

async function loadLogisticsCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getLogisticsSearchSessionService().get(userId);
  if (!session || session.state === 'reset') return null;
  return candidate(
    'logistics',
    session.state,
    session.stage,
    'search_transport',
    { ...session.criteria },
    ['pickupLocation', 'destination', 'pickupDate', 'passengers'],
    session.updatedAt
  );
}

async function loadItineraryCandidate(userId: string): Promise<SessionCandidate | null> {
  const session = await getItinerarySessionService().get(userId);
  if (!session || session.state === 'completed') return null;
  return candidate(
    'itinerary',
    session.state,
    session.state,
    'plan_itinerary',
    { ...session.criteria },
    ['arrivalDate', 'departureDate', 'adults'],
    session.updatedAt
  );
}

function candidate(
  flow: OrchestrationFlow,
  state: string,
  stage: string,
  schema: string,
  fields: Record<string, unknown>,
  requiredFields: string[],
  updatedAt: string
): SessionCandidate {
  return { flow, state, stage, schema, fields, requiredFields, updatedAt };
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);
}
