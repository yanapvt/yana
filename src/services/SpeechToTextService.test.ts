import { describe, expect, it } from 'vitest';
import {
  isSupportedVoiceContentType,
  SpeechToTextService,
} from './SpeechToTextService.js';

describe('SpeechToTextService', () => {
  it('recognizes WhatsApp voice note content types', () => {
    expect(isSupportedVoiceContentType('audio/ogg; codecs=opus')).toBe(true);
    expect(isSupportedVoiceContentType('application/ogg')).toBe(true);
    expect(isSupportedVoiceContentType('image/jpeg')).toBe(false);
  });

  it('throws a config error when OpenAI transcription is not configured', async () => {
    const service = new SpeechToTextService({
      openAiApiKey: '',
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
});
