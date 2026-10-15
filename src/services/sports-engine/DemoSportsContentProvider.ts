import { FanPreferences, SportsContentItem, SportsContentProvider } from './types.js';

/** Fictional, clearly labelled content for the hackathon prototype. */
export class DemoSportsContentProvider implements SportsContentProvider {
  readonly name = 'hackathon-demo';

  async getContent(_preferences: FanPreferences): Promise<SportsContentItem[]> {
    const retrievedAt = new Date().toISOString();
    return [
      {
        id: 'demo-womens-cricket-1',
        kind: 'athlete_story',
        title: 'The captain who built a community nets programme',
        summary:
          'A short, fictional demo story showing how verified athlete journeys can inspire new fans.',
        sport: 'cricket',
        competition: 'YANA Play demo',
        teams: ['Sri Lanka'],
        topics: ['athlete stories', 'community'],
        womenInSport: true,
        callToAction: 'Hear the 60-second story',
        source: { provider: this.name, retrievedAt, authoritative: false },
      },
      {
        id: 'demo-womens-cricket-2',
        kind: 'fan_challenge',
        title: 'Predict the powerplay — together',
        summary:
          'Make a free prediction, compare with friends, and unlock a women’s cricket explainer.',
        sport: 'cricket',
        competition: 'YANA Play demo',
        teams: ['India', 'Sri Lanka'],
        topics: ['predictions', 'learn cricket'],
        womenInSport: true,
        callToAction: 'Play the demo challenge',
        source: { provider: this.name, retrievedAt, authoritative: false },
      },
      {
        id: 'demo-womens-football-1',
        kind: 'fixture',
        title: 'Discover a women’s football watch party',
        summary:
          'A fictional cross-sport example demonstrating how the same platform grows local communities.',
        sport: 'football',
        competition: 'YANA Play demo',
        teams: [],
        topics: ['community', 'watch party'],
        womenInSport: true,
        callToAction: 'Find an accessible venue',
        source: { provider: this.name, retrievedAt, authoritative: false },
      },
      {
        id: 'demo-cricket-quiz-1',
        kind: 'fan_challenge',
        title: 'Three-ball cricket quiz',
        summary: 'A quick mobile-first quiz designed for new and younger fans.',
        sport: 'cricket',
        competition: 'YANA Play demo',
        teams: [],
        topics: ['quiz', 'learn cricket'],
        womenInSport: false,
        callToAction: 'Start the quiz',
        source: { provider: this.name, retrievedAt, authoritative: false },
      },
    ];
  }
}
