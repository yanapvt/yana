import { describe, expect, it } from 'vitest';
import type { HotelRequestForm } from '../types/forms.js';
import { mapHotelRequestFormToCriteria } from './hotelRequestMapper.js';

describe('mapHotelRequestFormToCriteria', () => {
  it('maps a structured hotel form into provider-ready hotel criteria', () => {
    const form: HotelRequestForm = {
      destination: 'Galle Fort',
      checkIn: '2026-06-12',
      checkOut: '2026-06-15',
      adults: 2,
      children: 1,
      childrenAges: '7',
      rooms: 1,
      budget: 'USD 180 per night',
      starRating: '5',
      mealPlan: 'B&B',
      hotelType: 'Boutique',
      facilities: 'Pool, spa',
      bedPreference: 'King',
      specialOccasion: 'Anniversary',
    };

    expect(mapHotelRequestFormToCriteria(form)).toEqual({
      location: 'Galle Fort',
      checkinDate: '2026-06-12',
      checkoutDate: '2026-06-15',
      guests: 3,
      rooms: 1,
      starRating: '5',
      hotelType: 'Boutique',
      facilities: 'Pool, spa',
      bedPreference: 'King',
      specialOccasion: 'Anniversary',
      boardBasis: 'bnb',
      budgetPerNight: {
        amount: 180,
        currency: 'USD',
      },
    });
  });

  it('keeps optional provider fields undefined when the form budget or meal plan is loose', () => {
    const form: HotelRequestForm = {
      destination: 'Colombo',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 1,
      children: 0,
      rooms: 1,
      budget: 'flexible',
      mealPlan: 'surprise me',
    };

    expect(mapHotelRequestFormToCriteria(form)).toEqual({
      location: 'Colombo',
      checkinDate: '2026-07-01',
      checkoutDate: '2026-07-03',
      guests: 1,
      rooms: 1,
      starRating: undefined,
      hotelType: undefined,
      facilities: undefined,
      bedPreference: undefined,
      specialOccasion: undefined,
      boardBasis: undefined,
      budgetPerNight: undefined,
    });
  });
});
