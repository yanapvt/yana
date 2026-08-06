import { describe, expect, it } from 'vitest';
import { normalizeMetaWhatsAppInboundMessage } from './metaWhatsAppMessageNormalizer.js';

describe('normalizeMetaWhatsAppInboundMessage', () => {
  it('normalizes a Meta text message', () => {
    const message = normalizeMetaWhatsAppInboundMessage({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '14155238886',
                  phone_number_id: '123456',
                },
                contacts: [{ wa_id: '94777269221', profile: { name: 'Jeremy' } }],
                messages: [
                  {
                    id: 'wamid.text',
                    from: '94777269221',
                    timestamp: '1785829346',
                    type: 'text',
                    text: { body: 'hi' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(message.messageId).toBe('wamid.text');
    expect(message.from).toBe('whatsapp:+94777269221');
    expect(message.to).toBe('whatsapp:+14155238886');
    expect(message.type).toBe('text');
    expect(message.inputType).toBe('text');
    expect(message.content).toEqual({ type: 'text', body: 'hi' });
  });

  it('normalizes a Meta voice note with a proxy media URL', () => {
    const message = normalizeMetaWhatsAppInboundMessage(
      {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '123456' },
                  messages: [
                    {
                      id: 'wamid.voice',
                      from: '94777269221',
                      type: 'audio',
                      audio: {
                        id: 'media-123',
                        mime_type: 'audio/ogg',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { mediaUrlForId: (mediaId) => `https://yana.example/media/meta/${mediaId}` }
    );

    expect(message.type).toBe('audio');
    expect(message.inputType).toBe('voice');
    expect(message.content).toEqual({
      type: 'audio',
      audioUrl: 'https://yana.example/media/meta/media-123',
      contentType: 'audio/ogg',
    });
  });

  it('normalizes a Meta button reply as an interactive message', () => {
    const message = normalizeMetaWhatsAppInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '123456' },
                messages: [
                  {
                    id: 'wamid.button',
                    from: '94777269221',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: {
                        id: 'book_1',
                        title: 'Book now',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(message.type).toBe('interactive');
    expect(message.inputType).toBe('interactive');
    expect(message.content).toEqual({
      type: 'interactive',
      interactionType: 'button_reply',
      selectedId: 'book_1',
      selectedTitle: 'Book now',
    });
  });
});
