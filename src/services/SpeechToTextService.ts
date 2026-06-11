import { env } from '../config/environment.js';

export interface SpeechToTextInput {
  mediaUrl: string;
  contentType?: string;
  messageSid: string;
  userId: string;
}

export interface SpeechToTextResult {
  transcript: string;
  contentType: string;
  bytes: number;
  model: string;
}

export class SpeechToTextServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'missing_api_key'
      | 'missing_twilio_credentials'
      | 'unsupported_media_type'
      | 'media_too_large'
      | 'download_failed'
      | 'transcription_failed',
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'SpeechToTextServiceError';
  }
}

interface SpeechToTextServiceConfig {
  openAiApiKey?: string;
  transcriptionModel?: string;
  maxBytes?: number;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  openAiBaseUrl?: string;
}

interface DownloadedAudio {
  bytes: ArrayBuffer;
  contentType: string;
}

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

export class SpeechToTextService {
  private readonly openAiApiKey: string;
  private readonly transcriptionModel: string;
  private readonly maxBytes: number;
  private readonly twilioAccountSid: string;
  private readonly twilioAuthToken: string;
  private readonly openAiBaseUrl: string;

  constructor(config: SpeechToTextServiceConfig = {}) {
    const configuredOpenAiApiKey =
      config.openAiApiKey ?? env.voice.openAiApiKey ?? env.llm.apiKey ?? '';
    this.openAiApiKey = configuredOpenAiApiKey === 'dev_api_key' ? '' : configuredOpenAiApiKey;
    this.transcriptionModel =
      config.transcriptionModel ??
      env.voice.transcriptionModel ??
      DEFAULT_TRANSCRIPTION_MODEL;
    this.maxBytes = config.maxBytes ?? Math.floor(env.voice.maxMb * 1024 * 1024);
    this.twilioAccountSid = config.twilioAccountSid ?? env.twilio.accountSid;
    this.twilioAuthToken = config.twilioAuthToken ?? env.twilio.authToken;
    this.openAiBaseUrl = config.openAiBaseUrl ?? 'https://api.openai.com/v1';
  }

  async transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult> {
    if (!this.openAiApiKey) {
      throw new SpeechToTextServiceError(
        'OPENAI_API_KEY is required for voice-note transcription',
        'missing_api_key'
      );
    }

    if (
      !this.twilioAccountSid ||
      !this.twilioAuthToken ||
      this.twilioAccountSid === 'dev_account_sid' ||
      this.twilioAuthToken === 'dev_auth_token'
    ) {
      throw new SpeechToTextServiceError(
        'Real Twilio Account SID/Auth Token are required to download voice media',
        'missing_twilio_credentials'
      );
    }

    if (!isSupportedVoiceContentType(input.contentType)) {
      throw new SpeechToTextServiceError(
        `Unsupported voice media type: ${input.contentType || 'unknown'}`,
        'unsupported_media_type'
      );
    }

    const audio = await this.downloadAudio(input.mediaUrl, input.contentType);
    const transcript = await this.transcribeWithOpenAi(audio, input.messageSid);

    return {
      transcript,
      contentType: audio.contentType,
      bytes: audio.bytes.byteLength,
      model: this.transcriptionModel,
    };
  }

  private async downloadAudio(mediaUrl: string, expectedContentType?: string): Promise<DownloadedAudio> {
    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.twilioAccountSid}:${this.twilioAuthToken}`
        ).toString('base64')}`,
      },
    });

    if (!response.ok) {
      throw new SpeechToTextServiceError(
        `Failed to download Twilio media: ${response.status}`,
        'download_failed',
        response.status >= 500
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > this.maxBytes) {
      throw new SpeechToTextServiceError('Voice note is too large', 'media_too_large');
    }

    const contentType = response.headers.get('content-type') ?? expectedContentType ?? '';
    if (!isSupportedVoiceContentType(contentType)) {
      throw new SpeechToTextServiceError(
        `Unsupported downloaded media type: ${contentType || 'unknown'}`,
        'unsupported_media_type'
      );
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > this.maxBytes) {
      throw new SpeechToTextServiceError('Voice note is too large', 'media_too_large');
    }

    return { bytes, contentType };
  }

  private async transcribeWithOpenAi(audio: DownloadedAudio, messageSid: string): Promise<string> {
    const formData = new FormData();
    formData.append('model', this.transcriptionModel);
    formData.append('response_format', 'json');
    formData.append(
      'file',
      new Blob([audio.bytes], { type: audio.contentType }),
      `${messageSid}.${extensionForContentType(audio.contentType)}`
    );

    const response = await fetch(`${this.openAiBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openAiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new SpeechToTextServiceError(
        `OpenAI transcription failed with ${response.status}: ${await response.text()}`,
        'transcription_failed',
        response.status >= 500 || response.status === 429
      );
    }

    const data = (await response.json()) as { text?: unknown };
    const transcript = typeof data.text === 'string' ? data.text.trim() : '';
    if (!transcript) {
      throw new SpeechToTextServiceError('OpenAI returned an empty transcript', 'transcription_failed');
    }

    return transcript;
  }
}

export function isSupportedVoiceContentType(contentType?: string): boolean {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase().split(';')[0].trim();
  return (
    normalized.startsWith('audio/') ||
    normalized === 'application/ogg' ||
    normalized === 'application/opus' ||
    normalized.includes('ogg') ||
    normalized.includes('opus')
  );
}

function extensionForContentType(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('mpeg') || normalized.includes('mp3')) {
    return 'mp3';
  }
  if (normalized.includes('mp4') || normalized.includes('m4a')) {
    return 'm4a';
  }
  if (normalized.includes('wav')) {
    return 'wav';
  }
  if (normalized.includes('webm')) {
    return 'webm';
  }
  return 'ogg';
}

let speechToTextServiceInstance: SpeechToTextService | null = null;

export function getSpeechToTextService(): SpeechToTextService {
  if (!speechToTextServiceInstance) {
    speechToTextServiceInstance = new SpeechToTextService();
  }

  return speechToTextServiceInstance;
}

export function initSpeechToTextService(
  service = new SpeechToTextService()
): SpeechToTextService {
  speechToTextServiceInstance = service;
  return service;
}
