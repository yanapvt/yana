import { createHash } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { pool } from '../db/connection.js';

export interface TextToSpeechAsset {
  mediaUrl: string;
  contentType: string;
  audioData: Buffer;
}

interface SynthesisOptions {
  voiceNote?: boolean;
}

export class TextToSpeechService {
  private client: TextToSpeechClient | null = null;

  async synthesize(text: string, options: SynthesisOptions = {}): Promise<TextToSpeechAsset | null> {
    if (!isTextToSpeechEnabled() || !text.trim()) {
      return null;
    }

    const languageCode = process.env.TTS_LANGUAGE || 'en-US';
    const modelName = process.env.TTS_MODEL?.trim() || undefined;
    const isGemini = Boolean(modelName?.startsWith('gemini-'));
    const voiceName = process.env.TTS_VOICE || (isGemini ? 'Aoede' : 'en-US-Chirp3-HD-Aoede');
    const audioEncoding = options.voiceNote ? 'OGG_OPUS' : process.env.TTS_AUDIO_ENCODING || 'MP3';
    if (audioEncoding !== 'MP3' && audioEncoding !== 'OGG_OPUS') {
      throw new Error('TTS_AUDIO_ENCODING must be MP3 or OGG_OPUS');
    }
    const spokenText = normalizeTextForSpeech(text);
    const prompt = isGemini ? buildGeminiVoicePrompt(spokenText) : '';
    const extension = audioEncoding === 'OGG_OPUS' ? 'ogg' : 'mp3';
    const contentType = audioEncoding === 'OGG_OPUS' ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
    const hash = createHash('sha256')
      .update([spokenText, languageCode, voiceName, modelName ?? '', audioEncoding, prompt].join('\0'))
      .digest('hex');
    const mediaUrl = `${getPublicBaseUrl()}/media/tts/${hash}.${extension}`;
    const filePath = getTtsFilePath(hash, extension);

    if (await fileExists(filePath)) {
      await markAssetAccessed(hash).catch(() => undefined);
      return { mediaUrl, contentType, audioData: await readFile(filePath) };
    }

    const [response] = await this.getClient().synthesizeSpeech({
      input: isGemini ? { text: spokenText, prompt } : { text: spokenText },
      voice: {
        languageCode,
        name: voiceName,
        ...(isGemini ? { modelName } : {}),
      },
      audioConfig: {
        audioEncoding: audioEncoding as 'MP3' | 'OGG_OPUS',
      },
    });

    if (!response.audioContent) {
      return null;
    }

    const audio =
      typeof response.audioContent === 'string'
        ? Buffer.from(response.audioContent, 'base64')
        : Buffer.from(response.audioContent);

    await mkdir(join(process.cwd(), 'tmp', 'tts'), { recursive: true });
    await writeFile(filePath, audio);
    await saveAsset(hash, text, languageCode, mediaUrl, audioEncoding.toLowerCase()).catch(() => undefined);

    return { mediaUrl, contentType, audioData: audio };
  }

  async readAudio(hash: string, extension: 'mp3' | 'ogg' = 'mp3'): Promise<Buffer | null> {
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      return null;
    }

    const filePath = getTtsFilePath(hash, extension);
    if (!await fileExists(filePath)) {
      return null;
    }

    await markAssetAccessed(hash).catch(() => undefined);
    return readFile(filePath);
  }

  private getClient(): TextToSpeechClient {
    if (!this.client) {
      this.client = new TextToSpeechClient();
    }

    return this.client;
  }
}

let textToSpeechServiceInstance: TextToSpeechService | null = null;

export function getTextToSpeechService(): TextToSpeechService {
  if (!textToSpeechServiceInstance) {
    textToSpeechServiceInstance = new TextToSpeechService();
  }

  return textToSpeechServiceInstance;
}

export function initTextToSpeechService(
  service = new TextToSpeechService()
): TextToSpeechService {
  textToSpeechServiceInstance = service;
  return service;
}

export function isTextToSpeechEnabled(): boolean {
  return (
    process.env.TTS_ENABLED === 'true' &&
    process.env.FEATURE_TTS_ENABLED === 'true' &&
    process.env.TTS_RESPONSE_TO_VOICE === 'true'
  );
}

function normalizeTextForSpeech(text: string): string {
  return text
    .replace(/^I heard: ["“][^"”]+["”]\s*/i, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function buildGeminiVoicePrompt(text: string): string {
  const isCasual = /\b(hungry|dinner|lunch|breakfast|restaurant|food|meal)\b/i.test(text);
  return [
    'Speak as Yana, a warm, relaxed female travel concierge. Sound like a real person chatting with a friend: natural rhythm, an easygoing smile in your voice, and a slightly brisk pace. Keep pauses brief and begin speaking promptly.',
    isCasual
      ? 'A tiny, genuine amused chuckle is welcome if it fits naturally. Do not force laughter or repeat it.'
      : 'Keep the delivery sincere; do not add laughter to serious or practical information.',
    'Say only the supplied answer. Do not invent booking confirmations, prices, or availability.',
  ].join(' ');
}

function getTtsFilePath(hash: string, extension: 'mp3' | 'ogg'): string {
  return join(process.cwd(), 'tmp', 'tts', `${hash}.${extension}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getPublicBaseUrl(): string {
  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL ||
    process.env.FORM_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`;

  return publicBaseUrl.replace(/\/$/, '');
}

async function saveAsset(
  hash: string,
  text: string,
  language: string,
  audioUrl: string,
  audioFormat: string
): Promise<void> {
  await pool.query(
    `INSERT INTO tts_assets (text_hash, original_text, language, audio_url, audio_format, provider_name, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (text_hash)
     DO UPDATE SET audio_url = EXCLUDED.audio_url, last_accessed_at = NOW()`,
    [
      hash,
      text,
      language,
      audioUrl,
      audioFormat,
      'google',
      {
        voice: process.env.TTS_VOICE || 'en-US-Chirp3-HD-Aoede',
      },
    ]
  );
}

async function markAssetAccessed(hash: string): Promise<void> {
  await pool.query('UPDATE tts_assets SET last_accessed_at = NOW() WHERE text_hash = $1', [hash]);
}
