import type { LogisticsBookingRequest, LogisticsSearchCriteria } from './logisticsRequestMapper.js';

export interface ProviderSearchRequest {
  criteria: LogisticsSearchCriteria;
  maxResults?: number;
}

export interface TransportOption {
  id: string;
  provider: string;
  vehicle: string;
  estimatedPrice: string;
  vehicleType: string;
  capacity: number;
  luggageCapacity: string;
  estimatedDuration: string;
  rating?: number;
  notes?: string;
}

export interface TransportProvider {
  search(request: ProviderSearchRequest): Promise<TransportOption[]>;
  estimate(option: TransportOption, request: ProviderSearchRequest): Promise<TransportOption>;
  book(request: LogisticsBookingRequest): Promise<{ status: 'pending_provider_confirmation' }>;
  cancel(bookingId: string): Promise<{ status: 'cancelled'; bookingId: string }>;
}

export class PlaceholderTransportProvider implements TransportProvider {
  async search(request: ProviderSearchRequest): Promise<TransportOption[]> {
    const criteria = request.criteria;
    const requestedVehicle = normalizeVehicle(criteria.vehicleType, criteria.passengers);
    const provider = criteria.preferredProvider ?? 'Private Driver';
    const options: TransportOption[] = [
      {
        id: 'private-driver-comfort',
        provider,
        vehicle: `${requestedVehicle} with local driver`,
        estimatedPrice: buildPlaceholderPrice(criteria, '$$'),
        vehicleType: requestedVehicle,
        capacity: capacityForVehicle(requestedVehicle),
        luggageCapacity: criteria.luggage ?? 'Medium',
        estimatedDuration: 'Confirm live route time',
        rating: 4.8,
        notes: 'Good balance of comfort, luggage space, and flexible pickup.',
      },
      {
        id: 'airport-transfer-van',
        provider: /airport/i.test(criteria.journeyType ?? '') ? 'Airport Transfer' : 'Private Driver',
        vehicle: 'Van transfer',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$$'),
        vehicleType: 'Van',
        capacity: 7,
        luggageCapacity: 'Large',
        estimatedDuration: 'Confirm live route time',
        rating: 4.7,
        notes: 'Useful when luggage, family space, or extra stops matter.',
      },
      {
        id: 'luxury-chauffeur',
        provider: 'Private Chauffeur',
        vehicle: 'Luxury chauffeur car',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$$$'),
        vehicleType: 'Luxury',
        capacity: 3,
        luggageCapacity: 'Medium',
        estimatedDuration: 'Confirm live route time',
        rating: 4.9,
        notes: 'Best fit when comfort, punctuality, and premium service matter.',
      },
      {
        id: 'economy-transfer',
        provider: 'Local Transfer',
        vehicle: 'Economy car',
        estimatedPrice: buildPlaceholderPrice(criteria, '$'),
        vehicleType: 'Economy',
        capacity: 3,
        luggageCapacity: 'Carry-on',
        estimatedDuration: 'Confirm live route time',
        rating: 4.4,
        notes: 'Simple option for light luggage and shorter one-way journeys.',
      },
      {
        id: 'minibus-group',
        provider: 'Group Transport',
        vehicle: 'Minibus',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$$'),
        vehicleType: 'Minibus',
        capacity: 14,
        luggageCapacity: 'Large',
        estimatedDuration: 'Confirm live route time',
        rating: 4.6,
        notes: 'Better fit for groups, families, or multiple bags.',
      },
      {
        id: 'full-day-driver',
        provider: 'Private Driver',
        vehicle: 'Full day driver',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$$'),
        vehicleType: 'Comfort',
        capacity: 4,
        luggageCapacity: 'Medium',
        estimatedDuration: 'Full day',
        rating: 4.7,
        notes: 'Flexible option for hourly booking, sightseeing, and extra stops.',
      },
      {
        id: 'suv-transfer',
        provider: 'Private Driver',
        vehicle: 'SUV transfer',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$$'),
        vehicleType: 'SUV',
        capacity: 5,
        luggageCapacity: 'Large',
        estimatedDuration: 'Confirm live route time',
        rating: 4.8,
        notes: 'Strong choice for comfort, road conditions, and larger bags.',
      },
      {
        id: 'coach-transfer',
        provider: 'Coach Operator',
        vehicle: 'Bus / coach',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$$$'),
        vehicleType: 'Bus',
        capacity: 40,
        luggageCapacity: 'Oversized',
        estimatedDuration: 'Confirm live route time',
        rating: 4.5,
        notes: 'Designed for larger groups and coordinated transfers.',
      },
      {
        id: 'rental-company-car',
        provider: 'Rental Company',
        vehicle: 'Self-drive rental car',
        estimatedPrice: buildPlaceholderPrice(criteria, '$$'),
        vehicleType: criteria.vehicleType ?? 'Comfort',
        capacity: 4,
        luggageCapacity: 'Medium',
        estimatedDuration: 'Self-drive',
        rating: 4.3,
        notes: 'Useful if you prefer independent travel and flexible timing.',
      },
    ];

    return options.slice(0, request.maxResults ?? 9);
  }

  async estimate(option: TransportOption): Promise<TransportOption> {
    return option;
  }

  async book(): Promise<{ status: 'pending_provider_confirmation' }> {
    return { status: 'pending_provider_confirmation' };
  }

  async cancel(bookingId: string): Promise<{ status: 'cancelled'; bookingId: string }> {
    return { status: 'cancelled', bookingId };
  }
}

function normalizeVehicle(vehicleType?: string, passengers?: number): string {
  if (vehicleType && !/^no preference$/i.test(vehicleType)) return vehicleType;
  if ((passengers ?? 0) >= 12) return 'Minibus';
  if ((passengers ?? 0) >= 6) return 'Van';
  return 'Comfort';
}

function capacityForVehicle(vehicleType: string): number {
  if (/bus|coach/i.test(vehicleType)) return 40;
  if (/minibus/i.test(vehicleType)) return 14;
  if (/van/i.test(vehicleType)) return 7;
  if (/suv/i.test(vehicleType)) return 5;
  if (/luxury|economy|comfort/i.test(vehicleType)) return 3;
  return 4;
}

function buildPlaceholderPrice(criteria: LogisticsSearchCriteria, fallback: string): string {
  return criteria.budget ? `Around ${criteria.budget}, to confirm live` : `${fallback} placeholder estimate`;
}
