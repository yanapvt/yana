import { createHash } from 'node:crypto';
import { getStateStore, type StateStore } from './StateStore.js';
import { ConversationAnalyzer } from '../orchestration/ConversationAnalyzer.js';
import type { OrchestrationContext, OrchestrationFlow } from '../orchestration/Orchestrator.js';
import type { OrchestrationSessionSnapshot } from '../orchestration/Orchestrator.js';
import { getLLMService } from './LLMService.js';

export const CONCIERGE_BUBBLE_SEPARATOR = '\u001e';
const OPENING_TTL = 7 * 24 * 60 * 60;

interface OpeningState {
  stage: 'awaiting_choice' | 'opened';
  originalText?: string;
  lastMessageId: string;
}

export interface ConciergeOpening {
  text: string;
  reply?: string;
  lead?: string;
}
export interface OpeningProposal { flow?: OrchestrationFlow; lead?: string }

/** Pre-workflow conversation. Decisions here only shape the reply and the next
 * user utterance; existing profile and workflow gates retain execution authority. */
export class ConciergeConversationService {
  private readonly analyzer = new ConversationAnalyzer();
  constructor(private readonly store: Pick<StateStore, 'getJson' | 'setJson'> = getStateStore()) {}

  async stage(userId: string): Promise<OpeningState['stage'] | null> {
    return (await this.store.getJson<OpeningState>(this.key(userId)))?.stage ?? null;
  }

  /** The model writes only the human acknowledgment. CORE still selects the flow
   * and supplies the form, search result or next question. */
  async proposeLead(text: string, preferredName?: string, mode: 'opening' | 'personal_event' = 'opening',
    recentConversation: Array<{ role: 'user' | 'assistant'; content: string }> = []): Promise<string | undefined> {
    try {
      const response = await getLLMService().generateUIContent({
        task: mode === 'opening'
          ? 'Write one natural opening sentence for this traveller. Greet briefly when appropriate. Congratulate a genuine celebration, or offer sincere condolences for a loss, in language specific to what they shared. Acknowledge their actual travel need. Do not ask a question or repeat a form instruction.'
          : 'If this message shares a new celebration, achievement, loss, distressing event, or other meaningful personal news, write one specific, courteous acknowledgment. Otherwise return exactly NONE. Check recentConversation and return NONE if YANA already acknowledged the same news. Do not repeat a greeting or congratulate ordinary travel plans.',
        travellerMessage: text.slice(0, 1000), preferredName,
        recentConversation: recentConversation.slice(-4).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 500) })),
        rules: 'One sentence, at most 260 characters. No URLs, prices, availability, booking, payment, completed action, or promise. Return plain text only.',
      });
      return /^none[.!]?$/i.test(response.trim()) ? undefined :
        safeProposedLead(response) ?? (mode === 'personal_event' ? socialAcknowledgement(text) : undefined);
    } catch {
      return mode === 'personal_event' ? socialAcknowledgement(text) : undefined;
    }
  }

  async open(userId: string, messageId: string, text: string, preferredName?: string, proposal: OpeningProposal = {}): Promise<ConciergeOpening> {
    const state = await this.store.getJson<OpeningState>(this.key(userId));
    if (state?.lastMessageId === messageId) return { text };
    if (state?.stage === 'opened') return { text };
    if (state?.stage === 'awaiting_choice') {
      const choice = resolveChoice(text) ??
        (this.analyzer.analyze(minimalContext(userId, messageId, text)).targetFlow !== 'none' ? text : undefined);
      if (!choice) {
        return { text, reply: joinConciergeBubbles(
          'Of course. I want to make sure I help with the right thing.',
          'Would you like help with a place to stay, activities, or dining? You can also tell me another travel need.'
        ) };
      }
      await this.save(userId, { stage: 'opened', lastMessageId: messageId });
      return { text: `${choice}${state.originalText ? `; ${state.originalText}` : ''}`,
        lead: chooseHumanLead(socialAcknowledgement(text), proposal.lead) ??
          `Certainly${preferredName ? `, ${preferredName}` : ''}. I can help with that.` };
    }

    const intent = this.analyzer.analyze(minimalContext(userId, messageId, text));
    const eventLead = socialAcknowledgement(text);
    const humanLead = chooseHumanLead(eventLead, proposal.lead);
    const flow = intent.targetFlow === 'none' ? proposal.flow ?? 'none' : intent.targetFlow;
    if (flow === 'none' || intent.intent === 'smalltalk') {
      await this.save(userId, { stage: 'awaiting_choice', originalText: text.slice(0, 500), lastMessageId: messageId });
      return { text, reply: joinConciergeBubbles(
        humanLead ?? `Hello${preferredName ? `, ${preferredName}` : ''}. I'd be glad to help with your plans.`,
        'Would you like help with a place to stay, activities, or dining? You can also tell me another travel need.'
      ) };
    }
    await this.save(userId, { stage: 'opened', lastMessageId: messageId });
    return { text, lead: humanLead ?? leadForFlow(flow, preferredName) };
  }

  async reset(userId: string): Promise<void> {
    await this.store.setJson(this.key(userId), null, 1);
  }

  private async save(userId: string, state: OpeningState): Promise<void> {
    await this.store.setJson(this.key(userId), state, OPENING_TTL);
  }

  private key(userId: string): string {
    return `concierge-opening:${createHash('sha256').update(userId).digest('hex')}`;
  }
}

