import { getStateStore } from './StateStore.js';
import { getLLMService } from './LLMService.js';

type HotelField =
  | 'location'
  | 'checkinDate'
  | 'checkoutDate'
  | 'guests'
  | 'boardBasis'
  | 'budgetPerNight';

export interface HotelSearchCriteria {
  location?: string;
  checkinDate?: string;
  checkoutDate?: string;
  guests?: number;
  rooms?: number;
  starRating?: string;
  hotelType?: string;
  facilities?: string;
  bedPreference?: string;
  specialOccasion?: string;
  additionalPreferences?: string;
  boardBasis?: 'room_only' | 'bnb' | 'half_board' | 'full_board' | 'all_inclusive';
  budgetPerNight?: {
    amount: number;
    currency: string;
  };
}

interface TravelerProfile {
  whatsappNumber: string;
  profileName?: string;
  country?: string;
  countryCode?: string;
  hotelPreferences?: Partial<HotelSearchCriteria>;
  updatedAt: string;
}

interface HotelIntakeState {
  intent: 'search_hotels';
  criteria: HotelSearchCriteria;
  pendingField?: HotelField;
  profile: TravelerProfile;
  updatedAt: string;
}

interface LoadedHotelIntakeState {
  state: HotelIntakeState;
  active: boolean;
}

interface LLMHotelCriteriaExtraction {
  location?: string;
  checkinDate?: string;
  checkoutDate?: string;
  guests?: number;
  boardBasis?: HotelSearchCriteria['boardBasis'];
  budgetPerNight?: {
    amount: number;
    currency: string;
  };
}

export interface HotelIntakeContext {
  whatsappNumber: string;
  profileName?: string;
  country?: string;
  countryCode?: string;
}

export interface HotelIntakeResult {
  handled: boolean;
  reply?: string;
  completed?: boolean;
  criteria?: HotelSearchCriteria;
}

const HOTEL_STATE_TTL_SECONDS = 60 * 60 * 24 * 7;
const HOTEL_FIELDS: HotelField[] = [
  'location',
  'checkinDate',
  'checkoutDate',
  'guests',
  'budgetPerNight',
];

const FIELD_PROMPTS: Record<HotelField, string> = {
  location: 'Where would you like to stay?',
  checkinDate: 'What is your check-in date? You can type it like 2026-06-12, tomorrow, or next Friday.',
  checkoutDate: 'What is your check-out date?',
  guests: 'How many people are travelling?',
  boardBasis: 'What meal plan do you prefer: room only, B&B, half board, full board, or all inclusive?',
  budgetPerNight: 'What is your maximum budget per night, and in which currency? For example: USD 50 per night.',
};

export class HotelIntakeService {
  constructor(private readonly referenceDate: Date = new Date()) {}

  async handleMessage(
    message: string,
    context: HotelIntakeContext
  ): Promise<HotelIntakeResult> {
    const { state, active } = await this.loadOrCreateState(message, context);

    if (!active && !this.isHotelMessage(message) && state.criteria.location === undefined) {
      return { handled: false };
    }

    const extracted = await this.extractCriteria(message, state.pendingField);
    state.criteria = {
      ...state.criteria,
      ...extracted,
    };
    this.applyDerivedCriteria(state.criteria, message);
    state.pendingField = this.getNextMissingField(state.criteria);
    state.updatedAt = new Date().toISOString();
    state.profile = this.updateProfile(state.profile, context, state.criteria);

    await this.saveState(context.whatsappNumber, state);
    await this.saveProfile(state.profile);

    if (state.pendingField) {
      return {
        handled: true,
        reply: this.buildProgressReply(state.criteria, state.pendingField),
      };
    }

    const reply = await this.buildCompletedSearchReply(state.criteria);
    await this.saveProfile({
      ...state.profile,
      hotelPreferences: state.criteria,
      updatedAt: new Date().toISOString(),
    });
    await this.clearState(context.whatsappNumber);

    return {
      handled: true,
      reply,
      completed: true,
      criteria: state.criteria,
    };
  }

