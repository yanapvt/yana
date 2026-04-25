/**
 * WhatsApp Webhook Routes
 * Handles inbound WhatsApp messages from Twilio
 */

import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import crypto from 'crypto';
import { assignCorrelationId } from '../middleware/correlationId.js';
import { validateTwilioSignature } from '../middleware/twilioSignature.js';
import { webhookRateLimiter } from '../middleware/rateLimiting.js';
import { deduplicateWebhook } from '../middleware/deduplication.js';
import { logger } from '../config/logger.js';
import { env } from '../config/environment.js';
import {
  normalizeInboundMessage,
  TwilioWebhookPayload,
} from '../utils/messageNormalizer.js';
import { getLLMService } from '../services/LLMService.js';
import { getSessionManager } from '../services/SessionManager.js';
import type { TextContent } from '../types/core.js';

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
 * 6. Return immediate HTTP 200 acknowledgement
 * 7. Queue message for async processing (TODO)
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
      logger.debug('Webhook', 'Processing WhatsApp webhook', {
        correlationId,
        from: payload.From,
        messageType: payload.Body ? 'text' : 'media',
      });

      // Normalize the inbound message
      const inboundMessage = normalizeInboundMessage(payload);

      logger.info('Webhook', 'Message normalized successfully', {
        correlationId,
        from: inboundMessage.from,
        type: inboundMessage.type,
        timestamp: inboundMessage.timestamp,
      });

      // Emit immediate acknowledgement to Twilio (HTTP 200)
      // This prevents Twilio from retrying while we process the message
      res.status(200).send('');

      // Process message asynchronously after acknowledging Twilio
      setImmediate(async () => {
        try {
          await processAndReply(inboundMessage, correlationId);
        } catch (err) {
          // Capture full error details including pg error codes
          const errObj = err as any;
          logger.error('Webhook', 'Async processing failed', {
            correlationId,
            error: errObj?.message || String(err),
            code: errObj?.code,
            detail: errObj?.detail,
            stack: errObj?.stack,
          });
        }
      });
    } catch (error) {
      // Log the error but still return 200 to Twilio
      // We don't want Twilio to retry on our internal errors
      logger.error('Webhook', 'Error processing webhook', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // If we haven't sent a response yet, send 200
      if (!res.headersSent) {
        res.status(200).send('');
      }
    }
  }
);

export default router;

/**
 * Processes an inbound message and sends a reply via Twilio.
 * Loads or creates a session, passes conversation history to the LLM,
 * persists both the user message and the bot reply to the session.
 * Gracefully degrades if the database is unavailable.
 */
