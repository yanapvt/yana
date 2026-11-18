// Compatibility exports for existing channel adapters and tests. Conversation
// processing lives in the application service, not in an HTTP route.
export {
  processWebhookPayload,
  processNormalizedInboundMessage,
  processCanonicalInboundMessage,
  processInboundMessage,
  buildWebhookReply,
  deliverWebhookReplyThroughTwilio,
  toTwiml,
  buildMemoryConfirmationPrompt,
  handleTravellerMemoryConsent,
  withConversationalLead,
} from '../services/ConversationMessageService.js';
