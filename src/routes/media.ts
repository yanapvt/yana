import { Router, type Request, type Response } from 'express';
import { deflateSync } from 'node:zlib';
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

router.get('/media/transport-card/:id.png', (req: Request, res: Response) => {
  const vehicleType = safeQueryText(req.query.type, 'Transport');
  const vehicle = safeQueryText(req.query.vehicle, vehicleType);
  const provider = safeQueryText(req.query.provider, 'Yana transport');

  try {
    const image = renderTransportCardPng({ vehicleType, vehicle, provider });
    res.set({
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': 'image/png',
    });
    res.send(image);
  } catch (error) {
    console.error('[media] Failed to render transport card image:', error);
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

interface TransportCardImageInput {
  vehicleType: string;
  vehicle: string;
  provider: string;
}

function safeQueryText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 && text.length <= 80 ? text : fallback;
}

function renderTransportCardPng(input: TransportCardImageInput): Buffer {
  const width = 900;
  const height = 520;
  const pixels = Buffer.alloc(width * height * 4);
  const palette = transportPalette(input.vehicleType);

  fillGradient(pixels, width, height, palette.top, palette.bottom);
  drawSun(pixels, width, 740, 86, palette.accent);
  drawRoad(pixels, width, height);
  drawVehicle(pixels, width, 290, 242, palette.vehicle, palette.window);
  drawBadge(pixels, width, input.vehicleType);
  drawSimpleText(pixels, width, 54, 58, input.provider.toUpperCase(), [255, 255, 255, 255], 4);
  drawSimpleText(pixels, width, 54, 392, input.vehicle, [255, 255, 255, 255], 5);
  drawSimpleText(pixels, width, 58, 455, 'YANA TRANSPORT', [224, 242, 254, 255], 3);

  return encodePng(width, height, pixels);
}

function transportPalette(vehicleType: string): {
  top: Rgba;
  bottom: Rgba;
  vehicle: Rgba;
  window: Rgba;
  accent: Rgba;
} {
  const type = vehicleType.toLowerCase();
  if (/luxury|chauffeur/.test(type)) {
    return {
      top: [15, 23, 42, 255],
      bottom: [49, 46, 129, 255],
      vehicle: [236, 201, 75, 255],
      window: [191, 219, 254, 255],
      accent: [250, 204, 21, 255],
    };
  }
  if (/van|minibus|bus|coach/.test(type)) {
    return {
      top: [12, 74, 110, 255],
      bottom: [13, 148, 136, 255],
      vehicle: [248, 250, 252, 255],
      window: [186, 230, 253, 255],
      accent: [45, 212, 191, 255],
    };
  }
  if (/suv/.test(type)) {
    return {
      top: [20, 83, 45, 255],
      bottom: [21, 128, 61, 255],
      vehicle: [251, 146, 60, 255],
      window: [219, 234, 254, 255],
      accent: [134, 239, 172, 255],
    };
  }
  if (/economy/.test(type)) {
    return {
      top: [30, 64, 175, 255],
      bottom: [14, 116, 144, 255],
      vehicle: [96, 165, 250, 255],
      window: [219, 234, 254, 255],
      accent: [125, 211, 252, 255],
    };
  }
  return {
    top: [15, 118, 110, 255],
    bottom: [22, 101, 52, 255],
    vehicle: [255, 255, 255, 255],
    window: [186, 230, 253, 255],
    accent: [52, 211, 153, 255],
  };
}

type Rgba = [number, number, number, number];

function fillGradient(pixels: Buffer, width: number, height: number, top: Rgba, bottom: Rgba): void {
  for (let y = 0; y < height; y += 1) {
    const ratio = y / Math.max(1, height - 1);
    const color: Rgba = [
      Math.round(top[0] + (bottom[0] - top[0]) * ratio),
      Math.round(top[1] + (bottom[1] - top[1]) * ratio),
      Math.round(top[2] + (bottom[2] - top[2]) * ratio),
      255,
    ];
    for (let x = 0; x < width; x += 1) {
      setPixel(pixels, width, x, y, color);
    }
  }
}

function drawSun(pixels: Buffer, width: number, cx: number, cy: number, color: Rgba): void {
  for (let radius = 56; radius >= 0; radius -= 1) {
    const alpha = Math.max(20, Math.round((1 - radius / 56) * 120));
    drawCircle(pixels, width, cx, cy, radius, [color[0], color[1], color[2], alpha]);
  }
}

function drawRoad(pixels: Buffer, width: number, height: number): void {
  drawPolygon(pixels, width, [
    [210, height],
    [690, height],
    [540, 300],
    [360, 300],
  ], [15, 23, 42, 210]);
  drawPolygon(pixels, width, [
    [438, height],
    [462, height],
    [455, 310],
    [445, 310],
  ], [255, 255, 255, 190]);
}

function drawVehicle(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
  body: Rgba,
  window: Rgba
): void {
  drawRoundedRect(pixels, width, x + 55, y + 18, 250, 84, 18, body);
  drawRoundedRect(pixels, width, x + 102, y - 42, 150, 72, 18, body);
  drawRoundedRect(pixels, width, x + 120, y - 28, 48, 38, 6, window);
  drawRoundedRect(pixels, width, x + 178, y - 28, 56, 38, 6, window);
  drawRect(pixels, width, x + 72, y + 72, 216, 10, [15, 23, 42, 95]);
  drawCircle(pixels, width, x + 105, y + 108, 32, [15, 23, 42, 255]);
  drawCircle(pixels, width, x + 255, y + 108, 32, [15, 23, 42, 255]);
  drawCircle(pixels, width, x + 105, y + 108, 14, [226, 232, 240, 255]);
  drawCircle(pixels, width, x + 255, y + 108, 14, [226, 232, 240, 255]);
}

function drawBadge(pixels: Buffer, width: number, text: string): void {
  drawRoundedRect(pixels, width, 54, 300, 260, 48, 12, [255, 255, 255, 48]);
  drawSimpleText(pixels, width, 76, 316, text.toUpperCase(), [255, 255, 255, 255], 3);
}

function drawRect(pixels: Buffer, width: number, x: number, y: number, w: number, h: number, color: Rgba): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      blendPixel(pixels, width, xx, yy, color);
    }
  }
}

