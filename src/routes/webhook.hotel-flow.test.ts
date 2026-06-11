import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InboundMessage } from '../types/core.js';

const handleMessageMock = vi.fn();
const handleCompletedIntakeMock = vi.fn();
const handleBrowseSearchMock = vi.fn();
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
const clearHotelSearchSessionMock = vi.fn();
const sendWhatsAppTextMock = vi.fn();
const twilioOutboundConfiguredMock = vi.fn();
const llmDecideMock = vi.fn();
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
    clear: clearHotelSearchSessionMock,
  }),
}));

vi.mock('../services/twilioOutboundService.js', () => ({
  getTwilioOutboundService: () => ({
    sendWhatsAppText: sendWhatsAppTextMock,
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
    saveProfileRequiredMock.mockResolvedValue(undefined);
    saveHotelFormSentMock.mockResolvedValue(undefined);
    saveSearchingMock.mockResolvedValue(undefined);
    saveResultsMock.mockResolvedValue(undefined);
    selectHotelMock.mockResolvedValue(null);
    clearHotelSearchSessionMock.mockResolvedValue(undefined);
    sendWhatsAppTextMock.mockResolvedValue(true);
    twilioOutboundConfiguredMock.mockReturnValue(true);
    buildBrowseResultsPageReplyMock.mockReturnValue('Next page reply');
    transcribeMock.mockResolvedValue({
      transcript: 'hello',
      contentType: 'audio/ogg',
      bytes: 1234,
      model: 'gpt-4o-mini-transcribe',
    });
    llmDecideMock.mockResolvedValue({
      intent: 'unknown',
      parameters: {},
      missingFields: [],
      suggestedAction: 'clarify',
      confidence: 0.3,
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

  it('resumes the saved hotel request by collecting the hotel-specific form', async () => {
    process.env.FORM_PUBLIC_BASE_URL = 'https://forms.yana.example';
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

    expect(reply).toContain('Just a moment while I check');
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
      expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
        'whatsapp:+15550009999',
        'Top 3 Google Places hotels'
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

    expect(reply).toBe('Next page reply');
    expect(buildBrowseResultsPageReplyMock).toHaveBeenCalledWith(
      { location: 'Galle Fort' },
      [{ name: 'Hotel 4' }, { name: 'Hotel 5' }, { name: 'Hotel 6' }],
      6,
      6
    );
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
      model: 'gpt-4o-mini-transcribe',
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
      model: 'gpt-4o-mini-transcribe',
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
    expect(result.reply).toContain('Next page reply');
    expect(buildBrowseResultsPageReplyMock).toHaveBeenCalledWith(
      { location: 'Galle Fort' },
      [{ name: 'Hotel 4' }, { name: 'Hotel 5' }, { name: 'Hotel 6' }],
      6,
      6
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
      new SpeechToTextServiceError('OPENAI_API_KEY is required', 'missing_api_key')
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-26');

    expect(result.reply).toContain('transcription is not configured yet');
    expect(result.reply).toContain('OPENAI_API_KEY');
  });

  it('returns a Twilio setup error when voice media cannot be downloaded without real credentials', async () => {
    transcribeMock.mockRejectedValue(
      new SpeechToTextServiceError('Twilio credentials are required', 'missing_twilio_credentials')
    );

    const result = await processWebhookPayload(buildAudioPayload(), 'corr-webhook-27');

    expect(result.reply).toContain('cannot download WhatsApp audio');
    expect(result.reply).toContain('TWILIO_ACCOUNT_SID');
    expect(result.reply).toContain('TWILIO_AUTH_TOKEN');
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

  it('saves hotel selection and opens the booking provider boundary', async () => {
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
    expect(reply).toContain("I've selected Hotel 1");
    expect(reply).toContain('Hotelbeds or LiteAPI');
    expect(reply).not.toContain('confirmed availability');
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
