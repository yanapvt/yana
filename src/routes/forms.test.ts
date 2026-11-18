import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { FormTokenService, initFormTokenService } from '../services/formTokenService.js';
import { ProfileService, initProfileService } from '../services/profileService.js';
import { initTwilioOutboundService, TwilioOutboundService } from '../services/twilioOutboundService.js';
import { initOpenWaOutboundService, OpenWaOutboundService } from '../services/OpenWaOutboundService.js';
import {
  initMetaWhatsAppOutboundService,
  MetaWhatsAppOutboundService,
} from '../services/MetaWhatsAppOutboundService.js';
import { InMemoryProfileRepository } from '../storage/profileRepository.js';
import { InMemoryServiceRequestRepository } from '../storage/serviceRequestRepository.js';
import { env } from '../config/environment.js';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { getCanonicalMessageProcessor } from '../services/CanonicalMessageProcessor.js';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { Orchestrator } from '../orchestration/Orchestrator.js';
import { MemoryUpdater } from '../orchestration/MemoryUpdater.js';
import { createInboundConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
vi.mock('../services/JourneyEventCheckpointService.js', () => ({ JourneyEventCheckpointService: class {
  async accept() { return; }
  async recover() { return null; }
} }));
vi.mock('../services/WorkflowLockService.js', () => ({ withWorkflowLock: async (_user: string, operation: () => Promise<unknown>) => operation() }));
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { ItinerarySessionService, initItinerarySessionService } from '../services/itinerarySessionService.js';
import { HotelSearchSessionService, getHotelSearchSessionService, initHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { RestaurantSearchSessionService, initRestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import { ExcursionSearchSessionService, getExcursionSearchSessionService, initExcursionSearchSessionService } from '../services/excursionSearchSessionService.js';
import { LogisticsSearchSessionService, getLogisticsSearchSessionService, initLogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
import { ItineraryWorkspaceService, initItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';

describe('external form routes', () => {
  let server: Server;
  let origin: string;
  let tokenService: FormTokenService;
  let profileService: ProfileService;
  let sendWhatsAppTextMock: ReturnType<typeof vi.fn>;
  let hotelRepository: FixtureSessionRepository<any>;

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  beforeEach(() => {
    const store = new FixtureStateStore() as any;
    const itinerary = initItinerarySessionService(new ItinerarySessionService(store, new FixtureSessionRepository()));
    hotelRepository = new FixtureSessionRepository();
    initHotelSearchSessionService(new HotelSearchSessionService(store, hotelRepository));
    initRestaurantSearchSessionService(new RestaurantSearchSessionService(store, new FixtureSessionRepository()));
    initExcursionSearchSessionService(new ExcursionSearchSessionService(store, new FixtureSessionRepository()));
    initLogisticsSearchSessionService(new LogisticsSearchSessionService(store, new FixtureSessionRepository()));
    initItineraryWorkspaceService(new ItineraryWorkspaceService(store, itinerary));
    tokenService = initFormTokenService(new FormTokenService());
    profileService = initProfileService(
      new ProfileService(new InMemoryProfileRepository(), new InMemoryServiceRequestRepository())
    );
    process.env.TWILIO_WHATSAPP_NUMBER = '+14155238886';
    sendWhatsAppTextMock = vi.fn().mockResolvedValue(true);
    initTwilioOutboundService({
      sendWhatsAppText: sendWhatsAppTextMock,
      isConfigured: () => true,
    } as unknown as TwilioOutboundService);
    initOpenWaOutboundService({
      sendWhatsAppText: sendWhatsAppTextMock,
      isConfigured: () => true,
    } as unknown as OpenWaOutboundService);
    initMetaWhatsAppOutboundService({
      sendWhatsAppText: sendWhatsAppTextMock,
      isConfigured: () => true,
    } as unknown as MetaWhatsAppOutboundService);
    env.whatsapp.provider = 'twilio';
  });

  it('renders each supported form for a matching valid token', async () => {
    const formHeadings = {
      profile: 'Your travel profile',
      hotel: 'Hotel request',
      restaurant: 'Restaurant request',
      itinerary: 'Trip planning',
      excursion: 'Excursion request',
      excursion_booking: 'Excursion booking request',
      logistics: 'Transport request',
      logistics_booking: 'Transport booking request',
    } as const;

    for (const [type, heading] of Object.entries(formHeadings)) {
      const token = tokenService.createToken(
        'whatsapp:+94770000000',
        type as keyof typeof formHeadings
      );
      const response = await fetch(`${origin}/forms/${type}/${token}`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain(heading);
      expect(html).toContain('src="/assets/yana-logo.png"');
      expect(html).toContain('YANA — Your AI Navigation Agent');
      expect(html).toContain('name="_csrf"');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('serves the shared YANA logo used by every form', async () => {
    const response = await fetch(`${origin}/assets/yana-logo.png`);
    const bytes = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(bytes.byteLength).toBeGreaterThan(100_000);
  });

  it('binds website chat to the token owner and sends text into the canonical processor', async () => {
    const userId = 'whatsapp:+94770000042';
    const token = tokenService.createToken(userId, 'profile');
    const csrfResponse = await fetch(`${origin}/forms/profile/${token}/chat`);
    const { csrf } = await csrfResponse.json() as { csrf: string };
    const process = vi.spyOn(getCanonicalMessageProcessor(), 'process').mockResolvedValue({
      inboundMessage: { from: userId }, reply: 'I can help with your trip.',
    } as never);
    try {
      const response = await fetch(`${origin}/forms/profile/${token}/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Let us plan the trip', _csrf: csrf,
          userId: 'whatsapp:+10000000000', workflowId: 'forged' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ reply: 'I can help with your trip.' });
      expect(process).toHaveBeenCalledWith(expect.objectContaining({
        userId, channel: 'website_ui', eventType: 'text',
        payload: { content: { type: 'text', body: 'Let us plan the trip' } },
      }), expect.any(Function));
      const replay = await fetch(`${origin}/forms/profile/${token}/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Let us plan the trip', _csrf: csrf }),
      });
      expect(replay.status).toBe(403);
      expect(process).toHaveBeenCalledTimes(1);
    } finally { process.mockRestore(); }
  });

  it('validates and stores a sanitized profile, then consumes its token', async () => {
    const userId = 'whatsapp:+94770000001';
    const token = tokenService.createToken(userId, 'profile');
    const getResponse = await fetch(`${origin}/forms/profile/${token}`);
    const csrf = extractCsrf(await getResponse.text());
    const body = new URLSearchParams({
      _csrf: csrf,
      fullName: '<b>Jane Doe</b>',
      email: 'JANE@example.com',
      preferredLanguage: 'English',
      nationality: 'Sri Lankan',
      dateOfBirth: '1990-05-03',
      travelStyle: 'Luxury',
      accessibilityNeeds: '',
      consent: 'on',
    });

    const postResponse = await fetch(`${origin}/forms/profile/${token}`, {
      method: 'POST',
      body,
    });
    const profile = await profileService.getProfile(userId);
    const replayResponse = await fetch(`${origin}/forms/profile/${token}`);

    expect(postResponse.status).toBe(200);
    const html = await postResponse.text();
    expect(html).toContain('Thank you');
    expect(html).toContain('https://wa.me/14155238886');
    expect(html).not.toContain('?text=done');
    expect(html).toContain('I have also sent the next message to your WhatsApp chat.');
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('Hi Jane, I am Yana')
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('I am back with you here on WhatsApp now')
    );
    expect(profile?.form.fullName).toBe('Jane Doe');
    expect(profile?.form.preferredName).toBe('Jane');
    expect(profile?.form.phone).toBe('+94770000001');
    expect(profile?.form.countryOfResidence).toBe('Sri Lanka');
    expect(profile?.form.email).toBe('jane@example.com');
    expect(profile?.form.preferredCurrency).toBe('LKR');
    expect(profile?.form.dietaryRestrictions).toBeUndefined();
    expect(replayResponse.status).toBe(410);
  });

  it('does not ask for values already known from WhatsApp or collected during service searches', async () => {
    const token = tokenService.createToken('whatsapp:+94770000003', 'profile');
    const response = await fetch(`${origin}/forms/profile/${token}`);
    const html = await response.text();

    expect(html).not.toContain('Preferred Name');
    expect(html).not.toContain('>Phone<');
    expect(html).not.toContain('Country of Residence');
    expect(html).not.toContain('>City<');
    expect(html).not.toContain('Preferred Currency');
    expect(html).not.toContain('Dietary Restrictions');
  });

  it.each([
    ['excursion_booking', { preferredDate: '2026-12-01', preferredTime: '09:00',
      pickupLocation: 'Galle', guests: '2', guestNames: 'Alex and Sam', contactNumber: '+94770000000' }],
    ['logistics_booking', { passengerName: 'Alex', phoneNumber: '+94770000000', pickupContact: 'Sam' }],
  ] as const)('rejects a %s form when no result was selected', async (type, fields) => {
    const userId = 'whatsapp:+94770000072';
    const token = tokenService.createToken(userId, type);
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/${type}/${token}`)).text());

    const response = await fetch(`${origin}/forms/${type}/${token}`, {
      method: 'POST', body: new URLSearchParams({ ...fields, _csrf: csrf }),
    });

    expect(response.status).toBe(409);
    expect(await profileService.getLatestServiceRequest(userId, type)).toBeNull();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
  });

  it('submits an excursion booking request through its selected workflow session', async () => {
    const userId = 'whatsapp:+94770000073';
    const sessions = getExcursionSearchSessionService();
    await sessions.saveResults(userId, { destination: 'Galle', guests: 2 },
      [{ id: 'experience-1', name: 'Coastal walk' }], 1);
    await sessions.selectExperience(userId, 1);
    const token = tokenService.createToken(userId, 'excursion_booking');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/excursion_booking/${token}`)).text());

    const response = await fetch(`${origin}/forms/excursion_booking/${token}`, {
      method: 'POST', body: new URLSearchParams({ _csrf: csrf, preferredDate: '2026-12-01',
        preferredTime: '09:00', pickupLocation: 'Galle', guests: '2',
        guestNames: 'Alex and Sam', contactNumber: '+94770000000' }),
    });

    expect(response.status).toBe(200);
    expect(await sessions.getAuthoritative(userId)).toMatchObject({
      stage: 'provider_pending', bookingRequest: { experience: { name: 'Coastal walk' },
        status: 'pending_provider_confirmation' },
    });
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(userId,
      expect.stringContaining('YANA has not contacted the provider yet'));
  });

  it('submits a transport booking request through its selected workflow session', async () => {
    const userId = 'whatsapp:+94770000074';
    const sessions = getLogisticsSearchSessionService();
    await sessions.saveResults(userId, { pickupLocation: 'Airport', destination: 'Galle' }, [{
      id: 'driver-1', provider: 'Driver request', vehicle: 'Car', estimatedPrice: 'Quote required',
      vehicleType: 'Car', capacity: 3, luggageCapacity: '2 bags', estimatedDuration: '2 hours',
    }], 1);
    await sessions.selectOption(userId, 1);
    const token = tokenService.createToken(userId, 'logistics_booking');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/logistics_booking/${token}`)).text());

    const response = await fetch(`${origin}/forms/logistics_booking/${token}`, {
      method: 'POST', body: new URLSearchParams({ _csrf: csrf,
        passengerName: 'Alex', phoneNumber: '+94770000000', pickupContact: 'Sam' }),
    });

    expect(response.status).toBe(200);
    expect(await sessions.getAuthoritative(userId)).toMatchObject({
      stage: 'provider_pending', bookingRequest: { provider: 'Driver request',
        status: 'pending_provider_confirmation' },
    });
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(userId,
      expect.stringContaining('No vehicle, availability, or price is confirmed'));
  });

  it('continues a WhatsApp search in the UI, then reflects a natural-language change back in the editor', async () => {
    const userId = 'whatsapp:+94770000031';
    const sessions = getHotelSearchSessionService();
    const originalCriteria = { location: 'Galle', checkinDate: '2026-12-01', checkoutDate: '2026-12-08', guests: 2, rooms: 1 };
    await sessions.saveAwaitingPreferences(userId, originalCriteria);
    const original = (await sessions.getAuthoritative(userId))!;
    hotelRepository.records.set(userId, { ...original,
      results: [{ name: 'Previous hotel' }], resultBatches: [[{ name: 'Previous hotel' }]],
      latestDisplayedBatchIndex: 0, selectedHotel: { selectedHotelId: 'hotel-1' } } as any);
    const saveSearching = vi.spyOn(sessions, 'saveSearching');
    const accepted = vi.spyOn(getConversationControlPlane(), 'acceptEvent');
    const token = tokenService.createToken(userId, 'hotel');
    const formHtml = await (await fetch(`${origin}/forms/hotel/${token}`)).text();
    expect(formHtml).toContain(`/forms/hotel/${token}/editor`);
    const browserPage = await fetch(`${origin}/forms/hotel/${token}/editor`);
    const browserHtml = await browserPage.text();
    expect(browserPage.status).toBe(200);
    expect(browserHtml).toContain('name="action" value="update_draft"');
    expect(browserHtml).toContain('name="expectedRevision"');
    expect(browserHtml).toContain('Save draft');
    const get = await fetch(`${origin}/forms/hotel/${token}/editor`, { headers: { Accept: 'application/json' } });
    const editor = await get.json() as any;
    expect(get.status).toBe(200);
    expect(editor).toMatchObject({ mode: 'search_editor', workflowId: original.id,
      expectedRevision: original.revision, actions: ['update_draft'],
      values: originalCriteria });

    const changed = await fetch(`${origin}/forms/hotel/${token}/editor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'update_draft', _csrf: editor.csrf,
        expectedRevision: editor.expectedRevision, fields: { location: 'Unawatuna' },
        userId: 'whatsapp:+19999999999', workflowId: 'client-workflow' }),
    });
    const saved = await changed.json() as any;
    expect(changed.status).toBe(200);
    expect(saved.view).toMatchObject({ workflowId: original.id, expectedRevision: original.revision! + 1,
      values: { location: 'Unawatuna', checkinDate: '2026-12-01', checkoutDate: '2026-12-08', guests: 2 } });
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ channel: 'website_ui', eventType: 'ui_action',
      userId, workflowId: original.id, expectedStateVersion: original.revision,
      payload: { action: 'update_draft', fields: { location: 'Unawatuna' }, schemaId: 'search_hotels' } }));
    const afterUi = (await sessions.getAuthoritative(userId))!;
    expect(afterUi.criteria).toMatchObject({ ...originalCriteria, location: 'Unawatuna' });
    expect(afterUi.results).toHaveLength(1);
    expect(afterUi.selectedHotel).toMatchObject({ selectedHotelId: 'hotel-1' });
    expect((await new ActiveConversationStateLoader().load(userId))?.verifiedResults).toBeUndefined();
    expect(saveSearching).not.toHaveBeenCalled();

    const inbound = normalizeInboundMessage({ MessageSid: 'SM-after-editor', From: userId,
      To: 'whatsapp:+14155238886', Body: 'Could we move check-in to 2026-12-05?' });
    const whatsapp = await getConversationControlPlane().acceptEvent(createInboundConversationEvent(inbound, 'corr-after-editor'));
    expect(whatsapp).toMatchObject({ userId, workflowId: original.id,
      sessionId: expect.any(String), conversationId: expect.any(String) });
    const active = await new ActiveConversationStateLoader().load(userId);
    const plan = await new Orchestrator({ llmInterpreter: { interpret: async () => ({
      role: 'change_existing_criteria', intent: 'hotel_search', entities: { checkinDate: '2026-12-05' },
      confidence: 0.96, taskTransition: 'continue', proposedAction: { name: 'none', arguments: {} },
      responseText: 'I can update your check-in date.',
    }) } }).plan({ inboundMessage: inbound, text: inbound.content.type === 'text' ? inbound.content.body : '',
      profileComplete: true, activeSession: active ?? undefined });
    expect(plan.decision.action).toBe('continue_flow');
    expect((await new MemoryUpdater().persistUpdate(plan.context, plan.memoryUpdate)).status).toBe('durable');
    const afterConversation = (await sessions.getAuthoritative(userId))!;
    expect(afterConversation.id).toBe(original.id);
    expect(afterConversation.criteria).toMatchObject({ location: 'Unawatuna', checkinDate: '2026-12-05',
      checkoutDate: '2026-12-08', guests: 2, rooms: 1 });
    expect(afterConversation.results).toHaveLength(1);
    expect(saveSearching).not.toHaveBeenCalled();

    expect((await fetch(`${origin}${saved.editorUrl}`, { headers: { Accept: 'application/json' } })).status).toBe(409);
    const freshToken = tokenService.createToken(userId, 'hotel');
    const fresh = await (await fetch(`${origin}/forms/hotel/${freshToken}/editor`,
      { headers: { Accept: 'application/json' } })).json() as any;
    expect(fresh).toMatchObject({ workflowId: original.id, expectedRevision: afterConversation.revision,
      values: { location: 'Unawatuna', checkinDate: '2026-12-05', checkoutDate: '2026-12-08', guests: 2 } });
    expect((await fetch(`${origin}/forms/hotel/${token}/editor`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'update_draft', _csrf: editor.csrf,
        expectedRevision: editor.expectedRevision, fields: { location: 'Colombo' } }) })).status).toBe(409);
    expect((await sessions.getAuthoritative(userId))?.criteria.location).toBe('Unawatuna');
    accepted.mockRestore();
    saveSearching.mockRestore();
  });

  it('keeps one workflow when the UI changes guests and WhatsApp changes location', async () => {
    const userId = 'whatsapp:+94770000032';
    const sessions = getHotelSearchSessionService();
    const originalCriteria = { location: 'Galle', checkinDate: '2026-12-01',
      checkoutDate: '2026-12-08', guests: 2, rooms: 1 };
    await sessions.saveAwaitingPreferences(userId, originalCriteria);
    const original = (await sessions.getAuthoritative(userId))!;
    const search = vi.spyOn(sessions, 'saveSearching');
    const token = tokenService.createToken(userId, 'hotel');
    const editor = await (await fetch(`${origin}/forms/hotel/${token}/editor`,
      { headers: { Accept: 'application/json' } })).json() as any;
    const ui = await fetch(`${origin}/forms/hotel/${token}/editor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'update_draft', _csrf: editor.csrf,
        expectedRevision: editor.expectedRevision, fields: { guests: 3 } }),
    });
    expect(ui.status).toBe(200);
    expect((await sessions.getAuthoritative(userId))?.criteria).toMatchObject({ ...originalCriteria, guests: 3 });

    const inbound = normalizeInboundMessage({ MessageSid: 'SM-location-after-ui', From: userId,
      To: 'whatsapp:+14155238886', Body: 'Somewhere closer to the beach in Unawatuna' });
    await getConversationControlPlane().acceptEvent(createInboundConversationEvent(inbound, 'corr-location-after-ui'));
    const active = await new ActiveConversationStateLoader().load(userId);
    const interpret = vi.fn().mockResolvedValue({ role: 'change_existing_criteria',
      intent: 'hotel_search', entities: { location: 'Unawatuna' }, confidence: 0.97,
      taskTransition: 'continue', proposedAction: { name: 'none', arguments: {} },
      responseText: 'I can look around Unawatuna.' });
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan({
      inboundMessage: inbound, text: 'Somewhere closer to the beach in Unawatuna',
      profileComplete: true, activeSession: active ?? undefined });
    expect(plan.decision.action).toBe('continue_flow');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect((await new MemoryUpdater().persistUpdate(plan.context, plan.memoryUpdate)).status).toBe('durable');
    const final = (await sessions.getAuthoritative(userId))!;
    expect(final.id).toBe(original.id);
    expect(final.revision).toBeGreaterThan(original.revision ?? 0);
    expect(final.criteria).toMatchObject({ ...originalCriteria, location: 'Unawatuna', guests: 3 });
    expect(search).not.toHaveBeenCalled();
    search.mockRestore();
  });

  it('applies a transcribed WhatsApp voice date correction to the same saved workflow', async () => {
    const userId = 'whatsapp:+94770000033';
    const sessions = getHotelSearchSessionService();
    await sessions.saveAwaitingPreferences(userId, { location: 'Galle',
      checkinDate: '2026-12-01', checkoutDate: '2026-12-08', guests: 2 });
    const original = (await sessions.getAuthoritative(userId))!;
    const voice = { ...normalizeInboundMessage({ MessageSid: 'SM-voice-date', From: userId,
      To: 'whatsapp:+14155238886', Body: '' }),
      inputType: 'voice' as const, content: { type: 'text' as const,
        body: 'Could we move check-in to 2026-12-03?' } };
    const accepted = await getConversationControlPlane().acceptEvent(
      createInboundConversationEvent(voice, 'corr-voice-date'));
    expect(accepted).toMatchObject({ userId, workflowId: original.id, eventType: 'audio' });
    const active = await new ActiveConversationStateLoader().load(userId);
    const interpret = vi.fn().mockResolvedValue({ role: 'change_existing_criteria',
      intent: 'hotel_search', entities: { checkinDate: '2026-12-03' }, confidence: 0.97,
      taskTransition: 'continue', proposedAction: { name: 'none', arguments: {} },
      responseText: 'I can move check-in to 3 December.' });
    const plan = await new Orchestrator({ llmInterpreter: { interpret } }).plan({
      inboundMessage: voice, text: voice.content.body, profileComplete: true,
      activeSession: active ?? undefined });
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(plan.decision.action).toBe('continue_flow');
    expect((await new MemoryUpdater().persistUpdate(plan.context, plan.memoryUpdate)).status).toBe('durable');
    const updated = (await sessions.getAuthoritative(userId))!;
    expect(updated.id).toBe(original.id);
    expect(updated.criteria).toMatchObject({ location: 'Galle', checkinDate: '2026-12-03',
      checkoutDate: '2026-12-08', guests: 2 });
  });

  it('rejects POST submissions without the form CSRF nonce', async () => {
    const token = tokenService.createToken('whatsapp:+94770000002', 'hotel');
    const response = await fetch(`${origin}/forms/hotel/${token}`, {
      method: 'POST',
      body: new URLSearchParams({ destination: 'Galle' }),
    });

    expect(response.status).toBe(403);
  });

  it('stores a hotel request, sends the WhatsApp confirmation, and renders a return link', async () => {
    const accepted = vi.spyOn(getConversationControlPlane(), 'acceptEvent');
    const userId = 'whatsapp:+94770000005';
    const token = tokenService.createToken(userId, 'hotel');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/hotel/${token}`)).text());
    const response = await fetch(`${origin}/forms/hotel/${token}`, {
      method: 'POST',
      body: new URLSearchParams({
        _csrf: csrf,
        userId: 'whatsapp:+19999999999',
        sessionId: 'client-session',
        workflowId: 'client-workflow',
        destination: 'Galle Fort',
        checkIn: '2026-07-10',
        checkOut: '2026-07-12',
        adults: '2',
        children: '0',
        rooms: '1',
        budget: 'USD 180 per night',
        starRating: '5 star',
        mealPlan: 'Breakfast included',
        hotelType: 'Boutique',
        facilities: 'Pool, sea view',
        bedPreference: 'King',
        specialOccasion: '',
      }),
    });
    const html = await response.text();
    const requests = await profileService.getServiceRequests(userId, 'hotel');

    expect(response.status).toBe(200);
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'website_form', eventType: 'form_submission', userId,
      sourceEventId: expect.any(String), correlationId: response.headers.get('x-correlation-id'),
    }));
    expect(accepted.mock.calls.at(-1)?.[0]).not.toMatchObject({ workflowId: 'client-workflow', sessionId: 'client-session' });
    expect(html).toContain('https://wa.me/14155238886');
    expect(html).not.toContain('?text=done');
    expect(requests).toHaveLength(1);
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('Destination: Galle Fort')
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('Reply with your preferences')
    );
    const startedInUi = await getHotelSearchSessionService().getAuthoritative(userId);
    expect(startedInUi?.id).toBeTruthy();
    const returnMessage = normalizeInboundMessage({ MessageSid: 'SM-return-from-hotel-form', From: userId,
      To: 'whatsapp:+14155238886', Body: 'Continue my stay search' });
    const returnEvent = await getConversationControlPlane().acceptEvent(
      createInboundConversationEvent(returnMessage, 'corr-return-from-form'));
    expect(returnEvent).toMatchObject({ userId, workflowId: startedInUi?.id,
      sessionId: expect.any(String), conversationId: expect.any(String) });
    accepted.mockRestore();
  });

  it('submits an itinerary form and immediately sends the generated trip plan', async () => {
    const userId = 'whatsapp:+94770000006';
    const token = tokenService.createToken(userId, 'itinerary');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/itinerary/${token}`)).text());
    const body = new URLSearchParams({
      _csrf: csrf,
      arrivalDate: '2026-07-10',
      arrivalTime: '09:00',
      departureDate: '2026-07-14',
      departureTime: '21:00',
      adults: '2',
      children: '0',
      budget: 'Comfort',
      accommodationStyle: 'Boutique',
      travelStyle: 'Mixed',
      preferredTransport: 'Private Driver',
      walkingPreference: 'Moderate',
      specialRequirements: 'avoid long drives',
    });
    body.append('interests', 'Historical Sites');
    body.append('interests', 'Wildlife');
    body.append('interests', 'Tea Country');

    const response = await fetch(`${origin}/forms/itinerary/${token}`, {
      method: 'POST',
      body,
    });
    const html = await response.text();
    const requests = await profileService.getServiceRequests(userId, 'itinerary');

    expect(response.status).toBe(200);
    expect(html).toContain('https://wa.me/14155238886');
    expect(requests).toHaveLength(1);
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('I will start planning your route now')
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('Wonderful, I have prepared your itinerary')
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('Route:')
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      userId,
      expect.stringContaining('Open your interactive itinerary:')
    );
    expect(sendWhatsAppTextMock).not.toHaveBeenCalledWith(
      userId,
      expect.stringContaining('type "no"')
    );

    const itineraryMessage = sendWhatsAppTextMock.mock.calls
      .map((call) => String(call[1]))
      .find((message) => message.includes('Open your interactive itinerary:'));
    const workspacePath = itineraryMessage?.match(/\/itinerary\/([A-Za-z0-9_-]+)/)?.[0];
    expect(workspacePath).toBeTruthy();

    const workspaceResponse = await fetch(`${origin}${workspacePath}`);
    const workspaceHtml = await workspaceResponse.text();

    expect(workspaceResponse.status).toBe(200);
    expect(workspaceHtml).toContain('Interactive Itinerary Workspace');
    expect(workspaceHtml).toMatch(/Route preview|google\.com\/maps\/embed\/v1\/directions/);
    expect(workspaceHtml).toContain('Replace Hotel');
    expect(workspaceHtml).toContain('Find Another Restaurant');

    const stateResponse = await fetch(`${origin}${workspacePath}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedDay: 2, expectedRevision: Number(workspaceHtml.match(/expectedRevision: (\d+)/)?.[1]),
        _formToken: workspaceHtml.match(/_formToken: "([^"]+)"/)?.[1], _csrf: workspaceHtml.match(/_csrf: "([^"]+)"/)?.[1] }),
    });
    const state = await stateResponse.json();

    expect(stateResponse.status).toBe(200);
    expect(state.ok).toBe(true);
    expect(state.selectedDay).toBe(2);
    expect(state.pendingChanges).toEqual([]);
    const editingHtml = await (await fetch(`${origin}${workspacePath}`)).text();
    const staleHtml = await (await fetch(`${origin}${workspacePath}`)).text();
    expect((await fetch(`${origin}${workspacePath}/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pendingChange: 'change day 2 afternoon to an unauthorized update' }) })).status).toBe(403);
    const editResponse = await fetch(`${origin}${workspacePath}/edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingChange: 'change day 2 afternoon to a quiet beach visit', expectedRevision: Number(editingHtml.match(/expectedRevision: (\d+)/)?.[1]),
        _formToken: editingHtml.match(/_formToken: "([^"]+)"/)?.[1], _csrf: editingHtml.match(/_csrf: "([^"]+)"/)?.[1] }),
    });
    expect(editResponse.status).toBe(200);
    const sessions = (await import('../services/itinerarySessionService.js')).getItinerarySessionService();
    expect((await sessions.getAuthoritative(userId))?.itinerary?.days[1].afternoon).toBe('a quiet beach visit');
    expect(await (await fetch(`${origin}${workspacePath}`)).text()).toContain('a quiet beach visit');
    const staleResponse = await fetch(`${origin}${workspacePath}/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingChange: 'change day 2 afternoon to a stale replacement', expectedRevision: Number(staleHtml.match(/expectedRevision: (\d+)/)?.[1]),
        _formToken: staleHtml.match(/_formToken: "([^"]+)"/)?.[1], _csrf: staleHtml.match(/_csrf: "([^"]+)"/)?.[1] }) });
    expect(staleResponse.status).toBe(409);
    expect((await sessions.getAuthoritative(userId))?.itinerary?.days[1].afternoon).toBe('a quiet beach visit');
  });

  it('does not show success or notify after a durable workflow write fails, and retries without duplicating the saved request', async () => {
    const user = 'whatsapp:+94770000009';
    const token = tokenService.createToken(user, 'hotel');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/hotel/${token}`)).text());
    const form = { destination: 'Galle', checkIn: '2026-11-01', checkOut: '2026-11-03', adults: '2', children: '0', rooms: '1', budget: 'USD 100' };
    const save = hotelRepository.upsert.bind(hotelRepository);
    hotelRepository.upsert = async () => { throw new Error('private durable failure'); };
    const failed = await fetch(`${origin}/forms/hotel/${token}`, { method: 'POST', body: new URLSearchParams({ ...form, _csrf: csrf }) });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('private durable failure');
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(await profileService.getServiceRequests(user, 'hotel')).toHaveLength(1);
    hotelRepository.upsert = save;
    const retryCsrf = extractCsrf(await (await fetch(`${origin}/forms/hotel/${token}`)).text());
    const succeeded = await fetch(`${origin}/forms/hotel/${token}`, { method: 'POST', body: new URLSearchParams({ ...form, _csrf: retryCsrf }) });
    expect(succeeded.status).toBe(200);
    expect(await profileService.getServiceRequests(user, 'hotel')).toHaveLength(1);
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale form before saving a request or sending a completion message', async () => {
    const user = 'whatsapp:+94770000010';
    const token = tokenService.createToken(user, 'hotel');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/hotel/${token}`)).text());
    const sessions = (await import('../services/hotelSearchSessionService.js')).getHotelSearchSessionService();
    await sessions.saveAwaitingPreferences(user, { location: 'Kandy' });
    const response = await fetch(`${origin}/forms/hotel/${token}`, { method: 'POST', body: new URLSearchParams({
      _csrf: csrf, destination: 'Galle', checkIn: '2026-11-01', checkOut: '2026-11-03', adults: '2', children: '0', rooms: '1', budget: 'USD 100',
    }) });
    expect(response.status).toBe(409);
    expect(await profileService.getServiceRequests(user, 'hotel')).toHaveLength(0);
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect((await sessions.get(user))?.criteria.location).toBe('Kandy');
  });

  it('expires form links and stores a validated service request submission', async () => {
    const expiredToken = tokenService.createToken('whatsapp:+94770000003', 'restaurant', {
      ttlMinutes: -1,
    });
    const expiredResponse = await fetch(`${origin}/forms/restaurant/${expiredToken}`);

    const userId = 'whatsapp:+94770000004';
    const token = tokenService.createToken(userId, 'logistics');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/logistics/${token}`)).text());
    const response = await fetch(`${origin}/forms/logistics/${token}`, {
      method: 'POST',
      body: new URLSearchParams({
        _csrf: csrf,
        pickupLocation: '<b>Airport</b>',
        dropOffLocation: 'Galle Fort',
        date: '2026-06-10',
        time: '09:30',
        passengers: '2',
        luggageCount: '3',
        vehicleType: 'Van',
        flightNumber: 'UL101',
        childSeat: 'on',
        budget: 'USD 120',
      }),
    });
    const requests = await profileService.getServiceRequests(userId, 'logistics');

    expect(expiredResponse.status).toBe(410);
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0].form).toMatchObject({
      pickupLocation: 'Airport',
      passengers: 2,
      childSeat: true,
    });
  });

  it('rejects logistics requests missing the date or destination needed to request a quote', async () => {
    const userId = 'whatsapp:+94770000031';
    const token = tokenService.createToken(userId, 'logistics');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/logistics/${token}`)).text());
    const response = await fetch(`${origin}/forms/logistics/${token}`, {
      method: 'POST',
      body: new URLSearchParams({
        _csrf: csrf,
        pickupLocation: 'Airport',
        passengers: '2',
      }),
    });

    expect(response.status).toBe(400);
    expect(await profileService.getServiceRequests(userId, 'logistics')).toHaveLength(0);
  });

  it('sends form completion messages through Meta when Meta is the selected provider', async () => {
    env.whatsapp.provider = 'meta';
    const token = tokenService.createToken('whatsapp:+94770000012', 'hotel');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/hotel/${token}`)).text());

    const response = await fetch(`${origin}/forms/hotel/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: csrf,
        destination: 'Kandy',
        checkIn: '2026-08-20',
        checkOut: '2026-08-22',
        adults: '2',
        children: '0',
        rooms: '1',
        budget: 'Comfort',
        mealPlan: 'Breakfast included',
      }),
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Return to WhatsApp');
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      'whatsapp:+94770000012',
      expect.stringContaining("I've gathered the following details")
    );
  });
});

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error('CSRF token missing from rendered form');
  }
  return match[1];
}
