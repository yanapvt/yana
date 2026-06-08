/**
 * WhatsApp Webhook Routes
 * Handles inbound WhatsApp messages from Twilio
 */

import { Router, Request, Response } from 'express';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { validateTwilioSignature } from '../middleware/twilioSignature.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { deduplicateWebhook } from '../middleware/deduplication.js';
import {
  normalizeInboundMessage,
  TwilioWebhookPayload,
} from '../utils/messageNormalizer.js';
import { getLLMService, LLMServiceError } from '../services/LLMService.js';
import { getHotelIntakeService } from '../services/HotelIntakeService.js';
import {
  getHotelSearchFlowService,
  type HotelSearchFlowResult,
} from '../services/HotelSearchFlowService.js';
import {
  getHotelSearchSessionService,
  type HotelSearchSession,
} from '../services/hotelSearchSessionService.js';
import { getFormTokenService } from '../services/formTokenService.js';
import { mapHotelRequestFormToCriteria } from '../services/hotelRequestMapper.js';
import { getPendingRequestService } from '../services/pendingRequestService.js';
import { getProfileGate } from '../services/profileGate.js';
import { getProfileService } from '../services/profileService.js';
import { getTwilioOutboundService } from '../services/twilioOutboundService.js';
import {
  buildHotelCollectionResponse,
  buildHotelFormLink,
  buildProfileCollectionResponse,
  buildProfileFormLink,
} from '../utils/formResponses.js';
import type { HotelRequestForm } from '../types/forms.js';
import type { InboundMessage } from '../types/core.js';
import type { HotelSearchCriteria } from '../services/HotelIntakeService.js';
import type { HotelBrowseResult } from '../services/GooglePlacesHotelBrowsingService.js';

const router = Router();

/**
 * POST /webhook/whatsapp
 * Twilio webhook ingress endpoint for inbound WhatsApp messages
 * 
 * Requirements: 1.1, 1.2, 1.5, 1.7, 18.1, 21.1
 * 
 * Flow:
 * 1. Assign Correlation_ID (middleware)
 * 2. Apply rate limiting (middleware)
 * 3. Validate Twilio signature (middleware)
 * 4. Deduplicate webhook delivery (middleware)
 * 5. Normalize message payload
 * 6. Require a stored profile before application orchestration
 * 7. Process the scoped MVP hotel intake flow, then fall back to LLM decision service
 * 8. Return TwiML response for Twilio to send back to WhatsApp
 */
router.post(
  '/webhook/whatsapp',
  assignCorrelationId,
  webhookRateLimiter,
  validateTwilioSignature,
  deduplicateWebhook,
  async (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const payload = req.body as TwilioWebhookPayload;

    try {
      // Normalize the inbound message
      const inboundMessage = normalizeInboundMessage(payload);

      console.log(
        `[${correlationId}] Normalized message from ${inboundMessage.from}: type=${inboundMessage.type}`
      );

      console.log(
        `[${correlationId}] Message received for processing:`,
        JSON.stringify(inboundMessage, null, 2)
      );

      const reply = await processInboundMessage(inboundMessage, correlationId);
      const whatsappReply = await enrichHotelResultsForWhatsApp(inboundMessage.from, reply);
      res.type('text/xml').status(200).send(toTwiml(whatsappReply));
    } catch (error) {
      // Log the error but still return 200 to Twilio
      // We don't want Twilio to retry on our internal errors
      console.error(
        `[${correlationId}] Error processing webhook:`,
        error
      );
      
      // If we haven't sent a response yet, send 200
      if (!res.headersSent) {
        res.status(200).send('');
      }
    }
  }
);

