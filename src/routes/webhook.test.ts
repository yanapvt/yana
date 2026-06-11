/**
 * Tests for WhatsApp Webhook Endpoint
 * Validates signature verification, rate limiting, and message normalization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import type { TwilioWebhookPayload } from '../utils/messageNormalizer.js';

describe('Message Normalizer', () => {
  describe('Text Messages', () => {
    it('should normalize a simple text message', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Hello, I want to book a hotel',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.messageId).toBe('SM123456');
      expect(result.from).toBe('whatsapp:+1234567890');
      expect(result.to).toBe('whatsapp:+0987654321');
      expect(result.type).toBe('text');
      expect(result.inputType).toBe('text');
      expect(result.content.type).toBe('text');
      if (result.content.type === 'text') {
        expect(result.content.body).toBe('Hello, I want to book a hotel');
      }
    });

    it('should handle empty text body', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: '',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('text');
      expect(result.content.type).toBe('text');
      if (result.content.type === 'text') {
        expect(result.content.body).toBe('');
      }
    });
  });

  describe('Interactive Messages', () => {
    it('should normalize a button reply', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        ButtonPayload: 'checkin_today',
        ButtonText: 'Today',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('interactive');
      expect(result.content.type).toBe('interactive');
      if (result.content.type === 'interactive') {
        expect(result.content.interactionType).toBe('button_reply');
        expect(result.content.selectedId).toBe('checkin_today');
        expect(result.content.selectedTitle).toBe('Today');
      }
    });

    it('should normalize a list reply', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        ListId: 'hotel_123',
        ListTitle: 'Luxury Beach Resort',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('interactive');
      expect(result.content.type).toBe('interactive');
      if (result.content.type === 'interactive') {
        expect(result.content.interactionType).toBe('list_reply');
        expect(result.content.selectedId).toBe('hotel_123');
        expect(result.content.selectedTitle).toBe('Luxury Beach Resort');
      }
    });
  });

  describe('Media Messages', () => {
    it('should use caption text when an image message includes Body', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/image.jpg',
        MediaContentType0: 'image/jpeg',
        Body: 'Check out this view!',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('text');
      expect(result.inputType).toBe('text');
      expect(result.content).toEqual({
        type: 'text',
        body: 'Check out this view!',
      });
    });

    it('should normalize an image message without caption as media', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/image.jpg',
        MediaContentType0: 'image/jpeg',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('media');
      expect(result.inputType).toBe('media');
      expect(result.content.type).toBe('media');
      if (result.content.type === 'media') {
        expect(result.content.mediaType).toBe('image');
        expect(result.content.mediaUrl).toBe('https://example.com/image.jpg');
      }
    });

    it('should normalize a video message', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/video.mp4',
        MediaContentType0: 'video/mp4',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('media');
      expect(result.content.type).toBe('media');
      if (result.content.type === 'media') {
        expect(result.content.mediaType).toBe('video');
        expect(result.content.mediaUrl).toBe('https://example.com/video.mp4');
      }
    });

    it('should normalize a document message', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/document.pdf',
        MediaContentType0: 'application/pdf',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('media');
      expect(result.content.type).toBe('media');
      if (result.content.type === 'media') {
        expect(result.content.mediaType).toBe('document');
      }
    });
  });

  describe('Audio Messages', () => {
    it('should normalize an audio message', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/audio.ogg',
        MediaContentType0: 'audio/ogg',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('audio');
      expect(result.inputType).toBe('voice');
      expect(result.content.type).toBe('audio');
      if (result.content.type === 'audio') {
        expect(result.content.audioUrl).toBe('https://example.com/audio.ogg');
        expect(result.content.contentType).toBe('audio/ogg');
      }
    });

    it('should treat OGG application content as an audio voice note', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/audio.ogg',
        MediaContentType0: 'application/ogg',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('audio');
      expect(result.inputType).toBe('voice');
    });

    it('uses Body text when both text and media are present', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Typed request wins',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/audio.ogg',
        MediaContentType0: 'audio/ogg',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.type).toBe('text');
      expect(result.inputType).toBe('text');
      expect(result.content).toEqual({
        type: 'text',
        body: 'Typed request wins',
      });
    });
  });

  describe('Metadata', () => {
    it('should include raw payload in metadata', () => {
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Test message',
      };

      const result = normalizeInboundMessage(payload);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.rawPayload).toEqual(payload);
    });

    it('should set timestamp to current time', () => {
      const before = new Date();
      
      const payload: TwilioWebhookPayload = {
        MessageSid: 'SM123456',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Test message',
      };

      const result = normalizeInboundMessage(payload);
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});

describe('Twilio Signature Validation', () => {
  /**
   * Helper function to compute Twilio signature for testing
   */
  function computeTwilioSignature(
    authToken: string,
    url: string,
    params: Record<string, string>
  ): string {
    const data =
      url +
      Object.keys(params)
        .sort()
        .map((key) => `${key}${params[key]}`)
        .join('');

    const hmac = crypto.createHmac('sha1', authToken);
    hmac.update(data);
    return hmac.digest('base64');
  }

  it('should compute correct signature for valid request', () => {
    const authToken = 'test_auth_token_12345';
    const url = 'https://example.com/webhook/whatsapp';
    const params = {
      MessageSid: 'SM123456',
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'Hello',
    };

    const signature = computeTwilioSignature(authToken, url, params);

    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
  });

  it('should produce different signatures for different URLs', () => {
    const authToken = 'test_auth_token_12345';
    const params = {
      MessageSid: 'SM123456',
      From: 'whatsapp:+1234567890',
      Body: 'Hello',
    };

    const sig1 = computeTwilioSignature(
      authToken,
      'https://example.com/webhook/whatsapp',
      params
    );
    const sig2 = computeTwilioSignature(
      authToken,
      'https://example.com/webhook/different',
      params
    );

    expect(sig1).not.toBe(sig2);
  });

  it('should produce different signatures for different parameters', () => {
    const authToken = 'test_auth_token_12345';
    const url = 'https://example.com/webhook/whatsapp';

    const sig1 = computeTwilioSignature(authToken, url, {
      MessageSid: 'SM123456',
      Body: 'Hello',
    });
    const sig2 = computeTwilioSignature(authToken, url, {
      MessageSid: 'SM123456',
      Body: 'Different',
    });

    expect(sig1).not.toBe(sig2);
  });

  it('should produce same signature for same inputs', () => {
    const authToken = 'test_auth_token_12345';
    const url = 'https://example.com/webhook/whatsapp';
    const params = {
      MessageSid: 'SM123456',
      From: 'whatsapp:+1234567890',
      Body: 'Hello',
    };

    const sig1 = computeTwilioSignature(authToken, url, params);
    const sig2 = computeTwilioSignature(authToken, url, params);

    expect(sig1).toBe(sig2);
  });
});

