import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextBuilder, modelContext } from './ContextBuilder.js';
import { ConversationControlPlane } from './ConversationControlPlane.js';
import { ActiveConversationStateLoader } from './ActiveConversationStateLoader.js';
import { validateCriteria, missingFields, decisionOutputSchema, workflow } from './WorkflowDefinitions.js';
import { validateAndMapDecision } from './LLMDecisionInterpreter.js';
import { validateSemanticUI, renderWebsiteDecision, renderWhatsAppDecision } from './SemanticUI.js';
import { DecisionEngine } from './DecisionEngine.js';
import { LLMService } from '../services/LLMService.js';
import { ItineraryPlannerService } from '../services/ItineraryPlannerService.js';
import { ItineraryEditService, resolveItineraryEdit } from '../services/ItineraryEditService.js';
import { ItinerarySessionService } from '../services/itinerarySessionService.js';
import { ItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';
import { HotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { FixtureStateStore, FixtureSessionRepository } from '../tests/fixtures/sessionStorage.js';
import type { ItinerarySession } from '../services/itinerarySessionService.js';
import type { HotelSearchSession } from '../services/hotelSearchSessionService.js';
import type { OrchestrationContext, ConversationAnalysis } from './Orchestrator.js';
import { sanitizeConversationText } from '../utils/contextPrivacy.js';
import { InMemoryProfileRepository } from '../storage/profileRepository.js';

afterEach(() => vi.unstubAllGlobals());
const criteria = { arrivalDate: '2026-11-01', departureDate: '2026-11-04', adults: 2 };
async function trip() {
  const store = new FixtureStateStore();
  const repository = new FixtureSessionRepository<ItinerarySession>();
  const sessions = new ItinerarySessionService(store as any, repository);
  await sessions.saveItinerary('fixture-traveller', criteria, await new ItineraryPlannerService().plan(criteria));
  return { store, repository, sessions, current: (await sessions.getAuthoritative('fixture-traveller'))! };
}

describe('canonical interpretation and backend validation', () => {
  it('collects explicit profile corrections through the approved form instead of executing a search', () => {
    const context: OrchestrationContext = { userId: 'fixture', profileComplete: true, metadata: {},
      message: { messageId: 'm', from: 'fixture', inputType: 'text', text: 'update my profile' } };
    expect(new DecisionEngine().decide({ context, analysis: { role: 'new_intent', intent: 'profile_update', targetFlow: 'profile',
      entities: {}, confidence: 0.9, rawText: 'update my profile', shouldUseLLM: false } })).toMatchObject({ action: 'send_form', targetFlow: 'profile', entities: {} });
  });
  it.each([
    ['hotel', { checkin_date: '2026-11-01', checkout_date: '2026-11-03', location: 'Galle', guests: 2 }, 'checkinDate'],
    ['logistics', { dropOffLocation: 'Galle', date: '2026-11-01', pickupLocation: 'Colombo', passengers: 2 }, 'destination'],
    ['excursion', { location: 'Ella' }, 'destination'],
    ['restaurant', { location: 'Galle' }, 'location'],
    ['itinerary', criteria, 'arrivalDate'],
  ] as const)('uses canonical %s criteria for required fields', (flow, values, key) => {
    const validated = validateCriteria(flow, values);
    expect(validated).toHaveProperty(key);
    expect(missingFields(flow, validated)).toEqual([]);
    expect(workflow(flow)?.schema).toBeTruthy();
  });
  it.each([{ guests: '2' }, { guests: -1 }, { checkinDate: '2026-02-30' }, { bookingStatus: 'confirmed' },
    { checkinDate: '2026-11-03', checkoutDate: '2026-11-01' }, { boardBasis: 'invented' }])('rejects invalid/unauthorized criteria %j', (value) => {
    expect(() => validateCriteria('hotel', value)).toThrow();
  });
  it('never maps an arbitrary intent containing a service word to an executable flow', () => {
    const decision = validateAndMapDecision({ intent: 'charge_hotel_and_confirm_payment', parameters: {}, missingFields: [], suggestedAction: 'execute_tool', confidence: 1 });
    expect(decision.intent).toBe('unclear');
  });
  it.each([
    { parameters: [] }, { missingFields: [2] }, { suggestedAction: 'charge' }, { confidence: 2 }, { bookingConfirmed: true },
  ])('rejects malformed structured outputs at the real service boundary %j', async (invalid) => {
    const result = { intent: 'search_hotels', parameters: {}, missingFields: [], suggestedAction: 'ask_missing', confidence: 0.9, ...invalid };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) }));
    await expect(new LLMService({ provider: 'groq', apiKey: 'fixture-key' }).decide({ userMessage: 'fixture' })).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    expect(() => decisionOutputSchema.parse(result)).toThrow();
  });
  it('requires clarification for unrequested changes and ignores a losing proposal', () => {
    const context: OrchestrationContext = { userId: 'fixture', profileComplete: true, metadata: {},
      message: { messageId: 'm', from: 'fixture', inputType: 'text', text: 'quiet please' },
      activeSession: { flow: 'restaurant', collectedFields: { location: 'Galle' }, requiredFields: ['location'], missingFields: [] } };
    const analysis: ConversationAnalysis = { role: 'extra_preference', intent: 'restaurant_search', targetFlow: 'restaurant', entities: {}, confidence: 0.9, rawText: 'quiet please', shouldUseLLM: true };
    expect(new DecisionEngine().decide({ context, analysis, interpretation: { role: 'extra_preference', intent: 'restaurant_search', entities: { location: 'Kandy' }, confidence: 0.95, suggestedAction: 'execute_tool' } }).action).toBe('ask_clarifying_question');
    expect(new DecisionEngine().decide({ context, analysis, interpretation: { role: 'extra_preference', intent: 'restaurant_search', entities: { cuisine: 'Chinese' }, confidence: 0.5 } }).entities).toEqual({});
  });
});

