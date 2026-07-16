import type { ItineraryRequestForm } from '../types/forms.js';

export interface ItineraryCriteria {
  arrivalAirport?: string;
  arrivalDate?: string;
  arrivalTime?: string;
  departureAirport?: string;
  departureDate?: string;
  departureTime?: string;
  adults?: number;
  children?: number;
  childAges?: string;
  budget?: string;
  accommodationStyle?: string;
  travelStyle?: string;
  interests?: string[];
  preferredTransport?: string;
  walkingPreference?: string;
  specialRequirements?: string;
  originalRequest?: string;
  additionalPreferences?: string;
}

export function mapItineraryRequestFormToCriteria(
  form: ItineraryRequestForm
): ItineraryCriteria {
  return {
    arrivalAirport: clean(form.arrivalAirport) ?? 'BIA',
    arrivalDate: clean(form.arrivalDate),
    arrivalTime: clean(form.arrivalTime),
    departureAirport: clean(form.departureAirport) ?? 'BIA',
    departureDate: clean(form.departureDate),
    departureTime: clean(form.departureTime),
    adults: Number(form.adults),
    children: Number(form.children),
    childAges: clean(form.childAges),
    budget: cleanNoPreference(form.budget),
    accommodationStyle: cleanNoPreference(form.accommodationStyle),
    travelStyle: cleanNoPreference(form.travelStyle),
    interests: splitInterests(form.interests),
    preferredTransport: cleanNoPreference(form.preferredTransport),
    walkingPreference: cleanNoPreference(form.walkingPreference),
    specialRequirements: cleanNoPreference(form.specialRequirements),
  };
}

function splitInterests(value?: string | string[]): string[] {
  const rawValues = Array.isArray(value) ? value : value?.split(/[,;\n]/);
  const terms = rawValues?.map((part) => part.trim()).filter(Boolean);
  return terms?.length ? terms : [];
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanNoPreference(value?: string): string | undefined {
  const cleaned = clean(value);
  return cleaned && !/^no preference$/i.test(cleaned) ? cleaned : undefined;
}
