import { describe, expect, it, vi } from 'vitest';
import { ProfileService } from './ProfileService.js';
import type { ProfileRepository } from '../storage/profileRepository.js';
import type { ServiceRequestRepository } from '../storage/serviceRequestRepository.js';

describe('ProfileService', () => {
  it('finds the newest form across service types for ambiguous replies', async () => {
    const findByUserId = vi.fn().mockResolvedValue([
      { id: 'itinerary-old', type: 'itinerary', createdAt: new Date('2026-10-16T10:00:00Z') },
      { id: 'restaurant-new', type: 'restaurant', createdAt: new Date('2026-10-17T10:00:00Z') },
    ]);
    const service = new ProfileService(
      {} as ProfileRepository,
      { findByUserId } as unknown as ServiceRequestRepository
    );

    expect((await service.getLatestServiceRequestOverall('whatsapp:+94770000000'))?.id)
      .toBe('restaurant-new');
    expect(findByUserId).toHaveBeenCalledWith('whatsapp:+94770000000');
  });
});
