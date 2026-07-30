import { describe, expect, it } from 'vitest';
import {
  isOpenWaOutboundEcho,
  normalizeOpenWaInboundMessage,
  toOpenWaChatId,
  type OpenWaWebhookPayload,
} from './openWaMessageNormalizer.js';

describe('OpenWA message normalizer', () => {
  it('normalizes an OpenWA text webhook into Yana inbound format', () => {
    const payload: OpenWaWebhookPayload = {
      event: 'message.received',
      sessionId: 'yana-main',
      data: {
        id: 'openwa-message-1',
        from: '94777269221@c.us',
        to: '94770000000@c.us',
        body: 'hi',
        type: 'chat',
        timestamp: 1783947192,
      },
    };

    const result = normalizeOpenWaInboundMessage(payload);

    expect(result.messageId).toBe('openwa-message-1');
    expect(result.from).toBe('whatsapp:+94777269221');
    expect(result.to).toBe('whatsapp:+94770000000');
    expect(result.type).toBe('text');
    expect(result.inputType).toBe('text');
    expect(result.metadata?.provider).toBe('openwa');
    expect(result.metadata?.sessionId).toBe('yana-main');
    expect(result.content).toEqual({
      type: 'text',
      body: 'hi',
    });
  });

  it('normalizes OpenWA voice notes as audio input', () => {
    const result = normalizeOpenWaInboundMessage({
      data: {
        id: { _serialized: 'voice-1' },
        from: '94777269221@c.us',
        mediaUrl: 'https://openwa.example/media/voice.ogg',
        mimetype: 'audio/ogg; codecs=opus',
        type: 'ptt',
      },
    });

    expect(result.messageId).toBe('voice-1');
    expect(result.type).toBe('audio');
    expect(result.inputType).toBe('voice');
    expect(result.content).toEqual({
      type: 'audio',
      audioUrl: 'https://openwa.example/media/voice.ogg',
      contentType: 'audio/ogg; codecs=opus',
    });
  });

  it('normalizes nested OpenWA webhook payloads and embedded voice media', () => {
    const result = normalizeOpenWaInboundMessage({
      event: 'message.received',
      sessionId: 'yana-main',
      data: {
        payload: {
          id: 'nested-voice-1',
          from: '94777269221@c.us',
          to: '94701843379@c.us',
          type: 'ptt',
          media: {
            mimetype: 'audio/ogg; codecs=opus',
            data: Buffer.from('voice bytes').toString('base64'),
          },
        },
      },
    });

    expect(result.messageId).toBe('nested-voice-1');
    expect(result.from).toBe('whatsapp:+94777269221');
    expect(result.type).toBe('audio');
    expect(result.inputType).toBe('voice');
    expect(result.content).toEqual({
      type: 'audio',
      audioUrl: `data:audio/ogg; codecs=opus;base64,${Buffer.from('voice bytes').toString('base64')}`,
      contentType: 'audio/ogg; codecs=opus',
    });
  });

  it('keeps OpenWA voice envelopes marked as voice when media is missing', () => {
    const result = normalizeOpenWaInboundMessage({
      event: 'message.received',
      data: {
        from: '42253938626713@lid',
        to: '94701843379@c.us',
        chatId: '42253938626713@lid',
        body: '',
        type: 'voice',
        timestamp: 1784740417,
        fromMe: false,
      },
    });

    expect(result.from).toBe('whatsapp:42253938626713@lid');
    expect(result.type).toBe('text');
    expect(result.inputType).toBe('voice');
    expect(result.content).toEqual({
      type: 'text',
      body: '',
    });
  });

  it('converts Yana WhatsApp user IDs into OpenWA chat IDs', () => {
    expect(toOpenWaChatId('whatsapp:+94777269221')).toBe('94777269221@c.us');
    expect(toOpenWaChatId('94777269221@c.us')).toBe('94777269221@c.us');
    expect(toOpenWaChatId('whatsapp:42253938626713@lid')).toBe('42253938626713@lid');
  });

  it('preserves OpenWA LID senders so replies go to the same chat id', () => {
    const result = normalizeOpenWaInboundMessage({
      event: 'message.received',
      sessionId: 'yana-main',
      data: {
        id: 'lid-message-1',
        from: '42253938626713@lid',
        to: '247618521301177:2@lid',
        body: 'hi',
        type: 'chat',
      },
    });

    expect(result.from).toBe('whatsapp:42253938626713@lid');
  });

  it('detects outbound echo events so Yana does not answer itself', () => {
    expect(
      isOpenWaOutboundEcho({
        event: 'message.sent',
        data: {
          id: 'outbound-1',
          fromMe: true,
          from: '94701843379@c.us',
          to: '94777269221@c.us',
          body: 'Great, I can help with hotels.',
        },
      })
    ).toBe(true);
  });
});
