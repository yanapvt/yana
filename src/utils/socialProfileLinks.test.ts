import { describe, expect, it } from 'vitest';
import { socialProfileFromWebsiteUri } from './socialProfileLinks.js';

describe('socialProfileFromWebsiteUri', () => {
  it.each([
    ['https://www.instagram.com/yana_travel/', 'instagram'],
    ['https://facebook.com/yana.travel', 'facebook'],
  ])('accepts a direct public social profile: %s', (url, platform) => {
    expect(socialProfileFromWebsiteUri(url)).toEqual({ platform, url });
  });

  it.each([
    'http://instagram.com/insecure',
    'https://example.com/vendor',
    'https://instagram.com/p/not-a-profile',
    'https://facebook.com/sharer/share.php',
    'not a url',
  ])('rejects a non-profile or unsafe URL: %s', (url) => {
    expect(socialProfileFromWebsiteUri(url)).toBeUndefined();
  });
});