describe('retrieved context and continuity', () => {
  it('omits credentials and secure links while preserving travel dates', () => {
    const fakeKey = 'sk-' + 'fixture-keylongenough';
    const sanitized = sanitizeConversationText(`Travel 2026-11-01 to 2026-11-04. mail@example.test +94770000001 https://yana.test/forms/hotel/private-link ${fakeKey}`);
    expect(sanitized).toContain('2026-11-01');
    expect(sanitized).toContain('2026-11-04');
    expect(sanitized).not.toMatch(/mail@example|94770000001|private-link|sk-fixture/);
  });
  it('retrieves bounded turns on a fresh builder and redacts profile/session secrets', async () => {
    const messages = { findRecentByTraveller: vi.fn(async () => Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}:` + 'x'.repeat(2000) }))) };
    const history = await new ContextBuilder(messages).loadHistory('fixture');
    const context = new ContextBuilder(messages).build({ ...history, profileComplete: true,
      inboundMessage: { messageId: 'm', from: 'fixture', to: 'bot', type: 'text', inputType: 'text', timestamp: new Date(), content: { type: 'text', body: 'followup' } }, text: 'followup',
      profile: { userId: 'fixture', createdAt: new Date(), updatedAt: new Date(), form: { preferredName: 'Sam', email: 'secret-contact', phone: 'secret-phone', preferredLanguage: 'French' } as any },
      activeSession: { flow: 'hotel', collectedFields: { location: 'Galle', rateToken: 'secret-token' }, missingFields: ['guests'], requiredFields: ['guests'] },
    });
    const projected = modelContext(context);
    expect(projected.conversationHistory).toHaveLength(12);
    expect(projected.conversationHistory!.every((turn) => turn.content.length <= 1000)).toBe(true);
    expect(projected.userProfile?.preferredLanguage).toBe('French');
    expect(JSON.stringify(projected)).not.toContain('secret-');
    expect(projected.sessionState?.collectedFields).toEqual({ location: 'Galle' });
    expect(messages.findRecentByTraveller).toHaveBeenCalledWith('fixture', 12);
  });
  it('keeps repository failure distinct from empty history and blocks interpretation', async () => {
    const builder = new ContextBuilder({ findRecentByTraveller: async () => { throw new Error('private connection'); } });
    expect((await builder.loadHistory('fixture')).historyStatus).toBe('unavailable');
    const stateLoader = new ActiveConversationStateLoader({ loadHotel: async () => null, loadRestaurant: async () => null,
      loadExcursion: async () => null, loadLogistics: async () => null, loadItinerary: async () => null });
    const control = new ConversationControlPlane({ contextBuilder: builder, stateLoader });
    await expect(control.interpret({ profileComplete: true, correlationId: 'c', text: 'quiet please',
      inboundMessage: { messageId: 'm', from: 'fixture', to: 'bot', type: 'text', inputType: 'text', timestamp: new Date(), content: { type: 'text', body: 'quiet please' } } })).rejects.toMatchObject({ code: 'CONTEXT_UNAVAILABLE' });
  });
});

describe('authoritative itinerary edits, revisions and workspace recovery', () => {
  it('returns explicit durable and degraded-cache receipts without swallowing a failed durable write', async () => {
    const { sessions, repository } = await trip();
    const current = (await sessions.getAuthoritative('fixture-traveller'))!;
    expect((await sessions.saveEditing('fixture-traveller', current.criteria, current.itinerary!)).status).toBe('durable');
    const cacheUnavailable = new FixtureStateStore();
    cacheUnavailable.setJson = async () => { throw new Error('cache unavailable'); };
    const degraded = new ItinerarySessionService(cacheUnavailable as any, repository);
    const command = resolveItineraryEdit('change day 2 morning to a market visit', (await sessions.getAuthoritative('fixture-traveller'))!)!;
    const updated = await new ItineraryEditService(degraded).apply('fixture-traveller', command);
    expect(updated.itinerary?.days[1].morning).toBe('a market visit');
    repository.fail = true;
    await expect(sessions.getAuthoritative('fixture-traveller')).rejects.toMatchObject({ status: 'failed' });
  });
  it('rejects stale profile corrections at the authoritative repository', async () => {
    const repository = new InMemoryProfileRepository();
    const first = await repository.upsert('fixture', { preferredName: 'Sam' } as any, 0);
    await repository.upsert('fixture', { preferredName: 'Samantha' } as any, first.revision);
    await expect(Promise.resolve().then(() => repository.upsert('fixture', { preferredName: 'stale' } as any, first.revision))).rejects.toMatchObject({ status: 'conflict' });
    expect((await repository.findByUserId('fixture'))?.form.preferredName).toBe('Samantha');
  });
  it('changes actual content and recovers through a new workspace and session instance after cache loss', async () => {
    const { store, repository, sessions, current } = await trip();
    const workspace = await new ItineraryWorkspaceService(store as any, sessions).createWorkspace('fixture-traveller', current.itinerary!, criteria);
    const latest = (await sessions.getAuthoritative('fixture-traveller'))!;
    const command = resolveItineraryEdit('change day 2 afternoon to a quiet beach visit', latest)!;
    await new ItineraryEditService(sessions).apply('fixture-traveller', command);
    store.clear();
    const restarted = new ItinerarySessionService(new FixtureStateStore() as any, repository);
    const recovered = await new ItineraryWorkspaceService(new FixtureStateStore() as any, restarted).getWorkspace(workspace.shareToken);
    expect(recovered?.itinerary.days[1].afternoon).toBe('a quiet beach visit');
    expect((await restarted.get('fixture-traveller'))?.itinerary?.days[1].afternoon).toBe('a quiet beach visit');
    expect(recovered?.currentVersion).toBe(command.expectedRevision + 1);
    expect(current.itinerary!.days[1].afternoon).not.toBe('a quiet beach visit');
  });
  it('rejects a stale concurrent edit and retains the winning edit', async () => {
    const { sessions, current, repository } = await trip();
    const other = new ItinerarySessionService(new FixtureStateStore() as any, repository);
    const first = resolveItineraryEdit('change day 2 morning to a museum visit', current)!;
    const second = { ...first, value: 'a stale replacement' };
    const results = await Promise.allSettled([new ItineraryEditService(sessions).apply('fixture-traveller', first), new ItineraryEditService(other).apply('fixture-traveller', second)]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect((await sessions.getAuthoritative('fixture-traveller'))?.itinerary?.days[1].morning).toBe('a museum visit');
  });
  it('does not publish an edit when the durable save fails', async () => {
    const { sessions, current, repository, store } = await trip();
    const command = resolveItineraryEdit('change day 2 hotel to a boutique stay suggestion', current)!;
    const originalUpsert = repository.upsert.bind(repository);
    repository.upsert = async () => { throw new Error('fixture durable failure'); };
    await expect(new ItineraryEditService(sessions).apply('fixture-traveller', command)).rejects.toThrow('could not save');
    repository.upsert = originalUpsert;
    expect((await sessions.get('fixture-traveller'))?.itinerary?.days[1].hotel).toBe(current.itinerary?.days[1].hotel);
    repository.fail = true;
    await expect(new ItineraryWorkspaceService(store as any, sessions).getWorkspace('fixture-token')).rejects.toMatchObject({ status: 'failed' });
  });
  it('rejects invalid targets, unknown operations, wrong trip/day, and ambiguous free text', async () => {
    const { sessions, current } = await trip();
    const command = resolveItineraryEdit('change day 2 evening to a cultural walk', current)!;
    for (const invalid of [{ ...command, operation: 'book' }, { ...command, target: 'payment' }, { ...command, day: 14 }, { ...command, tripId: 'other' }]) {
      await expect(new ItineraryEditService(sessions).apply('fixture-traveller', invalid)).rejects.toThrow();
    }
    expect(resolveItineraryEdit('change hotel on day 2', current)).toBeNull();
    expect(resolveItineraryEdit('more beach time', { ...current, currentDay: undefined })).toBeNull();
  });
  it('rejects a stale background result after a reset and preserves rich session data on a criteria update', async () => {
    const store = new FixtureStateStore();
    const repository = new FixtureSessionRepository<HotelSearchSession>();
    const sessions = new HotelSearchSessionService(store as any, repository);
    const criteria = { location: 'Galle', checkinDate: '2026-11-01', checkoutDate: '2026-11-03', guests: 2 };
    await sessions.saveAwaitingPreferences('fixture', criteria, { originalMessage: 'Original request' });
    const original = (await sessions.get('fixture'))!;
    await sessions.applyCriteriaPatch('fixture', original.revision!, { guests: 3 });
    expect((await sessions.get('fixture'))?.originalMessage).toBe('Original request');
    await expect(sessions.applyCriteriaPatch('fixture', original.revision!, { guests: 4 })).rejects.toMatchObject({ status: 'conflict' });
    await sessions.clear('fixture');
    await expect(sessions.saveResults('fixture', criteria, [], 0, { id: original.id, revision: original.revision! })).rejects.toMatchObject({ status: 'conflict' });
    expect(await sessions.get('fixture')).toBeNull();
  });
});

describe('shared semantic UI validation', () => {
  const decision = { version: '1.0', mode: 'clarification_form', workflow: 'logistics', schemaId: 'search_transport', schemaVersion: '1.0',
    values: { pickupLocation: 'Colombo', destination: 'Galle' }, missingFields: ['pickupDate', 'passengers'], actions: ['submit_form'],
    expectedRevision: 2, correlationId: 'fixture-workflow', text: 'Please complete the remaining journey details.' };
  it('renders the same validated semantics for website and WhatsApp', () => {
    const whatsapp = renderWhatsAppDecision(decision), website = renderWebsiteDecision(decision);
    expect(website).toMatchObject(whatsapp);
    expect(website.initialValues.destination).toBe('Galle');
  });
  it.each([{ mode: 'arbitrary_component' }, { schemaId: 'execute_payment' }, { actions: ['charge'] }, { values: { passengers: 'two' } },
    { mode: 'confirmation', actions: ['confirm'], confirmedByBackend: false }, { mode: 'itinerary_editor', actions: ['edit_itinerary'] }])('rejects an unapproved decision %j', (invalid) => {
    expect(() => validateSemanticUI({ ...decision, ...invalid })).toThrow();
  });
  it('rejects stale workflow UI revisions', () => expect(() => validateSemanticUI(decision, 3)).toThrow('Stale'));
});
