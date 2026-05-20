/**
 * WhatsApp Webhook Routes
 * Handles inbound WhatsApp messages from Twilio
 */

import { Router, Request, Response } from 'express';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { validateTwilioSignature } from '../middleware/twilioSignature.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { deduplicateWebhook } from '../middleware/deduplication.js';
import {
  normalizeInboundMessage,
  TwilioWebhookPayload,
} from '../utils/messageNormalizer.js';
import { getLLMService, LLMServiceError } from '../services/LLMService.js';
import { getHotelIntakeService } from '../services/HotelIntakeService.js';
import type { InboundMessage } from '../types/core.js';

const router = Router();

/**
 * POST /webhook/whatsapp
 * Twilio webhook ingress endpoint for inbound WhatsApp messages
 * 
 * Requirements: 1.1, 1.2, 1.5, 1.7, 18.1, 21.1
 * 
 * Flow:
 * 1. Assign Correlation_ID (middleware)
 * 2. Apply rate limiting (middleware)
 * 3. Validate Twilio signature (middleware)
 * 4. Deduplicate webhook delivery (middleware)
 * 5. Normalize message payload
 * 6. Process message through LLM decision service
 * 7. Return TwiML response for Twilio to send back to WhatsApp
 */
router.post(
  '/webhook/whatsapp',
  assignCorrelationId,
  webhookRateLimiter,
  validateTwilioSignature,
  deduplicateWebhook,
  async (req: Request, res: Response) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const payload = req.body as TwilioWebhookPayload;

    try {
      // Normalize the inbound message
      const inboundMessage = normalizeInboundMessage(payload);

      console.log(
        `[${correlationId}] Normalized message from ${inboundMessage.from}: type=${inboundMessage.type}`
      );

      // TODO: Queue message for async processing
      // - Load or create session
      // - Process through Orchestrator
      // - Execute tool calls if needed
      // - Render richer WhatsApp response
      
      // For now, just log the message
      console.log(
        `[${correlationId}] Message received for processing:`,
        JSON.stringify(inboundMessage, null, 2)
      );

      const reply = await processInboundMessage(inboundMessage, correlationId);
      res.type('text/xml').status(200).send(toTwiml(reply));
    } catch (error) {
      // Log the error but still return 200 to Twilio
      // We don't want Twilio to retry on our internal errors
      console.error(
        `[${correlationId}] Error processing webhook:`,
        error
      );
      
      // If we haven't sent a response yet, send 200
      if (!res.headersSent) {
        res.status(200).send('');
      }
    }
  }
);

async function processInboundMessage(
  inboundMessage: InboundMessage,
  correlationId: string
): Promise<string> {
  const userMessage = extractMessageText(inboundMessage);
  const userContext = getInboundUserContext(inboundMessage);

  if (!userMessage) {
    console.log(
      `[${correlationId}] Skipping LLM decision: no text content available for message type=${inboundMessage.type}`
    );
    return 'I received your message, but I can only handle text messages in this test build.';
  }

  console.log(
    `[${correlationId}] Inbound user context:`,
    JSON.stringify(userContext, null, 2)
  );

  if (isGreeting(userMessage)) {
    return buildWelcomeMessage(userContext);
  }

  const hotelIntakeResult = await getHotelIntakeService().handleMessage(
    userMessage,
    {
      whatsappNumber: inboundMessage.from,
      profileName: userContext.profileName,
      country: userContext.country,
      countryCode: userContext.countryCode,
    }
  );

  if (hotelIntakeResult.handled && hotelIntakeResult.reply) {
    return hotelIntakeResult.reply;
  }

  try {
    console.log(`[${correlationId}] Calling LLM decision service`);

    const decision = await getLLMService().decide({
      userMessage,
      userProfile: {
        nationality: userContext.country,
      },
      availableSchemas: ['search_hotels'],
    });

    console.log(
      `[${correlationId}] LLM decision received:`,
      JSON.stringify(decision, null, 2)
    );

    if (decision.suggestedAction === 'ask_missing' && decision.missingFields.length > 0) {
      if (decision.intent === 'greeting') {
        return buildWelcomeMessage(userContext);
      }

      return `I can help with ${decision.intent}. Please share: ${decision.missingFields.join(', ')}.`;
    }

    if (decision.suggestedAction === 'execute_tool') {
      if (decision.intent === 'search_hotels') {
        return buildHotelSearchReply(decision.parameters);
      }

      return `Got it. I understood this as ${decision.intent}. I have enough details to continue, but tool execution is not wired into WhatsApp replies yet.`;
    }

    if (decision.suggestedAction === 'handoff') {
      return 'Thanks. I think this needs a human handoff, but handoff routing is not wired yet.';
    }

    return `I received your message and understood this as ${decision.intent}. Could you share a little more detail?`;
  } catch (error) {
    if (error instanceof LLMServiceError) {
      console.error(
        `[${correlationId}] LLM decision failed (${error.code}, retryable=${error.retryable}): ${error.message}`
      );
      return 'I received your message, but the AI service failed while processing it. Please check the server logs.';
    }

    throw error;
  }
}

