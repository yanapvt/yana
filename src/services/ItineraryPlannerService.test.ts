import { describe, expect, it } from 'vitest';
import { ItineraryPlannerService } from './ItineraryPlannerService.js';

describe('ItineraryPlannerService', () => {
  it('assigns beach interests to coastal stops instead of Ella', async () => {
    const itinerary = await new ItineraryPlannerService().plan({
      arrivalDate: '2026-07-14',
      departureDate: '2026-07-20',
      adults: 2,
      children: 1,
      budget: 'Budget Traveller',
      travelStyle: 'Mixed',
      preferredTransport: 'Mixed',
      interests: [
        'Historical Sites',
        'Wildlife',
        'Safari',
        'Nature',
        'Beaches',
        'Kids Activities',
        'Romantic Experiences',
        'Nightlife',
      ],
    });

    const ellaDays = itinerary.days.filter((day) => day.location === 'Ella');
    const coastalDays = itinerary.days.filter((day) => /Galle|Negombo/i.test(day.location));

    expect(ellaDays.every((day) => !day.experiences.includes('Beaches'))).toBe(true);
    expect(coastalDays.some((day) => day.experiences.includes('Beaches'))).toBe(true);
    expect(ellaDays.every((day) => /Tea Country|Hiking|Photography|Nature/.test(day.experiences.join(' ')))).toBe(true);
  });
});
