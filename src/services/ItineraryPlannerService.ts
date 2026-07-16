import type { ExcursionSearchCriteria } from './excursionRequestMapper.js';
import type { HotelSearchCriteria } from './HotelIntakeService.js';
import type { LogisticsSearchCriteria } from './logisticsRequestMapper.js';
import type { RestaurantSearchCriteria } from './restaurantRequestMapper.js';
import type { ItineraryCriteria } from './itineraryRequestMapper.js';

export interface GeneratedItinerary {
  overview: string;
  mapSummary: string;
  budgetEstimate: string;
  weatherNotes: string;
  orchestration: ItineraryOrchestrationPlan;
  days: DailyItineraryPlan[];
}

export interface DailyItineraryPlan {
  day: number;
  date: string;
  location: string;
  morning: string;
  afternoon: string;
  evening: string;
  hotel: string;
  restaurantSuggestions: string[];
  experiences: string[];
  transport: string;
  estimatedTravelTime: string;
  approximateCost: string;
  placeSuggestions?: ItineraryPlaceSuggestion[];
}

export interface ItineraryPlaceSuggestion {
  title: string;
  description: string;
  category: string;
  mapUrl: string;
  imageUrl: string;
}

export interface ItineraryOrchestrationPlan {
  hotels: HotelSearchCriteria[];
  restaurants: RestaurantSearchCriteria[];
  excursions: ExcursionSearchCriteria[];
  logistics: LogisticsSearchCriteria[];
}

export class ItineraryPlannerService {
  async plan(criteria: ItineraryCriteria): Promise<GeneratedItinerary> {
    const dates = buildTravelDates(criteria.arrivalDate, criteria.departureDate);
    const route = buildRoute(criteria, dates.length);
    const interestGroups = assignInterestsToStops(criteria.interests, route);
    const days = dates.map((date, index) =>
      buildDailyPlan(index + 1, date, route[index], criteria, interestGroups[index] ?? [])
    );

    return {
      overview: buildOverview(criteria, days),
      mapSummary: buildMapSummary(criteria, route),
      budgetEstimate: buildBudgetEstimate(criteria, days.length),
      weatherNotes: 'Weather should be checked close to travel dates; the route keeps indoor and flexible options available where possible.',
      orchestration: buildOrchestration(criteria, days),
      days,
    };
  }
}

export function getItineraryPlannerService(): ItineraryPlannerService {
  if (!itineraryPlannerServiceInstance) {
    itineraryPlannerServiceInstance = new ItineraryPlannerService();
  }
  return itineraryPlannerServiceInstance;
}

let itineraryPlannerServiceInstance: ItineraryPlannerService | null = null;

