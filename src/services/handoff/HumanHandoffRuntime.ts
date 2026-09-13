import { createHash } from 'node:crypto';
import { loadHumanHandoffConfig, type HumanHandoffConfig } from '../../config/humanHandoff.js';
import { SessionRepository } from '../../db/repositories/SessionRepository.js';
import { UserRepository } from '../../db/repositories/UserRepository.js';
import type { HotelSearchCriteria } from '../HotelIntakeService.js';
import type { SelectedHotel } from '../hotelSearchSessionService.js';
import { HotelSearchHandoffSessionControl } from './HotelSearchHandoffSessionControl.js';
import { NearBookingHandoffService, type HandoffAuthorizer, type HandoffResult } from './NearBookingHandoffService.js';
import { PostgresAgentQueueNotifier } from './PostgresAgentQueueNotifier.js';
import { PostgresHandoffCaseStore } from './PostgresHandoffCaseStore.js';

export interface HandoffIdentityResolver {
  resolve(whatsappUserId: string): Promise<{ userId: string; sessionId: string } | undefined>;
}

export class PostgresHandoffIdentityResolver implements HandoffIdentityResolver {
  constructor(private readonly users = new UserRepository(), private readonly sessions = new SessionRepository()) {}

  async resolve(whatsappUserId: string): Promise<{ userId: string; sessionId: string } | undefined> {
    const phone = whatsappUserId.replace(/^whatsapp:/, '');
    const user = await this.users.findByPhoneNumber(phone);
    if (!user) return undefined;
    const session = (await this.sessions.findActiveByUserId(user.userId)) ??
      (await this.sessions.createSession(user.userId, phone));
    return session ? { userId: user.userId, sessionId: session.sessionId } : undefined;
  }
}

class AuthenticatedOperatorAuthorizer implements HandoffAuthorizer {
  async canAssign(actorId: string): Promise<boolean> { return isUuid(actorId); }
  async canClose(actorId: string): Promise<boolean> { return isUuid(actorId); }
}

export class HumanHandoffRuntime {
  private timer?: NodeJS.Timeout;

  constructor(
    readonly config: HumanHandoffConfig,
    readonly service: NearBookingHandoffService,
    private readonly identities: HandoffIdentityResolver
  ) {}

  async requestHotelHandoff(input: {
    whatsappUserId: string;
    correlationId: string;
    travelerConsented: boolean;
    criteria: HotelSearchCriteria;
    selectedHotel: SelectedHotel;
  }): Promise<HandoffResult> {
    if (!this.config.enabled) {
      return { status: 'disabled', reply: 'Human concierge handoff is not currently available.' };
    }
    if (!input.travelerConsented) {
      return { status: 'consent_required', reply: 'Would you like me to share the minimum stay-request details with a human travel concierge?' };
    }
    const identity = await this.identities.resolve(input.whatsappUserId);
    if (!identity) {
      return { status: 'delivery_unavailable', reply: 'I could not safely open a human concierge case. Your trip details remain saved, and no booking or payment was attempted.' };
    }
    return this.service.requestHandoff({
      ...identity,
      correlationId: input.correlationId,
      travelerConsented: true,
      authoritativeRecheckPassed: true,
      travelerIntendsToProceed: true,
      summary: {
        service: 'hotel',
        selectedStayName: input.selectedHotel.selectedHotelSnapshot.name,
        dates: `${input.criteria.checkinDate}/${input.criteria.checkoutDate}`,
        guestCount: input.criteria.guests ?? 2,
      },
    });
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.runSlaCycle().catch(() => {
        console.error('handoff_sla_cycle_failed', { correlationId: 'scheduled-sla-cycle' });
      });
    }, this.config.slaPollSeconds * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runSlaCycle(): Promise<number> {
    if (!this.config.enabled) return 0;
    return this.service.escalateOverdue();
  }
}

let runtime: HumanHandoffRuntime | undefined;

export function getHumanHandoffRuntime(): HumanHandoffRuntime {
  if (!runtime) {
    const config = loadHumanHandoffConfig();
    runtime = new HumanHandoffRuntime(
      config,
      new NearBookingHandoffService(
        config,
        new PostgresHandoffCaseStore(),
        new HotelSearchHandoffSessionControl(),
        undefined,
        undefined,
        new PostgresAgentQueueNotifier(config.fallbackQueueEnabled),
        new AuthenticatedOperatorAuthorizer()
      ),
      new PostgresHandoffIdentityResolver()
    );
  }
  return runtime;
}

export function initHumanHandoffRuntime(value: HumanHandoffRuntime): HumanHandoffRuntime {
  runtime?.stop();
  runtime = value;
  return value;
}

export function hashOperatorToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
