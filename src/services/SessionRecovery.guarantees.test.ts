import { describe, expect, it } from 'vitest';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { WORKFLOW_SCHEMA_VERSION } from '../orchestration/WorkflowDefinitions.js';
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { HotelSearchSessionService, type HotelSearchSession } from './hotelSearchSessionService.js';
import { ItinerarySessionService, type ItinerarySession } from './itinerarySessionService.js';
import { ItineraryWorkspaceService } from './ItineraryWorkspaceService.js';
import { ItineraryPlannerService } from './ItineraryPlannerService.js';
import { RestaurantSearchSessionService, type RestaurantSearchSession } from './restaurantSearchSessionService.js';
import { ExcursionSearchSessionService, type ExcursionSearchSession } from './excursionSearchSessionService.js';
import { LogisticsSearchSessionService, type LogisticsSearchSession } from './logisticsSearchSessionService.js';

const userId = 'whatsapp:+94770000021';
const key = `hotel-search:${userId}`;

describe('durable workflow recovery guarantees', () => {
  it('restores a paused journey, fields and pending consent after Redis expiry and restart', async () => {
    const durable = new FixtureSessionRepository<HotelSearchSession>();
    const originalCache = new FixtureStateStore();
    const original = new HotelSearchSessionService(originalCache as any, durable);
    const criteria = { location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-03',
      guests: 2, additionalPreferences: 'Quiet room' };
    await original.saveResults(userId, criteria, [{ id: 'hotel-1', name: 'Selected Stay' }], 1);
    await original.selectHotel(userId, 1);
    await original.markSourcingConsentPending(userId);
    await original.pause(userId);
    const before = (await original.getAuthoritative(userId))!;
    expect(before.pendingSourcingConsent).toBe(true);
    expect(before.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);

    // The old expiresAt was tied to the Redis TTL; it must not end a durable unfinished workflow.
    durable.records.set(userId, { ...before, expiresAt: new Date(0).toISOString() });
    originalCache.clear();
    const restartedCache = new FixtureStateStore();
    const restarted = new HotelSearchSessionService(restartedCache as any, durable);
    const recovered = await restarted.get(userId);
    expect(recovered).toMatchObject({ id: before.id, revision: before.revision,
      lifecycleStatus: 'paused', stage: before.stage, criteria,
      pendingSourcingConsent: true, selectedHotel: { selectedHotelSnapshot: { id: 'hotel-1' } } });
    expect(await restartedCache.getJson(key)).toMatchObject({ id: before.id, revision: before.revision });
    expect((await restarted.getAuthoritative(userId))?.id).toBe(before.id);

    const loader = new ActiveConversationStateLoader({
      loadHotel: async () => {
        const session = await restarted.getAuthoritative(userId);
        return session && { id: session.id, revision: session.revision, lifecycleStatus: session.lifecycleStatus,
          flow: 'hotel', state: session.state, stage: session.stage, schema: 'search_hotels',
          fields: session.criteria, requiredFields: ['location'], updatedAt: session.updatedAt };
      },
      loadRestaurant: async () => null, loadExcursion: async () => null,
      loadLogistics: async () => null, loadItinerary: async () => null,
    });
    expect((await loader.loadWithPaused(userId)).pausedSessions).toMatchObject([
      { id: before.id, schemaVersion: WORKFLOW_SCHEMA_VERSION, collectedFields: expect.objectContaining(criteria) },
    ]);
    await restarted.resume(userId);
    expect(await new HotelSearchSessionService(new FixtureStateStore() as any, durable).get(userId))
      .toMatchObject({ id: before.id, lifecycleStatus: 'active', criteria,
        pendingSourcingConsent: true, revision: before.revision! + 1 });
  });

  it('repairs an older Redis projection from a newer PostgreSQL revision', async () => {
    const durable = new FixtureSessionRepository<HotelSearchSession>();
    const cache = new FixtureStateStore();
    const sessions = new HotelSearchSessionService(cache as any, durable);
    await sessions.saveAwaitingPreferences(userId, { location: 'Galle', guests: 2 });
    const old = (await cache.getJson<HotelSearchSession>(key))!;
    durable.records.set(userId, { ...old, revision: old.revision! + 1,
      criteria: { ...old.criteria, guests: 3 }, normalizedCriteria: { ...old.criteria, guests: 3 } });
    const repaired = await sessions.get(userId);
    expect(repaired).toMatchObject({ revision: old.revision! + 1, criteria: { guests: 3 } });
    expect(await cache.getJson(key)).toMatchObject({ revision: old.revision! + 1, criteria: { guests: 3 } });

    durable.records.set(userId, { ...old, id: 'replacement-workflow', revision: 1,
      criteria: { location: 'Kandy' }, normalizedCriteria: { location: 'Kandy' } });
    expect(await sessions.get(userId)).toMatchObject({ id: 'replacement-workflow', criteria: { location: 'Kandy' } });
    expect(await cache.getJson(key)).toMatchObject({ id: 'replacement-workflow' });

    durable.records.set(userId, { ...old, id: 'replacement-workflow', revision: 2,
      criteria: { location: 'Kandy' }, normalizedCriteria: { location: 'Kandy' } });
    await cache.setJson(key, { ...old, id: 'replacement-workflow', revision: 99,
      criteria: { location: 'Stale cache' }, normalizedCriteria: { location: 'Stale cache' } });
    expect(await sessions.get(userId)).toMatchObject({ revision: 2, criteria: { location: 'Kandy' } });

    durable.records.delete(userId);
    expect(await sessions.get(userId)).toBeNull();
    expect(await cache.getJson(key)).toBeNull();
  });

  it('returns the durable workflow even when Redis cannot be repopulated', async () => {
    const durable = new FixtureSessionRepository<HotelSearchSession>();
    await new HotelSearchSessionService(new FixtureStateStore() as any, durable)
      .saveAwaitingPreferences(userId, { location: 'Galle' });
    const unavailable = new FixtureStateStore();
    unavailable.setJson = async () => { throw new Error('Redis unavailable'); };
    expect(await new HotelSearchSessionService(unavailable as any, durable).get(userId))
      .toMatchObject({ criteria: { location: 'Galle' } });
  });

  it('renews a server-issued itinerary link after the prior cache lifetime passes', async () => {
    const durable = new FixtureSessionRepository<ItinerarySession>();
    const sessions = new ItinerarySessionService(new FixtureStateStore() as any, durable);
    const criteria = { arrivalDate: '2026-12-01', departureDate: '2026-12-03', adults: 2 };
    const itinerary = await new ItineraryPlannerService().plan(criteria);
    await sessions.saveItinerary(userId, criteria, itinerary);
    const original = await new ItineraryWorkspaceService(new FixtureStateStore() as any, sessions)
      .createWorkspace(userId, itinerary, criteria);
    const expired = durable.records.get(userId)!;
    durable.records.set(userId, { ...expired, expiresAt: new Date(0).toISOString() });

    const unavailable = new FixtureStateStore();
    unavailable.setJson = async () => { throw new Error('Redis unavailable'); };
    const restartedSessions = new ItinerarySessionService(unavailable as any, durable);
    const restartedWorkspace = new ItineraryWorkspaceService(unavailable as any, restartedSessions);
    const renewed = await restartedWorkspace.createWorkspace(userId, itinerary, criteria);
    expect(renewed.tripId).toBe(original.tripId);
    expect(renewed.shareToken).not.toBe(original.shareToken);
    expect(Date.parse((await restartedSessions.getAuthoritative(userId))!.expiresAt)).toBeGreaterThan(Date.now());
    expect((await restartedWorkspace.getWorkspace(renewed.shareToken))?.tripId).toBe(original.tripId);
  });

  it('recovers unfinished restaurant, excursion and logistics workflows after their old cache lifetime', async () => {
    const restaurantRepo = new FixtureSessionRepository<RestaurantSearchSession>();
    const restaurant = new RestaurantSearchSessionService(new FixtureStateStore() as any, restaurantRepo);
    await restaurant.saveAwaitingPreferences(userId, { location: 'Galle' });
    const restaurantSaved = restaurantRepo.records.get(userId)!;
    restaurantRepo.records.set(userId, { ...restaurantSaved, expiresAt: new Date(0).toISOString() });
    const restaurantCache = new FixtureStateStore();
    const restaurantRestarted = new RestaurantSearchSessionService(restaurantCache as any, restaurantRepo);
    expect(await restaurantRestarted.getAuthoritative(userId)).toMatchObject({ id: restaurantSaved.id });
    expect(await restaurantRestarted.get(userId)).toMatchObject({ criteria: { location: 'Galle' } });
    expect(await restaurantCache.getJson(`restaurant-search:${userId}`)).toMatchObject({ id: restaurantSaved.id });

    const excursionRepo = new FixtureSessionRepository<ExcursionSearchSession>();
    const excursion = new ExcursionSearchSessionService(new FixtureStateStore() as any, excursionRepo);
    await excursion.saveAwaitingPreferences(userId, { destination: 'Ella' });
    const excursionSaved = excursionRepo.records.get(userId)!;
    excursionRepo.records.set(userId, { ...excursionSaved, expiresAt: new Date(0).toISOString() });
    const excursionCache = new FixtureStateStore();
    const excursionRestarted = new ExcursionSearchSessionService(excursionCache as any, excursionRepo);
    expect(await excursionRestarted.getAuthoritative(userId)).toMatchObject({ id: excursionSaved.id });
    expect(await excursionRestarted.get(userId)).toMatchObject({ criteria: { destination: 'Ella' } });
    expect(await excursionCache.getJson(`excursion-search:${userId}`)).toMatchObject({ id: excursionSaved.id });

    const logisticsRepo = new FixtureSessionRepository<LogisticsSearchSession>();
    const logistics = new LogisticsSearchSessionService(new FixtureStateStore() as any, logisticsRepo);
    await logistics.saveAwaitingPreferences(userId, { pickupLocation: 'Colombo', destination: 'Galle' });
    const logisticsSaved = logisticsRepo.records.get(userId)!;
    logisticsRepo.records.set(userId, { ...logisticsSaved, expiresAt: new Date(0).toISOString() });
    const logisticsCache = new FixtureStateStore();
    const logisticsRestarted = new LogisticsSearchSessionService(logisticsCache as any, logisticsRepo);
    expect(await logisticsRestarted.getAuthoritative(userId)).toMatchObject({ id: logisticsSaved.id });
    expect(await logisticsRestarted.get(userId)).toMatchObject({ criteria: { destination: 'Galle' } });
    expect(await logisticsCache.getJson(`logistics-search:${userId}`)).toMatchObject({ id: logisticsSaved.id });
  });
});
