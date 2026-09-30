import { getStateStore, type StateStore } from './StateStore.js';

export type JourneyMode = 'chat' | 'explore' | 'booking';
export type JourneyService = 'hotel' | 'restaurant' | 'excursion' | 'transport' | 'itinerary';

export interface TravelJourneyState {
  mode: JourneyMode;
  activeService?: JourneyService;
  updatedAt: string;
}

export interface JourneyModeInput {
  message: string;
  activeService?: JourneyService;
  bookingStageActive?: boolean;
}

export function resolveJourneyMode(input: JourneyModeInput): JourneyMode {
  const message = input.message.trim();
  if (
    input.bookingStageActive ||
    /\b(?:book\s*\d+|book now|ready to book|want to book|make a booking|reserve|reservation|purchase|pay for)\b/i.test(message)
  ) {
    return 'booking';
  }
  if (/\b(explore|exploring|browse|browsing|ideas|inspiration|suggestions)\b/i.test(message)) {
    return 'explore';
  }
  return input.activeService ? 'explore' : 'chat';
}

const JOURNEY_STATE_TTL_SECONDS = 60 * 60 * 24 * 7;

export class TravelJourneyStateService {
  constructor(private readonly store: StateStore = getStateStore()) {}

  async get(userId: string): Promise<TravelJourneyState | null> {
    return this.store.getJson<TravelJourneyState>(this.getKey(userId));
  }

  async set(
    userId: string,
    mode: JourneyMode,
    activeService?: JourneyService | null
  ): Promise<TravelJourneyState> {
    const state: TravelJourneyState = {
      mode,
      activeService: activeService ?? undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.store.setJson(this.getKey(userId), state, JOURNEY_STATE_TTL_SECONDS);
    return state;
  }

  async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
  }

  private getKey(userId: string): string {
    return `travel-journey:${userId.replace(/[^a-zA-Z0-9:+-]/g, '_')}`;
  }
}

let travelJourneyStateServiceInstance: TravelJourneyStateService | null = null;

export function getTravelJourneyStateService(): TravelJourneyStateService {
  if (!travelJourneyStateServiceInstance) {
    travelJourneyStateServiceInstance = new TravelJourneyStateService();
  }
  return travelJourneyStateServiceInstance;
}