export async function processInboundMessage(
  inboundMessage: InboundMessage,
  correlationId: string
): Promise<string> {
  const profileGateResult = await getProfileGate().check(inboundMessage.from);

  if (!profileGateResult.complete) {
    await savePendingProfileGateRequest(inboundMessage, correlationId);
    await getHotelSearchSessionService().saveProfileRequired(
      inboundMessage.from,
      extractMessageText(inboundMessage) ?? undefined
    );
    const token = getFormTokenService().createToken(inboundMessage.from, 'profile');
    return buildProfileCollectionResponse(buildProfileFormLink(token));
  }

  const inboundText = extractMessageText(inboundMessage);
  const userContext = getInboundUserContext(inboundMessage);

  if (!inboundText) {
    console.log(
      `[${correlationId}] Skipping LLM decision: no text content available for message type=${inboundMessage.type}`
    );
    return 'I received your message, but I can only handle text messages in this test build.';
  }

  console.log(
    `[${correlationId}] Inbound user context:`,
    JSON.stringify(userContext, null, 2)
  );

  if (isResetCue(inboundText)) {
    return resetConversation(inboundMessage.from, userContext);
  }

  if (isResumeConversationCue(inboundText)) {
    const resumedReply = await resumeConversation(inboundMessage.from);
    if (resumedReply) {
      return resumedReply;
    }

    return buildWelcomeMessage(userContext);
  }

  const userMessage = await resolveUserMessageAfterProfileGate(
    inboundMessage.from,
    inboundText,
    correlationId
  );

  const activeHotelSearchReply = await handleActiveHotelSearchSession(
    inboundMessage.from,
    inboundText,
    correlationId
  );

  if (activeHotelSearchReply) {
    return activeHotelSearchReply;
  }

  const hotelFormReply = await handleHotelFormGate(
    inboundMessage.from,
    userMessage,
    inboundText,
    correlationId
  );

  if (hotelFormReply) {
    return hotelFormReply;
  }

  if (isResumeCue(inboundText)) {
    return buildPostProfileGreeting(inboundMessage.from, userContext);
  }

  if (isGreeting(userMessage)) {
    return buildWelcomeMessage(userContext);
  }

  const hotelIntakeResult = await getHotelIntakeService().handleMessage(
    userMessage,
    {
      whatsappNumber: inboundMessage.from,
      profileName: userContext.profileName,
      country: userContext.country,
      countryCode: userContext.countryCode,
    }
  );

  if (hotelIntakeResult.handled && hotelIntakeResult.completed && hotelIntakeResult.criteria) {
    const hotelSearchResult =
      await getHotelSearchFlowService().handleCompletedIntake(
        hotelIntakeResult.criteria,
        {
          correlationId,
          sessionId: inboundMessage.from,
          userLanguage: 'en',
        }
      );

    return hotelSearchResult.reply;
  }

  if (hotelIntakeResult.handled && hotelIntakeResult.reply) {
    return hotelIntakeResult.reply;
  }

  try {
    console.log(`[${correlationId}] Calling LLM decision service`);

    const decision = await getLLMService().decide({
      userMessage,
      userProfile: {
        nationality: userContext.country,
      },
      availableSchemas: ['search_hotels'],
    });

    console.log(
      `[${correlationId}] LLM decision received:`,
      JSON.stringify(decision, null, 2)
    );

    if (decision.suggestedAction === 'ask_missing' && decision.missingFields.length > 0) {
      if (decision.intent === 'greeting') {
        return buildWelcomeMessage(userContext);
      }

      return `I can help with ${decision.intent}. Please share: ${decision.missingFields.join(', ')}.`;
    }

    if (decision.suggestedAction === 'execute_tool') {
      if (decision.intent === 'search_hotels') {
        return buildHotelSearchReply(decision.parameters);
      }

      if (isHotelRelatedIntent(decision.intent)) {
        return 'I picked that up as part of a hotel search, but I do not have enough saved hotel details to run it cleanly. Please start with the city or area you want to stay in.';
      }

      return `Got it. I understood this as ${decision.intent}. This build is currently wired for hotel search first, so please tell me the city or area where you want to stay.`;
    }

    if (decision.suggestedAction === 'handoff') {
      return 'Thanks. I think this needs a human handoff, but handoff routing is not wired yet.';
    }

    return `I received your message and understood this as ${decision.intent}. Could you share a little more detail?`;
  } catch (error) {
    if (error instanceof LLMServiceError) {
      console.error(
        `[${correlationId}] LLM decision failed (${error.code}, retryable=${error.retryable}): ${error.message}`
      );
      return 'I received your message, but the AI service failed while processing it. Please check the server logs.';
    }

    throw error;
  }
}