function minimalContext(userId: string, messageId: string, text: string): OrchestrationContext {
  return { userId, message: { messageId, from: userId, inputType: 'text', text }, profileComplete: false, metadata: {} };
}

function leadForFlow(flow: OrchestrationFlow, name?: string): string {
  const address = name ? `, ${name}` : '';
  const subject: Record<string, string> = {
    hotel: 'a place to stay', restaurant: 'a place to dine', excursion: 'things to do',
    logistics: 'your transport', itinerary: 'your trip plan', profile: 'your travel profile', none: 'your plans',
  };
  return `Hello${address}. I'd be glad to help with ${subject[flow]}.`;
}

function socialAcknowledgement(text: string): string | undefined {
  if (/\b(died|passed away|bereave|funeral|loss of (my|our)|lost my (mother|father|parent|partner|spouse|wife|husband|child|son|daughter|friend))\b/i.test(text)) {
    return "I'm sorry for your loss. I'll help with the travel arrangements as gently as I can.";
  }
  if (/\b(seriously ill|very ill|in hospital|hospitalized|hospitalised|diagnosed|injured|laid off)\b/i.test(text)) {
    return "I'm sorry you're going through this. I'll help with the travel details as carefully as I can.";
  }
  if (/\b(anniversary|honeymoon|birthday|graduat|engaged|wedding|new baby|had a baby|promotion|passed my exams|got a new job)\b/i.test(text)) {
    return 'Congratulations. I would be delighted to help make the occasion special.';
  }
  return undefined;
}

function chooseHumanLead(eventLead?: string, proposed?: string): string | undefined {
  const lead = safeProposedLead(proposed);
  if (!eventLead) return lead;
  if (!lead) return eventLead;
  if (/sorry for your loss/i.test(eventLead) && !/\b(sorry|condolen|sympath|difficult|hard)\b/i.test(lead)) return eventLead;
  if (/sorry you're going through this/i.test(eventLead) && !/\b(sorry|sympath|difficult|hard|hope)\b/i.test(lead)) return eventLead;
  if (/congratulations/i.test(eventLead) && !/\b(congrat|celebrat|wonderful|special|delighted|happy for you)\b/i.test(lead)) return eventLead;
  return lead;
}

export function safeProposedLead(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || text.length > 260 || /[?\n\r\u001e]|https?:\/\//i.test(text)) return undefined;
  if (/\b(booked|reserved|confirmed|paid|charged|secured|scheduled|sent|available now|live price)\b/i.test(text)) return undefined;
  return text;
}

function resolveChoice(text: string): string | undefined {
  const choice = text.trim().toLowerCase();
  if (/^(1|hotel|stay|place to stay|accommodation)$/.test(choice)) return 'Find a hotel';
  if (/^(2|activity|activities|things to do|excursion|tour)$/.test(choice)) return 'Find activities';
  if (/^(3|dining|restaurant|food|transport|taxi|transfer)$/.test(choice)) {
    return /transport|taxi|transfer/.test(choice) ? 'Arrange transport' : 'Find a restaurant';
  }
  return undefined;
}

export function joinConciergeBubbles(first: string, second: string): string {
  return `${first}${CONCIERGE_BUBBLE_SEPARATOR}${second}`;
}

export function unfinishedRequestHint(session: OrchestrationSessionSnapshot, text: string, now = Date.now()): string | null {
  if (!/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text.trim())) return null;
  if (!session.missingFields.length || !session.updatedAt || now - Date.parse(session.updatedAt) < 30 * 60 * 1000) return null;
  const name = { hotel: 'hotel', restaurant: 'dining', excursion: 'activity', logistics: 'transport',
    itinerary: 'trip plan', profile: 'profile', none: 'travel' }[session.flow];
  return `Welcome back. Your ${name} request is still here. Would you like to continue with the remaining details?`;
}

let concierge: ConciergeConversationService | null = null;
export function getConciergeConversationService(): ConciergeConversationService {
  if (!concierge) concierge = new ConciergeConversationService();
  return concierge;
}
export function initConciergeConversationService(service: ConciergeConversationService): void { concierge = service; }