async function processAndReply(
  inboundMessage: ReturnType<typeof normalizeInboundMessage>,
  correlationId: string
): Promise<void> {
  const twilioClient = twilio(env.twilio.accountSid, env.twilio.authToken);
  const sessionManager = getSessionManager();
  const llmService = getLLMService();

  // Strip the "whatsapp:" prefix to get the plain phone number
  const phoneNumber = inboundMessage.from.replace(/^whatsapp:/, '');

  // Extract user text from the message content
  let userText = '';
  if (inboundMessage.content.type === 'text') {
    userText = (inboundMessage.content as TextContent).body;
  } else if (inboundMessage.content.type === 'interactive') {
    userText = inboundMessage.content.selectedTitle || inboundMessage.content.selectedId;
  } else {
    userText = `[${inboundMessage.content.type} message]`;
  }

  // ── 1. Load or create session (best-effort — DB may be unavailable) ────────
  let sessionId: string | null = null;
  let contextPackage: Awaited<ReturnType<typeof sessionManager.resumeSession>> = null;

  try {
    contextPackage = await sessionManager.resumeSession(inboundMessage.from);

    if (!contextPackage) {
      logger.info('Webhook', 'No active session found, creating new session', {
        correlationId,
        phoneNumber,
      });
      const phoneHash = crypto.createHash('sha256').update(phoneNumber).digest('hex');
      const created = await sessionManager.createSession({
        phoneNumber: inboundMessage.from,
        phoneHash,
      });
      contextPackage = await sessionManager.assembleContextPackage(created.sessionId);
    }

    sessionId = contextPackage.sessionId;
    logger.debug('Webhook', 'Session loaded', { correlationId, sessionId });
  } catch (dbErr: any) {
    logger.warn('Webhook', 'Database unavailable — proceeding without session context', {
      correlationId,
      error: dbErr?.message || String(dbErr),
      code: dbErr?.code,
    });
  }

  // ── 2. Load conversation history (best-effort) ────────────────────────────
  let conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  if (sessionId) {
    try {
      const { SessionRepository } = await import('../db/repositories/SessionRepository.js');
      const sessionRepo = new SessionRepository();
      const stateData = await sessionRepo.getState(sessionId);

      const rawHistory = (stateData?.conversationHistory ?? []) as Array<{
        role: 'user' | 'assistant' | 'system';
        content: unknown;
      }>;

      conversationHistory = rawHistory.slice(-20).map((entry) => ({
        role: entry.role,
        content: typeof entry.content === 'string'
          ? entry.content
          : typeof entry.content === 'object' && entry.content !== null && 'body' in entry.content
            ? String((entry.content as { body: unknown }).body)
            : JSON.stringify(entry.content),
      }));

      logger.debug('Webhook', 'Conversation history loaded', {
        correlationId,
        sessionId,
        historyLength: conversationHistory.length,
      });
    } catch (histErr: any) {
      logger.warn('Webhook', 'Could not load conversation history', {
        correlationId,
        error: histErr?.message || String(histErr),
      });
    }
  }

  // ── 3. Persist the inbound user message (best-effort) ─────────────────────
  if (sessionId) {
    try {
      await sessionManager.appendMessage(sessionId, {
        correlationId,
        fromNumber: inboundMessage.from,
        toNumber: inboundMessage.to,
        messageType: inboundMessage.type,
        role: 'user',
        content: inboundMessage.content as Record<string, unknown>,
      });
    } catch (persistErr: any) {
      logger.warn('Webhook', 'Could not persist inbound message', {
        correlationId,
        error: persistErr?.message || String(persistErr),
      });
    }
  }

  // ── 4. Single LLM call: decide intent + generate reply simultaneously ────────
  const userProfile = contextPackage?.userProfile;
  const activeFlowState = contextPackage?.activeFlowState;
  const schemaProgress = contextPackage?.schemaProgress;

  logger.debug('Webhook', 'Calling LLM (combined decide+reply)', {
    correlationId,
    sessionId,
    historyLength: conversationHistory.length,
    userText: userText.substring(0, 100),
  });

  const { decision, replyText, fromCache, shortCircuited } = await llmService.decideAndReply({
    userMessage: userText,
    conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    userProfile: userProfile ? {
      preferredLanguage: userProfile.preferredLanguage,
      nationality: userProfile.nationality,
      recentActions: contextPackage?.behavioralSummary.recentActions,
    } : undefined,
    sessionState: activeFlowState ? {
      currentIntent: activeFlowState.currentIntent,
      activeSchema: activeFlowState.activeSchema,
      collectedFields: schemaProgress?.collectedFields,
      missingFields: schemaProgress?.missingFields,
    } : undefined,
  });

  logger.info('Webhook', 'LLM response ready', {
    correlationId,
    sessionId,
    intent: decision.intent,
    suggestedAction: decision.suggestedAction,
    confidence: decision.confidence,
    fromCache,
    shortCircuited,
  });

  // ── 5. Update session state (best-effort) ─────────────────────────────────
  if (sessionId && !shortCircuited) {
    try {
      await sessionManager.updateSessionState(sessionId, {
        currentIntent: decision.intent,
        missingFields: decision.missingFields,
        collectedFields: {
          ...(schemaProgress?.collectedFields ?? {}),
          ...decision.parameters,
        },
      });
    } catch (stateErr: any) {
      logger.warn('Webhook', 'Could not update session state', {
        correlationId,
        error: stateErr?.message || String(stateErr),
      });
    }
  }

  // ── 6. Send reply via Twilio ───────────────────────────────────────────────
  await twilioClient.messages.create({
    from: `whatsapp:${env.twilio.whatsappNumber}`,
    to: inboundMessage.from,
    body: replyText,
  });

  logger.info('Webhook', 'Reply sent successfully', {
    correlationId,
    sessionId,
    to: inboundMessage.from,
    replyLength: replyText.length,
  });

  // ── 7. Persist the bot reply (best-effort) ────────────────────────────────
  if (sessionId) {
    try {
      await sessionManager.appendMessage(sessionId, {
        correlationId: crypto.randomUUID(),
        fromNumber: inboundMessage.to,
        toNumber: inboundMessage.from,
        messageType: 'text',
        role: 'assistant',
        content: { type: 'text', body: replyText },
      });
      logger.debug('Webhook', 'Bot reply persisted to session history', {
        correlationId,
        sessionId,
      });
    } catch (persistErr: any) {
      logger.warn('Webhook', 'Could not persist bot reply', {
        correlationId,
        error: persistErr?.message || String(persistErr),
      });
    }
  }
}
