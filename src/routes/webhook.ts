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
import {
  getRestaurantSearchSessionService,
  type RestaurantSearchSession,
} from '../services/restaurantSearchSessionService.js';
import {
  getExcursionSearchSessionService,
  type ExcursionSearchSession,
} from '../services/excursionSearchSessionService.js';
import {
  getLogisticsSearchSessionService,
  type LogisticsSearchSession,
} from '../services/logisticsSearchSessionService.js';
import {
  getItinerarySessionService,
  type ItinerarySession,
} from '../services/itinerarySessionService.js';
import {
  getItineraryPlannerService,
  type GeneratedItinerary,
  type DailyItineraryPlan,
} from '../services/ItineraryPlannerService.js';
import {
  getRestaurantSearchFlowService,
  type RestaurantSearchFlowResult,
} from '../services/RestaurantSearchFlowService.js';
import {
  getExcursionSearchFlowService,
  type ExcursionSearchFlowResult,
} from '../services/ExcursionSearchFlowService.js';
import {
  getLogisticsSearchFlowService,
  type LogisticsSearchFlowResult,
} from '../services/LogisticsSearchFlowService.js';
import { getFormTokenService } from '../services/formTokenService.js';
import { mapHotelRequestFormToCriteria } from '../services/hotelRequestMapper.js';
import {
  mapRestaurantRequestFormToCriteria,
  type RestaurantSearchCriteria,
} from '../services/restaurantRequestMapper.js';
import {
  mapExcursionRequestFormToCriteria,
  type ExcursionSearchCriteria,
} from '../services/excursionRequestMapper.js';
import {
  mapLogisticsRequestFormToCriteria,
  type LogisticsSearchCriteria,
} from '../services/logisticsRequestMapper.js';
import {
  mapItineraryRequestFormToCriteria,
  type ItineraryCriteria,
} from '../services/itineraryRequestMapper.js';
import { getPendingRequestService } from '../services/pendingRequestService.js';
import { getProfileGate } from '../services/profileGate.js';
import { getProfileService } from '../services/profileService.js';
import {
  getTwilioOutboundService,
  splitWhatsAppText,
  type WhatsAppOutboundMessage,
} from '../services/twilioOutboundService.js';
import { getOpenWaOutboundService } from '../services/OpenWaOutboundService.js';
import { getMetaWhatsAppOutboundService } from '../services/MetaWhatsAppOutboundService.js';
import { env } from '../config/environment.js';
import { getItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';
import { getConversationManager } from '../services/ConversationManager.js';
import {
  getSpeechToTextService,
  isSupportedVoiceContentType,
  SpeechToTextServiceError,
} from '../services/SpeechToTextService.js';
import { getTextToSpeechService, isTextToSpeechEnabled } from '../services/TextToSpeechService.js';
import {
  buildHotelCollectionResponse,
  buildHotelFormLink,
  buildItineraryCollectionResponse,
  buildItineraryFormLink,
  buildExcursionBookingCollectionResponse,
  buildExcursionBookingFormLink,
  buildExcursionCollectionResponse,
  buildExcursionFormLink,
  buildLogisticsBookingCollectionResponse,
  buildLogisticsBookingFormLink,
  buildLogisticsCollectionResponse,
  buildLogisticsFormLink,
  buildProfileCollectionResponse,
  buildProfileFormLink,
  buildRestaurantCollectionResponse,
  buildRestaurantFormLink,
} from '../utils/formResponses.js';
import type { ExcursionRequestForm, HotelRequestForm, ItineraryRequestForm, LogisticsRequestForm, RestaurantRequestForm } from '../types/forms.js';
import type { InboundMessage } from '../types/core.js';
import type { HotelSearchCriteria } from '../services/HotelIntakeService.js';
import type { HotelBrowseResult } from '../services/GooglePlacesHotelBrowsingService.js';
import type { RestaurantBrowseResult } from '../services/GooglePlacesRestaurantBrowsingService.js';
import type { ExcursionBrowseResult } from '../services/GooglePlacesExcursionBrowsingService.js';
import type { TransportOption } from '../services/TransportProvider.js';
import { handleTravelFailure, logSafeOperatorFailure } from '../services/SafeFailureService.js';
import { getHumanHandoffRuntime } from '../services/handoff/HumanHandoffRuntime.js';
import { getHotelRecheckReceiptService } from '../services/handoff/HotelRecheckReceiptService.js';

const router = Router();
const VOICE_TRANSCRIPTION_ERROR_MESSAGE =
  "Sorry, I couldn't clearly read that voice note. Could you send it again or type your request?";
const VOICE_OPENAI_CONFIG_ERROR_MESSAGE =
  'Voice notes are temporarily unavailable. Please type your request for now or ask for human help.';
const VOICE_TWILIO_CONFIG_ERROR_MESSAGE =
  'I cannot access that voice note right now. Please type your request or ask for human help.';
const VOICE_DOWNLOAD_ERROR_MESSAGE =
  "Sorry, I couldn't download that voice note from WhatsApp. Could you send it again or type your request?";
const VOICE_TOO_LARGE_ERROR_MESSAGE =
  'That voice note is too large for me to process here. Could you send a shorter one or type your request?';
const UNSUPPORTED_MEDIA_MESSAGE =
  'Sorry, I can only read text and WhatsApp voice notes right now. Could you type your request or send a voice note?';

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

      const { inboundMessage: normalizedInput, reply } = await processWebhookPayload(
        payload,
        correlationId,
        inboundMessage
      );
      const whatsappReply = await buildWebhookReply(
        normalizedInput.from,
        reply,
        normalizedInput.inputType === 'voice',
        correlationId
      );
      const twiml = toTwiml(whatsappReply);
      const deliveredAsync = await deliverWebhookReplyThroughTwilio(
        normalizedInput.from,
        normalizedInput.to,
        whatsappReply,
        correlationId
      );
      if (deliveredAsync) {
        console.log(
          `[${correlationId}] Sent WhatsApp reply through Twilio REST; returning empty TwiML`
        );
        res.type('text/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        return;
      }

      console.log(
        `[${correlationId}] Sending WhatsApp TwiML reply (${twiml.length} chars)`
      );
      res.type('text/xml').status(200).send(twiml);
    } catch (error) {
      // Log the error but still return 200 to Twilio
      // We don't want Twilio to retry on our internal errors
      logSafeOperatorFailure(console, 'webhook_processing_failed', correlationId, error);
      
      // If we haven't sent a response yet, send a friendly message instead of a blank 200.
      if (!res.headersSent) {
        res
          .type('text/xml')
          .status(200)
          .send(toTwiml("Sorry, I hit a temporary issue while replying. Please send that again and I'll pick it up."));
      }
    }
  }
);

export async function processWebhookPayload(
  payload: TwilioWebhookPayload,
  correlationId: string,
  normalizedMessage = normalizeInboundMessage(payload)
): Promise<{ inboundMessage: InboundMessage; reply: string }> {
  return processNormalizedInboundMessage(normalizedMessage, correlationId);
}

export async function processNormalizedInboundMessage(
  inboundMessage: InboundMessage,
  correlationId: string
): Promise<{ inboundMessage: InboundMessage; reply: string }> {
  const voiceInput = await transcribeVoiceInputIfNeeded(inboundMessage, correlationId);

  if (voiceInput.status === 'error') {
    return {
      inboundMessage,
      reply: voiceInput.message,
    };
  }

  const reply = await processInboundMessage(voiceInput.inboundMessage, correlationId, {
    voicePreferred: Boolean(voiceInput.transcript),
  });
  if (voiceInput.transcript) {
    return {
      inboundMessage: voiceInput.inboundMessage,
      reply: `I heard: "${voiceInput.transcript}"\n\n${reply}`,
    };
  }

  return {
    inboundMessage: voiceInput.inboundMessage,
    reply,
  };
}

export async function processInboundMessage(
  inboundMessage: InboundMessage,
  correlationId: string,
  options: { voicePreferred?: boolean } = {}
): Promise<string> {
  const inboundText = extractMessageText(inboundMessage);

  if (inboundText && isFlightServiceRequestMessage(inboundText)) {
    return buildUnsupportedFlightServiceReply();
  }

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

  if (isFlightServiceRequestMessage(userMessage)) {
    return buildUnsupportedFlightServiceReply();
  }

  const explicitServiceSwitchReply = await handleExplicitServiceSwitch(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (explicitServiceSwitchReply) {
    return explicitServiceSwitchReply;
  }

  const activeItinerarySession = await getItinerarySessionService().get(inboundMessage.from);
  const activeItineraryReply = await handleActiveItinerarySession(
    inboundMessage.from,
    userMessage,
    inboundText,
    correlationId,
    activeItinerarySession
  );

  if (activeItineraryReply) {
    return activeItineraryReply;
  }

  const itineraryFormReply = await handleItineraryFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (itineraryFormReply) {
    return itineraryFormReply;
  }

  const latestItineraryContinuationReply = await handleLatestItineraryRequestContinuation(
    inboundMessage.from,
    userMessage,
    inboundText,
    correlationId
  );

  if (latestItineraryContinuationReply) {
    return latestItineraryContinuationReply;
  }

  const activeRestaurantSession = await getRestaurantSearchSessionService().get(inboundMessage.from);
  const activeRestaurantSearchReply = await handleActiveRestaurantSearchSession(
    inboundMessage.from,
    inboundMessage.to,
    userMessage,
    inboundText,
    correlationId,
    activeRestaurantSession,
    options
  );

  if (activeRestaurantSearchReply) {
    return activeRestaurantSearchReply;
  }

  const restaurantFormReply = await handleRestaurantFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (restaurantFormReply) {
    return restaurantFormReply;
  }

  const activeExcursionSession = await getExcursionSearchSessionService().get(inboundMessage.from);
  const activeExcursionSearchReply = await handleActiveExcursionSearchSession(
    inboundMessage.from,
    inboundMessage.to,
    userMessage,
    inboundText,
    correlationId,
    activeExcursionSession,
    options
  );

  if (activeExcursionSearchReply) {
    return activeExcursionSearchReply;
  }

  const excursionFormReply = await handleExcursionFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (excursionFormReply) {
    return excursionFormReply;
  }

  const activeLogisticsSession = await getLogisticsSearchSessionService().get(inboundMessage.from);
  const activeLogisticsSearchReply = await handleActiveLogisticsSearchSession(
    inboundMessage.from,
    inboundMessage.to,
    userMessage,
    inboundText,
    correlationId,
    activeLogisticsSession,
    options
  );

  if (activeLogisticsSearchReply) {
    return activeLogisticsSearchReply;
  }

  const logisticsFormReply = await handleLogisticsFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (logisticsFormReply) {
    return logisticsFormReply;
  }

  const activeHotelSession = await getHotelSearchSessionService().get(inboundMessage.from);
  const conversationRoute = await routeActiveConversation(
    userMessage,
    activeHotelSession,
    correlationId
  );

  if (conversationRoute.action === 'start_new_hotel_search') {
    return startFreshHotelSearch(inboundMessage.from, userMessage);
  }

  if (conversationRoute.action === 'reset_current_flow') {
    return resetConversation(inboundMessage.from, userContext);
  }

  const activeHotelSearchReply = await handleActiveHotelSearchSession(
    inboundMessage.from,
    inboundMessage.to,
    inboundText,
    correlationId,
    activeHotelSession,
    options
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

      return (await getConversationManager().createMessage({
        userInput: userMessage,
        profile: userContext,
        interpretation: {
          intent: decision.intent,
          entities: decision.parameters,
          confidence: decision.confidence,
        },
        decision,
        missingFields: decision.missingFields,
      })).text;
    }

    if (decision.suggestedAction === 'execute_tool') {
      if (isItineraryRelatedIntent(decision.intent) || isItineraryRequestMessage(userMessage)) {
        await clearCompetingSearchSessions(inboundMessage.from, 'itinerary');
        const token = getFormTokenService().createToken(inboundMessage.from, 'itinerary');
        const itineraryFormResponse = buildItineraryCollectionResponse(buildItineraryFormLink(token));
        const profile = await getProfileService().getProfile(inboundMessage.from);
        await getItinerarySessionService().saveFormSent(
          inboundMessage.from,
          userMessage,
          profile?.form
        );
        return itineraryFormResponse;
      }

      if (isRestaurantRelatedIntent(decision.intent) || isRestaurantRequestMessage(userMessage)) {
        await clearCompetingSearchSessions(inboundMessage.from, 'restaurant');
        const token = getFormTokenService().createToken(inboundMessage.from, 'restaurant');
        const restaurantFormResponse = buildRestaurantCollectionResponse(buildRestaurantFormLink(token));
        const profile = await getProfileService().getProfile(inboundMessage.from);
        await getRestaurantSearchSessionService().saveRestaurantFormSent(
          inboundMessage.from,
          userMessage,
          profile?.form
        );
        return restaurantFormResponse;
      }

      if (isExcursionRelatedIntent(decision.intent) || isExcursionRequestMessage(userMessage)) {
        await clearCompetingSearchSessions(inboundMessage.from, 'excursion');
        const token = getFormTokenService().createToken(inboundMessage.from, 'excursion');
        const excursionFormResponse = buildExcursionCollectionResponse(buildExcursionFormLink(token));
        const profile = await getProfileService().getProfile(inboundMessage.from);
        await getExcursionSearchSessionService().saveExcursionFormSent(
          inboundMessage.from,
          userMessage,
          profile?.form
        );
        return excursionFormResponse;
      }

      if (isLogisticsRelatedIntent(decision.intent) || isLogisticsRequestMessage(userMessage)) {
        await clearCompetingSearchSessions(inboundMessage.from, 'logistics');
        const token = getFormTokenService().createToken(inboundMessage.from, 'logistics');
        const logisticsFormResponse = buildLogisticsCollectionResponse(buildLogisticsFormLink(token));
        const profile = await getProfileService().getProfile(inboundMessage.from);
        await getLogisticsSearchSessionService().saveTransportFormSent(
          inboundMessage.from,
          userMessage,
          profile?.form
        );
        return logisticsFormResponse;
      }

      if (decision.intent === 'search_hotels') {
        return buildHotelSearchReply(decision.parameters);
      }

      if (isHotelRelatedIntent(decision.intent)) {
        return 'I picked that up as part of a hotel search, but I do not have enough saved hotel details to run it cleanly. Please start with the city or area you want to stay in.';
      }

      if (isGeneralInquiryIntent(decision.intent) || isLowConfidenceDecision(decision)) {
        return (await getConversationManager().createMessage({
          userInput: userMessage,
          profile: userContext,
          interpretation: {
            intent: decision.intent,
            entities: decision.parameters,
            confidence: decision.confidence,
          },
          decision,
          missingFields: decision.missingFields,
        })).text;
      }

      return 'I can help with travel planning, but I need a little more detail before I can guide this properly.';
    }

    if (decision.suggestedAction === 'handoff') {
      return 'Thanks. This may need a human concierge to step in, but handoff routing is not connected yet.';
    }

    if (
      isGeneralInquiryIntent(decision.intent) ||
      isLowConfidenceDecision(decision) ||
      isTripPlanningPrompt(userMessage)
    ) {
      return (await getConversationManager().createMessage({
        userInput: userMessage,
        profile: userContext,
        interpretation: {
          intent: decision.intent,
          entities: decision.parameters,
          confidence: decision.confidence,
        },
        decision,
        missingFields: decision.missingFields,
      })).text;
    }

    return 'I can help with that. Could you tell me a little more about what you need for this trip?';
  } catch (error) {
    if (error instanceof LLMServiceError) {
      return handleTravelFailure('planning', correlationId, error).reply;
    }

    throw error;
  }
}

