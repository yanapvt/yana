import type { LogisticsBookingForm, LogisticsRequestForm } from '../types/forms.js';
import type { TransportOption } from './TransportProvider.js';

export interface LogisticsSearchCriteria {
  pickupLocation?: string;
  destination?: string;
  pickupDate?: string;
  pickupTime?: string;
  passengers?: number;
  luggage?: string;
  vehicleType?: string;
  childSeatsRequired?: string;
  accessibility?: string;
  journeyType?: string;
  preferredProvider?: string;
  specialRequirements?: string;
  flightNumber?: string;
  budget?: string;
  originalRequest?: string;
  additionalPreferences?: string;
}

export interface LogisticsBookingRequest {
  provider: string;
  vehicle: string;
  customer: string;
  phoneNumber: string;
  pickupContact: string;
  pickup: string;
  destination: string;
  date?: string;
  time?: string;
  flightNumber?: string;
  notes?: string;
  status: 'pending_provider_confirmation';
}

export function mapLogisticsRequestFormToCriteria(
  form: LogisticsRequestForm
): LogisticsSearchCriteria {
  return {
    pickupLocation: clean(form.pickupLocation),
    destination: clean(form.destination || form.dropOffLocation),
    pickupDate: clean(form.pickupDate || form.date),
    pickupTime: clean(form.pickupTime || form.time),
    passengers: Number(form.passengers),
    luggage: clean(form.luggage || (typeof form.luggageCount === 'number' ? `${form.luggageCount} bags` : undefined)),
    vehicleType: cleanNoPreference(form.vehicleType),
    childSeatsRequired: cleanNoPreference(
      form.childSeatsRequired || (form.childSeat ? 'Child seat required' : undefined)
    ),
    accessibility: cleanNoPreference(form.accessibility),
    journeyType: cleanNoPreference(form.journeyType),
    preferredProvider: cleanNoPreference(form.preferredProvider),
    specialRequirements: cleanNoPreference(form.specialRequirements),
    flightNumber: clean(form.flightNumber),
    budget: clean(form.budget),
  };
}

export function mapLogisticsBookingFormToRequest(
  option: TransportOption,
  criteria: LogisticsSearchCriteria,
  form: LogisticsBookingForm
): LogisticsBookingRequest {
  return {
    provider: option.provider,
    vehicle: option.vehicle,
    customer: form.passengerName,
    phoneNumber: form.phoneNumber,
    pickupContact: form.pickupContact,
    pickup: criteria.pickupLocation ?? 'Pickup to confirm',
    destination: criteria.destination ?? 'Destination to confirm',
    date: criteria.pickupDate,
    time: criteria.pickupTime,
    flightNumber: clean(form.flightNumber || criteria.flightNumber),
    notes: clean(form.notes),
    status: 'pending_provider_confirmation',
  };
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanNoPreference(value?: string): string | undefined {
  const cleaned = clean(value);
  return cleaned && !/^no preference$/i.test(cleaned) ? cleaned : undefined;
}
