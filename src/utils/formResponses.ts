import { renderWhatsAppDecision } from '../orchestration/SemanticUI.js';
import { WORKFLOW_DEFINITIONS } from '../orchestration/WorkflowDefinitions.js';
import { getFormTokenService } from '../services/formTokenService.js';
import type { FormType } from '../types/forms.js';

function collectionReply(type: FormType, text: string, link: string): string {
  const flow = type.replace(/_booking$/, '') as keyof typeof WORKFLOW_DEFINITIONS | 'profile';
  const token = new URL(link).pathname.split('/').at(-1)!;
  const record = getFormTokenService().resolveToken(decodeURIComponent(token), type);
  return renderWhatsAppDecision({ version: '1.0', mode: 'clarification_form', formId: type,
    workflow: flow, schemaId: flow === 'profile' ? 'profile' : WORKFLOW_DEFINITIONS[flow].schema,
    schemaVersion: '1.0', values: {}, missingFields: [], actions: ['submit_form'], text,
    correlationId: record?.workflowId ?? record?.requestId ?? 'form-invitation', expectedRevision: record?.workflowRevision ?? 0 }).text;
}

export function buildProfileFormLink(token: string): string {
  return buildFormLink('profile', token);
}

export function buildHotelFormLink(token: string): string {
  return buildFormLink('hotel', token);
}

export function buildRestaurantFormLink(token: string): string {
  return buildFormLink('restaurant', token);
}

export function buildItineraryFormLink(token: string): string {
  return buildFormLink('itinerary', token);
}

export function buildExcursionFormLink(token: string): string {
  return buildFormLink('excursion', token);
}

export function buildExcursionBookingFormLink(token: string): string {
  return buildFormLink('excursion_booking', token);
}

export function buildLogisticsFormLink(token: string): string {
  return buildFormLink('logistics', token);
}

export function buildLogisticsBookingFormLink(token: string): string {
  return buildFormLink('logistics_booking', token);
}

function buildFormLink(formType: string, token: string): string {
  const publicBaseUrl =
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`;

  return `${publicBaseUrl.replace(/\/$/, '')}/forms/${formType}/${encodeURIComponent(token)}`;
}

export function buildProfileCollectionResponse(formLink: string, whatsappName?: string): string {
  const greeting = whatsappName?.trim() ? `Hi ${whatsappName.trim()}, ` : '';
  return collectionReply('profile', [
    `${greeting}welcome to YANA, your personal Travel & Tour Concierge. To personalize your experience and provide the best recommendations, please complete this quick profile:`,
    '',
    formLink,
    '',
    "Once completed, I'll continue assisting you.",
  ].join('\n'), formLink);
}

export function buildHotelCollectionResponse(formLink: string): string {
  return collectionReply('hotel', [
    'Great, I can help with hotels. Please complete this quick hotel request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}

export function buildRestaurantCollectionResponse(formLink: string): string {
  return collectionReply('restaurant', [
    'Great, I can help with restaurants. Please complete this quick dining request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}

export function buildItineraryCollectionResponse(formLink: string): string {
  return collectionReply('itinerary', [
    'Wonderful, I can help plan the full trip. Please complete this quick itinerary form so I can build the route around your dates, interests, transport, and pace:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}

export function buildExcursionCollectionResponse(formLink: string): string {
  return collectionReply('excursion', [
    'Great, I can help with experiences and excursions. Please complete this quick excursion request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}

export function buildExcursionBookingCollectionResponse(formLink: string): string {
  return collectionReply('excursion_booking', [
    'Perfect. Please complete this short booking request form so I can prepare the availability check:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}

export function buildLogisticsCollectionResponse(formLink: string): string {
  return collectionReply('logistics', [
    'Great, I can help with transport. Please complete this quick transport request form so I can search with the right details:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}

export function buildLogisticsBookingCollectionResponse(formLink: string): string {
  return collectionReply('logistics_booking', [
    'Please complete this short transport quote-request form. This does not book a vehicle or confirm availability or price:',
    '',
    formLink,
    '',
    "Once submitted, I'll continue here automatically.",
  ].join('\n'), formLink);
}
