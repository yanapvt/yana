import { env } from '../config/environment.js';
import { getTextToSpeechService } from './TextToSpeechService.js';
import { splitWhatsAppText, type WhatsAppOutboundMessage } from './twilioOutboundService.js';
import { toOpenWaChatId } from '../utils/openWaMessageNormalizer.js';

interface SendOpenWaOptions {
  voice?: boolean;
  from?: string;
}

const OPENWA_TEXT_LIMIT = 3500;
const OPENWA_MEDIA_CAPTION_LIMIT = 1024;

export class OpenWaOutboundService {
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
    for (const message of messages) {
      const sent =
        message.mediaUrl && isPublicHttpsUrl(message.mediaUrl)
          ? await this.sendImageMessage(to, message.mediaUrl, message.body)
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
    return Boolean(env.openwa.baseUrl && env.openwa.apiKey && env.openwa.sessionId);
  }

  private async sendTextMessage(to: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[OpenWaOutboundService] OpenWA outbound is not configured; skipping message');
      return false;
    }

    const response = await fetch(this.buildUrl('/messages/send-text'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        chatId: toOpenWaChatId(to),
        text,
      }),
    });

    if (!response.ok) {
      console.error(
        `[OpenWaOutboundService] Failed to send WhatsApp text: ${response.status} ${await response.text()}`
      );
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
    const response = await fetch(this.buildUrl('/messages/send-image'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        chatId: toOpenWaChatId(to),
        url: mediaUrl,
        caption: captionParts[0] || '',
      }),
    });

    if (!response.ok) {
      console.error(
        `[OpenWaOutboundService] Failed to send WhatsApp image: ${response.status} ${await response.text()}`
      );
      return false;
    }

    let sentAny = true;
    for (const extraCaptionPart of captionParts.slice(1)) {
      sentAny = (await this.sendWhatsAppText(to, extraCaptionPart)) || sentAny;
    }

    return sentAny;
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
    const baseUrl = env.openwa.baseUrl?.replace(/\/$/, '');
    const sessionId = encodeURIComponent(env.openwa.sessionId || '');
    return `${baseUrl}/api/sessions/${sessionId}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': env.openwa.apiKey || '',
    };
  }
}

function isPublicHttpsUrl(value?: string): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
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