async function handleHotelFormGate(
  userId: string,
  userMessage: string,
  inboundText: string,
  correlationId: string
): Promise<string | null> {
  if (isResumeCue(inboundText)) {
    const restoredHotelRequest = await restoreLatestHotelRequest(userId);
    if (restoredHotelRequest) {
      return restoredHotelRequest;
    }
  }

  if (isHotelRequestMessage(userMessage)) {
    const token = getFormTokenService().createToken(userId, 'hotel');
    const hotelFormResponse = buildHotelCollectionResponse(buildHotelFormLink(token));
    const profile = await getProfileService().getProfile(userId);
    await getHotelSearchSessionService().saveHotelFormSent(
      userId,
      userMessage,
      profile?.form
    );

    if (isResumeCue(inboundText) && userMessage !== inboundText) {
      return `${await buildPostProfileGreeting(userId)}\n\n${hotelFormResponse}`;
    }

    return hotelFormResponse;
  }

  return null;
}

async function handleActiveHotelSearchSession(
  userId: string,
  inboundText: string,
  correlationId: string
): Promise<string | null> {
  const sessionService = getHotelSearchSessionService();
  const session = await sessionService.get(userId);

  if (!session) {
    return null;
  }

  if (isGreeting(inboundText)) {
    return null;
  }

  if (session.stage === 'booking_provider_pending' || session.state === 'booking_provider_pending') {
    return session.selectedHotel
      ? buildBookingProviderBoundaryReply(session.selectedHotel.selectedHotelSnapshot.name)
      : 'I have your hotel selection saved. The booking provider check is the next integration boundary.';
  }

  if (session.stage === 'results') {
    const bookSelection = parseNumberedCue(inboundText, 'book');
    if (bookSelection) {
      const selectedHotel = await sessionService.selectHotel(userId, bookSelection);
      if (!selectedHotel) {
        return 'Please choose from the latest list only: book 1, book 2, or book 3.';
      }

      return buildBookingProviderBoundaryReply(selectedHotel.selectedHotelSnapshot.name);
    }

    const detailsSelection = parseNumberedCue(inboundText, 'details');
    if (detailsSelection) {
      const detailsReply = buildHotelDetailsReply(session, detailsSelection);
      if (detailsReply) {
        return detailsReply;
      }

      return 'Please choose from the latest list only: details 1, details 2, or details 3.';
    }

    if (isNextCue(inboundText)) {
      const resultBatches = getSessionResultBatches(session);
      const latestDisplayedBatchIndex =
        typeof session.latestDisplayedBatchIndex === 'number'
          ? session.latestDisplayedBatchIndex
          : session.nextOffset
            ? Math.ceil(session.nextOffset / 3) - 1
            : -1;
      const nextBatchIndex = latestDisplayedBatchIndex + 1;
      const page = resultBatches[nextBatchIndex] ?? [];
      if (page.length === 0) {
        return 'I have shown all 9 hotel suggestions for this search. Which hotel would you like me to help you book? Reply book 1, book 2, or book 3 from the latest list.';
      }

      const nextOffset = Math.min((nextBatchIndex + 1) * 3, session.results.length);
      await sessionService.saveResults(userId, session.criteria, session.results, nextOffset);

      return getHotelSearchFlowService().buildBrowseResultsPageReply(
        session.criteria,
        page,
        nextOffset,
        session.results.length
      );
    }

    const firstPage = session.results.slice(0, 3);
    if (firstPage.length > 0) {
      const nextOffset = Math.min(3, session.results.length);
      await sessionService.saveResults(userId, session.criteria, session.results, nextOffset);

      return getHotelSearchFlowService().buildBrowseResultsPageReply(
        session.criteria,
        firstPage,
        nextOffset,
        session.results.length
      );
    }

    return 'I finished checking, but I did not find usable hotel matches for this search. Please share a new location or budget and I will try again.';
  }

  if (session.stage === 'searching') {
    return 'Just a moment, I am still checking the best hotel matches for you. I will send the options here as soon as they are ready.';
  }

  if (session.stage !== 'awaiting_preferences') {
    return null;
  }

  if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
    return buildHotelPreferencePrompt(session.criteria);
  }

  const criteria = {
    ...session.criteria,
    additionalPreferences: isNoExtraPreferenceCue(inboundText) ? undefined : inboundText,
  };
  await sessionService.saveSearching(userId, criteria);

  const acknowledgement =
    'Just a moment while I check the best matches for you. I will send the top options here shortly.';

  void searchHotelsAndNotify(userId, criteria, correlationId);

  if (getTwilioOutboundService().isConfigured()) {
    return acknowledgement;
  }

  return `${acknowledgement}\n\nIf I take more than a few seconds, reply "status" and I'll show your saved results.`;
}

