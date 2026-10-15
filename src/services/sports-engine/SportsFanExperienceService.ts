import {
  FanPreferences,
  RankedSportsContent,
  SportsContentItem,
  SportsContentProvider,
  SportsFeed,
} from './types.js';

const MAX_WHATSAPP_BATCH = 3;

function normalized(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function scoreItem(item: SportsContentItem, preferences: FanPreferences): RankedSportsContent {
  const sports = normalized(preferences.sports);
  const teams = normalized(preferences.teams);
  const topics = normalized(preferences.topics);
  const reasons: string[] = [];
  let score = 0;

  if (sports.has(item.sport.toLowerCase())) {
    score += 30;
    reasons.push(`Matches your ${item.sport} interest`);
  }
  if (item.teams.some((team) => teams.has(team.toLowerCase()))) {
    score += 25;
    reasons.push('Features a team you follow');
  }
  if (item.topics.some((topic) => topics.has(topic.toLowerCase()))) {
    score += 15;
    reasons.push('Matches a topic you chose');
  }
  if (preferences.prioritizeWomensSport && item.womenInSport) {
    score += 25;
    reasons.push("Amplifies women's sport");
  }
  if (preferences.accessibilityMode) {
    score += 5;
    reasons.push('Available as concise screen-reader-friendly text');
  }

  return { ...item, relevanceScore: score, reasons };
}

export class SportsFanExperienceService {
  constructor(private readonly providers: SportsContentProvider[]) {}

  async buildFeed(preferences: FanPreferences): Promise<SportsFeed> {
    const settled = await Promise.allSettled(
      this.providers.map(async (provider) => ({
        provider: provider.name,
        items: await provider.getContent(preferences),
      }))
    );

    const failedProviders: string[] = [];
    const byId = new Map<string, SportsContentItem>();

    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedProviders.push(this.providers[index].name);
        return;
      }
      for (const item of result.value.items) {
        if (item.source.provider && item.source.retrievedAt && !byId.has(item.id)) {
          byId.set(item.id, item);
        }
      }
    });

    const ranked = [...byId.values()]
      .map((item) => scoreItem(item, preferences))
      .sort((a, b) => b.relevanceScore - a.relevanceScore || a.title.localeCompare(b.title));

    const visibleWomenItems = ranked.filter((item) => item.womenInSport);
    const otherItems = ranked.filter((item) => !item.womenInSport);
    const ordered = preferences.prioritizeWomensSport
      ? [...visibleWomenItems, ...otherItems]
      : ranked;

    return {
      items: ordered.slice(0, MAX_WHATSAPP_BATCH),
      failedProviders,
      disclaimer:
        'Fixture times and official facts must be verified against the linked authoritative source.',
    };
  }
}