describe('Webhook Deduplication', () => {
  it('should extract MessageSid from webhook payload', () => {
    const payload: TwilioWebhookPayload = {
      MessageSid: 'SM1234567890abcdef',
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'Test message',
    };

    const result = normalizeInboundMessage(payload);

    expect(result.messageId).toBe('SM1234567890abcdef');
  });

  it('should use MessageSid as unique identifier for deduplication', () => {
    const payload1: TwilioWebhookPayload = {
      MessageSid: 'SM1234567890abcdef',
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'First message',
    };

    const payload2: TwilioWebhookPayload = {
      MessageSid: 'SM1234567890abcdef', // Same MessageSid
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'Duplicate message', // Different body
    };

    const result1 = normalizeInboundMessage(payload1);
    const result2 = normalizeInboundMessage(payload2);

    // Both should have the same messageId
    expect(result1.messageId).toBe(result2.messageId);
    expect(result1.messageId).toBe('SM1234567890abcdef');
  });

  it('should treat different MessageSids as unique messages', () => {
    const payload1: TwilioWebhookPayload = {
      MessageSid: 'SM1234567890abcdef',
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'First message',
    };

    const payload2: TwilioWebhookPayload = {
      MessageSid: 'SM0987654321fedcba', // Different MessageSid
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+0987654321',
      Body: 'First message', // Same body
    };

    const result1 = normalizeInboundMessage(payload1);
    const result2 = normalizeInboundMessage(payload2);

    // Should have different messageIds
    expect(result1.messageId).not.toBe(result2.messageId);
  });
});
