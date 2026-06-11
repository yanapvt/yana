import type { InboundMessage } from '../types/core.js';
import { getStateStore, type StateStore } from './StateStore.js';

export interface PendingProfileRequest {
  userId: string;
  messageText: string;
  messageId: string;
  createdAt: string;
}

const PENDING_PROFILE_REQUEST_TTL_SECONDS = 24 * 60 * 60;

export class PendingRequestService {
  constructor(private readonly store: StateStore = getStateStore()) {}

  async saveProfileGateRequest(inboundMessage: InboundMessage): Promise<void> {
    const messageText = extractMessageText(inboundMessage);
    if (!messageText) {
      return;
    }

    await this.store.setJson<PendingProfileRequest>(
      this.getProfileGateKey(inboundMessage.from),
      {
        userId: inboundMessage.from,
        messageText,
        messageId: inboundMessage.messageId,
        createdAt: new Date().toISOString(),
      },
      PENDING_PROFILE_REQUEST_TTL_SECONDS
    );
  }

  async consumeProfileGateRequest(userId: string): Promise<PendingProfileRequest | null> {
    const key = this.getProfileGateKey(userId);
    const request = await this.store.getJson<PendingProfileRequest>(key);
    if (!request) {
      return null;
    }

    await this.store.deleteKey(key);
    return request;
  }

  async clearProfileGateRequest(userId: string): Promise<void> {
    await this.store.deleteKey(this.getProfileGateKey(userId));
  }

  private getProfileGateKey(userId: string): string {
    return `profile-gate:${normalizeUserId(userId)}:pending-request`;
  }
}

let pendingRequestServiceInstance: PendingRequestService | null = null;

export function getPendingRequestService(): PendingRequestService {
  if (!pendingRequestServiceInstance) {
    pendingRequestServiceInstance = new PendingRequestService();
  }

  return pendingRequestServiceInstance;
}

export function initPendingRequestService(
  service = new PendingRequestService()
): PendingRequestService {
  pendingRequestServiceInstance = service;
  return service;
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

function normalizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9:+-]/g, '_');
}
