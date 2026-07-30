import type { InboundMessage, MessageContent } from '../types/core.js';

export interface OpenWaWebhookPayload {
  event?: string;
  type?: string;
  sessionId?: string;
  session?: string | { id?: string; name?: string };
  data?: OpenWaMessagePayload;
  message?: OpenWaMessagePayload;
  payload?: OpenWaMessagePayload;
  [key: string]: unknown;
}

interface OpenWaMessagePayload {
  id?: string | { id?: string; _serialized?: string };
  messageId?: string;
  from?: string;
  to?: string;
  sender?: string | { id?: string; pushname?: string };
  recipient?: string;
  chatId?: string;
  fromMe?: boolean;
  body?: string;
  text?: string;
  caption?: string;
  type?: string;
  mimetype?: string;
  mimeType?: string;
  mediaUrl?: string;
  url?: string;
  media?: {
    mimetype?: string;
    mimeType?: string;
    data?: string;
    omitted?: boolean;
    filename?: string;
  };
  timestamp?: number | string;
  direction?: string;
  payload?: OpenWaMessagePayload;
  message?: OpenWaMessagePayload;
  [key: string]: unknown;
}

export function normalizeOpenWaInboundMessage(
  payload: OpenWaWebhookPayload
): InboundMessage {
  const message = extractOpenWaMessage(payload);
  const messageId = getOpenWaMessageId(message, payload);
  const from = toWhatsAppAddress(
    getString(message.from) ||
      getSenderId(message.sender) ||
      getString(message.chatId) ||
      'openwa:unknown'
  );
  const to = toWhatsAppAddress(
    getString(message.to) ||
      getString(message.recipient) ||
      getOpenWaSessionId(payload) ||
      'openwa:yana'
  );
  const content = extractOpenWaMessageContent(message);
  const messageType = getString(message.type) || '';
  const isVoiceEnvelope = getMediaType('', messageType) === 'audio';

  return {
    messageId,
    from,
    to,
    timestamp: getOpenWaTimestamp(message.timestamp),
    type:
      content.type === 'text'
        ? 'text'
        : content.type === 'audio'
          ? 'audio'
          : content.type === 'interactive'
            ? 'interactive'
            : 'media',
    inputType: content.type === 'audio' || isVoiceEnvelope ? 'voice' : content.type,
    content,
    metadata: {
      provider: 'openwa',
      rawPayload: payload,
      sessionId: getOpenWaSessionId(payload),
    },
  };
}

export function isOpenWaOutboundEcho(payload: OpenWaWebhookPayload): boolean {
  const message = extractOpenWaMessage(payload);
  if (message.fromMe === true) {
    return true;
  }

  const event = `${getString(payload.event) || ''} ${getString(payload.type) || ''}`.toLowerCase();
  if (/\b(message[._:-]?(sent|ack)|outgoing|sent)\b/.test(event)) {
    return true;
  }

  const direction = (
    getString(message.direction) ||
    getString(payload.direction) ||
    ''
  ).toLowerCase();

  return ['out', 'outgoing', 'sent'].includes(direction);
}

export function toOpenWaChatId(value: string): string {
  const stripped = value.replace(/^whatsapp:/, '').trim();
  if (stripped.endsWith('@c.us') || stripped.endsWith('@g.us') || stripped.endsWith('@lid')) {
    return stripped;
  }

  const digits = stripped.replace(/[^\d]/g, '');
  return digits ? `${digits}@c.us` : stripped;
}

function extractOpenWaMessage(payload: OpenWaWebhookPayload): OpenWaMessagePayload {
  const dataPayload =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as OpenWaMessagePayload).payload
      : undefined;
  const dataMessage =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as OpenWaMessagePayload).message
      : undefined;
  const candidates = [dataPayload, dataMessage, payload.data, payload.message, payload.payload, payload];
  return (
    candidates.find((candidate): candidate is OpenWaMessagePayload =>
      Boolean(candidate && typeof candidate === 'object')
    ) ?? {}
  );
}

