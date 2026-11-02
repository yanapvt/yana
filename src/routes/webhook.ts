import { workflow, missingFields as canonicalMissingFields, validateCriteria } from '../orchestration/WorkflowDefinitions.js';
import { withWorkflowLock } from '../services/WorkflowLockService.js';
const searchSnapshots = new WeakMap<object, { id: string; revision: number }>();
/**
 * WhatsApp Webhook Routes
 * Handles inbound WhatsApp messages from Twilio
 */

import {
  normalizeInboundMessage,
  TwilioWebhookPayload,
} from '../utils/messageNormalizer.js';
import { LLMServiceError } from '../services/LLMService.js';
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
import { getOutOfScopeSupportService } from '../services/OutOfScopeSupportService.js';
import {
  getSpeechToTextService,
  isSupportedVoiceContentType,
  SpeechToTextServiceError,
} from '../services/SpeechToTextService.js';
import { getTextToSpeechService, isTextToSpeechEnabled } from '../services/TextToSpeechService.js';
import { getConversationOpeningService } from '../services/ConversationOpeningService.js';
import { getConciergeConversationService, joinConciergeBubbles, unfinishedRequestHint, CONCIERGE_BUBBLE_SEPARATOR } from '../services/ConciergeConversationService.js';
import { getWeatherContextService } from '../services/WeatherContextService.js';
import { getUnfinishedWorkflowReminderService } from '../services/UnfinishedWorkflowReminderService.js';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { getOpenWaContactService } from '../services/OpenWaContactService.js';
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
import type { InboundMessage, LLMDecisionOutput } from '../types/core.js';
import type { OrchestrationResult } from '../orchestration/Orchestrator.js';
import { modelContext } from '../orchestration/ContextBuilder.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import type { ConversationControlInput } from '../orchestration/ConversationControlPlane.js';
import { PersistenceError } from '../storage/Persistence.js';
import { ItineraryEditService, resolveItineraryEdit } from '../services/ItineraryEditService.js';
import { MemoryUpdater } from '../orchestration/MemoryUpdater.js';
import { renderWhatsAppDecision } from '../orchestration/SemanticUI.js';
import type { HotelSearchCriteria } from '../services/HotelIntakeService.js';
import type { HotelBrowseResult } from '../services/GooglePlacesHotelBrowsingService.js';
import type { RestaurantBrowseResult } from '../services/GooglePlacesRestaurantBrowsingService.js';
import type { ExcursionBrowseResult } from '../services/GooglePlacesExcursionBrowsingService.js';
import { socialPlatformIcon, socialPlatformLabel, type SocialProfileLink } from '../utils/socialProfileLinks.js';
import type { TransportOption } from '../services/TransportProvider.js';
import { handleTravelFailure, logSafeOperatorFailure } from '../services/SafeFailureService.js';
import { getHumanHandoffRuntime } from '../services/handoff/HumanHandoffRuntime.js';
import { getHotelRecheckReceiptService } from '../services/handoff/HotelRecheckReceiptService.js';
import {
  getTravelJourneyStateService,
  resolveJourneyMode,
  type JourneyMode,
  type JourneyService,
} from '../services/TravelJourneyStateService.js';
import { getConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { WorkflowExecutorRegistry } from '../orchestration/WorkflowExecutorRegistry.js';
import { PostgresTravellerMemoryRepository } from '../storage/travellerMemoryRepository.js';
import type { MemoryCandidate } from '../orchestration/TravellerMemory.js';

const VOICE_TRANSCRIPTION_ERROR_MESSAGE =
  "Sorry, I couldn't clearly read that voice note. Could you send it again or type your request?";

export function buildMemoryConfirmationPrompt(candidates: MemoryCandidate[]): string {
  const sensitive = candidates.filter((candidate) => candidate.requiresConfirmation);
  if (!sensitive.length) return '';
  const descriptions = sensitive.map((candidate) => {
    const label = candidate.key === 'allergy' ? 'allergy' : 'accessibility need';
    return `${label}: ${candidate.value}`;
  });
  return `Before I use this personal information in future suggestions, may I remember ${descriptions.join(' and ')} for this trip? Reply “remember it” or “not now”.`;
}

export function withConversationalLead(reply: string, plan: OrchestrationResult): string {
  if (plan.decision.action !== 'switch_flow') return reply;
  const lead = plan.interpretation?.responseText?.trim();
  if (!lead || lead.length > 500 || /https?:\/\//i.test(lead) || reply.includes(lead)) return reply;
  return `${lead}\n\n${reply}`;
}

export async function handleTravellerMemoryConsent(
  userId: string,
  text: string,
  repository = new PostgresTravellerMemoryRepository()
): Promise<string | null> {
  const normalized = text.trim().toLocaleLowerCase().replace(/[.!?]+$/g, '');
  if (!['remember it', 'yes remember it', 'yes, remember it', 'not now', "don't remember it", 'do not remember it'].includes(normalized)) return null;
  try {
    const pending = (await repository.findForContext(userId, ['trip:current'])).filter((fact) => fact.status === 'proposed');
    if (!pending.length) return null;
    if (normalized === 'not now' || normalized.includes("don't") || normalized.includes('do not')) {
      await repository.rejectPending(userId);
      return 'Of course — I won’t retain that personal information. We can continue with your current travel request.';
    }
    await repository.confirmPending(userId);
    return 'Thank you for confirming. I’ll keep that in mind for this trip and use it only when it is relevant.';
  } catch {
    return 'I couldn’t safely update that preference just now, so I have not treated it as confirmed. We can continue without it.';
  }
}
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

interface ActiveWorkflowExecutionContext {
  userId: string;
  outboundFrom: string;
  userMessage: string;
  inboundText: string;
  correlationId: string;
  options: { voicePreferred?: boolean };
}

const activeWorkflowExecutors = new WorkflowExecutorRegistry<ActiveWorkflowExecutionContext>();
activeWorkflowExecutors.register('restaurant', executeActiveRestaurantWorkflow);
activeWorkflowExecutors.register('excursion', executeActiveExcursionWorkflow);

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
  try {
    return await withWorkflowLock(inboundMessage.from, async () => {
    await getUnfinishedWorkflowReminderService().onInbound(inboundMessage.from).catch(() => undefined);
    const result = await processNormalizedInboundMessageCore(inboundMessage, correlationId);
    const messages = new MessageRepository();
    try {
      const text = extractMessageText(result.inboundMessage);
      if (text) {
        await messages.appendConversationTurn({ traveller: inboundMessage.from, peer: inboundMessage.to,
          requestId: inboundMessage.messageId || correlationId, role: 'user', text });
        await messages.appendConversationTurn({ traveller: inboundMessage.from, peer: inboundMessage.to,
          requestId: inboundMessage.messageId || correlationId, role: 'assistant', text: result.reply.replaceAll(CONCIERGE_BUBBLE_SEPARATOR, '\n\n') });
      }
    } catch {
      result.reply += '\n\nI could not save this conversation for later. Please keep the details until we reconnect.';
    }
    await getUnfinishedWorkflowReminderService().scheduleFromReply(
      inboundMessage.from, result.reply, extractMessageText(result.inboundMessage) ?? ''
    ).catch(() => undefined);
    return result;
    });
  } catch (error) {
    if (error instanceof PersistenceError) return { inboundMessage, reply: error.message };
    throw error;
  }
}

async function processNormalizedInboundMessageCore(
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

  const userText = extractMessageText(voiceInput.inboundMessage) ?? '';
  const opening = getConversationOpeningService();
  const isTextMessage = !voiceInput.transcript && voiceInput.inboundMessage.content.type === 'text' && Boolean(userText);
  if (isTextMessage) await opening.markTextActivity(voiceInput.inboundMessage.from);
  const nameState = isTextMessage ? await opening.getNameState(voiceInput.inboundMessage.from) : null;
  const storedProfile = isTextMessage
    ? await getProfileService().getProfile(voiceInput.inboundMessage.from).catch(() => null)
    : null;
  const whatsappName = isTextMessage
    ? getInboundUserContext(voiceInput.inboundMessage).profileName ??
      (voiceInput.inboundMessage.metadata?.provider === 'openwa'
        ? await getOpenWaContactService().getWhatsAppDisplayName(voiceInput.inboundMessage.from)
        : null)
    : null;
  const journeyName = storedProfile?.form.preferredName || nameState?.preferredName || whatsappName || undefined;
  if (isTextMessage && journeyName) {
    await opening.rememberExistingName(voiceInput.inboundMessage.from, journeyName);
  }

  let effectiveMessage = journeyName
    ? {
        ...voiceInput.inboundMessage,
        metadata: { ...voiceInput.inboundMessage.metadata, preferredName: journeyName },
      }
    : voiceInput.inboundMessage;
  let conciergeLead: string | undefined;
  let personalEventLead: string | undefined;
  if (userText && env.features.conciergeEnabled && !/^(reset|restart|cancel|status|resume|next|more|book\s*[1-3]|details\s*[1-3])$/i.test(userText.trim())) {
    const recentConversation = await new MessageRepository().findRecentByTraveller(effectiveMessage.from, 4).catch(() => []);
    const active = await new ActiveConversationStateLoader().load(effectiveMessage.from).catch(() => null);
    if (active) {
      const hint = unfinishedRequestHint(active, userText);
      if (hint) return { inboundMessage: voiceInput.inboundMessage, reply: hint };
      personalEventLead = await getConciergeConversationService().proposeLead(userText, journeyName, 'personal_event', recentConversation);
    } else {
      const concierge = getConciergeConversationService();
      const stage = await concierge.stage(effectiveMessage.from);
      const proposed = stage === null
        ? await getConversationControlPlane().interpret({ inboundMessage: effectiveMessage, text: userText,
          correlationId, profileComplete: false }).then((plan) => plan.interpretation).catch(() => undefined)
        : undefined;
      const modelLead = await concierge.proposeLead(userText, journeyName, stage === null ? 'opening' : 'personal_event', recentConversation);
      const proposedFlow = proposed && !proposed.clarificationRequired && proposed.confidence >= env.llm.confidenceThreshold
        ? ({ hotel_search: 'hotel', restaurant_search: 'restaurant', excursion_search: 'excursion',
          logistics_request: 'logistics', itinerary_plan: 'itinerary' } as Record<string, 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary'>)[proposed.intent]
        : undefined;
      const openingResult = await concierge.open(
        effectiveMessage.from, effectiveMessage.messageId, userText, journeyName,
        { flow: proposedFlow, lead: modelLead ?? proposed?.responseText }
      );
      if (openingResult.reply) return { inboundMessage: voiceInput.inboundMessage, reply: openingResult.reply };
      conciergeLead = openingResult.lead;
      if (!conciergeLead && stage === 'opened') personalEventLead = modelLead;
      if (openingResult.text !== userText) {
        effectiveMessage = { ...effectiveMessage, content: { type: 'text', body: openingResult.text } };
      }
    }
  }
  let reply = await processInboundMessage(effectiveMessage, correlationId, {
    voicePreferred: Boolean(voiceInput.transcript),
  });
  if (env.features.weatherContextEnabled && /\b(outdoor|hike|hiking|safari|beach|surf|surfing|walking tour|boat|kayak|cycling)\b/i.test(userText)) {
    const location = /\b(here|near me|nearby)\b/i.test(userText)
      ? await new PostgresTravellerMemoryRepository()
        .findForContext(effectiveMessage.from, ['trip:current'])
        .then((facts) => facts.find((fact) => fact.key === 'current_location' && fact.status === 'confirmed')?.value)
        .catch(() => undefined)
      : undefined;
    const weatherAdvice = await getWeatherContextService().outdoorAdvice(userText, location);
    if (weatherAdvice) reply += `\n\n${weatherAdvice}`;
  }
  if (conciergeLead || personalEventLead) reply = joinConciergeBubbles(conciergeLead ?? personalEventLead!, reply);
  await synchronizeTravelJourneyState(voiceInput.inboundMessage.from, userText);

  if (voiceInput.transcript) {
    if (await opening.shouldOpenVoiceConversation(voiceInput.inboundMessage.from) && !/^(hi|hello|good\s+(morning|afternoon|evening)|i'm sorry)\b/i.test(reply)) {
      reply = `Hi there! Sure, let me help with that. ${reply}`;
    }
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
  let inboundText = extractMessageText(inboundMessage);

  if (inboundText) {
    const outOfScopeReply = await getOutOfScopeSupportService().handleMessage(
      inboundMessage.from,
      inboundText
    );
    if (outOfScopeReply) return outOfScopeReply;
  }

  if (inboundText && isFlightServiceRequestMessage(inboundText)) {
    return buildUnsupportedFlightServiceReply();
  }

  const profileGateResult = await getProfileGate().check(inboundMessage.from);
  const userContext = getInboundUserContext(inboundMessage);

  if (!profileGateResult.complete) {
    await savePendingProfileGateRequest(inboundMessage, correlationId);
    await getHotelSearchSessionService().saveProfileRequired(
      inboundMessage.from,
      extractMessageText(inboundMessage) ?? undefined
    );
    const token = getFormTokenService().createToken(inboundMessage.from, 'profile');
    return buildProfileCollectionResponse(buildProfileFormLink(token), userContext.profileName);
  }

  if (!inboundText) {
    console.log(
      `[${correlationId}] Skipping LLM decision: no text content available for message type=${inboundMessage.type}`
    );
    return 'I received your message, but I can only handle text messages in this test build.';
  }

  const reminderPreferenceReply = await getUnfinishedWorkflowReminderService()
    .handlePreferenceMessage(inboundMessage.from, inboundText).catch(() => null);
  if (reminderPreferenceReply) return reminderPreferenceReply;

  const memoryConsentReply = await handleTravellerMemoryConsent(inboundMessage.from, inboundText);
  if (memoryConsentReply) return memoryConsentReply;

  const pendingRestaurantLocationReply = await handlePendingRestaurantLocationConfirmation(
    inboundMessage.from, inboundText
  );
  if (pendingRestaurantLocationReply) return pendingRestaurantLocationReply;

  console.log(
    `[${correlationId}] Inbound user context:`,
    JSON.stringify(userContext, null, 2)
  );

  if (isResetCue(inboundText)) {
    return resetConversation(inboundMessage.from, userContext);
  }

  if (isResumeConversationCue(inboundText) && (!isResumeCue(inboundText) || /^resume$/i.test(inboundText.trim()))) {
    const resumedReply = await resumeConversation(inboundMessage.from);
    if (resumedReply) {
      return resumedReply;
    }
  }

  let userMessage = await resolveUserMessageAfterProfileGate(
    inboundMessage.from,
    inboundText,
    correlationId
  );

  const profileRequiredHotelSession = await getHotelSearchSessionService().get(inboundMessage.from);
  if (profileRequiredHotelSession?.state === 'profile_required' && isResumeCue(inboundText)) {
    userMessage = profileRequiredHotelSession.originalMessage ?? userMessage;
    await getHotelSearchSessionService().clear(inboundMessage.from);
  }

  const conversationControlInput = {
    inboundMessage,
    text: userMessage,
    correlationId,
    profileComplete: true,
    profile: await getProfileService().getProfile(inboundMessage.from),
  };
  let orchestrationPlan = await getConversationControlPlane().plan(conversationControlInput);
  const hotelIntakeService = getHotelIntakeService();
  const legacyHotelIntakeActive = !orchestrationPlan.context.activeSession &&
    typeof hotelIntakeService.hasActiveSession === 'function' &&
    await hotelIntakeService.hasActiveSession(inboundMessage.from);
  if (orchestrationPlan.analysis.shouldUseLLM && !legacyHotelIntakeActive) {
    try {
      orchestrationPlan = await getConversationControlPlane().interpret(conversationControlInput);
    } catch (error) {
      logSafeOperatorFailure(console, 'conversation_control_interpretation_failed', correlationId, error);
    }
  }
  const canonicalCommand = canonicalCommandText(orchestrationPlan);
  if (canonicalCommand) {
    inboundText = canonicalCommand;
    userMessage = canonicalCommand;
  }
  console.log('conversation_control_decision', {
    correlationId,
    action: orchestrationPlan.decision.action,
    targetFlow: orchestrationPlan.decision.targetFlow,
    activeFlow: orchestrationPlan.context.activeSession?.flow ?? 'none',
    awaitedField: orchestrationPlan.context.activeSession?.awaitedField ?? 'none',
    redacted: true,
  });

  let memoryConfirmationPrompt = '';
  if (orchestrationPlan.interpretation?.memoryCandidates?.length) {
    const memoryOutcome = await new MemoryUpdater().persistContextMemories(
      orchestrationPlan.context,
      orchestrationPlan.memoryUpdate
    );
    console.log('conversation_context_reconciled', {
      correlationId,
      outcome: memoryOutcome.status,
      candidateCount: orchestrationPlan.interpretation.memoryCandidates.length,
      redacted: true,
    });
    if (memoryOutcome.status === 'durable') {
      memoryConfirmationPrompt = buildMemoryConfirmationPrompt(orchestrationPlan.interpretation.memoryCandidates);
    }
  }
  const withMemoryConfirmation = (reply: string): string => memoryConfirmationPrompt && !reply.includes(memoryConfirmationPrompt)
    ? `${reply}\n\n${memoryConfirmationPrompt}` : reply;

  if (
    orchestrationPlan.decision.action === 'pause_flow' ||
    (!orchestrationPlan.interpretation && isStopConversationCue(inboundText))
  ) {
    await pauseActiveOutboundSearches(inboundMessage.from);
    return withMemoryConfirmation(
      orchestrationPlan.interpretation?.responseText ||
      'Of course. I have paused this request and kept your saved details. Say “show results” when you want to continue, or ask me for something else.'
    );
  }

  if (
    orchestrationPlan.interpretation &&
    orchestrationPlan.memoryUpdate.shouldPersist &&
    orchestrationPlan.context.activeSession &&
    !isTransactionalWorkflowState(orchestrationPlan.context.activeSession.state) &&
    orchestrationPlan.decision.targetFlow === orchestrationPlan.context.activeSession.flow &&
    (orchestrationPlan.decision.action === 'continue_flow' ||
      orchestrationPlan.decision.action === 'execute_search') &&
    Object.keys(orchestrationPlan.decision.entities).length > 0
  ) {
    const outcome = await new MemoryUpdater().persistUpdate(
      orchestrationPlan.context,
      orchestrationPlan.memoryUpdate
    );
    if (outcome.status === 'failed') {
      return 'I could not safely apply that change. Please try again or use the current request form.';
    }
    if (outcome.status === 'degraded' && orchestrationPlan.decision.targetFlow === 'hotel') {
      return startFreshHotelSearch(inboundMessage.from, userMessage);
    }
    console.log('conversation_control_state_reconciled', {
      correlationId,
      flow: orchestrationPlan.decision.targetFlow,
      outcome: outcome.status,
      redacted: true,
    });
  }

  if (
    orchestrationPlan.decision.action === 'ask_clarifying_question' &&
    orchestrationPlan.context.activeSession &&
    orchestrationPlan.interpretation &&
    (orchestrationPlan.interpretation.question || orchestrationPlan.interpretation.responseText)
  ) {
    return withMemoryConfirmation(orchestrationPlan.interpretation?.question || orchestrationPlan.interpretation?.responseText ||
      'Please confirm what you would like to change. I have kept your current saved details.');
  }
  if (orchestrationPlan.decision.action === 'answer_general_question' && orchestrationPlan.interpretation?.responseText) {
    return withMemoryConfirmation(orchestrationPlan.interpretation.responseText);
  }

  if (isFlightServiceRequestMessage(userMessage)) {
    return buildUnsupportedFlightServiceReply();
  }

  if (orchestrationPlan.decision.action === 'switch_flow') {
    const switchedReply = await handleValidatedServiceSwitch(
      orchestrationPlan,
      inboundMessage.from,
      inboundMessage.to,
      userMessage,
      inboundText,
      correlationId,
      options
    );
    if (switchedReply) {
      return withMemoryConfirmation(withConversationalLead(switchedReply, orchestrationPlan));
    }
  }

  const explicitServiceSwitchReply = await handleExplicitServiceSwitch(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (explicitServiceSwitchReply) {
    return withMemoryConfirmation(withConversationalLead(explicitServiceSwitchReply, orchestrationPlan));
  }

  if (isBroadExploreRequest(userMessage)) {
    return 'Of course. What would you like to explore: hotels, excursions, restaurants, or transport?';
  }

  const orchestratedContinuation = await activeWorkflowExecutors.execute(
    orchestrationPlan,
    {
      userId: inboundMessage.from,
      outboundFrom: inboundMessage.to,
      userMessage,
      inboundText,
      correlationId,
      options,
    },
    { requireActiveFlow: true }
  );
  if (orchestratedContinuation.handled && orchestratedContinuation.reply) {
    return withMemoryConfirmation(orchestratedContinuation.reply);
  }

  const activeFlow = orchestrationPlan.context.activeSession?.flow;
  if ((!activeFlow || activeFlow === 'itinerary') && isNoExtraPreferenceCue(inboundText)) {
    const latestRequest = await getProfileService()
      .getLatestServiceRequestOverall(inboundMessage.from)
      .catch(() => null);
    if (latestRequest?.type === 'restaurant') {
      const restaurantService = getRestaurantSearchSessionService();
      let currentRestaurant = await restaurantService.get(inboundMessage.from);
      if (!currentRestaurant || currentRestaurant.stage === 'reset' ||
        (currentRestaurant.stage === 'awaiting_preferences' &&
          !hasCompleteRestaurantCriteria(currentRestaurant.criteria))) {
        const criteria = mapRestaurantRequestFormToCriteria(latestRequest.form as RestaurantRequestForm);
        await restaurantService.saveAwaitingPreferences(inboundMessage.from, criteria, {
          restaurantFormResponseId: latestRequest.id,
        });
        currentRestaurant = null;
      }
      const restaurantReply = await handleActiveRestaurantSearchSession(
        inboundMessage.from,
        inboundMessage.to,
        userMessage,
        inboundText,
        correlationId,
        currentRestaurant,
        options
      );
      if (restaurantReply) return restaurantReply;
      return 'I have your restaurant request. Tell me what you would like to change or reply “show results” to see the latest options.';
    }
  }

  if (!activeFlow || activeFlow === 'itinerary') {
    const activeItinerarySession = await getItinerarySessionService().get(inboundMessage.from);
    const activeItineraryReply = await handleActiveItinerarySession(
      inboundMessage.from,
      userMessage,
      inboundText,
      correlationId,
      activeItinerarySession
    );
    if (activeItineraryReply) return withMemoryConfirmation(activeItineraryReply);
  }

  const itineraryFormReply = await handleItineraryFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );
  if (itineraryFormReply) return itineraryFormReply;

  if (!activeFlow || activeFlow === 'itinerary') {
    const latestItineraryContinuationReply = await handleLatestItineraryRequestContinuation(
      inboundMessage.from,
      userMessage,
      inboundText,
      correlationId
    );
    if (latestItineraryContinuationReply) return latestItineraryContinuationReply;
  }

  const restaurantFormReply = await handleRestaurantFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (restaurantFormReply) {
    return withMemoryConfirmation(restaurantFormReply);
  }

  const excursionFormReply = await handleExcursionFormGate(
    inboundMessage.from,
    userMessage,
    inboundText
  );

  if (excursionFormReply) {
    return withMemoryConfirmation(excursionFormReply);
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
    return withMemoryConfirmation(activeLogisticsSearchReply);
  }

  const logisticsFormReply = await handleLogisticsFormGate(
    inboundMessage.from,
    userMessage,
    inboundText,
    validateCriteria('logistics', orchestrationPlan.decision.entities, false) as LogisticsSearchCriteria
  );

  if (logisticsFormReply) {
    return withMemoryConfirmation(logisticsFormReply);
  }

  const storedHotelSession = await getHotelSearchSessionService().get(inboundMessage.from);
  const activeHotelSession = storedHotelSession?.lifecycleStatus === 'paused' ? null : storedHotelSession;
  const conversationRoute = await routeActiveConversation(
    userMessage,
    activeHotelSession,
    correlationId,
    orchestrationPlan
  );

  if (conversationRoute.action === 'start_new_hotel_search') {
    return withMemoryConfirmation(await startFreshHotelSearch(inboundMessage.from, userMessage));
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
    return withMemoryConfirmation(activeHotelSearchReply);
  }

  const hotelFormReply = await handleHotelFormGate(
    inboundMessage.from,
    userMessage,
    inboundText,
    validateCriteria('hotel', orchestrationPlan.decision.entities, false) as HotelSearchCriteria
  );

  if (hotelFormReply) {
    return withMemoryConfirmation(hotelFormReply);
  }

  if (isResumeCue(inboundText)) {
    return buildPostProfileGreeting(inboundMessage.from, userContext);
  }

  if (isGreeting(userMessage)) {
    if (orchestrationPlan.interpretation?.responseText) return orchestrationPlan.interpretation.responseText;
    return buildWelcomeMessage(userContext);
  }

  const hotelIntakeResult = await getHotelIntakeService().handleMessage(
    userMessage,
    {
      whatsappNumber: inboundMessage.from,
      profileName: userContext.profileName,
      country: userContext.country,
      countryCode: userContext.countryCode,
      modelContext: modelContext(orchestrationPlan.context),
    }
  );

  if (hotelIntakeResult.handled) {
    return withMemoryConfirmation(await startFreshHotelSearch(inboundMessage.from, userMessage));
  }

  try {
    const interpretedPlan = orchestrationPlan;
    const decision = mapOrchestrationPlanToLegacyDecision(interpretedPlan);
    const renderedUI = interpretedPlan.ui ? renderWhatsAppDecision(interpretedPlan.ui) : undefined;

    console.log(
      `[${correlationId}] Validated orchestration decision:`,
      JSON.stringify(decision, null, 2)
    );

    if (interpretedPlan.decision.action === 'ask_clarifying_question' && interpretedPlan.context.activeSession) {
      return renderedUI?.text || interpretedPlan.interpretation?.question || interpretedPlan.interpretation?.responseText ||
        'Please confirm what you would like to change. I have kept your current saved details.';
    }
    if (interpretedPlan.decision.action === 'ask_clarifying_question' && interpretedPlan.interpretation?.question) {
      return renderedUI?.text || interpretedPlan.interpretation.question;
    }
    if (interpretedPlan.decision.action === 'answer_general_question' && interpretedPlan.interpretation?.responseText) {
      return renderedUI?.text || interpretedPlan.interpretation.responseText;
    }
    if (interpretedPlan.decision.action === 'handoff') {
      const hotel = await getHotelSearchSessionService().get(inboundMessage.from);
      if (hotel?.selectedHotel) {
        await getHotelSearchSessionService().markHandoffConsentPending(inboundMessage.from);
        return 'Would you like me to share the minimum stay-request details with a human travel concierge? Reply "yes, connect me" to consent, or "no" to keep the request here.';
      }
      return 'A human concierge may be able to help. Please choose a stay first if you would like help with a hotel request. No details have been forwarded.';
    }

    if (interpretedPlan.decision.targetFlow === 'profile') {
      const token = getFormTokenService().createToken(inboundMessage.from, 'profile');
      return buildProfileCollectionResponse(buildProfileFormLink(token), userContext.profileName);
    }

    if (/hotel|accommodation|stay|room/i.test(decision.intent)) {
      return startFreshHotelSearch(inboundMessage.from, userMessage);
    }

    // Restaurant and excursion discovery needs only a location. Do not send
    // exploratory requests through booking-only date/party forms.
    if (!isBookingIntentCue(userMessage) &&
      (isRestaurantRelatedIntent(decision.intent) || isRestaurantRequestMessage(userMessage))) {
      const location = getDiscoveryLocation(decision.parameters, userMessage);
      if (!location) {
        await clearCompetingSearchSessions(inboundMessage.from, 'restaurant');
        await getRestaurantSearchSessionService().saveAwaitingPreferences(
          inboundMessage.from,
          {},
          { originalMessage: userMessage }
        );
        return 'I can help you explore places to eat. Which town or area should I search? I’ll show suggestions first; table availability and reservations are not live through YANA yet.';
      }
      return presentRestaurantPreferenceIntake(
        inboundMessage.from,
        location,
        userMessage,
        decision.parameters
      );
    }

    if (!isBookingIntentCue(userMessage) &&
      (isExcursionRelatedIntent(decision.intent) || isExcursionRequestMessage(userMessage))) {
      const destination = getDiscoveryLocation(decision.parameters, userMessage);
      if (!destination) {
        await clearCompetingSearchSessions(inboundMessage.from, 'excursion');
        await getExcursionSearchSessionService().saveAwaitingPreferences(
          inboundMessage.from,
          {},
          { originalMessage: userMessage }
        );
        return 'I can help you explore experiences and things to do. Which town or area are you interested in? I’ll start with suggestions; live availability and booking are not connected yet.';
      }
      return startExcursionDiscovery(
        inboundMessage.from,
        inboundMessage.to,
        userMessage,
        destination,
        decision.parameters,
        correlationId,
        options
      );
    }

    if (decision.suggestedAction === 'ask_missing' && decision.missingFields.length > 0) {
      if (decision.intent === 'greeting') {
        return buildWelcomeMessage(userContext);
      }

      return interpretedPlan.interpretation?.responseText ||
        `Could you share a little more about ${decision.missingFields.join(', ')}?`;
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
        const discoveryDestination = getStringParam(decision.parameters, ['destination', 'location', 'city']);
        if (discoveryDestination && isExplorationRequest(userMessage) && !isBookingIntentCue(userMessage)) {
          const criteria: ExcursionSearchCriteria = {
            destination: discoveryDestination,
            category: getStringParam(decision.parameters, ['category', 'activity', 'interest']) ?? undefined,
            originalRequest: userMessage,
          };
          await clearCompetingSearchSessions(inboundMessage.from, 'excursion');
          await getExcursionSearchSessionService().saveSearching(inboundMessage.from, criteria);

          if (getWhatsAppOutboundService().isConfigured()) {
            void searchExcursionsAndNotify(
              inboundMessage.from,
              inboundMessage.to,
              criteria,
              correlationId,
              { voicePreferred: options.voicePreferred }
            );
            return `I’ll look for things to do in ${discoveryDestination} and send you a few ideas shortly. These are exploration suggestions, not confirmed availability or prices.`;
          }

          const discoveryResult = await searchExcursions(
            inboundMessage.from,
            criteria,
            correlationId
          );
          const nextOffset = discoveryResult.browseResponse?.results.length
            ? Math.min(3, discoveryResult.browseResponse.results.length)
            : 0;
          await saveExcursionSearchResults(
            inboundMessage.from,
            criteria,
            discoveryResult,
            nextOffset
          );
          return discoveryResult.reply;
        }

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

      if (isGeneralInquiryIntent(decision.intent) || isLowConfidenceDecision(decision)) {
        return interpretedPlan.interpretation?.responseText || buildIntentClarificationReply();
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
      return interpretedPlan.interpretation?.responseText || buildIntentClarificationReply();
    }

    return 'I can help with that. Could you tell me a little more about what you need for this trip?';
  } catch (error) {
    if (error instanceof LLMServiceError) {
      handleTravelFailure('planning', correlationId, error);
      return buildIntentClarificationReply();
    }

    throw error;
  }
}

async function handleValidatedServiceSwitch(
  plan: OrchestrationResult,
  userId: string,
  outboundFrom: string,
  userMessage: string,
  inboundText: string,
  correlationId: string,
  options: { voicePreferred?: boolean }
): Promise<string | null> {
  const fields = plan.decision.sessionPatch?.collectedFields ?? plan.decision.entities;
  if (plan.decision.targetFlow === 'excursion') {
    const destination = getStringParam(fields, ['destination', 'location']);
    if (!destination) {
      const previous = getStringParam(plan.context.activeSession?.collectedFields ?? {}, ['destination', 'location']);
      return previous
        ? `Would you like me to use ${previous} for the activity search, or are you interested in a different town or area?`
        : 'Which town or area should I use for the activity search?';
    }
    await clearCompetingSearchSessions(userId, 'excursion');
    return startExcursionDiscovery(userId, outboundFrom, userMessage, destination, fields,
      `excursion-switch-${correlationId}`, options);
  }
  if (plan.decision.targetFlow === 'restaurant') {
    const location = getStringParam(fields, ['location', 'destination']);
    if (!location) {
      const previous = getStringParam(plan.context.activeSession?.collectedFields ?? {}, ['location', 'destination']);
      await clearCompetingSearchSessions(userId, 'restaurant');
      if (previous) {
        await getRestaurantSearchSessionService().saveLocationConfirmation(userId, previous, userMessage);
        return `Would you like me to use ${previous} for the restaurant search, or should I look somewhere else?`;
      }
      await getRestaurantSearchSessionService().saveAwaitingPreferences(userId, {}, { originalMessage: userMessage });
      return 'Which town or area should I use for the restaurant search?';
    }
    await clearCompetingSearchSessions(userId, 'restaurant');
    return presentRestaurantPreferenceIntake(userId, location, userMessage);
  }
  if (plan.decision.targetFlow === 'hotel') {
    return startFreshHotelSearch(userId, userMessage);
  }
  if (plan.decision.targetFlow === 'logistics') {
    return handleLogisticsFormGate(userId, userMessage, inboundText);
  }
  if (plan.decision.targetFlow === 'itinerary') {
    return handleItineraryFormGate(userId, userMessage, inboundText);
  }
  return null;
}

async function handlePendingRestaurantLocationConfirmation(userId: string, text: string): Promise<string | null> {
  const session = await getRestaurantSearchSessionService().get(userId);
  const proposed = session?.lifecycleStatus === 'paused' ? undefined : session?.pendingLocationConfirmation;
  if (!proposed || session?.state !== 'confirming_location') return null;
  const reply = text.trim().replace(/[.!?]+$/, '');
  if (/\bsource it\b/i.test(reply)) return null;
  if (/^(?:no|no thanks|somewhere else|another place)$/i.test(reply)) {
    await getRestaurantSearchSessionService().saveAwaitingPreferences(userId, {}, {
      originalMessage: session.originalMessage,
    });
    return 'Of course. Which town or area would you prefer for dining?';
  }
  const yes = reply.match(/^(?:yes|yeah|yep|sure|ok|okay)(?:[,\s]+(?:use\s+)?(.+))?$/i);
  const alternate = yes?.[1]?.trim();
  const candidate = (yes ? alternate ?? '' : reply)
    .replace(/^(?:no,?\s+|use\s+|try\s+|search\s+in\s+|look\s+in\s+|(?:i(?:'d| would) prefer)\s+)/i, '')
    .replace(/\s+instead$/i, '').trim();
  const explicit = candidate.split(/\s+/).length <= 3
    ? getPendingDiscoveryLocation(candidate)
    : getDiscoveryLocation({}, candidate);
  if (!yes && !explicit) return null;
  const location = explicit && !/^(?:there|here|same place|same location)$/i.test(explicit) ? explicit : proposed;
  return presentRestaurantPreferenceIntake(userId, location, session.originalMessage ?? text);
}

function canonicalCommandText(plan: OrchestrationResult): string | undefined {
  if (plan.analysis.role !== 'command') return undefined;
  const selection = plan.analysis.entities.selection;
  if (typeof selection !== 'number' || selection < 1 || selection > 3) return undefined;
  if (plan.analysis.command === 'book') return `book ${selection}`;
  if (plan.analysis.command === 'details') return `details ${selection}`;
  return undefined;
}

function isTransactionalWorkflowState(state?: string): boolean {
  return Boolean(state && /(?:booking|reservation|payment|provider|handoff|confirmed|cancel)/i.test(state));
}

function buildIntentClarificationReply(): string {
  return 'I’d be happy to help with your travel plans. Are you looking for things to do or excursions, a hotel, restaurants, transport, a full trip plan, or local recommendations? Tell me what sounds useful and I’ll guide you from there.';
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
  initialCriteria: HotelSearchCriteria = {}
): Promise<string | null> {
  if (isResumeCue(inboundText)) {
    const restoredHotelRequest = await restoreLatestHotelRequest(userId);
    if (restoredHotelRequest) {
      return restoredHotelRequest;
    }
  }

  if (isHotelRequestMessage(userMessage)) {
    await getHotelIntakeService().clear(userId);
    const activeHotelSession = await getHotelSearchSessionService().get(userId);
    if (activeHotelSession?.state === 'hotel_form_sent') {
      return resendHotelFormLink(
        userId,
        userMessage,
        "I've sent a fresh hotel form link for you."
      );
    }

    await clearCompetingSearchSessions(userId, 'hotel');
    const profile = await getProfileService().getProfile(userId);
    const token = getFormTokenService().createToken(userId, 'hotel');
    const hotelFormResponse = buildHotelCollectionResponse(buildHotelFormLink(token));
    if (Object.keys(initialCriteria).length) {
      await getHotelSearchSessionService().saveHotelFormSent(userId, userMessage, profile?.form, initialCriteria);
    } else {
      await getHotelSearchSessionService().saveHotelFormSent(userId, userMessage, profile?.form);
    }

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
      const command = resolveItineraryEdit(userMessage, session);
      if (!command) return 'Which day and part of the plan would you like to change? For example: change day 2 afternoon to a museum visit.';
      const updated = await new ItineraryEditService(sessionService).apply(userId, command);
      const itinerary = updated.itinerary!;
      return buildItineraryReply(
        itinerary,
        await createItineraryWorkspaceLink(userId, itinerary, updated.criteria, 'Edited from WhatsApp')
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
    !isTripPlanningPrompt(userMessage)
  ) {
    return null;
  }

  const latestItineraryRequest = await getProfileService().getLatestServiceRequestOverall(userId);

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

  if (activeItinerarySession && isItinerarySpecificEditMessage(userMessage)) {
    return null;
  }

  if (isFreshRestaurantSearchCue(userMessage, hasActiveSession)) {
    if (isBookingIntentCue(userMessage)) {
      return handleRestaurantFormGate(userId, userMessage, inboundText);
    }
    await clearCompetingSearchSessions(userId, 'restaurant');
    if (activeHotelSession || (activeItinerarySession && /\b(restaurants?|dining|place to eat)\b/i.test(userMessage))) {
      const location = getDiscoveryLocation({}, userMessage);
      if (!location) {
        const previous = getStringParam({ ...(activeHotelSession?.criteria ?? activeItinerarySession?.criteria ?? {}) }, ['location', 'destination']);
        if (previous) {
          await getRestaurantSearchSessionService().saveLocationConfirmation(userId, previous, userMessage);
          return `Would you like me to use ${previous} for the restaurant search, or should I look somewhere else?`;
        }
        await getRestaurantSearchSessionService().saveAwaitingPreferences(
          userId,
          {},
          { originalMessage: userMessage }
        );
        return 'I can help you explore places to eat. Which town or area should I search? I’ll show suggestions first; table availability and reservations are not live through YANA yet.';
      }
      return presentRestaurantPreferenceIntake(userId, location, userMessage);
    }
    return null;
  }

  if (isExplicitHotelSearchCue(userMessage, hasActiveSession)) {
    if (activeHotelSession?.state === 'hotel_form_sent') {
      return handleHotelFormGate(userId, userMessage, inboundText);
    }
    return startFreshHotelSearch(userId, userMessage);
  }

  if (
    activeItinerarySession &&
    isHotelRequestMessage(userMessage) &&
    !isItinerarySpecificEditMessage(userMessage)
  ) {
    return startFreshHotelSearch(userId, userMessage);
  }

  if (isFreshExcursionSearchCue(userMessage, hasActiveSession)) {
    if (isBookingIntentCue(userMessage)) {
      return handleExcursionFormGate(userId, userMessage, inboundText);
    }
    await clearCompetingSearchSessions(userId, 'excursion');
    if (activeHotelSession || (activeItinerarySession && /\b(excursions?|activities|things to do|attractions?|tours?)\b/i.test(userMessage))) {
      const destination = getDiscoveryLocation({}, userMessage);
      if (!destination) {
        await getExcursionSearchSessionService().saveAwaitingPreferences(
          userId,
          {},
          { originalMessage: userMessage }
        );
        return 'I can help you explore experiences and things to do. Which town or area are you interested in? I’ll start with suggestions; live availability and booking are not connected yet.';
      }
      return startExcursionDiscovery(
        userId,
        process.env.TWILIO_WHATSAPP_NUMBER ?? '',
        userMessage,
        destination,
        {},
        `excursion-switch-${Date.now()}`,
        {}
      );
    }
    return null;
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

  if (isRestaurantRequestMessage(userMessage) && isBookingIntentCue(userMessage)) {
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
      ? buildReservationProviderBoundaryReply(
          session.selectedRestaurant.selectedRestaurantSnapshot.name,
          session.selectedRestaurant.selectedRestaurantSnapshot.googleMapsUri
        )
      : 'I have your restaurant selection saved. The table availability and reservation check is the next step.';
  }

  if (session.pendingLocationConfirmation) {
    return `Would you like me to use ${session.pendingLocationConfirmation} for dining, or should I search another area?`;
  }

  if (
    session.stage === 'awaiting_preferences' &&
    !session.criteria.location
  ) {
    const location = getPendingDiscoveryLocation(inboundText);
    if (!location) {
      return 'Which town or area should I search for restaurants? You can reply with a place such as Colombo, Kandy, or Galle.';
    }
    return presentRestaurantPreferenceIntake(
      userId,
      location,
      session.originalMessage ?? userMessage
    );
  }

  if (session.stage === 'results') {
    const bookSelection = parseNumberedCue(inboundText, 'book');
    if (bookSelection) {
      const selectedRestaurant = await sessionService.selectRestaurant(userId, bookSelection);
      if (!selectedRestaurant) {
        return 'Please choose from the latest list only: book 1, book 2, or book 3.';
      }

      return buildReservationProviderBoundaryReply(
        selectedRestaurant.selectedRestaurantSnapshot.name,
        selectedRestaurant.selectedRestaurantSnapshot.googleMapsUri
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
        return 'I have shown all 9 restaurant suggestions. Reply details 1, details 2, or details 3 for more information. Please contact the restaurant directly to confirm availability or reserve.';
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
    if (!session.criteria.location && (isResumeCue(inboundText) || isResumeConversationCue(inboundText))) {
      return restoreLatestRestaurantRequest(userId);
    }
    const token = getFormTokenService().createToken(userId, 'restaurant');
    return `I have ${session.criteria.location ?? 'your dining area'} saved. Please complete the dining details here so I can search: ${buildRestaurantFormLink(token)}`;
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

  if (isExcursionRequestMessage(userMessage) && isBookingIntentCue(userMessage)) {
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
    return 'Your experience request is saved, but YANA has not contacted the provider. Availability, price, and a booking are not confirmed; provider or concierge follow-up is not connected yet.';
  }

  if (
    session.stage === 'awaiting_preferences' &&
    !session.criteria.destination
  ) {
    const destination = getPendingDiscoveryLocation(inboundText);
    if (!destination) {
      return 'Which town or area should I use for these activities? You can reply with a place such as Colombo, Kandy, or Galle.';
    }
    return startExcursionDiscovery(
      userId,
      outboundFrom,
      session.originalMessage ?? userMessage,
      destination,
      {},
      correlationId,
      options
    );
  }

  if (session.stage === 'booking_form' || session.state === 'booking_form') {
    if (isResumeCue(inboundText) || isResumeConversationCue(inboundText)) {
      return "I'm waiting for the booking request form. Please complete it, then return here and type \"done\".";
    }
  }

  if (session.stage === 'results') {
    if (session.results.length === 0) {
      if (/\b(search again|try again|retry)\b/i.test(inboundText)) {
        const criteria = session.criteria;
        await sessionService.saveSearching(userId, criteria);

        if (getWhatsAppOutboundService().isConfigured()) {
          void searchExcursionsAndNotify(userId, outboundFrom, criteria, correlationId, options);
          return 'That earlier search did not return options. I am running it again now and will send any matches here.';
        }

        const retryResult = await searchExcursions(userId, criteria, correlationId);
        await saveExcursionSearchResults(userId, criteria, retryResult, 0);
        return retryResult.reply;
      }

      return 'I could not find experience suggestions from the earlier search. Reply "search again" and I will retry, or send a different activity or destination.';
    }

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
        return 'I have shown all 9 experience suggestions. Reply details 1, details 2, or details 3 for more information. Live availability and provider booking are not connected yet.';
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
    const searchStartedAt = Date.parse(session.updatedAt);
    if (!Number.isFinite(searchStartedAt) || Date.now() - searchStartedAt > 2 * 60 * 1000) {
      const criteria = session.criteria;
      await sessionService.saveSearching(userId, criteria);

      if (getWhatsAppOutboundService().isConfigured()) {
        void searchExcursionsAndNotify(userId, outboundFrom, criteria, correlationId, options);
        return 'The earlier search stalled, so I am restarting it now. I will send any experience matches here.';
      }

      const retryResult = await searchExcursions(userId, criteria, correlationId);
      await saveExcursionSearchResults(userId, criteria, retryResult, 0);
      return retryResult.reply;
    }

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

    return resendHotelFormLink(
      userId,
      inboundText,
      'To avoid missing dates, guest count, or budget, please complete the hotel request form. I will search once it is submitted.'
    );
  }

  if (session.stage === 'booking_provider_pending' || session.state === 'booking_provider_pending') {
    if (session.humanHandoff) {
      return 'Your request is already with a human concierge. YANA will not book or charge while the concierge is handling it.';
    }
    if (session.pendingSourcingConsent) {
      if (/^(?:no|not now|cancel)$/i.test(inboundText.trim())) {
        await sessionService.clearSourcingConsentPending(userId);
        await sessionService.saveResults(userId, session.criteria, session.results, session.nextOffset);
        return 'Okay. No new sourcing request was saved. Reply "book 1", "book 2", or "next" to check another YANA option.';
      }
      if (!/^(?:yes|yes,? source it|source it)$/i.test(inboundText.trim())) {
        return 'Would you like YANA to save a sourcing request for this stay? Reply "yes, source it" or "no". Availability and price are not confirmed.';
      }
      if (!session.selectedHotel) {
        return 'Your hotel selection is no longer available. Please choose a hotel again; no sourcing request was saved.';
      }
      try {
        const sourcingForm = buildHotelSourcingRequestForm(session.criteria, session.selectedHotel.selectedHotelSnapshot);
        const latestRequest = await getProfileService().getLatestServiceRequest(userId, 'hotel');
        const previousForm = latestRequest?.form as HotelRequestForm | undefined;
        const sameRequest = previousForm?.sourcingStatus === 'awaiting_quote' &&
          previousForm.preferredHotelName === sourcingForm.preferredHotelName &&
          previousForm.preferredGooglePlaceId === sourcingForm.preferredGooglePlaceId &&
          previousForm.destination === sourcingForm.destination &&
          previousForm.checkIn === sourcingForm.checkIn &&
          previousForm.checkOut === sourcingForm.checkOut &&
          previousForm.adults === sourcingForm.adults &&
          previousForm.rooms === sourcingForm.rooms &&
          previousForm.budget === sourcingForm.budget;
        const request = sameRequest && latestRequest
          ? latestRequest
          : await getProfileService().saveServiceRequest(userId, 'hotel', sourcingForm);
        await sessionService.markSourcingRequestSaved(userId, request.id);
        return `I’ve saved your request for ${session.selectedHotel.selectedHotelSnapshot.name} with YANA. We’ll need to confirm availability and a final quote before you decide. No reservation or payment has been made. You can ask me to check another YANA option here at any time.`;
      } catch (error) {
        logSafeOperatorFailure(console, 'hotel_sourcing_request_save_failed', correlationId, error);
        return 'I could not save the YANA sourcing request yet. Please reply "yes, source it" to retry. No reservation or payment was attempted.';
      }
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
    if (session.sourcingRequestId) {
      if (isNextCue(inboundText) || parseNumberedCue(inboundText, 'book')) {
        await sessionService.saveResults(userId, session.criteria, session.results, session.nextOffset);
        return handleActiveHotelSearchSession(userId, outboundFrom, inboundText, correlationId, await sessionService.get(userId), options);
      }
      return `Your request for ${session.selectedHotel?.selectedHotelSnapshot.name ?? 'this stay'} is saved with YANA. A price and reservation are still unconfirmed. Reply "next" to see more YANA options.`;
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

      let bookingCheck: HotelSearchFlowResult;
      try {
        bookingCheck = await getHotelSearchFlowService().handleBookingCheck(
          session.criteria,
          selectedHotel.selectedHotelSnapshot,
          {
            correlationId,
            sessionId: userId,
            userLanguage: 'en',
          }
        );
      } catch (error) {
        logSafeOperatorFailure(console, 'hotel_booking_check_failed', correlationId, error);
        bookingCheck = { status: 'provider_failed', criteria: session.criteria, reply: '' };
      }
      if (bookingCheck.status === 'browse_results') {
        if (!bookingCheck.authoritativeProvider) {
          return 'I could not preserve the supplier recheck safely. Please try the booking check again. No booking or payment was attempted.';
        }
        const receipt = await getHotelRecheckReceiptService().issue(selectedHotel, session.criteria, bookingCheck.authoritativeProvider);
        await sessionService.saveRecheckReceipt(userId, receipt);
        await sessionService.markHandoffConsentPending(userId);
        return `${bookingCheck.reply}\n\nWould you like me to share the minimum stay-request details with a human travel concierge? Reply "yes, connect me" to consent.`;
      }
      if (bookingCheck.status === 'provider_not_connected' || bookingCheck.status === 'provider_failed') {
        await sessionService.markSourcingConsentPending(userId);
        return `I couldn't confirm a room for ${selectedHotel.selectedHotelSnapshot.name} through YANA's connected suppliers yet. Would you like YANA to save a sourcing request for this stay? Reply "yes, source it" or "no". We’ll confirm availability and a final quote before any booking or payment.`;
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

    if (!(isResumeCue(inboundText) || isResumeConversationCue(inboundText))) {
      // Saved results are rendered only for explicit result commands. Small
      // talk, deferrals and topic changes must not replay the first page.
      return null;
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
  correlationId: string,
  plan: OrchestrationResult
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

  const decision = mapOrchestrationPlanToLegacyDecision(plan);
  console.log(`[${correlationId}] Reusing primary conversation decision for hotel routing:`,
    JSON.stringify(decision, null, 2));
  if (decision.confidence >= 0.7 && isHotelRelatedIntent(decision.intent) &&
      (decision.suggestedAction === 'ask_missing' || decision.suggestedAction === 'execute_tool')) {
    return { action: 'start_new_hotel_search' };
  }
  return { action: 'continue_current_flow' };
}

async function handleLogisticsFormGate(
  userId: string,
  userMessage: string,
  inboundText: string,
  initialCriteria: LogisticsSearchCriteria = {}
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
    if (Object.keys(initialCriteria).length) {
      await getLogisticsSearchSessionService().saveTransportFormSent(userId, userMessage, profile?.form, initialCriteria);
    } else {
      await getLogisticsSearchSessionService().saveTransportFormSent(userId, userMessage, profile?.form);
    }

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
  await getHotelIntakeService().clear(userId);
  await getHotelSearchSessionService().clear(userId);
  await clearCompetingSearchSessions(userId, 'hotel');
  await getPendingRequestService().clearProfileGateRequest(userId);
  const reply = await handleHotelFormGate(
    userId,
    userMessage,
    userMessage
  );
  return reply
    ? `Of course. I'll start a fresh hotel search.\n\n${reply}`
    : await createHotelRequestFormReply(userId, userMessage);
}

async function createHotelRequestFormReply(userId: string, userMessage: string): Promise<string> {
  const token = getFormTokenService().createToken(userId, 'hotel');
  const hotelFormResponse = buildHotelCollectionResponse(buildHotelFormLink(token));
  const profile = await getProfileService().getProfile(userId);
  await getHotelSearchSessionService().saveHotelFormSent(userId, userMessage, profile?.form);
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
  // Explicit lifecycle state, rather than timestamp ordering, determines the
  // active workflow. Preserve competing journeys and their validated fields.
  await Promise.all([
    activeType !== 'hotel' ? getHotelSearchSessionService().pause(userId) : Promise.resolve(),
    activeType !== 'restaurant' ? getRestaurantSearchSessionService().pause(userId) : Promise.resolve(),
    activeType !== 'excursion' ? getExcursionSearchSessionService().pause(userId) : Promise.resolve(),
    activeType !== 'logistics' ? getLogisticsSearchSessionService().pause(userId) : Promise.resolve(),
    activeType !== 'itinerary' ? getItinerarySessionService().pause(userId) : Promise.resolve(),
  ]);
  if (activeType !== 'hotel') await getHotelIntakeService().clear(userId);
}

async function resetConversation(
  userId: string,
  userContext: InboundUserContext
): Promise<string> {
  await getHotelIntakeService().clear(userId);
  // Reset only the active conversation. Keep durable journey snapshots,
  // selected options, and any provider/booking receipts available for resume.
  await pauseActiveOutboundSearches(userId);
  await getPendingRequestService().clearProfileGateRequest(userId);
  await getTravelJourneyStateService().clear(userId);

  const greeting = await buildPostProfileGreeting(userId, userContext);
  return `${greeting}\n\nI have reset the active conversation and paused your saved requests. Tell me what you would like to do next, or say "where were we" to resume one.`;
}

async function pauseActiveOutboundSearches(userId: string): Promise<void> {
  const hotelService = getHotelSearchSessionService();
  const restaurantService = getRestaurantSearchSessionService();
  const excursionService = getExcursionSearchSessionService();
  const logisticsService = getLogisticsSearchSessionService();
  const [hotel, restaurant, excursion, logistics] = await Promise.all([
    hotelService.get(userId),
    restaurantService.get(userId),
    excursionService.get(userId),
    logisticsService.get(userId),
  ]);

  if (hotel) await hotelService.pauseOutbound(userId);
  await Promise.all([
    restaurant ? restaurantService.pause(userId) : Promise.resolve(),
    excursion ? excursionService.pause(userId) : Promise.resolve(),
    logistics ? logisticsService.pause(userId) : Promise.resolve(),
    getItinerarySessionService().pause(userId),
  ]);
}

async function synchronizeTravelJourneyState(userId: string, userText: string): Promise<void> {
  try {
    const [hotel, restaurant, excursion, logistics, itinerary] = await Promise.all([
      getHotelSearchSessionService().get(userId),
      getRestaurantSearchSessionService().get(userId),
      getExcursionSearchSessionService().get(userId),
      getLogisticsSearchSessionService().get(userId),
      getItinerarySessionService().get(userId),
    ]);

    const activeSessions: Array<{
      service: JourneyService;
      updatedAt: string;
      stage: string;
    }> = [];
    if (hotel && hotel.state !== 'reset' && hotel.lifecycleStatus !== 'paused') {
      activeSessions.push({ service: 'hotel', updatedAt: hotel.updatedAt, stage: hotel.stage });
    }
    if (restaurant && restaurant.state !== 'reset' && restaurant.lifecycleStatus !== 'paused') {
      activeSessions.push({ service: 'restaurant', updatedAt: restaurant.updatedAt, stage: restaurant.stage });
    }
    if (excursion && excursion.state !== 'reset' && excursion.lifecycleStatus !== 'paused') {
      activeSessions.push({ service: 'excursion', updatedAt: excursion.updatedAt, stage: excursion.stage });
    }
    if (logistics && logistics.state !== 'reset' && logistics.lifecycleStatus !== 'paused') {
      activeSessions.push({ service: 'transport', updatedAt: logistics.updatedAt, stage: logistics.stage });
    }
    if (itinerary && itinerary.state !== 'completed' && itinerary.lifecycleStatus !== 'paused') {
      activeSessions.push({ service: 'itinerary', updatedAt: itinerary.updatedAt, stage: itinerary.state });
    }

    const activeSession = activeSessions.sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0];
    const inferredService = inferJourneyService(userText);
    const activeService = isBroadExploreRequest(userText)
      ? undefined
      : inferredService ?? activeSession?.service;
    const isBookingStage = Boolean(activeSession && isBookingStageForJourney(activeSession));
    const mode: JourneyMode = isPlainChatMessage(userText) && !isBookingStage
      ? 'chat'
      : resolveJourneyMode({
          message: userText,
          activeService,
          bookingStageActive: isBookingStage,
        });

    await getTravelJourneyStateService().set(userId, mode, mode === 'chat' ? undefined : activeService);
  } catch {
    // Journey-state bookkeeping is auxiliary; never block a customer reply on it.
    console.warn('[TravelJourneyState] Could not update conversation mode');
  }
}

function isBookingStageForJourney(session: { service: JourneyService; stage: string }): boolean {
  if (session.service === 'hotel') return session.stage === 'booking_provider_pending';
  if (session.service === 'restaurant') return session.stage === 'reservation_pending';
  if (session.service === 'excursion' || session.service === 'transport') {
    return session.stage === 'booking_form' || session.stage === 'provider_pending';
  }
  return session.stage === 'awaiting_booking';
}

function isPlainChatMessage(message: string): boolean {
  return isGreeting(message) ||
    /^(?:thanks|thank you|okay|ok|cool|great|all good|how are you)[.!? ]*$/i.test(message.trim());
}

function isBroadExploreRequest(message: string): boolean {
  return /\b(?:i(?:'m| am) just exploring|i want to explore|let(?:'s| us) explore|help me explore|what can i explore)\b/i.test(message) &&
    !inferJourneyService(message);
}

function isExplorationRequest(message: string): boolean {
  return /\b(?:what can (?:i|we) do|what should (?:i|we) do|things to do|things can (?:i|we) do|what can (?:i|we) see|what should (?:i|we) see|what(?:'s| is) (?:on|happening)|anything to do|anything happening|activities|excursions|experiences|local sights|sightseeing|ideas|recommendations|suggestions|explore)\b/i.test(message);
}

function inferJourneyService(message: string): JourneyService | undefined {
  if (isHotelRequestMessage(message)) return 'hotel';
  if (isRestaurantRequestMessage(message)) return 'restaurant';
  if (isExcursionRequestMessage(message)) return 'excursion';
  if (isLogisticsRequestMessage(message)) return 'transport';
  if (isItineraryRequestMessage(message)) return 'itinerary';
  return undefined;
}

async function resumeConversation(userId: string): Promise<string | null> {
  type ResumeCandidate = {
    flow: string;
    session: { lifecycleStatus?: 'active' | 'paused'; updatedAt: string; state: string; stage: string; location?: string };
    resume: () => Promise<void>;
  };
  const asCandidate = <T extends { lifecycleStatus?: 'active' | 'paused'; updatedAt: string; state: string; criteria: object; stage?: string }>(
    flow: string,
    session: T,
    resume: () => Promise<void>
  ): ResumeCandidate => {
    const location = (session.criteria as Record<string, unknown>).location;
    return { flow, session: { lifecycleStatus: session.lifecycleStatus, updatedAt: session.updatedAt,
      state: session.state, stage: session.stage ?? session.state,
      location: typeof location === 'string' ? location : undefined }, resume };
  };
  const [hotel, restaurant, excursion, logistics, itinerary] = await Promise.all([
    getHotelSearchSessionService().getAuthoritative(userId),
    getRestaurantSearchSessionService().getAuthoritative(userId),
    getExcursionSearchSessionService().getAuthoritative(userId),
    getLogisticsSearchSessionService().getAuthoritative(userId),
    getItinerarySessionService().getAuthoritative(userId),
  ]);
  const candidates: ResumeCandidate[] = [
    hotel && hotel.state !== 'reset' ? asCandidate('hotel', hotel, () => getHotelSearchSessionService().resume(userId)) : null,
    restaurant && restaurant.state !== 'reset' ? asCandidate('restaurant', restaurant, () => getRestaurantSearchSessionService().resume(userId)) : null,
    excursion && excursion.state !== 'reset' ? asCandidate('excursion', excursion, () => getExcursionSearchSessionService().resume(userId)) : null,
    logistics && logistics.state !== 'reset' ? asCandidate('transport', logistics, () => getLogisticsSearchSessionService().resume(userId)) : null,
    itinerary && itinerary.state !== 'completed' ? asCandidate('itinerary', itinerary, () => getItinerarySessionService().resume(userId)) : null,
  ].filter((candidate): candidate is ResumeCandidate => candidate !== null);
  let selected = candidates.find((candidate) => candidate.session.lifecycleStatus !== 'paused');
  if (!selected) {
    selected = candidates
      .filter((candidate) => candidate.session.lifecycleStatus === 'paused')
      .sort((left, right) => Date.parse(right.session.updatedAt) - Date.parse(left.session.updatedAt))[0];
    if (selected) await selected.resume();
  }

  if (selected && selected.flow !== 'hotel') {
    const location = selected.session.location ? ` for ${selected.session.location}` : '';
    const stage = selected.session.stage ?? selected.session.state;
    const next = stage === 'searching' ? 'I am still checking the options and will send them here.'
      : stage === 'results' || stage === 'showing_results' ? 'Say “show results” to see the saved options.'
        : 'Your saved details are ready to continue.';
    return `I’ve resumed your ${selected.flow} request${location}. ${next}`;
  }

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
    await saveHotelSearchResults(userId, criteria, hotelSearchResult, 0);
    const shouldContinue = () => isCurrentHotelDelivery(userId, hotelSearchResult);

    if (hotelSearchResult.browseResponse?.results.length) {
      const firstPage = hotelSearchResult.browseResponse.results.slice(0, 3);
      const delivered = await getWhatsAppOutboundService().sendWhatsAppMessages(
        userId,
        buildHotelResultCardReply(criteria, firstPage, hotelSearchResult.reply),
        { voice: options.voicePreferred, from: outboundFrom, shouldContinue }
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
      { voice: options.voicePreferred, from: outboundFrom, shouldContinue }
    );
  } catch (error) {
    if (error instanceof PersistenceError) return;
    const safeFailure = handleTravelFailure('hotel', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

async function searchHotels(
  userId: string,
  criteria: HotelSearchCriteria,
  correlationId: string
): Promise<HotelSearchFlowResult> {
  const snapshot = await getHotelSearchSessionService().get(userId);
  const result = await getHotelSearchFlowService().handleBrowseSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
  if (snapshot?.id) searchSnapshots.set(result, { id: snapshot.id, revision: snapshot.revision ?? 0 });
  return result;
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
    await saveRestaurantSearchResults(userId, criteria, restaurantSearchResult, 0);

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
    if (error instanceof PersistenceError) return;
    const safeFailure = handleTravelFailure('restaurant', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

async function searchRestaurants(
  userId: string,
  criteria: RestaurantSearchCriteria,
  correlationId: string
): Promise<RestaurantSearchFlowResult> {
  const snapshot = await getRestaurantSearchSessionService().get(userId);
  const result = await getRestaurantSearchFlowService().handleBrowseSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
  if (snapshot?.id) searchSnapshots.set(result, { id: snapshot.id, revision: snapshot.revision ?? 0 });
  return result;
}

async function startRestaurantDiscovery(
  userId: string,
  outboundFrom: string,
  originalRequest: string,
  location: string,
  parameters: Record<string, unknown>,
  correlationId: string,
  options: { voicePreferred?: boolean }
): Promise<string> {
  const criteria: RestaurantSearchCriteria = {
    location,
    cuisine: getStringParam(parameters, ['cuisine', 'food_type']) ?? undefined,
    diningStyle: getStringParam(parameters, ['style', 'setting', 'atmosphere']) ?? undefined,
    dietaryRequirements: getStringParam(parameters, ['dietary', 'dietary_requirements']) ?? undefined,
    originalRequest,
  };
  await getRestaurantSearchSessionService().clear(userId);
  await clearCompetingSearchSessions(userId, 'restaurant');
  await getRestaurantSearchSessionService().saveSearching(userId, criteria);

  if (getWhatsAppOutboundService().isConfigured()) {
    void searchRestaurantsAndNotify(userId, outboundFrom, criteria, correlationId, options);
    return `I’ll look for places to eat around ${location} and send you a few suggestions shortly. These are discovery listings, not confirmed table availability or reservations.`;
  }

  try {
    const result = await searchRestaurants(userId, criteria, correlationId);
    await saveRestaurantSearchResults(
      userId,
      criteria,
      result,
      result.browseResponse?.results.length ? Math.min(3, result.browseResponse.results.length) : 0
    );
    return result.reply;
  } catch (error) {
    return handleTravelFailure('restaurant', correlationId, error).reply;
  }
}

async function presentRestaurantPreferenceIntake(
  userId: string,
  location: string,
  originalMessage: string,
  extracted: Record<string, unknown> = {}
): Promise<string> {
  const profile = await getProfileService().getProfile(userId);
  const profileDietaryRestrictions = profile?.form.dietaryRestrictions?.trim() || undefined;
  const criteria: RestaurantSearchCriteria = {
    location,
    cuisine: getStringParam(extracted, ['cuisine', 'food_type']) ?? undefined,
    diningStyle: getStringParam(extracted, ['style', 'setting', 'atmosphere']) ?? undefined,
    dietaryRequirements:
      getStringParam(extracted, ['dietary', 'dietary_requirements']) ??
      profileDietaryRestrictions,
    originalRequest: originalMessage,
  };
  const token = getFormTokenService().createToken(userId, 'restaurant');

  await getRestaurantSearchSessionService().saveAwaitingPreferences(userId, criteria, {
    originalMessage,
    profileContext: profile?.form,
  });

  if (env.whatsapp.provider === 'meta') {
    const delivered = await getMetaWhatsAppOutboundService().sendRestaurantPreferenceFlow(
      userId,
      {
        flowToken: token,
        location,
        dietaryRestrictions: profileDietaryRestrictions,
      }
    );
    if (delivered) {
      return [
        `I have ${location}. I opened a short dining-preferences form in WhatsApp.`,
        'Please confirm cuisine, party size, dietary needs, and allergies, then I’ll search.',
      ].join(' ');
    }
  }

  return buildRestaurantCollectionResponse(buildRestaurantFormLink(token));
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
    await saveExcursionSearchResults(userId, criteria, excursionSearchResult, 0);

    if (excursionSearchResult.browseResponse?.results.length) {
      const firstPage = excursionSearchResult.browseResponse.results.slice(0, 3);
      const outbound = getWhatsAppOutboundService();
      let delivered = false;

      try {
        delivered = await outbound.sendWhatsAppMessages(
          userId,
          buildExcursionResultCardReply(criteria, firstPage),
          { voice: options.voicePreferred, from: outboundFrom }
        );
      } catch (error) {
        console.warn(`[${correlationId}] Excursion result cards failed; falling back to text`, error);
      }

      if (!delivered) {
        try {
          delivered = await outbound.sendWhatsAppReply(userId, excursionSearchResult.reply, {
            voice: options.voicePreferred,
            from: outboundFrom,
          });
        } catch (error) {
          console.warn(`[${correlationId}] Excursion text fallback delivery failed`, error);
        }
      }

      await saveExcursionSearchResults(
        userId,
        criteria,
        excursionSearchResult,
        delivered ? Math.min(3, excursionSearchResult.browseResponse.results.length) : 0
      );
      return;
    }

    await saveExcursionSearchResults(userId, criteria, excursionSearchResult, 0);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      excursionSearchResult.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  } catch (error) {
    if (error instanceof PersistenceError) return;
    const safeFailure = handleTravelFailure('excursion', correlationId, error);
    const active = await getExcursionSearchSessionService().get(userId);
    if (active?.stage === 'searching' && JSON.stringify(active.criteria) === JSON.stringify(criteria)) await getExcursionSearchSessionService().saveResults(userId, criteria, [], 0, { id: active.id, revision: active.revision ?? 0 });
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

async function searchExcursions(
  userId: string,
  criteria: ExcursionSearchCriteria,
  correlationId: string
): Promise<ExcursionSearchFlowResult> {
  const snapshot = await getExcursionSearchSessionService().get(userId);
  const result = await getExcursionSearchFlowService().handleBrowseSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
  if (snapshot?.id) searchSnapshots.set(result, { id: snapshot.id, revision: snapshot.revision ?? 0 });
  return result;
}

async function startExcursionDiscovery(
  userId: string,
  outboundFrom: string,
  originalRequest: string,
  destination: string,
  parameters: Record<string, unknown>,
  correlationId: string,
  options: { voicePreferred?: boolean }
): Promise<string> {
  const criteria: ExcursionSearchCriteria = {
    destination,
    category: getStringParam(parameters, ['category', 'activity', 'interest']) ?? undefined,
    originalRequest,
  };
  await getExcursionSearchSessionService().clear(userId);
  await clearCompetingSearchSessions(userId, 'excursion');
  await getExcursionSearchSessionService().saveSearching(userId, criteria);

  if (getWhatsAppOutboundService().isConfigured()) {
    void searchExcursionsAndNotify(userId, outboundFrom, criteria, correlationId, options);
    return `I’ll look for things to do around ${destination} and send you a few suggestions shortly. These are discovery ideas, not confirmed availability or prices.`;
  }

  try {
    const result = await searchExcursions(userId, criteria, correlationId);
    await saveExcursionSearchResults(
      userId,
      criteria,
      result,
      result.browseResponse?.results.length ? Math.min(3, result.browseResponse.results.length) : 0
    );
    return result.reply;
  } catch (error) {
    return handleTravelFailure('excursion', correlationId, error).reply;
  }
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
    await saveLogisticsSearchResults(userId, criteria, logisticsSearchResult, 0);

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
    if (error instanceof PersistenceError) return;
    const safeFailure = handleTravelFailure('transport', correlationId, error);
    await getWhatsAppOutboundService().sendWhatsAppReply(
      userId,
      safeFailure.reply,
      { voice: options.voicePreferred, from: outboundFrom }
    );
  }
}

async function searchLogistics(
  userId: string,
  criteria: LogisticsSearchCriteria,
  correlationId: string
): Promise<LogisticsSearchFlowResult> {
  const snapshot = await getLogisticsSearchSessionService().get(userId);
  const result = await getLogisticsSearchFlowService().handleProviderSearch(criteria, {
    correlationId,
    sessionId: userId,
    userLanguage: 'en',
  });
  if (snapshot?.id) searchSnapshots.set(result, { id: snapshot.id, revision: snapshot.revision ?? 0 });
  return result;
}

async function saveHotelSearchResults(
  userId: string,
  criteria: HotelSearchCriteria,
  hotelSearchResult: HotelSearchFlowResult,
  nextOffset: number
): Promise<void> {
  const expected = searchSnapshots.get(hotelSearchResult);
  await getHotelSearchSessionService().saveResults(
      userId,
      criteria,
      hotelSearchResult.browseResponse?.results ?? [],
      nextOffset,
      ...(expected ? [expected] as const : [])
    );
  if (expected) searchSnapshots.set(hotelSearchResult, { ...expected, revision: expected.revision + 1 });
}

async function isCurrentHotelDelivery(
  userId: string,
  hotelSearchResult: HotelSearchFlowResult
): Promise<boolean> {
  const expected = searchSnapshots.get(hotelSearchResult);
  if (!expected) return false;
  const current = await getHotelSearchSessionService().get(userId);
  return Boolean(
    current &&
    current.id === expected.id &&
    (current.revision ?? 0) === expected.revision &&
    current.stage === 'results' &&
    !current.outboundPausedAt
  );
}
async function saveRestaurantSearchResults(
  userId: string,
  criteria: RestaurantSearchCriteria,
  restaurantSearchResult: RestaurantSearchFlowResult,
  nextOffset: number
): Promise<void> {
  const expected = searchSnapshots.get(restaurantSearchResult);
  await getRestaurantSearchSessionService().saveResults(
      userId,
      criteria,
      restaurantSearchResult.browseResponse?.results ?? [],
      nextOffset,
      ...(expected ? [expected] as const : [])
    );
  if (expected) searchSnapshots.set(restaurantSearchResult, { ...expected, revision: expected.revision + 1 });
}
async function saveExcursionSearchResults(
  userId: string,
  criteria: ExcursionSearchCriteria,
  excursionSearchResult: ExcursionSearchFlowResult,
  nextOffset: number
): Promise<void> {
  const expected = searchSnapshots.get(excursionSearchResult);
  await getExcursionSearchSessionService().saveResults(
    userId,
    criteria,
    excursionSearchResult.browseResponse?.results ?? [],
    nextOffset,
    ...(expected ? [expected] as const : [])
  );
  if (expected) searchSnapshots.set(excursionSearchResult, { ...expected, revision: expected.revision + 1 });
}
async function saveLogisticsSearchResults(
  userId: string,
  criteria: LogisticsSearchCriteria,
  logisticsSearchResult: LogisticsSearchFlowResult,
  nextOffset: number
): Promise<void> {
  const expected = searchSnapshots.get(logisticsSearchResult);
  await getLogisticsSearchSessionService().saveResults(
      userId,
      criteria,
      logisticsSearchResult.options ?? [],
      nextOffset,
      ...(expected ? [expected] as const : [])
    );
  if (expected) searchSnapshots.set(logisticsSearchResult, { ...expected, revision: expected.revision + 1 });
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
    profileName: cleanProfileName(
      typeof inboundMessage.metadata?.preferredName === 'string'
        ? inboundMessage.metadata.preferredName
        : typeof inboundMessage.metadata?.profileName === 'string'
          ? inboundMessage.metadata.profileName
          : rawPayload?.ProfileName
    ),
    country: countryMatch?.country,
    countryCode: countryMatch?.countryCode,
  };
}

function cleanProfileName(profileName?: string): string | undefined {
  const cleaned = profileName?.replace(/[\u200e\u200f]/g, '').trim();
  return cleaned && /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : undefined;
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

function isStopConversationCue(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  return /^(stop|end|stop now|end this|stop search|stop searching|stop results|cancel results)$/.test(normalized);
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
  return (
    !hasActiveSession ||
    hasFreshStartCue(message) ||
    hasDirectionChangeCue(message) ||
    /\b(find|looking for|need|want|excursion|things to do|activity|tour|safari|hiking|surfing|snorkelling|snorkeling|not a hotel)\b/i.test(message)
  );
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

function isItinerarySpecificEditMessage(message: string): boolean {
  return /\b(?:change|add|remove|replace|swap|move)\b/i.test(message) &&
    /\b(?:itinerary|day\s*[1-9][0-9]?|route|plan)\b/i.test(message);
}

function isBookingIntentCue(message: string): boolean {
  return /\b(?:book(?:ing)?|reserve|reservation|purchase|pay)\b/i.test(
    message
  );
}

function isNoExtraPreferenceCue(message: string): boolean {
  return /^(no|no thanks|none|nothing|nope|no extra|no preferences|nothing else|search|start search|start planning|plan it|go ahead|go ahead and plan)$/i.test(
    message.trim()
  );
}

function isHotelRequestMessage(message: string): boolean {
  if (/\bnot\s+(?:a\s+)?(?:hotels?|accommodation|place to stay)\b/i.test(message)) return false;
  return /\b(hotels?|stays?|accommodation|rooms?|resorts?|bnb|b&b)\b/i.test(message);
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
  return /\b(hungry|food|restaurants?|restuarents?|resturants?|resurants?|dining|eat|place to eat|where can we eat|where should we eat|breakfast|lunch|dinner|brunch|coffee|cafe|fine dining|seafood|pizza|burger|romantic dinner|romantic place|family dinner|vegetarian|vegan|buffet|steak|sushi|indian food|chinese food|sri lankan food|italian|mexican|thai|bbq|somewhere for dinner|good seafood|romantic restaurant|somewhere nice|craving)\b/i.test(
    normalized
  );
}

function isItineraryRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(plan my trip|plan my holiday|plan my itinerary|travel around|7 day itinerary|10 day itinerary|where should i go|things to see|tour sri lanka|family holiday|honeymoon|backpacking|road trip|vacation|holiday planning|travel plan|trip planner|planning my trip|visiting sri lanka|visit sri lanka|i'?ll be here for a week|travelling around sri lanka|traveling around sri lanka|need help planning|full itinerary|itinerary|itinery|intenry|itenerary|itin(?:e|a)rary|(?:one|1|a) day (?:plan|itinerary))\b/i.test(
    normalized
  );
}

function isExcursionRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(things to do|activities|excursions?|tour|tour guide|day trip|experiences?|adventure|historic places|history|temples?|forts?|museum|culture|culture tour|nature|wildlife|national park|safari|elephants?|leopards?|bird watching|whale watching|dolphins?|beach|surfing|snorkell?ing|scuba diving|diving|kayaking|rafting|hiking|trekking|mountain|waterfall|camping|cycling|shopping|markets?|gem shopping|tea factory|tea plantation|train ride|ella train|photography|sunrise|sunset|wellness|spa|yoga|meditation|nightlife|festival|concert|events?|family activities|kids activities|romantic experiences|private tour|group tour|best things|visit historic|go surfing|wife loves wildlife|looking for adventure|sightseeing|local sights?|what(?:'s| is) (?:on|happening))\b/i.test(normalized) ||
    /\bwhat (?:can|could|should) (?:i|we) (?:do|see|visit)(?:\s+(?:in|around|near|at)\b|\s+(?:here|nearby)\b)/i.test(normalized) ||
    /\b(?:anything|something) (?:to do|to see|happening)(?:\s+(?:in|around|near|at)\b|\s+(?:here|nearby)\b)/i.test(normalized);
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

async function executeActiveRestaurantWorkflow(
  context: ActiveWorkflowExecutionContext
): Promise<{ handled: boolean; reply?: string }> {
  const session = await getRestaurantSearchSessionService().get(context.userId);
  const reply = await handleActiveRestaurantSearchSession(
    context.userId,
    context.outboundFrom,
    context.userMessage,
    context.inboundText,
    context.correlationId,
    session,
    context.options
  );
  return reply ? { handled: true, reply } : { handled: false };
}

async function executeActiveExcursionWorkflow(
  context: ActiveWorkflowExecutionContext
): Promise<{ handled: boolean; reply?: string }> {
  const session = await getExcursionSearchSessionService().get(context.userId);
  const reply = await handleActiveExcursionSearchSession(
    context.userId,
    context.outboundFrom,
    context.userMessage,
    context.inboundText,
    context.correlationId,
    session,
    context.options
  );
  return reply ? { handled: true, reply } : { handled: false };
}
function mapOrchestrationPlanToLegacyDecision(
  plan: OrchestrationResult
): LLMDecisionOutput {
  const intentByFlow: Record<string, string> = {
    hotel: 'search_hotels',
    restaurant: 'search_restaurants',
    excursion: 'search_excursions',
    logistics: 'search_transport',
    itinerary: 'plan_itinerary',
    profile: 'profile_update',
    none: plan.decision.intent === 'smalltalk' ? 'greeting' : 'general_inquiry',
  };
  const suggestedAction: LLMDecisionOutput['suggestedAction'] =
    plan.decision.action === 'execute_search'
      ? 'execute_tool'
      : plan.decision.action === 'handoff'
        ? 'handoff'
        : plan.decision.action === 'continue_flow' ||
            plan.decision.action === 'send_form' ||
            plan.decision.action === 'require_profile'
          ? 'ask_missing'
          : 'clarify';

  return {
    contractVersion: plan.interpretation ? '2.0' : undefined,
    responseText: plan.interpretation?.responseText,
    intent: intentByFlow[plan.decision.targetFlow] ?? 'general_inquiry',
    intentConfidence: plan.interpretation?.confidence ?? plan.decision.confidence,
    ambiguity: plan.interpretation ? {
      isAmbiguous: Boolean(plan.interpretation.clarificationRequired),
      alternatives: [],
    } : undefined,
    clarificationRequired: plan.interpretation?.clarificationRequired,
    clarificationQuestion: plan.interpretation?.question,
    parameters: { ...plan.decision.entities },
    fieldUpdates: plan.interpretation ? { ...plan.interpretation.entities } : undefined,
    missingFields: [...plan.decision.missingFields],
    taskTransition: plan.interpretation?.taskTransition,
    recommendedSchema: plan.interpretation?.recommendedSchema,
    uiRecommendation: plan.interpretation?.uiRecommendation,
    proposedAction: plan.interpretation?.proposedAction,
    unresolvedQuestions: plan.interpretation?.unresolvedQuestions,
    suggestedAction,
    confidence: plan.decision.confidence,
    reasoning: plan.decision.reason,
  };
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
  return canonicalMissingFields('hotel', { ...criteria }, workflow('hotel')!.requestRequired).length === 0;
}

function hasCompleteRestaurantCriteria(criteria: RestaurantSearchCriteria): boolean {
  return canonicalMissingFields('restaurant', { ...criteria }, workflow('restaurant')!.requestRequired).length === 0;
}

function hasCompleteItineraryCriteria(criteria: ItineraryCriteria): boolean {
  return canonicalMissingFields('itinerary', { ...criteria }, workflow('itinerary')!.requestRequired).length === 0;
}

function hasCompleteExcursionCriteria(criteria: ExcursionSearchCriteria): boolean {
  return canonicalMissingFields('excursion', { ...criteria }, workflow('excursion')!.requestRequired).length === 0;
}

function hasCompleteLogisticsCriteria(criteria: LogisticsSearchCriteria): boolean {
  return canonicalMissingFields('logistics', { ...criteria }, workflow('logistics')!.requestRequired).length === 0;
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
    hotel.googlePlaceId || hotel.googleMapsUri ? 'Listing details: Google Maps' : undefined,
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

export async function buildWebhookReply(
  userId: string,
  reply: string,
  voicePreferred: boolean,
  correlationId: string
): Promise<TwilioReply> {
  const enrichedReply = await enrichSearchResultsForWhatsApp(userId, reply);

  if (!voicePreferred || !isTextToSpeechEnabled()) {
    return enrichedReply;
  }

  const text = (typeof enrichedReply === 'string'
    ? enrichedReply
    : enrichedReply.map((message) => message.body).join('\n\n')).replaceAll(CONCIERGE_BUBBLE_SEPARATOR, '\n\n');

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
  socialLinks?: SocialProfileLink[];
}

type TwilioReply = string | TwilioMessage[];

interface WhatsAppOutboundService {
  sendWhatsAppReply(
    to: string,
    body: string,
    options?: { voice?: boolean; from?: string; shouldContinue?: () => boolean | Promise<boolean> }
  ): Promise<boolean>;
  sendWhatsAppMessages(
    to: string,
    messages: WhatsAppOutboundMessage[],
    options?: { voice?: boolean; from?: string; shouldContinue?: () => boolean | Promise<boolean> }
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

export async function deliverWebhookReplyThroughTwilio(
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
    'Reply "next" or "more" for more options, or "details 1". These are discovery matches, not confirmed reservations; please contact the restaurant directly to reserve.',
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
    'Reply "next" or "more" for more options, or "details 1". These suggestions do not confirm live availability or booking.',
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
  const lines = [
    `🏨 *${displayNumber}. ${hotel.name}*`,
    hotel.sltdaVerified
      ? `✅ Sri Lanka Tourism registration: Verified${hotel.sltdaLicenceValidUntil ? `; licence valid to ${hotel.sltdaLicenceValidUntil}` : ''}`
      : undefined,
    `⭐ Rating: ${rating}`,
    hotel.googlePlaceId || hotel.googleMapsUri ? 'Listing details: Google Maps' : undefined,
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
    ...buildSocialProfileLines(hotel.socialLinks),
    `✅ Request this stay: reply *book ${displayNumber}*`,
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(hotel.thumbnailUrl) ? hotel.thumbnailUrl : undefined,
    socialLinks: hotel.socialLinks,
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
    ...buildSocialProfileLines(restaurant.socialLinks),
    mapsLink ? `🗺️ View on Google Maps: ${mapsLink}` : undefined,
    'ℹ️ Discovery suggestion only — YANA cannot check table availability or make a reservation yet.',
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(restaurant.thumbnailUrl) ? restaurant.thumbnailUrl : undefined,
    socialLinks: restaurant.socialLinks,
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
    ...buildSocialProfileLines(experience.socialLinks),
    mapsLink ? `🗺️ View on Google Maps: ${mapsLink}` : undefined,
    'ℹ️ Discovery suggestion only — live availability and provider booking are not connected yet.',
    `ℹ️ More info: reply *details ${displayNumber}*`,
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);

  return {
    body: lines.join('\n'),
    mediaUrl: isPublicHttpsUrl(experience.thumbnailUrl) ? experience.thumbnailUrl : undefined,
    socialLinks: experience.socialLinks,
  };
}

function buildSocialProfileLines(links?: SocialProfileLink[]): string[] {
  return (links ?? []).map(
    (link) => `${socialPlatformIcon(link.platform)} ${socialPlatformLabel(link.platform)}: ${link.url}`
  );
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

function buildHotelSourcingRequestForm(criteria: HotelSearchCriteria, hotel: HotelBrowseResult): HotelRequestForm {
  return {
    destination: criteria.location ?? hotel.address ?? '',
    checkIn: criteria.checkinDate ?? '',
    checkOut: criteria.checkoutDate ?? '',
    adults: criteria.guests ?? 2,
    children: 0,
    rooms: criteria.rooms ?? 1,
    budget: criteria.budgetPerNight
      ? `${criteria.budgetPerNight.currency} ${criteria.budgetPerNight.amount} per night`
      : 'Not specified',
    starRating: criteria.starRating,
    hotelType: criteria.hotelType,
    facilities: criteria.facilities,
    bedPreference: criteria.bedPreference,
    specialOccasion: criteria.specialOccasion,
    preferredHotelName: hotel.name,
    preferredGooglePlaceId: hotel.googlePlaceId,
    sourcingStatus: 'awaiting_quote',
  };
}

function buildReservationProviderBoundaryReply(restaurantName: string, googleMapsUri?: string): string {
  return [
    'I’ve saved your restaurant selection.',
    '',
    `Selected: ${restaurantName}.`,
    googleMapsUri ? `You can view its Google Maps listing: ${googleMapsUri}` : undefined,
    '',
    'YANA does not currently have a live restaurant reservation connection, so I cannot check table availability or reserve it. Please contact the restaurant directly to confirm.',
  ].filter(Boolean).join('\n');
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

function getDiscoveryLocation(parameters: Record<string, unknown>, message: string): string | null {
  const fromDecision = getStringParam(parameters, ['location', 'destination', 'city', 'area']);
  if (fromDecision) return fromDecision;

  const match = message.match(
    /\b(?:in|near|around|at)\s+([A-Z][A-Za-z0-9' -]{1,45}?)(?=\s+(?:tomorrow|today|tonight|this|next|for|on|what|where|with)\b|[,.!?]|$)/i
  );
  const candidate = match?.[1]?.trim();
  return candidate && !/^(?:me|here|there)$/i.test(candidate) ? candidate : null;
}

function getPendingDiscoveryLocation(message: string): string | null {
  const cleaned = message.trim().replace(/^[\s,.!?]+|[\s,.!?]+$/g, '');
  if (!cleaned || cleaned.length > 60 || !/^[\p{L}\p{M}' -]+$/u.test(cleaned)) return null;
  if (/\b(?:restaurant|resturant|resturants|dining|activities?|attractions?|hotel|transport|food|things to do)\b/i.test(cleaned)) {
    return null;
  }

  const normalized = cleaned.toLowerCase().replace(/\s+/g, ' ');
  const aliases: Record<string, string> = {
    collombo: 'Colombo',
    colombo: 'Colombo',
  };
  return aliases[normalized] ?? cleaned.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function toTwiml(reply: TwilioReply): string {
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
