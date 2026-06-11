import type {
  BasicProfileForm,
  FormType,
  ServiceRequestForm,
  StoredProfile,
  StoredServiceRequest,
} from '../types/forms.js';
import { PostgresProfileRepository, type ProfileRepository } from '../storage/profileRepository.js';
import {
  PostgresServiceRequestRepository,
  type ServiceRequestRepository,
} from '../storage/serviceRequestRepository.js';

type ServiceFormType = Exclude<FormType, 'profile'>;

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository = new PostgresProfileRepository(),
    private readonly serviceRequestRepository: ServiceRequestRepository = new PostgresServiceRequestRepository()
  ) {}

  getProfile(userId: string): Promise<StoredProfile | null> {
    return this.profileRepository.findByUserId(userId);
  }

  saveProfile(userId: string, form: BasicProfileForm): Promise<StoredProfile> {
    return this.profileRepository.upsert(userId, form);
  }

  saveServiceRequest<T extends ServiceRequestForm>(
    userId: string,
    type: ServiceFormType,
    form: T
  ): Promise<StoredServiceRequest<T>> {
    return this.serviceRequestRepository.create(userId, type, form);
  }

  getServiceRequests(userId: string, type?: ServiceFormType): Promise<StoredServiceRequest[]> {
    return this.serviceRequestRepository.findByUserId(userId, type);
  }

  async getLatestServiceRequest(
    userId: string,
    type: ServiceFormType
  ): Promise<StoredServiceRequest | null> {
    const requests = await this.serviceRequestRepository.findByUserId(userId, type);
    return requests
      .slice()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }
}

let profileServiceInstance: ProfileService | null = null;

export function getProfileService(): ProfileService {
  if (!profileServiceInstance) {
    profileServiceInstance = new ProfileService();
  }

  return profileServiceInstance;
}

export function initProfileService(service = new ProfileService()): ProfileService {
  profileServiceInstance = service;
  return service;
}