function extractMessageText(inboundMessage: InboundMessage): string | null {
  const { content } = inboundMessage;

  if (content.type === 'text') {
    return content.body.trim();
  }

  if (content.type === 'media') {
    return content.caption?.trim() || null;
  }

  if (content.type === 'interactive') {
    return content.selectedTitle?.trim() || content.selectedId.trim();
  }

  return null;
}

interface InboundUserContext {
  profileName?: string;
  country?: string;
  countryCode?: string;
}

function getInboundUserContext(inboundMessage: InboundMessage): InboundUserContext {
  const rawPayload = inboundMessage.metadata?.rawPayload as
    | TwilioWebhookPayload
    | undefined;
  const phoneNumber = inboundMessage.from.replace(/^whatsapp:/, '');
  const countryMatch = getCountryFromPhoneNumber(phoneNumber);

  return {
    profileName: cleanProfileName(rawPayload?.ProfileName),
    country: countryMatch?.country,
    countryCode: countryMatch?.countryCode,
  };
}

function cleanProfileName(profileName?: string): string | undefined {
  const cleaned = profileName?.replace(/[\u200e\u200f]/g, '').trim();
  return cleaned || undefined;
}

function isGreeting(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  return /^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening|start|menu)$/.test(
    normalized
  );
}

function buildWelcomeMessage(context: InboundUserContext): string {
  const greeting = context.profileName ? `Hi ${context.profileName}` : 'Hi';
  const countryContext = context.country
    ? ` I see you are messaging from ${context.country}, so I will keep that context in mind.`
    : '';

  return `${greeting}, I am Yana, your personal tour concierge.${countryContext} I can help with hotels, transport, restaurants, excursions, itinerary planning, local recommendations, or anything else you need while planning your tour. How can I help you today?`;
}

function getCountryFromPhoneNumber(
  phoneNumber: string
): { countryCode: string; country: string } | null {
  const digits = phoneNumber.replace(/[^\d+]/g, '');
  const countryCodes: Array<[string, string]> = [
    ['+94', 'Sri Lanka'],
    ['+91', 'India'],
    ['+44', 'the United Kingdom'],
    ['+1', 'the United States or Canada'],
    ['+61', 'Australia'],
    ['+971', 'the United Arab Emirates'],
    ['+966', 'Saudi Arabia'],
    ['+974', 'Qatar'],
    ['+965', 'Kuwait'],
    ['+65', 'Singapore'],
    ['+60', 'Malaysia'],
    ['+49', 'Germany'],
    ['+33', 'France'],
    ['+39', 'Italy'],
    ['+31', 'the Netherlands'],
  ];

  const match = countryCodes.find(([countryCode]) =>
    digits.startsWith(countryCode)
  );

  return match ? { countryCode: match[0], country: match[1] } : null;
}

function buildHotelSearchReply(parameters: Record<string, unknown>): string {
  const location = getStringParam(parameters, ['location', 'destination', 'city']);
  const budget = getBudgetParam(parameters);
  const checkin = getStringParam(parameters, ['checkin', 'checkin_date', 'check_in']);
  const checkout = getStringParam(parameters, ['checkout', 'checkout_date', 'check_out']);
  const criteria: string[] = [];

  if (location) {
    criteria.push(`location: ${location}`);
  }

  if (budget) {
    criteria.push(`budget: ${budget}`);
  }

  if (checkin) {
    criteria.push(`check-in: ${checkin}`);
  }

  if (checkout) {
    criteria.push(`check-out: ${checkout}`);
  }

  const criteriaText = criteria.length > 0 ? ` for ${criteria.join(', ')}` : '';

  return `I found your hotel search${criteriaText}. Hotel inventory is not connected yet, so I cannot scan live availability, but I can use these criteria to continue once the hotel provider is wired in.`;
}

function getStringParam(
  parameters: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getBudgetParam(parameters: Record<string, unknown>): string | null {
  const directBudget = getStringParam(parameters, ['budget', 'price_range']);

  if (directBudget) {
    return directBudget;
  }

  const maxPrice = parameters.max_price ?? parameters.price_max ?? parameters.maxBudget;
  const currency = parameters.currency;

  if (typeof maxPrice === 'number') {
    return `${typeof currency === 'string' ? currency : 'USD'} ${maxPrice}`;
  }

  if (typeof maxPrice === 'string' && maxPrice.trim()) {
    return maxPrice.trim();
  }

  return null;
}

function toTwiml(message: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `<Message>${escapeXml(message)}</Message>`,
    '</Response>',
  ].join('');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default router;
