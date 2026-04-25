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
import { getMenuService } from '../services/MenuService.js';
import { BUTTON_TREE } from '../services/MenuService.js';
import type { TextContent } from '../types/core.js';

/** Short descriptions shown under each top-level tile image */
const BUTTON_TREE_DESCRIPTIONS: Record<string, string> = {
  get_around: 'Airport transfers, taxis, trains & travel planning',
  explore:    'Food, activities, events & shopping',
  stay:       'Hotels, essentials & emergency help',
};

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

// ============================================================================
// Tile-style menu helpers
// ============================================================================

/**
 * Image URLs for each top-level menu category.
 * These are publicly accessible images — replace with your own hosted assets.
 * WhatsApp requires HTTPS URLs for media messages.
 */
const MENU_IMAGES: Record<string, string> = {
  get_around:  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80', // tuk-tuk
  explore:     'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80', // food
  stay:        'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80', // hotel
  // Sub-categories
  airport:         'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=80',
  local_transport: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  travel_planning: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&q=80',
  food:            'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80',
  activities:      'https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=800&q=80',
  events:          'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80',
  accommodation:   'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80',
  essentials:      'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=800&q=80',
  help:            'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&q=80',
};

/** Default image used when no specific one is configured */
const DEFAULT_MENU_IMAGE = 'https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=800&q=80'; // Sri Lanka

/**
 * Sends a tile-style menu: each option is its own image + caption message,
 * followed by a single selection prompt.
 *
 * This is the closest approximation to "image + text + button per tile"
 * that works in the Twilio Sandbox without template approval.
 *
 * For true card/carousel templates (WhatsApp Business + approved templates),
 * replace this with Twilio Content Template Builder contentSid calls.
 */
async function sendTileMenu(
  twilioClient: ReturnType<typeof twilio>,
  to: string,
  headerText: string,
  tiles: Array<{ id: string; title: string; description?: string }>
): Promise<void> {
  // Send each tile as image + caption
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const imageUrl = MENU_IMAGES[tile.id] ?? DEFAULT_MENU_IMAGE;
    const caption = `*${i + 1}. ${tile.title}*${tile.description ? `\n${tile.description}` : ''}`;

    await twilioClient.messages.create({
      from: `whatsapp:${env.twilio.whatsappNumber}`,
      to,
      body: caption,
      mediaUrl: [imageUrl],
    });
  }

  // Final selection prompt
  const selectionLines = [
    headerText,
    '',
    ...tiles.map((t, i) => `*${i + 1}.* ${t.title}`),
    '',
    '_Reply with a number to select._',
  ];

  await twilioClient.messages.create({
    from: `whatsapp:${env.twilio.whatsappNumber}`,
    to,
    body: selectionLines.join('\n'),
  });
}

/**
 * Sends a plain numbered menu (no images) — used for deeper levels
 * where sending multiple images would be too noisy.
 */
async function sendTextMenu(
  twilioClient: ReturnType<typeof twilio>,
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>
): Promise<void> {
  if (buttons.length === 0) {
    await twilioClient.messages.create({
      from: `whatsapp:${env.twilio.whatsappNumber}`,
      to,
      body,
    });
    return;
  }

  const lines = [body, '', ...buttons.map((btn, i) => `*${i + 1}.* ${btn.title}`), '', '_Reply with a number to select._'];
  await twilioClient.messages.create({
    from: `whatsapp:${env.twilio.whatsappNumber}`,
    to,
    body: lines.join('\n'),
  });
}

/**
 * Handles the "test" keyword and all subsequent button navigation replies.
 *
 * Navigation state (which node the user is at) is stored in session via
 * collectedFields.activeButtonNode. Numbered replies ("1", "2", "3") are
 * resolved against the current node's children.
 *
 * Returns true if the message was handled as a button interaction,
 * false if it should fall through to the normal LLM pipeline.
 */
