import { env } from '../config/environment.js';
import { toOpenWaChatId } from '../utils/openWaMessageNormalizer.js';

interface OpenWaContactConfig { baseUrl?: string; apiKey?: string; sessionId?: string }

export class OpenWaContactService {
  constructor(
    private readonly config: OpenWaContactConfig = env.openwa,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getWhatsAppDisplayName(userId: string): Promise<string | null> {
    if (!this.config.baseUrl || !this.config.apiKey || !this.config.sessionId) return null;
    const contactId = toOpenWaChatId(userId);
    if (!/^[\w:+.-]+@(c\.us|lid)$/i.test(contactId)) return null;

    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/api/sessions/${encodeURIComponent(this.config.sessionId)}/contacts/${encodeURIComponent(contactId)}`;
    try {
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { 'X-API-Key': this.config.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(1800),
      });
      if (!response.ok) return null;
      const contact = await response.json() as { pushName?: unknown; name?: unknown };
      return getName(contact.pushName) ?? getName(contact.name);
    } catch {
      return null;
    }
  }
}

let instance: OpenWaContactService | null = null;

export function getOpenWaContactService(): OpenWaContactService {
  if (!instance) instance = new OpenWaContactService();
  return instance;
}

function getName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
