import { describe, expect, it } from 'vitest';
import { SportsFanExperienceService } from './SportsFanExperienceService.js';
import { FanPreferences, SportsContentProvider } from './types.js';

const preferences: FanPreferences = {
  sports: ['cricket'],
  teams: ['Sri Lanka'],
  topics: ['community'],
  language: 'en',
  accessibilityMode: true,
  prioritizeWomensSport: true,
};

const provider: SportsContentProvider = {
  name: 'verified-feed',
  async getContent() {
    const base = {
      kind: 'athlete_story' as const,
      sport: 'cricket',
      competition: 'Test competition',
      teams: ['Sri Lanka'],
      topics: ['community'],
      callToAction: 'Read',
      source: {
        provider: 'verified-feed',
        retrievedAt: '2026-10-01T00:00:00.000Z',
        authoritative: true,
      },
    };
    return [
      { ...base, id: 'women', title: 'Women first', summary: 'Story', womenInSport: true },
      { ...base, id: 'open', title: 'Open story', summary: 'Story', womenInSport: false },
      { ...base, id: 'third', title: 'Third story', summary: 'Story', womenInSport: true },
      { ...base, id: 'fourth', title: 'Fourth story', summary: 'Story', womenInSport: true },
    ];
  },
};

describe('SportsFanExperienceService', () => {
  it('prioritizes women in sport and keeps the WhatsApp batch to three', async () => {
    const feed = await new SportsFanExperienceService([provider]).buildFeed(preferences);
    expect(feed.items).toHaveLength(3);
    expect(feed.items.every((item) => item.womenInSport)).toBe(true);
    expect(feed.items[0].reasons).toContain("Amplifies women's sport");
  });

  it('degrades safely when one content provider fails', async () => {
    const failing: SportsContentProvider = {
      name: 'offline-feed',
      async getContent() {
        throw new Error('provider details must not escape');
      },
    };
    const feed = await new SportsFanExperienceService([failing, provider]).buildFeed(preferences);
    expect(feed.failedProviders).toEqual(['offline-feed']);
    expect(feed.items).toHaveLength(3);
    expect(JSON.stringify(feed)).not.toContain('provider details must not escape');
  });

  it('drops content without provider provenance', async () => {
    const untrusted: SportsContentProvider = {
      name: 'untrusted',
      async getContent() {
        return [
          {
            ...(await provider.getContent(preferences))[0],
            source: { provider: '', retrievedAt: '', authoritative: false },
          },
        ];
      },
    };
    const feed = await new SportsFanExperienceService([untrusted]).buildFeed(preferences);
    expect(feed.items).toEqual([]);
  });
});
