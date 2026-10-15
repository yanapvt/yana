export type SportContentKind = 'fixture' | 'athlete_story' | 'fan_challenge';

export interface FanPreferences {
  sports: string[];
  teams: string[];
  topics: string[];
  language: string;
  accessibilityMode: boolean;
  prioritizeWomensSport: boolean;
}

export interface SportsContentItem {
  id: string;
  kind: SportContentKind;
  title: string;
  summary: string;
  sport: string;
  competition: string;
  teams: string[];
  topics: string[];
  womenInSport: boolean;
  startsAt?: string;
  callToAction: string;
  source: {
    provider: string;
    sourceUrl?: string;
    retrievedAt: string;
    authoritative: boolean;
  };
}

export interface RankedSportsContent extends SportsContentItem {
  relevanceScore: number;
  reasons: string[];
}

export interface SportsContentProvider {
  readonly name: string;
  getContent(preferences: FanPreferences): Promise<SportsContentItem[]>;
}

export interface SportsFeed {
  items: RankedSportsContent[];
  failedProviders: string[];
  disclaimer: string;
}