function buildTravelDates(arrivalDate?: string, departureDate?: string): string[] {
  if (!arrivalDate || !departureDate) return ['Day 1'];

  const start = new Date(`${arrivalDate}T00:00:00.000Z`);
  const end = new Date(`${departureDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [arrivalDate];
  }

  const dates: string[] = [];
  for (const date = new Date(start); date <= end && dates.length < 14; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function buildRoute(criteria: ItineraryCriteria, dayCount: number): string[] {
  const interests = (criteria.interests ?? []).join(' ').toLowerCase();
  const route = ['Negombo'];

  if (/culture|temple|unesco|historical|museum|kids|family/.test(interests)) {
    route.push('Sigiriya', 'Kandy');
  }

  if (/tea|train|hiking|nature|photography|adventure/.test(interests)) {
    route.push('Ella');
  }

  if (/wildlife|safari|elephant|leopard|nature/.test(interests)) {
    route.push('Yala');
  }

  if (/beach|surf|snork|diving|whale|romantic/.test(interests)) {
    route.push('Galle');
  }

  if (/nightlife|shopping|markets|food/.test(interests)) {
    route.push('Colombo');
  }

  route.push('Negombo');

  const uniqueRoute = route.filter((location, index) => index === 0 || location !== route[index - 1]);
  if (dayCount <= uniqueRoute.length) {
    return uniqueRoute.slice(0, Math.max(1, dayCount - 1)).concat('Negombo').slice(0, dayCount);
  }

  return Array.from(
    { length: dayCount },
    (_value, index) => uniqueRoute[Math.min(index, uniqueRoute.length - 1)]
  );
}

function buildDailyPlan(
  day: number,
  date: string,
  location: string,
  criteria: ItineraryCriteria,
  assignedInterests: string[]
): DailyItineraryPlan {
  const experiences = assignedInterests.length ? assignedInterests : ['Local highlights', 'Food Experiences'];
  const interestFocus = experiences.join(', ');
  const isArrivalDay = day === 1;
  const isDepartureDay = date === criteria.departureDate;
  const locationProfile = getLocationProfile(location);
  const placeSuggestions = buildPlaceSuggestions(location, experiences);

  return {
    day,
    date,
    location,
    morning: isArrivalDay
      ? `Arrive at ${criteria.arrivalAirport ?? 'BIA'}, clear immigration, and transfer to ${location} for the first easy overnight stop.`
      : `Explore ${location} with a focus on ${interestFocus}.`,
    afternoon: isDepartureDay
      ? 'Keep the afternoon light near the airport side, allow time for packing, checkout, and the final transfer.'
      : `Add nearby ${locationProfile.setting} experiences that match ${interestFocus}, with rest time built in.`,
    evening: isDepartureDay
      ? `Depart from ${criteria.departureAirport ?? 'BIA'} at ${criteria.departureTime ?? 'your departure time'}.`
      : locationProfile.evening,
    hotel: `${criteria.accommodationStyle ?? 'Comfort'} stay in ${location}`,
    restaurantSuggestions: [
      `Breakfast near ${location}`,
      `Lunch close to the main activity area`,
      `Dinner matching ${criteria.travelStyle ?? 'mixed'} travel style`,
    ],
    experiences: Array.from(new Set([...experiences, 'Local culture', 'Scenic stop'])),
    transport: criteria.preferredTransport ?? 'Private Driver',
    estimatedTravelTime: isArrivalDay || isDepartureDay ? 'Airport transfer timing to confirm' : '1-3 hours, optimized to avoid backtracking',
    approximateCost: criteria.budget ? `${criteria.budget} day estimate` : 'To estimate after provider checks',
    placeSuggestions,
  };
}

function assignInterestsToStops(interests: string[] | undefined, route: string[]): string[][] {
  const selected = interests?.length ? interests : ['Local highlights', 'Food Experiences'];
  const groups = Array.from({ length: Math.max(1, route.length) }, () => [] as string[]);

  for (const interest of selected) {
    const preferredIndex = findBestStopIndexForInterest(interest, route, groups);
    groups[preferredIndex].push(interest);
  }

  return groups.map((group, index) => {
    if (group.length) return group;
    const fallback = getLocationProfile(route[index] ?? '').defaultInterests[0] ?? 'Local highlights';
    return [fallback];
  });
}

function findBestStopIndexForInterest(interest: string, route: string[], groups: string[][]): number {
  const normalizedInterest = interest.toLowerCase();
  const compatibleIndexes = route
    .map((location, index) => ({ index, profile: getLocationProfile(location) }))
    .filter(({ profile }) => profile.interestPatterns.some((pattern) => pattern.test(normalizedInterest)))
    .map(({ index }) => index);

  const candidates = compatibleIndexes.length
    ? compatibleIndexes
    : route.map((_location, index) => index);

  return candidates.reduce((best, candidate) =>
    groups[candidate].length < groups[best].length ? candidate : best
  );
}

function getLocationProfile(location: string): {
  setting: string;
  evening: string;
  defaultInterests: string[];
  interestPatterns: RegExp[];
} {
  const key = location.toLowerCase();
  if (/ella/.test(key)) {
    return {
      setting: 'hill-country',
      evening: 'Dinner in town with mountain views and an early night before hikes or train-country touring.',
      defaultInterests: ['Tea Country', 'Hiking', 'Photography'],
      interestPatterns: [/tea|train|hiking|trek|nature|photography|adventure|waterfall|wellness/],
    };
  }

  if (/galle|negombo|mirissa|bentota|unawatuna/.test(key)) {
    return {
      setting: 'coastal',
      evening: 'Dinner near the coast, with sunset time or an easy seaside walk if the group has energy.',
      defaultInterests: ['Beaches', 'Food Experiences', 'Romantic Experiences'],
      interestPatterns: [/beach|surf|snork|diving|whale|romantic|food|sunset|sea|coast/],
    };
  }

  if (/yala|udawalawe|wilpattu/.test(key)) {
    return {
      setting: 'wildlife',
      evening: 'Dinner near the lodge area and an early night before or after safari timing.',
      defaultInterests: ['Safari', 'Wildlife', 'Nature'],
      interestPatterns: [/wildlife|safari|elephant|leopard|bird|nature|park/],
    };
  }

  if (/sigiriya|kandy|anuradhapura|polonnaruwa|dambulla/.test(key)) {
    return {
      setting: 'cultural',
      evening: 'Dinner near the overnight area, with a gentle cultural stop if timing allows.',
      defaultInterests: ['Historical Sites', 'Culture', 'Temples'],
      interestPatterns: [/history|historical|unesco|temple|museum|culture|kids|family|photography/],
    };
  }

  if (/colombo/.test(key)) {
    return {
      setting: 'city',
      evening: 'Dinner in the city with shopping, nightlife, or a relaxed hotel return depending on energy.',
      defaultInterests: ['Shopping', 'Nightlife', 'Food Experiences'],
      interestPatterns: [/shopping|nightlife|food|market|museum|city|business/],
    };
  }

  return {
    setting: 'local',
    evening: 'Dinner near the overnight area, with an easy evening walk if the group has energy.',
    defaultInterests: ['Local highlights', 'Food Experiences'],
    interestPatterns: [/local|food|nature|culture|family|photography/],
  };
}

function buildPlaceSuggestions(location: string, interests: string[]): ItineraryPlaceSuggestion[] {
  const suggestions = getCuratedLocationPlaces(location);
  const normalizedInterests = interests.join(' ').toLowerCase();
  const ranked = suggestions
    .map((place) => ({
      place,
      score: place.matchPatterns.filter((pattern) => pattern.test(normalizedInterests)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ place }) => ({
      title: place.title,
      description: place.description,
      category: place.category,
      mapUrl: buildGoogleMapsSearchUrl(`${place.title}, ${location}, Sri Lanka`),
      imageUrl: buildUnsplashImageUrl(place.imageQuery),
    }));

  return ranked.slice(0, 3);
}

function getCuratedLocationPlaces(location: string): Array<{
  title: string;
  description: string;
  category: string;
  imageQuery: string;
  matchPatterns: RegExp[];
}> {
  const key = location.toLowerCase();
  if (/ella/.test(key)) {
    return [
      { title: 'Nine Arch Bridge', description: 'Iconic hill-country rail bridge and photography stop.', category: 'Photography', imageQuery: 'Nine Arch Bridge Ella Sri Lanka', matchPatterns: [/train|photography|nature|hiking/] },
      { title: "Little Adam's Peak", description: 'Short scenic hike with Ella valley views.', category: 'Hiking', imageQuery: 'Little Adams Peak Ella Sri Lanka', matchPatterns: [/hiking|nature|adventure|photography/] },
      { title: 'Ravana Falls', description: 'Popular waterfall stop outside Ella.', category: 'Nature', imageQuery: 'Ravana Falls Ella Sri Lanka', matchPatterns: [/waterfall|nature|adventure/] },
    ];
  }

  if (/galle/.test(key)) {
    return [
      { title: 'Galle Fort', description: 'UNESCO coastal fort with cafes, museums, and sunset walls.', category: 'Historical Sites', imageQuery: 'Galle Fort Sri Lanka', matchPatterns: [/history|historical|unesco|culture|photography/] },
      { title: 'Unawatuna Beach', description: 'Easy beach stop near Galle for swimming and relaxed dining.', category: 'Beaches', imageQuery: 'Unawatuna Beach Sri Lanka', matchPatterns: [/beach|surf|romantic|sunset/] },
      { title: 'Japanese Peace Pagoda', description: 'Quiet hilltop coastal viewpoint near Unawatuna.', category: 'Culture', imageQuery: 'Japanese Peace Pagoda Unawatuna Sri Lanka', matchPatterns: [/culture|photography|family/] },
    ];
  }

  if (/yala/.test(key)) {
    return [
      { title: 'Yala National Park', description: 'Sri Lanka’s best-known leopard and wildlife safari area.', category: 'Safari', imageQuery: 'Yala National Park Sri Lanka safari', matchPatterns: [/safari|wildlife|leopard|nature/] },
      { title: 'Bundala National Park', description: 'Birdlife and wetland scenery near the south coast.', category: 'Nature', imageQuery: 'Bundala National Park Sri Lanka', matchPatterns: [/bird|wildlife|nature/] },
      { title: 'Kirinda Beach', description: 'Coastal stop often paired with Yala routes.', category: 'Coast', imageQuery: 'Kirinda Beach Sri Lanka', matchPatterns: [/beach|coast|photography/] },
    ];
  }

  if (/sigiriya/.test(key)) {
    return [
      { title: 'Sigiriya Rock Fortress', description: 'Ancient rock fortress and one of Sri Lanka’s signature cultural sites.', category: 'UNESCO Heritage', imageQuery: 'Sigiriya Rock Fortress Sri Lanka', matchPatterns: [/history|historical|unesco|culture|photography/] },
      { title: 'Pidurangala Rock', description: 'Scenic viewpoint facing Sigiriya, especially good for sunrise.', category: 'Photography', imageQuery: 'Pidurangala Rock Sri Lanka', matchPatterns: [/photography|hiking|sunrise|adventure/] },
      { title: 'Dambulla Cave Temple', description: 'Historic cave temple complex close to Sigiriya routes.', category: 'Temples', imageQuery: 'Dambulla Cave Temple Sri Lanka', matchPatterns: [/temple|culture|historical|museum/] },
    ];
  }

  if (/kandy/.test(key)) {
    return [
      { title: 'Temple of the Sacred Tooth Relic', description: 'Major Buddhist temple and cultural landmark in Kandy.', category: 'Temples', imageQuery: 'Temple of the Tooth Kandy Sri Lanka', matchPatterns: [/temple|culture|history|historical/] },
      { title: 'Royal Botanical Gardens Peradeniya', description: 'Large botanical garden suited to families and nature time.', category: 'Nature', imageQuery: 'Peradeniya Botanical Gardens Sri Lanka', matchPatterns: [/nature|family|kids|photography/] },
      { title: 'Kandy Lake', description: 'Easy central walk near the city’s cultural core.', category: 'Local Favourite', imageQuery: 'Kandy Lake Sri Lanka', matchPatterns: [/local|culture|walking|family/] },
    ];
  }

  if (/colombo/.test(key)) {
    return [
      { title: 'Galle Face Green', description: 'Oceanfront city walk and street-food stop.', category: 'Food Experiences', imageQuery: 'Galle Face Green Colombo Sri Lanka', matchPatterns: [/food|city|sunset|family/] },
      { title: 'Gangaramaya Temple', description: 'Accessible cultural stop in central Colombo.', category: 'Culture', imageQuery: 'Gangaramaya Temple Colombo', matchPatterns: [/temple|culture|history/] },
      { title: 'Pettah Market', description: 'Busy local market for shopping and street atmosphere.', category: 'Markets', imageQuery: 'Pettah Market Colombo Sri Lanka', matchPatterns: [/shopping|market|local|food/] },
    ];
  }

  return [
    { title: `${location} highlights`, description: 'Local highlights matched to this day’s route.', category: 'Local highlights', imageQuery: `${location} Sri Lanka travel`, matchPatterns: [/local|nature|culture|food/] },
  ];
}

function buildGoogleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function buildUnsplashImageUrl(query: string): string {
  return `https://source.unsplash.com/640x420/?${encodeURIComponent(query)}`;
}

function buildOverview(criteria: ItineraryCriteria, days: DailyItineraryPlan[]): string {
  const firstStop = days[0]?.location ?? 'Negombo';
  const finalStop = days[days.length - 1]?.location ?? 'Negombo';
  return `${days.length} day Sri Lanka round trip from BIA, starting gently in ${firstStop} and ending near ${finalStop} for the departure transfer, balancing ${criteria.travelStyle ?? 'mixed'} travel with ${criteria.preferredTransport ?? 'flexible transport'}.`;
}

function buildMapSummary(criteria: ItineraryCriteria, route: string[]): string {
  const start = criteria.arrivalAirport ?? 'BIA';
  const end = criteria.departureAirport ?? 'BIA';
  return [start, ...route, end].join(' -> ');
}

function buildBudgetEstimate(criteria: ItineraryCriteria, dayCount: number): string {
  return criteria.budget
    ? `${criteria.budget} style across ${dayCount} days, excluding final live hotel, transport, and activity confirmations.`
    : `Budget estimate can be refined after hotel, transport, restaurant, and excursion options are checked.`;
}

function buildOrchestration(
  criteria: ItineraryCriteria,
  days: DailyItineraryPlan[]
): ItineraryOrchestrationPlan {
  const guests = (criteria.adults ?? 1) + (criteria.children ?? 0);
  const uniqueLocations = Array.from(new Set(days.map((day) => day.location)));

  return {
    hotels: uniqueLocations.map((location) => ({
      location,
      checkinDate: criteria.arrivalDate,
      checkoutDate: criteria.departureDate,
      guests,
      rooms: Math.max(1, Math.ceil(guests / 2)),
      hotelType: criteria.accommodationStyle,
    })),
    restaurants: days.flatMap((day) => [
      {
        location: day.location,
        diningDate: day.date,
        diningTime: '12:30',
        guests,
        diningStyle: criteria.travelStyle,
        priceRange: criteria.budget ?? '$$',
      },
      {
        location: day.location,
        diningDate: day.date,
        diningTime: '19:30',
        guests,
        diningStyle: criteria.travelStyle,
        priceRange: criteria.budget ?? '$$',
      },
    ]),
    excursions: days.flatMap((day) =>
      day.experiences
        .filter((experience) => !/local culture|scenic stop/i.test(experience))
        .map((experience) => ({
          destination: day.location,
          preferredDate: day.date,
          preferredTime: '09:30',
          guests,
          category: experience,
          budget: criteria.budget ?? '$$',
          tourType: criteria.travelStyle,
        }))
    ),
    logistics: days.map((day) => ({
      pickupLocation: day.day === 1 ? criteria.arrivalAirport : day.location,
      destination: day.location,
      pickupDate: day.date,
      pickupTime: day.day === 1 ? criteria.arrivalTime : '09:00',
      passengers: guests,
      vehicleType: criteria.preferredTransport,
      journeyType: day.day === 1 ? 'Airport Transfer' : 'Intercity',
      budget: criteria.budget,
    })),
  };
}
