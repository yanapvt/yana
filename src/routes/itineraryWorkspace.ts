import { Router, type Request, type Response } from 'express';
import { getItineraryWorkspaceService } from '../services/ItineraryWorkspaceService.js';
import type {
  DailyItineraryPlan,
  GeneratedItinerary,
  ItineraryPlaceSuggestion,
} from '../services/ItineraryPlannerService.js';

const router = Router();

router.get('/itinerary/:shareToken', async (req: Request, res: Response) => {
  const workspace = await getItineraryWorkspaceService().getWorkspace(req.params.shareToken);
  if (!workspace) {
    res.status(404).type('html').send(renderUnavailablePage());
    return;
  }

  res
    .status(200)
    .type('html')
    .setHeader('Cache-Control', 'no-store')
    .send(renderWorkspacePage(workspace.shareToken, workspace.itinerary, workspace));
});

router.post('/itinerary/:shareToken/state', async (req: Request, res: Response) => {
  const selectedDay = Number(req.body?.selectedDay);
  const pendingChange = typeof req.body?.pendingChange === 'string' ? req.body.pendingChange : '';
  const workspace = await getItineraryWorkspaceService().getWorkspace(req.params.shareToken);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace unavailable' });
    return;
  }

  const updated = await getItineraryWorkspaceService().updateWorkspaceState(req.params.shareToken, {
    selectedDay: Number.isFinite(selectedDay) && selectedDay > 0 ? selectedDay : workspace.selectedDay,
    pendingChanges: pendingChange
      ? [...workspace.pendingChanges, pendingChange].slice(-20)
      : workspace.pendingChanges,
  });

  res.status(200).json({
    ok: Boolean(updated),
    selectedDay: updated?.selectedDay,
    pendingChanges: updated?.pendingChanges ?? [],
    currentVersion: updated?.currentVersion,
    lastSave: updated?.lastSave,
  });
});

