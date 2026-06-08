import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { FormType, HotelRequestForm, ServiceRequestForm } from '../types/forms.js';
import { getFormTokenService } from '../services/formTokenService.js';
import { getHotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { mapHotelRequestFormToCriteria } from '../services/hotelRequestMapper.js';
import { getProfileService } from '../services/profileService.js';
import {
  basicProfileFormSchema,
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
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'time', label: 'Time', type: 'time', required: true },
      { name: 'guests', label: 'Guests', type: 'number', required: true, min: '1', max: '50' },
      { name: 'cuisinePreference', label: 'Cuisine Preference', type: 'text' },
      {
        name: 'budget',
        label: 'Budget',
        type: 'text',
        required: true,
        placeholder: 'e.g. USD 80 per person',
      },
      { name: 'dietaryRestrictions', label: 'Dietary Restrictions', type: 'textarea' },
      {
        name: 'ambience',
        label: 'Ambience',
        type: 'text',
        placeholder: 'Romantic, lively, quiet...',
      },
      {
        name: 'indoorOutdoor',
        label: 'Indoor/Outdoor',
        type: 'select',
        options: options(['Indoor', 'Outdoor', 'Either']),
      },
      { name: 'occasion', label: 'Occasion', type: 'text' },
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
      { name: 'dropOffLocation', label: 'Drop-off Location', type: 'text', required: true },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'time', label: 'Time', type: 'time', required: true },
      {
        name: 'passengers',
        label: 'Passengers',
        type: 'number',
        required: true,
        min: '1',
        max: '30',
      },
      {
        name: 'luggageCount',
        label: 'Luggage Count',
        type: 'number',
        required: true,
        min: '0',
        max: '50',
      },
      {
        name: 'vehicleType',
        label: 'Vehicle Type',
        type: 'text',
        placeholder: 'Sedan, van, luxury SUV...',
      },
      { name: 'flightNumber', label: 'Flight Number', type: 'text', placeholder: 'Optional' },
      { name: 'childSeat', label: 'Child seat required', type: 'checkbox' },
      { name: 'budget', label: 'Budget', type: 'text', required: true },
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
  if (type === 'profile') {
    await profileService.saveProfile(
      tokenRecord.userId,
      parsed.data as z.infer<typeof basicProfileFormSchema>
    );
  } else {
    const serviceRequest = await profileService.saveServiceRequest(
      tokenRecord.userId,
      type,
      parsed.data as ServiceRequestForm
    );

    if (type === 'hotel') {
      await getHotelSearchSessionService().saveAwaitingPreferences(
        tokenRecord.userId,
        mapHotelRequestFormToCriteria(parsed.data as HotelRequestForm),
        {
          hotelFormResponseId: serviceRequest.id,
        }
      );
    }
  }

  tokenService.consumeToken(token, type);
  res.type('html').send(renderSuccessPage('Thank you', definition.successMessage));
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

export default router;
