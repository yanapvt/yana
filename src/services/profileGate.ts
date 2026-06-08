import { getProfileService, type ProfileService } from './profileService.js';
import { basicProfileFormSchema } from '../validation/formSchemas.js';

export interface ProfileGateResult {
  complete: boolean;
}

export class ProfileGate {
  constructor(private readonly profileService: ProfileService = getProfileService()) {}

  async check(userId: string): Promise<ProfileGateResult> {
    const profile = await this.profileService.getProfile(userId);
    return {
      complete: profile !== null && basicProfileFormSchema.safeParse(profile.form).success,
    };
  }
}

let profileGateInstance: ProfileGate | null = null;

export function getProfileGate(): ProfileGate {
  if (!profileGateInstance) {
    profileGateInstance = new ProfileGate();
  }

  return profileGateInstance;
}

export function initProfileGate(gate = new ProfileGate()): ProfileGate {
  profileGateInstance = gate;
  return gate;
}
