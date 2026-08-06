import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/environment.js';

interface MetaMediaMetadata {
  url?: string;
  mime_type?: string;
}

export class MetaWhatsAppMediaService {
  buildProxyUrl(mediaId: string): string {
    const baseUrl = getPublicBaseUrl();
    const signature = this.signMediaId(mediaId);
    return `${baseUrl}/media/meta/${encodeURIComponent(mediaId)}?sig=${encodeURIComponent(signature)}`;
  }

  isValidProxySignature(mediaId: string, signature?: string): boolean {
    if (!signature) {
      return false;
    }

    const expected = this.signMediaId(mediaId);
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  }

  async proxyMedia(req: Request, res: Response): Promise<void> {
    const mediaId = req.params.mediaId;
    const signature = typeof req.query.sig === 'string' ? req.query.sig : undefined;

    if (!mediaId || !this.isValidProxySignature(mediaId, signature)) {
      res.status(404).send('Not found');
      return;
    }

    if (!this.isConfigured()) {
      res.status(503).send('Meta media is not configured');
      return;
    }

    const metadata = await this.getMediaMetadata(mediaId);
    if (!metadata.url) {
      res.status(404).send('Not found');
      return;
    }

    const mediaResponse = await fetch(metadata.url, {
      headers: {
        Authorization: `Bearer ${env.meta.accessToken}`,
      },
    });

    if (!mediaResponse.ok) {
      res.status(502).send('Unable to load media');
      return;
    }

    const contentType =
      mediaResponse.headers.get('content-type') ?? metadata.mime_type ?? 'application/octet-stream';
    const media = Buffer.from(await mediaResponse.arrayBuffer());
    res.set({
      'Cache-Control': 'private, max-age=300',
      'Content-Type': contentType,
    });
    res.send(media);
  }

  isConfigured(): boolean {
    return Boolean(env.meta.accessToken);
  }

  private async getMediaMetadata(mediaId: string): Promise<MetaMediaMetadata> {
    const response = await fetch(`${this.graphBaseUrl()}/${encodeURIComponent(mediaId)}`, {
      headers: {
        Authorization: `Bearer ${env.meta.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Meta media metadata failed with ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as MetaMediaMetadata;
  }

  private signMediaId(mediaId: string): string {
    return crypto
      .createHmac('sha256', this.mediaProxySecret())
      .update(mediaId)
      .digest('hex');
  }

  private mediaProxySecret(): string {
    return (
      env.meta.mediaProxySecret ||
      env.meta.appSecret ||
      env.meta.accessToken ||
      'dev_meta_media_proxy_secret'
    );
  }

  private graphBaseUrl(): string {
    return `https://graph.facebook.com/${env.meta.apiVersion}`;
  }
}

function getPublicBaseUrl(): string {
  return (
    process.env.FORM_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || '3000'}`
  ).replace(/\/$/, '');
}

let metaWhatsAppMediaServiceInstance: MetaWhatsAppMediaService | null = null;

export function getMetaWhatsAppMediaService(): MetaWhatsAppMediaService {
  if (!metaWhatsAppMediaServiceInstance) {
    metaWhatsAppMediaServiceInstance = new MetaWhatsAppMediaService();
  }

  return metaWhatsAppMediaServiceInstance;
}

export function initMetaWhatsAppMediaService(
  service = new MetaWhatsAppMediaService()
): MetaWhatsAppMediaService {
  metaWhatsAppMediaServiceInstance = service;
  return service;
}
