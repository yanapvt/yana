import type { RestaurantRequestForm } from '../types/forms.js';

export interface RestaurantSearchCriteria {
  location?: string;
  diningDate?: string;
  diningTime?: string;
  guests?: number;
  cuisine?: string;
  diningStyle?: string;
  priceRange?: string;
  dietaryRequirements?: string;
  indoorOutdoor?: string;
  specialOccasion?: string;
  additionalPreferences?: string;
  originalRequest?: string;
}

export function mapRestaurantRequestFormToCriteria(
  form: RestaurantRequestForm
): RestaurantSearchCriteria {
  return {
    location: form.location,
    diningDate: form.diningDate,
    diningTime: form.diningTime,
    guests: form.guests,
    cuisine: normalizeNoPreference(form.cuisine),
    diningStyle: normalizeNoPreference(form.diningStyle),
    priceRange: form.priceRange,
    dietaryRequirements: normalizeNoPreference(form.dietaryRequirements),
    indoorOutdoor: normalizeNoPreference(form.indoorOutdoor),
    specialOccasion: normalizeNoPreference(form.specialOccasion),
  };
}

function normalizeNoPreference(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^(none|no preference|either)$/i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