async function handleButtonFlow(
  twilioClient: ReturnType<typeof twilio>,
  to: string,
  rawText: string,
  correlationId: string,
  activeButtonNode: string | undefined,
  sessionId: string | null,
  sessionManager: ReturnType<typeof getSessionManager>
): Promise<boolean> {
  const menu = getMenuService();
  const trimmed = rawText.trim().toLowerCase();

  // ── Entry point: user sends "test" ────────────────────────────────────────
  if (trimmed === 'test') {
    logger.info('Webhook', 'Button menu triggered by "test" keyword', { correlationId, to });
    const mainMenu = menu.getMainButtonMenu();

    // Top level: send tile-style (image + text per option)
    await sendTileMenu(twilioClient, to, mainMenu.body, mainMenu.buttons.map((btn) => ({
      id: btn.id,
      title: btn.title,
      description: BUTTON_TREE_DESCRIPTIONS[btn.id],
    })));

    // Store that we're at the root node
    if (sessionId) {
      try {
        await sessionManager.updateSessionState(sessionId, {
          collectedFields: { activeButtonNode: 'root' },
        });
      } catch { /* non-fatal */ }
    }
    return true;
  }

  // ── Numbered reply while in button navigation ─────────────────────────────
  if (activeButtonNode) {
    const numMatch = trimmed.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;

      // Find the current node and get its child at that index
      const { message: currentMsg, intent: _i, isLeaf: _l } =
        menu.resolveButtonPayload(activeButtonNode);

      if (currentMsg && currentMsg.buttons[index]) {
        const selectedId = currentMsg.buttons[index].id;
        const { message, intent, isLeaf } = menu.resolveButtonPayload(selectedId);

        if (!message) return false;

        if (isLeaf) {
          logger.info('Webhook', 'Button leaf reached', { correlationId, to, selectedId, intent });
          await twilioClient.messages.create({
            from: `whatsapp:${env.twilio.whatsappNumber}`,
            to,
            body: message.body,
          });
          // Clear button navigation state, set intent
          if (sessionId) {
            try {
              await sessionManager.updateSessionState(sessionId, {
                currentIntent: intent ?? undefined,
                collectedFields: { activeButtonNode: undefined },
              });
            } catch { /* non-fatal */ }
          }
        } else {
          logger.debug('Webhook', 'Button navigation', { correlationId, to, selectedId });
          await sendTextMenu(twilioClient, to, message.body, message.buttons);
          if (sessionId) {
            try {
              await sessionManager.updateSessionState(sessionId, {
                collectedFields: { activeButtonNode: selectedId },
              });
            } catch { /* non-fatal */ }
          }
        }
        return true;
      }
    }

    // Non-numeric while in button nav — let LLM handle it, clear nav state
    if (sessionId) {
      try {
        await sessionManager.updateSessionState(sessionId, {
          collectedFields: { activeButtonNode: undefined },
        });
      } catch { /* non-fatal */ }
    }
  }

  // ── Direct button ID payload (future: real button taps) ───────────────────
  const { message, intent, isLeaf } = menu.resolveButtonPayload(rawText.trim());
  if (message) {
    if (isLeaf) {
      await twilioClient.messages.create({
        from: `whatsapp:${env.twilio.whatsappNumber}`,
        to,
        body: message.body,
      });
    } else {
      await sendTextMenu(twilioClient, to, message.body, message.buttons);
      if (sessionId) {
        try {
          await sessionManager.updateSessionState(sessionId, {
            collectedFields: { activeButtonNode: rawText.trim() },
          });
        } catch { /* non-fatal */ }
      }
    }
    return true;
  }

  return false;
}

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

  // ── Button flow: handle "test" keyword and button navigation replies ─────────
  // Runs before session loading — uses activeButtonNode from session if available.
  const rawPayload = (inboundMessage.content.type === 'interactive'
    ? inboundMessage.content.selectedId
    : userText
  );

  const handledByButtons = await handleButtonFlow(
    twilioClient,
    inboundMessage.from,
    rawPayload,
    correlationId,
    undefined,          // activeButtonNode — loaded below after session is ready
    null,               // sessionId — not yet loaded
    sessionManager
  );

  if (handledByButtons) {
    logger.debug('Webhook', 'Message handled by button flow (pre-session), skipping LLM pipeline', {
      correlationId,
      payload: rawPayload.substring(0, 30),
    });
    return;
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

  // ── Button flow (with session): handle numbered navigation replies ─────────
  // Now that we have session state, check if user is navigating the button tree.
  const activeButtonNode = contextPackage?.activeFlowState?.collectedFields?.['activeButtonNode'] as string | undefined;
  if (activeButtonNode || rawPayload.trim().toLowerCase() === 'test') {
    const handledWithSession = await handleButtonFlow(
      twilioClient,
      inboundMessage.from,
      rawPayload,
      correlationId,
      activeButtonNode,
      sessionId,
      sessionManager
    );
    if (handledWithSession) {
      logger.debug('Webhook', 'Message handled by button flow (with session), skipping LLM pipeline', {
        correlationId,
        payload: rawPayload.substring(0, 30),
      });
      return;
    }
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

  const { decision, replyText, fromCache, shortCircuited, activeSubMenu, pendingIntents } =
    await llmService.decideAndReply(
      {
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
      },
      // Pass active sub-menu from session so numbered replies resolve correctly
      (activeFlowState?.collectedFields?.['activeSubMenu'] as string | undefined)
    );

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
  if (sessionId) {
    try {
      const updatedFields: Record<string, unknown> = {
        ...(schemaProgress?.collectedFields ?? {}),
        ...decision.parameters,
      };

      // Persist active sub-menu so next numbered reply resolves correctly
      if (activeSubMenu) {
        updatedFields['activeSubMenu'] = activeSubMenu;
      } else if (shortCircuited && decision.intent !== 'greeting' && decision.intent !== 'help') {
        // Clear sub-menu when user moves on
        delete updatedFields['activeSubMenu'];
      }

      // Persist pending intents for multi-intent flow
      if (pendingIntents && pendingIntents.length > 0) {
        updatedFields['pendingIntents'] = pendingIntents;
      }

      await sessionManager.updateSessionState(sessionId, {
        currentIntent: decision.intent,
        missingFields: decision.missingFields,
        collectedFields: updatedFields,
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
