import { Router, type Request, type Response } from 'express';
import { getTextToSpeechService } from '../services/TextToSpeechService.js';
import { getMetaWhatsAppMediaService } from '../services/MetaWhatsAppMediaService.js';

const router = Router();

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
