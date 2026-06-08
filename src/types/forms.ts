export type FormType = 'profile' | 'hotel' | 'restaurant' | 'logistics';

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
  date: string;
  time: string;
  guests: number;
  cuisinePreference?: string;
  budget: string;
  dietaryRestrictions?: string;
  ambience?: string;
  indoorOutdoor?: string;
  occasion?: string;
}

export interface LogisticsRequestForm {
  pickupLocation: string;
  dropOffLocation: string;
  date: string;
  time: string;
  passengers: number;
  luggageCount: number;
  vehicleType?: string;
  flightNumber?: string;
  childSeat: boolean;
  budget: string;
}

export interface StoredProfile {
  userId: string;
  form: BasicProfileForm;
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceRequestForm = HotelRequestForm | RestaurantRequestForm | LogisticsRequestForm;

export interface StoredServiceRequest<T extends ServiceRequestForm = ServiceRequestForm> {
  id: string;
  userId: string;
  type: Exclude<FormType, 'profile'>;
  form: T;
  createdAt: Date;
}
