import { describe, expect, it, vi } from 'vitest';
import { ExcursionSearchFlowService } from './ExcursionSearchFlowService.js';

describe('ExcursionSearchFlowService discovery', () => {
  it('returns Google Places exploration suggestions with only a destination', async () => {
    const browsingService = {
      isConfigured: vi.fn().mockReturnValue(true),
      searchExcursions: vi.fn().mockResolvedValue({
        provider: 'google_places',
        results: [{ name: 'Galle Fort', category: 'History' }],
      }),
    };
    const service = new ExcursionSearchFlowService({ browsingService: browsingService as any });

    const result = await service.handleBrowseSearch(
      { destination: 'Galle' },
      { correlationId: 'excursion-discovery' }
    );

    expect(result.status).toBe('browse_results');
    expect(result.reply).toContain('Galle Fort');
    expect(result.reply).toContain('Live availability and provider booking are not connected yet');
    expect(result.reply).not.toContain('book 1');
    expect(browsingService.searchExcursions).toHaveBeenCalledWith(
      { destination: 'Galle' },
      { maxResults: 9 }
    );
  });
});