function drawRoundedRect(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: Rgba
): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const dx = xx < x + radius ? x + radius - xx : xx > x + w - radius ? xx - (x + w - radius) : 0;
      const dy = yy < y + radius ? y + radius - yy : yy > y + h - radius ? yy - (y + h - radius) : 0;
      if (dx * dx + dy * dy <= radius * radius || dx === 0 || dy === 0) {
        blendPixel(pixels, width, xx, yy, color);
      }
    }
  }
}

function drawCircle(pixels: Buffer, width: number, cx: number, cy: number, radius: number, color: Rgba): void {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(pixels, width, x, y, color);
      }
    }
  }
}

function drawPolygon(pixels: Buffer, width: number, points: Array<[number, number]>, color: Rgba): void {
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x, y, points)) {
        blendPixel(pixels, width, x, y, color);
      }
    }
  }
}

function pointInPolygon(x: number, y: number, points: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const FONT: Record<string, string[]> = {
  A: ['111', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  ' ': ['000', '000', '000', '000', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '/': ['001', '001', '010', '100', '100'],
};

function drawSimpleText(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
  text: string,
  color: Rgba,
  scale: number
): void {
  let cursor = x;
  for (const char of text.toUpperCase().slice(0, 26)) {
    const glyph = FONT[char] ?? FONT[' '];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === '1') {
          drawRect(pixels, width, cursor + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += 4 * scale;
  }
}

function setPixel(pixels: Buffer, width: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= width) return;
  const offset = (y * width + x) * 4;
  if (offset < 0 || offset + 3 >= pixels.length) return;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function blendPixel(pixels: Buffer, width: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= width) return;
  const offset = (y * width + x) * 4;
  if (offset < 0 || offset + 3 >= pixels.length) return;
  const alpha = color[3] / 255;
  pixels[offset] = Math.round(color[0] * alpha + pixels[offset] * (1 - alpha));
  pixels[offset + 1] = Math.round(color[1] * alpha + pixels[offset + 1] * (1 - alpha));
  pixels[offset + 2] = Math.round(color[2] * alpha + pixels[offset + 2] * (1 - alpha));
  pixels[offset + 3] = 255;
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', concatBuffers(uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0]))),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  return concatBuffers(uint32(data.length), typeBuffer, data, uint32(crc32(concatBuffers(typeBuffer, data))));
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function concatBuffers(...buffers: Buffer[]): Buffer {
  return Buffer.concat(buffers);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
