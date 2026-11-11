import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InboundMessage } from '../types/core.js';
import { LLMServiceError } from '../services/LLMService.js';
import { FixtureSessionRepository, FixtureStateStore } from '../tests/fixtures/sessionStorage.js';
import { ContextBuilder } from '../orchestration/ContextBuilder.js';
import { ConversationControlPlane, initConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
const recentTurnsMock = vi.hoisted(() => vi.fn());
vi.mock('../services/WorkflowLockService.js', () => ({ withWorkflowLock: async (_user: string, operation: () => Promise<unknown>) => operation() }));
vi.mock('../db/repositories/MessageRepository.js', () => ({ MessageRepository: class {
  async findRecentByTraveller() { return recentTurnsMock(); }
  async appendConversationTurn() { return 'durable'; }
} }));

const handleMessageMock = vi.fn();
const handleCompletedIntakeMock = vi.fn();
const handleBrowseSearchMock = vi.fn();
const handleBookingCheckMock = vi.fn();
const buildBrowseResultsPageReplyMock = vi.fn();
const profileGateCheckMock = vi.fn();
const saveProfileGateRequestMock = vi.fn();
const consumeProfileGateRequestMock = vi.fn();
const clearProfileGateRequestMock = vi.fn();
const getLatestServiceRequestMock = vi.fn();
const getLatestServiceRequestOverallMock = vi.fn();
const getProfileMock = vi.fn();
const saveServiceRequestMock = vi.fn();
const getHotelSearchSessionMock = vi.fn();
const saveProfileRequiredMock = vi.fn();
const saveHotelFormSentMock = vi.fn();
const saveAwaitingPreferencesMock = vi.fn();
const saveSearchingMock = vi.fn();
const saveResultsMock = vi.fn();
const selectHotelMock = vi.fn();
const markHandoffConsentPendingMock = vi.fn();
const markSourcingConsentPendingMock = vi.fn();
const markSourcingRequestSavedMock = vi.fn();
const clearSourcingConsentPendingMock = vi.fn();
const saveRecheckReceiptMock = vi.fn();
const issueRecheckReceiptMock = vi.fn();
const clearHandoffConsentPendingMock = vi.fn();
const requestHotelHandoffMock = vi.fn();
const clearHotelSearchSessionMock = vi.fn();
const pauseHotelOutboundMock = vi.fn();
const pauseHotelSearchSessionMock = vi.fn();
const resumeHotelSearchSessionMock = vi.fn();
const getRestaurantSearchSessionMock = vi.fn();
const saveRestaurantFormSentMock = vi.fn();
const saveRestaurantAwaitingPreferencesMock = vi.fn();
const saveRestaurantLocationConfirmationMock = vi.fn();
const saveRestaurantSearchingMock = vi.fn();
const saveRestaurantResultsMock = vi.fn();
const selectRestaurantMock = vi.fn();
const clearRestaurantSearchSessionMock = vi.fn();
const pauseRestaurantSearchSessionMock = vi.fn();
const resumeRestaurantSearchSessionMock = vi.fn();
const handleRestaurantBrowseSearchMock = vi.fn();
const buildRestaurantBrowseResultsPageReplyMock = vi.fn();
const getExcursionSearchSessionMock = vi.fn();
const saveExcursionFormSentMock = vi.fn();
const saveExcursionAwaitingPreferencesMock = vi.fn();
const saveExcursionSearchingMock = vi.fn();
const saveExcursionResultsMock = vi.fn();
const selectExperienceMock = vi.fn();
const saveProviderPendingMock = vi.fn();
const clearExcursionSearchSessionMock = vi.fn();
const pauseExcursionSearchSessionMock = vi.fn();
const resumeExcursionSearchSessionMock = vi.fn();
const handleExcursionBrowseSearchMock = vi.fn();
const buildExcursionBrowseResultsPageReplyMock = vi.fn();
const getLogisticsSearchSessionMock = vi.fn();
const saveTransportFormSentMock = vi.fn();
const saveLogisticsAwaitingPreferencesMock = vi.fn();
const saveLogisticsSearchingMock = vi.fn();
const saveLogisticsResultsMock = vi.fn();
const selectTransportOptionMock = vi.fn();
const saveLogisticsProviderPendingMock = vi.fn();
const clearLogisticsSearchSessionMock = vi.fn();
const pauseLogisticsSearchSessionMock = vi.fn();
const resumeLogisticsSearchSessionMock = vi.fn();
const handleLogisticsProviderSearchMock = vi.fn();
const buildLogisticsOptionsPageReplyMock = vi.fn();
const getItinerarySessionMock = vi.fn();
const getAuthoritativeItineraryMock = vi.fn();
const commitItineraryEditMock = vi.fn();
let workspaceServiceOverride: any;
const saveItineraryFormSentMock = vi.fn();
const saveItineraryAwaitingPreferencesMock = vi.fn();
const saveItineraryPlanningMock = vi.fn();
const saveItineraryMock = vi.fn();
const saveItineraryEditingMock = vi.fn();
const setItineraryCurrentDayMock = vi.fn();
const clearItinerarySessionMock = vi.fn();
const pauseItinerarySessionMock = vi.fn();
const resumeItinerarySessionMock = vi.fn();
const clearItineraryWorkspaceMock = vi.fn();
const planItineraryMock = vi.fn();
const sendWhatsAppTextMock = vi.fn();
const sendWhatsAppReplyMock = vi.fn();
const sendWhatsAppMessagesMock = vi.fn();
const twilioOutboundConfiguredMock = vi.fn();
const llmDecideMock = vi.fn();
const generateUIContentMock = vi.fn();
const transcribeMock = vi.fn();
const outOfScopeHandleMessageMock = vi.fn();
const getNameStateMock = vi.fn();
const handleNameReplyMock = vi.fn();
const askAboutNameMock = vi.fn();
const rememberExistingNameMock = vi.fn();
const shouldOpenVoiceConversationMock = vi.fn();
const markTextActivityMock = vi.fn();
const getWhatsAppDisplayNameMock = vi.fn();

vi.mock('../services/ConversationOpeningService.js', () => ({
  getConversationOpeningService: () => ({
    getNameState: getNameStateMock,
    handleNameReply: handleNameReplyMock,
    askAboutName: askAboutNameMock,
    rememberExistingName: rememberExistingNameMock,
    shouldOpenVoiceConversation: shouldOpenVoiceConversationMock,
    markTextActivity: markTextActivityMock,
  }),
}));

vi.mock('../services/OpenWaContactService.js', () => ({
  getOpenWaContactService: () => ({ getWhatsAppDisplayName: getWhatsAppDisplayNameMock }),
}));

vi.mock('../services/HotelIntakeService.js', () => ({
  getHotelIntakeService: () => ({
    handleMessage: handleMessageMock,
    clear: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../services/HotelSearchFlowService.js', () => ({
  getHotelSearchFlowService: () => ({
    handleCompletedIntake: handleCompletedIntakeMock,
    handleBrowseSearch: handleBrowseSearchMock,
    handleBookingCheck: handleBookingCheckMock,
    buildBrowseResultsPageReply: buildBrowseResultsPageReplyMock,
  }),
}));

vi.mock('../services/hotelSearchSessionService.js', () => ({
  getHotelSearchSessionService: () => ({
    getAuthoritative: getHotelSearchSessionMock,
    get: getHotelSearchSessionMock,
    saveProfileRequired: saveProfileRequiredMock,
    saveHotelFormSent: saveHotelFormSentMock,
    saveAwaitingPreferences: saveAwaitingPreferencesMock,
    saveSearching: saveSearchingMock,
    saveResults: (userId: string, criteria: unknown, results: unknown, offset: number, _expected?: unknown) => saveResultsMock(userId, criteria, results, offset),
    selectHotel: selectHotelMock,
    markHandoffConsentPending: markHandoffConsentPendingMock,
    markSourcingConsentPending: markSourcingConsentPendingMock,
    markSourcingRequestSaved: markSourcingRequestSavedMock,
    clearSourcingConsentPending: clearSourcingConsentPendingMock,
    saveRecheckReceipt: saveRecheckReceiptMock,
    clearHandoffConsentPending: clearHandoffConsentPendingMock,
    pauseOutbound: pauseHotelOutboundMock,
    pause: pauseHotelSearchSessionMock,
    resume: resumeHotelSearchSessionMock,
    clear: clearHotelSearchSessionMock,
  }),
}));

vi.mock('../services/handoff/HumanHandoffRuntime.js', () => ({
  getHumanHandoffRuntime: () => ({ requestHotelHandoff: requestHotelHandoffMock }),
}));
vi.mock('../services/handoff/HotelRecheckReceiptService.js', () => ({
  getHotelRecheckReceiptService: () => ({ issue: issueRecheckReceiptMock }),
}));

vi.mock('../services/restaurantSearchSessionService.js', () => ({
  getRestaurantSearchSessionService: () => ({
    getAuthoritative: getRestaurantSearchSessionMock,
    get: getRestaurantSearchSessionMock,
    saveRestaurantFormSent: saveRestaurantFormSentMock,
    saveAwaitingPreferences: saveRestaurantAwaitingPreferencesMock,
    saveLocationConfirmation: saveRestaurantLocationConfirmationMock,
    saveSearching: saveRestaurantSearchingMock,
    saveResults: (userId: string, criteria: unknown, results: unknown, offset: number, _expected?: unknown) => saveRestaurantResultsMock(userId, criteria, results, offset),
    selectRestaurant: selectRestaurantMock,
    clear: clearRestaurantSearchSessionMock,
    pause: pauseRestaurantSearchSessionMock,
    resume: resumeRestaurantSearchSessionMock,
  }),
}));

vi.mock('../services/RestaurantSearchFlowService.js', () => ({
  getRestaurantSearchFlowService: () => ({
    handleBrowseSearch: handleRestaurantBrowseSearchMock,
    buildBrowseResultsPageReply: buildRestaurantBrowseResultsPageReplyMock,
  }),
}));

vi.mock('../services/excursionSearchSessionService.js', () => ({
  getExcursionSearchSessionService: () => ({
    getAuthoritative: getExcursionSearchSessionMock,
    get: getExcursionSearchSessionMock,
    saveExcursionFormSent: saveExcursionFormSentMock,
    saveAwaitingPreferences: saveExcursionAwaitingPreferencesMock,
    saveSearching: saveExcursionSearchingMock,
    saveResults: (userId: string, criteria: unknown, results: unknown, offset: number, _expected?: unknown) => saveExcursionResultsMock(userId, criteria, results, offset),
    selectExperience: selectExperienceMock,
    saveProviderPending: saveProviderPendingMock,
    clear: clearExcursionSearchSessionMock,
    pause: pauseExcursionSearchSessionMock,
    resume: resumeExcursionSearchSessionMock,
  }),
}));

vi.mock('../services/ExcursionSearchFlowService.js', () => ({
  getExcursionSearchFlowService: () => ({
    handleBrowseSearch: handleExcursionBrowseSearchMock,
    buildBrowseResultsPageReply: buildExcursionBrowseResultsPageReplyMock,
  }),
}));

vi.mock('../services/logisticsSearchSessionService.js', () => ({
  getLogisticsSearchSessionService: () => ({
    getAuthoritative: getLogisticsSearchSessionMock,
    get: getLogisticsSearchSessionMock,
    saveTransportFormSent: saveTransportFormSentMock,
    saveAwaitingPreferences: saveLogisticsAwaitingPreferencesMock,
    saveSearching: saveLogisticsSearchingMock,
    saveResults: (userId: string, criteria: unknown, results: unknown, offset: number, _expected?: unknown) => saveLogisticsResultsMock(userId, criteria, results, offset),
    selectOption: selectTransportOptionMock,
    saveProviderPending: saveLogisticsProviderPendingMock,
    clear: clearLogisticsSearchSessionMock,
    pause: pauseLogisticsSearchSessionMock,
    resume: resumeLogisticsSearchSessionMock,
  }),
}));

vi.mock('../services/LogisticsSearchFlowService.js', () => ({
  getLogisticsSearchFlowService: () => ({
    handleProviderSearch: handleLogisticsProviderSearchMock,
    buildOptionsPageReply: buildLogisticsOptionsPageReplyMock,
  }),
}));

vi.mock('../services/itinerarySessionService.js', () => ({
  getItinerarySessionService: () => ({
    getAuthoritative: getAuthoritativeItineraryMock,
    commitEdit: commitItineraryEditMock,
    get: getItinerarySessionMock,
    saveFormSent: saveItineraryFormSentMock,
    saveAwaitingPreferences: saveItineraryAwaitingPreferencesMock,
    savePlanning: saveItineraryPlanningMock,
    saveItinerary: saveItineraryMock,
    saveEditing: saveItineraryEditingMock,
    setCurrentDay: setItineraryCurrentDayMock,
    clear: clearItinerarySessionMock,
    pause: pauseItinerarySessionMock,
    resume: resumeItinerarySessionMock,
  }),
}));

vi.mock('../services/ItineraryWorkspaceService.js', () => ({
  getItineraryWorkspaceService: () => workspaceServiceOverride ?? ({
    createOrUpdateWorkspace: vi.fn().mockResolvedValue({ shareToken: 'test-workspace-token' }),
    clearUserWorkspace: clearItineraryWorkspaceMock,
  }),
}));

vi.mock('../services/ItineraryPlannerService.js', () => ({
  getItineraryPlannerService: () => ({
    plan: planItineraryMock,
  }),
}));

vi.mock('../services/twilioOutboundService.js', () => ({
  getTwilioOutboundService: () => ({
    sendWhatsAppText: sendWhatsAppTextMock,
    sendWhatsAppReply: sendWhatsAppReplyMock,
    sendWhatsAppMessages: sendWhatsAppMessagesMock,
    isConfigured: twilioOutboundConfiguredMock,
  }),
}));

vi.mock('../services/OpenWaOutboundService.js', () => ({
  getOpenWaOutboundService: () => ({
    sendWhatsAppText: sendWhatsAppTextMock,
    sendWhatsAppReply: sendWhatsAppReplyMock,
    sendWhatsAppMessages: sendWhatsAppMessagesMock,
    isConfigured: twilioOutboundConfiguredMock,
  }),
}));

vi.mock('../services/profileGate.js', () => ({
  getProfileGate: () => ({
    check: profileGateCheckMock,
  }),
}));

vi.mock('../services/pendingRequestService.js', () => ({
  getPendingRequestService: () => ({
    saveProfileGateRequest: saveProfileGateRequestMock,
    consumeProfileGateRequest: consumeProfileGateRequestMock,
    clearProfileGateRequest: clearProfileGateRequestMock,
  }),
}));

vi.mock('../services/profileService.js', () => ({
  getProfileService: () => ({
    getLatestServiceRequest: getLatestServiceRequestMock,
    getLatestServiceRequestOverall: getLatestServiceRequestOverallMock,
    getProfile: getProfileMock,
    saveServiceRequest: saveServiceRequestMock,
  }),
}));

vi.mock('../services/LLMService.js', () => ({
  getLLMService: () => ({
    decide: llmDecideMock,
    generateUIContent: generateUIContentMock,
  }),
  LLMServiceError: class LLMServiceError extends Error {
    code = 'TEST';
    retryable = false;
  },
}));

vi.mock('../services/OutOfScopeSupportService.js', () => ({
  getOutOfScopeSupportService: () => ({ handleMessage: outOfScopeHandleMessageMock }),
}));

vi.mock('../services/SpeechToTextService.js', () => {
  class SpeechToTextServiceError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly retryable = false
    ) {
      super(message);
      this.name = 'SpeechToTextServiceError';
    }
  }

  return {
    getSpeechToTextService: () => ({
      transcribe: transcribeMock,
    }),
    isSupportedVoiceContentType: (contentType?: string) =>
      Boolean(contentType && (/^audio\//i.test(contentType) || /ogg|opus/i.test(contentType))),
    SpeechToTextServiceError,
  };
});

import { SpeechToTextServiceError } from '../services/SpeechToTextService.js';
import { processInboundMessage, processNormalizedInboundMessage, processWebhookPayload } from './webhook.js';

describe('webhook hotel search flow', () => {
  beforeEach(() => {
    workspaceServiceOverride = undefined;
    getAuthoritativeItineraryMock.mockImplementation((id: string) => getItinerarySessionMock(id));
    vi.clearAllMocks();
    recentTurnsMock.mockReset().mockResolvedValue([]);
    getNameStateMock.mockResolvedValue(null);
    handleNameReplyMock.mockResolvedValue(null);
    askAboutNameMock.mockResolvedValue(null);
    rememberExistingNameMock.mockResolvedValue(undefined);
    shouldOpenVoiceConversationMock.mockResolvedValue(false);
    markTextActivityMock.mockResolvedValue(undefined);
    getWhatsAppDisplayNameMock.mockResolvedValue(null);
    outOfScopeHandleMessageMock.mockResolvedValue(null);
    handleMessageMock.mockResolvedValue({ handled: false });
    profileGateCheckMock.mockResolvedValue({ complete: true });
    consumeProfileGateRequestMock.mockResolvedValue(null);
    getLatestServiceRequestMock.mockResolvedValue(null);
    getLatestServiceRequestOverallMock.mockResolvedValue(null);
    getProfileMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      form: {
        preferredName: 'Sam',
      },
    });
    saveServiceRequestMock.mockResolvedValue({ id: 'yana-sourcing-request-1' });
    getHotelSearchSessionMock.mockResolvedValue(null);
    getRestaurantSearchSessionMock.mockResolvedValue(null);
    getExcursionSearchSessionMock.mockResolvedValue(null);
    getLogisticsSearchSessionMock.mockResolvedValue(null);
    getItinerarySessionMock.mockResolvedValue(null);
    saveProfileRequiredMock.mockResolvedValue(undefined);
    saveHotelFormSentMock.mockResolvedValue(undefined);
    saveRestaurantFormSentMock.mockResolvedValue(undefined);
    saveRestaurantAwaitingPreferencesMock.mockResolvedValue(undefined);
    saveRestaurantLocationConfirmationMock.mockResolvedValue(undefined);
    saveExcursionFormSentMock.mockResolvedValue(undefined);
    saveExcursionAwaitingPreferencesMock.mockResolvedValue(undefined);
    saveTransportFormSentMock.mockResolvedValue(undefined);
    saveLogisticsAwaitingPreferencesMock.mockResolvedValue(undefined);
    saveItineraryFormSentMock.mockResolvedValue(undefined);
    saveItineraryAwaitingPreferencesMock.mockResolvedValue(undefined);
    saveSearchingMock.mockResolvedValue(undefined);
    saveResultsMock.mockResolvedValue(undefined);
    saveRestaurantSearchingMock.mockResolvedValue(undefined);
    saveRestaurantResultsMock.mockResolvedValue(undefined);
    saveExcursionSearchingMock.mockResolvedValue(undefined);
    saveExcursionResultsMock.mockResolvedValue(undefined);
    saveLogisticsSearchingMock.mockResolvedValue(undefined);
    saveLogisticsResultsMock.mockResolvedValue(undefined);
    saveItineraryPlanningMock.mockResolvedValue(undefined);
    saveItineraryMock.mockResolvedValue(undefined);
    saveItineraryEditingMock.mockResolvedValue(undefined);
    setItineraryCurrentDayMock.mockResolvedValue(undefined);
    selectHotelMock.mockResolvedValue(null);
    markHandoffConsentPendingMock.mockResolvedValue(undefined);
    markSourcingConsentPendingMock.mockResolvedValue(undefined);
    markSourcingRequestSavedMock.mockResolvedValue(undefined);
    clearSourcingConsentPendingMock.mockResolvedValue(undefined);
    clearHandoffConsentPendingMock.mockResolvedValue(undefined);
    requestHotelHandoffMock.mockResolvedValue({ status: 'handed_off', reply: 'Your request is in the human concierge queue.' });
    issueRecheckReceiptMock.mockResolvedValue({ receiptId: '00000000-0000-4000-8000-000000000001', provider: 'liteapi', issuedAt: '2026-09-13T00:00:00Z', expiresAt: '2026-09-13T00:10:00Z' });
    saveRecheckReceiptMock.mockResolvedValue(undefined);
    selectRestaurantMock.mockResolvedValue(null);
    selectExperienceMock.mockResolvedValue(null);
    selectTransportOptionMock.mockResolvedValue(null);
    saveProviderPendingMock.mockResolvedValue(undefined);
    saveLogisticsProviderPendingMock.mockResolvedValue(undefined);
    clearHotelSearchSessionMock.mockResolvedValue(undefined);
    pauseHotelOutboundMock.mockResolvedValue(undefined);
    pauseHotelSearchSessionMock.mockResolvedValue(undefined);
    resumeHotelSearchSessionMock.mockResolvedValue(undefined);
    clearRestaurantSearchSessionMock.mockResolvedValue(undefined);
    pauseRestaurantSearchSessionMock.mockResolvedValue(undefined);
    resumeRestaurantSearchSessionMock.mockResolvedValue(undefined);
    clearExcursionSearchSessionMock.mockResolvedValue(undefined);
    pauseExcursionSearchSessionMock.mockResolvedValue(undefined);
    resumeExcursionSearchSessionMock.mockResolvedValue(undefined);
    clearLogisticsSearchSessionMock.mockResolvedValue(undefined);
    pauseLogisticsSearchSessionMock.mockResolvedValue(undefined);
    resumeLogisticsSearchSessionMock.mockResolvedValue(undefined);
    clearItinerarySessionMock.mockResolvedValue(undefined);
    pauseItinerarySessionMock.mockResolvedValue(undefined);
    resumeItinerarySessionMock.mockResolvedValue(undefined);
    clearItineraryWorkspaceMock.mockResolvedValue(undefined);
    planItineraryMock.mockResolvedValue(buildGeneratedItinerary());
    sendWhatsAppTextMock.mockResolvedValue(true);
    sendWhatsAppReplyMock.mockResolvedValue(true);
    sendWhatsAppMessagesMock.mockResolvedValue(true);
    twilioOutboundConfiguredMock.mockReturnValue(true);
    buildBrowseResultsPageReplyMock.mockReturnValue('Next page reply');
    handleBookingCheckMock.mockResolvedValue({
      status: 'browse_results',
      authoritativeProvider: 'liteapi',
      reply: 'I rechecked Hotel 1 at USD 100.00 total. No reservation has been made.',
    });
    buildRestaurantBrowseResultsPageReplyMock.mockReturnValue('Next restaurant page reply');
    buildExcursionBrowseResultsPageReplyMock.mockReturnValue('Next excursion page reply');
    buildLogisticsOptionsPageReplyMock.mockReturnValue('Next transport page reply');
    transcribeMock.mockResolvedValue({
      transcript: 'hello',
      contentType: 'audio/ogg',
      bytes: 1234,
      model: 'transcription-test-model',
    });
    llmDecideMock.mockResolvedValue({
      intent: 'unknown',
      parameters: {},
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.3,
    });
    generateUIContentMock.mockImplementation(async (prompt: string | Record<string, unknown>) => {
      if (typeof prompt === 'object') return String(prompt.fallbackText ?? 'I can help with your travel plans.');
      const fallback = prompt.match(/Deterministic fallback style reference: ([\s\S]*)$/);
      return fallback?.[1]?.trim() || 'I can help with your trip. What would you like to organize first?';
    });
  });

  it('handles out-of-scope roadside or health concerns before travel forms and booking routes', async () => {
    outOfScopeHandleMessageMock.mockResolvedValue(
      'YANA does not provide roadside repair. Are you safe?'
    );

    const reply = await processInboundMessage(buildTextMessage('I have a flat tyre'), 'corr-out-of-scope');

    expect(reply).toContain('Are you safe?');
    expect(outOfScopeHandleMessageMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'I have a flat tyre'
    );
    expect(llmDecideMock).not.toHaveBeenCalled();
    expect(saveExcursionFormSentMock).not.toHaveBeenCalled();
    expect(saveTransportFormSentMock).not.toHaveBeenCalled();
  });

  it('keeps a complete exploratory hotel request in chat', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    const criteria = {
      location: 'Galle',
      checkinDate: '2026-06-12',
      checkoutDate: '2026-06-15',
      guests: 2,
      boardBasis: 'bnb' as const,
      budgetPerNight: {
        amount: 120,
        currency: 'USD',
      },
    };
    handleMessageMock.mockResolvedValue({
      handled: true,
      completed: true,
      criteria,
      reply: 'Intake complete',
    });
    const reply = await processInboundMessage(
      buildTextMessage('I want a hotel in Galle June 12 to June 15 for 2 guests under USD 120 per night'),
      'corr-webhook-1'
    );

    expect(reply).toContain('stays around Galle');
    expect(reply).not.toContain('/forms/hotel/');
    expect(handleMessageMock).toHaveBeenCalled();
    expect(handleCompletedIntakeMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('uses the destination stated after reset when hotel exploration starts', async () => {
    recentTurnsMock.mockResolvedValue([
      { role: 'user', content: 'reset' },
      { role: 'user', content: 'I am coming to Colombo with my wife for our anniversary' },
      { role: 'assistant', content: 'I can help plan your trip.' },
    ]);
    llmDecideMock.mockResolvedValue({ intent: 'search_hotels', parameters: {},
      missingFields: ['location'], suggestedAction: 'ask_missing', confidence: 0.95 });

    const reply = await processInboundMessage(
      buildTextMessage('I am looking for a place to stay too'), 'corr-hotel-reuse-trip-area');

    expect(reply).toContain('Colombo');
    expect(reply).not.toContain('Which town or area');
    expect(saveAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999', expect.objectContaining({ location: 'Colombo' }), expect.any(Object));
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('uses a grounded natural model reply after saving hotel preferences', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', lifecycleStatus: 'active',
      state: 'awaiting_extra_preferences', stage: 'awaiting_preferences',
      criteria: { location: 'Negambo' }, results: [], nextOffset: 0,
      updatedAt: '2026-11-09T10:02:00.000Z',
    });
    const naturalReply = 'A colonial stay with a pool sounds lovely. Shall I show you a few options?';
    llmDecideMock.mockResolvedValue({ intent: 'search_hotels', parameters: {},
      missingFields: [], suggestedAction: 'ask_missing', confidence: 0.95,
      responseText: naturalReply });

    const reply = await processInboundMessage(
      buildTextMessage('colonial, must have a pool too'), 'corr-hotel-natural-preference');

    expect(reply).toBe(naturalReply);
    expect(saveAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location: 'Negambo', additionalPreferences: expect.stringContaining('pool') }),
      expect.any(Object));
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('updates the hotel area and preferences, then routes yes to hotel results despite old dining state', async () => {
    let hotel: any = {
      userId: 'whatsapp:+15550009999', lifecycleStatus: 'active',
      state: 'awaiting_extra_preferences', stage: 'awaiting_preferences',
      criteria: { location: 'Colombo' }, results: [], nextOffset: 0,
      updatedAt: '2026-11-09T10:01:00.000Z',
    };
    getHotelSearchSessionMock.mockImplementation(async () => hotel);
    saveAwaitingPreferencesMock.mockImplementation(async (_userId: string, criteria: Record<string, unknown>) => {
      hotel = { ...hotel, criteria, updatedAt: '2026-11-09T10:02:00.000Z' };
      return { status: 'durable' };
    });
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', lifecycleStatus: 'active',
      state: 'confirming_location', stage: 'awaiting_preferences',
      pendingLocationConfirmation: 'Negambo', criteria: {
        location: 'Negambo', cuisine: 'Chinese', diningStyle: 'Luxury', guests: 1,
      }, updatedAt: '2026-11-09T09:00:00.000Z',
    });
    llmDecideMock.mockResolvedValue({ intent: 'search_hotels', parameters: {},
      missingFields: ['checkin_date', 'checkout_date', 'guests'],
      suggestedAction: 'ask_missing', confidence: 0.95,
      responseText: 'Could you share your check-in and check-out dates and guest count?' });
    twilioOutboundConfiguredMock.mockReturnValue(false);
    handleBrowseSearchMock.mockResolvedValue({ status: 'browse_results',
      criteria: { location: 'Negambo' }, reply: 'Here are stays near Negambo beach.',
      browseResponse: { results: [] } });

    const areaReply = await processInboundMessage(
      buildTextMessage('Negambo, close to the beach'), 'corr-hotel-area-change');
    const preferenceReply = await processInboundMessage(
      buildTextMessage('colonial, must have a pool too'), 'corr-hotel-style-pool');
    const resultReply = await processInboundMessage(buildTextMessage('yes'), 'corr-hotel-options-yes');

    expect(areaReply).toContain('Negambo');
    expect(areaReply).not.toMatch(/check.in|check.out|guests/i);
    expect(preferenceReply).toContain('preference');
    expect(resultReply).toContain('stays near Negambo beach');
    expect(resultReply).not.toContain('dining preferences');
    expect(saveSearchingMock).toHaveBeenCalledWith('whatsapp:+15550009999',
      expect.objectContaining({ location: 'Negambo', additionalPreferences: expect.stringContaining('pool') }));
    expect(saveRestaurantLocationConfirmationMock).not.toHaveBeenCalled();
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
  });

  it('keeps completed chat intake in conversation without a form', async () => {
    handleMessageMock.mockResolvedValue({
      handled: true,
      completed: true,
      criteria: { location: 'Colombo', checkinDate: '2026-06-12', checkoutDate: '2026-06-15', guests: 2 },
      reply: 'Intake complete',
    });

    const reply = await processInboundMessage(buildTextMessage('tomorrow'), 'corr-hotel-short-answer');

    expect(reply).toContain('stays around Colombo');
    expect(reply).not.toContain('/forms/hotel/');
    expect(handleMessageMock).toHaveBeenCalledWith(
      'tomorrow',
      expect.objectContaining({ whatsappNumber: 'whatsapp:+15550009999' })
    );
    expect(handleCompletedIntakeMock).not.toHaveBeenCalled();
    expect(llmDecideMock).toHaveBeenCalledTimes(1);
  });

  it.each(['ask_missing', 'execute_tool'] as const)(
    'keeps hotel discovery in chat when the LLM suggests %s',
    async (suggestedAction) => {
      llmDecideMock.mockResolvedValue({
        intent: 'search_hotels',
        parameters: { location: 'Galle' },
        missingFields: ['checkin_date', 'checkout_date'],
        suggestedAction,
        confidence: 0.92,
      });

      const reply = await processInboundMessage(
        buildTextMessage('Find somewhere comfortable to sleep in Galle'),
        `corr-hotel-llm-${suggestedAction}`
      );

      expect(reply).toContain('stays around Galle');
      expect(reply).not.toContain('/forms/hotel/');
      expect(handleCompletedIntakeMock).not.toHaveBeenCalled();
      expect(saveHotelFormSentMock).not.toHaveBeenCalled();
    }
  );

  it('returns a profile link before invoking hotel orchestration for a new user', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    profileGateCheckMock.mockResolvedValue({ complete: false });

    const reply = await processInboundMessage(buildTextMessage('Find a hotel'), 'corr-webhook-2');

    expect(reply).toContain('please complete this quick profile');
    expect(reply).toContain('https://forms.yana.example/forms/profile/');
    expect(saveProfileGateRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'whatsapp:+15550009999',
        content: expect.objectContaining({
          body: 'Find a hotel',
        }),
      })
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
    expect(handleCompletedIntakeMock).not.toHaveBeenCalled();
  });

  it('greets a first text sender using their WhatsApp contact name without asking again', async () => {
    profileGateCheckMock.mockResolvedValue({ complete: false });
    getProfileMock.mockResolvedValue(null);

    const result = await processWebhookPayload({
      MessageSid: 'SMfirst-text',
      From: 'whatsapp:+15550009999',
      To: 'whatsapp:+15550000000',
      Body: 'Find a hotel',
      ProfileName: 'Jeremy McShane',
    }, 'corr-first-text');

    expect(result.reply).toMatch(/^Hi Jeremy McShane, welcome to YANA/);
    expect(result.reply).toContain('please complete this quick profile');
    expect(result.reply).not.toContain('Would you like me to call you');
    expect(rememberExistingNameMock).toHaveBeenCalledWith('whatsapp:+15550009999', 'Jeremy McShane');
  });

  it('looks up the WhatsApp name for a first OpenWA text without a name in its webhook', async () => {
    profileGateCheckMock.mockResolvedValue({ complete: false });
    getProfileMock.mockResolvedValue(null);
    getWhatsAppDisplayNameMock.mockResolvedValue('Amina Khan');

    const inboundMessage: InboundMessage = {
      ...buildTextMessage('Find a hotel'),
      metadata: { provider: 'openwa' },
    };
    const result = await processNormalizedInboundMessage(inboundMessage, 'corr-openwa-first-text');

    expect(getWhatsAppDisplayNameMock).toHaveBeenCalledWith(inboundMessage.from);
    expect(result.reply).toMatch(/^Hi Amina Khan, welcome to YANA/);
    expect(result.reply).not.toContain('Would you like me to call you');
  });

  it('uses the first name saved by the profile instead of the WhatsApp contact name', async () => {
    getProfileMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      form: { preferredName: 'Jay', fullName: 'Jay Fernando' },
    });

    const result = await processWebhookPayload({
      MessageSid: 'SMname-reply',
      From: 'whatsapp:+15550009999',
      To: 'whatsapp:+15550000000',
      Body: 'Hello',
      ProfileName: 'Jeremy McShane',
    }, 'corr-name-reply');

    expect(rememberExistingNameMock).toHaveBeenCalledWith('whatsapp:+15550009999', 'Jay');
    expect(result.reply).not.toContain('Jeremy McShane');
  });

  it('resends the hotel form link when the user lost it during an open hotel form', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      state: 'hotel_form_sent',
      stage: 'awaiting_preferences',
      criteria: {},
      results: [],
      nextOffset: 0,
    });

    const reply = await processInboundMessage(
      buildTextMessage("i dont have it re send it please"),
      'corr-webhook-resend-hotel-form'
    );

    expect(reply).toContain('fresh hotel form link');
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(saveHotelFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'i dont have it re send it please',
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(llmDecideMock).toHaveBeenCalledTimes(1);
  });

  it('does not resend an old hotel form for a new discovery request', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      state: 'hotel_form_sent',
      stage: 'awaiting_preferences',
      criteria: {},
      results: [],
      nextOffset: 0,
    });

    const reply = await processInboundMessage(
      buildTextMessage('i want to find a hotel in kandy'),
      'corr-webhook-repeat-hotel-form'
    );

    expect(reply).not.toContain('/forms/hotel/');
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('does not open a booking form for a natural hotel search', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(
      buildTextMessage('i want to find a hotel in colombo tomorrow'),
      'corr-hotel-missing-details-form'
    );

    expect(reply).not.toContain('/forms/hotel/');
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
    expect(llmDecideMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Find me a return flight from London to Colombo.',
    'Can you compare airfare to Sri Lanka?',
    'I want to book airline tickets.',
  ])('honestly declines unsupported flight search and booking: %s', async (message) => {
    const reply = await processInboundMessage(buildTextMessage(message), 'corr-flight-unsupported');

    expect(reply).toContain('Flight search and booking are not available through Yana yet.');
    expect(reply).toContain('airline or a trusted flight-booking platform');
    expect(reply).not.toMatch(/confirmed|live availability|handoff/i);
    expect(handleMessageMock).not.toHaveBeenCalled();
    expect(llmDecideMock).not.toHaveBeenCalled();
  });

  it('declines flight search without collecting a profile for an unavailable service', async () => {
    profileGateCheckMock.mockResolvedValue({ complete: false });

    const reply = await processInboundMessage(
      buildTextMessage('Find me a flight to Colombo'),
      'corr-flight-no-profile'
    );

    expect(reply).toContain('Flight search and booking are not available through Yana yet.');
    expect(profileGateCheckMock).not.toHaveBeenCalled();
    expect(saveProfileGateRequestMock).not.toHaveBeenCalled();
  });

  it('declines a flight request before an active hotel session can consume it', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Galle Fort' },
      results: [{ name: 'Hotel 1' }],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(
      buildTextMessage('Instead, find me a flight to Colombo'),
      'corr-flight-active-session'
    );

    expect(reply).toContain('Flight search and booking are not available through Yana yet.');
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
    expect(llmDecideMock).not.toHaveBeenCalled();
  });

  it.each([
    'I need an airport pickup for my flight UL101',
    'Book an airport transfer for flight UL101',
  ])('keeps flight details in an airport-transfer request on the logistics path: %s', async (message) => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(buildTextMessage(message), 'corr-flight-number-transfer');

    expect(reply).toContain('quick transport request form');
    expect(reply).toContain('https://forms.yana.example/forms/logistics/');
    expect(saveTransportFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      message,
      expect.objectContaining({ preferredName: 'Sam' })
    );
  });

  it.each([
    'I am hungry',
    'I need somewhere for dinner.',
    'Find me a seafood restaurant.',
    'I want a romantic place.',
    'Find vegetarian food.',
    'i want to find a restuarent near me',
  ])('asks for the area before showing restaurant discovery suggestions: %s', async (message) => {
    handleMessageMock.mockResolvedValue({ handled: false });
    const reply = await processInboundMessage(buildTextMessage(message), 'corr-restaurant-intent');

    expect(reply).toContain('Which town or area should I search?');
    expect(saveRestaurantFormSentMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      {},
      { originalMessage: message }
    );
  });

  it.each([
    ['resturants', 'collombo', 'Colombo'],
    ['I am hungry', 'Moratuwa', 'Moratuwa'],
  ])('opens restaurant preference intake for %s followed by %s', async (originalMessage, locationReply, expectedLocation) => {
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      originalMessage,
      criteria: {},
      normalizedCriteria: {},
      stage: 'awaiting_preferences',
      state: 'awaiting_preferences',
      results: [],
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      nextOffset: 0,
      updatedAt: '2026-10-14T17:50:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage(locationReply), 'corr-restaurant-location');

    expect(reply).toContain('/forms/restaurant/');
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location: expectedLocation, originalRequest: originalMessage }),
      expect.objectContaining({ originalMessage })
    );
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
    expect(llmDecideMock).toHaveBeenCalledTimes(1);
  });

  it('uses the active restaurant schema even when a restored legacy session has no original message', async () => {
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      criteria: {},
      normalizedCriteria: {},
      stage: 'awaiting_preferences',
      state: 'awaiting_preferences',
      results: [],
      resultBatches: [],
      latestDisplayedBatchIndex: -1,
      nextOffset: 0,
      updatedAt: '2026-10-14T17:50:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('Moratuwa'), 'corr-restaurant-legacy-location');

    expect(reply).toContain('/forms/restaurant/');
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location: 'Moratuwa' }),
      expect.any(Object)
    );
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
    expect(llmDecideMock).toHaveBeenCalledTimes(1);
  });

  it('recognizes a misspelled one-day itinerary request before the LLM can invent an untracked follow-up', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(
      buildTextMessage('give an intenry for a day in colombo'),
      'corr-itinerary-typo'
    );

    expect(reply).toContain('quick itinerary form');
    expect(saveItineraryFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'give an intenry for a day in colombo',
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(llmDecideMock).toHaveBeenCalledTimes(1);
  });

  it('collects dining preferences after the tourist gives an area', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'search_restaurants',
      parameters: { city: 'Galle', cuisine: 'seafood' },
      missingFields: ['diningDate', 'diningTime', 'guests'],
      suggestedAction: 'ask_missing',
      confidence: 0.93,
    });
    handleRestaurantBrowseSearchMock.mockResolvedValue({
      status: 'browse_results',
      criteria: { location: 'Galle' },
      reply: 'I found these restaurant matches for Galle.',
      browseResponse: {
        provider: 'google_places',
        results: [{ name: 'Galle Seafood House' }],
      },
    });

    const reply = await processInboundMessage(
      buildTextMessage('Can you recommend seafood restaurants in Galle?'),
      'corr-restaurant-explore'
    );

    expect(reply).toContain('/forms/restaurant/');
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location: 'Galle', cuisine: 'seafood' }),
      expect.any(Object)
    );
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
    expect(saveRestaurantFormSentMock).not.toHaveBeenCalled();
    expect(handleRestaurantBrowseSearchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Find a restaurant in Kandy', 'Kandy'],
    ['Recommend somewhere to eat in Galle', 'Galle'],
    ['Where can we have lunch around Negombo?', 'Negombo'],
    ['I need a place for dinner near Colombo', 'Colombo'],
    ['Find Chinese food in Moratuwa', 'Moratuwa'],
  ])('routes every restaurant discovery intent through preference intake: %s', async (message, location) => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(
      buildTextMessage(message),
      'corr-restaurant-preference-intake'
    );

    expect(reply).toContain('/forms/restaurant/');
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location, originalRequest: message }),
      expect.objectContaining({ originalMessage: message })
    );
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
    expect(handleRestaurantBrowseSearchMock).not.toHaveBeenCalled();
  });

  it('pauses an itinerary while a fresh restaurant exploration becomes active', async () => {
    getItinerarySessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      criteria: {
        arrivalDate: '2026-07-12',
        departureDate: '2026-07-19',
        adults: 2,
        budget: 'Comfort',
        preferredTransport: 'Mixed',
        interests: ['Culture'],
      },
      itinerary: buildGeneratedItinerary(),
      state: 'showing_itinerary',
      currentDay: 1,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      expiresAt: '2026-06-08T10:00:00.000Z',
    });
    clearItinerarySessionMock.mockImplementation(async () => {
      getItinerarySessionMock.mockResolvedValue(null);
    });

    const reply = await processInboundMessage(
      buildTextMessage('I am looking for a restaurant, not a hotel'),
      'corr-restaurant-overrides-itinerary'
    );

    expect(reply).toContain('Which town or area should I search?');
    expect(clearItinerarySessionMock).not.toHaveBeenCalled();
    expect(saveRestaurantFormSentMock).not.toHaveBeenCalled();
    expect(saveItineraryEditingMock).not.toHaveBeenCalled();
  });

  it('switches from hotel results to restaurant discovery while preserving the hotel task', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Colombo' },
      results: [{ name: 'Old Colombo Hotel' }],
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    clearHotelSearchSessionMock.mockImplementation(async () => {
      getHotelSearchSessionMock.mockResolvedValue(null);
    });
    llmDecideMock.mockResolvedValue({
      intent: 'search_restaurants',
      parameters: { location: 'Galle' },
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.9,
    });

    const reply = await processInboundMessage(
      buildTextMessage('Find a seafood restaurant in Galle'),
      'corr-hotel-to-restaurant'
    );

    expect(reply).toContain('/forms/restaurant/');
    expect(clearHotelSearchSessionMock).not.toHaveBeenCalled();
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location: 'Galle' }),
      expect.any(Object)
    );
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
  });

  it('keeps a confirmed hotel area through the dining handoff instead of restoring an older city', async () => {
    const hotel = {
      userId: 'whatsapp:+15550009999', id: 'hotel-hikkaduwa', stage: 'booking_provider_pending',
      state: 'booking_provider_pending', lifecycleStatus: 'active',
      pendingSourcingConsent: true, criteria: { location: 'Hikkaduwa' },
      updatedAt: '2026-10-29T08:00:00.000Z',
    };
    let restaurant: any = null;
    getHotelSearchSessionMock.mockImplementation(async () => hotel);
    pauseHotelSearchSessionMock.mockImplementation(async () => { hotel.lifecycleStatus = 'paused'; });
    getRestaurantSearchSessionMock.mockImplementation(async () => restaurant);
    saveRestaurantLocationConfirmationMock.mockImplementation(async (_userId: string, location: string, originalMessage: string) => {
      restaurant = { id: 'restaurant-hikkaduwa', userId: 'whatsapp:+15550009999',
        state: 'confirming_location', stage: 'awaiting_preferences', lifecycleStatus: 'active',
        pendingLocationConfirmation: location, originalMessage, criteria: {},
        updatedAt: '2026-10-29T08:01:00.000Z' };
    });
    saveRestaurantAwaitingPreferencesMock.mockImplementation(async (_userId: string, criteria: Record<string, unknown>) => {
      restaurant = { ...restaurant, state: 'awaiting_preferences', stage: 'awaiting_preferences',
        pendingLocationConfirmation: undefined, criteria,
        updatedAt: '2026-10-29T08:02:00.000Z' };
    });
    llmDecideMock.mockResolvedValue({ intent: 'search_restaurants', parameters: {}, missingFields: ['location'],
      suggestedAction: 'ask_missing', taskTransition: 'switch', confidence: 0.95 });

    const first = await processInboundMessage(buildTextMessage('What can I do for dinner there?'), 'corr-dining-there');
    expect(first).toContain('Hikkaduwa');
    expect(saveRestaurantLocationConfirmationMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999', 'Hikkaduwa', expect.any(String)
    );

    const confirmed = await processInboundMessage(buildTextMessage('Yes Hikkaduwa'), 'corr-dining-confirm');
    expect(confirmed).toContain('/forms/restaurant/');
    expect(restaurant.criteria.location).toBe('Hikkaduwa');
    expect(restaurant.pendingLocationConfirmation).toBeUndefined();

    const followup = await processInboundMessage(buildTextMessage('Yes'), 'corr-dining-followup');
    expect(followup).toContain('Hikkaduwa');
    expect(followup).not.toContain('Colombo');
    expect(followup).not.toContain('sourcing request for this stay');

    await saveRestaurantLocationConfirmationMock('whatsapp:+15550009999', 'Hikkaduwa', 'Dinner there');
    const changed = await processInboundMessage(buildTextMessage('Colombo instead'), 'corr-dining-change');
    expect(changed).toContain('/forms/restaurant/');
    expect(restaurant.criteria.location).toBe('Colombo');

    await saveRestaurantLocationConfirmationMock('whatsapp:+15550009999', 'Hikkaduwa', 'Dinner there');
    await processInboundMessage(buildTextMessage('Yes'), 'corr-dining-simple-yes');
    expect(restaurant.criteria.location).toBe('Hikkaduwa');
  });

  it('switches from hotel results to excursion discovery while preserving the hotel task', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Colombo' },
      results: [{ name: 'Old Colombo Hotel' }],
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    clearHotelSearchSessionMock.mockImplementation(async () => {
      getHotelSearchSessionMock.mockResolvedValue(null);
    });
    llmDecideMock.mockResolvedValue({
      intent: 'search_excursions',
      responseText: 'Absolutely — let’s switch from stays to experiences in Hikkaduwa.',
      parameters: { destination: 'Hikkaduwa' },
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.9,
    });

    const reply = await processInboundMessage(
      buildTextMessage('What activity can I do in Hikkaduwa?'),
      'corr-hotel-to-excursion'
    );

    expect(reply).toContain('switch from stays to experiences');
    expect(reply).toContain('suggestions shortly');
    expect(clearHotelSearchSessionMock).not.toHaveBeenCalled();
    expect(saveExcursionSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ destination: 'Hikkaduwa' })
    );
  });

  it('pauses an itinerary when a fresh hotel request opens the hotel form', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getItinerarySessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      criteria: {
        arrivalDate: '2026-07-12',
        departureDate: '2026-07-19',
        adults: 2,
        budget: 'Comfort',
        preferredTransport: 'Mixed',
        interests: ['Culture'],
      },
      itinerary: buildGeneratedItinerary(),
      state: 'showing_itinerary',
      currentDay: 1,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      expiresAt: '2026-06-08T10:00:00.000Z',
    });
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(
      buildTextMessage('can you help me find a hotel in kandy'),
      'corr-hotel-overrides-itinerary'
    );

    expect(reply.toLowerCase()).toContain('stays around kandy');
    expect(reply).not.toContain('/forms/hotel/');
    expect(clearItinerarySessionMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
    expect(handleMessageMock).not.toHaveBeenCalled();
    expect(saveItineraryEditingMock).not.toHaveBeenCalled();
  });

  it('switches a bare hotels question while preserving the unfinished itinerary', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'awaiting_preferences',
      criteria: { arrivalDate: '2026-07-12', departureDate: '2026-07-19', adults: 2 },
    }));

    const reply = await processInboundMessage(
      buildTextMessage('What about hotels around Kandy?'),
      'corr-hotels-overrides-itinerary'
    );

    expect(reply).toContain('stays around Kandy');
    expect(reply).not.toContain('/forms/hotel/');
    expect(clearItinerarySessionMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
    expect(planItineraryMock).not.toHaveBeenCalled();
  });

  it('does not revive a saved itinerary form after reset when asked for a hotel', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'awaiting_preferences',
    }));
    clearItinerarySessionMock.mockImplementation(async () => {
      getItinerarySessionMock.mockResolvedValue(null);
    });
    getLatestServiceRequestMock.mockImplementation(async (_userId: string, type: string) =>
      type === 'itinerary'
        ? {
            id: 'old-itinerary-request',
            userId: 'whatsapp:+15550009999',
            type: 'itinerary',
            form: {
              arrivalAirport: 'Colombo',
              arrivalDate: '2026-07-12',
              departureAirport: 'Colombo',
              departureDate: '2026-07-19',
              adults: 2,
              budget: 'Comfort',
            },
          }
        : null
    );

    await processInboundMessage(buildTextMessage('reset'), 'corr-reset-before-hotel');
    const reply = await processInboundMessage(buildTextMessage('hotel'), 'corr-hotel-after-reset');

    expect(clearItineraryWorkspaceMock).not.toHaveBeenCalled();
    expect(reply).not.toContain('/forms/hotel/');
    expect(planItineraryMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('keeps a day-specific hotel change inside the active itinerary', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'showing_itinerary',
      itinerary: buildGeneratedItinerary(),
    }));

    const reply = await processInboundMessage(
      buildTextMessage('change hotel on day 2'),
      'corr-itinerary-hotel-edit'
    );

    expect(reply).toContain('Which day and part');
    expect(saveItineraryEditingMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('restores the latest submitted restaurant form and asks for extra preferences', async () => {
    getLatestServiceRequestMock.mockImplementation(async (_userId: string, type: string) =>
      type === 'restaurant'
        ? {
            id: 'restaurant-request-1',
            userId: 'whatsapp:+15550009999',
            type: 'restaurant',
            form: {
              location: 'Galle',
              diningDate: '2026-06-12',
              diningTime: '19:30',
              guests: 2,
              cuisine: 'Seafood',
              diningStyle: 'Beachfront',
              priceRange: '$$',
              dietaryRequirements: 'None',
              indoorOutdoor: 'Outdoor',
              specialOccasion: 'Date Night',
            },
            createdAt: new Date('2026-06-01T10:00:00.000Z'),
          }
        : null
    );

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-restaurant-form');

    expect(reply).toContain("I've gathered the following dining preferences");
    expect(reply).toContain('Location: Galle');
    expect(reply).toContain('Cuisine: Seafood');
    expect(reply).toContain('Budget: $$');
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        location: 'Galle',
        cuisine: 'Seafood',
        priceRange: '$$',
      })
    );
  });

  it('acknowledges restaurant preferences immediately and searches in the background', async () => {
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      state: 'awaiting_preferences',
      criteria: {
        location: 'Galle',
        diningDate: '2026-06-12',
        diningTime: '19:30',
        guests: 2,
        cuisine: 'Seafood',
        priceRange: '$$',
      },
      normalizedCriteria: {},
      resultBatches: [],
      results: [],
      latestDisplayedBatchIndex: -1,
      nextOffset: 0,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      expiresAt: '2026-06-02T10:00:00.000Z',
    });
    handleRestaurantBrowseSearchMock.mockResolvedValue({
      status: 'browse_results',
      criteria: {},
      reply: 'Top 3 restaurants',
      browseResponse: {
        provider: 'google_places',
        results: [{ name: 'Restaurant 1' }, { name: 'Restaurant 2' }, { name: 'Restaurant 3' }, { name: 'Restaurant 4' }],
      },
    });

    const reply = await processInboundMessage(
      buildTextMessage('quiet ocean view table'),
      'corr-restaurant-search'
    );

    expect(reply).toContain('searching the best restaurant matches');
    expect(saveRestaurantSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        location: 'Galle',
        additionalPreferences: 'quiet ocean view table',
      })
    );

    await vi.waitFor(() => {
      expect(handleRestaurantBrowseSearchMock).toHaveBeenCalled();
      expect(sendWhatsAppMessagesMock).toHaveBeenCalled();
    });
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('I found these restaurant matches') }),
        expect.objectContaining({ body: expect.stringContaining('Why Yana picked it:') }),
      ]),
      { voice: undefined, from: 'whatsapp:+15550000000' }
    );
    await vi.waitFor(() => {
      expect(saveRestaurantResultsMock).toHaveBeenCalledWith(
        'whatsapp:+15550009999',
        expect.objectContaining({ additionalPreferences: 'quiet ocean view table' }),
        expect.arrayContaining([expect.objectContaining({ name: 'Restaurant 1' })]),
        3
      );
    });
  });

  it('routes no to the newer restaurant form even if an old itinerary session remains', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      criteria: {
        arrivalDate: '2026-07-12', departureDate: '2026-07-19', adults: 2,
        budget: 'Comfort', preferredTransport: 'Mixed',
      },
      updatedAt: '2026-06-01T10:00:00.000Z',
    }));
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      state: 'awaiting_preferences',
      criteria: {
        location: 'Moratuwa', diningDate: '2026-10-17', diningTime: '20:11',
        cuisine: 'Seafood', guests: 2, priceRange: '$$',
      },
      updatedAt: '2026-06-02T10:00:00.000Z',
    });
    handleRestaurantBrowseSearchMock.mockResolvedValue({
      status: 'browse_results', criteria: {}, reply: 'Restaurant matches',
      browseResponse: { provider: 'google_places', results: [] },
    });

    const reply = await processInboundMessage(buildTextMessage('no'), 'corr-restaurant-no-with-old-itinerary');

    expect(reply).toContain('searching the best restaurant matches');
    expect(saveRestaurantSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ location: 'Moratuwa', additionalPreferences: undefined })
    );
    expect(planItineraryMock).not.toHaveBeenCalled();
    expect(saveItineraryPlanningMock).not.toHaveBeenCalled();
  });

  it('recovers the newest restaurant form on no when the active session is missing', async () => {
    getLatestServiceRequestOverallMock.mockResolvedValue({
      id: 'new-restaurant-request', userId: 'whatsapp:+15550009999', type: 'restaurant',
      form: { location: 'Moratuwa', diningDate: '2026-10-17', diningTime: '20:11', guests: 2, cuisine: 'Seafood', priceRange: '$$' },
      createdAt: new Date('2026-10-17T14:00:00.000Z'),
    });
    saveRestaurantAwaitingPreferencesMock.mockImplementation(async (_userId: string, criteria: Record<string, unknown>) => {
      getRestaurantSearchSessionMock.mockResolvedValue({
        userId: 'whatsapp:+15550009999', stage: 'awaiting_preferences', state: 'awaiting_preferences',
        criteria, updatedAt: '2026-10-17T14:00:00.000Z',
      });
    });
    handleRestaurantBrowseSearchMock.mockResolvedValue({
      status: 'browse_results', criteria: {}, reply: 'Restaurant matches',
      browseResponse: { provider: 'google_places', results: [] },
    });

    const reply = await processInboundMessage(buildTextMessage('no'), 'corr-restaurant-no-recovered');

    expect(reply).toContain('searching the best restaurant matches');
    expect(saveRestaurantAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999', expect.objectContaining({ location: 'Moratuwa' }),
      expect.objectContaining({ restaurantFormResponseId: 'new-restaurant-request' })
    );
    expect(planItineraryMock).not.toHaveBeenCalled();
  });

  it('recovers the restaurant form even after a mistaken itinerary reply updated the old session', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      criteria: {
        arrivalDate: '2026-07-12', departureDate: '2026-07-19', adults: 2,
        budget: 'Comfort', preferredTransport: 'Mixed',
      },
      updatedAt: '2026-10-18T10:00:00.000Z',
    }));
    getLatestServiceRequestOverallMock.mockResolvedValue({
      id: 'new-restaurant-request', userId: 'whatsapp:+15550009999', type: 'restaurant',
      form: { location: 'Moratuwa', diningDate: '2026-10-17', diningTime: '20:11', guests: 2, cuisine: 'Seafood', priceRange: '$$' },
      createdAt: new Date('2026-10-17T14:00:00.000Z'),
    });
    saveRestaurantAwaitingPreferencesMock.mockImplementation(async (_userId: string, criteria: Record<string, unknown>) => {
      getRestaurantSearchSessionMock.mockResolvedValue({
        userId: 'whatsapp:+15550009999', stage: 'awaiting_preferences', state: 'awaiting_preferences',
        criteria, updatedAt: '2026-10-17T14:00:00.000Z',
      });
    });
    handleRestaurantBrowseSearchMock.mockResolvedValue({
      status: 'browse_results', criteria: {}, reply: 'Restaurant matches',
      browseResponse: { provider: 'google_places', results: [] },
    });

    const reply = await processInboundMessage(buildTextMessage('no'), 'corr-restaurant-no-stale-itinerary');

    expect(reply).toContain('searching the best restaurant matches');
    expect(planItineraryMock).not.toHaveBeenCalled();
    expect(saveRestaurantSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999', expect.objectContaining({ location: 'Moratuwa' })
    );
  });

  it('keeps no with the itinerary when the newest submitted form is an itinerary', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      criteria: {
        arrivalDate: '2026-10-20', arrivalTime: '10:00',
        departureDate: '2026-10-27', departureTime: '20:00', adults: 2,
        budget: 'Comfort', travelStyle: 'Mixed', preferredTransport: 'Mixed',
      },
      updatedAt: '2026-10-18T10:00:00.000Z',
    }));
    getLatestServiceRequestOverallMock.mockResolvedValue({
      id: 'new-itinerary-request', userId: 'whatsapp:+15550009999', type: 'itinerary',
      form: { arrivalDate: '2026-10-20', departureDate: '2026-10-27', adults: 2, budget: 'Comfort' },
      createdAt: new Date('2026-10-18T09:00:00.000Z'),
    });

    const reply = await processInboundMessage(buildTextMessage('no'), 'corr-itinerary-newer-than-restaurant');

    expect(reply).toContain('prepared your itinerary');
    expect(planItineraryMock).toHaveBeenCalled();
    expect(saveRestaurantSearchingMock).not.toHaveBeenCalled();
  });

  it('paginates saved restaurant suggestions', async () => {
    const results = [
      { name: 'Restaurant 1' },
      { name: 'Restaurant 2' },
      { name: 'Restaurant 3' },
      { name: 'Restaurant 4' },
      { name: 'Restaurant 5' },
      { name: 'Restaurant 6' },
    ];
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { location: 'Galle' },
      normalizedCriteria: {},
      resultBatches: [results.slice(0, 3), results.slice(3, 6)],
      results,
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      expiresAt: '2026-06-02T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('next'), 'corr-restaurant-next');

    expect(reply).toBe('🍽️ Here are the next restaurant options.');
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('🍽️ *1. Restaurant 4*') }),
        expect.objectContaining({ body: expect.stringContaining('✨ Why Yana picked it:') }),
      ]),
      expect.objectContaining({ from: 'whatsapp:+15550000000' })
    );
    expect(buildRestaurantBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('stores restaurant selection and opens reservation placeholder', async () => {
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { location: 'Galle' },
      normalizedCriteria: {},
      resultBatches: [[{ id: 'place-1', name: 'Sea View Grill' }]],
      results: [{ id: 'place-1', name: 'Sea View Grill' }],
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      expiresAt: '2026-06-02T10:00:00.000Z',
    });
    selectRestaurantMock.mockResolvedValue({
      selectedRestaurantId: 'place-1',
      selectedRestaurantSnapshot: { id: 'place-1', name: 'Sea View Grill' },
      selectedFromBatchIndex: 0,
      selectedDisplayNumber: 1,
      selectedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('book 1'), 'corr-restaurant-book');

    expect(reply).toContain('Selected: Sea View Grill');
    expect(reply).toContain('does not currently have a live restaurant reservation connection');
    expect(reply).toContain('cannot check table availability or reserve it');
  });

  it('clears restaurant state on reset', async () => {
    getRestaurantSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { location: 'Galle' },
      normalizedCriteria: {},
      resultBatches: [],
      results: [],
      latestDisplayedBatchIndex: -1,
      nextOffset: 0,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      expiresAt: '2026-06-02T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('reset'), 'corr-restaurant-reset');

    expect(reply).toContain('paused your saved requests');
    expect(clearRestaurantSearchSessionMock).not.toHaveBeenCalled();
    expect(pauseRestaurantSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
  });

  it('transcribes a restaurant voice note and starts restaurant flow', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    transcribeMock.mockResolvedValue({
      transcript: "I'm hungry",
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-restaurant-voice');

    expect(result.inboundMessage.inputType).toBe('voice');
    expect(result.reply).toContain('Which town or area should I search?');
    expect(saveRestaurantFormSentMock).not.toHaveBeenCalled();
  });

  it('adds a brief greeting to the first voice reply', async () => {
    shouldOpenVoiceConversationMock.mockResolvedValue(true);
    transcribeMock.mockResolvedValue({
      transcript: "I'm hungry",
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-first-voice');

    expect(result.reply).toMatch(/^I heard: "I'm hungry"\n\nHi there! Sure, let me help with that\./);
    expect(result.reply).toContain('Which town or area should I search?');
  });

  it.each([
    'I want to visit historic places.',
    "We're looking for adventure.",
    "I'd like to go surfing.",
    'I want a safari.',
    'What are the best things to do in Kandy?',
    'What can I do in Kandy?',
    'What should we see around Galle?',
    "What's happening around here?",
    'Is there anything to do nearby?',
    'I am looking for experiences in Colombo.',
    'Show me local sights in Negombo.',
  ])('asks for the area before showing excursion discovery suggestions: %s', async (message) => {
    handleMessageMock.mockResolvedValue({ handled: false });
    const reply = await processInboundMessage(buildTextMessage(message), 'corr-excursion-intent');

    if (/\b(?:in Kandy|around Galle|in Colombo|in Negombo)\b/i.test(message)) {
      expect(reply).toContain('suggestions shortly');
    } else {
      expect(reply).toContain('Which town or area are you interested in?');
    }
    expect(saveExcursionFormSentMock).not.toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('runs an exploration search instead of opening a booking form for open-ended destination ideas', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'search_excursions',
      parameters: { location: 'Colombo', date: 'tomorrow' },
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.95,
    });
    handleExcursionBrowseSearchMock.mockResolvedValue({
      status: 'browse_results',
      criteria: { destination: 'Colombo' },
      reply: 'I found these experience matches for Colombo.',
      browseResponse: {
        provider: 'google_places',
        results: [{ name: 'Galle Face Green' }, { name: 'National Museum' }],
      },
    });

    const reply = await processInboundMessage(
      buildTextMessage("I'm coming to Colombo tomorrow, what can I do?"),
      'corr-excursion-explore'
    );

    expect(reply).toContain('suggestions shortly');
    expect(reply).not.toContain('quick excursion request form');
    expect(saveExcursionSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ destination: 'Colombo' })
    );
    expect(saveExcursionFormSentMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(handleExcursionBrowseSearchMock).toHaveBeenCalled());
    expect(handleExcursionBrowseSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'Colombo' }),
      expect.objectContaining({ sessionId: 'whatsapp:+15550009999' })
    );
  });

  it('restores the latest submitted excursion form and asks for extra preferences', async () => {
    getLatestServiceRequestMock.mockImplementation(async (_userId: string, type: string) =>
      type === 'excursion'
        ? {
            id: 'excursion-request-1',
            userId: 'whatsapp:+15550009999',
            type: 'excursion',
            form: {
              destination: 'Ella',
              preferredDate: '2026-06-12',
              preferredTime: '08:30',
              guests: 2,
              category: 'Hiking',
              tourType: 'Private',
              budget: '$$',
              duration: 'Half Day',
              fitnessLevel: 'Moderate',
              transportRequired: 'Yes',
              pickupLocation: 'Hotel',
              specialRequirements: 'Photography',
            },
            createdAt: new Date('2026-06-01T10:00:00.000Z'),
          }
        : null
    );

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-excursion-form');

    expect(reply).toContain("I've gathered the following excursion preferences");
    expect(reply).toContain('Destination: Ella');
    expect(reply).toContain('Experience: Hiking');
    expect(reply).toContain('Budget: $$');
    expect(saveExcursionAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        destination: 'Ella',
        category: 'Hiking',
        budget: '$$',
      })
    );
  });

  it('acknowledges excursion preferences immediately and searches in the background', async () => {
    getExcursionSearchSessionMock.mockResolvedValue(buildExcursionSession({
      stage: 'awaiting_preferences',
      state: 'awaiting_preferences',
      criteria: {
        destination: 'Ella',
        preferredDate: '2026-06-12',
        preferredTime: '08:30',
        guests: 2,
        category: 'Hiking',
        budget: '$$',
      },
    }));
    handleExcursionBrowseSearchMock.mockResolvedValue({
      status: 'browse_results',
      criteria: {},
      reply: 'Top 3 experiences',
      browseResponse: {
        provider: 'google_places',
        results: [{ name: 'Experience 1' }, { name: 'Experience 2' }, { name: 'Experience 3' }, { name: 'Experience 4' }],
      },
    });

    const reply = await processInboundMessage(
      buildTextMessage('beginner friendly with sunset views'),
      'corr-excursion-search'
    );

    expect(reply).toContain('searching the best experience matches');
    expect(saveExcursionSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        destination: 'Ella',
        additionalPreferences: 'beginner friendly with sunset views',
      })
    );

    await vi.waitFor(() => {
      expect(handleExcursionBrowseSearchMock).toHaveBeenCalled();
      expect(sendWhatsAppMessagesMock).toHaveBeenCalled();
    });
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('I found these experience matches') }),
        expect.objectContaining({ body: expect.stringContaining('Why Yana picked it:') }),
      ]),
      { voice: undefined, from: 'whatsapp:+15550000000' }
    );
    await vi.waitFor(() => {
      expect(saveExcursionResultsMock).toHaveBeenCalledWith(
        'whatsapp:+15550009999',
        expect.objectContaining({ additionalPreferences: 'beginner friendly with sunset views' }),
        expect.arrayContaining([expect.objectContaining({ name: 'Experience 1' })]),
        3
      );
    });
  });

  it('paginates saved excursion suggestions', async () => {
    const results = [
      { name: 'Experience 1' },
      { name: 'Experience 2' },
      { name: 'Experience 3' },
      { name: 'Experience 4' },
      { name: 'Experience 5' },
      { name: 'Experience 6' },
    ];
    getExcursionSearchSessionMock.mockResolvedValue(buildExcursionSession({
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { destination: 'Ella' },
      resultBatches: [results.slice(0, 3), results.slice(3, 6)],
      results,
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
    }));

    const reply = await processInboundMessage(buildTextMessage('next'), 'corr-excursion-next');

    expect(reply).toBe('🧭 Here are the next experience options.');
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('🧭 *1. Experience 4*') }),
        expect.objectContaining({ body: expect.stringContaining('✨ Why Yana picked it:') }),
      ]),
      expect.objectContaining({ from: 'whatsapp:+15550000000' })
    );
    expect(buildExcursionBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('opens the excursion booking request form after selection', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getExcursionSearchSessionMock.mockResolvedValue(buildExcursionSession({
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { destination: 'Ella', guests: 2 },
      resultBatches: [[{ id: 'place-1', name: 'Little Adam Peak Walk' }]],
      results: [{ id: 'place-1', name: 'Little Adam Peak Walk' }],
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
    }));
    selectExperienceMock.mockResolvedValue({
      selectedExperienceId: 'place-1',
      selectedExperienceSnapshot: { id: 'place-1', name: 'Little Adam Peak Walk' },
      selectedFromBatchIndex: 0,
      selectedDisplayNumber: 1,
      selectedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('book 1'), 'corr-excursion-book');

    expect(reply).toContain('booking request form');
    expect(reply).toContain('https://forms.yana.example/forms/excursion_booking/');
    expect(selectExperienceMock).toHaveBeenCalledWith('whatsapp:+15550009999', 1);
  });

  it('clears excursion state on reset', async () => {
    getExcursionSearchSessionMock.mockResolvedValue(buildExcursionSession({
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { destination: 'Ella' },
    }));

    const reply = await processInboundMessage(buildTextMessage('reset'), 'corr-excursion-reset');

    expect(reply).toContain('paused your saved requests');
    expect(clearExcursionSearchSessionMock).not.toHaveBeenCalled();
    expect(pauseExcursionSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
  });

  it('transcribes an excursion voice note and starts excursion flow', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    transcribeMock.mockResolvedValue({
      transcript: 'I want a safari',
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-excursion-voice');

    expect(result.inboundMessage.inputType).toBe('voice');
    expect(result.reply).toContain('Which town or area are you interested in?');
    expect(saveExcursionFormSentMock).not.toHaveBeenCalled();
  });

  it.each([
    'I am planning my trip.',
    'Plan my holiday.',
    'Plan my itinerary.',
    "I'm visiting Sri Lanka.",
    "I'll be here for a week.",
    "We're travelling around Sri Lanka.",
    'I need help planning.',
  ])('starts the itinerary form flow for trip planning intent: %s', async (message) => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(buildTextMessage(message), 'corr-itinerary-intent');

    expect(reply).toContain('full trip');
    expect(reply).toContain('https://forms.yana.example/forms/itinerary/');
    expect(saveItineraryFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      message,
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('continues the latest submitted itinerary form when the user says done', async () => {
    getLatestServiceRequestMock.mockImplementation(async (_userId: string, type: string) =>
      type === 'itinerary'
        ? {
            id: 'itinerary-request-1',
            userId: 'whatsapp:+15550009999',
            type: 'itinerary',
            form: {
              arrivalAirport: 'Colombo',
              arrivalDate: '2026-07-12',
              arrivalTime: '10:00',
              departureAirport: 'Colombo',
              departureDate: '2026-07-19',
              departureTime: '21:00',
              adults: 2,
              children: 0,
              budget: 'Comfort',
              accommodationStyle: 'Boutique',
              travelStyle: 'Mixed',
              interests: 'Historical Sites, Wildlife, Adventure, Tea Country',
              preferredTransport: 'Private Driver',
            },
            createdAt: new Date('2026-06-01T10:00:00.000Z'),
          }
        : null
    );
    getLatestServiceRequestOverallMock.mockImplementation(() =>
      getLatestServiceRequestMock('whatsapp:+15550009999', 'itinerary')
    );

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-itinerary-form');

    expect(reply).toContain('prepared your itinerary');
    expect(reply).toContain('Route:');
    expect(saveItineraryPlanningMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ arrivalAirport: 'Colombo', preferredTransport: 'Private Driver' })
    );
    expect(planItineraryMock).toHaveBeenCalled();
  });

  it('generates the itinerary after additional preferences', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'awaiting_preferences',
      criteria: {
        arrivalAirport: 'Colombo',
        arrivalDate: '2026-07-12',
        arrivalTime: '10:00',
        departureAirport: 'Colombo',
        departureDate: '2026-07-19',
        departureTime: '21:00',
        adults: 2,
        children: 0,
        budget: 'Comfort',
        travelStyle: 'Mixed',
        preferredTransport: 'Private Driver',
      },
    }));

    const reply = await processInboundMessage(
      buildTextMessage('avoid long drives and add safari'),
      'corr-itinerary-plan'
    );

    expect(reply).toContain('prepared your itinerary');
    expect(reply).toContain('Open your interactive itinerary');
    expect(reply).toContain('Route:');
    expect(saveItineraryPlanningMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ additionalPreferences: 'avoid long drives and add safari' })
    );
    expect(planItineraryMock).toHaveBeenCalled();
    expect(saveItineraryMock).toHaveBeenCalled();
  });

  it('continues from the latest itinerary form instead of asking hotel dates when the session is missing', async () => {
    getLatestServiceRequestMock.mockImplementation(async (_userId: string, type: string) =>
      type === 'itinerary'
        ? {
            id: 'itinerary-request-1',
            userId: 'whatsapp:+15550009999',
            type: 'itinerary',
            form: {
              arrivalAirport: 'Colombo',
              arrivalDate: '2026-07-12',
              arrivalTime: '10:00',
              departureAirport: 'Colombo',
              departureDate: '2026-07-19',
              departureTime: '21:00',
              adults: 2,
              children: 0,
              budget: 'Comfort',
              accommodationStyle: 'Boutique',
              travelStyle: 'Mixed',
              interests: ['Historical Sites', 'Wildlife', 'Tea Country'],
              preferredTransport: 'Private Driver',
            },
            createdAt: new Date('2026-06-01T10:00:00.000Z'),
          }
        : null
    );
    getLatestServiceRequestOverallMock.mockImplementation(() =>
      getLatestServiceRequestMock('whatsapp:+15550009999', 'itinerary')
    );

    const reply = await processInboundMessage(buildTextMessage('no'), 'corr-itinerary-no-session');

    expect(reply).toContain('prepared your itinerary');
    expect(reply).toContain('Route:');
    expect(reply).not.toContain('check-in');
    expect(reply).not.toContain('check-out');
    expect(saveItineraryPlanningMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ arrivalAirport: 'Colombo', preferredTransport: 'Private Driver' })
    );
    expect(planItineraryMock).toHaveBeenCalled();
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('shows the next itinerary day', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'showing_itinerary',
      itinerary: buildGeneratedItinerary(),
      currentDay: 1,
    }));

    const reply = await processInboundMessage(buildTextMessage('next day'), 'corr-itinerary-next');

    expect(reply).toContain('Day 2');
    expect(setItineraryCurrentDayMock).toHaveBeenCalledWith('whatsapp:+15550009999', 2);
  });

  it('clarifies an edit without a target day instead of reporting an ineffective regeneration', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'showing_itinerary',
      itinerary: buildGeneratedItinerary(),
      criteria: { arrivalAirport: 'Colombo', additionalPreferences: 'avoid long drives' },
    }));

    const reply = await processInboundMessage(buildTextMessage('more beach time'), 'corr-itinerary-edit');

    expect(reply).toContain('Which day and part');
    expect(planItineraryMock).not.toHaveBeenCalled();
    expect(saveItineraryEditingMock).not.toHaveBeenCalled();
  });

  it('applies a WhatsApp edit through the real edit/session services and exposes it in the recovered website workspace', async () => {
    const actualSessions = await vi.importActual<typeof import('../services/itinerarySessionService.js')>('../services/itinerarySessionService.js');
    const actualWorkspace = await vi.importActual<typeof import('../services/ItineraryWorkspaceService.js')>('../services/ItineraryWorkspaceService.js');
    const store = new FixtureStateStore();
    const repository = new FixtureSessionRepository<any>();
    const sessions = new actualSessions.ItinerarySessionService(store as any, repository);
    const user = 'whatsapp:+15550009999';
    const criteria = { arrivalDate: '2026-11-01', departureDate: '2026-11-04', adults: 2 };
    await sessions.saveItinerary(user, criteria, buildGeneratedItinerary());
    workspaceServiceOverride = new actualWorkspace.ItineraryWorkspaceService(store as any, sessions);
    const workspace = await workspaceServiceOverride.createWorkspace(user, buildGeneratedItinerary(), criteria);
    getItinerarySessionMock.mockImplementation((id: string) => sessions.get(id));
    getAuthoritativeItineraryMock.mockImplementation((id: string) => sessions.getAuthoritative(id));
    commitItineraryEditMock.mockImplementation((...args: Parameters<typeof sessions.commitEdit>) => sessions.commitEdit(...args));
    const reply = await processInboundMessage(buildTextMessage('change day 2 afternoon to a quiet beach visit'), 'fixture-edit-command');
    expect(reply).toContain('prepared your itinerary');
    expect(planItineraryMock).not.toHaveBeenCalled();
    expect((await sessions.getAuthoritative(user))?.itinerary?.days[1].afternoon).toBe('a quiet beach visit');
    store.clear();
    const restarted = new actualSessions.ItinerarySessionService(new FixtureStateStore() as any, repository);
    const recovered = await new actualWorkspace.ItineraryWorkspaceService(new FixtureStateStore() as any, restarted).getWorkspace(workspace.shareToken);
    expect(recovered?.itinerary.days[1].afternoon).toBe('a quiet beach visit');
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('clears itinerary state on reset', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'showing_itinerary',
      itinerary: buildGeneratedItinerary(),
    }));

    const reply = await processInboundMessage(buildTextMessage('reset'), 'corr-itinerary-reset');

    expect(reply).toContain('paused your saved requests');
    expect(clearItinerarySessionMock).not.toHaveBeenCalled();
    expect(clearItineraryWorkspaceMock).not.toHaveBeenCalled();
    expect(pauseItinerarySessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
  });

  it('transcribes an itinerary voice note and starts itinerary flow', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    transcribeMock.mockResolvedValue({
      transcript: 'Plan my itinerary',
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-itinerary-voice');

    expect(result.reply).toContain('full trip');
    expect(saveItineraryFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'Plan my itinerary',
      expect.objectContaining({ preferredName: 'Sam' })
    );
  });

  it('resumes the saved hotel request by opening the hotel details form', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      state: 'profile_required',
      originalMessage: 'Find a hotel in Galle',
      criteria: {},
      results: [],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    consumeProfileGateRequestMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      messageText: 'Find a hotel in Galle',
      messageId: 'SMpending001',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    handleMessageMock.mockResolvedValue({ handled: false });

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-webhook-3');

    expect(reply).toContain('Hi Sam, I am Yana');
    expect(reply).not.toContain('/forms/hotel/');
    expect(consumeProfileGateRequestMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  it('does not show an empty hotel form summary after only the profile form is completed', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      state: 'profile_required',
      criteria: {},
      results: [],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-webhook-profile-only');

    expect(reply).toContain('Hi Sam, I am Yana');
    expect(reply).toContain('Thank you for the information');
    expect(reply).not.toContain("I've gathered the following details");
    expect(reply).not.toContain('Destination: Not provided');
    expect(saveSearchingMock).not.toHaveBeenCalled();
    expect(handleBrowseSearchMock).not.toHaveBeenCalled();
  });

  it('confirms the latest submitted hotel form before searching', async () => {
    const hotelForm = {
      destination: 'Galle Fort',
      checkIn: '2026-06-12',
      checkOut: '2026-06-15',
      adults: 2,
      children: 0,
      rooms: 1,
      budget: 'USD 120 per night',
      mealPlan: 'B&B',
    };
    getLatestServiceRequestMock.mockResolvedValue({
      id: 'request-1',
      userId: 'whatsapp:+15550009999',
      type: 'hotel',
      form: hotelForm,
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    });

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-webhook-4');

    expect(reply).toContain("I've gathered the following details from your search form");
    expect(reply).toContain('Destination: Galle Fort');
    expect(reply).toContain('Rooms: 1');
    expect(reply).toContain('Budget Per Night: USD 120');
    expect(saveAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        location: 'Galle Fort',
        checkinDate: '2026-06-12',
        checkoutDate: '2026-06-15',
        guests: 2,
        budgetPerNight: {
          amount: 120,
          currency: 'USD',
        },
      })
    );
    expect(handleCompletedIntakeMock).not.toHaveBeenCalled();
  });

  it('acknowledges extra preferences immediately and searches in the background', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      criteria: {
        location: 'Galle Fort',
        checkinDate: '2026-06-12',
        checkoutDate: '2026-06-15',
        guests: 2,
        rooms: 1,
      },
      results: [],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    handleBrowseSearchMock.mockResolvedValue({
      status: 'browse_results',
      criteria: {},
      reply: 'Top 3 Google Places hotels',
      browseResponse: {
        provider: 'google_places',
        results: [{ id: 'place-1', name: 'Hotel 1', googleMapsUri: 'https://maps.google.com/?cid=1' }, { name: 'Hotel 2' }, { name: 'Hotel 3' }, { name: 'Hotel 4' }],
      },
    });

    const reply = await processInboundMessage(
      buildTextMessage('beachfront with pool and ocean view'),
      'corr-webhook-5'
    );

    expect(reply).toContain('Let me check on that and get back to you');
    expect(saveSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        location: 'Galle Fort',
        additionalPreferences: 'beachfront with pool and ocean view',
      })
    );

    await vi.waitFor(() => {
      expect(handleBrowseSearchMock).toHaveBeenCalled();
    });
    expect(handleBrowseSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 'Galle Fort',
        additionalPreferences: 'beachfront with pool and ocean view',
      }),
      expect.objectContaining({
        correlationId: 'corr-webhook-5',
        sessionId: 'whatsapp:+15550009999',
      })
    );
    await vi.waitFor(() => {
      expect(saveResultsMock).toHaveBeenCalledWith(
        'whatsapp:+15550009999',
        expect.objectContaining({
          additionalPreferences: 'beachfront with pool and ocean view',
        }),
        expect.arrayContaining([expect.objectContaining({ name: 'Hotel 1' })]),
        3
      );
      expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
        'whatsapp:+15550009999',
        expect.arrayContaining([
          expect.objectContaining({ body: expect.stringContaining('I found these hotel matches') }),
          expect.objectContaining({ body: expect.stringContaining('Why Yana picked it:') }),
        ]),
        expect.objectContaining({ voice: undefined, from: 'whatsapp:+15550000000' })
      );
      expect(JSON.stringify(sendWhatsAppMessagesMock.mock.calls)).not.toContain('maps.google.com');
      expect(JSON.stringify(sendWhatsAppMessagesMock.mock.calls)).not.toContain('/places/smart/');
    });
  });

  it('does not treat done as an extra hotel preference after form confirmation', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      criteria: {
        location: 'Colombo 03',
        checkinDate: '2026-06-12',
        checkoutDate: '2026-06-15',
        guests: 2,
        rooms: 1,
      },
      results: [],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-webhook-18');

    expect(reply).toContain("I've gathered the following details");
    expect(reply).toContain('Destination: Colombo 03');
    expect(reply).toContain('Reply with your preferences');
    expect(saveSearchingMock).not.toHaveBeenCalled();
    expect(handleBrowseSearchMock).not.toHaveBeenCalled();
  });

  it('returns hotel results in the same response when async Twilio outbound is unavailable', async () => {
    twilioOutboundConfiguredMock.mockReturnValue(false);
    sendWhatsAppTextMock.mockResolvedValue(false);
    sendWhatsAppReplyMock.mockResolvedValue(false);
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'awaiting_preferences',
      criteria: {
        location: 'Galle Fort',
        checkinDate: '2026-06-12',
        checkoutDate: '2026-06-15',
        guests: 2,
        rooms: 1,
      },
      results: [],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    handleBrowseSearchMock.mockResolvedValue({
      status: 'browse_results',
      criteria: {},
      reply: 'Top 3 Google Places hotels',
      browseResponse: {
        provider: 'google_places',
        results: [{ name: 'Hotel 1' }, { name: 'Hotel 2' }, { name: 'Hotel 3' }, { name: 'Hotel 4' }],
      },
    });

    const reply = await processInboundMessage(buildTextMessage('beachfront'), 'corr-webhook-15');

    expect(reply).toBe('Top 3 Google Places hotels');
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('reply "status"');
    expect(handleBrowseSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: 'Galle Fort',
        additionalPreferences: 'beachfront',
      }),
      expect.objectContaining({
        correlationId: 'corr-webhook-15',
        sessionId: 'whatsapp:+15550009999',
      })
    );
    expect(saveResultsMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        additionalPreferences: 'beachfront',
      }),
      expect.arrayContaining([expect.objectContaining({ name: 'Hotel 1' })]),
      3
    );
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
    expect(sendWhatsAppReplyMock).not.toHaveBeenCalled();
  });

  it('keeps the user updated while hotel search is still running', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'searching',
      criteria: { location: 'Galle Fort' },
      results: [],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('?'), 'corr-webhook-8');

    expect(reply).toContain('still checking');
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  it('returns the next 3 saved hotel suggestions', async () => {
    const results = [
      { name: 'Hotel 1' },
      { name: 'Hotel 2' },
      { name: 'Hotel 3' },
      { name: 'Hotel 4' },
      { name: 'Hotel 5' },
      { name: 'Hotel 6' },
    ];
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Galle Fort' },
      results,
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('next'), 'corr-webhook-6');

    expect(reply).toBe('🏨 Here are the next hotel options.');
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('🏨 *1. Hotel 4*') }),
        expect.objectContaining({ body: expect.stringContaining('✨ Why Yana picked it:') }),
      ]),
      expect.objectContaining({ from: 'whatsapp:+15550000000' })
    );
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
    expect(saveResultsMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      { location: 'Galle Fort' },
      results,
      6
    );
  });

  it('transcribes a voice note and routes restart my hotel booking through the same pipeline', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    transcribeMock.mockResolvedValue({
      transcript: 'restart my hotel booking',
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Colombo' },
      results: [{ name: 'Old Colombo Hotel' }],
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await processWebhookPayload(
      buildAudioPayload('https://api.twilio.com/2010-04-01/Accounts/AC/Messages/SM/Media/ME'),
      'corr-webhook-22'
    );

    expect(result.inboundMessage.inputType).toBe('voice');
    expect(result.inboundMessage.content).toEqual({
      type: 'text',
      body: 'restart my hotel booking',
    });
    expect(result.reply).toContain('I heard: "restart my hotel booking"');
    expect(result.reply).toContain('start a fresh hotel search');
    expect(result.reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('transcribes a voice note saying next and paginates saved hotel results', async () => {
    transcribeMock.mockResolvedValue({
      transcript: 'next',
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });
    const results = [
      { name: 'Hotel 1' },
      { name: 'Hotel 2' },
      { name: 'Hotel 3' },
      { name: 'Hotel 4' },
      { name: 'Hotel 5' },
      { name: 'Hotel 6' },
    ];
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Galle Fort' },
      results,
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-23');

    expect(result.reply).toContain('I heard: "next"');
    expect(result.reply).toContain('🏨 Here are the next hotel options.');
    expectNoInternalPresentationTerms(result.reply);
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('🏨 *1. Hotel 4*') }),
      ]),
      expect.objectContaining({ from: 'whatsapp:+15550000000', voice: true })
    );
  });

  it('returns a friendly error for unsupported inbound media', async () => {
    const result = await processWebhookPayload(
      {
        MessageSid: 'SMmedia001',
        From: 'whatsapp:+15550009999',
        To: 'whatsapp:+15550000000',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/image.jpg',
        MediaContentType0: 'image/jpeg',
      },
      'corr-webhook-24'
    );

    expect(result.reply).toContain('I can only read text and WhatsApp voice notes');
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('returns a friendly error when transcription fails', async () => {
    transcribeMock.mockRejectedValue(
      new SpeechToTextServiceError('provider failed', 'transcription_failed', true)
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-25');

    expect(result.reply).toContain("couldn't clearly read that voice note");
  });

  it('returns a friendly webhook error when voice transcription is not configured', async () => {
    transcribeMock.mockRejectedValue(
      new SpeechToTextServiceError('TRANSCRIPTION_API_KEY is required', 'missing_api_key')
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-26');

    expect(result.reply).toContain('Voice notes are temporarily unavailable');
    expect(result.reply).toContain('human help');
    expect(result.reply).not.toMatch(/TRANSCRIPTION_API_KEY|LLM_API_KEY|TRANSCRIPTION_MODEL/);
  });

  it('returns a Twilio setup error when voice media cannot be downloaded without real credentials', async () => {
    transcribeMock.mockRejectedValue(
      new SpeechToTextServiceError('Twilio credentials are required', 'missing_twilio_credentials')
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-27');

    expect(result.reply).toContain('cannot access that voice note');
    expect(result.reply).toContain('human help');
    expect(result.reply).not.toMatch(/TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN/);
  });

  it('returns a retry message when Twilio media download fails', async () => {
    transcribeMock.mockRejectedValue(
      new SpeechToTextServiceError('Twilio media returned 500', 'download_failed', true)
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-28');

    expect(result.reply).toContain("couldn't download that voice note");
  });

  it('returns a size-specific message when a voice note is too large', async () => {
    transcribeMock.mockRejectedValue(
      new SpeechToTextServiceError('Voice note is too large', 'media_too_large')
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-29');

    expect(result.reply).toContain('too large');
  });

  it('starts a fresh hotel form instead of replaying old results for a natural restart request', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: {
        location: 'Colombo',
        additionalPreferences: 'a sea view',
      },
      results: [{ name: 'Old Colombo Hotel' }],
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(
      buildTextMessage('i want to restart my hotel booking'),
      'corr-webhook-19'
    );

    expect(reply).toContain('start a fresh hotel search');
    expect(reply).toContain('Please complete this quick hotel request form');
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(saveHotelFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'i want to restart my hotel booking',
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('starts new hotel discovery when a request arrives during old results', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Colombo' },
      results: [{ name: 'Old Colombo Hotel' }],
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(
      buildTextMessage('i need a hotel in Kandy now'),
      'corr-webhook-20'
    );

    expect(reply).toContain('stays around Kandy');
    expect(reply).not.toContain('/forms/hotel/');
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('can use the LLM router signal to switch away from stale hotel results', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Colombo' },
      results: [{ name: 'Old Colombo Hotel' }],
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    llmDecideMock.mockResolvedValue({
      intent: 'search_hotels',
      parameters: { location: 'Kandy' },
      missingFields: ['checkin_date', 'checkout_date'],
      suggestedAction: 'ask_missing',
      confidence: 0.88,
    });

    const reply = await processInboundMessage(
      buildTextMessage('actually lets do Kandy instead'),
      'corr-webhook-21'
    );

    expect(reply).not.toContain('/forms/hotel/');
    expect(llmDecideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'actually lets do Kandy instead',
        sessionState: expect.objectContaining({
          currentIntent: 'hotel',
          activeSchema: 'search_hotels',
        }),
      }), expect.stringContaining('Your AI Navigation Agent')
    );
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('does not expose internal intent or field names during hotel discovery', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'search_hotels',
      parameters: {},
      missingFields: ['destination', 'travelDates'],
      suggestedAction: 'ask_missing',
      confidence: 0.82,
    });

    const reply = await processInboundMessage(buildTextMessage('help me plan'), 'corr-webhook-style-1');

    expect(reply).toContain('explore stays');
    expect(reply).not.toContain('/forms/hotel/');
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('I understood this as');
  });

  it('does not expose unsupported internal intent names in fallback replies', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'general_inquiry',
      parameters: {},
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.8,
    });

    const reply = await processInboundMessage(
      buildTextMessage('can you help with my trip?'),
      'corr-webhook-style-2'
    );

    expect(reply).toContain('travel');
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('I understood this as');
  });

  it('does not return hotel-only language for a broad Sri Lanka trip planning request', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'general_inquiry',
      parameters: { destination: 'Sri Lanka' },
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.81,
    });

    const reply = await processInboundMessage(
      buildTextMessage('I want to plan my trip in Sri Lanka'),
      'corr-webhook-style-6'
    );

    expect(reply).toContain('full trip');
    expect(reply).toContain('/forms/itinerary/');
    expect(saveItineraryFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'I want to plan my trip in Sri Lanka',
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(reply).not.toContain('Which area are you thinking of');
    expect(reply).not.toContain('your hotel search');
    expectNoInternalPresentationTerms(reply);
  });

  it('uses the primary interpretation response for a general inquiry', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      responseText: 'I can help with things to do or excursions, a hotel, restaurants, transport, or local recommendations.',
      intent: 'general_inquiry',
      parameters: {},
      missingFields: [],
      suggestedAction: 'execute_tool',
      confidence: 0.84,
    });

    const reply = await processInboundMessage(
      buildTextMessage('what else can you do?'),
      'corr-webhook-style-3'
    );

    expect(reply).toContain('things to do or excursions');
    expect(reply).toContain('a hotel, restaurants, transport');
    expect(reply).toContain('local recommendations');
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('execute_tool');
  });

  it('uses the safe clarification fallback when the primary model is uncertain', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      responseText: 'Are you looking for things to do or excursions, a hotel, restaurants, transport, a full trip plan, or local recommendations?',
      intent: 'unclear',
      parameters: {},
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.32,
    });

    const reply = await processInboundMessage(
      buildTextMessage('I’m coming to Colombo tomorrow, what can I do?'),
      'corr-webhook-style-4'
    );

    expect(reply).toContain('things to do or excursions');
    expect(reply).toContain('a hotel, restaurants, transport');
    expect(reply).toContain('full trip plan, or local recommendations');
    expect(llmDecideMock).toHaveBeenCalledWith(expect.objectContaining({
      availableSchemas: expect.arrayContaining([
        'search_hotels',
        'search_restaurants',
        'search_excursions',
        'search_transport',
        'plan_itinerary',
        'general_inquiry',
      ]),
    }), expect.stringContaining('Your AI Navigation Agent'));
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('unclear');
  });

  it('asks a conversational intent clarification when the LLM decision is unavailable', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockRejectedValue(new LLMServiceError('provider unavailable', 'UNAVAILABLE', true));

    const reply = await processInboundMessage(
      buildTextMessage('I’m arriving in Galle tomorrow, what can I do?'),
      'corr-webhook-llm-unavailable-clarify'
    );

    expect(reply).toContain('things to do or excursions');
    expect(reply).toContain('a hotel, restaurants, transport, a full trip plan');
    expect(reply).toContain('local recommendations');
    expect(reply).not.toContain('Colombo');
    expect(reply).not.toContain('could not complete');
  });

  it.each(['hotel', 'general'])('delivers the core prompt from the %s webhook LLM path to HTTP', async (flow) => {
    initConversationControlPlane(new ConversationControlPlane({ contextBuilder: new ContextBuilder({
      findRecentByTraveller: async () => [{ role: 'user', content: 'I prefer vegetarian food and quiet places.' }],
    }) }));
    getProfileMock.mockResolvedValue({ userId: 'whatsapp:+15550009999', form: { preferredName: 'Sam', preferredLanguage: 'French', dietaryRestrictions: 'Vegetarian' } });
    const actual = await vi.importActual<typeof import('../services/LLMService.js')>('../services/LLMService.js');
    const service = new actual.LLMService({ provider: 'groq', apiKey: 'fixture-key', model: 'fixture-model' });
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    handleMessageMock.mockResolvedValue({ handled: false });
    if (flow === 'hotel') {
      getHotelSearchSessionMock.mockResolvedValue({
        userId: 'whatsapp:+15550009999', stage: 'results', criteria: { location: 'Colombo' },
        results: [{ name: 'Old Colombo Hotel' }], nextOffset: 3, updatedAt: '2026-10-21T00:00:00Z',
      });
    }
    const message = flow === 'hotel' ? 'actually lets do Kandy instead' : 'Could you help me decide?';
    vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        responseText: flow === 'general' ? 'I can help with your travel plans.' : '',
        intent: flow === 'hotel' ? 'search_hotels' : 'general_inquiry',
        parameters: flow === 'hotel' ? { location: 'Kandy' } : {},
        missingFields: [], suggestedAction: flow === 'hotel' ? 'ask_missing' : 'clarify', confidence: 0.9,
      }) } }] }) };
    }));
    llmDecideMock.mockImplementation((...args: Parameters<typeof service.decide>) => service.decide(...args));
    try {
      const response = await processInboundMessage(buildTextMessage(message), `fixture-prompt-${flow}`);
      expect(requests).toHaveLength(1);
      expect(requests[0].messages.map((entry) => entry.role)).toEqual(['system', 'user']);
      expect(requests[0].messages[0].content).toContain('Your AI Navigation Agent');
      expect(requests[0].messages[0].content).toContain('PURPOSE: decision');
      expect(requests[0].messages[0].content).not.toContain(message);
      const data = JSON.parse(requests[0].messages[1].content);
      expect(data.userMessage).toBe(message);
      expect(data.userProfile.preferredLanguage).toBe('French');
      expect(data.conversationHistory[0].content).toContain('vegetarian');
      if (flow === 'hotel') {
        expect(data.sessionState.collectedFields.location).toBe('Colombo');
        expect(response).not.toContain('/forms/hotel/');
      } else {
        expect(response).toContain('travel plans');
        expect(generateUIContentMock).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllGlobals();
      llmDecideMock.mockReset();
      initConversationControlPlane();
    }
  });

  it('uses the ConversationManager trip-planning template in the webhook path', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'general_inquiry',
      parameters: { duration: 'one week' },
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.82,
    });

    const reply = await processInboundMessage(
      buildTextMessage('I want to plan my trip in Sri Lanka'),
      'corr-webhook-style-5'
    );

    expect(reply).toContain('full trip');
    expect(reply).toContain('/forms/itinerary/');
    expect(saveItineraryFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'I want to plan my trip in Sri Lanka',
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expectNoInternalPresentationTerms(reply);
  });

  it('uses the trip-planning style response for a one-week Sri Lanka planning request', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'general_inquiry',
      parameters: { duration: '1 week', destination: 'Sri Lanka' },
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.86,
    });

    const reply = await processInboundMessage(
      buildTextMessage('I need to plan my trip in Sri Lanka, I will be here for 1 week'),
      'corr-webhook-style-7'
    );

    expect(reply).toContain('full trip');
    expect(reply).toContain('/forms/itinerary/');
    expect(saveItineraryFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'I need to plan my trip in Sri Lanka, I will be here for 1 week',
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(reply).not.toContain('Which area are you thinking of');
    expect(reply).not.toContain('your hotel search');
    expectNoInternalPresentationTerms(reply);
  });

  it('returns details for a hotel from the latest displayed batch', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'results',
      state: 'awaiting_hotel_selection',
      criteria: { location: 'Galle Fort' },
      resultBatches: [
        [
          {
            name: 'Hotel 1',
            rating: 4.5,
            reviewCount: 100,
            address: 'Galle Road',
            googleMapsUri: 'https://maps.google.com/?cid=1',
          },
        ],
      ],
      results: [{ name: 'Hotel 1' }],
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('details 1'), 'corr-webhook-16');

    expect(reply).toContain('Hotel 1');
    expect(reply).toContain('Rating: 4.5/5');
    expect(reply).toContain('Listing details: Google Maps');
    expect(reply).toContain('book 1');
    expect(reply).not.toContain('maps.google.com');
  });

  it('saves hotel selection and runs the live booking-stage provider check', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      whatsappUserId: 'whatsapp:+15550009999',
      stage: 'results',
      state: 'awaiting_hotel_selection',
      criteria: { location: 'Galle Fort' },
      resultBatches: [[{ id: 'place-1', name: 'Hotel 1' }]],
      results: [{ id: 'place-1', name: 'Hotel 1' }],
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    selectHotelMock.mockResolvedValue({
      selectedHotelId: 'place-1',
      selectedHotelSnapshot: { id: 'place-1', name: 'Hotel 1' },
      selectedFromBatchIndex: 0,
      selectedDisplayNumber: 1,
      selectedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('book 1'), 'corr-webhook-17');

    expect(selectHotelMock).toHaveBeenCalledWith('whatsapp:+15550009999', 1);
    expect(handleBookingCheckMock).toHaveBeenCalledWith(
      { location: 'Galle Fort' },
      { id: 'place-1', name: 'Hotel 1' },
      expect.objectContaining({ correlationId: 'corr-webhook-17' })
    );
    expect(reply).toContain('I rechecked Hotel 1');
    expect(reply).toContain('No reservation has been made');
    expect(markHandoffConsentPendingMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(reply).toContain('yes, connect me');
  });

  it('keeps an uncovered hotel request within YANA without sharing direct contact links', async () => {
    const hotel = { id: 'place-1', googlePlaceId: 'place-1', name: 'Hotel 1', googleMapsUri: 'https://maps.google.com/?cid=1' };
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', whatsappUserId: 'whatsapp:+15550009999',
      stage: 'results', state: 'awaiting_hotel_selection',
      criteria: { location: 'Galle Fort', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 },
      resultBatches: [[hotel, { id: 'place-2', name: 'Hotel 2' }]],
      results: [hotel, { id: 'place-2', name: 'Hotel 2' }],
      latestDisplayedBatchIndex: 0, nextOffset: 2, updatedAt: '2026-10-18T10:00:00.000Z',
    });
    selectHotelMock.mockResolvedValue({
      selectedHotelId: 'place-1', selectedHotelSnapshot: hotel,
      selectedFromBatchIndex: 0, selectedDisplayNumber: 1, selectedAt: '2026-10-18T10:00:00.000Z',
    });
    handleBookingCheckMock.mockResolvedValue({ status: 'provider_not_connected', reply: 'No supplier match' });
    const reply = await processInboundMessage(buildTextMessage('book 1'), 'corr-hotel-direct-fallback');

    expect(reply).toContain('yes, source it');
    expect(reply).toContain('final quote');
    expect(reply).not.toMatch(/https?:\/\/|\+94 11/);
    expect(markSourcingConsentPendingMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(saveResultsMock).not.toHaveBeenCalled();
    expect(issueRecheckReceiptMock).not.toHaveBeenCalled();
    expect(markHandoffConsentPendingMock).not.toHaveBeenCalled();
  });

  it('saves a consented sourcing request with the selected hotel and stay details', async () => {
    const selectedHotel = {
      selectedHotelId: 'place-1', selectedHotelSnapshot: { id: 'place-1', googlePlaceId: 'place-1', name: 'Hotel 1' },
      selectedFromBatchIndex: 0, selectedDisplayNumber: 1, selectedAt: '2026-10-18T10:00:00.000Z',
    };
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', whatsappUserId: 'whatsapp:+15550009999',
      stage: 'booking_provider_pending', state: 'booking_provider_pending', pendingSourcingConsent: true,
      criteria: { location: 'Galle Fort', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 },
      selectedHotel,
    });

    const reply = await processInboundMessage(buildTextMessage('yes, source it'), 'corr-yana-sourcing');

    expect(saveServiceRequestMock).toHaveBeenCalledWith('whatsapp:+15550009999', 'hotel',
      expect.objectContaining({ preferredHotelName: 'Hotel 1', preferredGooglePlaceId: 'place-1',
        checkIn: '2026-11-10', checkOut: '2026-11-12', sourcingStatus: 'awaiting_quote' }));
    expect(markSourcingRequestSavedMock).toHaveBeenCalledWith('whatsapp:+15550009999', 'yana-sourcing-request-1');
    expect(reply).toContain('saved your request');
    expect(reply).toContain('No reservation or payment');
    expect(reply).not.toMatch(/https?:\/\/|\+94 11/);
  });

  it('does not create a duplicate sourcing lead after a session-save retry', async () => {
    const selectedHotel = {
      selectedHotelId: 'place-1', selectedHotelSnapshot: { id: 'place-1', name: 'Hotel 1' },
      selectedFromBatchIndex: 0, selectedDisplayNumber: 1, selectedAt: '2026-10-18T10:00:00.000Z',
    };
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', whatsappUserId: 'whatsapp:+15550009999',
      stage: 'booking_provider_pending', state: 'booking_provider_pending', pendingSourcingConsent: true,
      criteria: { location: 'Galle Fort', checkinDate: '2026-11-10', checkoutDate: '2026-11-12', guests: 2 },
      selectedHotel,
    });
    getLatestServiceRequestMock.mockResolvedValue({
      id: 'existing-sourcing-request', type: 'hotel',
      form: { preferredHotelName: 'Hotel 1', destination: 'Galle Fort', checkIn: '2026-11-10', checkOut: '2026-11-12',
        adults: 2, rooms: 1, budget: 'Not specified', sourcingStatus: 'awaiting_quote' },
    });

    const reply = await processInboundMessage(buildTextMessage('yes, source it'), 'corr-yana-sourcing-retry');

    expect(saveServiceRequestMock).not.toHaveBeenCalled();
    expect(markSourcingRequestSavedMock).toHaveBeenCalledWith('whatsapp:+15550009999', 'existing-sourcing-request');
    expect(reply).toContain('saved your request');
  });

  it('returns to YANA hotel options when sourcing consent is declined', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', whatsappUserId: 'whatsapp:+15550009999',
      stage: 'booking_provider_pending', state: 'booking_provider_pending', pendingSourcingConsent: true,
      criteria: { location: 'Galle Fort' }, results: [{ id: 'place-1', name: 'Hotel 1' }], nextOffset: 1,
      selectedHotel: { selectedHotelId: 'place-1', selectedHotelSnapshot: { id: 'place-1', name: 'Hotel 1' } },
    });

    const reply = await processInboundMessage(buildTextMessage('no'), 'corr-yana-sourcing-decline');

    expect(clearSourcingConsentPendingMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(saveResultsMock).toHaveBeenCalledWith('whatsapp:+15550009999',
      expect.objectContaining({ location: 'Galle Fort' }), expect.arrayContaining([{ id: 'place-1', name: 'Hotel 1' }]), 1);
    expect(saveServiceRequestMock).not.toHaveBeenCalled();
    expect(reply).toContain('another YANA option');
  });

  it('requires explicit follow-up consent before creating a durable human handoff', async () => {
    const selectedHotel = {
      selectedHotelId: 'place-1', selectedHotelSnapshot: { id: 'place-1', name: 'Hotel 1' },
      selectedFromBatchIndex: 0, selectedDisplayNumber: 1, selectedAt: '2026-06-01T10:00:00.000Z',
    };
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', whatsappUserId: 'whatsapp:+15550009999',
      stage: 'booking_provider_pending', state: 'booking_provider_pending', pendingHumanHandoffConsent: true,
      criteria: { location: 'Galle Fort', checkinDate: '2026-10-01', checkoutDate: '2026-10-03', guests: 2 },
      selectedHotel,
    });

    const unclear = await processInboundMessage(buildTextMessage('maybe later'), 'corr-consent-1');
    expect(unclear).toContain('Reply "yes, connect me"');
    expect(requestHotelHandoffMock).not.toHaveBeenCalled();

    const accepted = await processInboundMessage(buildTextMessage('yes, connect me'), 'corr-consent-2');
    expect(accepted).toContain('concierge queue');
    expect(requestHotelHandoffMock).toHaveBeenCalledWith(expect.objectContaining({
      whatsappUserId: 'whatsapp:+15550009999', travelerConsented: true, selectedHotel,
    }));
  });

  it('replays ready results when async outbound did not deliver them', async () => {
    const results = [
      { name: 'Hotel 1' },
      { name: 'Hotel 2' },
      { name: 'Hotel 3' },
      { name: 'Hotel 4' },
    ];
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Galle Fort' },
      results,
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    buildBrowseResultsPageReplyMock.mockReturnValue('First page replay');

    const reply = await processInboundMessage(buildTextMessage('Anything yet ?'), 'corr-webhook-9');

    expect(reply).toBe('First page replay');
    expect(buildBrowseResultsPageReplyMock).toHaveBeenCalledWith(
      { location: 'Galle Fort' },
      [{ name: 'Hotel 1' }, { name: 'Hotel 2' }, { name: 'Hotel 3' }],
      3,
      4
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  it.each([
    'Stop',
    'End',
    "Thanks I'll decide later",
    'Leave these with me and I will come back to them tomorrow',
    'This is enough for tonight; I want to look at the options another day',
  ])(
    'pauses hotel result delivery for %s without replaying the saved page',
    async (message) => {
      getHotelSearchSessionMock.mockResolvedValue({
        id: 'hotel-session-1', revision: 4,
        userId: 'whatsapp:+15550009999', whatsappUserId: 'whatsapp:+15550009999',
        stage: 'results', state: 'awaiting_hotel_selection',
        criteria: { location: 'Waskaduwa' }, results: [{ name: 'Hotel 1' }],
        latestDisplayedBatchIndex: 0, nextOffset: 1,
        updatedAt: '2026-10-26T20:40:00.000Z',
      });
      llmDecideMock.mockResolvedValueOnce({
        contractVersion: '2.0', responseText: 'No problem — I will pause these options for now.',
        intent: 'general_inquiry', intentConfidence: 0.96,
        ambiguity: { isAmbiguous: false, alternatives: [] }, clarificationRequired: false,
        parameters: {}, fieldUpdates: {}, memoryCandidates: [], missingFields: [],
        taskTransition: 'pause', proposedAction: { name: 'none', arguments: {} },
        unresolvedQuestions: [], suggestedAction: 'clarify', confidence: 0.96,
      });

      const reply = await processInboundMessage(buildTextMessage(message), `corr-pause-${message}`);

      expect(reply).toContain('pause these options');
      expect(llmDecideMock).toHaveBeenCalled();
      expect(pauseHotelOutboundMock).toHaveBeenCalledWith('whatsapp:+15550009999');
      expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
      expect(sendWhatsAppMessagesMock).not.toHaveBeenCalled();
    }
  );

  it('treats natural waiting messages as status checks for ready hotel results', async () => {
    const results = [
      { name: 'Hotel 1' },
      { name: 'Hotel 2' },
      { name: 'Hotel 3' },
      { name: 'Hotel 4' },
    ];
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Galle Fort' },
      results,
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });
    buildBrowseResultsPageReplyMock.mockReturnValue('First page replay');

    const reply = await processInboundMessage(
      buildTextMessage('how long will this take ?'),
      'corr-webhook-13'
    );

    expect(reply).toBe('First page replay');
    expect(buildBrowseResultsPageReplyMock).toHaveBeenCalledWith(
      { location: 'Galle Fort' },
      [{ name: 'Hotel 1' }, { name: 'Hotel 2' }, { name: 'Hotel 3' }],
      3,
      4
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  it('restores the latest submitted hotel form when resume has no active session', async () => {
    getHotelSearchSessionMock.mockResolvedValue(null);
    getLatestServiceRequestMock.mockResolvedValue({
      id: 'request-1',
      userId: 'whatsapp:+15550009999',
      type: 'hotel',
      form: {
        destination: 'Colombo',
        checkIn: '2026-06-12',
        checkOut: '2026-06-15',
        adults: 2,
        children: 1,
        rooms: 1,
        budget: 'USD 100 per night',
        mealPlan: 'Breakfast included',
      },
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    });

    const reply = await processInboundMessage(buildTextMessage('resume'), 'corr-webhook-14');

    expect(reply).toContain("I've gathered the following details");
    expect(reply).toContain('Destination: Colombo');
    expect(reply).toContain('Guests: 3');
    expect(saveAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        location: 'Colombo',
        checkinDate: '2026-06-12',
        checkoutDate: '2026-06-15',
        guests: 3,
        budgetPerNight: {
          amount: 100,
          currency: 'USD',
        },
      })
    );
    expect(handleMessageMock).not.toHaveBeenCalled();
  });

  it('greets with the saved preferred name after profile completion', async () => {
    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-webhook-7');

    expect(reply).toContain('Hi Sam, I am Yana');
    expect(reply).toContain('Thank you for the information');
  });

  it('treats hi as a greeting instead of reopening the latest hotel form', async () => {
    getLatestServiceRequestMock.mockResolvedValue({
      id: 'request-1',
      userId: 'whatsapp:+15550009999',
      type: 'hotel',
      form: {
        destination: 'Colombo',
        checkIn: '2026-06-12',
        checkOut: '2026-06-15',
        adults: 2,
        children: 0,
        rooms: 1,
        budget: 'USD 120 per night',
      },
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    });

    const reply = await processInboundMessage(buildTextMessage('hi'), 'corr-webhook-12');

    expect(reply).toContain('I am Yana');
    expect(reply).not.toContain("I've gathered the following details");
    expect(saveAwaitingPreferencesMock).not.toHaveBeenCalled();
  });

  it('does not let a greeting get hijacked by saved hotel results', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      stage: 'results',
      criteria: { location: 'Galle Fort' },
      results: [{ name: 'Hotel 1' }],
      nextOffset: 0,
      updatedAt: '2026-06-01T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('hi'), 'corr-webhook-10');

    expect(reply).toContain('I am Yana');
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('pauses active request state without deleting its durable session when the user restarts', async () => {
    const reply = await processInboundMessage(buildTextMessage('restart'), 'corr-webhook-11');

    expect(reply).toContain('paused your saved requests');
    expect(clearHotelSearchSessionMock).not.toHaveBeenCalled();
    expect(reply).toContain('I am Yana');
  });

  it('keeps a saved hotel sourcing request and selected property when reset pauses the journey', async () => {
    getHotelSearchSessionMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999', lifecycleStatus: 'active',
      stage: 'booking_provider_pending', state: 'booking_provider_pending',
      sourcingRequestId: 'saved-sourcing-request',
      selectedHotel: { selectedHotelSnapshot: { name: 'Selected Stay' } },
      updatedAt: '2026-10-27T10:00:00.000Z',
    });

    const reply = await processInboundMessage(buildTextMessage('reset'), 'corr-reset-keeps-sourcing-request');

    expect(reply).toContain('paused your saved requests');
    expect(pauseHotelOutboundMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(clearHotelSearchSessionMock).not.toHaveBeenCalled();
    expect(clearItineraryWorkspaceMock).not.toHaveBeenCalled();
  });

  it('does not revive a paused hotel form for a new travel statement after reset', async () => {
    const hotel = {
      userId: 'whatsapp:+15550009999', lifecycleStatus: 'active',
      stage: 'awaiting_preferences', state: 'hotel_form_sent',
      criteria: {}, results: [], nextOffset: 0,
      updatedAt: '2026-10-27T10:00:00.000Z',
    };
    getHotelSearchSessionMock.mockImplementation(async () => hotel);
    pauseHotelOutboundMock.mockImplementation(async () => { hotel.lifecycleStatus = 'paused'; });
    llmDecideMock.mockResolvedValue({ intent: 'search_hotels',
      parameters: { location: 'Sri Lanka', guests: 2 }, missingFields: [],
      suggestedAction: 'ask_missing', confidence: 0.95,
      proposedAction: { name: 'open_form', arguments: { schemaId: 'search_hotels' } },
      responseText: 'Please complete the hotel request form.' });

    await processInboundMessage(buildTextMessage('reset'), 'corr-reset-old-hotel-form');
    const reply = await processInboundMessage(
      buildTextMessage('I am coming to Sri Lanka with my wife'), 'corr-arrival-after-reset');

    expect(reply).toContain('help you plan your trip');
    expect(reply).not.toContain('/forms/hotel/');
    expect(reply).not.toContain('To avoid missing dates');
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('explicitly resumes the most recent paused journey without borrowing another flow', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      lifecycleStatus: 'paused', state: 'showing_itinerary', updatedAt: '2026-10-27T10:00:00.000Z',
    }));

    const reply = await processInboundMessage(buildTextMessage('resume'), 'corr-resume-paused-itinerary');

    expect(resumeItinerarySessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(reply).toContain('resumed your itinerary request');
    expect(reply).toContain('Your saved details are ready to continue.');
    expect(llmDecideMock).not.toHaveBeenCalled();
  });

  it.each([
    'I need a taxi.',
    'Book me an Uber.',
    'I need an airport transfer.',
    'I need a driver tomorrow.',
    'We need transport for six people.',
  ])('starts the transport form flow for logistics intent: %s', async (message) => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(buildTextMessage(message), 'corr-logistics-intent');

    expect(reply).toContain('quick transport request form');
    expect(reply).toContain('https://forms.yana.example/forms/logistics/');
    expect(saveTransportFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      message,
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('restores the latest submitted transport form and asks for extra requirements', async () => {
    getLatestServiceRequestMock.mockImplementation(async (_userId: string, type: string) =>
      type === 'logistics'
        ? {
            id: 'transport-request-1',
            userId: 'whatsapp:+15550009999',
            type: 'logistics',
            form: {
              pickupLocation: 'Colombo Fort',
              destination: 'Galle',
              pickupDate: '2026-07-10',
              pickupTime: '10:00',
              passengers: 4,
              vehicleType: 'SUV',
              luggage: 'Large',
            },
            createdAt: new Date('2026-06-01T10:00:00.000Z'),
          }
        : null
    );

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-logistics-form');

    expect(reply).toContain("I've gathered your transport details");
    expect(reply).toContain('Pickup: Colombo Fort');
    expect(reply).toContain('Destination: Galle');
    expect(saveLogisticsAwaitingPreferencesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ pickupLocation: 'Colombo Fort', destination: 'Galle' })
    );
  });

  it('acknowledges transport requirements immediately and searches in the background', async () => {
    getLogisticsSearchSessionMock.mockResolvedValue(buildLogisticsSession({
      stage: 'awaiting_preferences',
      state: 'awaiting_preferences',
      criteria: {
        pickupLocation: 'Colombo Fort',
        destination: 'Galle',
        pickupDate: '2026-07-10',
        pickupTime: '10:00',
        passengers: 4,
      },
    }));
    handleLogisticsProviderSearchMock.mockResolvedValue({
      status: 'provider_options',
      criteria: {},
      reply: 'Top 3 transport',
      options: [
        { id: '1', provider: 'Private Driver', vehicle: 'SUV', estimatedPrice: '$$', vehicleType: 'SUV', capacity: 5, luggageCapacity: 'Large', estimatedDuration: 'Confirm live route time' },
        { id: '2', provider: 'Airport Transfer', vehicle: 'Van', estimatedPrice: '$$$', vehicleType: 'Van', capacity: 7, luggageCapacity: 'Large', estimatedDuration: 'Confirm live route time' },
        { id: '3', provider: 'Local Transfer', vehicle: 'Comfort car', estimatedPrice: '$$', vehicleType: 'Comfort', capacity: 3, luggageCapacity: 'Medium', estimatedDuration: 'Confirm live route time' },
        { id: '4', provider: 'Private Chauffeur', vehicle: 'Luxury car', estimatedPrice: '$$$$', vehicleType: 'Luxury', capacity: 3, luggageCapacity: 'Medium', estimatedDuration: 'Confirm live route time' },
      ],
    });

    const reply = await processInboundMessage(
      buildTextMessage('English-speaking driver with multiple stops'),
      'corr-logistics-search'
    );

    expect(reply).toContain('searching the best transport matches');
    expect(saveLogisticsSearchingMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({
        pickupLocation: 'Colombo Fort',
        additionalPreferences: 'English-speaking driver with multiple stops',
      })
    );

    await vi.waitFor(() => {
      expect(handleLogisticsProviderSearchMock).toHaveBeenCalled();
    });
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('not live provider inventory or confirmed quotes') }),
        expect.objectContaining({ body: expect.stringContaining('Quote status:') }),
        expect.objectContaining({ body: expect.stringContaining('Request operator quote') }),
        expect.objectContaining({ body: expect.stringContaining('Why Yana picked it:') }),
      ]),
      { voice: undefined, from: 'whatsapp:+15550000000' }
    );
  });

  it('paginates saved transport suggestions', async () => {
    getLogisticsSearchSessionMock.mockResolvedValue(buildLogisticsSession({
      stage: 'results',
      state: 'awaiting_selection',
      criteria: { pickupLocation: 'Colombo', destination: 'Galle' },
      results: [
        { id: '1', provider: 'Provider 1', vehicle: 'SUV', estimatedPrice: '$$', vehicleType: 'SUV', capacity: 5, luggageCapacity: 'Large', estimatedDuration: '2h' },
        { id: '2', provider: 'Provider 2', vehicle: 'Van', estimatedPrice: '$$$', vehicleType: 'Van', capacity: 7, luggageCapacity: 'Large', estimatedDuration: '2h' },
        { id: '3', provider: 'Provider 3', vehicle: 'Car', estimatedPrice: '$$', vehicleType: 'Comfort', capacity: 3, luggageCapacity: 'Medium', estimatedDuration: '2h' },
        { id: '4', provider: 'Provider 4', vehicle: 'Luxury', estimatedPrice: '$$$$', vehicleType: 'Luxury', capacity: 3, luggageCapacity: 'Medium', estimatedDuration: '2h' },
      ],
      resultBatches: [
        [
          { id: '1', provider: 'Provider 1', vehicle: 'SUV', estimatedPrice: '$$', vehicleType: 'SUV', capacity: 5, luggageCapacity: 'Large', estimatedDuration: '2h' },
          { id: '2', provider: 'Provider 2', vehicle: 'Van', estimatedPrice: '$$$', vehicleType: 'Van', capacity: 7, luggageCapacity: 'Large', estimatedDuration: '2h' },
          { id: '3', provider: 'Provider 3', vehicle: 'Car', estimatedPrice: '$$', vehicleType: 'Comfort', capacity: 3, luggageCapacity: 'Medium', estimatedDuration: '2h' },
        ],
        [
          { id: '4', provider: 'Provider 4', vehicle: 'Luxury', estimatedPrice: '$$$$', vehicleType: 'Luxury', capacity: 3, luggageCapacity: 'Medium', estimatedDuration: '2h' },
        ],
      ],
      latestDisplayedBatchIndex: 0,
      nextOffset: 3,
    }));

    const reply = await processInboundMessage(buildTextMessage('next'), 'corr-logistics-next');

    expect(reply).toBe('🚗 Here are the next transport options.');
    expect(sendWhatsAppMessagesMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('🚗 *1. Provider 4*') }),
        expect.objectContaining({ body: expect.stringContaining('✨ Why Yana picked it:') }),
      ]),
      expect.objectContaining({ from: 'whatsapp:+15550000000' })
    );
    expect(saveLogisticsResultsMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      expect.objectContaining({ pickupLocation: 'Colombo' }),
      expect.any(Array),
      4
    );
  });

  it('opens the transport booking request form after selection', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    getLogisticsSearchSessionMock.mockResolvedValue(buildLogisticsSession({
      stage: 'results',
      state: 'awaiting_selection',
      latestDisplayedBatchIndex: 0,
    }));
    selectTransportOptionMock.mockResolvedValue({
      selectedOptionSnapshot: { id: '1', provider: 'Private Driver', vehicle: 'SUV' },
    });

    const reply = await processInboundMessage(buildTextMessage('book 1'), 'corr-logistics-book');

    expect(reply).toContain('short transport quote-request form');
    expect(reply).toContain('does not book a vehicle or confirm availability or price');
    expect(reply).toContain('https://forms.yana.example/forms/logistics_booking/');
    expect(selectTransportOptionMock).toHaveBeenCalledWith('whatsapp:+15550009999', 1);
  });

  it('keeps a submitted transport request at an honest operator-confirmation boundary', async () => {
    getLogisticsSearchSessionMock.mockResolvedValue(buildLogisticsSession({
      stage: 'provider_pending',
      state: 'provider_pending',
    }));

    const reply = await processInboundMessage(buildTextMessage('is my request ready'), 'corr-logistics-pending');

    expect(reply).toContain('transport quote request is prepared');
    expect(reply).toContain('No vehicle, availability, or price is confirmed');
    expect(reply).toContain('operator must review it');
  });

  it('clears transport state on reset', async () => {
    getLogisticsSearchSessionMock.mockResolvedValue(buildLogisticsSession({
      stage: 'results',
      state: 'awaiting_selection',
    }));

    const reply = await processInboundMessage(buildTextMessage('reset'), 'corr-logistics-reset');

    expect(reply).toContain('paused your saved requests');
    expect(clearLogisticsSearchSessionMock).not.toHaveBeenCalled();
    expect(pauseLogisticsSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
  });

  it('transcribes a transport voice note and starts transport flow', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
    transcribeMock.mockResolvedValue({
      transcript: 'I need an airport transfer',
      contentType: 'audio/ogg',
      bytes: 2048,
      model: 'transcription-test-model',
    });

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-logistics-voice');

    expect(result.reply).toContain('quick transport request form');
    expect(saveTransportFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'I need an airport transfer',
      expect.objectContaining({ preferredName: 'Sam' })
    );
  });
});

