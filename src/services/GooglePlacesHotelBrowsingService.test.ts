import { afterEach, describe, expect, it, vi } from 'vitest';
import { GooglePlacesHotelBrowsingService } from './GooglePlacesHotelBrowsingService.js';

describe('GooglePlacesHotelBrowsingService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches Google Places for top lodging browse results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: 'google-place-1',
            displayName: { text: 'Colombo Court Hotel' },
            formattedAddress: 'Colombo 03, Sri Lanka',
            rating: 4.3,
            userRatingCount: 800,
            priceLevel: 'PRICE_LEVEL_EXPENSIVE',
            googleMapsUri: 'https://maps.google.com/?cid=1',
            photos: [{ name: 'places/place-1/photos/photo-1' }],
          },
        ],
      }),
    } as Response);

    const service = new GooglePlacesHotelBrowsingService({
      apiKey: 'test-google-key',
    });

    const response = await service.searchHotels({
      location: 'Colombo 03',
      guests: 2,
      budgetPerNight: {
        amount: 50,
        currency: 'USD',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places:searchText',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'test-google-key',
        }),
      })
    );
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toMatchObject({
      textQuery: 'hotels in Colombo 03 under USD 50 per night for 2 guests',
      includedType: 'lodging',
      maxResultCount: 9,
    });
    expect(response.results[0]).toMatchObject({
      id: 'google-place-1',
      googlePlaceId: 'google-place-1',
      name: 'Colombo Court Hotel',
      googleMapsUri: 'https://maps.google.com/?cid=1',
      priceRange: '$$$',
      thumbnailUrl:
        'http://localhost:3000/media/google-place-photo?name=places%2Fplace-1%2Fphotos%2Fphoto-1',
    });
  });

  it('does not call Google Places when hotel discovery is disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const service = new GooglePlacesHotelBrowsingService({
      apiKey: 'test-google-key',
      enabled: false,
    });

    expect(service.isConfigured()).toBe(false);
    await expect(service.searchHotels({ location: 'Colombo' })).resolves.toEqual({
      provider: 'google_places',
      results: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
