import crypto from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getHotelSearchSettingsService, type HotelSearchSettings } from '../services/HotelSearchSettingsService.js';

const router = Router();

router.use('/admin/hotel-search', authenticateAdmin);

router.get('/admin/hotel-search', async (_req, res) => {
  const settings = await getHotelSearchSettingsService().getSettings();
  res.type('html').send(renderPage(settings));
});

router.post('/admin/hotel-search', async (req, res) => {
  try {
    const settings: HotelSearchSettings = {
      sltdaFilterEnabled: req.body.sltdaFilterEnabled === 'on',
      zeroResultFallbackEnabled: true,
      minimumGoogleRating: parseOptionalNumber(req.body.minimumGoogleRating, 0, 5),
      minimumGoogleReviewCount: parseOptionalInteger(req.body.minimumGoogleReviewCount, 0),
    };
    await getHotelSearchSettingsService().updateSettings(settings);
    res.redirect(303, '/admin/hotel-search?saved=1');
  } catch (error) {
    console.error('[HotelSearchAdmin] settings_update_failed', error);
    res.status(503).type('html').send('Unable to save hotel search settings. Check the database and migration 017.');
  }
});

function authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
  const configuredToken = process.env.ADMIN_CONTROL_TOKEN;
  if (!configuredToken) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const [scheme, encoded] = (req.header('authorization') ?? '').split(' ');
  const password = scheme === 'Basic' && encoded
    ? Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':')
    : '';
  const supplied = Buffer.from(password);
  const expected = Buffer.from(configuredToken);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="YANA hotel administration"');
    res.status(401).send('Authentication required');
    return;
  }
  next();
}

function parseOptionalNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error('Invalid numeric filter');
  return parsed;
}

function parseOptionalInteger(value: unknown, min: number): number | null {
  const parsed = parseOptionalNumber(value, min, Number.MAX_SAFE_INTEGER);
  if (parsed !== null && !Number.isInteger(parsed)) throw new Error('Invalid integer filter');
  return parsed;
}

function renderPage(settings: HotelSearchSettings): string {
  const checked = (value: boolean) => value ? ' checked' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>YANA Hotel Search Controls</title><style>
  body{font-family:system-ui,sans-serif;background:#f5f7fa;color:#18212f;margin:0}.wrap{max-width:720px;margin:48px auto;padding:0 20px}
  .card{background:white;border-radius:16px;padding:28px;box-shadow:0 8px 32px #14213d18}h1{margin-top:0}.row{padding:18px 0;border-bottom:1px solid #e5e9ef}
  label{font-weight:650;display:block}.hint{color:#5d6978;font-size:14px;margin-top:6px}input[type=number]{margin-top:9px;padding:9px;width:130px;border:1px solid #b9c2cf;border-radius:7px}
  button{margin-top:24px;background:#126b5b;color:white;border:0;border-radius:9px;padding:12px 20px;font-weight:700;cursor:pointer}.warning{background:#fff6dc;padding:12px;border-radius:8px;color:#705400}
  </style></head><body><main class="wrap"><div class="card"><h1>Hotel search controls</h1>
  <p class="warning">Keep zero-result fallback enabled to ensure customers receive Google discovery options when filters remove every result.</p>
  <form method="post">
  <div class="row"><label><input type="checkbox" name="sltdaFilterEnabled"${checked(settings.sltdaFilterEnabled)}> Require SLTDA verification during exploration</label><div class="hint">Off: show all Google discovery results. Booking-stage supplier verification remains separate.</div></div>
  <div class="row"><label><input type="checkbox" checked disabled> Zero-result filter safeguard</label><div class="hint">Always on: if active filters remove every candidate, YANA shows the original Google discovery results and records an internal fallback log.</div></div>
  <div class="row"><label>Minimum Google rating<input type="number" min="0" max="5" step="0.1" name="minimumGoogleRating" value="${settings.minimumGoogleRating ?? ''}" placeholder="Disabled"></label></div>
  <div class="row"><label>Minimum Google review count<input type="number" min="0" step="1" name="minimumGoogleReviewCount" value="${settings.minimumGoogleReviewCount ?? ''}" placeholder="Disabled"></label></div>
  <button type="submit">Save controls</button></form></div></main></body></html>`;
}

export default router;
