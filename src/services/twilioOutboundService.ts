import { env } from '../config/environment.js';

export class TwilioOutboundService {
  async sendWhatsAppText(to: string, body: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[TwilioOutboundService] Twilio outbound is not configured; skipping async message');
      return false;
    }

    const from = toWhatsAppAddress(env.twilio.whatsappNumber);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.twilio.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from,
          To: toWhatsAppAddress(to),
          Body: body,
        }),
      }
    );

    if (!response.ok) {
      console.error(
        `[TwilioOutboundService] Failed to send async WhatsApp message: ${response.status} ${await response.text()}`
      );
      return false;
    }

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