type VoiceInputResult =
  | { status: 'ok'; inboundMessage: InboundMessage; transcript?: string }
  | { status: 'error'; message: string };

async function transcribeVoiceInputIfNeeded(
  inboundMessage: InboundMessage,
  correlationId: string
): Promise<VoiceInputResult> {
  if (inboundMessage.content.type === 'text' && inboundMessage.content.body.trim()) {
    return { status: 'ok', inboundMessage };
  }

  if (inboundMessage.inputType === 'voice' && inboundMessage.content.type !== 'audio') {
    return { status: 'error', message: VOICE_DOWNLOAD_ERROR_MESSAGE };
  }

  const rawPayload = inboundMessage.metadata?.rawPayload as TwilioWebhookPayload | undefined;
  const numMedia = parseInt(rawPayload?.NumMedia || '0', 10);

  if (numMedia > 0 && inboundMessage.content.type !== 'audio') {
    return { status: 'error', message: UNSUPPORTED_MEDIA_MESSAGE };
  }

  if (inboundMessage.content.type !== 'audio') {
    return { status: 'ok', inboundMessage };
  }

  const contentType =
    inboundMessage.content.contentType ||
    rawPayload?.MediaContentType0 ||
    '';

  if (!isSupportedVoiceContentType(contentType)) {
    return { status: 'error', message: UNSUPPORTED_MEDIA_MESSAGE };
  }

  try {
    const result = await getSpeechToTextService().transcribe({
      mediaUrl: inboundMessage.content.audioUrl,
      contentType,
      messageSid: inboundMessage.messageId,
      userId: inboundMessage.from,
    });

    return {
      status: 'ok',
      transcript: result.transcript,
      inboundMessage: {
        ...inboundMessage,
        type: 'text',
        inputType: 'voice',
        content: {
          type: 'text',
          body: result.transcript,
        },
        metadata: {
          ...inboundMessage.metadata,
          voice: {
            transcript: result.transcript,
            originalMediaUrl: inboundMessage.content.audioUrl,
            contentType: result.contentType,
            bytes: result.bytes,
            model: result.model,
          },
        },
      },
    };
  } catch (error) {
    if (error instanceof SpeechToTextServiceError) {
      handleTravelFailure('voice', correlationId, error);
      return { status: 'error', message: buildVoiceTranscriptionErrorMessage(error) };
    }

    throw error;
  }
}

function buildVoiceTranscriptionErrorMessage(error: SpeechToTextServiceError): string {
  switch (error.code) {
    case 'missing_api_key':
      return VOICE_OPENAI_CONFIG_ERROR_MESSAGE;
    case 'missing_twilio_credentials':
      return VOICE_TWILIO_CONFIG_ERROR_MESSAGE;
    case 'unsupported_media_type':
      return UNSUPPORTED_MEDIA_MESSAGE;
    case 'media_too_large':
      return VOICE_TOO_LARGE_ERROR_MESSAGE;
    case 'download_failed':
      return VOICE_DOWNLOAD_ERROR_MESSAGE;
    case 'transcription_failed':
    default:
      return VOICE_TRANSCRIPTION_ERROR_MESSAGE;
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
    const activeHotelSession = await getHotelSearchSessionService().get(userId);
    if (activeHotelSession?.state === 'hotel_form_sent') {
      return resendHotelFormLink(
        userId,
        userMessage,
        "I've sent a fresh hotel form link for you."
      );
    }

    await clearCompetingSearchSessions(userId, 'hotel');
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

async function handleItineraryFormGate(
  userId: string,
  userMessage: string,
  inboundText: string
): Promise<string | null> {
  if (isResumeConversationCue(inboundText)) {
    const restoredItineraryRequest = await restoreLatestItineraryRequest(userId);
    if (restoredItineraryRequest) return restoredItineraryRequest;
  }

  if (isItineraryRequestMessage(userMessage)) {
    await clearCompetingSearchSessions(userId, 'itinerary');
    const token = getFormTokenService().createToken(userId, 'itinerary');
    const itineraryFormResponse = buildItineraryCollectionResponse(buildItineraryFormLink(token));
    const profile = await getProfileService().getProfile(userId);
    await getItinerarySessionService().saveFormSent(userId, userMessage, profile?.form);
    return itineraryFormResponse;
  }

  return null;
}

async function handleActiveItinerarySession(
  userId: string,
  userMessage: string,
  inboundText: string,
  correlationId: string,
  activeSession?: ItinerarySession | null
): Promise<string | null> {
  const sessionService = getItinerarySessionService();
  const session = activeSession ?? (await sessionService.get(userId));

  if (!session || isGreeting(inboundText)) return null;

  if (isResetCue(inboundText)) {
    await sessionService.clear(userId);
    return 'I have cleared the itinerary plan. Tell me when you want to start planning again.';
  }

  if (session.state === 'planning') {
    return 'I am still building the itinerary. I will send the day-by-day plan here as soon as it is ready.';
  }

  if (session.state === 'showing_itinerary' || session.state === 'editing_itinerary') {
    if (!session.itinerary) return null;

    const daySelection = parseDayCue(inboundText);
    if (daySelection) {
      await sessionService.setCurrentDay(userId, daySelection);
      return buildItineraryDayReply(session.itinerary, daySelection);
    }

    if (isNextDayCue(inboundText)) {
      const nextDay = Math.min((session.currentDay ?? 1) + 1, session.itinerary.days.length);
      await sessionService.setCurrentDay(userId, nextDay);
      return buildItineraryDayReply(session.itinerary, nextDay);
    }

    if (isItineraryEditCue(inboundText)) {
      const criteria = {
        ...session.criteria,
        additionalPreferences: [session.criteria.additionalPreferences, userMessage]
          .filter(Boolean)
          .join('; '),
      };
      const itinerary = await getItineraryPlannerService().plan(criteria);
      await sessionService.saveEditing(userId, criteria, itinerary);
      return buildItineraryReply(
        itinerary,
        await createItineraryWorkspaceLink(userId, itinerary, criteria, 'Edited from WhatsApp')
      );
    }

    if (isBookingIntentCue(inboundText)) {
      return 'Of course. Tell me which part you want to book first: hotels, transport, excursions, or restaurants.';
    }

    if (isResumeConversationCue(inboundText)) {
      return buildItineraryReply(session.itinerary);
    }

    if (isResumeCue(inboundText)) {
      return buildItineraryReply(session.itinerary);
    }

    return null;
  }

  if (session.state !== 'awaiting_preferences' && session.state !== 'itinerary_form_completed') {
    return null;
  }

  if (!hasCompleteItineraryCriteria(session.criteria)) {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      return restoreLatestItineraryRequest(userId);
    }
    return null;
  }

  if (isResumeConversationCue(inboundText)) {
    return buildItineraryPreferencePrompt(session.criteria);
  }

  const criteria = {
    ...session.criteria,
    additionalPreferences: isNoExtraPreferenceCue(inboundText) ? undefined : userMessage,
  };
  await sessionService.savePlanning(userId, criteria);

  const itinerary = await planItinerary(userId, criteria, correlationId);
  await sessionService.saveItinerary(userId, criteria, itinerary);
  return buildItineraryReply(
    itinerary,
    await createItineraryWorkspaceLink(userId, itinerary, criteria, 'Generated from WhatsApp')
  );
}

async function handleLatestItineraryRequestContinuation(
  userId: string,
  userMessage: string,
  inboundText: string,
  correlationId: string
): Promise<string | null> {
  if (
    !isNoExtraPreferenceCue(inboundText) &&
    !isResumeCue(inboundText) &&
    !isItineraryEditCue(inboundText) &&
    !isTripPlanningPrompt(userMessage)
  ) {
    return null;
  }

  const latestItineraryRequest = await getProfileService().getLatestServiceRequest(
    userId,
    'itinerary'
  );

  if (latestItineraryRequest?.type !== 'itinerary') {
    return null;
  }

  const criteria = mapItineraryRequestFormToCriteria(
    latestItineraryRequest.form as ItineraryRequestForm
  );

  if (!hasCompleteItineraryCriteria(criteria)) {
    return null;
  }

  if (isTripPlanningPrompt(userMessage) && !isResumeCue(inboundText)) {
    await getItinerarySessionService().saveAwaitingPreferences(userId, criteria);
    return buildItineraryPreferencePrompt(criteria);
  }

  const criteriaWithPreferences = {
    ...criteria,
    additionalPreferences: isNoExtraPreferenceCue(inboundText) ? undefined : userMessage,
  };
  await getItinerarySessionService().savePlanning(userId, criteriaWithPreferences);

  const itinerary = await planItinerary(userId, criteriaWithPreferences, correlationId);
  await getItinerarySessionService().saveItinerary(userId, criteriaWithPreferences, itinerary);
  return buildItineraryReply(
    itinerary,
    await createItineraryWorkspaceLink(
      userId,
      itinerary,
      criteriaWithPreferences,
      'Generated from latest trip form'
    )
  );
}

async function handleExplicitServiceSwitch(
  userId: string,
  userMessage: string,
  inboundText: string
): Promise<string | null> {
  if (
    isGreeting(inboundText) ||
    isResetCue(inboundText) ||
    isResumeCue(inboundText) ||
    isResumeConversationCue(inboundText)
  ) {
    return null;
  }

  const [
    activeHotelSession,
    activeRestaurantSession,
    activeExcursionSession,
    activeLogisticsSession,
    activeItinerarySession,
  ] = await Promise.all([
    getHotelSearchSessionService().get(userId),
    getRestaurantSearchSessionService().get(userId),
    getExcursionSearchSessionService().get(userId),
    getLogisticsSearchSessionService().get(userId),
    getItinerarySessionService().get(userId),
  ]);
  const hasActiveSession = Boolean(
    activeHotelSession ||
      activeRestaurantSession ||
      activeExcursionSession ||
      activeLogisticsSession ||
      activeItinerarySession
  );

  if (isFreshRestaurantSearchCue(userMessage, hasActiveSession)) {
    return handleRestaurantFormGate(userId, userMessage, inboundText);
  }

  if (isExplicitHotelSearchCue(userMessage, hasActiveSession)) {
    if (activeHotelSession?.state === 'hotel_form_sent') {
      return handleHotelFormGate(userId, userMessage, inboundText, 'explicit-service-switch');
    }
    return startFreshHotelSearch(userId, userMessage);
  }

  if (isFreshExcursionSearchCue(userMessage, hasActiveSession)) {
    return handleExcursionFormGate(userId, userMessage, inboundText);
  }

  if (isFreshLogisticsSearchCue(userMessage, hasActiveSession)) {
    return handleLogisticsFormGate(userId, userMessage, inboundText);
  }

  if (isTripPlanningPrompt(userMessage) && !isItineraryEditCue(userMessage)) {
    return handleItineraryFormGate(userId, userMessage, inboundText);
  }

  return null;
}

async function handleRestaurantFormGate(
  userId: string,
  userMessage: string,
  inboundText: string
): Promise<string | null> {
  if (isResumeCue(inboundText)) {
    const restoredRestaurantRequest = await restoreLatestRestaurantRequest(userId);
    if (restoredRestaurantRequest) {
      return restoredRestaurantRequest;
    }
  }

  if (isRestaurantRequestMessage(userMessage)) {
    await clearCompetingSearchSessions(userId, 'restaurant');
    const token = getFormTokenService().createToken(userId, 'restaurant');
    const restaurantFormResponse = buildRestaurantCollectionResponse(buildRestaurantFormLink(token));
    const profile = await getProfileService().getProfile(userId);
    await getRestaurantSearchSessionService().saveRestaurantFormSent(
      userId,
      userMessage,
      profile?.form
    );

    return restaurantFormResponse;
  }

  return null;
}

async function handleActiveRestaurantSearchSession(
  userId: string,
  outboundFrom: string,
  userMessage: string,
  inboundText: string,
  correlationId: string,
  activeSession?: RestaurantSearchSession | null,
  options: { voicePreferred?: boolean } = {}
): Promise<string | null> {
  const sessionService = getRestaurantSearchSessionService();
  const session = activeSession ?? (await sessionService.get(userId));

  if (!session || isGreeting(inboundText)) {
    return null;
  }

  if (isResetCue(inboundText)) {
    await sessionService.clear(userId);
    return 'I have cleared the restaurant search. Tell me what kind of dining experience you want next.';
  }

  if (session.stage === 'reservation_pending' || session.state === 'reservation_pending') {
    return session.selectedRestaurant
      ? buildReservationProviderBoundaryReply(session.selectedRestaurant.selectedRestaurantSnapshot.name)
      : 'I have your restaurant selection saved. The table availability and reservation check is the next step.';
  }

  if (session.stage === 'results') {
    const bookSelection = parseNumberedCue(inboundText, 'book');
    if (bookSelection) {
      const selectedRestaurant = await sessionService.selectRestaurant(userId, bookSelection);
      if (!selectedRestaurant) {
        return 'Please choose from the latest list only: book 1, book 2, or book 3.';
      }

      return buildReservationProviderBoundaryReply(
        selectedRestaurant.selectedRestaurantSnapshot.name
      );
    }

    const detailsSelection = parseNumberedCue(inboundText, 'details');
    if (detailsSelection) {
      const detailsReply = buildRestaurantDetailsReply(session, detailsSelection);
      return detailsReply ?? 'Please choose from the latest list only: details 1, details 2, or details 3.';
    }

    if (isNextCue(inboundText)) {
      const resultBatches = getRestaurantSessionResultBatches(session);
      const latestDisplayedBatchIndex =
        typeof session.latestDisplayedBatchIndex === 'number'
          ? session.latestDisplayedBatchIndex
          : session.nextOffset
            ? Math.ceil(session.nextOffset / 3) - 1
            : -1;
      const nextBatchIndex = latestDisplayedBatchIndex + 1;
      const page = resultBatches[nextBatchIndex] ?? [];
      if (page.length === 0) {
        return 'I have shown all 9 restaurant suggestions for this search. Which restaurant would you like me to reserve for you? Reply book 1, book 2, or book 3 from the latest list.';
      }

      const nextOffset = Math.min((nextBatchIndex + 1) * 3, session.results.length);
      await sessionService.saveResults(userId, session.criteria, session.results, nextOffset);

      const deliveredCardReply = await sendResultCardPage(
        userId,
        outboundFrom,
        buildRestaurantResultCardReply(session.criteria, page),
        '🍽️ Here are the next restaurant options.',
        options
      );
      if (deliveredCardReply) {
        return deliveredCardReply;
      }

      return getRestaurantSearchFlowService().buildBrowseResultsPageReply(
        session.criteria,
        page,
        nextOffset,
        session.results.length
      );
    }

    if (isResumeConversationCue(inboundText)) {
      return replayRestaurantResults(userId, session);
    }

    return null;
  }

  if (session.stage === 'searching') {
    return 'I am still checking the best restaurant matches for you. I will send the options here as soon as they are ready.';
  }

  if (session.stage !== 'awaiting_preferences') {
    return null;
  }

  if (!hasCompleteRestaurantCriteria(session.criteria)) {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      return restoreLatestRestaurantRequest(userId);
    }

    return null;
  }

  if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
    return buildRestaurantPreferencePrompt(session.criteria);
  }

  const criteria = {
    ...session.criteria,
    additionalPreferences: isNoExtraPreferenceCue(inboundText) ? undefined : userMessage,
  };
  await sessionService.saveSearching(userId, criteria);

  const acknowledgement =
    'Let me check on that and get back to you. I am searching the best restaurant matches now and will send the options here shortly.';

  if (getWhatsAppOutboundService().isConfigured()) {
    void searchRestaurantsAndNotify(userId, outboundFrom, criteria, correlationId, options);
    return acknowledgement;
  }

  const restaurantSearchResult = await searchRestaurants(userId, criteria, correlationId);
  const nextOffset = restaurantSearchResult.browseResponse?.results.length
    ? Math.min(3, restaurantSearchResult.browseResponse.results.length)
    : 0;
  await saveRestaurantSearchResults(userId, criteria, restaurantSearchResult, nextOffset);
  return restaurantSearchResult.reply;
}

