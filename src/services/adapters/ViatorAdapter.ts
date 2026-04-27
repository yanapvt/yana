/**
 * ViatorAdapter
 *
 * Tours and activities via Viator (TripAdvisor subsidiary).
 * Affiliate/partner API — returns bookable excursions with photos and pricing.
 *
 * Docs: https://docs.viator.com/partner-api/technical/
 * Requires: Viator partner API key
 */

import { BaseProviderAdapter } from './ProviderAdapter.js';
import { CorrelationContext } from '../../types/core.js';
import { logger } from '../../config/logger.js';
import type {
  NormalisedExcursion,
  ExcursionSearchParams,
  ExcursionSearchResult,
  ProviderImage,
} from './types.js';

const VIATOR_BASE = 'https://api.viator.com/partner';

interface ViatorProduct {
  productCode: string;
  title: string;
  description?: string;
  duration?: { fixedDurationInMinutes?: number };
  pricing?: { summary?: { fromPrice?: number; currencyCode?: string } };
  reviews?: { combinedAverageRating?: number; totalReviews?: number };
  location?: { address?: string };
  categories?: Array<{ name?: string }>;
  bookingUrl?: string;
  images?: Array<{ variants?: Array<{ url?: string }> }>;
  highlights?: string[];
  cancellationPolicy?: { type?: string; description?: string };
}

interface ViatorSearchResponse {
  products?: ViatorProduct[];
  totalCount?: number;
  errorMessage?: string;
}

export class ViatorAdapter extends BaseProviderAdapter {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    super({ maxRetries: 3, initialDelayMs: 1000 });
    this.apiKey = apiKey;
  }

  getProviderName(): string {
    return 'viator';
  }

  async execute(params: Record<string, unknown>, ctx: CorrelationContext): Promise<ExcursionSearchResult> {
    return this.searchExcursions(params as unknown as ExcursionSearchParams, ctx);
  }

  normalizeResponse(rawResponse: unknown): unknown {
    return rawResponse;
  }

  async searchExcursions(params: ExcursionSearchParams, ctx: CorrelationContext): Promise<ExcursionSearchResult> {
    logger.debug('ViatorAdapter', 'Searching excursions', {
      correlationId: ctx.correlationId,
      location: params.location,
      category: params.category,
    });

    const body: Record<string, unknown> = {
      filtering: {
        destination: params.location,
        ...(params.category && { tags: [params.category] }),
        ...(params.maxBudget && { price: { high: params.maxBudget } }),
        ...(params.durationMaxHours && { duration: { to: { value: params.durationMaxHours * 60, unit: 'MINUTE' } } }),
      },
      sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
      pagination: { start: 1, count: 15 },
      currency: params.currency ?? 'USD',
    };

    const response = await this.post<ViatorSearchResponse>('/products/search', body, ctx);

    if (response.errorMessage) throw new Error(`Viator error: ${response.errorMessage}`);

    const excursions = (response.products ?? []).map((p) => this.normaliseProduct(p, params.currency ?? 'USD'));

    return {
      excursions,
      totalResults: response.totalCount ?? excursions.length,
      provider: 'viator',
    };
  }

  private normaliseProduct(p: ViatorProduct, currency: string): NormalisedExcursion {
    const images: ProviderImage[] = (p.images ?? [])
      .slice(0, 3)
      .map((img) => ({
        url: img.variants?.find((v) => v.url)?.url ?? '',
        source: 'provider',
      }))
      .filter((img) => img.url);

    const durationHours = p.duration?.fixedDurationInMinutes
      ? p.duration.fixedDurationInMinutes / 60
      : undefined;

    return {
      provider: 'viator',
      excursionId: p.productCode,
      title: p.title,
      description: p.description ?? '',
      durationHours,
      priceFrom: p.pricing?.summary?.fromPrice ?? 0,
      currency: p.pricing?.summary?.currencyCode ?? currency,
      rating: p.reviews?.combinedAverageRating ?? 0,
      reviewCount: p.reviews?.totalReviews ?? 0,
      location: p.location?.address ?? '',
      category: p.categories?.[0]?.name ?? 'activity',
      bookingUrl: p.bookingUrl ?? `https://www.viator.com/tours/${p.productCode}`,
      images,
      highlights: p.highlights ?? [],
      cancellationPolicy: p.cancellationPolicy?.description ?? p.cancellationPolicy?.type,
    };
  }

  private async post<T>(path: string, body: unknown, ctx: CorrelationContext): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryPolicy.maxRetries + 1; attempt++) {
      try {
        const res = await fetch(`${VIATOR_BASE}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'exp-api-key': this.apiKey,
            Accept: 'application/json;version=2.0',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Viator HTTP ${res.status}`);
        return await res.json() as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt <= this.retryPolicy.maxRetries) await this.sleep(this.calculateBackoffDelay(attempt - 1));
      }
    }
    throw lastError ?? new Error('ViatorAdapter: request failed');
  }
}
