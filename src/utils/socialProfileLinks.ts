export type SocialPlatform = 'instagram' | 'facebook';

export interface SocialProfileLink {
  platform: SocialPlatform;
  url: string;
}

/**
 * Google Places exposes an authoritative website URL, not dedicated social
 * fields. Treat it as a social profile only when the returned URL itself is a
 * direct Instagram or Facebook URL.
 */
export function socialProfileFromWebsiteUri(value?: string): SocialProfileLink | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const platform: SocialPlatform | undefined =
      host === 'instagram.com' || host.endsWith('.instagram.com')
        ? 'instagram'
        : host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com'
          ? 'facebook'
          : undefined;
    if (!platform || url.username || url.password || url.pathname === '/') return undefined;

    const firstSegment = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    const nonProfileSegments = new Set([
      'accounts', 'dialog', 'explore', 'help', 'l.php', 'login', 'p', 'reel', 'reels',
      'share', 'sharer', 'stories',
    ]);
    if (!firstSegment || nonProfileSegments.has(firstSegment)) return undefined;

    return { platform, url: url.toString() };
  } catch {
    return undefined;
  }
}

export function socialPlatformLabel(platform: SocialPlatform): string {
  return platform === 'instagram' ? 'Instagram' : 'Facebook';
}

export function socialPlatformIcon(platform: SocialPlatform): string {
  return platform === 'instagram' ? '📷' : '🔵';
}
