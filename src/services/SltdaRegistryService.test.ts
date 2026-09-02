import { describe, expect, it, vi } from 'vitest';
import { SltdaRegistryService } from './SltdaRegistryService.js';

describe('SltdaRegistryService', () => {
  it('matches the same registered property and enriches it with Google data', () => {
    const service = new SltdaRegistryService(
      { findEligibleByLocation: vi.fn() },
      0.8,
      { info: vi.fn(), warn: vi.fn() }
    );
    const matches = service.matchHotels(
      [{
        yanaHotelId: 'hotel-1',
        name: 'Ocean View Hotel',
        destination: 'Galle',
        country: 'Sri Lanka',
        address: '10 Galle Road, Galle',
        images: [],
        amenities: [],
        supplierReferences: [],
        rooms: [],
      }],
      [{
        id: 'registry-1',
        propertyName: 'Ocean View Hotel',
        normalizedName: 'ocean view hotel',
        address: '10 Galle Road, Galle',
        district: 'Galle',
        registrationNumber: 'SLTDA-1',
        licenceValidUntil: '2026-12-31',
      }],
      [{ name: 'Ocean View Hotel', address: '10 Galle Road, Galle', rating: 4.6 }],
      'corr-1'
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      confidence: 1,
      registry: { registrationNumber: 'SLTDA-1' },
      google: { rating: 4.6 },
    });
  });

  it('does not verify an ambiguous property name', () => {
    const service = new SltdaRegistryService(
      { findEligibleByLocation: vi.fn() },
      0.8,
      { info: vi.fn(), warn: vi.fn() }
    );
    const matches = service.matchHotels(
      [{
        yanaHotelId: 'hotel-1',
        name: 'Palm Resort',
        destination: 'Galle',
        country: 'Sri Lanka',
        images: [], amenities: [], supplierReferences: [], rooms: [],
      }],
      [{ id: 'registry-1', propertyName: 'Palm Villa Kandy', normalizedName: 'palm villa kandy', district: 'Kandy' }],
      [],
      'corr-2'
    );
    expect(matches).toEqual([]);
  });
});
