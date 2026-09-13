import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InboundMessage } from '../types/core.js';

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
const getProfileMock = vi.fn();
const getHotelSearchSessionMock = vi.fn();
const saveProfileRequiredMock = vi.fn();
const saveHotelFormSentMock = vi.fn();
const saveAwaitingPreferencesMock = vi.fn();
const saveSearchingMock = vi.fn();
const saveResultsMock = vi.fn();
const selectHotelMock = vi.fn();
const markHandoffConsentPendingMock = vi.fn();
const saveRecheckReceiptMock = vi.fn();
const issueRecheckReceiptMock = vi.fn();
const clearHandoffConsentPendingMock = vi.fn();
const requestHotelHandoffMock = vi.fn();
const clearHotelSearchSessionMock = vi.fn();
const getRestaurantSearchSessionMock = vi.fn();
const saveRestaurantFormSentMock = vi.fn();
const saveRestaurantAwaitingPreferencesMock = vi.fn();
const saveRestaurantSearchingMock = vi.fn();
const saveRestaurantResultsMock = vi.fn();
const selectRestaurantMock = vi.fn();
const clearRestaurantSearchSessionMock = vi.fn();
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
const handleLogisticsProviderSearchMock = vi.fn();
const buildLogisticsOptionsPageReplyMock = vi.fn();
const getItinerarySessionMock = vi.fn();
const saveItineraryFormSentMock = vi.fn();
const saveItineraryAwaitingPreferencesMock = vi.fn();
const saveItineraryPlanningMock = vi.fn();
const saveItineraryMock = vi.fn();
const saveItineraryEditingMock = vi.fn();
const setItineraryCurrentDayMock = vi.fn();
const clearItinerarySessionMock = vi.fn();
const planItineraryMock = vi.fn();
const sendWhatsAppTextMock = vi.fn();
const sendWhatsAppReplyMock = vi.fn();
const sendWhatsAppMessagesMock = vi.fn();
const twilioOutboundConfiguredMock = vi.fn();
const llmDecideMock = vi.fn();
const generateUIContentMock = vi.fn();
const transcribeMock = vi.fn();

