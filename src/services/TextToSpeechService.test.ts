import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { synthesizeSpeech, stat, writeFile, query } = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: class { synthesizeSpeech = synthesizeSpeech; },
}));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  stat,
  writeFile,
}));
vi.mock('../db/connection.js', () => ({ pool: { query } }));

import { TextToSpeechService } from './TextToSpeechService.js';

describe('TextToSpeechService', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TTS_ENABLED = 'true';
    process.env.FEATURE_TTS_ENABLED = 'true';
    process.env.TTS_RESPONSE_TO_VOICE = 'true';
    process.env.TTS_MODEL = 'gemini-2.5-flash-tts';
    process.env.TTS_VOICE = 'Aoede';
    process.env.TTS_LANGUAGE = 'en-US';
    process.env.PUBLIC_BASE_URL = 'https://yana.example';
    stat.mockRejectedValue(new Error('not cached'));
    query.mockResolvedValue({ rowCount: 1, rows: [] });
    writeFile.mockResolvedValue(undefined);
    synthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.from('ogg audio') }]);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('generates an expressive female Ogg/Opus voice note without narrating the transcript', async () => {
    const result = await new TextToSpeechService().synthesize(
      'I heard: "I am hungry. I need dinner."\n\nI can help with dinner. Which area are you in?',
      { voiceNote: true }
    );

    expect(result).toMatchObject({
      contentType: 'audio/ogg; codecs=opus',
      audioData: Buffer.from('ogg audio'),
    });
    expect(result?.mediaUrl).toMatch(/^https:\/\/yana\.example\/media\/tts\/[a-f0-9]{64}\.ogg$/);
    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        text: 'I can help with dinner. Which area are you in?',
        prompt: expect.stringContaining('tiny, genuine amused chuckle'),
      }),
      voice: { languageCode: 'en-US', name: 'Aoede', modelName: 'gemini-2.5-flash-tts' },
      audioConfig: { audioEncoding: 'OGG_OPUS' },
    }));
    expect(synthesizeSpeech.mock.calls[0][0].input.prompt).toContain('slightly brisk pace');
  });

  it('keeps laughter out of practical replies', async () => {
    await new TextToSpeechService().synthesize('Your booking request has been received.', { voiceNote: true });
    expect(synthesizeSpeech.mock.calls[0][0].input.prompt).toContain('do not add laughter');
  });

  it('does not synthesize when voice replies are disabled', async () => {
    process.env.TTS_RESPONSE_TO_VOICE = 'false';
    expect(await new TextToSpeechService().synthesize('Hello', { voiceNote: true })).toBeNull();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });
});