async function resetConversation(
  userId: string,
  userContext: InboundUserContext
): Promise<string> {
  await getHotelSearchSessionService().clear(userId);
  await getPendingRequestService().clearProfileGateRequest(userId);

  return `${buildWelcomeMessage(userContext)}\n\nI have cleared the active request. Tell me what you would like to do next, or say "resume" if you want me to check for a saved request.`;
}

async function resumeConversation(userId: string): Promise<string | null> {
  const hotelSession = await getHotelSearchSessionService().get(userId);

  if (!hotelSession) {
    return restoreLatestHotelRequest(userId);
  }

  if (hotelSession.stage === 'awaiting_preferences') {
    return buildHotelPreferencePrompt(hotelSession.criteria);
  }

  if (hotelSession.stage === 'searching') {
    return 'I am still checking the best hotel matches for you. I will send the options here as soon as they are ready.';
  }

  const firstPage = hotelSession.results.slice(0, 3);
  if (firstPage.length === 0) {
    return null;
  }

  const nextOffset = Math.min(3, hotelSession.results.length);
  await getHotelSearchSessionService().saveResults(
    userId,
    hotelSession.criteria,
    hotelSession.results,
    nextOffset
  );

  return getHotelSearchFlowService().buildBrowseResultsPageReply(
    hotelSession.criteria,
    firstPage,
    nextOffset,
    hotelSession.results.length
  );
}

async function restoreLatestHotelRequest(userId: string): Promise<string | null> {
  const latestHotelRequest = await getProfileService().getLatestServiceRequest(userId, 'hotel');

  if (latestHotelRequest?.type !== 'hotel') {
    return null;
  }

  const criteria = mapHotelRequestFormToCriteria(latestHotelRequest.form as HotelRequestForm);
  await getHotelSearchSessionService().saveAwaitingPreferences(userId, criteria);
  return buildHotelPreferencePrompt(criteria);
}

async function searchHotelsAndNotify(
  userId: string,
  criteria: HotelSearchCriteria,
  correlationId: string
): Promise<void> {
  try {
    const hotelSearchResult = await searchHotels(userId, criteria, correlationId);

    if (hotelSearchResult.browseResponse?.results.length) {
      const delivered = await getTwilioOutboundService().sendWhatsAppText(
        userId,
        hotelSearchResult.reply
      );
      await saveHotelSearchResults(
        userId,
        criteria,
        hotelSearchResult,
        delivered ? Math.min(3, hotelSearchResult.browseResponse.results.length) : 0
      );
      return;
    }

    await getTwilioOutboundService().sendWhatsAppText(userId, hotelSearchResult.reply);
  } catch (error) {
    console.error(`[${correlationId}] Hotel search failed after async acknowledgement:`, error);
    await getTwilioOutboundService().sendWhatsAppText(
      userId,
      'I am sorry, the hotel search failed while I was checking options. Your form details are saved, so please type "search again" and I will retry.'
    );
  }
}

function searchHotels(
  userId: string,
  criteria: HotelSearchCriteria,
  correlationId: string
): Promise<HotelSearchFlowResult> {
  return getHotelSearchFlowService().handleBrowseSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
}

async function saveHotelSearchResults(
  userId: string,
  criteria: HotelSearchCriteria,
  hotelSearchResult: HotelSearchFlowResult,
  nextOffset: number
): Promise<void> {
  if (hotelSearchResult.browseResponse?.results.length) {
    await getHotelSearchSessionService().saveResults(
      userId,
      criteria,
      hotelSearchResult.browseResponse.results,
      nextOffset
    );
  }
}

async function savePendingProfileGateRequest(
  inboundMessage: InboundMessage,
  correlationId: string
): Promise<void> {
  try {
    await getPendingRequestService().saveProfileGateRequest(inboundMessage);
  } catch (error) {
    console.error(`[${correlationId}] Failed to save pending profile-gate request:`, error);
  }
}