  private async loadOrCreateState(
    message: string,
    context: HotelIntakeContext
  ): Promise<LoadedHotelIntakeState> {
    const store = getStateStore();
    const state = await store.getJson<HotelIntakeState>(
      this.getHotelStateKey(context.whatsappNumber)
    );

    if (state) {
      return {
        active: true,
        state: {
          ...state,
          profile: this.updateProfile(state.profile, context, state.criteria),
        },
      };
    }

    const profile =
      (await store.getJson<TravelerProfile>(
        this.getTravelerProfileKey(context.whatsappNumber)
      )) ?? this.createProfile(context);

    return {
      active: false,
      state: {
        intent: 'search_hotels',
        criteria: this.isHotelMessage(message) ? { ...profile.hotelPreferences } : {},
        profile: this.updateProfile(profile, context, profile.hotelPreferences ?? {}),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  private async buildCompletedSearchReply(
    criteria: HotelSearchCriteria
  ): Promise<string> {
    const summary = this.formatCriteria(criteria);

    return `Perfect, I have the hotel search details: ${summary}. I am ready to search live property matches once Google Places is configured for this environment.`;
  }

  private buildProgressReply(
    criteria: HotelSearchCriteria,
    pendingField: HotelField
  ): string {
    const collected = this.formatCriteria(criteria);
    const prefix = collected
      ? `Got it. So far I have: ${collected}.\n\n`
      : '';

    return `${prefix}${FIELD_PROMPTS[pendingField]}`;
  }

  private async extractCriteria(
    message: string,
    pendingField?: HotelField
  ): Promise<Partial<HotelSearchCriteria>> {
    const criteria: Partial<HotelSearchCriteria> = {};

    const location = this.extractLocation(message);
    if (location) {
      criteria.location = location;
    }

    const budget = this.extractBudget(message);
    if (budget) {
      criteria.budgetPerNight = budget;
    }

    const guests = this.extractGuests(message);
    if (guests) {
      criteria.guests = guests;
    }

    const boardBasis = this.extractBoardBasis(message);
    if (boardBasis) {
      criteria.boardBasis = boardBasis;
    }

    const dates = this.extractDates(message);
    if (dates[0]) {
      if (pendingField === 'checkoutDate') {
        criteria.checkoutDate = dates[0];
      } else {
        criteria.checkinDate = dates[0];
      }
    }
    if (dates[1]) {
      criteria.checkoutDate = dates[1];
    }

    if (pendingField && Object.keys(criteria).length === 0) {
      this.assignPendingField(criteria, pendingField, message);
    }

    return {
      ...criteria,
      ...(await this.extractCriteriaWithLLM(message, criteria)),
    };
  }

  private assignPendingField(
    criteria: Partial<HotelSearchCriteria>,
    pendingField: HotelField,
    message: string
  ): void {
    const trimmed = message.trim();

    if (!trimmed) {
      return;
    }

    switch (pendingField) {
      case 'location':
        criteria.location = trimmed;
        return;
      case 'checkinDate':
        criteria.checkinDate = trimmed;
        return;
      case 'checkoutDate':
        criteria.checkoutDate = trimmed;
        return;
      case 'guests': {
        const guests = parseInt(trimmed, 10);
        if (Number.isFinite(guests) && guests > 0) {
          criteria.guests = guests;
        }
        return;
      }
      case 'boardBasis':
        criteria.boardBasis = this.extractBoardBasis(trimmed) ?? 'bnb';
        return;
      case 'budgetPerNight': {
        const budget = this.extractBudget(trimmed);
        if (budget) {
          criteria.budgetPerNight = budget;
        }
        return;
      }
    }
  }

  private extractLocation(message: string): string | null {
    const match =
      message.match(/\bin\s+([a-zA-Z][a-zA-Z0-9\s'-]{1,40})(?:\s|$|,|\.)/i) ??
      message.match(/\bnear\s+([a-zA-Z][a-zA-Z0-9\s'-]{1,40})(?:\s|$|,|\.)/i);

    if (!match) {
      return null;
    }

    return this.titleCase(
      match[1]
        .replace(/\bunder\b.*$/i, '')
        .replace(/\bbelow\b.*$/i, '')
        .replace(/\bchecking\b.*$/i, '')
        .replace(/\bcheck(?:ing)?\s+in\b.*$/i, '')
        .replace(/\bfor\b.*$/i, '')
        .trim()
    );
  }

  private extractBudget(
    message: string
  ): HotelSearchCriteria['budgetPerNight'] | null {
    const keywordMatch = message.match(
      /\b(?:under|max|maximum|budget|below)\s*(?:of\s*)?([A-Z]{3})?\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*\$?/i
    );
    const currencyFirstNightMatch = message.match(
      /\b([A-Z]{3})\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:per night|\/night|night)\b/i
    );
    const amountFirstNightMatch = message.match(
      /\$?\s*(\d+(?:\.\d{1,2})?)\s*\$?\s*(?:[A-Z]{3})?\s*(?:per night|\/night|night)\b/i
    );

    if (!keywordMatch && !currencyFirstNightMatch && !amountFirstNightMatch) {
      return null;
    }

    const amount = Number(
      keywordMatch?.[2] ?? currencyFirstNightMatch?.[2] ?? amountFirstNightMatch?.[1]
    );
    const currencyMatch = message.match(/\b(USD|EUR|GBP|LKR|AUD|CAD|INR)\b/i);
    const hasDollar = message.includes('$');

    return {
      amount,
      currency: currencyMatch?.[1]?.toUpperCase() ?? (hasDollar ? 'USD' : 'USD'),
    };
  }

  private extractGuests(message: string): number | null {
    const match =
      message.match(/\b(\d{1,2})\s*(?:people|persons|guests|adults|travellers|travelers|pax)\b/i) ??
      message.match(/\b(?:just\s+)?(?:the\s+)?(?:two|2)\s+of\s+us\b/i) ??
      message.match(/\bwith\s+my\s+(?:wife|husband|partner|spouse)\b/i);
    if (!match) {
      return null;
    }

    const guests = match[1] ? Number(match[1]) : 2;
    return guests > 0 ? guests : null;
  }

  private extractBoardBasis(
    message: string
  ): HotelSearchCriteria['boardBasis'] | null {
    const normalized = message.toLowerCase();

    if (/\ball inclusive\b/.test(normalized)) return 'all_inclusive';
    if (/\bfull board\b|\bfb\b/.test(normalized)) return 'full_board';
    if (/\bhalf board\b|\bhb\b/.test(normalized)) return 'half_board';
    if (/\bb&b\b|\bbnb\b|bed and breakfast|breakfast included/.test(normalized)) return 'bnb';
    if (/room only|no meals/.test(normalized)) return 'room_only';

    return null;
  }

  private extractDates(message: string): string[] {
    const explicitDates = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    if (explicitDates.length > 0) {
      return explicitDates;
    }

    const relativeDates: string[] = [];
    if (/\btoday\b/i.test(message)) relativeDates.push(this.formatDateOffset(0));
    if (/\btomorrow\b/i.test(message)) relativeDates.push(this.formatDateOffset(1));
    if (/\bday after tomorrow\b|\bthe day after\b/i.test(message)) {
      relativeDates.push(this.formatDateOffset(2));
    }
    if (/\bnext friday\b/i.test(message)) relativeDates.push(this.formatNextWeekday(5));
    if (/\bnext saturday\b/i.test(message)) relativeDates.push(this.formatNextWeekday(6));
    if (/\bnext sunday\b/i.test(message)) relativeDates.push(this.formatNextWeekday(0));

    return relativeDates;
  }

  private applyDerivedCriteria(criteria: HotelSearchCriteria, message: string): void {
    if (!criteria.checkoutDate && criteria.checkinDate) {
      const nights = this.extractNightCount(message);
      if (nights) {
        criteria.checkoutDate = this.addDaysToDateString(criteria.checkinDate, nights);
      }
    }
  }

  private extractNightCount(message: string): number | null {
    const numericMatch = message.match(/\b(\d{1,2})\s*nights?\b/i);
    if (numericMatch) {
      return Number(numericMatch[1]);
    }

    if (/\btwo\s+nights?\b/i.test(message)) return 2;
    if (/\bone\s+night\b/i.test(message)) return 1;
    if (/\bthree\s+nights?\b/i.test(message)) return 3;

    return null;
  }

  private async extractCriteriaWithLLM(
    message: string,
    deterministicCriteria: Partial<HotelSearchCriteria>
  ): Promise<Partial<HotelSearchCriteria>> {
    if (!this.shouldUseLLMExtraction()) {
      return {};
    }

    try {
      const response = await getLLMService().generateUIContent(
        [
          'Extract only hotel search criteria from this user message.',
          'Return JSON only. Do not add prose.',
          'Use keys: location, checkinDate, checkoutDate, guests, boardBasis, budgetPerNight.',
          'Use YYYY-MM-DD dates. Resolve relative dates using this base date:',
          this.formatDate(this.referenceDate),
          'Use boardBasis only if explicit: room_only, bnb, half_board, full_board, all_inclusive.',
          'Use budgetPerNight as {"amount": number, "currency": "USD"} when present.',
          `Already extracted: ${JSON.stringify(deterministicCriteria)}`,
          `Message: ${message}`,
        ].join('\n')
      );
      const parsed = JSON.parse(this.extractJson(response)) as LLMHotelCriteriaExtraction;
      return this.sanitizeLLMExtraction(parsed);
    } catch (error) {
      console.warn('[HotelIntakeService] LLM criteria extraction failed, using deterministic extraction:', error);
      return {};
    }
  }

  private shouldUseLLMExtraction(): boolean {
    return (
      process.env.HOTEL_INTAKE_LLM_EXTRACTION_ENABLED === 'true' &&
      Boolean(process.env.LLM_API_KEY && process.env.LLM_API_KEY !== 'dev_api_key')
    );
  }

  private sanitizeLLMExtraction(
    parsed: LLMHotelCriteriaExtraction
  ): Partial<HotelSearchCriteria> {
    const criteria: Partial<HotelSearchCriteria> = {};

    if (typeof parsed.location === 'string' && parsed.location.trim()) {
      criteria.location = this.titleCase(parsed.location.trim());
    }

    if (typeof parsed.checkinDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.checkinDate)) {
      criteria.checkinDate = parsed.checkinDate;
    }

    if (typeof parsed.checkoutDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.checkoutDate)) {
      criteria.checkoutDate = parsed.checkoutDate;
    }

    if (typeof parsed.guests === 'number' && Number.isFinite(parsed.guests) && parsed.guests > 0) {
      criteria.guests = parsed.guests;
    }

    if (
      parsed.boardBasis &&
      ['room_only', 'bnb', 'half_board', 'full_board', 'all_inclusive'].includes(parsed.boardBasis)
    ) {
      criteria.boardBasis = parsed.boardBasis;
    }

    if (
      parsed.budgetPerNight &&
      typeof parsed.budgetPerNight.amount === 'number' &&
      Number.isFinite(parsed.budgetPerNight.amount)
    ) {
      criteria.budgetPerNight = {
        amount: parsed.budgetPerNight.amount,
        currency:
          typeof parsed.budgetPerNight.currency === 'string'
            ? parsed.budgetPerNight.currency.toUpperCase()
            : 'USD',
      };
    }

    return criteria;
  }

  private extractJson(response: string): string {
    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return response.slice(firstBrace, lastBrace + 1);
    }

    return response;
  }

  private formatDateOffset(days: number): string {
    return this.formatDate(this.addDays(this.referenceDate, days));
  }

  private formatNextWeekday(targetDay: number): string {
    const currentDay = this.referenceDate.getDay();
    let offset = (targetDay - currentDay + 7) % 7;
    if (offset === 0) {
      offset = 7;
    }
    return this.formatDateOffset(offset);
  }

  private addDaysToDateString(dateString: string, days: number): string {
    return this.formatDate(this.addDays(new Date(`${dateString}T00:00:00`), days));
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getNextMissingField(criteria: HotelSearchCriteria): HotelField | undefined {
    return HOTEL_FIELDS.find((field) => !this.hasField(criteria, field));
  }

  private hasField(criteria: HotelSearchCriteria, field: HotelField): boolean {
    const value = criteria[field];
    return value !== undefined && value !== null && value !== '';
  }

  private formatCriteria(criteria: HotelSearchCriteria): string {
    const parts: string[] = [];

    if (criteria.location) parts.push(`location ${criteria.location}`);
    if (criteria.checkinDate) parts.push(`check-in ${criteria.checkinDate}`);
    if (criteria.checkoutDate) parts.push(`check-out ${criteria.checkoutDate}`);
    if (criteria.guests) parts.push(`${criteria.guests} guest${criteria.guests === 1 ? '' : 's'}`);
    if (criteria.boardBasis) parts.push(`meal plan ${this.formatBoardBasis(criteria.boardBasis)}`);
    if (criteria.budgetPerNight) {
      parts.push(`budget ${criteria.budgetPerNight.currency} ${criteria.budgetPerNight.amount} per night`);
    }

    return parts.join(', ');
  }

  private formatBoardBasis(boardBasis: NonNullable<HotelSearchCriteria['boardBasis']>): string {
    const labels = {
      room_only: 'room only',
      bnb: 'B&B',
      half_board: 'half board',
      full_board: 'full board',
      all_inclusive: 'all inclusive',
    };

    return labels[boardBasis];
  }

  private isHotelMessage(message: string): boolean {
    return /\b(hotel|hotels|stay|stays|accommodation|room|resort|bnb|b&b)\b/i.test(message);
  }

  private createProfile(context: HotelIntakeContext): TravelerProfile {
    return {
      whatsappNumber: context.whatsappNumber,
      profileName: context.profileName,
      country: context.country,
      countryCode: context.countryCode,
      updatedAt: new Date().toISOString(),
    };
  }

  private updateProfile(
    profile: TravelerProfile,
    context: HotelIntakeContext,
    criteria: Partial<HotelSearchCriteria>
  ): TravelerProfile {
    return {
      ...profile,
      whatsappNumber: context.whatsappNumber,
      profileName: context.profileName ?? profile.profileName,
      country: context.country ?? profile.country,
      countryCode: context.countryCode ?? profile.countryCode,
      hotelPreferences: {
        ...profile.hotelPreferences,
        ...criteria,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private async saveState(
    whatsappNumber: string,
    state: HotelIntakeState
  ): Promise<void> {
    await getStateStore().setJson(
      this.getHotelStateKey(whatsappNumber),
      state,
      HOTEL_STATE_TTL_SECONDS
    );
  }

  private async clearState(whatsappNumber: string): Promise<void> {
    await getStateStore().deleteKey(this.getHotelStateKey(whatsappNumber));
  }

  private async saveProfile(profile: TravelerProfile): Promise<void> {
    await getStateStore().setJson(
      this.getTravelerProfileKey(profile.whatsappNumber),
      profile,
      HOTEL_STATE_TTL_SECONDS
    );
  }

  private getHotelStateKey(whatsappNumber: string): string {
    return `traveler:${this.normalizePhoneKey(whatsappNumber)}:hotel-intake`;
  }

  private getTravelerProfileKey(whatsappNumber: string): string {
    return `traveler:${this.normalizePhoneKey(whatsappNumber)}:profile`;
  }

  private normalizePhoneKey(whatsappNumber: string): string {
    return whatsappNumber.replace(/^whatsapp:/, '').replace(/[^\d+]/g, '');
  }

  private titleCase(value: string): string {
    return value.replace(/\w\S*/g, (word) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
  }
}

let hotelIntakeServiceInstance: HotelIntakeService | null = null;

export function getHotelIntakeService(): HotelIntakeService {
  if (!hotelIntakeServiceInstance) {
    hotelIntakeServiceInstance = new HotelIntakeService();
  }

  return hotelIntakeServiceInstance;
}
