import { env } from '../config/environment.js';
import { getTextToSpeechService } from './TextToSpeechService.js';

interface SendWhatsAppOptions {
  voice?: boolean;
  from?: string;
}

export interface WhatsAppOutboundMessage {
  body: string;
  mediaUrl?: string;
}

const TWILIO_WHATSAPP_BODY_LIMIT = 1500;

export class TwilioOutboundService {
  async sendWhatsAppText(to: string, body: string): Promise<boolean> {
    let sentAny = false;
    for (const part of splitWhatsAppText(body)) {
      const sent = await this.sendWhatsAppMessage(to, part);
      sentAny = sentAny || sent;
    }
    return sentAny;
  }

  async sendWhatsAppMessages(
    to: string,
    messages: WhatsAppOutboundMessage[],
    options: SendWhatsAppOptions = {}
  ): Promise<boolean> {
    if (messages.length === 0) {
      return false;
    }

    let sentAny = false;
    for (const message of messages) {
      const bodyParts = splitWhatsAppText(message.body);
      for (const [index, body] of bodyParts.entries()) {
        const sent = await this.sendWhatsAppMessage(
          to,
          body,
          index === 0 ? message.mediaUrl : undefined,
          options.from
        );
        sentAny = sentAny || sent;
      }
    }

    if (options.voice) {
      const voiceText = messages.map((message) => message.body).join('\n\n');
      try {
        const audio = await getTextToSpeechService().synthesize(voiceText);
        if (audio?.mediaUrl) {
          const voiceSent = await this.sendWhatsAppMessage(
            to,
            'Voice reply',
            audio.mediaUrl,
            options.from
          );
          sentAny = sentAny || voiceSent;
        }
      } catch (error) {
        console.error('[TwilioOutboundService] TTS failed after result messages were sent:', error);
      }
    }

    return sentAny;
  }

  async sendWhatsAppReply(
    to: string,
    body: string,
    options: SendWhatsAppOptions = {}
  ): Promise<boolean> {
    if (!options.voice) {
      let sentAny = false;
      for (const part of splitWhatsAppText(body)) {
        const sent = await this.sendWhatsAppMessage(to, part, undefined, options.from);
        sentAny = sentAny || sent;
      }
      return sentAny;
    }

    let textSent = false;
    for (const part of splitWhatsAppText(body)) {
      const sent = await this.sendWhatsAppMessage(to, part, undefined, options.from);
      textSent = textSent || sent;
    }

    try {
      const audio = await getTextToSpeechService().synthesize(body);
      if (!audio?.mediaUrl) {
        return textSent;
      }

      const voiceSent = await this.sendWhatsAppMessage(
        to,
        'Voice reply',
        audio.mediaUrl,
        options.from
      );

      if (!voiceSent) {
        console.warn('[TwilioOutboundService] Voice media send failed after text message was sent');
      }

      return textSent || voiceSent;
    } catch (error) {
      console.error('[TwilioOutboundService] TTS failed after text message was sent:', error);
      return textSent;
    }
  }

  private async sendWhatsAppMessage(
    to: string,
    body: string,
    mediaUrl?: string,
    fromOverride?: string
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[TwilioOutboundService] Twilio outbound is not configured; skipping async message');
      return false;
    }

    const from = toWhatsAppAddress(fromOverride || env.twilio.whatsappNumber);
    const messageBody = new URLSearchParams({
      From: from,
      To: toWhatsAppAddress(to),
      Body: body,
    });

    if (mediaUrl) {
      messageBody.set('MediaUrl', mediaUrl);
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.twilio.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: messageBody,
      }
    );

    if (!response.ok) {
      console.error(
        `[TwilioOutboundService] Failed to send async WhatsApp message: ${response.status} ${await response.text()}`
      );
      return false;
    }

    console.log(`[TwilioOutboundService] Sent async WhatsApp message from ${from} to ${toWhatsAppAddress(to)}`);
    return true;
  }

  isConfigured(): boolean {
    return (
      env.twilio.accountSid !== 'dev_account_sid' &&
      env.twilio.authToken !== 'dev_auth_token' &&
      Boolean(env.twilio.whatsappNumber)
    );
  }
}

let twilioOutboundServiceInstance: TwilioOutboundService | null = null;

export function getTwilioOutboundService(): TwilioOutboundService {
  if (!twilioOutboundServiceInstance) {
    twilioOutboundServiceInstance = new TwilioOutboundService();
  }

  return twilioOutboundServiceInstance;
}

export function initTwilioOutboundService(
  service = new TwilioOutboundService()
): TwilioOutboundService {
  twilioOutboundServiceInstance = service;
  return service;
}

function toWhatsAppAddress(value: string): string {
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

export function splitWhatsAppText(body: string, limit = TWILIO_WHATSAPP_BODY_LIMIT): string[] {
  if (body.length <= limit) return [body];

  const chunks: string[] = [];
  const paragraphs = body.split(/\n{2,}/);
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }

    for (const line of paragraph.split('\n')) {
      const lineCandidate = current ? `${current}\n${line}` : line;
      if (lineCandidate.length <= limit) {
        current = lineCandidate;
        continue;
      }

      if (current) {
        chunks.push(current);
      }
      current = line.length <= limit ? line : line.slice(0, limit);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
