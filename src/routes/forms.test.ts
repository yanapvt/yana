import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FormTokenService, initFormTokenService } from '../services/formTokenService.js';
import { ProfileService, initProfileService } from '../services/profileService.js';
import { InMemoryProfileRepository } from '../storage/profileRepository.js';
import { InMemoryServiceRequestRepository } from '../storage/serviceRequestRepository.js';

describe('external form routes', () => {
  let server: Server;
  let origin: string;
  let tokenService: FormTokenService;
  let profileService: ProfileService;

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
  });

  it('renders each supported form for a matching valid token', async () => {
    const formHeadings = {
      profile: 'Your travel profile',
      hotel: 'Hotel request',
      restaurant: 'Restaurant request',
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
    expect(await postResponse.text()).toContain('Thank you');
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
