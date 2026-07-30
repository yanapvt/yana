import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSupportedVoiceContentType,
  SpeechToTextService,
} from './SpeechToTextService.js';

describe('SpeechToTextService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('recognizes WhatsApp voice note content types', () => {
    expect(isSupportedVoiceContentType('audio/ogg; codecs=opus')).toBe(true);
    expect(isSupportedVoiceContentType('application/ogg')).toBe(true);
    expect(isSupportedVoiceContentType('image/jpeg')).toBe(false);
  });

  it('throws a config error when transcription is not configured', async () => {
    const service = new SpeechToTextService({
      apiKey: '',
      transcriptionModel: 'whisper-test',
      twilioAccountSid: 'AC_real_for_test',
      twilioAuthToken: 'auth_real_for_test',
    });

    await expect(
      service.transcribe({
        mediaUrl: 'https://api.twilio.com/audio.ogg',
        contentType: 'audio/ogg',
        messageSid: 'SMvoice001',
        userId: 'whatsapp:+15550009999',
      })
    ).rejects.toMatchObject({
      code: 'missing_api_key',
    });
  });

  it('uses the configured provider base URL and API key for transcription', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          'content-type': 'audio/ogg',
          'content-length': '4',
        }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'hello from voice' }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new SpeechToTextService({
      provider: 'groq',
      apiKey: 'gsk_test_key',
      transcriptionModel: 'whisper-test',
      baseUrl: 'https://api.groq.com/openai/v1',
      twilioAccountSid: 'AC_real_for_test',
      twilioAuthToken: 'auth_real_for_test',
    });

    const result = await service.transcribe({
      mediaUrl: 'https://api.twilio.com/audio.ogg',
      contentType: 'audio/ogg',
      messageSid: 'SMvoice001',
      userId: 'whatsapp:+15550009999',
    });

    expect(result).toMatchObject({
      transcript: 'hello from voice',
      model: 'whisper-test',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk_test_key',
        }),
      })
    );
  });

  it('transcribes embedded OpenWA voice media without Twilio media credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'openwa voice works' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new SpeechToTextService({
      provider: 'groq',
      apiKey: 'gsk_test_key',
      transcriptionModel: 'whisper-test',
      baseUrl: 'https://api.groq.com/openai/v1',
      twilioAccountSid: 'dev_account_sid',
      twilioAuthToken: 'dev_auth_token',
    });

    const result = await service.transcribe({
      mediaUrl: `data:audio/ogg;base64,${Buffer.from('voice bytes').toString('base64')}`,
      contentType: 'audio/ogg',
      messageSid: 'openwa-voice-1',
      userId: 'whatsapp:+94777269221',
    });

    expect(result.transcript).toBe('openwa voice works');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk_test_key',
        }),
      })
    );
  });
});