function renderWorkspacePage(
  shareToken: string,
  itinerary: GeneratedItinerary,
  workspace: { selectedDay: number; currentVersion: number; lastSave: string }
): string {
  const displayItinerary = normalizeItineraryForDisplay(itinerary);
  const selectedDay = displayItinerary.days[workspace.selectedDay - 1] ?? displayItinerary.days[0];
  const routeStops = displayItinerary.mapSummary.split(/\s*->\s*/).filter(Boolean);
  const googleMapsApiKey = getGoogleMapsBrowserApiKey();
  const googleMapsEmbedUrl = buildGoogleMapsEmbedUrl(routeStops, googleMapsApiKey);
  const googleMapsDirectionsUrl = buildGoogleMapsDirectionsUrl(routeStops);
  const googleStaticMapUrl = buildGoogleStaticMapUrl(routeStops, googleMapsApiKey);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Interactive Itinerary Workspace</title>
  <style>
    :root { color-scheme: light; --ink:#132238; --muted:#607086; --line:#d8e0ea; --brand:#0f766e; --soft:#eef7f4; --gold:#b7791f; --blue:#164e8f; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); background:#f4f7f6; }
    header { padding:22px clamp(16px, 4vw, 40px); background:#102a43; color:#fff; }
    header h1 { margin:0 0 10px; font-size:clamp(26px, 4vw, 42px); letter-spacing:0; }
    .meta { display:grid; grid-template-columns:repeat(6, minmax(120px, 1fr)); gap:12px; }
    .meta div { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2); border-radius:8px; padding:10px; min-height:64px; }
    .meta span { display:block; font-size:12px; opacity:.76; }
    .layout { display:grid; grid-template-columns:320px minmax(420px, 1fr) 390px; gap:16px; padding:16px; min-height:calc(100vh - 178px); }
    aside, main { background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    .panel-title { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--line); font-weight:700; }
    .timeline { overflow:auto; max-height:calc(100vh - 226px); }
    details { border-bottom:1px solid var(--line); }
    summary { cursor:pointer; padding:14px 16px; font-weight:700; list-style:none; }
    summary::-webkit-details-marker { display:none; }
    .day-body { padding:0 16px 16px; color:var(--muted); font-size:14px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:5px 9px; margin:4px 4px 0 0; background:var(--soft); color:var(--ink); font-size:12px; }
    .map { position:relative; min-height:520px; background:#061831; overflow:hidden; }
    .live-map { position:absolute; inset:0; min-height:520px; background:#dbe7df; z-index:2; }
    .google-map-frame { position:absolute; inset:0; width:100%; height:100%; min-height:520px; border:0; z-index:2; }
    .google-static-map { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:1; }
    .map-fallback { position:absolute; inset:0; z-index:1; }
    .map.has-google-embed .map-fallback { display:none; }
    .map.show-preview .google-map-frame { display:none; }
    .map.show-preview .map-fallback { display:block; z-index:2; }
    .map[data-google-ready="true"] .map-note { background:rgba(255,255,255,.92); color:var(--ink); border-color:var(--line); z-index:3; }
    .map.has-google-embed .map-note { background:rgba(255,255,255,.92); color:var(--ink); border-color:var(--line); z-index:3; }
    .map[data-google-ready="false"] .live-map { display:none; }
    .map-tools { position:absolute; left:16px; top:16px; display:flex; gap:8px; flex-wrap:wrap; z-index:4; }
    .map-tools a, .map-tools button { border:1px solid rgba(255,255,255,.42); background:rgba(16,42,67,.88); color:#fff; border-radius:8px; padding:8px 10px; text-decoration:none; font-size:13px; font-weight:800; }
    .route-map { display:block; width:100%; height:100%; min-height:520px; }
    .sea-grid { opacity:.18; }
    .island { fill:#164855; stroke:#2d7181; stroke-width:2; }
    .terrain { fill:none; stroke:#235f6d; stroke-width:1.2; opacity:.75; }
    .road { fill:none; stroke:#7aa6a7; stroke-width:1; stroke-dasharray:2 4; opacity:.7; }
    .route-shadow { fill:none; stroke:#062134; stroke-width:11; stroke-linecap:round; stroke-linejoin:round; opacity:.9; }
    .route-main { fill:none; stroke:#18d5ff; stroke-width:6; stroke-linecap:round; stroke-linejoin:round; }
    .route-dot { fill:#fff; opacity:.95; }
    .pin-stem { stroke:#fff; stroke-width:3; stroke-linecap:round; }
    .pin-head { fill:#e44731; stroke:#f7f7f7; stroke-width:3; }
    .pin-core { fill:#7c1f1a; opacity:.5; }
    .map-label { fill:#fff; font-size:15px; font-weight:800; paint-order:stroke; stroke:#071a2f; stroke-width:4; stroke-linejoin:round; }
    .map-caption { fill:#e5f2f0; font-size:11px; paint-order:stroke; stroke:#071a2f; stroke-width:3; stroke-linejoin:round; }
    .travel-badge rect { fill:#1247df; rx:8; }
    .travel-badge text { fill:#fff; font-size:13px; font-weight:800; }
    .map-note { position:absolute; left:16px; right:16px; bottom:16px; background:rgba(5,18,35,.86); border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:12px; color:#e8f7f6; }
    .detail { padding:16px; overflow:auto; max-height:calc(100vh - 226px); background:#f8fbfa; }
    .card { border:1px solid var(--line); border-radius:8px; padding:14px; margin-bottom:12px; background:#fff; }
    .card h3 { margin:0 0 8px; font-size:16px; }
    .day-hero { border-radius:8px; overflow:hidden; border:1px solid var(--line); margin-bottom:12px; background:#102a43; color:#fff; }
    .day-hero img { width:100%; height:170px; object-fit:cover; display:block; }
    .day-hero div { padding:14px; }
    .day-hero h2 { margin:0 0 6px; font-size:22px; }
    .place-grid { display:grid; grid-template-columns:1fr; gap:10px; margin-bottom:12px; }
    .place-card { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#fff; }
    .place-card img { width:100%; height:116px; object-fit:cover; display:block; background:#d8e0ea; }
    .place-card div { padding:12px; }
    .place-card h3 { margin:0 0 6px; font-size:15px; }
    .place-card p { margin:0; color:var(--muted); font-size:13px; }
    .place-card a { display:inline-block; margin-top:10px; color:var(--blue); font-weight:800; text-decoration:none; }
    .category { display:inline-block; font-size:11px; font-weight:800; color:#0f766e; background:#e4f4ef; border-radius:999px; padding:4px 8px; margin-bottom:8px; }
    .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
    button { border:1px solid var(--brand); background:var(--brand); color:#fff; border-radius:8px; padding:9px 11px; font-weight:700; cursor:pointer; }
    button.secondary { background:#fff; color:var(--brand); }
    .mobile-controls { display:none; position:sticky; bottom:0; background:#fff; border-top:1px solid var(--line); padding:10px; gap:8px; }
    @media (max-width: 980px) {
      .meta { grid-template-columns:repeat(2, minmax(0, 1fr)); }
      .layout { display:block; padding:10px; }
      aside, main { margin-bottom:12px; }
      .timeline, .detail { max-height:none; }
      .map { min-height:420px; }
      .mobile-controls { display:flex; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Interactive Itinerary Workspace</h1>
    <div class="meta">
      <div><span>Trip</span>${escapeHtml(displayItinerary.overview)}</div>
      <div><span>Duration</span>${displayItinerary.days.length} days</div>
      <div><span>Budget</span>${escapeHtml(displayItinerary.budgetEstimate)}</div>
      <div><span>Weather</span>${escapeHtml(displayItinerary.weatherNotes)}</div>
      <div><span>Version</span>${workspace.currentVersion}</div>
      <div><span>Last save</span>${escapeHtml(workspace.lastSave)}</div>
    </div>
  </header>
  <section class="layout">
    <aside>
      <div class="panel-title">Timeline <small>drag-ready</small></div>
      <div class="timeline">${displayItinerary.days.map((day, index) => renderTimelineDay(day, index === 0)).join('')}</div>
    </aside>
    <main>
      <div class="panel-title">Journey Map <small>Google Maps ready</small></div>
      <div class="map ${googleMapsEmbedUrl ? 'has-google-embed' : ''}" id="journey-map" data-google-ready="false">
        <div class="map-tools">
          <a href="${escapeHtml(googleMapsDirectionsUrl)}" target="_blank" rel="noopener">Open full map</a>
          <button type="button" onclick="toggleRoutePreview()">Toggle preview</button>
        </div>
        ${googleMapsEmbedUrl ? `<iframe class="google-map-frame" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade" src="${escapeHtml(googleMapsEmbedUrl)}" title="Live Google Maps itinerary route"></iframe>` : '<div id="google-route-map" class="live-map" aria-label="Live Google Maps itinerary route"></div>'}
        <div class="map-fallback">${googleStaticMapUrl ? `<img class="google-static-map" src="${escapeHtml(googleStaticMapUrl)}" alt="Google Maps route preview" />` : renderRouteMap(routeStops)}</div>
        <div class="map-note" id="map-note">${googleMapsEmbedUrl ? 'Live Google Maps route generated from this itinerary. If the frame is blocked, use Open full map or Toggle preview.' : `Route preview: ${escapeHtml(itinerary.mapSummary)}. Add GOOGLE_MAPS_BROWSER_API_KEY to show the live Google Maps route here.`}</div>
      </div>
    </main>
    <aside>
      <div class="panel-title">Selected Day <small>Day ${selectedDay?.day ?? 1}</small></div>
      <div class="detail">${selectedDay ? renderSelectedDay(selectedDay) : ''}</div>
    </aside>
  </section>
  <div class="mobile-controls">
    <button onclick="saveChange('adjust pace')">Adjust Pace</button>
    <button class="secondary" onclick="saveChange('request alternatives')">Alternatives</button>
    <button class="secondary" onclick="saveChange('continue in WhatsApp')">WhatsApp</button>
  </div>
  <script>
    const token = ${JSON.stringify(shareToken)};
    const routeStops = ${JSON.stringify(routeStops.map(formatGoogleRouteStop))};
    const googleMapsApiKey = ${JSON.stringify(googleMapsApiKey)};
    const hasGoogleMapsEmbed = ${JSON.stringify(Boolean(googleMapsEmbedUrl))};

    async function saveChange(change) {
      document.body.dataset.updating = 'true';
      await fetch('/itinerary/' + encodeURIComponent(token) + '/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingChange: change })
      });
      document.body.dataset.updating = 'false';
      alert('Saved. Continue in WhatsApp and tell Yana: ' + change);
    }

    function loadGoogleMapsRoute() {
      if (hasGoogleMapsEmbed) {
        return;
      }

      if (!googleMapsApiKey || routeStops.length < 2) {
        return;
      }

      window.initItineraryGoogleMap = function initItineraryGoogleMap() {
        const mapElement = document.getElementById('google-route-map');
        const mapShell = document.getElementById('journey-map');
        const mapNote = document.getElementById('map-note');
        const map = new google.maps.Map(mapElement, {
          center: { lat: 7.8731, lng: 80.7718 },
          zoom: 7,
          mapTypeControl: false,
          fullscreenControl: true,
          streetViewControl: false,
        });
        const directionsService = new google.maps.DirectionsService();
        const directionsRenderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: '#10bce3',
            strokeOpacity: 0.95,
            strokeWeight: 6,
          },
        });
        const origin = routeStops[0];
        const destination = routeStops[routeStops.length - 1];
        const waypoints = routeStops.slice(1, -1).slice(0, 23).map((location) => ({
          location,
          stopover: true,
        }));

        directionsService.route(
          {
            origin,
            destination,
            waypoints,
            travelMode: google.maps.TravelMode.DRIVING,
            optimizeWaypoints: false,
            provideRouteAlternatives: false,
          },
          (result, status) => {
            if (status !== 'OK' || !result) {
              mapShell.dataset.googleReady = 'false';
              mapNote.textContent = 'Google Maps could not draw this route yet. The itinerary route preview is shown as a fallback.';
              return;
            }

            directionsRenderer.setDirections(result);
            mapShell.dataset.googleReady = 'true';
            const route = result.routes && result.routes[0];
            const legs = route ? route.legs || [] : [];
            const distanceMeters = legs.reduce((sum, leg) => sum + ((leg.distance && leg.distance.value) || 0), 0);
            const durationSeconds = legs.reduce((sum, leg) => sum + ((leg.duration && leg.duration.value) || 0), 0);
            mapNote.textContent = 'Live Google Maps route: ' + formatRouteMetric(durationSeconds, distanceMeters) + '. Stops are generated from this itinerary.';
          }
        );
      };

      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(googleMapsApiKey) + '&callback=initItineraryGoogleMap';
      script.async = true;
      script.defer = true;
      script.onerror = function () {
        document.getElementById('map-note').textContent = 'Google Maps did not load. The itinerary route preview is shown as a fallback.';
      };
      document.head.appendChild(script);
    }

    function toggleRoutePreview() {
      const mapShell = document.getElementById('journey-map');
      mapShell.classList.toggle('show-preview');
    }

    function formatRouteMetric(durationSeconds, distanceMeters) {
      const hours = Math.floor(durationSeconds / 3600);
      const minutes = Math.round((durationSeconds % 3600) / 60);
      const distanceKm = Math.round(distanceMeters / 1000);
      const time = hours > 0 ? hours + ' hr ' + minutes + ' min' : minutes + ' min';
      return time + ', ' + distanceKm + ' km';
    }

    loadGoogleMapsRoute();
  </script>
</body>
</html>`;
}

function renderTimelineDay(day: DailyItineraryPlan, open: boolean): string {
  return `<details ${open ? 'open' : ''}>
    <summary>Day ${day.day}: ${escapeHtml(day.date)} - ${escapeHtml(day.location)}</summary>
    <div class="day-body">
      <p>${escapeHtml(day.morning)}</p>
      <p>${escapeHtml(day.afternoon)}</p>
      <p>${escapeHtml(day.evening)}</p>
      ${day.experiences.map((experience) => `<span class="pill">${escapeHtml(experience)}</span>`).join('')}
    </div>
  </details>`;
}

function normalizeItineraryForDisplay(itinerary: GeneratedItinerary): GeneratedItinerary {
  return {
    ...itinerary,
    days: itinerary.days.map(normalizeDayForDisplay),
  };
}

function normalizeDayForDisplay(day: DailyItineraryPlan): DailyItineraryPlan {
  const replacementFocus = getDisplayFocusForLocation(day.location);
  if (!replacementFocus) {
    return day;
  }

  const hasMismatch = day.experiences.some((experience) =>
    replacementFocus.incompatiblePatterns.some((pattern) => pattern.test(experience))
  );
  if (!hasMismatch) {
    return day;
  }

  const experiences = Array.from(
    new Set(
      day.experiences
        .map((experience) =>
          replacementFocus.incompatiblePatterns.some((pattern) => pattern.test(experience))
            ? replacementFocus.interests[0]
            : experience
        )
        .concat(replacementFocus.interests.slice(1))
    )
  );
  const focusText = experiences.slice(0, 2).join(', ');

  return {
    ...day,
    morning: rewriteFocusSentence(day.morning, day.location, focusText),
    afternoon: rewriteFocusSentence(day.afternoon, day.location, focusText),
    experiences,
    placeSuggestions: day.placeSuggestions?.length
      ? day.placeSuggestions
      : buildDisplayPlaceSuggestions(day.location, experiences),
  };
}

function getDisplayFocusForLocation(location: string): {
  incompatiblePatterns: RegExp[];
  interests: string[];
} | null {
  if (/ella/i.test(location)) {
    return {
      incompatiblePatterns: [/beach|surf|snork|diving|whale/i],
      interests: ['Tea Country', 'Hiking', 'Photography'],
    };
  }

  if (/yala/i.test(location)) {
    return {
      incompatiblePatterns: [/nightlife|shopping|museum/i],
      interests: ['Safari', 'Wildlife', 'Nature'],
    };
  }

  return null;
}

function rewriteFocusSentence(value: string, location: string, focusText: string): string {
  return value
    .replace(/with a focus on [^.]+/i, `with a focus on ${focusText}`)
    .replace(/that match [^,]+/i, `that match ${focusText}`)
    .replace(/nearby experiences/i, `nearby ${/ella/i.test(location) ? 'hill-country' : 'local'} experiences`);
}

function buildDisplayPlaceSuggestions(
  location: string,
  interests: string[]
): ItineraryPlaceSuggestion[] {
  const queryBase = `${location} Sri Lanka`;
  const fallbackPlaces: Record<string, Array<{ title: string; description: string; category: string }>> = {
    ella: [
      { title: 'Nine Arch Bridge', description: 'Iconic rail bridge and photography stop.', category: 'Photography' },
      { title: "Little Adam's Peak", description: 'Short scenic hike with hill-country views.', category: 'Hiking' },
      { title: 'Ravana Falls', description: 'Waterfall stop outside Ella.', category: 'Nature' },
    ],
    galle: [
      { title: 'Galle Fort', description: 'UNESCO coastal fort with cafes and sunset walls.', category: 'Historical Sites' },
      { title: 'Unawatuna Beach', description: 'Easy beach stop near Galle.', category: 'Beaches' },
      { title: 'Japanese Peace Pagoda', description: 'Quiet coastal viewpoint.', category: 'Culture' },
    ],
    yala: [
      { title: 'Yala National Park', description: 'Premier wildlife and safari sanctuary.', category: 'Safari' },
      { title: 'Bundala National Park', description: 'Wetland and birdlife experience nearby.', category: 'Nature' },
      { title: 'Kirinda Beach', description: 'Coastal stop often paired with Yala.', category: 'Coast' },
    ],
  };
  const places = fallbackPlaces[normaliseStop(location)] ?? [
    {
      title: `${location} highlights`,
      description: `Local highlights for ${interests.slice(0, 2).join(', ') || 'this route'}.`,
      category: 'Local highlights',
    },
  ];

  return places.map((place) => ({
    ...place,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.title}, ${queryBase}`)}`,
    imageUrl: buildFallbackImageUrl(`${place.title} ${queryBase}`),
  }));
}

function getGoogleMapsBrowserApiKey(): string {
  return process.env.GOOGLE_MAPS_BROWSER_API_KEY || '';
}

function formatGoogleRouteStop(stop: string): string {
  const normalized = normaliseStop(stop);
  const knownStops: Record<string, string> = {
    bia: 'Bandaranaike International Airport, Katunayake, Sri Lanka',
    negombo: 'Negombo, Sri Lanka',
    colombo: 'Colombo, Sri Lanka',
    sigiriya: 'Sigiriya, Sri Lanka',
    kandy: 'Kandy, Sri Lanka',
    ella: 'Ella, Sri Lanka',
    yala: 'Yala National Park, Sri Lanka',
    yala_national_park: 'Yala National Park, Sri Lanka',
    galle: 'Galle, Sri Lanka',
  };

  return knownStops[normalized] ?? `${stop}, Sri Lanka`;
}

function buildGoogleMapsEmbedUrl(routeStops: string[], apiKey: string): string | null {
  if (!apiKey || routeStops.length < 2) {
    return null;
  }

  const formattedStops = routeStops.map(formatGoogleRouteStop);
  const params = new URLSearchParams({
    key: apiKey,
    origin: formattedStops[0],
    destination: formattedStops[formattedStops.length - 1],
    mode: 'driving',
  });
  const waypoints = formattedStops.slice(1, -1).slice(0, 20);
  if (waypoints.length) {
    params.set('waypoints', waypoints.join('|'));
  }

  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}

function buildGoogleMapsDirectionsUrl(routeStops: string[]): string {
  const formattedStops = routeStops.map(formatGoogleRouteStop);
  if (formattedStops.length < 2) {
    return 'https://www.google.com/maps';
  }

  const params = new URLSearchParams({
    api: '1',
    origin: formattedStops[0],
    destination: formattedStops[formattedStops.length - 1],
    travelmode: 'driving',
  });
  const waypoints = formattedStops.slice(1, -1).slice(0, 20);
  if (waypoints.length) {
    params.set('waypoints', waypoints.join('|'));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildGoogleStaticMapUrl(routeStops: string[], apiKey: string): string | null {
  if (!apiKey || routeStops.length < 2) {
    return null;
  }

  const points = routeStops.map((stop, index) => resolveRoutePoint(stop, index, routeStops.length));
  const params = new URLSearchParams({
    key: apiKey,
    size: '900x620',
    scale: '2',
    maptype: 'roadmap',
  });
  params.append('path', `color:0x10bce3ff|weight:5|${points.map(toStaticMapLatLng).join('|')}`);
  points.forEach((point, index) => {
    params.append('markers', `color:red|label:${index + 1}|${toStaticMapLatLng(point)}`);
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

function toStaticMapLatLng(point: RouteMapPoint): string {
  const geo = knownRouteGeo[normaliseStop(point.name)] ?? pixelToSriLankaLatLng(point);
  return `${geo.lat},${geo.lng}`;
}

interface RouteMapPoint {
  name: string;
  x: number;
  y: number;
  description: string;
  labelSide: 'left' | 'right';
}

const knownRoutePoints: Record<string, RouteMapPoint> = {
  bia: {
    name: 'BIA',
    x: 93,
    y: 278,
    description: 'Main arrival airport',
    labelSide: 'left',
  },
  negombo: {
    name: 'Negombo',
    x: 88,
    y: 248,
    description: 'Coastal first stop close to airport',
    labelSide: 'left',
  },
  colombo: {
    name: 'Colombo',
    x: 90,
    y: 315,
    description: 'Capital, shopping, nightlife',
    labelSide: 'left',
  },
  sigiriya: {
    name: 'Sigiriya',
    x: 202,
    y: 154,
    description: 'Ancient rock fortress and cultural hub',
    labelSide: 'right',
  },
  kandy: {
    name: 'Kandy',
    x: 185,
    y: 225,
    description: 'Hill capital and Temple of the Tooth',
    labelSide: 'right',
  },
  ella: {
    name: 'Ella',
    x: 214,
    y: 314,
    description: 'Tea country, hikes, train views',
    labelSide: 'right',
  },
  yala: {
    name: 'Yala National Park',
    x: 257,
    y: 381,
    description: 'Premier wildlife and safari sanctuary',
    labelSide: 'right',
  },
  yala_national_park: {
    name: 'Yala National Park',
    x: 257,
    y: 381,
    description: 'Premier wildlife and safari sanctuary',
    labelSide: 'right',
  },
  galle: {
    name: 'Galle',
    x: 124,
    y: 412,
    description: 'Historic colonial fort city on southwest coast',
    labelSide: 'left',
  },
};

const knownRouteGeo: Record<string, { lat: number; lng: number }> = {
  bia: { lat: 7.1802, lng: 79.8842 },
  negombo: { lat: 7.2083, lng: 79.8358 },
  colombo: { lat: 6.9271, lng: 79.8612 },
  sigiriya: { lat: 7.957, lng: 80.7603 },
  kandy: { lat: 7.2906, lng: 80.6337 },
  ella: { lat: 6.8667, lng: 81.0466 },
  yala: { lat: 6.3721, lng: 81.5185 },
  yala_national_park: { lat: 6.3721, lng: 81.5185 },
  galle: { lat: 6.0535, lng: 80.221 },
};

function pixelToSriLankaLatLng(point: RouteMapPoint): { lat: number; lng: number } {
  return {
    lat: 9.85 - point.y * 0.0082,
    lng: 79.55 + point.x * 0.0063,
  };
}

function renderRouteMap(routeStops: string[]): string {
  const points = routeStops.length
    ? routeStops.map((stop, index) => resolveRoutePoint(stop, index, routeStops.length))
    : [knownRoutePoints.bia, knownRoutePoints.negombo, knownRoutePoints.galle];
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const uniqueLabelPoints = Array.from(
    new Map(points.map((point) => [normaliseStop(point.name), point])).values()
  );
  const routeDots = points
    .map((point) => `<circle class="route-dot" cx="${point.x}" cy="${point.y}" r="3.2" />`)
    .join('');
  const totalDistance = estimateRouteDistanceKm(points);
  const totalTime = Math.max(1, Math.round(totalDistance / 45));

  return `<svg class="route-map" viewBox="0 0 360 520" role="img" aria-label="Sri Lanka route map">
    <defs>
      <filter id="mapGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <rect width="360" height="520" fill="#061831" />
    <g class="sea-grid">
      <path d="M0 80 C80 120 140 80 220 110 S320 160 360 118" stroke="#75a8b7" fill="none" />
      <path d="M0 210 C90 250 170 195 260 238 S330 288 360 260" stroke="#75a8b7" fill="none" />
      <path d="M0 390 C90 430 170 375 260 418 S330 468 360 440" stroke="#75a8b7" fill="none" />
    </g>
    <path class="island" d="M178 41 C212 58 238 83 252 119 C272 170 292 221 304 271 C319 333 295 386 252 428 C219 461 174 478 129 455 C87 434 63 395 57 348 C52 306 62 270 82 235 C100 203 101 171 101 137 C102 91 132 51 178 41 Z" />
    <path class="terrain" d="M140 72 C166 103 157 133 177 166 C199 201 191 237 213 273 C233 306 230 340 256 376" />
    <path class="terrain" d="M111 141 C143 159 154 189 174 216 C194 244 206 271 235 292" />
    <path class="terrain" d="M91 294 C124 312 146 337 170 361 C191 382 218 398 251 406" />
    <path class="road" d="M92 249 L91 316 L124 412 L257 381 L214 314 L185 225 L202 154 L92 249" />
    <path class="road" d="M90 315 C122 302 152 274 185 225 C212 183 228 161 252 119" />
    <path class="route-shadow" d="${escapeHtml(path)}" />
    <path class="route-main" d="${escapeHtml(path)}" filter="url(#mapGlow)" />
    ${routeDots}
    ${uniqueLabelPoints.map(renderRoutePin).join('')}
    <g class="travel-badge" transform="translate(206 438)">
      <rect width="122" height="48" />
      <text x="14" y="20">Route approx</text>
      <text x="14" y="38">${totalTime} hr · ${totalDistance} km</text>
    </g>
  </svg>`;
}

function renderRoutePin(point: RouteMapPoint): string {
  const labelX = point.labelSide === 'left' ? point.x - 12 : point.x + 16;
  const anchor = point.labelSide === 'left' ? 'end' : 'start';
  const labelY = point.y - 10;
  return `<g>
    <line class="pin-stem" x1="${point.x}" y1="${point.y + 6}" x2="${point.x}" y2="${point.y + 18}" />
    <circle class="pin-head" cx="${point.x}" cy="${point.y}" r="12" />
    <circle class="pin-core" cx="${point.x}" cy="${point.y}" r="5" />
    <text class="map-label" x="${labelX}" y="${labelY}" text-anchor="${anchor}">${escapeHtml(point.name)}</text>
    <text class="map-caption" x="${labelX}" y="${labelY + 15}" text-anchor="${anchor}">${escapeHtml(point.description)}</text>
  </g>`;
}

function resolveRoutePoint(stop: string, index: number, total: number): RouteMapPoint {
  const key = normaliseStop(stop);
  const known = knownRoutePoints[key];
  if (known) {
    return known;
  }

  const progress = total <= 1 ? 0.5 : index / (total - 1);
  return {
    name: stop,
    x: 95 + Math.round(160 * progress),
    y: 260 + Math.round(120 * Math.sin(progress * Math.PI)),
    description: 'Planned stop',
    labelSide: progress < 0.45 ? 'left' : 'right',
  };
}

function normaliseStop(stop: string): string {
  return stop
    .trim()
    .toLowerCase()
    .replace(/bandaranaike international airport/g, 'bia')
    .replace(/airport/g, 'bia')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function estimateRouteDistanceKm(points: RouteMapPoint[]): number {
  if (points.length < 2) {
    return 0;
  }

  const total = points.slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    return sum + Math.sqrt(dx * dx + dy * dy) * 2.2;
  }, 0);

  return Math.max(20, Math.round(total / 10) * 10);
}

function renderSelectedDay(day: DailyItineraryPlan): string {
  return [
    renderDayHero(day),
    renderPlaceSuggestions(day),
    renderCard('Morning', day.morning, ['Add Activity', 'Show Similar']),
    renderCard('Afternoon', day.afternoon, ['Add Activity', 'Remove Activity']),
    renderCard('Evening', day.evening, ['Find Another Restaurant', 'Show Nightlife']),
    renderCard('Hotel', day.hotel, ['Replace Hotel']),
    renderCard('Restaurants', day.restaurantSuggestions, ['Find Another Restaurant']),
    renderCard('Transport', [day.transport, day.estimatedTravelTime], ['Adjust Pace', 'Change Transport']),
    renderCard('Cost', day.approximateCost, ['Change Budget']),
  ].join('');
}

function renderDayHero(day: DailyItineraryPlan): string {
  const heroImage = day.placeSuggestions?.[0]?.imageUrl ?? buildFallbackImageUrl(day.location);
  return `<section class="day-hero">
    <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(day.location)}" loading="lazy" />
    <div>
      <h2>Day ${day.day}: ${escapeHtml(day.location)}</h2>
      <p>${escapeHtml(day.date)} · ${escapeHtml(day.experiences.slice(0, 3).join(', '))}</p>
    </div>
  </section>`;
}

function renderPlaceSuggestions(day: DailyItineraryPlan): string {
  const suggestions = day.placeSuggestions ?? [];
  if (!suggestions.length) {
    return '';
  }

  return `<section class="place-grid">
    ${suggestions.map((place) => `<article class="place-card">
      <img src="${escapeHtml(place.imageUrl)}" alt="${escapeHtml(place.title)}" loading="lazy" />
      <div>
        <span class="category">${escapeHtml(place.category)}</span>
        <h3>${escapeHtml(place.title)}</h3>
        <p>${escapeHtml(place.description)}</p>
        <a href="${escapeHtml(place.mapUrl)}" target="_blank" rel="noopener">View on Google Maps</a>
      </div>
    </article>`).join('')}
  </section>`;
}

function buildFallbackImageUrl(location: string): string {
  return `https://source.unsplash.com/640x420/?${encodeURIComponent(`${location} Sri Lanka travel`)}`;
}

function renderCard(title: string, body: string | string[], actions: string[]): string {
  const safeBody = Array.isArray(body)
    ? body.map((line) => escapeHtml(line)).join('<br>')
    : escapeHtml(body);
  return `<div class="card">
    <h3>${escapeHtml(title)}</h3>
    <p>${safeBody}</p>
    <div class="actions">${actions.map((action) => `<button class="secondary" onclick="saveChange('${escapeHtml(action)}')">${escapeHtml(action)}</button>`).join('')}</div>
  </div>`;
}

function renderUnavailablePage(): string {
  return '<!doctype html><html><body><h1>Workspace unavailable</h1><p>This itinerary workspace link is unavailable or has expired.</p></body></html>';
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default router;