function extractOpenWaMessageContent(message: OpenWaMessagePayload): MessageContent {
  const body = getString(message.body) || getString(message.text);
  const mediaUrl = getString(message.mediaUrl) || getString(message.url);
  const mimeType =
    getString(message.mimetype) ||
    getString(message.mimeType) ||
    getString(message.media?.mimetype) ||
    getString(message.media?.mimeType) ||
    '';
  const messageType = getString(message.type) || '';
  const embeddedMediaData = getString(message.media?.data);

  if (body?.trim()) {
    return {
      type: 'text',
      body,
    };
  }

  if (mediaUrl) {
    const mediaType = getMediaType(mimeType, messageType);
    if (mediaType === 'audio') {
      return {
        type: 'audio',
        audioUrl: mediaUrl,
        contentType: mimeType || undefined,
      };
    }

    return {
      type: 'media',
      mediaType,
      mediaUrl,
      caption: getString(message.caption),
    };
  }

  if (embeddedMediaData && !message.media?.omitted) {
    const mediaDataUrl = toMediaDataUrl(embeddedMediaData, mimeType);
    const mediaType = getMediaType(mimeType, messageType);
    if (mediaType === 'audio') {
      return {
        type: 'audio',
        audioUrl: mediaDataUrl,
        contentType: mimeType || undefined,
      };
    }

    return {
      type: 'media',
      mediaType,
      mediaUrl: mediaDataUrl,
      caption: getString(message.caption),
    };
  }

  return {
    type: 'text',
    body: '',
  };
}

function getOpenWaMessageId(
  message: OpenWaMessagePayload,
  payload: OpenWaWebhookPayload
): string {
  const idValue = message.id;
  if (typeof idValue === 'string' && idValue.trim()) {
    return idValue;
  }

  if (idValue && typeof idValue === 'object') {
    const serialized = getString(idValue._serialized) || getString(idValue.id);
    if (serialized) {
      return serialized;
    }
  }

  return (
    getString(message.messageId) ||
    getString(payload.id) ||
    `openwa-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function getOpenWaSessionId(payload: OpenWaWebhookPayload): string | undefined {
  const session = payload.session;
  if (typeof session === 'string') {
    return session;
  }

  if (session && typeof session === 'object') {
    return getString(session.id) || getString(session.name);
  }

  return getString(payload.sessionId);
}

function getOpenWaTimestamp(value: unknown): Date {
  if (typeof value === 'number') {
    return new Date(value > 10_000_000_000 ? value : value * 1000);
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return getOpenWaTimestamp(numeric);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function getSenderId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return getString((value as { id?: unknown }).id);
  }

  return undefined;
}

function getMediaType(
  mimeType: string,
  messageType: string
): 'image' | 'video' | 'document' | 'audio' {
  const combined = `${mimeType} ${messageType}`.toLowerCase();
  if (/audio|ptt|voice|ogg|opus/.test(combined)) return 'audio';
  if (/image|photo/.test(combined)) return 'image';
  if (/video/.test(combined)) return 'video';
  return 'document';
}

function toWhatsAppAddress(value: string): string {
  if (value.startsWith('whatsapp:') || value.startsWith('openwa:')) {
    return value;
  }

  if (value.endsWith('@lid')) {
    return `whatsapp:${value}`;
  }

  const digits = value.replace(/@c\.us$|@g\.us$/i, '').replace(/[^\d+]/g, '');
  if (digits) {
    return `whatsapp:${digits.startsWith('+') ? digits : `+${digits}`}`;
  }

  return `openwa:${value}`;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toMediaDataUrl(data: string, mimeType: string): string {
  if (/^data:/i.test(data)) {
    return data;
  }

  return `data:${mimeType || 'application/octet-stream'};base64,${data}`;
}
