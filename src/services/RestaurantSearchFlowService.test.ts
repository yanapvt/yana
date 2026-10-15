import { describe, expect, it, vi } from 'vitest';
import { RestaurantSearchFlowService } from './RestaurantSearchFlowService.js';

describe('RestaurantSearchFlowService discovery', () => {
  it('returns Google Places exploration suggestions with only a location', async () => {
    const browsingService = {
      isConfigured: vi.fn().mockReturnValue(true),
      searchRestaurants: vi.fn().mockResolvedValue({
        provider: 'google_places',
        results: [{ name: 'Galle Seafood House', rating: 4.5 }],
      }),
    };
    const service = new RestaurantSearchFlowService({ browsingService: browsingService as any });

    const result = await service.handleBrowseSearch(
      { location: 'Galle' },
      { correlationId: 'restaurant-discovery' }
    );

    expect(result.status).toBe('browse_results');
    expect(result.reply).toContain('Galle Seafood House');
    expect(result.reply).toContain('contact the restaurant directly');
    expect(result.reply).not.toContain('book 1');
    expect(browsingService.searchRestaurants).toHaveBeenCalledWith(
      { location: 'Galle' },
      { maxResults: 9 }
    );
  });
});