async function resolveUserMessageAfterProfileGate(
  userId: string,
  inboundText: string,
  correlationId: string
): Promise<string> {
  try {
    const pendingRequest = await getPendingRequestService().consumeProfileGateRequest(userId);

    if (pendingRequest && isResumeCue(inboundText)) {
      console.log(
        `[${correlationId}] Resuming pending profile-gate request from message ${pendingRequest.messageId}`
      );
      return pendingRequest.messageText;
    }
  } catch (error) {
    console.error(`[${correlationId}] Failed to consume pending profile-gate request:`, error);
  }

  return inboundText;
}

function extractMessageText(inboundMessage: InboundMessage): string | null {
  const { content } = inboundMessage;

  if (content.type === 'text') {
    return content.body.trim();
  }

  if (content.type === 'media') {
    return content.caption?.trim() || null;
  }

  if (content.type === 'interactive') {
    return content.selectedTitle?.trim() || content.selectedId.trim();
  }

  return null;
}

interface InboundUserContext {
  profileName?: string;
  country?: string;
  countryCode?: string;
}

function getInboundUserContext(inboundMessage: InboundMessage): InboundUserContext {
  const rawPayload = inboundMessage.metadata?.rawPayload as
    | TwilioWebhookPayload
    | undefined;
  const phoneNumber = inboundMessage.from.replace(/^whatsapp:/, '');
  const countryMatch = getCountryFromPhoneNumber(phoneNumber);

  return {
    profileName: cleanProfileName(rawPayload?.ProfileName),
    country: countryMatch?.country,
    countryCode: countryMatch?.countryCode,
  };
}

function cleanProfileName(profileName?: string): string | undefined {
  const cleaned = profileName?.replace(/[\u200e\u200f]/g, '').trim();
  return cleaned || undefined;
}

function isGreeting(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  return /^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening|start|menu)$/.test(
    normalized
  );
}

function isResumeCue(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  return /^(done|completed|complete|submitted|continue|resume|ok|okay|yes|profile done|i completed it|i submitted it)$/.test(
    normalized
  );
}

function isResetCue(message: string): boolean {
  return /^(restart|reset|start over|start again|new search|new request|clear|cancel)$/i.test(
    message.trim()
  );
}

function isResumeConversationCue(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  return /^(resume|continue|where were we|pick up|anything yet|waiting|still waiting|status|update|any update|check status|show results)$/.test(
    normalized
  ) || /^how long\b/.test(normalized);
}

function isNextCue(message: string): boolean {
  return /^(next|more|show more|next 3|another 3)$/i.test(message.trim());
}

function parseNumberedCue(message: string, action: 'book' | 'details'): number | null {
  const normalized = message.toLowerCase().trim();
  const pattern =
    action === 'book' ? /^(?:book\s*)?([1-3])$/ : /^details\s*([1-3])$/;
  const match = normalized.match(pattern);
  return match ? Number(match[1]) : null;
}

function isNoExtraPreferenceCue(message: string): boolean {
  return /^(no|none|nothing|nope|no extra|no preferences|nothing else|search|start search|go ahead)$/i.test(
    message.trim()
  );
}

function isHotelRequestMessage(message: string): boolean {
  return /\b(hotel|stay|accommodation|room|resort|bnb|b&b)\b/i.test(message);
}

function isHotelRelatedIntent(intent: string): boolean {
  return /hotel|stay|check_?in|check_?out|guest|pax|meal|board|budget|room/i.test(intent);
}

function buildWelcomeMessage(context: InboundUserContext): string {
  const greeting = context.profileName ? `Hi ${context.profileName}` : 'Hi';
  const countryContext = context.country
    ? ` I see you are messaging from ${context.country}, so I will keep that context in mind.`
    : '';

  return `${greeting}, I am Yana, your personal tour concierge.${countryContext} I can help with hotels, transport, restaurants, excursions, itinerary planning, local recommendations, or anything else you need while planning your tour. How can I help you today?`;
}

async function buildPostProfileGreeting(
  userId: string,
  fallbackContext: InboundUserContext = {}
): Promise<string> {
  const profile = await getProfileService().getProfile(userId);
  const name = profile?.form.preferredName || fallbackContext.profileName;
  const greeting = name ? `Hi ${name}` : 'Hi';

  return `${greeting}, I am Yana, your personal tour concierge. Thank you for the information, I will keep that context in mind. I can help with hotels, transport, restaurants, excursions, itinerary planning, local recommendations, or anything else you need while planning your tour. How can I help you today?`;
}

