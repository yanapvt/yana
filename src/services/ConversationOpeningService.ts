import { createHash } from 'node:crypto';
import { getStateStore, type StateStore } from './StateStore.js';

interface NameState {
  suggestedName?: string;
  preferredName?: string;
  awaitingReply: boolean;
  awaitingAlternative?: boolean;
}

const NAME_STATE_TTL_SECONDS = 365 * 24 * 60 * 60;
const VOICE_OPENING_TTL_SECONDS = 60 * 60;

export class ConversationOpeningService {
  constructor(private readonly store: StateStore = getStateStore()) {}

  getNameState(userId: string): Promise<NameState | null> {
    return this.store.getJson<NameState>(this.key(userId, 'name'));
  }

  async rememberExistingName(userId: string, preferredName?: string): Promise<void> {
    await this.store.setJson(this.key(userId, 'name'), {
      preferredName: cleanName(preferredName),
      awaitingReply: false,
    } satisfies NameState, NAME_STATE_TTL_SECONDS);
  }

  async askAboutName(userId: string, displayName: string): Promise<string | null> {
    const suggestedName = firstName(displayName);
    if (!suggestedName) return null;
    await this.store.setJson(this.key(userId, 'name'), {
      suggestedName,
      awaitingReply: true,
    } satisfies NameState, NAME_STATE_TTL_SECONDS);
    return suggestedName;
  }

  async handleNameReply(userId: string, message: string, state: NameState): Promise<string | null> {
    if (!state.awaitingReply) return null;
    const answer = message.trim();
    const affirmative = /^(?:yes|yes please|sure|that's fine|that is fine|you can call me that|call me that)$/i.test(answer);
    const negative = /^(?:no|no thanks|no thank you)$/i.test(answer);
    const explicitName = answer.match(/^(?:call me|please call me|my name is|i prefer(?: to be called)?)\s+(.+)$/i)?.[1];
    const shortName = !explicitName && !affirmative && !negative && state.awaitingAlternative &&
      !/^(?:hotel|restaurant|dinner|lunch|breakfast|transport|taxi|excursion|trip|travel|yes|no)$/i.test(answer) &&
      /^[\p{L}\p{M}'’.-]+(?:\s+[\p{L}\p{M}'’.-]+)?$/u.test(answer)
      ? answer
      : undefined;

    if (negative) {
      await this.store.setJson(this.key(userId, 'name'), {
        ...state,
        awaitingAlternative: true,
      } satisfies NameState, NAME_STATE_TTL_SECONDS);
      return 'Of course. What name would you prefer I use?';
    }
    const preferredName = affirmative ? state.suggestedName : cleanName(explicitName ?? shortName);
    if (!preferredName) return null;

    await this.store.setJson(this.key(userId, 'name'), {
      ...state,
      preferredName,
      awaitingReply: false,
    } satisfies NameState, NAME_STATE_TTL_SECONDS);
    return `Of course, ${preferredName}. What can I help you with?`;
  }

  async shouldOpenVoiceConversation(userId: string): Promise<boolean> {
    const key = this.key(userId, 'voice-opening');
    if (await this.store.getJson<boolean>(key)) return false;
    await this.store.setJson(key, true, VOICE_OPENING_TTL_SECONDS);
    return true;
  }

  async markTextActivity(userId: string): Promise<void> {
    await this.store.setJson(this.key(userId, 'voice-opening'), true, VOICE_OPENING_TTL_SECONDS);
  }

  private key(userId: string, suffix: string): string {
    const idHash = createHash('sha256').update(userId).digest('hex');
    return `conversation-opening:${idHash}:${suffix}`;
  }
}

let instance: ConversationOpeningService | null = null;

export function getConversationOpeningService(): ConversationOpeningService {
  if (!instance) instance = new ConversationOpeningService();
  return instance;
}

export function initConversationOpeningService(service = new ConversationOpeningService()): ConversationOpeningService {
  instance = service;
  return service;
}

function firstName(displayName: string): string | undefined {
  const cleaned = cleanName(displayName);
  return cleaned?.match(/[\p{L}][\p{L}\p{M}'’-]*/u)?.[0];
}

function cleanName(value?: string): string | undefined {
  const cleaned = value?.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 60 || !/[\p{L}]/u.test(cleaned) || /https?:|@/i.test(cleaned)) return undefined;
  return cleaned;
}