async function handleExcursionFormGate(
  userId: string,
  userMessage: string,
  inboundText: string
): Promise<string | null> {
  if (isResumeCue(inboundText)) {
    const restoredExcursionRequest = await restoreLatestExcursionRequest(userId);
    if (restoredExcursionRequest) {
      return restoredExcursionRequest;
    }
  }

  if (isExcursionRequestMessage(userMessage)) {
    await clearCompetingSearchSessions(userId, 'excursion');
    const token = getFormTokenService().createToken(userId, 'excursion');
    const excursionFormResponse = buildExcursionCollectionResponse(buildExcursionFormLink(token));
    const profile = await getProfileService().getProfile(userId);
    await getExcursionSearchSessionService().saveExcursionFormSent(
      userId,
      userMessage,
      profile?.form
    );

    return excursionFormResponse;
  }

  return null;
}

async function handleActiveExcursionSearchSession(
  userId: string,
  outboundFrom: string,
  userMessage: string,
  inboundText: string,
  correlationId: string,
  activeSession?: ExcursionSearchSession | null,
  options: { voicePreferred?: boolean } = {}
): Promise<string | null> {
  const sessionService = getExcursionSearchSessionService();
  const session = activeSession ?? (await sessionService.get(userId));

  if (!session || isGreeting(inboundText)) return null;

  if (isResetCue(inboundText)) {
    await sessionService.clear(userId);
    return 'I have cleared the excursion search. Tell me what kind of experience you want next.';
  }

  if (session.stage === 'provider_pending' || session.state === 'provider_pending') {
    return "I've prepared your booking request. I'll now contact the experience provider and confirm availability before completing your booking.";
  }

  if (session.stage === 'booking_form' || session.state === 'booking_form') {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      return "I'm waiting for the booking request form. Please complete it, then return here and type \"done\".";
    }
  }

  if (session.stage === 'results') {
    const bookSelection = parseNumberedCue(inboundText, 'book');
    if (bookSelection) {
      const selectedExperience = await sessionService.selectExperience(userId, bookSelection);
      if (!selectedExperience) {
        return 'Please choose from the latest list only: book 1, book 2, or book 3.';
      }

      const token = getFormTokenService().createToken(userId, 'excursion_booking');
      return buildExcursionBookingCollectionResponse(buildExcursionBookingFormLink(token));
    }

    const detailsSelection = parseNumberedCue(inboundText, 'details');
    if (detailsSelection) {
      return buildExcursionDetailsReply(session, detailsSelection) ??
        'Please choose from the latest list only: details 1, details 2, or details 3.';
    }

    if (isNextCue(inboundText)) {
      const resultBatches = getExcursionSessionResultBatches(session);
      const latestDisplayedBatchIndex =
        typeof session.latestDisplayedBatchIndex === 'number'
          ? session.latestDisplayedBatchIndex
          : session.nextOffset
            ? Math.ceil(session.nextOffset / 3) - 1
            : -1;
      const nextBatchIndex = latestDisplayedBatchIndex + 1;
      const page = resultBatches[nextBatchIndex] ?? [];
      if (page.length === 0) {
        return 'I have shown all 9 experience suggestions for this search. Which experience would you like me to help you book? Reply book 1, book 2, or book 3 from the latest list.';
      }

      const nextOffset = Math.min((nextBatchIndex + 1) * 3, session.results.length);
      await sessionService.saveResults(userId, session.criteria, session.results, nextOffset);

      const deliveredCardReply = await sendResultCardPage(
        userId,
        outboundFrom,
        buildExcursionResultCardReply(session.criteria, page),
        '🧭 Here are the next experience options.',
        options
      );
      if (deliveredCardReply) {
        return deliveredCardReply;
      }

      return getExcursionSearchFlowService().buildBrowseResultsPageReply(
        session.criteria,
        page,
        nextOffset,
        session.results.length
      );
    }

    if (isResumeConversationCue(inboundText)) {
      return replayExcursionResults(userId, session);
    }

    return null;
  }

  if (session.stage === 'searching') {
    return 'I am still checking the best experience matches for you. I will send the options here as soon as they are ready.';
  }

  if (session.stage !== 'awaiting_preferences') return null;

  if (!hasCompleteExcursionCriteria(session.criteria)) {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      return restoreLatestExcursionRequest(userId);
    }
    return null;
  }

  if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
    return buildExcursionPreferencePrompt(session.criteria);
  }

  const criteria = {
    ...session.criteria,
    additionalPreferences: isNoExtraPreferenceCue(inboundText) ? undefined : userMessage,
  };
  await sessionService.saveSearching(userId, criteria);

  const acknowledgement =
    'Let me check on that and get back to you. I am searching the best experience matches now and will send the options here shortly.';

  if (getWhatsAppOutboundService().isConfigured()) {
    void searchExcursionsAndNotify(userId, outboundFrom, criteria, correlationId, options);
    return acknowledgement;
  }

  const excursionSearchResult = await searchExcursions(userId, criteria, correlationId);
  const nextOffset = excursionSearchResult.browseResponse?.results.length
    ? Math.min(3, excursionSearchResult.browseResponse.results.length)
    : 0;
  await saveExcursionSearchResults(userId, criteria, excursionSearchResult, nextOffset);
  return excursionSearchResult.reply;
}

