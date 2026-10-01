import { describe, expect, it, vi } from 'vitest';
import {
  isLicenceEligible,
  mapSriLankaAccommodationRow,
  SltdaRegistryService,
} from './SltdaRegistryService.js';

describe('SltdaRegistryService', () => {
  it('filters Google exploration results to deterministic SLTDA matches', () => {
    const service = new SltdaRegistryService(
      { findEligibleByLocation: vi.fn() },
      0.8,
      { info: vi.fn(), warn: vi.fn() }
    );
    const results = service.matchGoogleResults(
      [
        { id: 'google-amaya', googlePlaceId: 'google-amaya', name: 'Amaya Hills', address: 'Heerassagala, Kandy' },
        { id: 'google-other', googlePlaceId: 'google-other', name: 'Unregistered Guest House', address: 'Kandy' },
      ],
      [{
        id: 'reg-amaya', propertyName: 'Amaya Hills', normalizedName: 'amaya hills',
        address: 'P.O. BOX. 16, HEERASSAGALA, KANDY', localAuthority: 'Kandy',
        registrationNumber: 'SLTDA/SQA/HC/088', licenceValidUntil: '2026-12-31',
      }],
      'corr-google-filter'
    );

    expect(results).toEqual([
      expect.objectContaining({
        googlePlaceId: 'google-amaya',
        sltdaVerified: true,
        sltdaLicenceValidUntil: '2026-12-31',
      }),
    ]);
  });

  it('maps the existing srilanka_accommodations schema', () => {
    expect(mapSriLankaAccommodationRow({
      record_key: 'slt-1',
      name: 'Ocean View Hotel',
      stars: '4 Star',
      address: '10 Galle Road',
      local_authority: 'Galle',
      website: 'https://www.ocean.example/hotel',
      registration_no: 'REG-1',
      licence_no: 'LIC-1',
      licence_validity: '31/12/2026',
    })).toMatchObject({
      id: 'slt-1',
      propertyName: 'Ocean View Hotel',
      normalizedName: 'ocean view hotel',
      normalizedDomain: 'ocean.example',
      registrationNumber: 'REG-1',
      licenceNumber: 'LIC-1',
      licenceValidUntil: '2026-12-31',
      starRating: 4,
    });
  });

  it('maps the production SLTDA human-readable validity and star formats', () => {
    const record = mapSriLankaAccommodationRow({
      record_key: 'reg:SLTDASQAHC088',
      name: 'Amaya Hills',
      stars: '4 Stars',
      address: 'P.O. BOX. 16, HEERASSAGALA, KANDY',
      local_authority: 'Kandy',
      website: '[http://www.amayaresorts.com](http://www.amayaresorts.com)',
      registration_no: 'SLTDA/SQA/HC/088',
      licence_no: 'HC/2026/0082',
      licence_validity: 'Valid till 31st December 2026',
    });

    expect(record).toMatchObject({
      id: 'reg:SLTDASQAHC088',
      normalizedName: 'amaya hills',
      normalizedDomain: 'amayaresorts.com',
      licenceValidUntil: '2026-12-31',
      starRating: 4,
    });
    expect(isLicenceEligible(record, new Date('2026-09-02T00:00:00Z'))).toBe(true);
  });

  it('rejects an accommodation with an expired parseable licence date', () => {
    const expired = mapSriLankaAccommodationRow({ name: 'Old Hotel', registration_no: 'REG-OLD', licence_validity: '2025-01-31' });
    expect(isLicenceEligible(expired, new Date('2026-09-02T00:00:00Z'))).toBe(false);
  });

  it('does not verify a row without a registration or licence number', () => {
    const unregistered = mapSriLankaAccommodationRow({ name: 'Unregistered Hotel' });
    expect(isLicenceEligible(unregistered, new Date('2026-09-02T00:00:00Z'))).toBe(false);
  });

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
