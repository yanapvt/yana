/** Weather is enrichment only. A forecast never changes a booking or search result. */
export class WeatherContextService {
  constructor(private readonly request: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  async outdoorAdvice(message: string, rememberedLocation?: string): Promise<string | null> {
    if (!/\b(outdoor|hike|hiking|safari|beach|surf|surfing|walking tour|boat|kayak|cycling)\b/i.test(message)) return null;
    if (!/\b(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(message)) return null;
    const location = message.match(/\b(?:in|around|near)\s+([\p{L}][\p{L} -]{1,60}?)(?=\s+(?:today|tomorrow|on\s+\d{4}-\d{2}-\d{2})|[.!?]|$)/iu)?.[1]?.trim()
      ?? (/\b(here|near me|nearby)\b/i.test(message) ? rememberedLocation : undefined);
    if (!location) return null;
    try {
      const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geocodeUrl.searchParams.set('name', location);
      geocodeUrl.searchParams.set('count', '3');
      const geocode = await this.request(geocodeUrl, { signal: AbortSignal.timeout(3500) });
      if (!geocode.ok) return null;
      const places = (await geocode.json() as { results?: Array<{ name: string; latitude: number; longitude: number; timezone?: string }> }).results ?? [];
      const place = places.find((item) => item.name.toLocaleLowerCase() === location.toLocaleLowerCase());
      if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
      const date = requestedDate(message, this.now(), place.timezone);
      if (!date) return null;
      const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
      forecastUrl.searchParams.set('latitude', String(place.latitude));
      forecastUrl.searchParams.set('longitude', String(place.longitude));
      forecastUrl.searchParams.set('daily', 'precipitation_probability_max');
      forecastUrl.searchParams.set('timezone', 'auto');
      forecastUrl.searchParams.set('forecast_days', '7');
      const forecast = await this.request(forecastUrl, { signal: AbortSignal.timeout(3500) });
      if (!forecast.ok) return null;
      const daily = (await forecast.json() as { daily?: { time?: string[]; precipitation_probability_max?: number[] } }).daily;
      const index = daily?.time?.indexOf(date) ?? -1;
      const probability = index >= 0 ? daily?.precipitation_probability_max?.[index] : undefined;
      if (typeof probability !== 'number' || probability < 50 || probability > 100) return null;
      return `The forecast for ${place.name} on ${date} shows about a ${Math.round(probability)}% chance of rain. For outdoor plans, I suggest keeping an indoor backup in mind.`;
    } catch {
      return null;
    }
  }
}

function requestedDate(message: string, now: Date, timeZone = 'UTC'): string | undefined {
  const explicit = message.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicit) return explicit;
  if (!/\b(today|tomorrow)\b/i.test(message)) return undefined;
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const datePart = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const today = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  if (/\btoday\b/i.test(message)) return today;
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

let weather: WeatherContextService | null = null;
export function getWeatherContextService(): WeatherContextService {
  if (!weather) weather = new WeatherContextService();
  return weather;
}
