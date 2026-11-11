import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { createInboundConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { ConversationControlPlane, initConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { JourneyEventCheckpointService } from './JourneyEventCheckpointService.js';
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { normalizeMetaWhatsAppInboundMessage } from '../utils/metaWhatsAppMessageNormalizer.js';
import { FormTokenService, initFormTokenService } from './formTokenService.js';
import { RestaurantSearchSessionService, initRestaurantSearchSessionService,
  type RestaurantSearchSession } from './restaurantSearchSessionService.js';
import { handleMetaRestaurantFlowSubmission } from './MetaRestaurantFlowSubmissionService.js';

const saveServiceRequest = vi.hoisted(() => vi.fn());
vi.mock('./profileService.js', () => ({ getProfileService: () => ({ saveServiceRequest }) }));

const userId = 'whatsapp:+94770000001';

function flowReply(token: string, id = 'wamid.meta.flow.1') {
  return normalizeMetaWhatsAppInboundMessage({ entry: [{ changes: [{ value: { messages: [{
    id, from: '94770000001', type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: {
      response_json: JSON.stringify({ flow_token: token, location: 'Galle', diningDate: '2026-12-01',
        diningTime: '19:00', guests: '2', priceRange: '$$', cuisine: 'Seafood' }),
    } },
  }] } }] }] });
}

describe('Meta Flow and WhatsApp journey continuity', () => {
  let sessions: RestaurantSearchSessionService;
  let tokens: FormTokenService;
  let control: ConversationControlPlane;
  beforeEach(async () => {
    vi.clearAllMocks();
    saveServiceRequest.mockResolvedValue({ id: 'restaurant-request-1' });
    sessions = initRestaurantSearchSessionService(new RestaurantSearchSessionService(
      new FixtureStateStore() as any, new FixtureSessionRepository<RestaurantSearchSession>()));
    await sessions.saveAwaitingPreferences(userId, { location: 'Galle' });
    tokens = initFormTokenService(new FormTokenService());
    const loader = new ActiveConversationStateLoader({
      loadHotel: async () => null, loadExcursion: async () => null,
      loadLogistics: async () => null, loadItinerary: async () => null,
      loadRestaurant: async (id) => {
        const session = await sessions.getAuthoritative(id);
        return session && { id: session.id, revision: session.revision,
          lifecycleStatus: session.lifecycleStatus, flow: 'restaurant', state: session.state,
          stage: session.stage, schema: 'search_restaurants', fields: session.criteria,
          requiredFields: ['location'], updatedAt: session.updatedAt };
      },
    });
    control = initConversationControlPlane(new ConversationControlPlane({ stateLoader: loader,
      checkpoints: new JourneyEventCheckpointService({ saveAccepted: async () => undefined,
        findByUserId: async () => null }, new FixtureStateStore() as any) }));
  });

  it('reconciles a bound Meta Flow and resumes the same workflow from WhatsApp', async () => {
    const before = (await sessions.getAuthoritative(userId))!;
    const token = tokens.createToken(userId, 'restaurant');
    tokens.bindRevision(token, 'restaurant', before.revision!, before.id);
    const result = await handleMetaRestaurantFlowSubmission(flowReply(token), 'corr-meta-flow');
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('dining preferences');
    expect(saveServiceRequest).toHaveBeenCalledOnce();
    const after = (await sessions.getAuthoritative(userId))!;
    expect(after).toMatchObject({ id: before.id, revision: before.revision! + 1,
      criteria: { location: 'Galle', diningDate: '2026-12-01', diningTime: '19:00',
        guests: 2, cuisine: 'Seafood' } });
    expect(tokens.resolveToken(token, 'restaurant')).toBeNull();

    const whatsapp = normalizeMetaWhatsAppInboundMessage({ entry: [{ changes: [{ value: {
      messages: [{ id: 'wamid.meta.return.2', from: '94770000001', type: 'text',
        text: { body: 'Continue my dining request' } }],
    } }] }] });
    const resumed = await control.acceptEvent(createInboundConversationEvent(whatsapp, 'corr-return'));
    expect(resumed).toMatchObject({ userId, workflowId: before.id,
      expectedStateVersion: after.revision, channel: 'whatsapp_meta' });
  });

  it('rejects a stale Flow revision before saving form fields', async () => {
    const before = (await sessions.getAuthoritative(userId))!;
    const token = tokens.createToken(userId, 'restaurant');
    tokens.bindRevision(token, 'restaurant', before.revision!, before.id);
    await sessions.saveAwaitingPreferences(userId, { location: 'Kandy' });
    const result = await handleMetaRestaurantFlowSubmission(flowReply(token), 'corr-stale-flow');
    expect(result.reply).toContain('out of date');
    expect(saveServiceRequest).not.toHaveBeenCalled();
    expect((await sessions.getAuthoritative(userId))?.criteria.location).toBe('Kandy');
  });

  it('rejects an accepted event from a different provider interaction', async () => {
    const current = (await sessions.getAuthoritative(userId))!;
    const token = tokens.createToken(userId, 'restaurant');
    tokens.bindRevision(token, 'restaurant', current.revision!, current.id);
    const message = flowReply(token, 'wamid.current');
    const mismatched = createInboundConversationEvent(flowReply(token, 'wamid.other'), 'corr-meta-flow');
    const result = await handleMetaRestaurantFlowSubmission(message, 'corr-meta-flow', mismatched);
    expect(result.reply).toContain('could not safely match');
    expect(saveServiceRequest).not.toHaveBeenCalled();
  });
});
