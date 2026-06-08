import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HotelIntakeService } from './HotelIntakeService.js';
import { getStateStore, closeStateStore } from './StateStore.js';

describe('HotelIntakeService', () => {
  const store = getStateStore();
  let service: HotelIntakeService;

  beforeAll(async () => {
    await store.connect();
  });

  beforeEach(async () => {
    service = new HotelIntakeService();
    await clearTraveler('+15550000001');
    await clearTraveler('+15550000002');
    await clearTraveler('+15550000003');
    await clearTraveler('+15550000004');
  });

  afterAll(async () => {
    await clearTraveler('+15550000001');
    await clearTraveler('+15550000002');
    await clearTraveler('+15550000003');
    await clearTraveler('+15550000004');
    await closeStateStore();
  });

  it('starts a hotel intake and asks for the first missing field', async () => {
    const result = await service.handleMessage('I need a hotel', {
      whatsappNumber: 'whatsapp:+15550000001',
      profileName: 'Test Traveler',
      country: 'Sri Lanka',
      countryCode: '+94',
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain('Where would you like to stay?');

    const state = await store.getJson<Record<string, unknown>>(
      'traveler:+15550000001:hotel-intake'
    );
    expect(state).toMatchObject({
      intent: 'search_hotels',
      pendingField: 'location',
    });
  });

  it('collects hotel criteria across turns and saves a provider-ready profile', async () => {
    const context = {
      whatsappNumber: 'whatsapp:+15550000002',
      profileName: 'Test Traveler',
      country: 'Sri Lanka',
      countryCode: '+94',
    };

    await service.handleMessage('I need a hotel in Galle', context);
    await service.handleMessage('2026-06-12', context);
    await service.handleMessage('2026-06-15', context);
    await service.handleMessage('2', context);
    const finalResult = await service.handleMessage('USD 120 per night with B&B', context);

    expect(finalResult.handled).toBe(true);
    expect(finalResult.completed).toBe(true);
    expect(finalResult.criteria).toMatchObject({
      location: 'Galle',
      checkinDate: '2026-06-12',
      checkoutDate: '2026-06-15',
      guests: 2,
      boardBasis: 'bnb',
      budgetPerNight: {
        amount: 120,
        currency: 'USD',
      },
    });
    expect(finalResult.reply).toContain('location Galle');
    expect(finalResult.reply).toContain('check-in 2026-06-12');
    expect(finalResult.reply).toContain('check-out 2026-06-15');
    expect(finalResult.reply).toContain('2 guests');
    expect(finalResult.reply).toContain('budget USD 120 per night');
    expect(finalResult.reply).toContain('ready to search live property matches');

    await expect(
      store.getJson('traveler:+15550000002:hotel-intake')
    ).resolves.toBeNull();

    const profile = await store.getJson<{
      hotelPreferences?: {
        location?: string;
        budgetPerNight?: { amount: number; currency: string };
      };
    }>('traveler:+15550000002:profile');
    expect(profile?.hotelPreferences).toMatchObject({
      location: 'Galle',
      budgetPerNight: {
        amount: 120,
        currency: 'USD',
      },
    });
  });

  it('keeps an active hotel intake even when follow-up messages are not hotel-like', async () => {
    const context = {
      whatsappNumber: 'whatsapp:+15550000003',
      profileName: 'Test Traveler',
      country: 'Sri Lanka',
      countryCode: '+94',
    };

    await service.handleMessage('I need a hotel', context);
    await service.handleMessage('Galle', context);
    await service.handleMessage('2026-06-12', context);
    await service.handleMessage('2026-06-15', context);
    await service.handleMessage('2 pax', context);
    const mealResult = await service.handleMessage('B&B', context);

    expect(mealResult.handled).toBe(true);
    expect(mealResult.reply).toContain('maximum budget per night');

    const finalResult = await service.handleMessage('USD 120 per night', context);

    expect(finalResult.handled).toBe(true);
    expect(finalResult.completed).toBe(true);
    expect(finalResult.criteria).toMatchObject({
      location: 'Galle',
      guests: 2,
      boardBasis: 'bnb',
      budgetPerNight: {
        amount: 120,
        currency: 'USD',
      },
    });
  });

  it('extracts a natural one-shot hotel browsing request without asking for known details', async () => {
    service = new HotelIntakeService(new Date('2026-05-21T12:00:00+05:30'));
    const result = await service.handleMessage(
      'looking for a hotel in colombo 03 under 50$ per night for two nights checking in tomorrow and checking out the day after traveling with my wife so just the two of us',
      {
        whatsappNumber: 'whatsapp:+15550000004',
        profileName: 'Test Traveler',
        country: 'Sri Lanka',
        countryCode: '+94',
      }
    );

    expect(result.handled).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.criteria).toMatchObject({
      location: 'Colombo 03',
      checkinDate: '2026-05-22',
      checkoutDate: '2026-05-23',
      guests: 2,
      budgetPerNight: {
        amount: 50,
        currency: 'USD',
      },
    });
  });

  async function clearTraveler(phoneNumber: string): Promise<void> {
    await store.deleteKey(`traveler:${phoneNumber}:hotel-intake`);
    await store.deleteKey(`traveler:${phoneNumber}:profile`);
  }
});
