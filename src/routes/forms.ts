import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { renderWebsiteDecision } from '../orchestration/SemanticUI.js';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { getCanonicalMessageProcessor } from '../services/CanonicalMessageProcessor.js';
import { processCanonicalInboundMessage } from '../services/ConversationMessageService.js';
import { createWebsiteConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { WORKFLOW_DEFINITIONS, validateCriteria, missingFields, requiredFieldsForAction, canonicalField } from '../orchestration/WorkflowDefinitions.js';
import { PersistenceError } from '../storage/Persistence.js';
import { withWorkflowLock } from '../services/WorkflowLockService.js';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { getPhoneLocale, normalizeWhatsAppPhone } from '../utils/phoneLocale.js';
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
import type { CanonicalConversationEvent, InboundMessage } from '../types/core.js';
import { getFormTokenService } from '../services/formTokenService.js';
import { getHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { getRestaurantSearchSessionService } from '../services/restaurantSearchSessionService.js';
import { getExcursionSearchSessionService } from '../services/excursionSearchSessionService.js';
import { getLogisticsSearchSessionService } from '../services/logisticsSearchSessionService.js';
import { getItinerarySessionService } from '../services/itinerarySessionService.js';
import {
  type DailyItineraryPlan,
  type GeneratedItinerary,
} from '../services/ItineraryPlannerService.js';
import { mapHotelRequestFormToCriteria } from '../services/hotelRequestMapper.js';
import { mapRestaurantRequestFormToCriteria } from '../services/restaurantRequestMapper.js';
import { mapExcursionRequestFormToCriteria } from '../services/excursionRequestMapper.js';
import { mapLogisticsRequestFormToCriteria } from '../services/logisticsRequestMapper.js';
import { mapItineraryRequestFormToCriteria } from '../services/itineraryRequestMapper.js';
import { getProfileService } from '../services/profileService.js';
import { getTwilioOutboundService } from '../services/twilioOutboundService.js';
import { getOpenWaOutboundService } from '../services/OpenWaOutboundService.js';
import { getMetaWhatsAppOutboundService } from '../services/MetaWhatsAppOutboundService.js';
import { getItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';
import { env } from '../config/environment.js';
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
      { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
      {
        name: 'preferredLanguage',
        label: 'Preferred Language',
        type: 'select',
        required: true,
        options: options(['English', 'Sinhala', 'Tamil', 'Arabic', 'French', 'German', 'Italian']),
      },
      { name: 'nationality', label: 'Nationality', type: 'text', required: true },
      { name: 'dateOfBirth', label: 'Date of Birth', type: 'date', required: true },
      {
        name: 'travelStyle',
        label: 'Travel Style',
        type: 'select',
        required: true,
        options: options(['Luxury', 'Boutique', 'Family', 'Adventure', 'Wellness', 'Business']),
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
        name: 'allergies',
        label: 'Allergies (please confirm explicitly)',
        type: 'textarea',
        placeholder: 'e.g. peanuts, shellfish, or None',
        helperText: 'Restaurants must confirm they can safely accommodate an allergy.',
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
      { name: 'guests', label: 'Number of Guests', type: 'number', required: true, min: '1', max: '50' },
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

type SearchEditorFlow = 'hotel' | 'restaurant' | 'excursion' | 'logistics';
const searchEditorFields: Record<SearchEditorFlow, readonly string[]> = {
  hotel: ['location', 'checkinDate', 'checkoutDate', 'guests', 'rooms'],
  restaurant: ['location', 'diningDate', 'diningTime', 'guests', 'cuisine'],
  excursion: ['destination', 'preferredDate', 'preferredTime', 'guests', 'category'],
  logistics: ['pickupLocation', 'destination', 'pickupDate', 'pickupTime', 'passengers'],
};
function isSearchEditorFlow(type: FormType): type is SearchEditorFlow {
  return type in searchEditorFields;
}

for (const type of Object.keys(formDefinitions) as FormType[]) {
  router.get(`/forms/${type}/:token/chat`, (req, res) => {
    const tokens = getFormTokenService();
    const owner = tokens.resolveToken(req.params.token, type);
    if (!owner) { res.status(410).json({ error: 'This conversation link has expired.' }); return; }
    res.json({ csrf: tokens.createCsrfToken(req.params.token, type) });
  });
  router.post(`/forms/${type}/:token/chat`, assignCorrelationId, (req, res, next) => {
    void processWebsiteChat(req, res, type).catch(next);
  });
  router.get(`/forms/${type}/:token`, (req, res, next) => { void renderForm(req, res, type).catch(next); });
  router.post(`/forms/${type}/:token`, assignCorrelationId, (req, res, next) => {
    void submitForm(req, res, type).catch(next);
  });
  if (isSearchEditorFlow(type)) {
    router.get(`/forms/${type}/:token/editor`, (req, res, next) => { void renderSearchEditor(req, res, type).catch(next); });
    router.post(`/forms/${type}/:token/editor`, assignCorrelationId, (req, res, next) => {
      void updateSearchDraft(req, res, type).catch((error) => {
        if (res.headersSent) return next(error);
        const conflict = error instanceof PersistenceError && error.status === 'conflict' ||
          error instanceof Error && error.message === 'Stale UI revision';
        res.status(conflict ? 409 : error instanceof z.ZodError ? 400 : 503)
          .json({ error: conflict ? 'This search changed. Reload it before editing.'
            : error instanceof z.ZodError ? 'Check the search details and try again.' : 'The draft was not saved.' });
      });
    });
  }
}

async function processWebsiteChat(req: Request, res: Response, type: FormType): Promise<void> {
  const tokens = getFormTokenService();
  const owner = tokens.resolveToken(req.params.token, type);
  if (!owner) { res.status(410).json({ error: 'This conversation link has expired.' }); return; }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 4000) {
    res.status(400).json({ error: 'Enter a message of 4000 characters or fewer.' }); return;
  }
  const csrf = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
  if (!tokens.verifyAndConsumeCsrfToken(req.params.token, type, csrf)) {
    res.status(403).json({ error: 'Reload this conversation before sending another message.' }); return;
  }
  const sourceEventId = createHash('sha256').update(`${req.params.token}\0${csrf}`).digest('hex');
  const correlationId = req.headers['x-correlation-id'] as string;
  const inboundMessage: InboundMessage = {
    messageId: sourceEventId, from: owner.userId, to: 'website:chat',
    timestamp: new Date(), type: 'text', inputType: 'text',
    content: { type: 'text', body: text },
  };
  const event = createWebsiteConversationEvent({
    sourceEventId, correlationId, userId: owner.userId, channel: 'website_ui',
    eventType: 'text', payload: { content: inboundMessage.content },
  });
  const result = await processCanonicalInboundMessage(inboundMessage, event);
  res.json({ reply: result.reply, csrf: tokens.createCsrfToken(req.params.token, type) });
}

async function renderSearchEditor(req: Request, res: Response, flow: SearchEditorFlow): Promise<void> {
  const tokens = getFormTokenService();
  const owner = tokens.resolveToken(req.params.token, flow);
  if (!owner) { res.status(410).type('html').send(renderExpiredPage()); return; }
  const session = await currentWorkflow(owner.userId, flow);
  if (!session?.id) { res.status(404).json({ error: 'This search workflow is no longer available.' }); return; }
  tokens.bindRevision(req.params.token, flow, session.revision ?? 0, session.id);
  const bound = tokens.resolveToken(req.params.token, flow);
  if (bound?.workflowId !== session.id || bound.workflowRevision !== (session.revision ?? 0)) {
    res.status(409).json({ error: 'This search changed. Reload it from the latest link.' }); return;
  }
  const csrf = tokens.createCsrfToken(req.params.token, flow)!;
  const view = searchEditorView(flow, session, req.headers['x-correlation-id'] as string | undefined ?? session.id);
  if (req.accepts('html') && !req.headers.accept?.includes('application/json')) {
    res.type('html').send(renderSearchEditorPage(flow, req.params.token, csrf, view)); return;
  }
  res.json({ ...view, csrf, formToken: req.params.token });
}

async function updateSearchDraft(req: Request, res: Response, flow: SearchEditorFlow): Promise<void> {
  const tokens = getFormTokenService();
  const owner = tokens.resolveToken(req.params.token, flow);
  if (!owner) { res.status(410).json({ error: 'This editor link has expired.' }); return; }
  await withWorkflowLock(owner.userId, async () => {
    const bound = tokens.resolveToken(req.params.token, flow);
    const current = await currentWorkflow(owner.userId, flow);
    if (!bound || !current?.id || bound.workflowId !== current.id ||
        bound.workflowRevision !== (current.revision ?? 0) ||
        Number(req.body?.expectedRevision) !== (current.revision ?? 0)) {
      res.status(409).json({ error: 'This search changed. Reload it before editing.' }); return;
    }
    if (req.body?.action !== 'update_draft' || !tokens.verifyAndConsumeCsrfToken(req.params.token, flow, String(req.body?._csrf ?? ''))) {
      res.status(403).json({ error: 'This draft action is not authorised.' }); return;
    }
    const submitted = req.body?.fields && typeof req.body.fields === 'object' && !Array.isArray(req.body.fields)
      ? req.body.fields as Record<string, unknown>
      : Object.fromEntries(Object.entries(req.body as Record<string, unknown>).filter(([key]) =>
        !['action', '_csrf', 'expectedRevision'].includes(key)));
    if (!Object.keys(submitted).length || Object.keys(submitted).some((key) => !searchEditorFields[flow].includes(key))) {
      res.status(400).json({ error: 'Choose an approved search field to update.' }); return;
    }
    const patch = validateCriteria(flow, Object.fromEntries(Object.entries(submitted)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => [key,
        ['guests', 'rooms', 'passengers'].includes(key) && typeof value === 'string' ? Number(value) : value])));
    if (!Object.keys(patch).length) { res.status(400).json({ error: 'Choose a search detail to update.' }); return; }
    validateCriteria(flow, { ...Object.fromEntries(Object.entries(current.criteria).filter(([key]) => canonicalField(flow, key))), ...patch });
    const view = searchEditorView(flow, current, req.headers['x-correlation-id'] as string, patch);
    await getCanonicalMessageProcessor().process(createWebsiteConversationEvent({
      sourceEventId: createHash('sha256').update(JSON.stringify({ token: req.params.token, csrf: req.body._csrf,
        workflowId: current.id, revision: current.revision ?? 0, patch })).digest('hex'),
      correlationId: req.headers['x-correlation-id'] as string,
      userId: owner.userId, channel: 'website_ui', eventType: 'ui_action',
      workflowId: current.id, expectedStateVersion: current.revision ?? 0,
      payload: { action: 'update_draft', fields: patch, schemaId: view.schemaId },
    }), async (event) => {
    if (event.workflowId !== current.id || event.expectedStateVersion !== (current.revision ?? 0)) throw new PersistenceError('conflict');
    const service = flow === 'hotel' ? getHotelSearchSessionService()
      : flow === 'restaurant' ? getRestaurantSearchSessionService()
      : flow === 'excursion' ? getExcursionSearchSessionService() : getLogisticsSearchSessionService();
    const outcome = await service.applyCriteriaPatch(owner.userId, current.revision ?? 0, patch);
    if (outcome.status !== 'durable') throw new PersistenceError();
    const updated = await currentWorkflow(owner.userId, flow);
    if (!updated || updated.id !== current.id) throw new PersistenceError('conflict');
    const nextToken = tokens.createToken(owner.userId, flow);
    tokens.bindRevision(nextToken, flow, updated.revision ?? 0, updated.id);
    const nextUrl = `/forms/${flow}/${encodeURIComponent(nextToken)}/editor`;
    if (req.accepts('html') && !req.headers.accept?.includes('application/json')) {
      res.redirect(303, nextUrl); return;
    }
    res.json({ ok: true, editorUrl: nextUrl, view: searchEditorView(flow, updated, event.correlationId) });
    }, { alreadyLocked: true });
  });
}

function searchEditorView(flow: SearchEditorFlow, session: { id: string; revision?: number; criteria: object }, correlationId: string,
  patch: Record<string, unknown> = {}) {
  const values = validateCriteria(flow, { ...session.criteria, ...patch }, false);
  return renderWebsiteDecision({ version: '1.0', mode: 'search_editor', workflow: flow,
    workflowId: session.id, schemaId: WORKFLOW_DEFINITIONS[flow].schema, schemaVersion: '1.0',
    values, missingFields: missingFields(flow, values, requiredFieldsForAction(flow, 'provider_search')),
    actions: ['update_draft'], text: 'Edit search details, then ask YANA to search when you are ready.',
    correlationId, expectedRevision: session.revision ?? 0 });
}

function renderSearchEditorPage(flow: SearchEditorFlow, token: string, csrf: string,
  view: ReturnType<typeof searchEditorView>): string {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const fields = searchEditorFields[flow].map((field) => {
    const type = /Date$/.test(field) ? 'date' : /Time$/.test(field) ? 'time'
      : ['guests', 'rooms', 'passengers'].includes(field) ? 'number' : 'text';
    const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, (first) => first.toUpperCase());
    return `<label>${escape(label)}<input name="${escape(field)}" type="${type}" value="${escape(view.values[field])}"></label>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YANA search details</title><style>body{font:16px system-ui;max-width:38rem;margin:2rem auto;padding:0 1rem}label{display:block;margin:1rem 0}input{display:block;width:100%;padding:.6rem;box-sizing:border-box}button{padding:.7rem 1.2rem}</style></head><body><h1>Edit ${escape(flow)} search details</h1><p>Changes are saved as a draft. YANA searches only when you explicitly ask.</p><form method="post" action="/forms/${flow}/${encodeURIComponent(token)}/editor"><input type="hidden" name="_csrf" value="${escape(csrf)}"><input type="hidden" name="expectedRevision" value="${view.expectedRevision}"><input type="hidden" name="action" value="update_draft">${fields}<button type="submit">Save draft</button></form></body></html>`;
}

async function currentWorkflow(userId: string, type: FormType) {
  if (type === 'hotel') return getHotelSearchSessionService().getAuthoritative(userId);
  if (type === 'restaurant') return getRestaurantSearchSessionService().getAuthoritative(userId);
  if (type === 'excursion' || type === 'excursion_booking') return getExcursionSearchSessionService().getAuthoritative(userId);
  if (type === 'logistics' || type === 'logistics_booking') return getLogisticsSearchSessionService().getAuthoritative(userId);
  if (type === 'itinerary') return getItinerarySessionService().getAuthoritative(userId);
  return null;
}

async function renderForm(req: Request, res: Response, type: FormType): Promise<void> {
  const token = req.params.token;
  const tokenService = getFormTokenService();
  const owner = tokenService.resolveToken(token, type);
  let current: Awaited<ReturnType<typeof currentWorkflow>> = null;
  if (owner && type !== 'profile') {
    current = await currentWorkflow(owner.userId, type);
    tokenService.bindRevision(token, type, current?.revision ?? 0, current?.id);
  }
  if (owner && type === 'profile') tokenService.bindRevision(token, type, (await getProfileService().getProfile(owner.userId))?.revision ?? 0);
  const csrfToken = tokenService.createCsrfToken(token, type);

  if (!csrfToken) {
    res.status(410).type('html').send(renderExpiredPage());
    return;
  }

  // Collection/booking forms retain their Zod and CSRF validation below.
  const flow = type.replace(/_booking$/, '') as keyof typeof WORKFLOW_DEFINITIONS | 'profile';
  const bound = tokenService.resolveToken(token, type)!;
  const values = flow === 'profile' ? {} : validateCriteria(flow, { ...current?.criteria }, false);
  const view = renderWebsiteDecision({ version: '1.0', mode: 'clarification_form', formId: type,
    workflow: flow, schemaId: flow === 'profile' ? 'profile' : WORKFLOW_DEFINITIONS[flow].schema,
    schemaVersion: '1.0', values, missingFields: flow === 'profile' ? [] : missingFields(flow, values), actions: ['submit_form'], text: '',
    correlationId: bound.workflowId ?? bound.requestId!, expectedRevision: bound.workflowRevision ?? 0 });
  const initialValues = type === 'hotel' ? { ...view.initialValues, destination: values.location, checkIn: values.checkinDate,
    checkOut: values.checkoutDate, adults: values.guests, budget: values.budgetPerNight && typeof values.budgetPerNight === 'object'
      ? `${(values.budgetPerNight as any).currency} ${(values.budgetPerNight as any).amount} per night` : undefined } : view.initialValues;

  const formHtml = renderFormPage(
        formDefinitions[view.formId ?? type],
        `/forms/${type}/${encodeURIComponent(token)}`,
        csrfToken,
        initialValues
      );
  const editorLink = isSearchEditorFlow(type) && current?.id
    ? `<p><a href="/forms/${type}/${encodeURIComponent(token)}/editor">Edit saved search details without starting a new search</a></p>` : '';
  res.type('html').send(editorLink ? formHtml.replace('</body>', `${editorLink}</body>`) : formHtml);
}

async function submitForm(req: Request, res: Response, type: FormType): Promise<void> {
  const owner = getFormTokenService().resolveToken(req.params.token, type);
  if (!owner) { res.status(410).type('html').send(renderExpiredPage()); return; }
  return withWorkflowLock(owner.userId, () => submitFormCore(req, res, type));
}

async function submitFormCore(req: Request, res: Response, type: FormType): Promise<void> {
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

  if (type !== 'profile' && tokenRecord.workflowRevision !== undefined) {
    const current = await currentWorkflow(tokenRecord.userId, type);
    if ((current?.revision ?? 0) !== tokenRecord.workflowRevision || current?.id !== tokenRecord.workflowId) throw new PersistenceError('conflict');
  }

  const definition = formDefinitions[type];
  const input = type === 'profile' ? hydrateProfileForm(body, tokenRecord.userId) : body;
  const parsed = definition.schema.safeParse(input);

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

  await getCanonicalMessageProcessor().process(createWebsiteConversationEvent({
    sourceEventId: tokenRecord.requestId!,
    correlationId: req.headers['x-correlation-id'] as string,
    userId: tokenRecord.userId,
    channel: 'website_form', eventType: 'form_submission',
    workflowId: tokenRecord.workflowId,
    expectedStateVersion: tokenRecord.workflowRevision,
    payload: { formType: type, fields: parsed.data as Record<string, unknown> },
  }), async (event) => {

  const profileService = getProfileService();
  let completionMessages: string[];
  if (type === 'profile') {
    const profileForm = parsed.data as BasicProfileForm;
    await profileService.saveProfile(
      tokenRecord.userId,
      profileForm as z.infer<typeof basicProfileFormSchema>,
      tokenRecord.workflowRevision
    );
    completionMessages = [buildProfileCompletionMessage(profileForm)];
  } else {
    if (type === 'excursion_booking') {
      const current = await getExcursionSearchSessionService().get(tokenRecord.userId);
      if (!current?.selectedExperience || current.stage !== 'booking_form' || current.lifecycleStatus === 'paused') throw new PersistenceError('conflict');
    }
    if (type === 'logistics_booking') {
      const current = await getLogisticsSearchSessionService().get(tokenRecord.userId);
      if (!current?.selectedOption || current.stage !== 'booking_form' || current.lifecycleStatus === 'paused') throw new PersistenceError('conflict');
    }
    const serviceRequest = await profileService.saveServiceRequest(
      tokenRecord.userId,
      type,
      parsed.data as ServiceRequestForm,
      token
    );

    if (type === 'hotel') {
      const criteria = await reconcileFormCriteria(
        tokenRecord.userId,
        'hotel',
        mapHotelRequestFormToCriteria(parsed.data as HotelRequestForm),
        tokenRecord.workflowId,
        tokenRecord.workflowRevision,
        event
      ) as HotelSearchCriteria;
      await getConversationControlPlane().pauseCompetingWorkflows(tokenRecord.userId, 'hotel');
      await getHotelSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          hotelFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildHotelCompletionMessage(criteria)];
    } else if (type === 'restaurant') {
      const criteria = await reconcileFormCriteria(
        tokenRecord.userId,
        'restaurant',
        mapRestaurantRequestFormToCriteria(parsed.data as RestaurantRequestForm),
        tokenRecord.workflowId,
        tokenRecord.workflowRevision,
        event
      );
      await getConversationControlPlane().pauseCompetingWorkflows(tokenRecord.userId, 'restaurant');
      await getRestaurantSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          restaurantFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildRestaurantCompletionMessage(criteria)];
    } else if (type === 'itinerary') {
      const criteria = await reconcileFormCriteria(
        tokenRecord.userId,
        'itinerary',
        mapItineraryRequestFormToCriteria(parsed.data as ItineraryRequestForm),
        tokenRecord.workflowId,
        tokenRecord.workflowRevision,
        event
      );
      await getConversationControlPlane().pauseCompetingWorkflows(tokenRecord.userId, 'itinerary');
      const { itinerary, workspace } = await getItineraryWorkspaceService()
        .generateFromSubmittedForm(tokenRecord.userId, criteria, serviceRequest.id);
      completionMessages = [
        buildItineraryCompletionMessage(criteria),
        buildItineraryReply(itinerary, buildItineraryWorkspaceLink(workspace.shareToken)),
      ];
    } else if (type === 'excursion') {
      const criteria = await reconcileFormCriteria(
        tokenRecord.userId,
        'excursion',
        mapExcursionRequestFormToCriteria(parsed.data as ExcursionRequestForm),
        tokenRecord.workflowId,
        tokenRecord.workflowRevision,
        event
      );
      await getConversationControlPlane().pauseCompetingWorkflows(tokenRecord.userId, 'excursion');
      await getExcursionSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          excursionFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildExcursionCompletionMessage(criteria)];
    } else if (type === 'excursion_booking') {
      await getExcursionSearchSessionService().submitBookingForm(
        tokenRecord.userId, parsed.data as ExcursionBookingForm);
      completionMessages = [buildExcursionBookingCompletionMessage()];
    } else if (type === 'logistics') {
      const criteria = await reconcileFormCriteria(
        tokenRecord.userId,
        'logistics',
        mapLogisticsRequestFormToCriteria(parsed.data as LogisticsRequestForm),
        tokenRecord.workflowId,
        tokenRecord.workflowRevision,
        event
      );
      await getConversationControlPlane().pauseCompetingWorkflows(tokenRecord.userId, 'logistics');
      await getLogisticsSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        criteria,
        {
          logisticsFormResponseId: serviceRequest.id,
        }
      );
      completionMessages = [buildLogisticsCompletionMessage(criteria)];
    } else if (type === 'logistics_booking') {
      await getLogisticsSearchSessionService().submitBookingForm(
        tokenRecord.userId, parsed.data as LogisticsBookingForm);
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
  }, { alreadyLocked: true });
}

async function reconcileFormCriteria<T extends object>(
  userId: string,
  flow: 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary',
  criteria: T,
  workflowId?: string,
  workflowRevision?: number,
  event?: CanonicalConversationEvent
): Promise<T> {
  const reconciled = await getConversationControlPlane().reconcileFormSubmission(
    userId,
    flow,
    criteria as Record<string, unknown>,
    { id: workflowId, revision: workflowRevision },
    event
  );
  return reconciled.collectedFields as T;
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
      const sent = await getFormCompletionOutboundService().sendWhatsAppText(userId, message);
      sentAny = sentAny || sent;
    }
  } catch (error) {
    console.error('[forms] Failed to send form completion WhatsApp message:', error);
  }
  return sentAny;
}

