/**
 * Message Normalizer
 * Normalizes inbound Twilio webhook payloads into the InboundMessage type
 */

import { InboundMessage, MessageContent } from '../types/core.js';

/**
 * Twilio webhook payload structure
 */
export interface TwilioWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  NumMedia?: string;
  ButtonText?: string;
  ButtonPayload?: string;
  ListId?: string;
  ListTitle?: string;
  [key: string]: string | undefined;
}

/**
 * Normalizes a Twilio webhook payload into an InboundMessage
 * Supports text, media, audio, and interactive message types
 */
export function normalizeInboundMessage(
  payload: TwilioWebhookPayload
): InboundMessage {
  const messageId = payload.MessageSid;
  const from = payload.From;
  const to = payload.To;
  const timestamp = new Date();

  // Determine message type and content
  const content = extractMessageContent(payload);

  return {
    messageId,
    from,
    to,
    timestamp,
    type: content.type === 'text' ? 'text' : 
          content.type === 'audio' ? 'audio' :
          content.type === 'interactive' ? 'interactive' : 'media',
    content,
    metadata: {
      rawPayload: payload,
    },
  };
}

/**
 * Extracts message content from Twilio payload
 */
function extractMessageContent(payload: TwilioWebhookPayload): MessageContent {
  // Check for interactive responses (button or list reply)
  if (payload.ButtonPayload) {
    return {
      type: 'interactive',
      interactionType: 'button_reply',
      selectedId: payload.ButtonPayload,
      selectedTitle: payload.ButtonText,
    };
  }

  if (payload.ListId) {
    return {
      type: 'interactive',
      interactionType: 'list_reply',
      selectedId: payload.ListId,
      selectedTitle: payload.ListTitle,
    };
  }

  // Check for media messages
  const numMedia = parseInt(payload.NumMedia || '0', 10);
  if (numMedia > 0 && payload.MediaUrl0) {
    const mediaType = getMediaType(payload.MediaContentType0 || '');
    
    if (mediaType === 'audio') {
      return {
        type: 'audio',
        audioUrl: payload.MediaUrl0,
      };
    }

    return {
      type: 'media',
      mediaType,
      mediaUrl: payload.MediaUrl0,
      caption: payload.Body,
    };
  }

  // Default to text message
  return {
    type: 'text',
    body: payload.Body || '',
  };
}

/**
 * Determines media type from MIME type
 */
function getMediaType(
  contentType: string
): 'image' | 'video' | 'document' | 'audio' {
  if (contentType.startsWith('image/')) {
    return 'image';
  }
  if (contentType.startsWith('video/')) {
    return 'video';
  }
  if (contentType.startsWith('audio/')) {
    return 'audio';
  }
  return 'document';
}
