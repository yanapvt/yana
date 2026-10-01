import { env } from '../config/environment.js';
import { getTextToSpeechService } from './TextToSpeechService.js';
import { splitWhatsAppText, type WhatsAppOutboundMessage } from './twilioOutboundService.js';
import { toOpenWaChatId } from '../utils/openWaMessageNormalizer.js';

interface SendOpenWaOptions {
  voice?: boolean;
  from?: string;
}

interface OpenWaOutboundConfig { baseUrl?: string; apiKey?: string; sessionId?: string }
interface OpenWaLogger { warn(message: string, details?: Record<string, unknown>): void; error(message: string, details?: Record<string, unknown>): void }

const OPENWA_TEXT_LIMIT = 3500;
const OPENWA_MEDIA_CAPTION_LIMIT = 1024;
const OPENWA_SEND_GAP_MS = 350;

export class OpenWaOutboundService {
  constructor(
    private readonly config: OpenWaOutboundConfig = env.openwa,
    private readonly fetcher: typeof fetch = fetch,
    private readonly logger: OpenWaLogger = console,
    private readonly pause: (milliseconds: number) => Promise<void> = delay
  ) {}
  async sendWhatsAppText(to: string, body: string): Promise<boolean> {
    let sentAny = false;
    for (const part of splitWhatsAppText(body, OPENWA_TEXT_LIMIT)) {
      const sent = await this.sendTextMessage(to, part);
      sentAny = sentAny || sent;
    }
    return sentAny;
  }

  async sendWhatsAppMessages(
    to: string,
    messages: WhatsAppOutboundMessage[],
    options: SendOpenWaOptions = {}
  ): Promise<boolean> {
    if (messages.length === 0) {
      return false;
    }

    let sentAny = false;
    for (const [index, message] of messages.entries()) {
      if (index > 0) {
        await this.pause(OPENWA_SEND_GAP_MS);
      }
      const sent =
        message.mediaUrl && isPublicHttpsUrl(message.mediaUrl)
          ? await this.sendImageCardWithTextFallback(to, message.mediaUrl, message.body)
          : await this.sendWhatsAppText(to, message.body);
      sentAny = sentAny || sent;
    }

    if (options.voice) {
      const voiceText = messages.map((message) => message.body).join('\n\n');
      sentAny = (await this.sendVoiceReply(to, voiceText)) || sentAny;
    }

    return sentAny;
  }

  async sendWhatsAppReply(
    to: string,
    body: string,
    options: SendOpenWaOptions = {}
  ): Promise<boolean> {
    const textSent = await this.sendWhatsAppText(to, body);

    if (!options.voice) {
      return textSent;
    }

    return (await this.sendVoiceReply(to, body)) || textSent;
  }

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.sessionId);
  }

  private async sendTextMessage(to: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[OpenWaOutboundService] OpenWA outbound is not configured; skipping message');
      return false;
    }

    let response: Response;
    try {
      response = await this.fetcher(this.buildUrl('/messages/send-text'), {
        method: 'POST', headers: this.headers(),
        body: JSON.stringify({ chatId: toOpenWaChatId(to), text }),
      });
    } catch {
      this.logger.error('openwa_send_failed', { category: 'connection', retryAttempted: false });
      return false;
    }

    if (!response.ok) {
      this.logger.error('openwa_send_failed', { category: 'http', status: response.status, retryAttempted: false });
      return false;
    }

    return true;
  }

  private async sendImageMessage(to: string, mediaUrl: string, caption: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[OpenWaOutboundService] OpenWA outbound is not configured; skipping image');
      return false;
    }

    const captionParts = splitWhatsAppText(caption, OPENWA_MEDIA_CAPTION_LIMIT);
    const response = await this.fetcher(this.buildUrl('/messages/send-image'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        chatId: toOpenWaChatId(to),
        url: mediaUrl,
        caption: captionParts[0] || '',
      }),
    });

    if (!response.ok) {
      this.logger.error('openwa_image_send_failed', { category: 'http', status: response.status, retryAttempted: false });
      return false;
    }

    let sentAny = true;
    for (const extraCaptionPart of captionParts.slice(1)) {
      sentAny = (await this.sendWhatsAppText(to, extraCaptionPart)) || sentAny;
    }

    return sentAny;
  }

  private async sendImageCardWithTextFallback(
    to: string,
    mediaUrl: string,
    caption: string
  ): Promise<boolean> {
    let imageSent = false;
    try {
      imageSent = await this.sendImageMessage(to, mediaUrl, extractCardTitle(caption));
    } catch {
      this.logger.error('openwa_image_send_failed', {
        category: 'connection',
        retryAttempted: false,
      });
    }

    // OpenWA can acknowledge an image URL before WhatsApp has actually fetched
    // it. Always follow the image with the complete text card so local testing
    // cannot stop at the carousel intro after a silent downstream media failure.
    await this.pause(OPENWA_SEND_GAP_MS);
    const textSent = await this.sendWhatsAppText(to, caption);
    return imageSent || textSent;
  }

  private async sendVoiceReply(to: string, text: string): Promise<boolean> {
    try {
      const audio = await getTextToSpeechService().synthesize(text);
      if (!audio?.mediaUrl) {
        return false;
      }

      console.warn(
        `[OpenWaOutboundService] Voice media generated but OpenWA media send is not wired yet: ${audio.mediaUrl}`
      );
      return false;
    } catch (error) {
      console.error('[OpenWaOutboundService] TTS failed after text message was sent:', error);
      return false;
    }
  }

  private buildUrl(path: string): string {
    const baseUrl = this.config.baseUrl?.replace(/\/$/, '');
    const sessionId = encodeURIComponent(this.config.sessionId || '');
    return `${baseUrl}/api/sessions/${sessionId}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey || '',
    };
  }
}

function isPublicHttpsUrl(value?: string): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

function extractCardTitle(caption: string): string {
  return caption.split('\n').find((line) => line.trim().length > 0)?.trim().slice(0, OPENWA_MEDIA_CAPTION_LIMIT) || 'Yana recommendation';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let openWaOutboundServiceInstance: OpenWaOutboundService | null = null;

export function getOpenWaOutboundService(): OpenWaOutboundService {
  if (!openWaOutboundServiceInstance) {
    openWaOutboundServiceInstance = new OpenWaOutboundService();
  }

  return openWaOutboundServiceInstance;
}

export function initOpenWaOutboundService(
  service = new OpenWaOutboundService()
): OpenWaOutboundService {
  openWaOutboundServiceInstance = service;
  return service;
}