function getFormCompletionOutboundService(): { sendWhatsAppText(to: string, body: string): Promise<boolean> } {
  if (env.whatsapp.provider === 'openwa') {
    return getOpenWaOutboundService();
  }

  if (env.whatsapp.provider === 'meta') {
    return getMetaWhatsAppOutboundService();
  }

  return getTwilioOutboundService();
}

function buildProfileCompletionMessage(form: BasicProfileForm): string {
  const name = form.preferredName || form.fullName;
  const greeting = name ? `Hi ${name}` : 'Hi';

  return [
    `${greeting}, I am Yana, your personal tour concierge.`,
    '',
    'Thanks, your profile is set. I am back with you here on WhatsApp now.',
    '',
    'You can ask me for hotels, transport, restaurants, excursions, a full itinerary, or local recommendations.',
    '',
    'What would you like help with first?',
  ].join('\n');
}

function hydrateProfileForm(
  submitted: Record<string, unknown>,
  userId: string
): Record<string, unknown> {
  const fullName = typeof submitted.fullName === 'string' ? submitted.fullName : '';
  const phoneLocale = getPhoneLocale(userId);

  return {
    ...submitted,
    preferredName: firstName(fullName),
    phone: normalizeWhatsAppPhone(userId),
    countryOfResidence: phoneLocale?.country ?? 'Not determined',
    city: undefined,
    preferredCurrency: phoneLocale?.currency ?? 'USD',
    dietaryRestrictions: undefined,
  };
}

function firstName(fullName: string): string {
  return fullName
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .match(/[\p{L}][\p{L}\p{M}'’-]*/u)?.[0] ?? 'Traveler';
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
    'Thank you — your transport quote request is prepared.',
    '',
    'No vehicle, availability, or price is confirmed yet. A transport operator must review the request and provide a quote before you decide whether to proceed.',
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
    "I've prepared your experience request.",
    '',
    'YANA has not contacted the provider yet. Availability, price, and a booking are not confirmed; this request still needs a provider integration or concierge follow-up.',
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
