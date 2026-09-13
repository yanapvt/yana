import { env } from '../config/environment.js';
import { getTextToSpeechService } from './TextToSpeechService.js';
import { splitWhatsAppText, type WhatsAppOutboundMessage } from './twilioOutboundService.js';

interface SendMetaOptions {
  voice?: boolean;
  from?: string;
}

const META_TEXT_LIMIT = 3500;
const META_CAPTION_LIMIT = 1024;
const META_CAROUSEL_MIN_CARDS = 2;
const META_CAROUSEL_MAX_CARDS = 10;
const META_CAROUSEL_CARD_BODY_LIMIT = 159;
const META_CAROUSEL_BODY_LIMIT = 1024;

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

    const carouselSent = await this.trySendCarouselMessage(to, messages);
    if (carouselSent) {
      if (options.voice) {
        const voiceText = messages.map((message) => message.body).join('\n\n');
        return (await this.sendVoiceReply(to, voiceText)) || carouselSent;
      }

      return true;
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

  private async trySendCarouselMessage(
    to: string,
    messages: WhatsAppOutboundMessage[]
  ): Promise<boolean> {
    const [intro, ...cards] = messages;
    const carouselCards = cards.filter((message) => isPublicHttpsUrl(message.mediaUrl));
    const canUseCarousel =
      Boolean(intro?.body) &&
      carouselCards.length === cards.length &&
      carouselCards.length >= META_CAROUSEL_MIN_CARDS &&
      carouselCards.length <= META_CAROUSEL_MAX_CARDS;

    if (!canUseCarousel) {
      return false;
    }

    const response = await this.sendMessage(
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toMetaRecipient(to),
        type: 'interactive',
        interactive: {
          type: 'carousel',
          body: {
            text: truncateText(intro.body, META_CAROUSEL_BODY_LIMIT),
          },
          action: {
            cards: carouselCards.map((message, index) => {
              const displayNumber = index + 1;
              const isQuoteRequest = /request operator quote/i.test(message.body);
              const isStayRequest = /request this stay/i.test(message.body);
              return {
                type: 'button',
                card_index: index,
                header: {
                  type: 'image',
                  image: {
                    link: message.mediaUrl,
                  },
                },
                body: {
                  text: buildCarouselCardBody(message.body),
                },
                action: {
                  buttons: [
                    {
                      type: 'quick_reply',
                      quick_reply: {
                        id: `book ${displayNumber}`,
                        title: isQuoteRequest ? 'Request Quote' : isStayRequest ? 'Request Stay' : 'Book Now',
                      },
                    },
                    {
                      type: 'quick_reply',
                      quick_reply: {
                        id: `details ${displayNumber}`,
                        title: 'Details',
                      },
                    },
                  ],
                },
              };
            }),
          },
        },
      },
      'carousel'
    );

    if (!response) {
      console.warn('[MetaWhatsAppOutboundService] Carousel send failed; falling back to regular messages');
    }

    return response;
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

  private async sendMessage(
    payload: Record<string, unknown>,
    label = 'message'
  ): Promise<boolean> {
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
        `[MetaWhatsAppOutboundService] Failed to send WhatsApp ${label}: ${response.status} ${await response.text()}`
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

function buildCarouselCardBody(body: string): string {
  const cleanedLines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Smart view:/i.test(stripEmoji(line)))
    .filter((line) => !/^View on Google Maps:/i.test(stripEmoji(line)))
    .filter((line) => !/^Map:/i.test(stripEmoji(line)))
    .filter((line) => !/^Book now:/i.test(stripEmoji(line)))
    .filter((line) => !/^More info:/i.test(stripEmoji(line)));

  const title = cleanedLines.find((line) => /^\d+\.\s*/.test(stripEmoji(line)));
  const rating = extractField(cleanedLines, 'Rating');
  const price =
    extractField(cleanedLines, 'Returned total') ??
    extractField(cleanedLines, 'Price signal') ??
    extractField(cleanedLines, 'Price level') ??
    extractField(cleanedLines, 'Estimated price');
  const quoteStatus = extractField(cleanedLines, 'Quote status');
  const requestStatus = extractField(cleanedLines, 'Status');
  const category = extractField(cleanedLines, 'Category');
  const room = extractField(cleanedLines, 'Room');
  const mealPlan = extractField(cleanedLines, 'Meal plan');
  const cancellation = extractField(cleanedLines, 'Cancellation');
  const registration = extractField(cleanedLines, 'Sri Lanka Tourism registration');
  const cuisine = extractField(cleanedLines, 'Cuisine');
  const vehicle = extractField(cleanedLines, 'Vehicle');
  const capacity = extractField(cleanedLines, 'Capacity') ?? extractField(cleanedLines, 'Suggested capacity');
  const duration = extractField(cleanedLines, 'Estimated duration') ?? extractField(cleanedLines, 'Duration status');
  const location = extractField(cleanedLines, 'Location') ?? extractField(cleanedLines, 'Address');
  const reason = extractField(cleanedLines, 'Why Yana picked it');

  const compactLines = [
    title ? truncateText(stripEmoji(title), 42) : undefined,
    requestStatus ? truncateText(requestStatus, 54) : undefined,
    rating ? `Rating ${truncateText(rating, 30)}` : undefined,
    price ? `Price ${truncateText(price, 24)}` : undefined,
    quoteStatus ? `Quote ${truncateText(quoteStatus, 42)}` : undefined,
    room ? `Room ${truncateText(room, 30)}` : undefined,
    mealPlan ? truncateText(mealPlan, 24) : undefined,
    cancellation ? truncateText(cancellation, 20) : undefined,
    registration ? `Registered ${truncateText(registration, 28)}` : undefined,
    vehicle ? truncateText(vehicle, 34) : undefined,
    capacity ? `Capacity ${truncateText(capacity, 18)}` : undefined,
    duration ? truncateText(duration, 30) : undefined,
    category ? truncateText(category, 32) : cuisine ? truncateText(cuisine, 32) : undefined,
    location ? truncateText(compactLocation(location), 34) : undefined,
    reason ? truncateText(compactReason(reason), 42) : undefined,
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0);

  return truncateText(compactLines.join('\n'), META_CAROUSEL_CARD_BODY_LIMIT);
}

function extractField(lines: string[], label: string): string | undefined {
  const pattern = new RegExp(`^${escapeRegExp(label)}\\s*:\\s*(.+)$`, 'i');
  for (const line of lines) {
    const match = stripEmoji(line).match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function compactLocation(value: string): string {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 2) {
    return value;
  }

  return parts.slice(0, 2).join(', ');
}

function compactReason(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('rating') || lower.includes('review')) {
    return 'Strong reviews + location';
  }
  if (lower.includes('cuisine') || lower.includes('dining')) {
    return 'Matches your dining style';
  }
  if (lower.includes('experience') || lower.includes('destination')) {
    return 'Matches your trip style';
  }
  if (lower.includes('capacity') || lower.includes('luggage') || lower.includes('journey')) {
    return 'Fits guests + luggage';
  }
  return value;
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function stripEmoji(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
