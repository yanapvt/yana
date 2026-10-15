import { getStateStore, type StateStore } from './StateStore.js';

type SupportNeed = 'roadside' | 'headache';

interface PendingSupportRequest {
  need: SupportNeed;
  updatedAt: string;
}

interface PlaceResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

interface PlacesResponse {
  places?: PlaceResult[];
}

interface OutOfScopeSupportDependencies {
  store?: StateStore;
  apiKey?: string;
  fetcher?: typeof fetch;
}

const SUPPORT_TTL_SECONDS = 15 * 60;
const EMERGENCY_LANGUAGE = /\b(?:can't breathe|cannot breathe|difficulty breathing|unconscious|passed out|severe bleeding|chest pain|heart attack|stroke|face drooping|sudden weakness|numbness|confused|worst headache|severe headache|sudden severe headache|stiff neck|life.?threatening|in danger|crash|collision|on the highway|in traffic)\b/i;

/** Safe, non-booking referrals for travel needs YANA does not directly provide. */
export class OutOfScopeSupportService {
  private readonly store: StateStore;
  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;

  constructor(dependencies: OutOfScopeSupportDependencies = {}) {
    this.store = dependencies.store ?? getStateStore();
    this.apiKey = dependencies.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
    this.fetcher = dependencies.fetcher ?? fetch;
  }

  async handleMessage(userId: string, message: string): Promise<string | null> {
    const need = detectSupportNeed(message);
    if (need) {
      await this.savePending(userId, need);
      return buildInitialReply(need, message);
    }

    const pending = await this.getPending(userId);
    if (!pending) return null;

    if (/\b(?:cancel|never mind|nevermind|stop|forget it|reset|start over)\b/i.test(message)) {
      await this.clear(userId);
      return 'Of course—I’ll leave that there. I can still help with YANA travel services such as stays, restaurants, excursions, or transport.';
    }

    if (EMERGENCY_LANGUAGE.test(message)) {
      return buildUrgentSafetyReply(pending.need);
    }

    const area = normalizeArea(message);
    if (!area) {
      return 'To look up nearby options, please send just the nearest town, neighbourhood, or landmark. Please don’t share your exact live location or personal medical details here.';
    }

    await this.clear(userId);
    const results = await this.searchNearby(pending.need, area);
    return buildNearbyReply(pending.need, area, results, Boolean(this.apiKey));
  }

  private async searchNearby(need: SupportNeed, area: string): Promise<PlaceResult[]> {
    if (!this.apiKey) return [];

    const query = need === 'roadside'
      ? `tyre repair and roadside assistance near ${area}`
      : `medical clinic near ${area}`;
    try {
      const response = await this.fetcher('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri',
        },
          body: JSON.stringify({ textQuery: query, maxResultCount: 3, languageCode: 'en' }),
          signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        // Never expose provider errors to the customer; the safe fallback is a Maps search link.
        console.warn('[OutOfScopeSupport] Nearby Places lookup failed', { status: response.status });
        return [];
      }

      const payload = await response.json() as PlacesResponse;
      return (payload.places ?? []).slice(0, 3);
    } catch (error) {
      console.warn('[OutOfScopeSupport] Nearby Places lookup failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return [];
    }
  }

  private async getPending(userId: string): Promise<PendingSupportRequest | null> {
    const pending = await this.store.getJson<PendingSupportRequest>(this.getKey(userId));
    if (!pending) return null;
    const age = Date.now() - Date.parse(pending.updatedAt);
    if (!Number.isFinite(age) || age > SUPPORT_TTL_SECONDS * 1000) {
      await this.clear(userId);
      return null;
    }
    return pending;
  }

  private async savePending(userId: string, need: SupportNeed): Promise<void> {
    await this.store.setJson(this.getKey(userId), { need, updatedAt: new Date().toISOString() }, SUPPORT_TTL_SECONDS);
  }

  private async clear(userId: string): Promise<void> {
    await this.store.deleteKey(this.getKey(userId));
  }

  private getKey(userId: string): string {
    return `out-of-scope-support:${userId.replace(/[^a-zA-Z0-9:+-]/g, '_')}`;
  }
}

function detectSupportNeed(message: string): SupportNeed | null {
  if (/\b(?:flat tyre|flat tire|puncture|blown tyre|blown tire|tyre repair|tire repair|wheel puncture)\b/i.test(message)) return 'roadside';
  if (/\b(?:headache|migraine|head hurts|head pain)\b/i.test(message)) return 'headache';
  return null;
}

function buildInitialReply(need: SupportNeed, message: string): string {
  if (EMERGENCY_LANGUAGE.test(message)) return buildUrgentSafetyReply(need);

  if (need === 'roadside') {
    return 'I’m sorry—that’s frustrating. YANA doesn’t provide tyre repair or roadside assistance. First, please get yourself and everyone with you to a safe place away from moving traffic; only change a tyre if it’s safe. Are you somewhere safe now? If you share the nearest town or landmark, I can look up nearby tyre services. Once you’re safe, I can also help with YANA travel options such as transport.';
  }

  return 'I’m sorry you’re dealing with a headache. YANA can’t assess symptoms or give medical advice. If it’s sudden or severe, getting worse, or you feel seriously unwell, contact local emergency services or a medical professional now. If it’s not urgent and you’d like, share only the nearest town or landmark and I can look up nearby clinics. After that, I can help with travel needs such as transport or accommodation.';
}

function buildUrgentSafetyReply(need: SupportNeed): string {
  const advice = need === 'roadside'
    ? 'Please prioritize getting away from moving traffic if you can do so safely, and contact local emergency or roadside assistance now.'
    : 'Please contact local emergency services or seek urgent medical care now. I can’t assess symptoms or provide medical advice.';
  return `I’m sorry—this may need urgent help. YANA does not provide emergency ${need === 'roadside' ? 'roadside' : 'medical'} services. ${advice} If someone is in immediate danger, call your local emergency number. Please don’t wait for a Places search or a reply from YANA.`;
}

function normalizeArea(message: string): string | null {
  const area = message.trim()
    .replace(/^(?:yes[, ]*)?(?:i(?:'m| am)\s+)?(?:i am safe\s+)?(?:safe\s+)?(?:currently\s+)?(?:in|at|near|around)\s+/i, '')
    .replace(/^yes[, ]+/i, '')
    .replace(/^(?:i(?:'m| am)\s+)?safe[, ]+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (area.length < 2 || area.length > 100 || EMERGENCY_LANGUAGE.test(area)) return null;
  if (/^(?:yes|no|okay|ok|safe|not safe|i am safe|i'm safe)$/i.test(area)) return null;
  return area;
}

function buildNearbyReply(need: SupportNeed, area: string, places: PlaceResult[], configured: boolean): string {
  const category = need === 'roadside' ? 'tyre services' : 'medical clinics';
  const lines = places.map((place, index) => {
    const name = place.displayName?.text ?? 'Nearby place';
    const rating = typeof place.rating === 'number'
      ? ` · ${place.rating.toFixed(1)}/5${place.userRatingCount ? ` (${place.userRatingCount} reviews)` : ''}`
      : '';
    return `${index + 1}. ${name}${rating}${place.formattedAddress ? `\n${place.formattedAddress}` : ''}${place.googleMapsUri ? `\n${place.googleMapsUri}` : ''}`;
  });

  const resultsText = places.length
    ? `Here are some Google Maps listings near ${area}:\n\n${lines.join('\n\n')}\n\nPlease contact the provider directly to check they’re open and can help. These are search results, not recommendations or verified services.`
    : configured
      ? `I couldn’t retrieve nearby ${category} just now. You can search Google Maps for “${need === 'roadside' ? 'tyre repair' : 'medical clinic'} near ${area}”.`
      : `Nearby search isn’t available at the moment. You can search Google Maps for “${need === 'roadside' ? 'tyre repair' : 'medical clinic'} near ${area}”.`;

  const boundary = need === 'roadside'
    ? 'YANA does not provide or guarantee roadside repairs.'
    : 'YANA does not provide medical care or assess providers.';
  const redirect = need === 'roadside'
    ? 'When you’re safe, I can also help with YANA travel transport, stays, restaurants, or excursions.'
    : 'If you need help getting somewhere, I can also help with YANA travel transport or accommodation.';
  return `${resultsText}\n\n${boundary} ${redirect}`;
}

let instance: OutOfScopeSupportService | null = null;
export function getOutOfScopeSupportService(): OutOfScopeSupportService {
  if (!instance) instance = new OutOfScopeSupportService();
  return instance;
}
