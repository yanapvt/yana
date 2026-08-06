import { env } from '../config/environment.js';
import { getTextToSpeechService } from './TextToSpeechService.js';
import { splitWhatsAppText, type WhatsAppOutboundMessage } from './twilioOutboundService.js';

interface SendMetaOptions {
  voice?: boolean;
  from?: string;
}

const META_TEXT_LIMIT = 3500;
const META_CAPTION_LIMIT = 1024;

export class MetaWhatsAppOutboundService {
  async sendWhatsAppText(to: string, body: string): Promise<boolean> {
    let sentAny = false;
    for (const part of splitWhatsAppText(body, META_TEXT_LIMIT)) {
      const sent = await this.sendTextMessage(to, part);
      sentAny = sentAny || sent;
    }
    return sentAny;
  }

  async sendWhatsAppMessages(
    to: string,
    messages: WhatsAppOutboundMessage[],
    options: SendMetaOptions = {}
  ): Promise<boolean> {
    if (messages.length === 0) {
      return false;
    }

    let sentAny = false;
    for (const message of messages) {
      const sent =
        message.mediaUrl && isPublicHttpsUrl(message.mediaUrl)
          ? await this.sendImageWithTextFallback(to, message.mediaUrl, message.body)
          : await this.sendWhatsAppText(to, message.body);
      sentAny = sentAny || sent;
    }

    if (options.voice) {
      const voiceText = messages.map((message) => message.body).join('\n\n');
      sentAny = (await this.sendVoiceReply(to, voiceText)) || sentAny;
    }

    return sentAny;
  }

  async sendWhatsAppReply(to: string, body: string, options: SendMetaOptions = {}): Promise<boolean> {
    const textSent = await this.sendWhatsAppText(to, body);

    if (!options.voice) {
      return textSent;
    }

    return (await this.sendVoiceReply(to, body)) || textSent;
  }

  isConfigured(): boolean {
    return Boolean(env.meta.accessToken && env.meta.phoneNumberId);
  }

  private async sendTextMessage(to: string, text: string): Promise<boolean> {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toMetaRecipient(to),
      type: 'text',
      text: {
        preview_url: true,
        body: text,
      },
    });
  }

  private async sendImageWithTextFallback(
    to: string,
    mediaUrl: string,
    caption: string
  ): Promise<boolean> {
    const captionParts = splitWhatsAppText(caption, META_CAPTION_LIMIT);
    const imageSent = await this.sendMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toMetaRecipient(to),
      type: 'image',
      image: {
        link: mediaUrl,
        caption: captionParts[0] || undefined,
      },
    });

    if (imageSent) {
      let sentAny = true;
      for (const extraCaptionPart of captionParts.slice(1)) {
        sentAny = (await this.sendWhatsAppText(to, extraCaptionPart)) || sentAny;
      }
      return sentAny;
    }

    return this.sendWhatsAppText(to, caption);
  }

  private async sendVoiceReply(to: string, text: string): Promise<boolean> {
    try {
      const audio = await getTextToSpeechService().synthesize(text);
      if (!audio?.mediaUrl) {
        return false;
      }

      return this.sendMessage({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toMetaRecipient(to),
        type: 'audio',
        audio: {
          link: audio.mediaUrl,
        },
      });
    } catch (error) {
      console.error('[MetaWhatsAppOutboundService] TTS failed after text message was sent:', error);
      return false;
    }
  }

  private async sendMessage(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[MetaWhatsAppOutboundService] Meta WhatsApp is not configured; skipping message');
      return false;
    }

    const response = await fetch(
      `${this.graphBaseUrl()}/${encodeURIComponent(env.meta.phoneNumberId || '')}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.meta.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.error(
        `[MetaWhatsAppOutboundService] Failed to send WhatsApp message: ${response.status} ${await response.text()}`
      );
      return false;
    }

    return true;
  }

  private graphBaseUrl(): string {
    return `https://graph.facebook.com/${env.meta.apiVersion}`;
  }
}

function toMetaRecipient(value: string): string {
  return value.replace(/^whatsapp:/, '').replace(/[^\d]/g, '');
}

function isPublicHttpsUrl(value?: string): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

let metaWhatsAppOutboundServiceInstance: MetaWhatsAppOutboundService | null = null;

export function getMetaWhatsAppOutboundService(): MetaWhatsAppOutboundService {
  if (!metaWhatsAppOutboundServiceInstance) {
    metaWhatsAppOutboundServiceInstance = new MetaWhatsAppOutboundService();
  }

  return metaWhatsAppOutboundServiceInstance;
}

export function initMetaWhatsAppOutboundService(
  service = new MetaWhatsAppOutboundService()
): MetaWhatsAppOutboundService {
  metaWhatsAppOutboundServiceInstance = service;
  return service;
}