function buildTextMessage(body: string): InboundMessage {
  return {
    messageId: 'SMwebhook001',
    from: 'whatsapp:+15550009999',
    to: 'whatsapp:+15550000000',
    timestamp: new Date('2026-05-21T00:00:00.000Z'),
    type: 'text',
    content: {
      type: 'text',
      body,
    },
    metadata: {
      rawPayload: {
        ProfileName: 'Test Traveler',
      },
    },
  };
}

function buildExcursionSession(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'whatsapp:+15550009999',
    whatsappUserId: 'whatsapp:+15550009999',
    stage: 'awaiting_preferences',
    state: 'awaiting_preferences',
    criteria: {},
    normalizedCriteria: {},
    resultBatches: [],
    results: [],
    latestDisplayedBatchIndex: -1,
    nextOffset: 0,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    expiresAt: '2026-06-02T10:00:00.000Z',
    ...overrides,
  };
}

function buildLogisticsSession(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'whatsapp:+15550009999',
    whatsappUserId: 'whatsapp:+15550009999',
    stage: 'awaiting_preferences',
    state: 'awaiting_preferences',
    criteria: {},
    normalizedCriteria: {},
    resultBatches: [],
    results: [],
    latestDisplayedBatchIndex: -1,
    nextOffset: 0,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    expiresAt: '2026-06-02T10:00:00.000Z',
    ...overrides,
  };
}