async function handleActiveHotelSearchSession(
  userId: string,
  outboundFrom: string,
  inboundText: string,
  correlationId: string,
  activeSession?: HotelSearchSession | null,
  options: { voicePreferred?: boolean } = {}
): Promise<string | null> {
  const sessionService = getHotelSearchSessionService();
  const session = activeSession ?? (await sessionService.get(userId));

  if (!session) {
    return null;
  }

  if (isGreeting(inboundText)) {
    return null;
  }

  if (session.state === 'profile_required') {
    return null;
  }

  if (session.state === 'hotel_form_sent') {
    if (isFormResendCue(inboundText) || isHotelRequestMessage(inboundText)) {
      return resendHotelFormLink(
        userId,
        inboundText,
        "No problem. Here's a fresh hotel form link."
      );
    }

    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      const restoredHotelRequest = await restoreLatestHotelRequest(userId);
      if (restoredHotelRequest) {
        return restoredHotelRequest;
      }

      return 'I am still waiting for the hotel request form details. Please complete the hotel form link I sent, then return here and type "done".';
    }

    return null;
  }

  if (session.stage === 'booking_provider_pending' || session.state === 'booking_provider_pending') {
    if (session.humanHandoff) {
      return 'Your request is already with a human concierge. YANA will not book or charge while the concierge is handling it.';
    }
    if (session.pendingHumanHandoffConsent) {
      if (/^(?:no|not now|cancel)$/i.test(inboundText.trim())) {
        await sessionService.clearHandoffConsentPending(userId);
        return 'Okay, I will keep the request here. No details were shared, and no booking or payment was attempted.';
      }
      if (!isExplicitHandoffConsent(inboundText)) {
        return 'Would you like me to share the minimum stay-request details with a human travel concierge? Reply "yes, connect me" to consent, or "no" to keep the request here.';
      }
      if (!session.selectedHotel) {
        return 'Your selected stay is no longer available in this session. No handoff, booking, or payment was attempted.';
      }
      const handoff = await getHumanHandoffRuntime().requestHotelHandoff({
        whatsappUserId: userId,
        correlationId,
        travelerConsented: true,
        criteria: session.criteria,
        selectedHotel: session.selectedHotel,
        recheckReceipt: session.recheckReceipt,
      });
      return handoff.reply;
    }
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

      const bookingCheck = await getHotelSearchFlowService().handleBookingCheck(
        session.criteria,
        selectedHotel.selectedHotelSnapshot,
        {
          correlationId,
          sessionId: userId,
          userLanguage: 'en',
        }
      );
      if (bookingCheck.status === 'browse_results') {
        if (!bookingCheck.authoritativeProvider) {
          return 'I could not preserve the supplier recheck safely. Please try the booking check again. No booking or payment was attempted.';
        }
        const receipt = await getHotelRecheckReceiptService().issue(selectedHotel, session.criteria, bookingCheck.authoritativeProvider);
        await sessionService.saveRecheckReceipt(userId, receipt);
        await sessionService.markHandoffConsentPending(userId);
        return `${bookingCheck.reply}\n\nWould you like me to share the minimum stay-request details with a human travel concierge? Reply "yes, connect me" to consent.`;
      }
      return bookingCheck.reply;
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

      const deliveredCardReply = await sendResultCardPage(
        userId,
        outboundFrom,
        buildHotelResultCardReply(session.criteria, page, ''),
        '🏨 Here are the next hotel options.',
        options
      );
      if (deliveredCardReply) {
        return deliveredCardReply;
      }

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

  if (!hasCompleteHotelCriteria(session.criteria)) {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      const restoredHotelRequest = await restoreLatestHotelRequest(userId);
      if (restoredHotelRequest) {
        return restoredHotelRequest;
      }
    }

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
    'Let me check on that and get back to you. I am searching the best hotel matches now and will send the options here shortly.';

  if (getWhatsAppOutboundService().isConfigured()) {
    void searchHotelsAndNotify(userId, outboundFrom, criteria, correlationId, options);
    return acknowledgement;
  }

  try {
    const hotelSearchResult = await searchHotels(userId, criteria, correlationId);
    const nextOffset = hotelSearchResult.browseResponse?.results.length
      ? Math.min(3, hotelSearchResult.browseResponse.results.length)
      : 0;
    await saveHotelSearchResults(userId, criteria, hotelSearchResult, nextOffset);
    return hotelSearchResult.reply;
  } catch (error) {
    return handleTravelFailure('hotel', correlationId, error).reply;
  }
}

type ConversationRoute =
  | { action: 'continue_current_flow' }
  | { action: 'reset_current_flow' }
  | { action: 'start_new_hotel_search' };

async function routeActiveConversation(
  userMessage: string,
  activeHotelSession: HotelSearchSession | null,
  correlationId: string
): Promise<ConversationRoute> {
  if (!activeHotelSession) {
    return { action: 'continue_current_flow' };
  }

  if (isCurrentHotelSessionCommand(userMessage) || isGreeting(userMessage)) {
    return { action: 'continue_current_flow' };
  }

  if (isNaturalResetCue(userMessage) && !isHotelRequestMessage(userMessage)) {
    return { action: 'reset_current_flow' };
  }

  if (isFreshHotelSearchCue(userMessage)) {
    return { action: 'start_new_hotel_search' };
  }

  if (shouldTreatHotelRequestAsNewSearch(userMessage, activeHotelSession)) {
    return { action: 'start_new_hotel_search' };
  }

  const llmRoute = await routeActiveConversationWithLlm(
    userMessage,
    activeHotelSession,
    correlationId
  );

  return llmRoute ?? { action: 'continue_current_flow' };
}

async function routeActiveConversationWithLlm(
  userMessage: string,
  activeHotelSession: HotelSearchSession,
  correlationId: string
): Promise<ConversationRoute | null> {
  if (!shouldAskLlmToRouteActiveMessage(userMessage, activeHotelSession)) {
    return null;
  }

  try {
    const decision = await getLLMService().decide({
      userMessage,
      sessionState: {
        currentIntent: 'hotel_search',
        activeSchema: 'search_hotels',
        collectedFields: { ...activeHotelSession.criteria },
      },
      availableSchemas: ['search_hotels'],
    });

    console.log(
      `[${correlationId}] Conversation route decision received:`,
      JSON.stringify(decision, null, 2)
    );

    if (
      decision.confidence >= 0.7 &&
      isHotelRelatedIntent(decision.intent) &&
      (decision.suggestedAction === 'ask_missing' || decision.suggestedAction === 'execute_tool')
    ) {
      return { action: 'start_new_hotel_search' };
    }
  } catch (error) {
    logSafeOperatorFailure(console, 'conversation_route_fallback_used', correlationId, error);
  }

  return null;
}

async function handleLogisticsFormGate(
  userId: string,
  userMessage: string,
  inboundText: string
): Promise<string | null> {
  if (isResumeCue(inboundText)) {
    const restoredLogisticsRequest = await restoreLatestLogisticsRequest(userId);
    if (restoredLogisticsRequest) {
      return restoredLogisticsRequest;
    }
  }

  if (isLogisticsRequestMessage(userMessage)) {
    await clearCompetingSearchSessions(userId, 'logistics');
    const token = getFormTokenService().createToken(userId, 'logistics');
    const logisticsFormResponse = buildLogisticsCollectionResponse(buildLogisticsFormLink(token));
    const profile = await getProfileService().getProfile(userId);
    await getLogisticsSearchSessionService().saveTransportFormSent(
      userId,
      userMessage,
      profile?.form
    );

    return logisticsFormResponse;
  }

  return null;
}

async function handleActiveLogisticsSearchSession(
  userId: string,
  outboundFrom: string,
  userMessage: string,
  inboundText: string,
  correlationId: string,
  activeSession?: LogisticsSearchSession | null,
  options: { voicePreferred?: boolean } = {}
): Promise<string | null> {
  const sessionService = getLogisticsSearchSessionService();
  const session = activeSession ?? (await sessionService.get(userId));

  if (!session || isGreeting(inboundText)) return null;

  if (isResetCue(inboundText)) {
    await sessionService.clear(userId);
    return 'I have cleared the transport search. Tell me what journey you want next.';
  }

  if (session.stage === 'provider_pending' || session.state === 'provider_pending') {
    return 'Your transport quote request is prepared. No vehicle, availability, or price is confirmed; a transport operator must review it and provide a quote before you proceed.';
  }

  if (session.stage === 'booking_form') {
    return 'I have your request option selected. Please complete the quote-request form; this does not book a vehicle or confirm availability or price.';
  }

  if (session.stage === 'results') {
    const bookSelection = parseNumberedCue(inboundText, 'book');
    if (bookSelection) {
      const selectedOption = await sessionService.selectOption(userId, bookSelection);
      if (!selectedOption) {
        return 'Please choose from the latest list only: book 1, book 2, or book 3.';
      }

      const token = getFormTokenService().createToken(userId, 'logistics_booking');
      return buildLogisticsBookingCollectionResponse(buildLogisticsBookingFormLink(token));
    }

    const detailsSelection = parseNumberedCue(inboundText, 'details');
    if (detailsSelection) {
      return buildLogisticsDetailsReply(session, detailsSelection) ??
        'Please choose from the latest list only: details 1, details 2, or details 3.';
    }

    if (isNextCue(inboundText)) {
      const resultBatches = getLogisticsSessionResultBatches(session);
      const latestDisplayedBatchIndex =
        typeof session.latestDisplayedBatchIndex === 'number'
          ? session.latestDisplayedBatchIndex
          : session.nextOffset
            ? Math.ceil(session.nextOffset / 3) - 1
            : -1;
      const nextBatchIndex = latestDisplayedBatchIndex + 1;
      const page = resultBatches[nextBatchIndex] ?? [];
      if (page.length === 0) {
        return 'I have shown all 9 illustrative transport request options. Which should I send for an operator quote and availability check? Reply book 1, book 2, or book 3 from the latest list.';
      }

      const nextOffset = Math.min((nextBatchIndex + 1) * 3, session.results.length);
      await sessionService.saveResults(userId, session.criteria, session.results, nextOffset);

      const deliveredCardReply = await sendResultCardPage(
        userId,
        outboundFrom,
        buildLogisticsResultCardReply(session.criteria, page),
        '🚗 Here are the next transport options.',
        options
      );
      if (deliveredCardReply) {
        return deliveredCardReply;
      }

      return getLogisticsSearchFlowService().buildOptionsPageReply(
        session.criteria,
        page,
        nextOffset,
        session.results.length
      );
    }

    if (isResumeConversationCue(inboundText)) {
      return replayLogisticsResults(userId, session);
    }

    return null;
  }

  if (session.stage === 'searching') {
    return 'I am still checking the best transport matches for you. I will send the options here as soon as they are ready.';
  }

  if (session.stage !== 'awaiting_preferences') {
    return null;
  }

  if (!hasCompleteLogisticsCriteria(session.criteria)) {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      return restoreLatestLogisticsRequest(userId);
    }
    return null;
  }

  if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
    return buildLogisticsPreferencePrompt(session.criteria);
  }

  const criteria = {
    ...session.criteria,
    additionalPreferences: isNoExtraPreferenceCue(inboundText) ? undefined : userMessage,
  };
  await sessionService.saveSearching(userId, criteria);

  const acknowledgement =
    'Let me check on that and get back to you. I am searching the best transport matches now and will send the options here shortly.';

  if (getWhatsAppOutboundService().isConfigured()) {
    void searchLogisticsAndNotify(userId, outboundFrom, criteria, correlationId, options);
    return acknowledgement;
  }

  const logisticsSearchResult = await searchLogistics(userId, criteria, correlationId);
  const nextOffset = logisticsSearchResult.options?.length
    ? Math.min(3, logisticsSearchResult.options.length)
    : 0;
  await saveLogisticsSearchResults(userId, criteria, logisticsSearchResult, nextOffset);
  return logisticsSearchResult.reply;
}

function shouldAskLlmToRouteActiveMessage(
  message: string,
  activeHotelSession: HotelSearchSession
): boolean {
  if (activeHotelSession.stage === 'awaiting_preferences') {
    return hasDirectionChangeCue(message);
  }

  return (
    activeHotelSession.stage === 'results' ||
    activeHotelSession.stage === 'searching' ||
    activeHotelSession.stage === 'booking_provider_pending'
  );
}

function shouldTreatHotelRequestAsNewSearch(
  message: string,
  activeHotelSession: HotelSearchSession
): boolean {
  if (!isHotelRequestMessage(message)) {
    return false;
  }

  if (activeHotelSession.stage === 'awaiting_preferences') {
    return hasFreshStartCue(message) || hasDirectionChangeCue(message);
  }

  return (
    activeHotelSession.stage === 'results' ||
    activeHotelSession.stage === 'searching' ||
    activeHotelSession.stage === 'booking_provider_pending'
  );
}

async function startFreshHotelSearch(userId: string, userMessage: string): Promise<string> {
  await getHotelSearchSessionService().clear(userId);
  await clearCompetingSearchSessions(userId, 'hotel');
  await getPendingRequestService().clearProfileGateRequest(userId);

  const token = getFormTokenService().createToken(userId, 'hotel');
  const hotelFormResponse = buildHotelCollectionResponse(buildHotelFormLink(token));
  const profile = await getProfileService().getProfile(userId);
  await getHotelSearchSessionService().saveHotelFormSent(
    userId,
    userMessage,
    profile?.form
  );

  return `Of course. I'll start a fresh hotel search.\n\n${hotelFormResponse}`;
}

