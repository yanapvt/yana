import { Router, type Request, type Response } from 'express';
import { getTextToSpeechService } from '../services/TextToSpeechService.js';
import { getMetaWhatsAppMediaService } from '../services/MetaWhatsAppMediaService.js';

const router = Router();

router.get('/places/smart/:placeId', async (req: Request, res: Response) => {
  const placeId = req.params.placeId;

  if (!placeId || placeId.length > 256) {
    res.status(404).send('Not found');
    return;
  }

  try {
    const place = await fetchGooglePlaceDetails(placeId);
    const weather = place.location
      ? await fetchWeatherSummary(place.location.latitude, place.location.longitude)
      : null;

    res.set({
      'Cache-Control': 'private, max-age=300',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.send(renderSmartPlacePage(place, weather));
  } catch (error) {
    console.error('[SmartPlace] Failed to render smart place page:', error);
    res.status(502).send('Unable to load place details');
  }
});

router.get('/places/google/:placeId', (req: Request, res: Response) => {
  const placeId = req.params.placeId;

  if (!placeId || placeId.length > 256) {
    res.status(404).send('Not found');
    return;
  }

  const target = new URL('https://www.google.com/maps/search/');
  target.searchParams.set('api', '1');
  target.searchParams.set('query', 'hotel');
  target.searchParams.set('query_place_id', placeId);

  res.redirect(302, target.toString());
});

router.get('/media/google-place-photo', async (req: Request, res: Response) => {
  const photoName = typeof req.query.name === 'string' ? req.query.name : '';
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!photoName || !apiKey || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    res.status(404).send('Not found');
    return;
  }

  try {
    const photoResponse = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=640`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
        },
      }
    );

    if (!photoResponse.ok) {
      res.status(404).send('Not found');
      return;
    }

    const contentType = photoResponse.headers.get('content-type') ?? 'image/jpeg';
    const image = Buffer.from(await photoResponse.arrayBuffer());

    res.set({
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': contentType,
    });
    res.send(image);
  } catch {
    res.status(502).send('Unable to load image');
  }
});

router.get('/media/meta/:mediaId', async (req: Request, res: Response) => {
  try {
    await getMetaWhatsAppMediaService().proxyMedia(req, res);
  } catch {
    res.status(502).send('Unable to load media');
  }
});

router.get('/media/tts/:hash.mp3', async (req: Request, res: Response) => {
  try {
    const audio = await getTextToSpeechService().readAudio(req.params.hash);

    if (!audio) {
      res.status(404).send('Not found');
      return;
    }

    res.set({
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': 'audio/mpeg',
    });
    res.send(audio);
  } catch {
    res.status(502).send('Unable to load audio');
  }
});

export default router;

interface SmartPlaceDetails {
  id: string;
  name: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  phone?: string;
  openNow?: boolean;
  weekdayDescriptions?: string[];
  typeLabel?: string;
  summary?: string;
  photoUrl?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

interface SmartWeatherSummary {
  temperatureC?: number;
  windKph?: number;
  precipitationMm?: number;
  condition: string;
}

async function fetchGooglePlaceDetails(placeId: string): Promise<SmartPlaceDetails> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  }

  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'formattedAddress',
          'rating',
          'userRatingCount',
          'priceLevel',
          'googleMapsUri',
          'websiteUri',
          'nationalPhoneNumber',
          'currentOpeningHours',
          'regularOpeningHours',
          'photos',
          'types',
          'editorialSummary',
          'location',
        ].join(','),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Google place details failed with ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    priceLevel?: string;
    googleMapsUri?: string;
    websiteUri?: string;
    nationalPhoneNumber?: string;
    currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
    regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
    photos?: Array<{ name?: string }>;
    types?: string[];
    editorialSummary?: { text?: string };
    location?: { latitude?: number; longitude?: number };
  };

  return {
    id: data.id ?? placeId,
    name: data.displayName?.text ?? 'Place details',
    address: data.formattedAddress,
    rating: data.rating,
    reviewCount: data.userRatingCount,
    priceLevel: formatPriceLevel(data.priceLevel),
    mapsUrl: data.googleMapsUri,
    websiteUrl: data.websiteUri,
    phone: data.nationalPhoneNumber,
    openNow: data.currentOpeningHours?.openNow ?? data.regularOpeningHours?.openNow,
    weekdayDescriptions:
      data.currentOpeningHours?.weekdayDescriptions ?? data.regularOpeningHours?.weekdayDescriptions,
    typeLabel: formatTypeLabel(data.types?.[0]),
    summary: data.editorialSummary?.text,
    photoUrl: buildGooglePlacePhotoUrl(data.photos?.[0]?.name),
    location:
      typeof data.location?.latitude === 'number' && typeof data.location.longitude === 'number'
        ? { latitude: data.location.latitude, longitude: data.location.longitude }
        : undefined,
  };
}

async function fetchWeatherSummary(
  latitude: number,
  longitude: number
): Promise<SmartWeatherSummary | null> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', 'temperature_2m,precipitation,wind_speed_10m,weather_code');
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      current?: {
        temperature_2m?: number;
        precipitation?: number;
        wind_speed_10m?: number;
        weather_code?: number;
      };
    };

    return {
      temperatureC: data.current?.temperature_2m,
      precipitationMm: data.current?.precipitation,
      windKph: data.current?.wind_speed_10m,
      condition: weatherCodeLabel(data.current?.weather_code),
    };
  } catch {
    return null;
  }
}

function renderSmartPlacePage(place: SmartPlaceDetails, weather: SmartWeatherSummary | null): string {
  const mapUrl = place.mapsUrl ?? buildGoogleMapsSearchUrl(place);
  const trafficUrl = buildTrafficUrl(place);
  const photoStyle = place.photoUrl
    ? `background-image:linear-gradient(180deg, rgba(5,10,20,.18), rgba(5,10,20,.72)), url('${escapeAttr(place.photoUrl)}')`
    : 'background:linear-gradient(135deg,#16324f,#0f766e)';
  const statusText =
    typeof place.openNow === 'boolean' ? (place.openNow ? 'Open now' : 'Closed now') : 'Hours unavailable';
  const statusClass = place.openNow ? 'good' : place.openNow === false ? 'warn' : 'muted';
  const ratingText =
    typeof place.rating === 'number'
      ? `${place.rating.toFixed(1)} / 5${place.reviewCount ? ` (${place.reviewCount})` : ''}`
      : 'Not listed';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(place.name)} | Yana Smart View</title>
  <style>
    :root { color-scheme: light; --ink:#102033; --muted:#64748b; --line:#dbe3ef; --brand:#0f766e; --sun:#f59e0b; --blue:#2563eb; --bg:#f6f8fb; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
    .hero { min-height:330px; padding:22px; color:white; background-size:cover; background-position:center; display:flex; align-items:flex-end; ${photoStyle}; }
    .hero-inner { width:min(960px,100%); margin:0 auto; }
    .kicker { display:inline-flex; gap:8px; align-items:center; padding:7px 10px; border:1px solid rgba(255,255,255,.36); border-radius:999px; background:rgba(15,23,42,.35); backdrop-filter:blur(12px); font-size:13px; }
    h1 { margin:14px 0 8px; font-size:clamp(30px,7vw,52px); line-height:1.02; letter-spacing:0; }
    .address { margin:0; max-width:720px; color:rgba(255,255,255,.88); font-size:16px; }
    main { width:min(960px,100%); margin:-32px auto 0; padding:0 16px 28px; position:relative; }
    .panel { background:white; border:1px solid var(--line); border-radius:8px; box-shadow:0 18px 48px rgba(15,23,42,.12); overflow:hidden; }
    .grid { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--line); }
    .widget { min-height:104px; padding:16px; border-right:1px solid var(--line); }
    .widget:last-child { border-right:0; }
    .label { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; margin-bottom:9px; }
    .value { font-size:22px; font-weight:750; line-height:1.15; }
    .sub { margin-top:6px; color:var(--muted); font-size:13px; line-height:1.35; }
    .good { color:#047857; } .warn { color:#b45309; } .muted { color:var(--muted); }
    .content { display:grid; grid-template-columns:1.2fr .8fr; gap:0; }
    .section { padding:18px; border-right:1px solid var(--line); }
    .section:last-child { border-right:0; }
    .summary { color:#334155; line-height:1.55; margin:0 0 14px; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
    .btn { appearance:none; border:0; border-radius:8px; padding:12px 14px; color:white; background:var(--brand); text-decoration:none; font-weight:700; display:inline-flex; align-items:center; gap:8px; min-height:44px; }
    .btn.secondary { background:var(--blue); }
    .btn.light { color:var(--ink); background:#edf2f7; }
    .hours { margin:0; padding:0; list-style:none; color:#334155; font-size:14px; line-height:1.5; }
    .hours li { padding:7px 0; border-bottom:1px solid #eef2f7; }
    .hours li:last-child { border-bottom:0; }
    @media (max-width:760px) {
      .grid { grid-template-columns:repeat(2,1fr); }
      .widget:nth-child(2) { border-right:0; }
      .widget:nth-child(-n+2) { border-bottom:1px solid var(--line); }
      .content { grid-template-columns:1fr; }
      .section { border-right:0; border-bottom:1px solid var(--line); }
      .section:last-child { border-bottom:0; }
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-inner">
      <div class="kicker">${escapeHtml(place.typeLabel ?? 'Yana smart place view')}</div>
      <h1>${escapeHtml(place.name)}</h1>
      ${place.address ? `<p class="address">${escapeHtml(place.address)}</p>` : ''}
    </div>
  </header>
  <main>
    <section class="panel">
      <div class="grid">
        <div class="widget"><span class="label">Status</span><div class="value ${statusClass}">${statusText}</div><div class="sub">Live hours from Google when available</div></div>
        <div class="widget"><span class="label">Rating</span><div class="value">${escapeHtml(ratingText)}</div><div class="sub">${escapeHtml(place.priceLevel ?? 'Price not listed')}</div></div>
        <div class="widget"><span class="label">Weather</span><div class="value">${weather?.temperatureC !== undefined ? `${Math.round(weather.temperatureC)} C` : 'Check live'}</div><div class="sub">${escapeHtml(weather ? `${weather.condition}, wind ${Math.round(weather.windKph ?? 0)} km/h` : 'Weather unavailable')}</div></div>
        <div class="widget"><span class="label">Traffic</span><div class="value">Live route</div><div class="sub">Open Maps for traffic and ETA</div></div>
      </div>
      <div class="content">
        <div class="section">
          <p class="summary">${escapeHtml(place.summary ?? 'Yana selected this place because it matches the request, location signal, and available review data.')}</p>
          <div class="actions">
            <a class="btn" href="${escapeAttr(mapUrl)}" target="_blank" rel="noopener">Open map</a>
            <a class="btn secondary" href="${escapeAttr(trafficUrl)}" target="_blank" rel="noopener">Check traffic</a>
            ${place.websiteUrl ? `<a class="btn light" href="${escapeAttr(place.websiteUrl)}" target="_blank" rel="noopener">Website</a>` : ''}
            ${place.phone ? `<a class="btn light" href="tel:${escapeAttr(place.phone)}">Call</a>` : ''}
          </div>
        </div>
        <div class="section">
          <span class="label">Opening hours</span>
          <ul class="hours">${(place.weekdayDescriptions ?? ['Opening hours are not available for this place.']).slice(0, 7).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function buildGooglePlacePhotoUrl(photoName?: string): string | undefined {
  if (!photoName) {
    return undefined;
  }

  return `${getPublicBaseUrl()}/media/google-place-photo?name=${encodeURIComponent(photoName)}`;
}

function buildGoogleMapsSearchUrl(place: SmartPlaceDetails): string {
  const target = new URL('https://www.google.com/maps/search/');
  target.searchParams.set('api', '1');
  target.searchParams.set('query', place.name);
  target.searchParams.set('query_place_id', place.id);
  return target.toString();
}

function buildTrafficUrl(place: SmartPlaceDetails): string {
  const target = new URL('https://www.google.com/maps/dir/');
  target.searchParams.set('api', '1');
  target.searchParams.set('destination', place.address ?? place.name);
  if (place.id) {
    target.searchParams.set('destination_place_id', place.id);
  }
  target.searchParams.set('travelmode', 'driving');
  return target.toString();
}

function getPublicBaseUrl(): string {
  const publicBaseUrl =
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`;

  return publicBaseUrl.replace(/\/$/, '');
}

function formatPriceLevel(priceLevel?: string): string | undefined {
  const labels: Record<string, string> = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };

  return priceLevel ? labels[priceLevel] ?? priceLevel : undefined;
}

function formatTypeLabel(type?: string): string | undefined {
  return type
    ?.split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function weatherCodeLabel(code?: number): string {
  if (code === undefined) return 'Weather unavailable';
  if (code === 0) return 'Clear';
  if ([1, 2, 3].includes(code)) return 'Partly cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain likely';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm risk';
  return 'Mixed conditions';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