function buildItinerarySession(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'whatsapp:+15550009999',
    whatsappUserId: 'whatsapp:+15550009999',
    state: 'awaiting_preferences',
    criteria: {},
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    expiresAt: '2026-06-08T10:00:00.000Z',
    ...overrides,
  };
}

function buildGeneratedItinerary() {
  return {
    overview: '7 day itinerary around Sri Lanka',
    mapSummary: 'Colombo -> Kandy -> Ella -> Galle',
    budgetEstimate: 'Comfort style across 7 days',
    weatherNotes: 'Check weather close to travel dates.',
    orchestration: {
      hotels: [],
      restaurants: [],
      excursions: [],
      logistics: [],
    },
    days: [
      {
        day: 1,
        date: '2026-07-12',
        location: 'Colombo',
        morning: 'Arrive and transfer to Colombo.',
        afternoon: 'Light city orientation.',
        evening: 'Dinner near hotel.',
        hotel: 'Comfort stay in Colombo',
        restaurantSuggestions: ['Breakfast near Colombo', 'Lunch near Fort', 'Dinner in Colombo'],
        experiences: ['Local culture', 'Food Experiences'],
        transport: 'Private Driver',
        estimatedTravelTime: 'Airport transfer timing to confirm',
        approximateCost: 'Comfort day estimate',
      },
      {
        day: 2,
        date: '2026-07-13',
        location: 'Kandy',
        morning: 'Travel to Kandy.',
        afternoon: 'Temple and lake walk.',
        evening: 'Dinner in Kandy.',
        hotel: 'Boutique stay in Kandy',
        restaurantSuggestions: ['Breakfast near hotel', 'Lunch in Kandy', 'Dinner in Kandy'],
        experiences: ['Historical Sites', 'Temples'],
        transport: 'Private Driver',
        estimatedTravelTime: '2-3 hours',
        approximateCost: 'Comfort day estimate',
      },
    ],
  };
}

function buildAudioPayload(mediaUrl = 'https://api.twilio.com/audio.ogg') {
  return {
    MessageSid: 'SMvoice001',
    From: 'whatsapp:+15550009999',
    To: 'whatsapp:+15550000000',
    NumMedia: '1',
    MediaUrl0: mediaUrl,
    MediaContentType0: 'audio/ogg; codecs=opus',
    ProfileName: 'Test Traveler',
  };
}

function expectNoInternalPresentationTerms(reply: string): void {
  for (const term of [
    'search_hotels',
    'general_inquiry',
    'ASK_MISSING_FIELDS',
    'EXECUTE_SEARCH',
    'confidence',
    'travelDates',
  ]) {
    expect(reply).not.toContain(term);
  }
}