function buildHotelPreferencePrompt(criteria: HotelSearchCriteria): string {
  return [
    "Great! I've gathered the following details from your search form:",
    '',
    `Destination: ${criteria.location ?? 'Not provided'}`,
    `Check-in: ${criteria.checkinDate ?? 'Not provided'}`,
    `Check-out: ${criteria.checkoutDate ?? 'Not provided'}`,
    `Guests: ${criteria.guests ?? 'Not provided'}`,
    `Rooms: ${criteria.rooms ?? 'Not provided'}`,
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

function buildHotelDetailsReply(
  session: HotelSearchSession,
  displayNumber: number
): string | null {
  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  if (!session || latestDisplayedBatchIndex < 0) {
    return null;
  }

  const hotel = getSessionResultBatches(session)[latestDisplayedBatchIndex]?.[displayNumber - 1];
  if (!hotel) {
    return null;
  }

  const lines = [
    `${displayNumber}. ${hotel.name}`,
    hotel.rating
      ? `Rating: ${hotel.rating.toFixed(1)}/5${hotel.reviewCount ? ` (${hotel.reviewCount} reviews)` : ''}`
      : undefined,
    hotel.priceRange ? `Price signal: ${hotel.priceRange}` : 'Price signal: confirm live rate',
    hotel.address ? `Address: ${hotel.address}` : undefined,
    hotel.googleMapsUri ? `Map: ${hotel.googleMapsUri}` : undefined,
    hotel.thumbnailUrl ? `Thumbnail: ${hotel.thumbnailUrl}` : undefined,
    '',
    `Reply "book ${displayNumber}" if you would like me to prepare the booking check for this hotel.`,
  ].filter((line): line is string => typeof line === 'string');

  return lines.join('\n');
}

async function enrichHotelResultsForWhatsApp(
  userId: string,
  fallbackMessage: string
): Promise<TwilioReply> {
  const session = await getHotelSearchSessionService().get(userId);

  if (!session || session.stage !== 'results') {
    return fallbackMessage;
  }

  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  const latestBatch = getSessionResultBatches(session)[latestDisplayedBatchIndex] ?? [];
  if (latestBatch.length === 0 || !fallbackMessage.startsWith('I found these hotel matches')) {
    return fallbackMessage;
  }

  return buildHotelResultCardReply(session.criteria, latestBatch, fallbackMessage);
}

interface TwilioMessage {
  body: string;
  mediaUrl?: string;
}

type TwilioReply = string | TwilioMessage[];

function buildHotelResultCardReply(
  criteria: HotelSearchCriteria,
  hotels: HotelBrowseResult[],
  fallbackMessage: string
): TwilioMessage[] {
  const intro = [
    `I found these hotel matches for ${criteria.location ?? 'your search'}.`,
    criteria.additionalPreferences ? `I included your preference: ${criteria.additionalPreferences}.` : undefined,
    'Reply "next" for more options, "details 1", or "book 1".',
  ].filter((line): line is string => typeof line === 'string');

  return [
    { body: intro.join('\n') },
    ...hotels.map((hotel, index) => buildHotelResultCard(index + 1, hotel)),
  ];
}

function buildHotelResultCard(displayNumber: number, hotel: HotelBrowseResult): TwilioMessage {
  const rating =
    typeof hotel.rating === 'number'
      ? `${hotel.rating.toFixed(1)}/5${hotel.reviewCount ? ` (${hotel.reviewCount} reviews)` : ''}`
      : 'Rating not listed';
  const mapsLink = buildGoogleMapsShortLink(hotel);
  const lines = [
    `${displayNumber}. ${hotel.name}`,
    rating,
    hotel.priceRange ? `Price signal: ${hotel.priceRange}` : 'Price signal: confirm live rate',
    hotel.address,
    mapsLink ? `View on Google Maps: ${mapsLink}` : undefined,
    `Reply "book ${displayNumber}" or "details ${displayNumber}".`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(hotel.thumbnailUrl) ? hotel.thumbnailUrl : undefined,
  };
}

function buildGoogleMapsShortLink(hotel: HotelBrowseResult): string | undefined {
  if (!hotel.id) {
    return hotel.googleMapsUri;
  }

  return `${getPublicBaseUrl()}/places/google/${encodeURIComponent(hotel.id)}`;
}

function getPublicBaseUrl(): string {
  const publicBaseUrl =
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`;

  return publicBaseUrl.replace(/\/$/, '');
}

function isPublicHttpsUrl(value?: string): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

function getSessionResultBatches(session: HotelSearchSession) {
  if (session.resultBatches?.length) {
    return session.resultBatches;
  }

  const batches = [];
  for (let index = 0; index < session.results.length; index += 3) {
    batches.push(session.results.slice(index, index + 3));
  }
  return batches;
}

function buildBookingProviderBoundaryReply(hotelName: string): string {
  return [
    `Perfect — I've selected ${hotelName} for you.`,
    '',
    "I'll now check live room availability, final rates, cancellation terms, and booking options for your dates.",
    '',
    "This booking check will be connected to our hotel booking providers next, such as Hotelbeds or LiteAPI. For now, I've saved your selected hotel and booking request so we can continue from here.",
  ].join('\n');
}

function formatBoardBasisForUser(
  boardBasis: NonNullable<HotelSearchCriteria['boardBasis']>
): string {
  const labels = {
    room_only: 'Room only',
    bnb: 'Breakfast included',
    half_board: 'Half board',
    full_board: 'Full board',
    all_inclusive: 'All inclusive',
  };

  return labels[boardBasis];
}

function getCountryFromPhoneNumber(
  phoneNumber: string
): { countryCode: string; country: string } | null {
  const digits = phoneNumber.replace(/[^\d+]/g, '');
  const countryCodes: Array<[string, string]> = [
    ['+94', 'Sri Lanka'],
    ['+91', 'India'],
    ['+44', 'the United Kingdom'],
    ['+1', 'the United States or Canada'],
    ['+61', 'Australia'],
    ['+971', 'the United Arab Emirates'],
    ['+966', 'Saudi Arabia'],
    ['+974', 'Qatar'],
    ['+965', 'Kuwait'],
    ['+65', 'Singapore'],
    ['+60', 'Malaysia'],
    ['+49', 'Germany'],
    ['+33', 'France'],
    ['+39', 'Italy'],
    ['+31', 'the Netherlands'],
  ];

  const match = countryCodes.find(([countryCode]) =>
    digits.startsWith(countryCode)
  );

  return match ? { countryCode: match[0], country: match[1] } : null;
}

function buildHotelSearchReply(parameters: Record<string, unknown>): string {
  const location = getStringParam(parameters, ['location', 'destination', 'city']);
  const budget = getBudgetParam(parameters);
  const checkin = getStringParam(parameters, ['checkin', 'checkin_date', 'check_in']);
  const checkout = getStringParam(parameters, ['checkout', 'checkout_date', 'check_out']);
  const criteria: string[] = [];

  if (location) {
    criteria.push(`location: ${location}`);
  }

  if (budget) {
    criteria.push(`budget: ${budget}`);
  }

  if (checkin) {
    criteria.push(`check-in: ${checkin}`);
  }

  if (checkout) {
    criteria.push(`check-out: ${checkout}`);
  }

  const criteriaText = criteria.length > 0 ? ` for ${criteria.join(', ')}` : '';

  return `I found your hotel search${criteriaText}. I am ready to search live property matches once Google Places is configured for this environment.`;
}

function getStringParam(
  parameters: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getBudgetParam(parameters: Record<string, unknown>): string | null {
  const directBudget = getStringParam(parameters, ['budget', 'price_range']);

  if (directBudget) {
    return directBudget;
  }

  const maxPrice = parameters.max_price ?? parameters.price_max ?? parameters.maxBudget;
  const currency = parameters.currency;

  if (typeof maxPrice === 'number') {
    return `${typeof currency === 'string' ? currency : 'USD'} ${maxPrice}`;
  }

  if (typeof maxPrice === 'string' && maxPrice.trim()) {
    return maxPrice.trim();
  }

  return null;
}

function toTwiml(reply: TwilioReply): string {
  const messages =
    typeof reply === 'string'
      ? [`<Message>${escapeXml(reply)}</Message>`]
      : reply.map((message) => {
          const parts = [
            '<Message>',
            `<Body>${escapeXml(message.body)}</Body>`,
            message.mediaUrl ? `<Media>${escapeXml(message.mediaUrl)}</Media>` : undefined,
            '</Message>',
          ].filter((part): part is string => typeof part === 'string');

          return parts.join('');
        });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    ...messages,
    '</Response>',
  ].join('');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
