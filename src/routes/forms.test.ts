import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { FormTokenService, initFormTokenService } from '../services/formTokenService.js';
import { ProfileService, initProfileService } from '../services/profileService.js';
import { initTwilioOutboundService, TwilioOutboundService } from '../services/twilioOutboundService.js';
import { initOpenWaOutboundService, OpenWaOutboundService } from '../services/OpenWaOutboundService.js';
import { InMemoryProfileRepository } from '../storage/profileRepository.js';
import { InMemoryServiceRequestRepository } from '../storage/serviceRequestRepository.js';

describe('external form routes', () => {
  let server: Server;
  let origin: string;
  let tokenService: FormTokenService;
  let profileService: ProfileService;
  let sendWhatsAppTextMock: ReturnType<typeof vi.fn>;

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
  });

  it('renders each supported form for a matching valid token', async () => {
    const formHeadings = {
      profile: 'Your travel profile',
      hotel: 'Hotel request',
      restaurant: 'Restaurant request',
      itinerary: 'Trip planning',
      logistics: 'Transport request',
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
      expect(html).toContain('name="_csrf"');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('validates and stores a sanitized profile, then consumes its token', async () => {
    const userId = 'whatsapp:+94770000001';
    const token = tokenService.createToken(userId, 'profile');
    const getResponse = await fetch(`${origin}/forms/profile/${token}`);
    const csrf = extractCsrf(await getResponse.text());
    const body = new URLSearchParams({
      _csrf: csrf,
      fullName: '<b>Jane Doe</b>',
      preferredName: 'Jane',
      email: 'JANE@example.com',
      phone: '+94770000001',
      preferredLanguage: 'English',
      nationality: 'Sri Lankan',
      countryOfResidence: 'Sri Lanka',
      city: 'Colombo',
      dateOfBirth: '1990-05-03',
      preferredCurrency: 'usd',
      travelStyle: 'Luxury',
      dietaryRestrictions: 'Vegetarian',
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
    expect(profile?.form.email).toBe('jane@example.com');
    expect(profile?.form.preferredCurrency).toBe('USD');
    expect(replayResponse.status).toBe(410);
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
      body: JSON.stringify({ selectedDay: 2, pendingChange: 'Move beach time earlier' }),
    });
    const state = await stateResponse.json();

    expect(stateResponse.status).toBe(200);
    expect(state.ok).toBe(true);
    expect(state.selectedDay).toBe(2);
    expect(state.pendingChanges).toContain('Move beach time earlier');
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
});

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error('CSRF token missing from rendered form');
  }
  return match[1];
}
