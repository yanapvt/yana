/**
 * Utility exports
 */

export { normalizeInboundMessage } from './messageNormalizer.js';
export type { TwilioWebhookPayload } from './messageNormalizer.js';
export {
  buildHotelCollectionResponse,
  buildHotelFormLink,
  buildProfileCollectionResponse,
  buildProfileFormLink,
} from './formResponses.js';
export { renderExpiredPage, renderFormPage, renderSuccessPage } from './htmlFormRenderer.js';
