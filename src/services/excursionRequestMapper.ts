import type { ExcursionBookingForm, ExcursionRequestForm } from '../types/forms.js';

export interface ExcursionSearchCriteria {
  destination?: string;
  preferredDate?: string;
  preferredTime?: string;
  guests?: number;
  category?: string;
  tourType?: string;
  budget?: string;
  duration?: string;
  fitnessLevel?: string;
  transportRequired?: string;
  pickupLocation?: string;
  specialRequirements?: string;
  additionalPreferences?: string;
  originalRequest?: string;
}

export interface ExcursionBookingRequest {
  provider?: string;
  experience: {
    id?: string;
    name: string;
    googleMapsUri?: string;
  };
  customer: {
    userId: string;
    contactNumber: string;
  };
  guests: {
    count?: number;
    names: string;
  };
  date: string;
  time: string;
  pickup: string;
  specialRequests?: string;
  status: 'pending_provider_confirmation';
  createdAt: string;
}

export function mapExcursionRequestFormToCriteria(
  form: ExcursionRequestForm
): ExcursionSearchCriteria {
  return {
    destination: form.destination,
    preferredDate: form.preferredDate,
    preferredTime: form.preferredTime,
    guests: form.guests,
    category: normalizeNoPreference(form.category),
    tourType: normalizeNoPreference(form.tourType),
    budget: form.budget,
    duration: normalizeNoPreference(form.duration),
    fitnessLevel: normalizeNoPreference(form.fitnessLevel),
    transportRequired: normalizeNoPreference(form.transportRequired),
    pickupLocation: normalizeNoPreference(form.pickupLocation),
    specialRequirements: normalizeNoPreference(form.specialRequirements),
  };
}

export function mapExcursionBookingFormToRequest(
  userId: string,
  experience: { id?: string; name: string; googleMapsUri?: string },
  guests: number | undefined,
  form: ExcursionBookingForm
): ExcursionBookingRequest {
  return {
    provider: experience.name,
    experience,
    customer: {
      userId,
      contactNumber: form.contactNumber,
    },
    guests: {
      count: guests,
      names: form.guestNames,
    },
    date: form.preferredDate,
    time: form.preferredTime,
    pickup: form.pickupLocation,
    specialRequests: form.specialRequests,
    status: 'pending_provider_confirmation',
    createdAt: new Date().toISOString(),
  };
}

function normalizeNoPreference(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^(none|no preference|no|other)$/i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
