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
vi.mock('../services/WorkflowLockService.js', () => ({ withWorkflowLock: async (_user: string, operation: () => Promise<unknown>) => operation() }));
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { ItinerarySessionService, initItinerarySessionService } from '../services/itinerarySessionService.js';
import { HotelSearchSessionService, initHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { RestaurantSearchSessionService, initRestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import { ExcursionSearchSessionService, initExcursionSearchSessionService } from '../services/excursionSearchSessionService.js';
import { LogisticsSearchSessionService, initLogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
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

  it('rejects POST submissions without the form CSRF nonce', async () => {
    const token = tokenService.createToken('whatsapp:+94770000002', 'hotel');
    const response = await fetch(`${origin}/forms/hotel/${token}`, {
      method: 'POST',
      body: new URLSearchParams({ destination: 'Galle' }),
    });

    expect(response.status).toBe(403);
  });

  it('stores a hotel request, sends the WhatsApp confirmation, and renders a return link', async () => {
    const userId = 'whatsapp:+94770000005';
    const token = tokenService.createToken(userId, 'hotel');
    const csrf = extractCsrf(await (await fetch(`${origin}/forms/hotel/${token}`)).text());
    const response = await fetch(`${origin}/forms/hotel/${token}`, {
      method: 'POST',
      body: new URLSearchParams({
        _csrf: csrf,
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