async function resendHotelFormLink(
  userId: string,
  userMessage: string,
  intro: string
): Promise<string> {
  const token = getFormTokenService().createToken(userId, 'hotel');
  const hotelFormResponse = buildHotelCollectionResponse(buildHotelFormLink(token));
  const profile = await getProfileService().getProfile(userId);
  await getHotelSearchSessionService().saveHotelFormSent(
    userId,
    userMessage,
    profile?.form
  );

  return `${intro}\n\n${hotelFormResponse}`;
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

async function resetConversation(
  userId: string,
  userContext: InboundUserContext
): Promise<string> {
  await getHotelSearchSessionService().clear(userId);
  await getRestaurantSearchSessionService().clear(userId);
  await getExcursionSearchSessionService().clear(userId);
  await getLogisticsSearchSessionService().clear(userId);
  await getItinerarySessionService().clear(userId);
  await getPendingRequestService().clearProfileGateRequest(userId);

  return `${buildWelcomeMessage(userContext)}\n\nI have cleared the active request. Tell me what you would like to do next, or say "resume" if you want me to check for a saved request.`;
}

async function resumeConversation(userId: string): Promise<string | null> {
  const hotelSession = await getHotelSearchSessionService().get(userId);

  if (!hotelSession) {
    return restoreLatestHotelRequest(userId);
  }

  if (hotelSession.stage === 'awaiting_preferences') {
    if (!hasCompleteHotelCriteria(hotelSession.criteria)) {
      return restoreLatestHotelRequest(userId);
    }

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

async function restoreLatestRestaurantRequest(userId: string): Promise<string | null> {
  const latestRestaurantRequest = await getProfileService().getLatestServiceRequest(
    userId,
    'restaurant'
  );

  if (latestRestaurantRequest?.type !== 'restaurant') {
    return null;
  }

  const criteria = mapRestaurantRequestFormToCriteria(
    latestRestaurantRequest.form as RestaurantRequestForm
  );
  await getRestaurantSearchSessionService().saveAwaitingPreferences(userId, criteria);
  return buildRestaurantPreferencePrompt(criteria);
}

async function restoreLatestItineraryRequest(userId: string): Promise<string | null> {
  const latestItineraryRequest = await getProfileService().getLatestServiceRequest(
    userId,
    'itinerary'
  );

  if (latestItineraryRequest?.type !== 'itinerary') return null;

  const criteria = mapItineraryRequestFormToCriteria(
    latestItineraryRequest.form as ItineraryRequestForm
  );
  await getItinerarySessionService().saveAwaitingPreferences(userId, criteria);
  return buildItineraryPreferencePrompt(criteria);
}

async function restoreLatestExcursionRequest(userId: string): Promise<string | null> {
  const latestExcursionRequest = await getProfileService().getLatestServiceRequest(
    userId,
    'excursion'
  );

  if (latestExcursionRequest?.type !== 'excursion') {
    return null;
  }

  const criteria = mapExcursionRequestFormToCriteria(
    latestExcursionRequest.form as ExcursionRequestForm
  );
  await getExcursionSearchSessionService().saveAwaitingPreferences(userId, criteria);
  return buildExcursionPreferencePrompt(criteria);
}

async function restoreLatestLogisticsRequest(userId: string): Promise<string | null> {
  const latestLogisticsRequest = await getProfileService().getLatestServiceRequest(
    userId,
    'logistics'
  );

  if (latestLogisticsRequest?.type !== 'logistics') {
    return null;
  }

  const criteria = mapLogisticsRequestFormToCriteria(
    latestLogisticsRequest.form as LogisticsRequestForm
  );
  await getLogisticsSearchSessionService().saveAwaitingPreferences(userId, criteria);
  return buildLogisticsPreferencePrompt(criteria);
}

async function searchHotelsAndNotify(
  userId: string,
  outboundFrom: string,
  criteria: HotelSearchCriteria,
  correlationId: string,
  options: { voicePreferred?: boolean } = {}
): Promise<void> {
  try {
    const hotelSearchResult = await searchHotels(userId, criteria, correlationId);

    if (hotelSearchResult.browseResponse?.results.length) {
      const firstPage = hotelSearchResult.browseResponse.results.slice(0, 3);
      const delivered = await getWhatsAppOutboundService().sendWhatsAppMessages(
        userId,
        buildHotelResultCardReply(criteria, firstPage, hotelSearchResult.reply),
        { voice: options.voicePreferred, from: outboundFrom }
      );
      await saveHotelSearchResults(
        userId,
        criteria,
        hotelSearchResult,
        delivered ? Math.min(3, hotelSearchResult.browseResponse.results.length) : 0
      );
      return;
    }

    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      hotelSearchResult.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  } catch (error) {
    const safeFailure = handleTravelFailure('hotel', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
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

async function planItinerary(
  _userId: string,
  criteria: ItineraryCriteria,
  _correlationId: string
): Promise<GeneratedItinerary> {
  return getItineraryPlannerService().plan(criteria);
}

async function searchRestaurantsAndNotify(
  userId: string,
  outboundFrom: string,
  criteria: RestaurantSearchCriteria,
  correlationId: string,
  options: { voicePreferred?: boolean } = {}
): Promise<void> {
  try {
    const restaurantSearchResult = await searchRestaurants(userId, criteria, correlationId);

    if (restaurantSearchResult.browseResponse?.results.length) {
      const firstPage = restaurantSearchResult.browseResponse.results.slice(0, 3);
      const delivered = await getWhatsAppOutboundService().sendWhatsAppMessages(
        userId,
        buildRestaurantResultCardReply(criteria, firstPage),
        { voice: options.voicePreferred, from: outboundFrom }
      );
      await saveRestaurantSearchResults(
        userId,
        criteria,
        restaurantSearchResult,
        delivered ? Math.min(3, restaurantSearchResult.browseResponse.results.length) : 0
      );
      return;
    }

    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      restaurantSearchResult.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  } catch (error) {
    const safeFailure = handleTravelFailure('restaurant', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

function searchRestaurants(
  userId: string,
  criteria: RestaurantSearchCriteria,
  correlationId: string
): Promise<RestaurantSearchFlowResult> {
  return getRestaurantSearchFlowService().handleBrowseSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
}

async function searchExcursionsAndNotify(
  userId: string,
  outboundFrom: string,
  criteria: ExcursionSearchCriteria,
  correlationId: string,
  options: { voicePreferred?: boolean } = {}
): Promise<void> {
  try {
    const excursionSearchResult = await searchExcursions(userId, criteria, correlationId);

    if (excursionSearchResult.browseResponse?.results.length) {
      const firstPage = excursionSearchResult.browseResponse.results.slice(0, 3);
      const delivered = await getWhatsAppOutboundService().sendWhatsAppMessages(
        userId,
        buildExcursionResultCardReply(criteria, firstPage),
        { voice: options.voicePreferred, from: outboundFrom }
      );
      await saveExcursionSearchResults(
        userId,
        criteria,
        excursionSearchResult,
        delivered ? Math.min(3, excursionSearchResult.browseResponse.results.length) : 0
      );
      return;
    }

    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      excursionSearchResult.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  } catch (error) {
    const safeFailure = handleTravelFailure('excursion', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

function searchExcursions(
  userId: string,
  criteria: ExcursionSearchCriteria,
  correlationId: string
): Promise<ExcursionSearchFlowResult> {
  return getExcursionSearchFlowService().handleBrowseSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
}

async function searchLogisticsAndNotify(
  userId: string,
  outboundFrom: string,
  criteria: LogisticsSearchCriteria,
  correlationId: string,
  options: { voicePreferred?: boolean } = {}
): Promise<void> {
  try {
    const logisticsSearchResult = await searchLogistics(userId, criteria, correlationId);

    if (logisticsSearchResult.options?.length) {
      const firstPage = logisticsSearchResult.options.slice(0, 3);
      const delivered = await getWhatsAppOutboundService().sendWhatsAppMessages(
        userId,
        buildLogisticsResultCardReply(criteria, firstPage),
        { voice: options.voicePreferred, from: outboundFrom }
      );
      await saveLogisticsSearchResults(
        userId,
        criteria,
        logisticsSearchResult,
        delivered ? Math.min(3, logisticsSearchResult.options.length) : 0
      );
      return;
    }

    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      logisticsSearchResult.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  } catch (error) {
    const safeFailure = handleTravelFailure('transport', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

function searchLogistics(
  userId: string,
  criteria: LogisticsSearchCriteria,
  correlationId: string
): Promise<LogisticsSearchFlowResult> {
  return getLogisticsSearchFlowService().handleProviderSearch(criteria, {
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

async function saveRestaurantSearchResults(
  userId: string,
  criteria: RestaurantSearchCriteria,
  restaurantSearchResult: RestaurantSearchFlowResult,
  nextOffset: number
): Promise<void> {
  if (restaurantSearchResult.browseResponse?.results.length) {
    await getRestaurantSearchSessionService().saveResults(
      userId,
      criteria,
      restaurantSearchResult.browseResponse.results,
      nextOffset
    );
  }
}

async function saveExcursionSearchResults(
  userId: string,
  criteria: ExcursionSearchCriteria,
  excursionSearchResult: ExcursionSearchFlowResult,
  nextOffset: number
): Promise<void> {
  if (excursionSearchResult.browseResponse?.results.length) {
    await getExcursionSearchSessionService().saveResults(
      userId,
      criteria,
      excursionSearchResult.browseResponse.results,
      nextOffset
    );
  }
}

async function saveLogisticsSearchResults(
  userId: string,
  criteria: LogisticsSearchCriteria,
  logisticsSearchResult: LogisticsSearchFlowResult,
  nextOffset: number
): Promise<void> {
  if (logisticsSearchResult.options?.length) {
    await getLogisticsSearchSessionService().saveResults(
      userId,
      criteria,
      logisticsSearchResult.options,
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
    logSafeOperatorFailure(console, 'profile_gate_request_save_failed', correlationId, error);
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
    logSafeOperatorFailure(console, 'profile_gate_request_consume_failed', correlationId, error);
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
    return content.selectedId.trim() || content.selectedTitle?.trim() || null;
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

function isNaturalResetCue(message: string): boolean {
  return /\b(restart|reset|start over|start again|clear|cancel|forget)\b/i.test(message);
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

function isFormResendCue(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(resend|re send|send again|send it again|send the link|link again|new link|fresh link|lost the link|dont have it|don't have it|i dont have it|i don't have it|expired)\b/i.test(
    normalized
  );
}

function isNextCue(message: string): boolean {
  return /^(next|more|show more|show me more|more options|more matches|next 3|another 3|another three|more results)$/i.test(
    message.trim()
  );
}

function isCurrentHotelSessionCommand(message: string): boolean {
  return (
    isResumeCue(message) ||
    isResumeConversationCue(message) ||
    isNextCue(message) ||
    parseNumberedCue(message, 'book') !== null ||
    parseNumberedCue(message, 'details') !== null
  );
}

function isFreshHotelSearchCue(message: string): boolean {
  return (hasFreshStartCue(message) || hasDirectionChangeCue(message)) && isHotelRequestMessage(message);
}

function isExplicitHotelSearchCue(message: string, hasActiveSession = false): boolean {
  if (!isHotelRequestMessage(message)) return false;
  if (!hasActiveSession) return false;
  return (
    hasFreshStartCue(message) ||
    hasDirectionChangeCue(message) ||
    /\b(find|looking for|need|want|search|hotel in|place to stay|book a hotel)\b/i.test(message)
  );
}

function isFreshRestaurantSearchCue(message: string, hasActiveSession = false): boolean {
  if (!isRestaurantRequestMessage(message)) return false;
  return (
    !hasActiveSession ||
    hasFreshStartCue(message) ||
    hasDirectionChangeCue(message) ||
    /\b(find|looking for|need|want|restaurant|restuarent|food|dinner|lunch|breakfast|near me|not a hotel)\b/i.test(
      message
    )
  );
}

function isFreshExcursionSearchCue(message: string, hasActiveSession = false): boolean {
  if (!isExcursionRequestMessage(message)) return false;
  return !hasActiveSession || hasFreshStartCue(message) || hasDirectionChangeCue(message);
}

function isFreshLogisticsSearchCue(message: string, hasActiveSession = false): boolean {
  if (!isLogisticsRequestMessage(message)) return false;
  return !hasActiveSession || hasFreshStartCue(message) || hasDirectionChangeCue(message);
}

function hasFreshStartCue(message: string): boolean {
  return /\b(restart|reset|start over|start again|new|fresh|another|different)\b/i.test(message);
}

function hasDirectionChangeCue(message: string): boolean {
  return /\b(actually|instead|change|changed my mind|switch|rather|not this|not these|different)\b/i.test(
    message
  );
}

function parseNumberedCue(message: string, action: 'book' | 'details'): number | null {
  const normalized = message.toLowerCase().trim();
  const pattern =
    action === 'book' ? /^(?:book\s*)?([1-3])$/ : /^details\s*([1-3])$/;
  const match = normalized.match(pattern);
  return match ? Number(match[1]) : null;
}

function parseDayCue(message: string): number | null {
  const match = message.toLowerCase().trim().match(/^(?:show\s*)?day\s*([1-9][0-9]?)$/);
  return match ? Number(match[1]) : null;
}

function isNextDayCue(message: string): boolean {
  return /^(next day|tomorrow|show next day)$/i.test(message.trim());
}

function isItineraryEditCue(message: string): boolean {
  return /\b(change|more|less|add|remove|replace|avoid|luxury|budget|beach|safari|hiking|driving|hotel|restaurant|transport|activity|family friendly|sunrise)\b/i.test(
    message
  );
}

function isBookingIntentCue(message: string): boolean {
  return /\b(book hotels?|book transport|book excursions?|book restaurants?|reserve|booking)\b/i.test(
    message
  );
}

function isNoExtraPreferenceCue(message: string): boolean {
  return /^(no|no thanks|none|nothing|nope|no extra|no preferences|nothing else|search|start search|start planning|plan it|go ahead|go ahead and plan)$/i.test(
    message.trim()
  );
}

function isHotelRequestMessage(message: string): boolean {
  return /\b(hotel|stay|accommodation|room|resort|bnb|b&b)\b/i.test(message);
}

function isExplicitHandoffConsent(message: string): boolean {
  return /^(?:yes[, ]+)?(?:connect me|share (?:it|them|the details)|human help|concierge|yes)$/i.test(message.trim());
}

function isFlightServiceRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  const mentionsFlightService =
    /\bflights?\b|\bair\s*fares?\b|\b(?:airline|air|plane)\s*tickets?\b/.test(normalized) ||
    /\b(?:fly|flying)\s+(?:me\s+)?(?:from|to)\b/.test(normalized);

  if (!mentionsFlightService) {
    return false;
  }

  const mentionsTransfer =
    /\b(?:airport\s+)?(?:transfer|pickup|pick up|drop-?off)|taxi|driver|chauffeur\b/.test(
      normalized
    );

  return !mentionsTransfer;
}

function buildUnsupportedFlightServiceReply(): string {
  return (
    'Flight search and booking are not available through Yana yet. ' +
    'Please use an airline or a trusted flight-booking platform for current fares and tickets. ' +
    'I can still help plan your Sri Lanka itinerary or find hotels, restaurants, excursions, and transport.'
  );
}

function isRestaurantRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(hungry|food|restaurants?|restuarents?|eat|place to eat|where can we eat|where should we eat|breakfast|lunch|dinner|brunch|coffee|cafe|fine dining|seafood|pizza|burger|romantic dinner|romantic place|family dinner|vegetarian|vegan|buffet|steak|sushi|indian food|chinese food|sri lankan food|italian|mexican|thai|bbq|somewhere for dinner|good seafood|romantic restaurant|somewhere nice|craving)\b/i.test(
    normalized
  );
}

function isItineraryRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(plan my trip|plan my holiday|plan my itinerary|travel around|7 day itinerary|10 day itinerary|where should i go|things to see|tour sri lanka|family holiday|honeymoon|backpacking|road trip|vacation|holiday planning|travel plan|trip planner|planning my trip|visiting sri lanka|visit sri lanka|i'?ll be here for a week|travelling around sri lanka|traveling around sri lanka|need help planning|full itinerary|itinerary)\b/i.test(
    normalized
  );
}

function isExcursionRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(things to do|activities|excursions?|tour|tour guide|day trip|experience|adventure|historic places|history|temples?|forts?|museum|culture|culture tour|nature|wildlife|national park|safari|elephants?|leopards?|bird watching|whale watching|dolphins?|beach|surfing|snorkell?ing|scuba diving|diving|kayaking|rafting|hiking|trekking|mountain|waterfall|camping|cycling|shopping|markets?|gem shopping|tea factory|tea plantation|train ride|ella train|photography|sunrise|sunset|wellness|spa|yoga|meditation|nightlife|festival|concert|event|family activities|kids activities|romantic experiences|private tour|group tour|best things|visit historic|go surfing|wife loves wildlife|looking for adventure)\b/i.test(
    normalized
  );
}

function isLogisticsRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(taxi|uber|pick me up|ride|transport|driver|chauffeur|airport transfer|airport pickup|airport drop|car|rent a car|vehicle|van|minibus|bus|train|book transport|take me|need a ride|pickup|pick up|drop off|dropoff|travel from|go to|how do i get there|transfer|private driver|luxury transfer|family transport|coach|boat transfer|ferry|motorbike rental|bike rental|airport|arrange a van|chauffeur for the day|transport for six|transport for 6)\b/i.test(
    normalized
  );
}

function isHotelRelatedIntent(intent: string): boolean {
  return /hotel|stay|check_?in|check_?out|guest|pax|meal|board|budget|room/i.test(intent);
}

function isRestaurantRelatedIntent(intent: string): boolean {
  return /restaurant|dining|dinner|lunch|breakfast|brunch|food|cuisine|cafe|coffee|reservation/i.test(intent);
}

function isItineraryRelatedIntent(intent: string): boolean {
  return /itinerary|trip_?planning|travel_?planning|holiday|vacation|road_?trip|tour_plan|planner/i.test(intent);
}

function isExcursionRelatedIntent(intent: string): boolean {
  return /excursion|activity|experience|tour|adventure|safari|wildlife|culture|history|temple|museum|surf|diving|hiking|shopping|wellness|nightlife|event/i.test(intent);
}

function isLogisticsRelatedIntent(intent: string): boolean {
  return /logistics|transport|transfer|taxi|ride|driver|chauffeur|airport|pickup|drop|vehicle|car|van|bus|train|ferry|uber|bolt|pickme/i.test(intent);
}

function isGeneralInquiryIntent(intent: string): boolean {
  return /general|inquiry|trip|itinerary|travel_planning/i.test(intent);
}

function isLowConfidenceDecision(decision: { confidence: number; intent: string }): boolean {
  return decision.confidence < 0.5 || /\b(unknown|unclear)\b/i.test(decision.intent);
}

function isTripPlanningPrompt(message: string): boolean {
  return isItineraryRequestMessage(message) || /\b(plan|planning|itinerary|trip|holiday|vacation)\b/i.test(message);
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
  if (!hasCompleteHotelCriteria(criteria)) {
    return 'I do not have the completed hotel search form details yet. Please complete the hotel form link I sent, or tell me the destination, dates, guests, rooms, and budget so I can continue.';
  }

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

function buildRestaurantPreferencePrompt(criteria: RestaurantSearchCriteria): string {
  if (!hasCompleteRestaurantCriteria(criteria)) {
    return 'I do not have the completed restaurant search details yet. Please complete the restaurant form link I sent, or tell me the location, date, time, guests, cuisine, and budget so I can continue.';
  }

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
    `Budget: ${criteria.priceRange ?? 'No preference'}`,
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

function buildItineraryPreferencePrompt(criteria: ItineraryCriteria): string {
  if (!hasCompleteItineraryCriteria(criteria)) {
    return 'I do not have the completed trip planning details yet. Please complete the itinerary form link I sent, or tell me your arrival, departure, guests, budget, transport, and main interests.';
  }

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
    'You can still edit it after I send the plan: more beach time, less driving, add safari, remove nightlife, change day 3, or book hotels.',
  ].join('\n');
}

function buildExcursionPreferencePrompt(criteria: ExcursionSearchCriteria): string {
  if (!hasCompleteExcursionCriteria(criteria)) {
    return 'I do not have the completed excursion details yet. Please complete the excursion form link I sent, or tell me the destination, date, time, guests, activity type, and budget so I can continue.';
  }

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
    `Budget: ${criteria.budget ?? 'No preference'}`,
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

function buildLogisticsPreferencePrompt(criteria: LogisticsSearchCriteria): string {
  if (!hasCompleteLogisticsCriteria(criteria)) {
    return 'I do not have the completed transport details yet. Please complete the transport form link I sent, or tell me the pickup, destination, date, time, passengers, and vehicle preference so I can continue.';
  }

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

function hasCompleteHotelCriteria(criteria: HotelSearchCriteria): boolean {
  return Boolean(
    criteria.location &&
      criteria.checkinDate &&
      criteria.checkoutDate &&
      criteria.guests &&
      criteria.rooms
  );
}

function hasCompleteRestaurantCriteria(criteria: RestaurantSearchCriteria): boolean {
  return Boolean(
    criteria.location &&
      criteria.diningDate &&
      criteria.diningTime &&
      criteria.guests &&
      criteria.priceRange
  );
}

function hasCompleteItineraryCriteria(criteria: ItineraryCriteria): boolean {
  return Boolean(
    criteria.arrivalDate?.trim() &&
      criteria.arrivalTime?.trim() &&
      criteria.departureDate?.trim() &&
      criteria.departureTime?.trim() &&
      criteria.adults &&
      criteria.budget &&
      criteria.travelStyle
  );
}

function hasCompleteExcursionCriteria(criteria: ExcursionSearchCriteria): boolean {
  return Boolean(
    criteria.destination &&
      criteria.preferredDate &&
      criteria.preferredTime &&
      criteria.guests &&
      criteria.budget
  );
}

function hasCompleteLogisticsCriteria(criteria: LogisticsSearchCriteria): boolean {
  return Boolean(
    criteria.pickupLocation?.trim() &&
      criteria.destination?.trim() &&
      criteria.pickupDate?.trim() &&
      criteria.pickupTime?.trim() &&
      criteria.passengers
  );
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
    hotel.roomName ? `Room: ${hotel.roomName}` : undefined,
    hotel.sltdaVerified
      ? `Sri Lanka Tourism registration: Verified${hotel.sltdaLicenceValidUntil ? `; licence valid to ${hotel.sltdaLicenceValidUntil}` : ''}`
      : undefined,
    hotel.mealPlan ? `Meal plan: ${formatInventoryLabel(hotel.mealPlan)}` : undefined,
    hotel.refundable === undefined
      ? undefined
      : `Cancellation: ${hotel.refundable ? 'Refundable' : 'Non-refundable'}`,
    hotel.priceRange
      ? `${hotel.rateAmount !== undefined ? 'Returned total' : 'Price signal'}: ${hotel.priceRange}`
      : 'Price signal: confirm live rate',
    hotel.address ? `Address: ${hotel.address}` : undefined,
    buildHotelSmartPlaceLink(hotel) ? `Smart view: ${buildHotelSmartPlaceLink(hotel)}` : undefined,
    hotel.googleMapsUri ? `Map: ${hotel.googleMapsUri}` : undefined,
    hotel.thumbnailUrl ? `Thumbnail: ${hotel.thumbnailUrl}` : undefined,
    '',
    `Reply "book ${displayNumber}" if you would like me to request a fresh supplier rate check for this stay.`,
  ].filter((line): line is string => typeof line === 'string');

  return lines.join('\n');
}

function buildRestaurantDetailsReply(
  session: RestaurantSearchSession,
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

  const restaurant = getRestaurantSessionResultBatches(session)[latestDisplayedBatchIndex]?.[
    displayNumber - 1
  ];
  if (!restaurant) {
    return null;
  }

  const lines = [
    `${displayNumber}. ${restaurant.name}`,
    restaurant.rating
      ? `Rating: ${restaurant.rating.toFixed(1)}/5${restaurant.reviewCount ? ` (${restaurant.reviewCount} reviews)` : ''}`
      : undefined,
    restaurant.priceRange ? `Price level: ${restaurant.priceRange}` : 'Price level: confirm locally',
    restaurant.cuisine ? `Cuisine: ${restaurant.cuisine}` : undefined,
    restaurant.address ? `Address: ${restaurant.address}` : undefined,
    buildSmartPlaceLink(restaurant) ? `Smart view: ${buildSmartPlaceLink(restaurant)}` : undefined,
    restaurant.googleMapsUri ? `Map: ${restaurant.googleMapsUri}` : undefined,
    '',
    `Reply "book ${displayNumber}" if you would like me to prepare the reservation check for this restaurant.`,
  ].filter((line): line is string => typeof line === 'string');

  return lines.join('\n');
}

function buildExcursionDetailsReply(
  session: ExcursionSearchSession,
  displayNumber: number
): string | null {
  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  if (!session || latestDisplayedBatchIndex < 0) return null;

  const experience = getExcursionSessionResultBatches(session)[latestDisplayedBatchIndex]?.[
    displayNumber - 1
  ];
  if (!experience) return null;

  const lines = [
    `${displayNumber}. ${experience.name}`,
    experience.category ? `Category: ${experience.category}` : undefined,
    experience.rating
      ? `Rating: ${experience.rating.toFixed(1)}/5${experience.reviewCount ? ` (${experience.reviewCount} reviews)` : ''}`
      : undefined,
    experience.priceRange ? `Estimated price: ${experience.priceRange}` : 'Estimated price: confirm locally',
    experience.shortDescription,
    experience.address ? `Address: ${experience.address}` : undefined,
    buildSmartPlaceLink(experience) ? `Smart view: ${buildSmartPlaceLink(experience)}` : undefined,
    experience.googleMapsUri ? `Map: ${experience.googleMapsUri}` : undefined,
    '',
    `Reply "book ${displayNumber}" if you would like me to prepare the booking request for this experience.`,
  ].filter((line): line is string => typeof line === 'string');

  return lines.join('\n');
}

function buildLogisticsDetailsReply(
  session: LogisticsSearchSession,
  displayNumber: number
): string | null {
  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  if (!session || latestDisplayedBatchIndex < 0) return null;

  const option = getLogisticsSessionResultBatches(session)[latestDisplayedBatchIndex]?.[
    displayNumber - 1
  ];
  if (!option) return null;

  const lines = [
    `${displayNumber}. ${option.provider}`,
    'Status: request option only — not live inventory or a confirmed quote',
    `Vehicle: ${option.vehicle}`,
    `Quote status: ${option.estimatedPrice}`,
    `Vehicle type: ${option.vehicleType}`,
    `Suggested capacity: ${option.capacity} (operator must confirm vehicle fit)`,
    `Luggage: ${option.luggageCapacity}`,
    `Duration status: ${option.estimatedDuration}`,
    option.notes,
    '',
    `Reply "book ${displayNumber}" if you would like me to prepare an operator quote request for this option.`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return lines.join('\n');
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

async function createItineraryWorkspaceLink(
  userId: string,
  itinerary: GeneratedItinerary,
  criteria: ItineraryCriteria,
  note: string
): Promise<string> {
  const workspace = await getItineraryWorkspaceService().createOrUpdateWorkspace(
    userId,
    itinerary,
    criteria,
    note
  );
  return buildItineraryWorkspaceLink(workspace.shareToken);
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

function buildItineraryDayReply(itinerary: GeneratedItinerary, dayNumber: number): string {
  const day = itinerary.days[dayNumber - 1];
  if (!day) {
    return `I only have ${itinerary.days.length} days in this itinerary. Reply "day 1" through "day ${itinerary.days.length}".`;
  }

  return [
    `Day ${day.day} - ${day.date} - ${day.location}`,
    formatDailyPlan(day),
    '',
    'Reply "next day" to continue, or tell me what to change for this day.',
  ].join('\n');
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

async function enrichSearchResultsForWhatsApp(
  userId: string,
  fallbackMessage: string
): Promise<TwilioReply> {
  const restaurantReply = await enrichRestaurantResultsForWhatsApp(userId, fallbackMessage);
  if (restaurantReply !== fallbackMessage) {
    return restaurantReply;
  }

  const excursionReply = await enrichExcursionResultsForWhatsApp(userId, fallbackMessage);
  if (excursionReply !== fallbackMessage) {
    return excursionReply;
  }

  const logisticsReply = await enrichLogisticsResultsForWhatsApp(userId, fallbackMessage);
  if (logisticsReply !== fallbackMessage) {
    return logisticsReply;
  }

  return enrichHotelResultsForWhatsApp(userId, fallbackMessage);
}

async function enrichRestaurantResultsForWhatsApp(
  userId: string,
  fallbackMessage: string
): Promise<TwilioReply> {
  const session = await getRestaurantSearchSessionService().get(userId);

  if (!session || session.stage !== 'results') {
    return fallbackMessage;
  }

  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  const latestBatch = getRestaurantSessionResultBatches(session)[latestDisplayedBatchIndex] ?? [];
  if (latestBatch.length === 0 || !fallbackMessage.startsWith('I found these restaurant matches')) {
    return fallbackMessage;
  }

  return buildRestaurantResultCardReply(session.criteria, latestBatch);
}

async function enrichExcursionResultsForWhatsApp(
  userId: string,
  fallbackMessage: string
): Promise<TwilioReply> {
  const session = await getExcursionSearchSessionService().get(userId);

  if (!session || session.stage !== 'results') {
    return fallbackMessage;
  }

  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  const latestBatch = getExcursionSessionResultBatches(session)[latestDisplayedBatchIndex] ?? [];
  if (latestBatch.length === 0 || !fallbackMessage.startsWith('I found these experience matches')) {
    return fallbackMessage;
  }

  return buildExcursionResultCardReply(session.criteria, latestBatch);
}

async function enrichLogisticsResultsForWhatsApp(
  userId: string,
  fallbackMessage: string
): Promise<TwilioReply> {
  const session = await getLogisticsSearchSessionService().get(userId);

  if (!session || session.stage !== 'results') {
    return fallbackMessage;
  }

  const latestDisplayedBatchIndex =
    typeof session.latestDisplayedBatchIndex === 'number'
      ? session.latestDisplayedBatchIndex
      : session.nextOffset
        ? Math.ceil(session.nextOffset / 3) - 1
        : -1;

  const latestBatch = getLogisticsSessionResultBatches(session)[latestDisplayedBatchIndex] ?? [];
  if (latestBatch.length === 0 || !fallbackMessage.startsWith('I prepared illustrative transport request options')) {
    return fallbackMessage;
  }

  return buildLogisticsResultCardReply(session.criteria, latestBatch);
}

async function buildWebhookReply(
  userId: string,
  reply: string,
  voicePreferred: boolean,
  correlationId: string
): Promise<TwilioReply> {
  const enrichedReply = await enrichSearchResultsForWhatsApp(userId, reply);

  if (!voicePreferred || !isTextToSpeechEnabled()) {
    return enrichedReply;
  }

  const text = typeof enrichedReply === 'string'
    ? enrichedReply
    : enrichedReply.map((message) => message.body).join('\n\n');

  try {
    const audio = await getTextToSpeechService().synthesize(text);
    if (!audio) {
      return enrichedReply;
    }

    return [
      { body: text },
      {
        body: 'Voice reply',
        mediaUrl: audio.mediaUrl,
      },
    ];
  } catch (error) {
    logSafeOperatorFailure(console, 'tts_text_fallback_used', correlationId, error);
    return enrichedReply;
  }
}

interface TwilioMessage {
  body: string;
  mediaUrl?: string;
}

type TwilioReply = string | TwilioMessage[];

interface WhatsAppOutboundService {
  sendWhatsAppReply(
    to: string,
    body: string,
    options?: { voice?: boolean; from?: string }
  ): Promise<boolean>;
  sendWhatsAppMessages(
    to: string,
    messages: WhatsAppOutboundMessage[],
    options?: { voice?: boolean; from?: string }
  ): Promise<boolean>;
  isConfigured(): boolean;
}

function getWhatsAppOutboundService(): WhatsAppOutboundService {
  if (env.whatsapp.provider === 'openwa') {
    return getOpenWaOutboundService();
  }

  if (env.whatsapp.provider === 'meta') {
    return getMetaWhatsAppOutboundService();
  }

  return getTwilioOutboundService();
}

async function sendResultCardPage(
  to: string,
  from: string,
  messages: WhatsAppOutboundMessage[],
  acknowledgement: string,
  options: { voicePreferred?: boolean } = {}
): Promise<string | null> {
  const outbound = getWhatsAppOutboundService();
  if (!outbound.isConfigured()) {
    return null;
  }

  const delivered = await outbound.sendWhatsAppMessages(to, messages, {
    from,
    voice: options.voicePreferred,
  });

  return delivered ? acknowledgement : null;
}

async function deliverWebhookReplyThroughTwilio(
  to: string,
  from: string,
  reply: TwilioReply,
  correlationId: string
): Promise<boolean> {
  const outbound = getWhatsAppOutboundService();
  if (!outbound.isConfigured()) {
    return false;
  }

  try {
    const delivered =
      typeof reply === 'string'
        ? await outbound.sendWhatsAppReply(to, reply, { from })
        : await outbound.sendWhatsAppMessages(to, reply, { from });

    if (!delivered) {
      console.warn(`[${correlationId}] WhatsApp REST reply was not delivered; falling back to TwiML`);
    }

    return delivered;
  } catch (error) {
    logSafeOperatorFailure(console, 'whatsapp_rest_delivery_failed', correlationId, error);
    return false;
  }
}

function buildHotelResultCardReply(
  criteria: HotelSearchCriteria,
  hotels: HotelBrowseResult[],
  fallbackMessage: string
): TwilioMessage[] {
  const intro = [
    `🏨 I found these hotel matches for ${criteria.location ?? 'your search'}.`,
    criteria.additionalPreferences ? `✨ I included your preference: ${criteria.additionalPreferences}.` : undefined,
    'Reply "next" or "more" for more options, "details 1", or "book 1" to request a stay.',
  ].filter((line): line is string => typeof line === 'string');

  return [
    { body: intro.join('\n') },
    ...hotels.map((hotel, index) => buildHotelResultCard(index + 1, hotel)),
  ];
}

function buildRestaurantResultCardReply(
  criteria: RestaurantSearchCriteria,
  restaurants: RestaurantBrowseResult[]
): TwilioMessage[] {
  const intro = [
    `🍽️ I found these restaurant matches for ${criteria.location ?? 'your search'}.`,
    criteria.additionalPreferences ? `✨ I included your preference: ${criteria.additionalPreferences}.` : undefined,
    'Reply "next" or "more" for more options, "details 1", or "book 1".',
  ].filter((line): line is string => typeof line === 'string');

  return [
    { body: intro.join('\n') },
    ...restaurants.map((restaurant, index) => buildRestaurantResultCard(index + 1, restaurant)),
  ];
}

function buildExcursionResultCardReply(
  criteria: ExcursionSearchCriteria,
  experiences: ExcursionBrowseResult[]
): TwilioMessage[] {
  const intro = [
    `🧭 I found these experience matches for ${criteria.destination ?? 'your search'}.`,
    criteria.additionalPreferences ? `✨ I included your preference: ${criteria.additionalPreferences}.` : undefined,
    'Reply "next" or "more" for more options, "details 1", or "book 1".',
  ].filter((line): line is string => typeof line === 'string');

  return [
    { body: intro.join('\n') },
    ...experiences.map((experience, index) => buildExcursionResultCard(index + 1, experience)),
  ];
}

function buildLogisticsResultCardReply(
  criteria: LogisticsSearchCriteria,
  options: TransportOption[]
): TwilioMessage[] {
  const intro = [
    `🚗 I prepared illustrative transport request options from ${criteria.pickupLocation ?? 'your pickup'} to ${criteria.destination ?? 'your destination'}. These are not live provider inventory or confirmed quotes.`,
    criteria.additionalPreferences ? `✨ I included your preference: ${criteria.additionalPreferences}.` : undefined,
    'Reply "next" or "more" for more options, "details 1", or "book 1" to request an operator quote.',
  ].filter((line): line is string => typeof line === 'string');

  return [
    { body: intro.join('\n') },
    ...options.map((option, index) => buildLogisticsResultCard(index + 1, option)),
  ];
}

function buildHotelResultCard(displayNumber: number, hotel: HotelBrowseResult): TwilioMessage {
  const rating =
    typeof hotel.rating === 'number'
      ? `${hotel.rating.toFixed(1)}/5${hotel.reviewCount ? ` (${hotel.reviewCount} reviews)` : ''}`
      : 'Rating not listed';
  const mapsLink = buildGoogleMapsShortLink(hotel);
  const smartLink = buildHotelSmartPlaceLink(hotel);
  const lines = [
    smartLink ? `Smart view: ${smartLink}` : undefined,
    `🏨 *${displayNumber}. ${hotel.name}*`,
    hotel.sltdaVerified
      ? `✅ Sri Lanka Tourism registration: Verified${hotel.sltdaLicenceValidUntil ? `; licence valid to ${hotel.sltdaLicenceValidUntil}` : ''}`
      : undefined,
    `⭐ Rating: ${rating}`,
    hotel.roomName ? `🛏️ Room: ${hotel.roomName}` : undefined,
    hotel.mealPlan ? `🍽️ Meal plan: ${formatInventoryLabel(hotel.mealPlan)}` : undefined,
    hotel.refundable === undefined
      ? undefined
      : `↩️ Cancellation: ${hotel.refundable ? 'Refundable' : 'Non-refundable'}`,
    hotel.priceRange
      ? `💰 ${hotel.rateAmount !== undefined ? 'Returned total' : 'Price signal'}: ${hotel.priceRange}`
      : '💰 Price signal: confirm live rate',
    hotel.address ? `📍 Location: ${hotel.address}` : undefined,
    `✨ Why Yana picked it: ${buildHotelRecommendationReason(hotel)}`,
    mapsLink ? `🗺️ View on Google Maps: ${mapsLink}` : undefined,
    `✅ Request this stay: reply *book ${displayNumber}*`,
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(hotel.thumbnailUrl) ? hotel.thumbnailUrl : undefined,
  };
}

function formatInventoryLabel(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function buildRestaurantResultCard(
  displayNumber: number,
  restaurant: RestaurantBrowseResult
): TwilioMessage {
  const rating =
    typeof restaurant.rating === 'number'
      ? `${restaurant.rating.toFixed(1)}/5${restaurant.reviewCount ? ` (${restaurant.reviewCount} reviews)` : ''}`
      : 'Rating not listed';
  const mapsLink = buildGoogleMapsShortLink(restaurant);
  const smartLink = buildSmartPlaceLink(restaurant);
  const lines = [
    smartLink ? `Smart view: ${smartLink}` : undefined,
    `🍽️ *${displayNumber}. ${restaurant.name}*`,
    `⭐ Rating: ${rating}`,
    restaurant.priceRange ? `💰 Price level: ${restaurant.priceRange}` : '💰 Price level: confirm locally',
    restaurant.cuisine ? `🍜 Cuisine: ${restaurant.cuisine}` : undefined,
    restaurant.address ? `📍 Location: ${restaurant.address}` : undefined,
    `✨ Why Yana picked it: ${buildRestaurantRecommendationReason(restaurant)}`,
    mapsLink ? `🗺️ View on Google Maps: ${mapsLink}` : undefined,
    `✅ Book now: reply *book ${displayNumber}*`,
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(restaurant.thumbnailUrl) ? restaurant.thumbnailUrl : undefined,
  };
}

function buildExcursionResultCard(
  displayNumber: number,
  experience: ExcursionBrowseResult
): TwilioMessage {
  const rating =
    typeof experience.rating === 'number'
      ? `${experience.rating.toFixed(1)}/5${experience.reviewCount ? ` (${experience.reviewCount} reviews)` : ''}`
      : 'Rating not listed';
  const mapsLink = buildGoogleMapsShortLink(experience);
  const smartLink = buildSmartPlaceLink(experience);
  const lines = [
    smartLink ? `Smart view: ${smartLink}` : undefined,
    `🧭 *${displayNumber}. ${experience.name}*`,
    experience.category ? `🎯 Category: ${experience.category}` : undefined,
    `⭐ Rating: ${rating}`,
    experience.priceRange ? `💰 Estimated price: ${experience.priceRange}` : '💰 Estimated price: confirm locally',
    experience.shortDescription,
    experience.address ? `📍 Location: ${experience.address}` : undefined,
    `✨ Why Yana picked it: ${buildExcursionRecommendationReason(experience)}`,
    mapsLink ? `🗺️ View on Google Maps: ${mapsLink}` : undefined,
    `✅ Book now: reply *book ${displayNumber}*`,
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(experience.thumbnailUrl) ? experience.thumbnailUrl : undefined,
  };
}

function buildLogisticsResultCard(
  displayNumber: number,
  option: TransportOption
): TwilioMessage {
  const lines = [
    `🚗 *${displayNumber}. ${option.provider}*`,
    'ℹ️ Status: request option only — not live inventory or a confirmed quote',
    `🚘 Vehicle: ${option.vehicle}`,
    `💰 Quote status: ${option.estimatedPrice}`,
    `🚙 Vehicle type: ${option.vehicleType}`,
    `👥 Suggested capacity: ${option.capacity} (operator must confirm fit)`,
    `⏱️ Duration status: ${option.estimatedDuration}`,
    `✨ Why Yana picked it: ${buildLogisticsRecommendationReason(option)}`,
    `✅ Request operator quote: reply *book ${displayNumber}*`,
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ];

  return {
    body: lines.join('\n'),
    mediaUrl: buildTransportCardImageUrl(option),
  };
}

function buildHotelRecommendationReason(hotel: HotelBrowseResult): string {
  if (typeof hotel.rating === 'number' && typeof hotel.reviewCount === 'number' && hotel.reviewCount > 0) {
    return `strong guest rating with ${hotel.reviewCount} reviews and a useful location signal.`;
  }

  if (typeof hotel.rating === 'number') {
    return `strong guest rating and a useful location signal.`;
  }

  return 'it looks relevant to your location and stay preferences.';
}

function buildRestaurantRecommendationReason(restaurant: RestaurantBrowseResult): string {
  if (restaurant.cuisine && typeof restaurant.rating === 'number') {
    return `it matches the dining style with a ${restaurant.rating.toFixed(1)}/5 guest rating.`;
  }

  if (restaurant.cuisine) {
    return `it matches the cuisine and dining preferences from your form.`;
  }

  if (typeof restaurant.rating === 'number') {
    return `it has a strong ${restaurant.rating.toFixed(1)}/5 rating and fits the area.`;
  }

  return 'it fits the area and dining preferences you shared.';
}

function buildExcursionRecommendationReason(experience: ExcursionBrowseResult): string {
  if (experience.category && typeof experience.rating === 'number') {
    return `it matches the experience type with a ${experience.rating.toFixed(1)}/5 visitor rating.`;
  }

  if (experience.category) {
    return `it matches the experience type and destination you asked for.`;
  }

  if (typeof experience.rating === 'number') {
    return `it has a strong ${experience.rating.toFixed(1)}/5 visitor rating and fits the destination.`;
  }

  return 'it fits the destination and activity preferences you shared.';
}

function buildLogisticsRecommendationReason(option: TransportOption): string {
  return option.capacity > 4
    ? 'the vehicle category may fit the passenger or luggage request; an operator must confirm the actual vehicle.'
    : 'the vehicle category fits the preferences you shared; an operator must confirm the actual vehicle.';
}

function buildGoogleMapsShortLink(hotel: HotelBrowseResult): string | undefined {
  const placeId = resolveHotelGooglePlaceId(hotel);
  if (!placeId) {
    return hotel.googleMapsUri;
  }

  return `${getPublicBaseUrl()}/places/google/${encodeURIComponent(placeId)}`;
}

function buildHotelSmartPlaceLink(hotel: HotelBrowseResult): string | undefined {
  const placeId = resolveHotelGooglePlaceId(hotel);
  return placeId
    ? `${getPublicBaseUrl()}/places/smart/${encodeURIComponent(placeId)}`
    : undefined;
}

function resolveHotelGooglePlaceId(hotel: HotelBrowseResult): string | undefined {
  if (hotel.googlePlaceId) return hotel.googlePlaceId;
  if (!hotel.id || /^yana_hotel_[^:]+:yana_room_/i.test(hotel.id)) return undefined;
  return hotel.id;
}

function buildSmartPlaceLink(place: { id?: string }): string | undefined {
  if (!place.id) {
    return undefined;
  }

  return `${getPublicBaseUrl()}/places/smart/${encodeURIComponent(place.id)}`;
}

function buildTransportCardImageUrl(option: TransportOption): string {
  const params = new URLSearchParams({
    provider: option.provider,
    vehicle: option.vehicle,
    type: option.vehicleType,
  });

  return `${getPublicBaseUrl()}/media/transport-card/${encodeURIComponent(option.id)}.png?${params.toString()}`;
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

function getRestaurantSessionResultBatches(session: RestaurantSearchSession) {
  if (session.resultBatches?.length) {
    return session.resultBatches;
  }

  const batches = [];
  for (let index = 0; index < session.results.length; index += 3) {
    batches.push(session.results.slice(index, index + 3));
  }
  return batches;
}

function getExcursionSessionResultBatches(session: ExcursionSearchSession) {
  if (session.resultBatches?.length) {
    return session.resultBatches;
  }

  const batches = [];
  for (let index = 0; index < session.results.length; index += 3) {
    batches.push(session.results.slice(index, index + 3));
  }
  return batches;
}

function getLogisticsSessionResultBatches(session: LogisticsSearchSession) {
  if (session.resultBatches?.length) {
    return session.resultBatches;
  }

  const batches = [];
  for (let index = 0; index < session.results.length; index += 3) {
    batches.push(session.results.slice(index, index + 3));
  }
  return batches;
}

async function replayRestaurantResults(
  userId: string,
  session: RestaurantSearchSession
): Promise<string> {
  const firstPage = session.results.slice(0, 3);
  if (firstPage.length === 0) {
    return 'I finished checking, but I did not find usable restaurant matches for this search. Please share a new location, cuisine, or budget and I will try again.';
  }

  const nextOffset = Math.min(3, session.results.length);
  await getRestaurantSearchSessionService().saveResults(
    userId,
    session.criteria,
    session.results,
    nextOffset
  );

  return getRestaurantSearchFlowService().buildBrowseResultsPageReply(
    session.criteria,
    firstPage,
    nextOffset,
    session.results.length
  );
}

async function replayExcursionResults(
  userId: string,
  session: ExcursionSearchSession
): Promise<string> {
  const firstPage = session.results.slice(0, 3);
  if (firstPage.length === 0) {
    return 'I finished checking, but I did not find usable experience matches for this search. Please share a new destination, activity type, or budget and I will try again.';
  }

  const nextOffset = Math.min(3, session.results.length);
  await getExcursionSearchSessionService().saveResults(
    userId,
    session.criteria,
    session.results,
    nextOffset
  );

  return getExcursionSearchFlowService().buildBrowseResultsPageReply(
    session.criteria,
    firstPage,
    nextOffset,
    session.results.length
  );
}

async function replayLogisticsResults(
  userId: string,
  session: LogisticsSearchSession
): Promise<string> {
  const firstPage = session.results.slice(0, 3);
  if (firstPage.length === 0) {
    return 'I finished checking, but I did not find usable transport matches for this search. Please share a new pickup, destination, vehicle type, or passenger count and I will try again.';
  }

  const nextOffset = Math.min(3, session.results.length);
  await getLogisticsSearchSessionService().saveResults(
    userId,
    session.criteria,
    session.results,
    nextOffset
  );

  return getLogisticsSearchFlowService().buildOptionsPageReply(
    session.criteria,
    firstPage,
    nextOffset,
    session.results.length
  );
}

function buildBookingProviderBoundaryReply(hotelName: string): string {
  return [
    `I have saved your request for ${hotelName}.`,
    '',
    'No room, rate, or reservation is confirmed yet.',
    '',
    'A fresh supplier rate recheck must pass before any booking or payment step. Booking and payment remain disabled until provider and commercial approval is complete.',
  ].join('\n');
}

function buildReservationProviderBoundaryReply(restaurantName: string): string {
  return [
    'Perfect!',
    '',
    `I've selected ${restaurantName}.`,
    '',
    'The next step is to check table availability and reservation options.',
    '',
    "I'll connect this to our reservation provider in the next stage.",
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

  if (location && checkin && checkout) {
    return [
      `Got it. I will look for stays in ${location} from ${checkin} to ${checkout}.`,
      'Before I check options properly, how many guests and rooms should I plan for?',
    ].join('\n');
  }

  if (location) {
    return `Got it. I can help find stays in ${location}. What dates, number of guests, rooms, and budget should I use?`;
  }

  return 'I can help with that. Tell me the destination, dates, number of guests, rooms, and budget, and I will start checking suitable stays.';
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
      ? splitWhatsAppText(reply).map((part) => `<Message>${escapeXml(part)}</Message>`)
      : reply.flatMap((message) => {
          const bodyParts = splitWhatsAppText(message.body);
          return bodyParts.map((body, index) => {
          const parts = [
            '<Message>',
              `<Body>${escapeXml(body)}</Body>`,
              index === 0 && message.mediaUrl ? `<Media>${escapeXml(message.mediaUrl)}</Media>` : undefined,
            '</Message>',
          ].filter((part): part is string => typeof part === 'string');

          return parts.join('');
          });
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
