import type { InboundMessage, MessageContent } from '../types/core.js';

export interface MetaWhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: MetaWhatsAppChangeValue;
    }>;
  }>;
  [key: string]: unknown;
}

interface MetaWhatsAppChangeValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    wa_id?: string;
    profile?: {
      name?: string;
    };
  }>;
  messages?: MetaWhatsAppMessage[];
  statuses?: unknown[];
}

interface MetaWhatsAppMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
  audio?: MetaMediaObject;
  image?: MetaMediaObject & { caption?: string };
  video?: MetaMediaObject & { caption?: string };
  document?: MetaMediaObject & { caption?: string; filename?: string };
  interactive?: {
    type?: string;
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
    };
  };
  button?: {
    text?: string;
    payload?: string;
  };
  [key: string]: unknown;
}

interface MetaMediaObject {
  id?: string;
  mime_type?: string;
  sha256?: string;
}

export interface MetaNormalizeOptions {
  mediaUrlForId?: (mediaId: string) => string;
}

export function normalizeMetaWhatsAppInboundMessage(
  payload: MetaWhatsAppWebhookPayload,
  options: MetaNormalizeOptions = {}
): InboundMessage {
  const value = getFirstChangeValue(payload);
  const message = value?.messages?.[0] ?? {};
  const from = toWhatsAppAddress(message.from || value?.contacts?.[0]?.wa_id || 'meta:unknown');
  const to = toWhatsAppAddress(value?.metadata?.display_phone_number || value?.metadata?.phone_number_id || 'meta:yana');
  const content = extractMetaMessageContent(message, options);

  return {
    messageId: message.id || `meta-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    from,
    to,
    timestamp: getMetaTimestamp(message.timestamp),
    type:
      content.type === 'text'
        ? 'text'
        : content.type === 'audio'
          ? 'audio'
          : content.type === 'interactive'
            ? 'interactive'
            : 'media',
    inputType: content.type === 'audio' ? 'voice' : content.type,
    content,
    metadata: {
      provider: 'meta',
      rawPayload: payload,
      phoneNumberId: value?.metadata?.phone_number_id,
      profileName: value?.contacts?.[0]?.profile?.name,
    },
  };
}

export function isMetaStatusWebhook(payload: MetaWhatsAppWebhookPayload): boolean {
  const value = getFirstChangeValue(payload);
  return Boolean(value?.statuses?.length && !value.messages?.length);
}

function getFirstChangeValue(payload: MetaWhatsAppWebhookPayload): MetaWhatsAppChangeValue | undefined {
  return payload.entry?.flatMap((entry) => entry.changes ?? [])[0]?.value;
}

function extractMetaMessageContent(
  message: MetaWhatsAppMessage,
  options: MetaNormalizeOptions
): MessageContent {
  if (message.interactive?.button_reply?.id) {
    return {
      type: 'interactive',
      interactionType: 'button_reply',
      selectedId: message.interactive.button_reply.id,
      selectedTitle: message.interactive.button_reply.title,
    };
  }

  if (message.interactive?.list_reply?.id) {
    return {
      type: 'interactive',
      interactionType: 'list_reply',
      selectedId: message.interactive.list_reply.id,
      selectedTitle: message.interactive.list_reply.title,
    };
  }

  if (message.button?.payload || message.button?.text) {
    return {
      type: 'interactive',
      interactionType: 'button_reply',
      selectedId: message.button.payload || message.button.text || '',
      selectedTitle: message.button.text,
    };
  }

  if (message.text?.body?.trim()) {
    return {
      type: 'text',
      body: message.text.body,
    };
  }

  const audio = message.audio;
  if (audio?.id) {
    return {
      type: 'audio',
      audioUrl: options.mediaUrlForId?.(audio.id) ?? audio.id,
      contentType: audio.mime_type,
    };
  }

  const image = message.image;
  if (image?.id) {
    return {
      type: 'media',
      mediaType: 'image',
      mediaUrl: options.mediaUrlForId?.(image.id) ?? image.id,
      caption: image.caption,
    };
  }

  const video = message.video;
  if (video?.id) {
    return {
      type: 'media',
      mediaType: 'video',
      mediaUrl: options.mediaUrlForId?.(video.id) ?? video.id,
      caption: video.caption,
    };
  }

  const document = message.document;
  if (document?.id) {
    return {
      type: 'media',
      mediaType: 'document',
      mediaUrl: options.mediaUrlForId?.(document.id) ?? document.id,
      caption: document.caption,
    };
  }

  return {
    type: 'text',
    body: '',
  };
}

function getMetaTimestamp(value?: string): Date {
  if (value?.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Date(numeric * 1000);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function toWhatsAppAddress(value: string): string {
  if (value.startsWith('whatsapp:') || value.startsWith('meta:')) {
    return value;
  }

  const digits = value.replace(/[^\d+]/g, '');
  if (digits) {
    return `whatsapp:${digits.startsWith('+') ? digits : `+${digits}`}`;
  }

  return `meta:${value}`;
}
