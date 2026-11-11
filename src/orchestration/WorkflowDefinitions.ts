import { z } from 'zod';
import type { OrchestrationFlow } from './Orchestrator.js';
import { SchemaEngine } from '../services/SchemaEngine.js';
import { memoryCandidateSchema } from './TravellerMemory.js';

const text = z.string().trim().min(1).max(500);
const count = z.number().int().min(1).max(100);
export const travelDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  'Invalid calendar date'
);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fields: Record<string, z.ZodTypeAny> = {
  location: text, destination: text, pickupLocation: text, checkinDate: travelDate, checkoutDate: travelDate,
  pickupDate: travelDate, pickupTime: time, diningDate: travelDate, diningTime: time,
  arrivalDate: travelDate, departureDate: travelDate, preferredDate: travelDate, preferredTime: time,
  guests: count, adults: count, children: z.number().int().min(0).max(50), rooms: count, passengers: count,
  boardBasis: z.enum(['room_only', 'bnb', 'half_board', 'full_board', 'all_inclusive']),
  budgetPerNight: z.object({ amount: z.number().positive().finite(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  interests: z.array(text).max(20),
};
export const WORKFLOW_DEFINITIONS = {
  hotel: { schema: 'search_hotels', required: ['location', 'checkinDate', 'checkoutDate', 'guests'], requestRequired: ['location', 'checkinDate', 'checkoutDate', 'guests', 'rooms'],
    fields: ['location', 'checkinDate', 'checkoutDate', 'guests', 'rooms', 'boardBasis', 'budgetPerNight', 'starRating', 'hotelType', 'facilities', 'bedPreference', 'specialOccasion', 'additionalPreferences'] },
  restaurant: { schema: 'search_restaurants', required: ['location'], requestRequired: ['location', 'diningDate', 'diningTime', 'guests', 'priceRange'],
    fields: ['location', 'diningDate', 'diningTime', 'guests', 'cuisine', 'priceRange', 'diningStyle', 'dietaryRequirements', 'allergies', 'indoorOutdoor', 'specialOccasion', 'seatingPreference', 'additionalPreferences'] },
  excursion: { schema: 'search_excursions', required: ['destination'], requestRequired: ['destination', 'preferredDate', 'preferredTime', 'guests', 'budget'],
    fields: ['destination', 'preferredDate', 'preferredTime', 'guests', 'category', 'tourType', 'budget', 'duration', 'fitnessLevel', 'activityType', 'experienceCategory', 'additionalPreferences'] },
  logistics: { schema: 'search_transport', required: ['pickupLocation', 'destination', 'pickupDate', 'passengers'], requestRequired: ['pickupLocation', 'destination', 'pickupDate', 'pickupTime', 'passengers'],
    fields: ['pickupLocation', 'destination', 'pickupDate', 'pickupTime', 'passengers', 'vehicleType', 'luggage', 'childSeatsRequired', 'accessibility', 'journeyType', 'preferredProvider', 'specialRequirements', 'flightNumber', 'budget', 'additionalPreferences'] },
  itinerary: { schema: 'plan_itinerary', required: ['arrivalDate', 'departureDate', 'adults'], requestRequired: ['arrivalDate', 'arrivalTime', 'departureDate', 'departureTime', 'adults', 'budget', 'travelStyle'],
    fields: ['arrivalAirport', 'arrivalDate', 'arrivalTime', 'departureAirport', 'departureDate', 'departureTime', 'adults', 'children', 'childAges', 'budget', 'accommodationStyle', 'travelStyle', 'interests', 'preferredTransport', 'walkingPreference', 'specialRequirements', 'additionalPreferences'] },
} as const;
export type ServiceFlow = keyof typeof WORKFLOW_DEFINITIONS;
export const WORKFLOW_SCHEMA_VERSION = '1.0';
export function workflow(flow: OrchestrationFlow) {
  return flow in WORKFLOW_DEFINITIONS ? WORKFLOW_DEFINITIONS[flow as ServiceFlow] : undefined;
}
const normalize = (field: string) => field.replace(/[_-]/g, '').toLowerCase();
export function canonicalField(flow: OrchestrationFlow, field: string): string | undefined {
  const aliases: Record<string, string> = flow === 'logistics'
    ? { dropofflocation: 'destination', date: 'pickupDate', time: 'pickupTime' }
    : flow === 'hotel' ? { destination: 'location', checkin: 'checkinDate', checkout: 'checkoutDate', mealplan: 'boardBasis' }
    : flow === 'excursion' ? { location: 'destination' } : flow === 'restaurant' ? { destination: 'location' } : {};
  return aliases[normalize(field)] ?? workflow(flow)?.fields.find((key) => normalize(key) === normalize(field));
}
export function validateCriteria(flow: OrchestrationFlow, input: Record<string, unknown>, strict = true): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const key = canonicalField(flow, field);
    if (!key) { if (strict) throw new Error('Unapproved workflow field'); else continue; }
    const parsed = (fields[key] ?? (key.endsWith('Time') ? time : text)).safeParse(value);
    if (!parsed.success) { if (strict) throw new Error('Invalid workflow value'); else continue; }
    if (key in result && JSON.stringify(result[key]) !== JSON.stringify(parsed.data)) throw new Error('Conflicting field aliases');
    result[key] = parsed.data;
  }
  for (const [start, end] of [['checkinDate', 'checkoutDate'], ['arrivalDate', 'departureDate']]) {
    if (typeof result[start] === 'string' && typeof result[end] === 'string' && result[end] <= result[start]) {
      if (strict) throw new Error('Invalid date order');
      delete result[end];
    }
  }
  return result;
}
export function missingFields(flow: OrchestrationFlow, input: Record<string, unknown>, required?: readonly string[]): string[] {
  const values = validateCriteria(flow, input, false);
  const definition = workflow(flow);
  return new SchemaEngine().getMissingFields({ schemaName: definition?.schema ?? flow, version: WORKFLOW_SCHEMA_VERSION,
    requiredFields: [...(required ?? definition?.required ?? [])], optionalFields: [], fields: {} }, values);
}

export const decisionOutputSchema = z.object({
  contractVersion: z.literal('2.0').default('2.0'),
  responseText: z.string().trim().max(4096).default(''),
  intent: z.string().min(1).max(80), parameters: z.record(z.unknown()),
  intentConfidence: z.number().finite().min(0).max(1).optional(),
  ambiguity: z.object({
    isAmbiguous: z.boolean(), alternatives: z.array(z.string().min(1).max(80)).max(5),
    reason: z.string().trim().max(500).optional(),
  }).strict().default({ isAmbiguous: false, alternatives: [] }),
  clarificationRequired: z.boolean().default(false),
  clarificationQuestion: z.string().trim().min(1).max(500).optional(),
  fieldUpdates: z.record(z.unknown()).default({}),
  memoryCandidates: z.array(memoryCandidateSchema).max(12).default([]),
  missingFields: z.array(z.string().min(1).max(80)).max(30),
  taskTransition: z.enum(['continue', 'pause', 'resume', 'switch', 'none']).default('none'),
  recommendedSchema: z.string().min(1).max(80).optional(),
  uiRecommendation: z.object({
    mode: z.enum(['chat_reply', 'clarification', 'clarification_form', 'results_list', 'itinerary_editor', 'confirmation']),
    schemaId: z.string().min(1).max(80).optional(),
  }).strict().optional(),
  proposedAction: z.object({
    // Proposals are advisory. Do not let arbitrary tool names, transaction
    // identifiers, or unvalidated criteria cross this boundary.
    name: z.enum(['none', 'search', 'open_form', 'handoff']),
    arguments: z.object({ schemaId: z.string().min(1).max(80).optional() }).strict().default({}),
  }).strict().optional(),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  suggestedAction: z.enum(['ask_missing', 'execute_tool', 'clarify', 'handoff']),
  confidence: z.number().finite().min(0).max(1), reasoning: z.string().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.intentConfidence !== undefined && Math.abs(value.intentConfidence - value.confidence) > 0.001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['intentConfidence'], message: 'Confidence fields must agree' });
  }
  if ((value.clarificationRequired || value.ambiguity.isAmbiguous) && !value.clarificationQuestion) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['clarificationQuestion'], message: 'Clarification question required' });
  }
  const allowedSchemas = new Set([...Object.values(WORKFLOW_DEFINITIONS).map((item) => item.schema), 'general_inquiry']);
  if (value.recommendedSchema && !allowedSchemas.has(value.recommendedSchema)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['recommendedSchema'], message: 'Unregistered schema' });
  }
  if (value.uiRecommendation?.schemaId && !allowedSchemas.has(value.uiRecommendation.schemaId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['uiRecommendation', 'schemaId'], message: 'Unregistered UI schema' });
  }
  if (value.proposedAction?.arguments.schemaId && !allowedSchemas.has(value.proposedAction.arguments.schemaId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['proposedAction', 'arguments', 'schemaId'], message: 'Unregistered action schema' });
  }
});
