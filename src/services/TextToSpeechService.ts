import { createHash } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { pool } from '../db/connection.js';

export interface TextToSpeechAsset {
  mediaUrl: string;
  contentType: string;
}

export class TextToSpeechService {
  private client: TextToSpeechClient | null = null;

  async synthesize(text: string): Promise<TextToSpeechAsset | null> {
    if (!isTextToSpeechEnabled() || !text.trim()) {
      return null;
    }

    const languageCode = process.env.TTS_LANGUAGE || 'en-US';
    const voiceName = process.env.TTS_VOICE || 'en-US-Chirp3-HD-Aoede';
    const audioEncoding = process.env.TTS_AUDIO_ENCODING || 'MP3';
    const hash = createHash('sha256')
      .update([text, languageCode, voiceName, audioEncoding].join('\0'))
      .digest('hex');
    const mediaUrl = `${getPublicBaseUrl()}/media/tts/${hash}.mp3`;
    const filePath = getTtsFilePath(hash);

    if (await fileExists(filePath)) {
      await markAssetAccessed(hash);
      return { mediaUrl, contentType: 'audio/mpeg' };
    }

    const cached = await getCachedAsset(hash);
    if (cached && await fileExists(filePath)) {
      return { mediaUrl: cached.audioUrl, contentType: 'audio/mpeg' };
    }

    const [response] = await this.getClient().synthesizeSpeech({
      input: { text: normalizeTextForSpeech(text) },
      voice: {
        languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: audioEncoding as 'MP3',
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
    await saveAsset(hash, text, languageCode, mediaUrl, audioEncoding.toLowerCase());

    return { mediaUrl, contentType: 'audio/mpeg' };
  }

  async readAudio(hash: string): Promise<Buffer | null> {
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      return null;
    }

    const filePath = getTtsFilePath(hash);
    if (!await fileExists(filePath)) {
      return null;
    }

    await markAssetAccessed(hash);
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
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function getTtsFilePath(hash: string): string {
  return join(process.cwd(), 'tmp', 'tts', `${hash}.mp3`);
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

async function getCachedAsset(
  hash: string
): Promise<{ audioUrl: string } | null> {
  const result = await pool.query<{ audio_url: string }>(
    'SELECT audio_url FROM tts_assets WHERE text_hash = $1',
    [hash]
  );

  if (result.rowCount === 0) {
    return null;
  }

  await markAssetAccessed(hash);
  return { audioUrl: result.rows[0].audio_url };
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
