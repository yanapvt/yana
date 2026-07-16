export type FormType =
  | 'profile'
  | 'hotel'
  | 'restaurant'
  | 'itinerary'
  | 'excursion'
  | 'excursion_booking'
  | 'logistics'
  | 'logistics_booking';

export interface BasicProfileForm {
  fullName: string;
  preferredName: string;
  email: string;
  phone: string;
  preferredLanguage: string;
  nationality: string;
  countryOfResidence: string;
  city: string;
  dateOfBirth: string;
  preferredCurrency: string;
  travelStyle: string;
  dietaryRestrictions?: string;
  accessibilityNeeds?: string;
  consent: boolean;
}

export interface HotelRequestForm {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges?: string;
  rooms: number;
  budget: string;
  starRating?: string;
  mealPlan?: string;
  hotelType?: string;
  facilities?: string;
  bedPreference?: string;
  specialOccasion?: string;
}

export interface RestaurantRequestForm {
  location: string;
  diningDate: string;
  diningTime: string;
  guests: number;
  cuisine?: string;
  diningStyle?: string;
  priceRange: string;
  dietaryRequirements?: string;
  indoorOutdoor?: string;
  specialOccasion?: string;
}

export interface ItineraryRequestForm {
  arrivalAirport?: string;
  arrivalDate: string;
  arrivalTime: string;
  departureAirport?: string;
  departureDate: string;
  departureTime: string;
  adults: number;
  children: number;
  childAges?: string;
  budget: string;
  accommodationStyle?: string;
  travelStyle: string;
  interests?: string | string[];
  preferredTransport?: string;
  walkingPreference?: string;
  specialRequirements?: string;
}

export interface ExcursionRequestForm {
  destination: string;
  preferredDate: string;
  preferredTime: string;
  guests: number;
  category?: string;
  tourType?: string;
  budget: string;
  duration?: string;
  fitnessLevel?: string;
  transportRequired?: string;
  pickupLocation?: string;
  specialRequirements?: string;
}

export interface ExcursionBookingForm {
  preferredDate: string;
  preferredTime: string;
  pickupLocation: string;
  guestNames: string;
  contactNumber: string;
  specialRequests?: string;
}

export interface LogisticsRequestForm {
  pickupLocation: string;
  destination: string;
  pickupDate: string;
  pickupTime: string;
  passengers: number;
  luggage: string;
  vehicleType?: string;
  childSeatsRequired?: string;
  accessibility?: string;
  journeyType?: string;
  preferredProvider?: string;
  specialRequirements?: string;
  budget?: string;
  dropOffLocation?: string;
  date?: string;
  time?: string;
  luggageCount?: number;
  flightNumber?: string;
  childSeat?: boolean;
}

export interface LogisticsBookingForm {
  passengerName: string;
  phoneNumber: string;
  pickupContact: string;
  flightNumber?: string;
  notes?: string;
}

export interface StoredProfile {
  userId: string;
  form: BasicProfileForm;
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceRequestForm =
  | HotelRequestForm
  | RestaurantRequestForm
  | ItineraryRequestForm
  | ExcursionRequestForm
  | ExcursionBookingForm
  | LogisticsRequestForm
  | LogisticsBookingForm;

export interface StoredServiceRequest<T extends ServiceRequestForm = ServiceRequestForm> {
  id: string;
  userId: string;
  type: Exclude<FormType, 'profile'>;
  form: T;
  createdAt: Date;
}
