import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  BasicProfileForm,
  ExcursionBookingForm,
  ExcursionRequestForm,
  FormType,
  HotelRequestForm,
  ItineraryRequestForm,
  LogisticsBookingForm,
  LogisticsRequestForm,
  RestaurantRequestForm,
  ServiceRequestForm,
} from '../types/forms.js';
import { getFormTokenService } from '../services/formTokenService.js';
import { getHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { getRestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import { getExcursionSearchSessionService } from '../services/excursionSearchSessionService.js';
import { getLogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
import { getItinerarySessionService } from '../services/itinerarySessionService.js';
import {
  getItineraryPlannerService,
  type DailyItineraryPlan,
  type GeneratedItinerary,
} from '../services/ItineraryPlannerService.js';
import { mapHotelRequestFormToCriteria } from '../services/hotelRequestMapper.js';
import { mapRestaurantRequestFormToCriteria } from '../services/restaurantRequestMapper.js';
import {
  mapExcursionBookingFormToRequest,
  mapExcursionRequestFormToCriteria,
} from '../services/excursionRequestMapper.js';
import {
  mapLogisticsBookingFormToRequest,
  mapLogisticsRequestFormToCriteria,
} from '../services/logisticsRequestMapper.js';
import { mapItineraryRequestFormToCriteria } from '../services/itineraryRequestMapper.js';
import { getProfileService } from '../services/profileService.js';
import { getTwilioOutboundService } from '../services/twilioOutboundService.js';
import { getItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';
import type { HotelSearchCriteria } from '../services/HotelIntakeService.js';
import {
  basicProfileFormSchema,
  excursionBookingFormSchema,
  excursionRequestFormSchema,
  itineraryRequestFormSchema,
  logisticsBookingFormSchema,
  hotelRequestFormSchema,
  logisticsRequestFormSchema,
  restaurantRequestFormSchema,
} from '../validation/formSchemas.js';
import {
  renderExpiredPage,
  renderFormPage,
  renderSuccessPage,
  type FormPageDefinition,
} from '../utils/htmlFormRenderer.js';

interface FormRouteDefinition extends FormPageDefinition {
  schema: z.ZodTypeAny;
  successMessage: string;
}

const formDefinitions: Record<FormType, FormRouteDefinition> = {
  profile: {
    type: 'profile',
    title: 'Your travel profile',
    description: 'A few details help us tailor every recommendation from the start.',
    submitLabel: 'Save my profile',
    successMessage: 'Your profile has been saved. Send your next request in WhatsApp.',
    schema: basicProfileFormSchema,
    fields: [
      { name: 'fullName', label: 'Full Name', type: 'text', required: true, autocomplete: 'name' },
      { name: 'preferredName', label: 'Preferred Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
      { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
      {
        name: 'preferredLanguage',
        label: 'Preferred Language',
        type: 'select',
        required: true,
        options: options(['English', 'Sinhala', 'Tamil', 'Arabic', 'French', 'German', 'Italian']),
      },
      { name: 'nationality', label: 'Nationality', type: 'text', required: true },
      { name: 'countryOfResidence', label: 'Country of Residence', type: 'text', required: true },
      { name: 'city', label: 'City', type: 'text', required: true, autocomplete: 'address-level2' },
      { name: 'dateOfBirth', label: 'Date of Birth', type: 'date', required: true },
      {
        name: 'preferredCurrency',
        label: 'Preferred Currency',
        type: 'select',
        required: true,
        options: options(['USD', 'EUR', 'GBP', 'LKR', 'AED', 'AUD', 'INR']),
      },
      {
        name: 'travelStyle',
        label: 'Travel Style',
        type: 'select',
        required: true,
        options: options(['Luxury', 'Boutique', 'Family', 'Adventure', 'Wellness', 'Business']),
      },
      {
        name: 'dietaryRestrictions',
        label: 'Dietary Restrictions',
        type: 'textarea',
        placeholder: 'Optional',
      },
      {
        name: 'accessibilityNeeds',
        label: 'Accessibility Needs',
        type: 'textarea',
        placeholder: 'Optional',
      },
      {
        name: 'consent',
        label: 'I consent to YANA storing these details to personalize and fulfill my requests.',
        type: 'checkbox',
        required: true,
      },
    ],
  },
  hotel: {
    type: 'hotel',
    title: 'Hotel request',
    description: 'Tell us what your ideal stay looks like.',
    submitLabel: 'Submit hotel request',
    successMessage: 'Your hotel preferences have been received. Continue in WhatsApp.',
    schema: hotelRequestFormSchema,
    fields: [
      { name: 'destination', label: 'Destination', type: 'text', required: true },
      { name: 'checkIn', label: 'Check-in', type: 'date', required: true },
      { name: 'checkOut', label: 'Check-out', type: 'date', required: true },
      { name: 'adults', label: 'Adults', type: 'number', required: true, min: '1', max: '30' },
      { name: 'children', label: 'Children', type: 'number', required: true, min: '0', max: '20' },
      { name: 'childrenAges', label: 'Children Ages', type: 'text', placeholder: 'e.g. 4, 8' },
      { name: 'rooms', label: 'Rooms', type: 'number', required: true, min: '1', max: '20' },
      {
        name: 'budget',
        label: 'Budget',
        type: 'text',
        required: true,
        placeholder: 'e.g. USD 350 per night',
      },
      {
        name: 'starRating',
        label: 'Star Rating',
        type: 'select',
        options: options(['3 star', '4 star', '5 star', 'No preference']),
      },
      {
        name: 'mealPlan',
        label: 'Meal Plan',
        type: 'select',
        options: options([
          'Room only',
          'Breakfast included',
          'Half board',
          'Full board',
          'All inclusive',
        ]),
      },
      {
        name: 'hotelType',
        label: 'Hotel Type',
        type: 'text',
        placeholder: 'Resort, villa, boutique...',
      },
      {
        name: 'facilities',
        label: 'Facilities',
        type: 'textarea',
        placeholder: 'Pool, spa, beach access...',
      },
      { name: 'bedPreference', label: 'Bed Preference', type: 'text' },
      {
        name: 'specialOccasion',
        label: 'Special Occasion',
        type: 'textarea',
        placeholder: 'Optional',
      },
    ],
  },
  restaurant: {
    type: 'restaurant',
    title: 'Restaurant request',
    description: 'Set the scene for your dining experience.',
    submitLabel: 'Submit restaurant request',
    successMessage: 'Your dining request has been received. Continue in WhatsApp.',
    schema: restaurantRequestFormSchema,
    fields: [
      { name: 'location', label: 'Location', type: 'text', required: true },
      { name: 'diningDate', label: 'Dining Date', type: 'date', required: true },
      { name: 'diningTime', label: 'Preferred Dining Time', type: 'time', required: true },
      { name: 'guests', label: 'Guests', type: 'number', required: true, min: '1', max: '50' },
      {
        name: 'cuisine',
        label: 'Cuisine',
        type: 'select',
        options: options([
          'Sri Lankan',
          'Indian',
          'Chinese',
          'Japanese',
          'Italian',
          'Mediterranean',
          'Seafood',
          'Steakhouse',
          'BBQ',
          'Mexican',
          'Thai',
          'French',
          'Cafe',
          'Desserts',
          'Vegetarian',
          'Vegan',
          'No Preference',
        ]),
      },
      {
        name: 'diningStyle',
        label: 'Dining Style',
        type: 'select',
        options: options([
          'Quick meal',
          'Casual',
          'Family Friendly',
          'Fine Dining',
          'Romantic',
          'Beachfront',
          'Rooftop',
          'Local Favourite',
          'Luxury',
          'Budget',
        ]),
      },
      {
        name: 'priceRange',
        label: 'Price Range',
        type: 'select',
        required: true,
        options: options(['$', '$$', '$$$', '$$$$']),
      },
      {
        name: 'dietaryRequirements',
        label: 'Dietary Requirements',
        type: 'select',
        options: options([
          'None',
          'Vegetarian',
          'Vegan',
          'Halal',
          'Kosher',
          'Gluten Free',
          'Dairy Free',
          'Nut Allergy',
          'Wheelchair Accessible',
        ]),
      },
      {
        name: 'indoorOutdoor',
        label: 'Indoor/Outdoor',
        type: 'select',
        options: options(['Indoor', 'Outdoor', 'No Preference']),
      },
      {
        name: 'specialOccasion',
        label: 'Special Occasion',
        type: 'select',
        options: options(['Birthday', 'Anniversary', 'Business', 'Family', 'Date Night', 'None']),
      },
    ],
  },
  itinerary: {
    type: 'itinerary',
    title: 'Trip planning',
    description: 'Share your arrival, departure, style, and interests so Yana can build a full itinerary.',
    submitLabel: 'Submit trip plan',
    successMessage: 'Your trip planning details have been received. Continue in WhatsApp.',
    schema: itineraryRequestFormSchema,
    fields: [
      { name: 'arrivalDate', label: 'Arrival Date', type: 'date', required: true },
      { name: 'arrivalTime', label: 'Arrival Time', type: 'time', required: true },
      { name: 'departureDate', label: 'Departure Date', type: 'date', required: true },
      { name: 'departureTime', label: 'Departure Time', type: 'time', required: true },
      { name: 'adults', label: 'Adults', type: 'number', required: true, min: '1', max: '30' },
      { name: 'children', label: 'Children', type: 'number', required: true, min: '0', max: '20' },
      { name: 'childAges', label: 'Child Ages', type: 'text', placeholder: 'Optional' },
      {
        name: 'budget',
        label: 'Budget',
        type: 'select',
        required: true,
        options: options(['Budget Traveller', 'Comfort', 'Luxury', 'No Preference']),
      },
      {
        name: 'accommodationStyle',
        label: 'Accommodation Style',
        type: 'select',
        options: options(['Hotel', 'Resort', 'Villa', 'Boutique', 'Homestay', 'Camping', 'No Preference']),
      },
      {
        name: 'travelStyle',
        label: 'Travel Style',
        type: 'select',
        required: true,
        options: options(['Relaxing', 'Adventure', 'Nature', 'Wildlife', 'Culture', 'Food', 'Luxury', 'Photography', 'Wellness', 'Nightlife', 'Shopping', 'Mixed']),
      },
      {
        name: 'interests',
        label: 'Interest Selection',
        type: 'checkboxGroup',
        helperText: 'Choose everything you want covered. Yana will spread these across the available days.',
        options: options([
          'Historical Sites',
          'UNESCO Heritage',
          'Temples',
          'Museums',
          'Wildlife',
          'Safari',
          'Elephants',
          'Whale Watching',
          'Nature',
          'Beaches',
          'Surfing',
          'Snorkelling',
          'Diving',
          'Water Sports',
          'Adventure',
          'Hiking',
          'Cycling',
          'Camping',
          'Photography',
          'Tea Country',
          'Train Journeys',
          'Food Experiences',
          'Markets',
          'Shopping',
          'Gem Shopping',
          'Spa',
          'Yoga',
          'Ayurveda',
          'Family Activities',
          'Kids Activities',
          'Romantic Experiences',
          'Nightlife',
          'Events',
        ]),
      },
      {
        name: 'preferredTransport',
        label: 'Preferred Transport',
        type: 'select',
        options: options(['Private Driver', 'Train', 'Taxi', 'Public Transport', 'Rental Car', 'Mixed']),
      },
      {
        name: 'walkingPreference',
        label: 'Walking Preference',
        type: 'select',
        options: options(['Minimal', 'Moderate', 'High']),
      },
      {
        name: 'specialRequirements',
        label: 'Special Requirements',
        type: 'textarea',
        placeholder: 'Wheelchair, dietary, infants, medical, language guide, other...',
      },
    ],
  },
  excursion: {
    type: 'excursion',
    title: 'Excursion request',
    description: 'Tell us what kind of experience you want.',
    submitLabel: 'Submit excursion request',
    successMessage: 'Your excursion preferences have been received. Continue in WhatsApp.',
    schema: excursionRequestFormSchema,
    fields: [
      { name: 'destination', label: 'Destination / Area', type: 'text', required: true },
      { name: 'preferredDate', label: 'Preferred Date', type: 'date', required: true },
      { name: 'preferredTime', label: 'Preferred Time', type: 'time', required: true },
      { name: 'guests', label: 'Guests', type: 'number', required: true, min: '1', max: '50' },
      {
        name: 'category',
        label: 'Category',
        type: 'select',
        options: options([
          'Historic Sites',
          'Culture',
          'Nature',
          'Wildlife',
          'Safari',
          'Adventure',
          'Beach',
          'Surfing',
          'Diving',
          'Snorkelling',
          'Hiking',
          'Photography',
          'Shopping',
          'Food Tour',
          'Tea Experience',
          'Train Journey',
          'Wellness',
          'Nightlife',
          'Events',
          'No Preference',
        ]),
      },
      {
        name: 'tourType',
        label: 'Tour Type',
        type: 'select',
        options: options([
          'Private',
          'Group',
          'Self Guided',
          'Luxury',
          'Budget',
          'Family Friendly',
          'Couples',
          'Accessibility',
        ]),
      },
      {
        name: 'budget',
        label: 'Budget',
        type: 'select',
        required: true,
        options: options(['$', '$$', '$$$', '$$$$']),
      },
      {
        name: 'duration',
        label: 'Duration',
        type: 'select',
        options: options(['1-2 hours', 'Half Day', 'Full Day', 'Multiple Days']),
      },
      {
        name: 'fitnessLevel',
        label: 'Fitness Level',
        type: 'select',
        options: options(['Easy', 'Moderate', 'Active', 'No Preference']),
      },
      {
        name: 'transportRequired',
        label: 'Transport Required',
        type: 'select',
        options: options(['Yes', 'No']),
      },
      {
        name: 'pickupLocation',
        label: 'Pickup Location',
        type: 'select',
        options: options(['Hotel', 'Airport', 'Current Location', 'Custom Address']),
      },
      {
        name: 'specialRequirements',
        label: 'Special Requirements',
        type: 'select',
        options: options([
          'Children',
          'Wheelchair',
          'Dietary',
          'Photography',
          'Language Guide',
          'Other',
        ]),
      },
    ],
  },
  excursion_booking: {
    type: 'excursion_booking',
    title: 'Excursion booking request',
    description: 'Share the details needed to check availability.',
    submitLabel: 'Prepare booking request',
    successMessage: 'Your booking request has been prepared. Continue in WhatsApp.',
    schema: excursionBookingFormSchema,
    fields: [
      { name: 'preferredDate', label: 'Preferred Date', type: 'date', required: true },
      { name: 'preferredTime', label: 'Preferred Time', type: 'time', required: true },
      { name: 'pickupLocation', label: 'Pickup Location', type: 'text', required: true },
      { name: 'guestNames', label: 'Guest Names', type: 'textarea', required: true },
      { name: 'contactNumber', label: 'Contact Number', type: 'tel', required: true },
      { name: 'specialRequests', label: 'Special Requests', type: 'textarea' },
    ],
  },
  logistics: {
    type: 'logistics',
    title: 'Transport request',
    description: 'Share your journey details for a smooth transfer.',
    submitLabel: 'Submit transport request',
    successMessage: 'Your transport request has been received. Continue in WhatsApp.',
    schema: logisticsRequestFormSchema,
    fields: [
      { name: 'pickupLocation', label: 'Pickup Location', type: 'text', required: true },
      { name: 'destination', label: 'Destination', type: 'text', required: true },
      { name: 'pickupDate', label: 'Pickup Date', type: 'date', required: true },
      { name: 'pickupTime', label: 'Pickup Time', type: 'time', required: true },
      {
        name: 'passengers',
        label: 'Passengers',
        type: 'number',
        required: true,
        min: '1',
        max: '30',
      },
      {
        name: 'vehicleType',
        label: 'Vehicle Type',
        type: 'select',
        options: options(['Economy', 'Comfort', 'SUV', 'Luxury', 'Van', 'Minibus', 'Bus', 'No Preference']),
      },
      {
        name: 'luggage',
        label: 'Luggage',
        type: 'select',
        options: options(['None', 'Carry-on', 'Medium', 'Large', 'Oversized']),
      },
      {
        name: 'childSeatsRequired',
        label: 'Child Seats Required',
        type: 'select',
        options: options(['None', 'Infant', 'Toddler', 'Booster']),
      },
      {
        name: 'accessibility',
        label: 'Accessibility',
        type: 'select',
        options: options(['Wheelchair', 'Assistance Required', 'No Preference']),
      },
      {
        name: 'journeyType',
        label: 'Journey Type',
        type: 'select',
        options: options(['One Way', 'Return', 'Hourly Booking', 'Full Day Driver', 'Airport Transfer', 'Intercity']),
      },
      {
        name: 'preferredProvider',
        label: 'Preferred Provider',
        type: 'select',
        options: options(['Uber', 'Private Driver', 'Any Available']),
      },
      {
        name: 'specialRequirements',
        label: 'Special Requirements',
        type: 'select',
        options: options(['Pet Friendly', 'Extra Stops', 'Meet & Greet', 'English Speaking Driver', 'Other']),
      },
      { name: 'flightNumber', label: 'Flight Number', type: 'text', placeholder: 'Optional' },
      { name: 'budget', label: 'Budget', type: 'text', placeholder: 'Optional' },
    ],
  },
  logistics_booking: {
    type: 'logistics_booking',
    title: 'Transport booking request',
    description: 'Confirm the passenger contact details for the transport provider.',
    submitLabel: 'Submit booking request',
    successMessage: 'Your transport booking request has been prepared. Continue in WhatsApp.',
    schema: logisticsBookingFormSchema,
    fields: [
      { name: 'passengerName', label: 'Passenger Name', type: 'text', required: true },
      { name: 'phoneNumber', label: 'Phone Number', type: 'tel', required: true },
      { name: 'pickupContact', label: 'Pickup Contact', type: 'text', required: true },
      { name: 'flightNumber', label: 'Flight Number', type: 'text', placeholder: 'If airport transfer' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};

const router = Router();

router.use((_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
});

for (const type of Object.keys(formDefinitions) as FormType[]) {
  router.get(`/forms/${type}/:token`, (req, res) => renderForm(req, res, type));
  router.post(`/forms/${type}/:token`, (req, res, next) => {
    void submitForm(req, res, type).catch(next);
  });
}

function renderForm(req: Request, res: Response, type: FormType): void {
  const token = req.params.token;
  const tokenService = getFormTokenService();
  const csrfToken = tokenService.createCsrfToken(token, type);

  if (!csrfToken) {
    res.status(410).type('html').send(renderExpiredPage());
    return;
  }

  res
    .type('html')
    .send(
      renderFormPage(
        formDefinitions[type],
        `/forms/${type}/${encodeURIComponent(token)}`,
        csrfToken
      )
    );
}

async function submitForm(req: Request, res: Response, type: FormType): Promise<void> {
  const token = req.params.token;
  const tokenService = getFormTokenService();
  const tokenRecord = tokenService.resolveToken(token, type);
  const body =
    typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
  const csrfToken = typeof body._csrf === 'string' ? body._csrf : '';

  if (!tokenRecord) {
    res.status(410).type('html').send(renderExpiredPage());
    return;
  }

  if (!tokenService.verifyAndConsumeCsrfToken(token, type, csrfToken)) {
    res.status(403).type('html').send(renderExpiredPage());
    return;
  }

  const definition = formDefinitions[type];
  const parsed = definition.schema.safeParse(body);

  if (!parsed.success) {
    const nextCsrfToken = tokenService.createCsrfToken(token, type);
    const errors = toFieldErrors(parsed.error);
    res
      .status(400)
      .type('html')
      .send(
        renderFormPage(
          definition,
          `/forms/${type}/${encodeURIComponent(token)}`,
          nextCsrfToken ?? '',
          body,
          errors
        )
      );
    return;
  }

  const profileService = getProfileService();
  let completionMessages: string[];
  if (type === 'profile') {
    const profileForm = parsed.data as BasicProfileForm;
    await profileService.saveProfile(
      tokenRecord.userId,
      profileForm as z.infer<typeof basicProfileFormSchema>
    );
    completionMessages = [buildProfileCompletionMessage(profileForm)];
  } else {
    const serviceRequest = await profileService.saveServiceRequest(
      tokenRecord.userId,
      type,
      parsed.data as ServiceRequestForm
    );

    if (type === 'hotel') {
      const criteria = mapHotelRequestFormToCriteria(parsed.data as HotelRequestForm);
      await clearCompetingSearchSessions(tokenRecord.userId, 'hotel');
      await getHotelSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          hotelFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildHotelCompletionMessage(criteria)];
    } else if (type === 'restaurant') {
      const criteria = mapRestaurantRequestFormToCriteria(parsed.data as RestaurantRequestForm);
      await clearCompetingSearchSessions(tokenRecord.userId, 'restaurant');
      await getRestaurantSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          restaurantFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildRestaurantCompletionMessage(criteria)];
    } else if (type === 'itinerary') {
      const criteria = mapItineraryRequestFormToCriteria(parsed.data as ItineraryRequestForm);
      await clearCompetingSearchSessions(tokenRecord.userId, 'itinerary');
      const sessionService = getItinerarySessionService();
      await sessionService.saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          itineraryFormResponseId: serviceRequest.id,
        }
      );
      await sessionService.savePlanning(tokenRecord.userId, criteria);
      const itinerary = await getItineraryPlannerService().plan(criteria);
      await sessionService.saveItinerary(tokenRecord.userId, criteria, itinerary);
      const workspace = await getItineraryWorkspaceService().createOrUpdateWorkspace(
        tokenRecord.userId,
        itinerary,
        criteria,
        'Generated after trip form submission'
      );
      completionMessages = [
        buildItineraryCompletionMessage(criteria),
        buildItineraryReply(itinerary, buildItineraryWorkspaceLink(workspace.shareToken)),
      ];
    } else if (type === 'excursion') {
      const criteria = mapExcursionRequestFormToCriteria(parsed.data as ExcursionRequestForm);
      await clearCompetingSearchSessions(tokenRecord.userId, 'excursion');
      await getExcursionSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          excursionFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildExcursionCompletionMessage(criteria)];
    } else if (type === 'excursion_booking') {
      const session = await getExcursionSearchSessionService().get(tokenRecord.userId);
      const selectedExperience = session?.selectedExperience?.selectedExperienceSnapshot;
      if (selectedExperience) {
        const bookingRequest = mapExcursionBookingFormToRequest(
          tokenRecord.userId,
          selectedExperience,
          session?.criteria.guests,
          parsed.data as ExcursionBookingForm
        );
        await getExcursionSearchSessionService().saveProviderPending(
          tokenRecord.userId,
          bookingRequest
        );
      }
      completionMessages = [buildExcursionBookingCompletionMessage()];
    } else if (type === 'logistics') {
      const criteria = mapLogisticsRequestFormToCriteria(parsed.data as LogisticsRequestForm);
      await clearCompetingSearchSessions(tokenRecord.userId, 'logistics');
      await getLogisticsSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          logisticsFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildLogisticsCompletionMessage(criteria)];
    } else if (type === 'logistics_booking') {
      const session = await getLogisticsSearchSessionService().get(tokenRecord.userId);
      const selectedOption = session?.selectedOption?.selectedOptionSnapshot;
      if (selectedOption) {
        const bookingRequest = mapLogisticsBookingFormToRequest(
          selectedOption,
          session.criteria,
          parsed.data as LogisticsBookingForm
        );
        await getLogisticsSearchSessionService().saveProviderPending(
          tokenRecord.userId,
          bookingRequest
        );
      }
      completionMessages = [buildLogisticsBookingCompletionMessage()];
    } else {
      completionMessages = [buildServiceCompletionMessage(type)];
    }
  }

  tokenService.consumeToken(token, type);
  const outboundSent = await sendFormCompletionMessages(tokenRecord.userId, completionMessages);
  res
    .type('html')
    .send(
      renderSuccessPage('Thank you', definition.successMessage, {
        whatsappReturnUrl: buildWhatsAppOpenUrl(),
        whatsappReturnLabel: 'Return to WhatsApp',
        outboundSent,
      })
    );
}

function options(labels: string[]): Array<{ value: string; label: string }> {
  return labels.map((label) => ({ label, value: label }));
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

async function sendFormCompletionMessages(userId: string, messages: string[]): Promise<boolean> {
  let sentAny = false;
  try {
    for (const message of messages) {
      const sent = await getTwilioOutboundService().sendWhatsAppText(userId, message);
      sentAny = sentAny || sent;
    }
  } catch (error) {
    console.error('[forms] Failed to send form completion WhatsApp message:', error);
  }
  return sentAny;
}

async function clearCompetingSearchSessions(
  userId: string,
  activeType: 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary'
): Promise<void> {
  if (activeType !== 'hotel') {
    await getHotelSearchSessionService().clear(userId);
  }
  if (activeType !== 'restaurant') {
    await getRestaurantSearchSessionService().clear(userId);
  }
  if (activeType !== 'excursion') {
    await getExcursionSearchSessionService().clear(userId);
  }
  if (activeType !== 'logistics') {
    await getLogisticsSearchSessionService().clear(userId);
  }
  if (activeType !== 'itinerary') {
    await getItinerarySessionService().clear(userId);
  }
}

function buildProfileCompletionMessage(form: BasicProfileForm): string {
  const name = form.preferredName || form.fullName;
  const greeting = name ? `Hi ${name}` : 'Hi';

  return `${greeting}, I am Yana, your personal tour concierge. Thank you for the information, I will keep that context in mind. I can help with hotels, transport, restaurants, excursions, itinerary planning, local recommendations, or anything else you need while planning your tour. How can I help you today?`;
}

function buildHotelCompletionMessage(criteria: HotelSearchCriteria): string {
  return [
    "Great! I've gathered the following details from your search form:",
    '',
    `Destination: ${criteria.location}`,
    `Check-in: ${criteria.checkinDate}`,
    `Check-out: ${criteria.checkoutDate}`,
    `Guests: ${criteria.guests}`,
    `Rooms: ${criteria.rooms}`,
    `Meal Plan: ${criteria.boardBasis ? formatBoardBasisForUser(criteria.boardBasis) : 'No preference'}`,
    `Preferred Rating: ${criteria.starRating ?? 'No preference'}`,
    `Budget Per Night: ${criteria.budgetPerNight ? `${criteria.budgetPerNight.currency} ${criteria.budgetPerNight.amount}` : 'Not provided'}`,
    '',
    "Before I start searching, are there any additional travel preferences you'd like me to consider?",
    '',
    'For example:',
    '',
    'Beachfront, city center, mountain, or countryside location',
    'Facilities such as pool, spa, gym, kids club, or water sports',
    'Room preferences such as suite, ocean view, balcony, or connecting rooms',
    '',
    'Reply with your preferences, or type "no" and I will start searching.',
  ].join('\n');
}

function buildServiceCompletionMessage(type: FormType): string {
  if (type === 'restaurant') {
    return 'Perfect, I have received your restaurant request. Before I start searching, is there anything else I should consider?';
  }

  if (type === 'logistics') {
    return 'Perfect, I have received your transport request. Is there anything else I should keep in mind, like extra luggage, child seats, accessibility needs, or a preferred vehicle style?';
  }

  return 'Perfect, I have received your details. How can I help you next?';
}

function buildLogisticsCompletionMessage(
  criteria: ReturnType<typeof mapLogisticsRequestFormToCriteria>
): string {
  return [
    'Great!',
    '',
    "I've gathered your transport details:",
    '',
    `Pickup: ${criteria.pickupLocation}`,
    `Destination: ${criteria.destination}`,
    `Date: ${criteria.pickupDate}`,
    `Time: ${criteria.pickupTime}`,
    `Passengers: ${criteria.passengers}`,
    `Vehicle: ${criteria.vehicleType ?? 'No preference'}`,
    `Luggage: ${criteria.luggage ?? 'No preference'}`,
    '',
    "Before I start looking for the best transport option, is there anything else you'd like me to consider?",
    '',
    'Examples:',
    '',
    'child seat',
    'luxury vehicle',
    'English-speaking driver',
    'multiple stops',
    'pet friendly',
    '',
    'Reply with your preferences, or type "no" and I will start searching.',
  ].join('\n');
}

function buildItineraryCompletionMessage(
  criteria: ReturnType<typeof mapItineraryRequestFormToCriteria>
): string {
  const guestParts = [
    criteria.adults ? `${criteria.adults} Adults` : undefined,
    criteria.children ? `${criteria.children} Children` : undefined,
  ].filter(Boolean);

  return [
    'Wonderful!',
    '',
    "I've gathered the following:",
    '',
    `Arrival date: ${criteria.arrivalDate}`,
    `Departure date: ${criteria.departureDate}`,
    `Guests: ${guestParts.join(', ') || 'Not specified'}`,
    '',
    'Interests:',
    ...(criteria.interests?.length ? criteria.interests : ['Mixed']),
    '',
    `Budget: ${criteria.budget ?? 'No preference'}`,
    `Preferred Transport: ${criteria.preferredTransport ?? 'No preference'}`,
    '',
    'I will map this as a round trip from BIA and bring you back close to the airport before departure.',
    '',
    'I will start planning your route now and send the itinerary here.',
  ].join('\n');
}

function buildItineraryReply(itinerary: GeneratedItinerary, workspaceLink?: string): string {
  return [
    'Wonderful, I have prepared your itinerary.',
    '',
    `Route: ${formatCompactRoute(itinerary.mapSummary)}`,
    `Length: ${itinerary.days.length} days`,
    `Budget: ${itinerary.budgetEstimate}`,
    '',
    workspaceLink ? `Open your interactive itinerary: ${workspaceLink}` : 'Reply "workspace" and I will send the interactive itinerary link.',
    '',
    'You can edit it there, or reply here with changes like "more beach time", "less driving", "change day 3", or "book hotels".',
  ].filter(Boolean).join('\n');
}

function buildItineraryWorkspaceLink(shareToken: string): string {
  const publicBaseUrl =
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    'http://localhost:3000';
  return `${publicBaseUrl.replace(/\/$/, '')}/itinerary/${encodeURIComponent(shareToken)}`;
}

function formatRouteMap(mapSummary: string): string {
  return mapSummary
    .split(/\s*->\s*/)
    .filter(Boolean)
    .map((stop, index, stops) => {
      const prefix = index === 0 ? 'Start' : index === stops.length - 1 ? 'Finish' : `Stop ${index}`;
      return `${prefix}: ${stop}`;
    })
    .join('\n');
}

function formatCompactRoute(mapSummary: string): string {
  const stops = mapSummary.split(/\s*->\s*/).filter(Boolean);
  if (stops.length <= 5) {
    return stops.join(' -> ');
  }

  return [
    stops[0],
    ...stops.slice(1, 4),
    `+${stops.length - 5} stops`,
    stops[stops.length - 1],
  ].join(' -> ');
}

function formatDailyPlan(day: DailyItineraryPlan): string {
  return [
    '',
    `Day ${day.day}: ${day.date} - ${day.location}`,
    `Morning: ${day.morning}`,
    `Afternoon: ${day.afternoon}`,
    `Evening: ${day.evening}`,
    `Hotel: ${day.hotel}`,
    `Restaurants: ${day.restaurantSuggestions.join('; ')}`,
    `Experiences: ${day.experiences.join('; ')}`,
    `Transport: ${day.transport}`,
    `Estimated Travel Time: ${day.estimatedTravelTime}`,
    `Approximate Cost: ${day.approximateCost}`,
  ].join('\n');
}

function buildLogisticsBookingCompletionMessage(): string {
  return [
    'Perfect!',
    '',
    "I've prepared your transport booking.",
    '',
    'The next step is to check live availability and confirm pricing with the transport provider.',
  ].join('\n');
}

function buildExcursionCompletionMessage(
  criteria: ReturnType<typeof mapExcursionRequestFormToCriteria>
): string {
  return [
    'Great!',
    '',
    "I've gathered the following excursion preferences:",
    '',
    `Destination: ${criteria.destination}`,
    `Date: ${criteria.preferredDate}`,
    `Time: ${criteria.preferredTime}`,
    `Guests: ${criteria.guests}`,
    `Experience: ${criteria.category ?? 'No preference'}`,
    `Duration: ${criteria.duration ?? 'No preference'}`,
    `Pickup: ${criteria.pickupLocation ?? 'No preference'}`,
    `Budget: ${criteria.budget}`,
    '',
    "Before I start searching, is there anything else you'd like me to consider?",
    '',
    'Examples:',
    '',
    'beginner friendly',
    'private guide',
    'photography spots',
    'less crowded',
    'sunset experience',
    'wildlife focus',
    'local culture',
    '',
    'Reply with your preferences, or type "no" and I will start searching.',
  ].join('\n');
}

function buildExcursionBookingCompletionMessage(): string {
  return [
    "I've prepared your booking request.",
    '',
    "I'll now contact the experience provider and confirm availability before completing your booking.",
  ].join('\n');
}

function buildRestaurantCompletionMessage(
  criteria: ReturnType<typeof mapRestaurantRequestFormToCriteria>
): string {
  return [
    'Great!',
    '',
    "I've gathered the following dining preferences:",
    '',
    `Location: ${criteria.location}`,
    `Date: ${criteria.diningDate}`,
    `Time: ${criteria.diningTime}`,
    `Guests: ${criteria.guests}`,
    `Cuisine: ${criteria.cuisine ?? 'No preference'}`,
    `Setting: ${criteria.diningStyle ?? 'No preference'}`,
    `Budget: ${criteria.priceRange}`,
    `Seating: ${criteria.indoorOutdoor ?? 'No preference'}`,
    '',
    "Before I start searching, is there anything else you'd like me to consider?",
    '',
    'For example:',
    '',
    'live music',
    'ocean view',
    'family friendly',
    'quiet atmosphere',
    'child friendly',
    'pet friendly',
    'wine selection',
    'sunset dining',
    '',
    'Reply with your preferences, or type "no" and I will start searching.',
  ].join('\n');
}

function buildWhatsAppOpenUrl(): string | undefined {
  const rawNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  const phoneNumber = rawNumber?.replace(/^whatsapp:/, '').replace(/[^\d]/g, '');
  if (!phoneNumber) {
    return undefined;
  }

  return `https://wa.me/${phoneNumber}`;
}

function formatBoardBasisForUser(boardBasis: NonNullable<HotelSearchCriteria['boardBasis']>): string {
  const labels: Record<NonNullable<HotelSearchCriteria['boardBasis']>, string> = {
    room_only: 'Room only',
    bnb: 'Breakfast included',
    half_board: 'Half board',
    full_board: 'Full board',
    all_inclusive: 'All inclusive',
  };

  return labels[boardBasis] ?? boardBasis;
}

export default router;