vi.mock('../services/HotelIntakeService.js', () => ({
  getHotelIntakeService: () => ({
    handleMessage: handleMessageMock,
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
    get: getHotelSearchSessionMock,
    saveProfileRequired: saveProfileRequiredMock,
    saveHotelFormSent: saveHotelFormSentMock,
    saveAwaitingPreferences: saveAwaitingPreferencesMock,
    saveSearching: saveSearchingMock,
    saveResults: saveResultsMock,
    selectHotel: selectHotelMock,
    markHandoffConsentPending: markHandoffConsentPendingMock,
    saveRecheckReceipt: saveRecheckReceiptMock,
    clearHandoffConsentPending: clearHandoffConsentPendingMock,
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
    get: getRestaurantSearchSessionMock,
    saveRestaurantFormSent: saveRestaurantFormSentMock,
    saveAwaitingPreferences: saveRestaurantAwaitingPreferencesMock,
    saveSearching: saveRestaurantSearchingMock,
    saveResults: saveRestaurantResultsMock,
    selectRestaurant: selectRestaurantMock,
    clear: clearRestaurantSearchSessionMock,
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
    get: getExcursionSearchSessionMock,
    saveExcursionFormSent: saveExcursionFormSentMock,
    saveAwaitingPreferences: saveExcursionAwaitingPreferencesMock,
    saveSearching: saveExcursionSearchingMock,
    saveResults: saveExcursionResultsMock,
    selectExperience: selectExperienceMock,
    saveProviderPending: saveProviderPendingMock,
    clear: clearExcursionSearchSessionMock,
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
    get: getLogisticsSearchSessionMock,
    saveTransportFormSent: saveTransportFormSentMock,
    saveAwaitingPreferences: saveLogisticsAwaitingPreferencesMock,
    saveSearching: saveLogisticsSearchingMock,
    saveResults: saveLogisticsResultsMock,
    selectOption: selectTransportOptionMock,
    saveProviderPending: saveLogisticsProviderPendingMock,
    clear: clearLogisticsSearchSessionMock,
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
    get: getItinerarySessionMock,
    saveFormSent: saveItineraryFormSentMock,
    saveAwaitingPreferences: saveItineraryAwaitingPreferencesMock,
    savePlanning: saveItineraryPlanningMock,
    saveItinerary: saveItineraryMock,
    saveEditing: saveItineraryEditingMock,
    setCurrentDay: setItineraryCurrentDayMock,
    clear: clearItinerarySessionMock,
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
    getProfile: getProfileMock,
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
import { processInboundMessage, processWebhookPayload } from './webhook.js';

describe('webhook hotel search flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileGateCheckMock.mockResolvedValue({ complete: true });
    consumeProfileGateRequestMock.mockResolvedValue(null);
    getLatestServiceRequestMock.mockResolvedValue(null);
    getProfileMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      form: {
        preferredName: 'Sam',
      },
    });
    getHotelSearchSessionMock.mockResolvedValue(null);
    getRestaurantSearchSessionMock.mockResolvedValue(null);
    getExcursionSearchSessionMock.mockResolvedValue(null);
    getLogisticsSearchSessionMock.mockResolvedValue(null);
    getItinerarySessionMock.mockResolvedValue(null);
    saveProfileRequiredMock.mockResolvedValue(undefined);
    saveHotelFormSentMock.mockResolvedValue(undefined);
    saveRestaurantFormSentMock.mockResolvedValue(undefined);
    saveRestaurantAwaitingPreferencesMock.mockResolvedValue(undefined);
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
    clearRestaurantSearchSessionMock.mockResolvedValue(undefined);
    clearExcursionSearchSessionMock.mockResolvedValue(undefined);
    clearLogisticsSearchSessionMock.mockResolvedValue(undefined);
    clearItinerarySessionMock.mockResolvedValue(undefined);
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
    generateUIContentMock.mockImplementation(async (prompt: string) => {
      const fallback = prompt.match(/Deterministic fallback style reference: ([\s\S]*)$/);
      return fallback?.[1]?.trim() || 'I can help with your trip. What would you like to organize first?';
    });
  });

  it('delegates completed hotel intake to the hotel search flow', async () => {
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
    handleCompletedIntakeMock.mockResolvedValue({
      status: 'provider_not_connected',
      criteria,
      reply: 'Provider not connected reply',
    });

    const reply = await processInboundMessage(buildTextMessage('USD 120 per night'), 'corr-webhook-1');

    expect(reply).toBe('Provider not connected reply');
    expect(handleCompletedIntakeMock).toHaveBeenCalledWith(
      criteria,
      expect.objectContaining({
        correlationId: 'corr-webhook-1',
        sessionId: 'whatsapp:+15550009999',
        userLanguage: 'en',
      })
    );
  });

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
    expect(llmDecideMock).not.toHaveBeenCalled();
  });

  it('sends a fresh hotel form link instead of a dead-end already-sent message', async () => {
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

    expect(reply).toContain('fresh hotel form link');
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(reply).not.toContain("I've already sent the hotel form");
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
  ])('starts the restaurant form flow for dining intent: %s', async (message) => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(buildTextMessage(message), 'corr-restaurant-intent');

    expect(reply).toContain('quick dining request form');
    expect(reply).toContain('https://forms.yana.example/forms/restaurant/');
    expect(saveRestaurantFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      message,
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
  });

  it('lets a fresh restaurant request override an old itinerary session', async () => {
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

    const reply = await processInboundMessage(
      buildTextMessage('I am looking for a restaurant, not a hotel'),
      'corr-restaurant-overrides-itinerary'
    );

    expect(reply).toContain('quick dining request form');
    expect(reply).toContain('https://forms.yana.example/forms/restaurant/');
    expect(clearItinerarySessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(saveRestaurantFormSentMock).toHaveBeenCalled();
    expect(saveItineraryEditingMock).not.toHaveBeenCalled();
  });

  it('lets a fresh hotel request override an old itinerary session', async () => {
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

    const reply = await processInboundMessage(
      buildTextMessage('can you help me find a hotel in kandy'),
      'corr-hotel-overrides-itinerary'
    );

    expect(reply).toContain("I'll start a fresh hotel search");
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(clearItinerarySessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(saveHotelFormSentMock).toHaveBeenCalled();
    expect(saveItineraryEditingMock).not.toHaveBeenCalled();
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

    expect(reply).toContain("I've selected Sea View Grill");
    expect(reply).toContain('check table availability');
    expect(reply).toContain('reservation provider');
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

    expect(reply).toContain('cleared the active request');
    expect(clearRestaurantSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
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
    expect(result.reply).toContain('quick dining request form');
    expect(saveRestaurantFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      "I'm hungry",
      expect.objectContaining({ preferredName: 'Sam' })
    );
  });

  it.each([
    'I want to visit historic places.',
    "We're looking for adventure.",
    "I'd like to go surfing.",
    'I want a safari.',
    'What are the best things to do in Kandy?',
  ])('starts the excursion form flow for activity intent: %s', async (message) => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';

    const reply = await processInboundMessage(buildTextMessage(message), 'corr-excursion-intent');

    expect(reply).toContain('quick excursion request form');
    expect(reply).toContain('https://forms.yana.example/forms/excursion/');
    expect(saveExcursionFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      message,
      expect.objectContaining({ preferredName: 'Sam' })
    );
    expect(saveHotelFormSentMock).not.toHaveBeenCalled();
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

    expect(reply).toContain('cleared the active request');
    expect(clearExcursionSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
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
    expect(result.reply).toContain('quick excursion request form');
    expect(saveExcursionFormSentMock).toHaveBeenCalledWith(
      'whatsapp:+15550009999',
      'I want a safari',
      expect.objectContaining({ preferredName: 'Sam' })
    );
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

  it('regenerates itinerary incrementally for edit requests', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'showing_itinerary',
      itinerary: buildGeneratedItinerary(),
      criteria: { arrivalAirport: 'Colombo', additionalPreferences: 'avoid long drives' },
    }));

    const reply = await processInboundMessage(buildTextMessage('more beach time'), 'corr-itinerary-edit');

    expect(reply).toContain('prepared your itinerary');
    expect(planItineraryMock).toHaveBeenCalledWith(
      expect.objectContaining({ additionalPreferences: 'avoid long drives; more beach time' })
    );
    expect(saveItineraryEditingMock).toHaveBeenCalled();
  });

  it('clears itinerary state on reset', async () => {
    getItinerarySessionMock.mockResolvedValue(buildItinerarySession({
      state: 'showing_itinerary',
      itinerary: buildGeneratedItinerary(),
    }));

    const reply = await processInboundMessage(buildTextMessage('reset'), 'corr-itinerary-reset');

    expect(reply).toContain('cleared the active request');
    expect(clearItinerarySessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
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

  it('resumes the saved hotel request by collecting the hotel-specific form', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
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
    consumeProfileGateRequestMock.mockResolvedValue({
      userId: 'whatsapp:+15550009999',
      messageText: 'Find a hotel in Galle',
      messageId: 'SMpending001',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    handleMessageMock.mockResolvedValue({
      handled: true,
      completed: false,
      reply: 'When would you like to check in?',
    });

    const reply = await processInboundMessage(buildTextMessage('done'), 'corr-webhook-3');

    expect(reply).toContain('Hi Sam, I am Yana');
    expect(reply).toContain('Please complete this quick hotel request form');
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
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
        results: [{ name: 'Hotel 1' }, { name: 'Hotel 2' }, { name: 'Hotel 3' }, { name: 'Hotel 4' }],
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
        { voice: undefined, from: 'whatsapp:+15550000000' }
      );
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

  it('starts a new hotel search when a hotel request arrives during old results', async () => {
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

    expect(reply).toContain('start a fresh hotel search');
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
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

    expect(reply).toContain('start a fresh hotel search');
    expect(reply).toContain('https://forms.yana.example/forms/hotel/');
    expect(llmDecideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'actually lets do Kandy instead',
        sessionState: expect.objectContaining({
          currentIntent: 'hotel_search',
          activeSchema: 'search_hotels',
        }),
      })
    );
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(buildBrowseResultsPageReplyMock).not.toHaveBeenCalled();
  });

  it('does not expose internal intent or field names when asking for missing details', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'search_hotels',
      parameters: {},
      missingFields: ['destination', 'travelDates'],
      suggestedAction: 'ask_missing',
      confidence: 0.82,
    });

    const reply = await processInboundMessage(buildTextMessage('help me plan'), 'corr-webhook-style-1');

    expect(reply).toContain('hotel search');
    expect(reply).toContain('where you would like to go');
    expect(reply).toContain('your travel dates');
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

  it('uses the ConversationManager capabilities template for general inquiry', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
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

    expect(reply).toContain('hotels, transport, restaurants, excursions');
    expect(reply).toContain('What would you like to organize first?');
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('execute_tool');
  });

  it('uses the ConversationManager low-confidence fallback template', async () => {
    handleMessageMock.mockResolvedValue({ handled: false });
    llmDecideMock.mockResolvedValue({
      intent: 'unclear',
      parameters: {},
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.32,
    });

    const reply = await processInboundMessage(buildTextMessage('hmm maybe'), 'corr-webhook-style-4');

    expect(reply).toContain('are you looking for help with accommodation');
    expect(reply).toContain('transport, food, activities, or a full itinerary');
    expectNoInternalPresentationTerms(reply);
    expect(reply).not.toContain('unclear');
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
    expect(reply).toContain('book 1');
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

  it('clears active request state when the user asks to restart', async () => {
    const reply = await processInboundMessage(buildTextMessage('restart'), 'corr-webhook-11');

    expect(reply).toContain('cleared the active request');
    expect(clearHotelSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
    expect(reply).toContain('I am Yana');
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

    expect(reply).toContain('cleared the active request');
    expect(clearLogisticsSearchSessionMock).toHaveBeenCalledWith('whatsapp:+15550009999');
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
