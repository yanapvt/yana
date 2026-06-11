import type { HotelRequestForm } from '../types/forms.js';
import type { HotelSearchCriteria } from './HotelIntakeService.js';

const DEFAULT_CURRENCY = 'USD';

const MEAL_PLAN_MAP: Record<string, HotelSearchCriteria['boardBasis']> = {
  'room only': 'room_only',
  room_only: 'room_only',
  bnb: 'bnb',
  'b&b': 'bnb',
  'breakfast included': 'bnb',
  'bed and breakfast': 'bnb',
  'half board': 'half_board',
  half_board: 'half_board',
  'full board': 'full_board',
  full_board: 'full_board',
  'all inclusive': 'all_inclusive',
  all_inclusive: 'all_inclusive',
};

export function mapHotelRequestFormToCriteria(
  form: HotelRequestForm
): HotelSearchCriteria {
  return {
    location: form.destination,
    checkinDate: form.checkIn,
    checkoutDate: form.checkOut,
    guests: form.adults + form.children,
    rooms: form.rooms,
    starRating: form.starRating,
    hotelType: form.hotelType,
    facilities: form.facilities,
    bedPreference: form.bedPreference,
    specialOccasion: form.specialOccasion,
    boardBasis: mapMealPlan(form.mealPlan),
    budgetPerNight: parseBudget(form.budget),
  };
}

function mapMealPlan(mealPlan?: string): HotelSearchCriteria['boardBasis'] | undefined {
  if (!mealPlan) {
    return undefined;
  }

  return MEAL_PLAN_MAP[mealPlan.toLowerCase().trim()];
}

function parseBudget(budget: string): HotelSearchCriteria['budgetPerNight'] | undefined {
  const amountMatch = budget.match(/(?:^|[^\d])(\d+(?:[.,]\d{1,2})?)(?:[^\d]|$)/);
  if (!amountMatch) {
    return undefined;
  }

  const amount = Number(amountMatch[1].replace(',', '.'));
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  const currency =
    budget.match(/\b([A-Z]{3})\b/i)?.[1]?.toUpperCase() ?? DEFAULT_CURRENCY;

  return {
    amount,
    currency,
  };
}
