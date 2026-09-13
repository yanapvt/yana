import type { HumanHandoffConfig } from '../../config/humanHandoff.js';

export type HandoffStatus = 'pending' | 'assigned' | 'resolved' | 'cancelled';
export type HandoffChannel = 'native_whatsapp_group' | 'agent_queue';

export interface NearBookingHandoffRequest {
  sessionId: string;
  userId: string;
  correlationId: string;
  travelerConsented: boolean;
  authoritativeRecheckPassed: boolean;
  travelerIntendsToProceed: boolean;
  summary: { service: 'hotel'; selectedStayName: string; dates: string; guestCount: number };
}

export interface HandoffCase {
  handoffId: string; sessionId: string; status: HandoffStatus;
  channel: HandoffChannel; createdAt: Date; slaDueAt: Date; operatorId?: string; correlationId?: string;
}

export interface HandoffCaseStore {
  createOrGetOpenCase(input: Omit<HandoffCase, 'handoffId' | 'createdAt'> & {
    userId: string; correlationId: string; summary: NearBookingHandoffRequest['summary'];
  }): Promise<{ case: HandoffCase; created: boolean }>;
  updateChannel(handoffId: string, channel: HandoffChannel): Promise<HandoffCase>;
  updateStatus(handoffId: string, status: HandoffStatus): Promise<HandoffCase>;
  assign(handoffId: string, operatorId: string): Promise<HandoffCase>;
  findById(handoffId: string): Promise<HandoffCase | undefined>;
  findOverdue(now: Date, limit: number): Promise<HandoffCase[]>;
}

export interface HandoffSessionControl {
  markHandedOff(sessionId: string, handoffId: string): Promise<void>;
  clearHandedOff(sessionId: string, handoffId: string): Promise<void>;
}

export interface NativeWhatsAppGroupProvider {
  readonly capabilities: { nativeGroupCreation: boolean };
  createHandoffGroup(input: { handoffId: string; sessionId: string }): Promise<void>;
}

export interface AgentQueueNotifier {
  readonly capabilities: { queueNotification: boolean };
  notify(input: { handoffId: string; queueName: string; correlationId: string }): Promise<void>;
  escalate(input: { handoffId: string; queueName: string; correlationId: string }): Promise<void>;
}

export interface HandoffAuthorizer {
  canAssign(actorId: string): Promise<boolean>;
  canClose(actorId: string, handoff: HandoffCase): Promise<boolean>;
}

export interface HandoffAuditLogger {
  info(event: string, details: Record<string, unknown>): void;
  error(event: string, details: Record<string, unknown>): void;
}

export type HandoffResult =
  | { status: 'disabled' | 'consent_required' | 'not_ready' | 'delivery_unavailable'; reply: string }
  | { status: 'handed_off'; case: HandoffCase; duplicate: boolean; reply: string };

export type HandoffMutationResult =
  | { status: 'updated'; case: HandoffCase }
  | { status: 'forbidden' };

export class NearBookingHandoffService {
  constructor(
    private readonly config: HumanHandoffConfig,
    private readonly store: HandoffCaseStore,
    private readonly sessions: HandoffSessionControl,
    private readonly nativeProvider?: NativeWhatsAppGroupProvider,
    private readonly clock: () => Date = () => new Date(),
    private readonly queueNotifier?: AgentQueueNotifier,
    private readonly authorizer?: HandoffAuthorizer,
    private readonly audit: HandoffAuditLogger = console
  ) {}

  async requestHandoff(request: NearBookingHandoffRequest): Promise<HandoffResult> {
    if (!this.config.enabled) return { status: 'disabled', reply: 'Human concierge handoff is not currently available.' };
    if (!request.travelerConsented) {
      return { status: 'consent_required', reply: 'Would you like me to share the minimum stay-request details with a human travel concierge?' };
    }
    if (!request.authoritativeRecheckPassed || !request.travelerIntendsToProceed) {
      return { status: 'not_ready', reply: 'A current supplier availability and rate recheck plus your confirmation are required before handoff.' };
    }
    const channel = this.chooseInitialChannel();
    if (!channel) return { status: 'delivery_unavailable', reply: 'A human concierge queue is not currently available. No booking or payment was attempted.' };
    let stored: Awaited<ReturnType<HandoffCaseStore['createOrGetOpenCase']>>;
    try {
      stored = await this.store.createOrGetOpenCase({
        sessionId: request.sessionId, userId: request.userId, correlationId: request.correlationId,
        status: 'pending', channel, summary: request.summary,
        slaDueAt: new Date(this.clock().getTime() + this.config.slaMinutes * 60_000),
      });
    } catch {
      this.audit.error('handoff_case_storage_failed', this.safeAudit(request));
      return { status: 'delivery_unavailable', reply: 'A human concierge request could not be saved safely. Your trip details remain available, and no booking or payment was attempted.' };
    }
    const created = stored.case;
    if (!stored.created) {
      if (created.channel === 'agent_queue') {
        if (!this.queueNotifier?.capabilities.queueNotification) {
          return { status: 'delivery_unavailable', reply: 'A human concierge queue is not currently reachable. Your trip details remain saved, and no booking or payment was attempted.' };
        }
        try {
          await this.queueNotifier.notify({ handoffId: created.handoffId, queueName: this.config.queueName, correlationId: request.correlationId });
        } catch {
          this.audit.error('handoff_queue_notification_failed', this.safeAudit(request, created.handoffId));
          return { status: 'delivery_unavailable', reply: 'A human concierge could not be notified. Your trip details remain saved, and no booking or payment was attempted.' };
        }
      }
      await this.sessions.markHandedOff(request.sessionId, created.handoffId);
      return { status: 'handed_off', case: created, duplicate: true, reply: this.statusReply(created) };
    }

    let deliveredCase = created;
    if (channel === 'native_whatsapp_group') {
      try {
        await this.nativeProvider!.createHandoffGroup({ handoffId: created.handoffId, sessionId: created.sessionId });
      } catch {
        this.audit.error('handoff_native_delivery_failed', this.safeAudit(request, created.handoffId));
        if (!this.config.fallbackQueueEnabled) {
          await this.store.updateStatus(created.handoffId, 'cancelled');
          return { status: 'delivery_unavailable', reply: 'A human concierge could not be connected. No booking or payment was attempted.' };
        }
        deliveredCase = await this.store.updateChannel(created.handoffId, 'agent_queue');
      }
    }
    if (deliveredCase.channel === 'agent_queue') {
      if (!this.queueNotifier?.capabilities.queueNotification) {
        await this.store.updateStatus(created.handoffId, 'cancelled');
        return { status: 'delivery_unavailable', reply: 'A human concierge queue is not currently reachable. Your trip details remain saved, and no booking or payment was attempted.' };
      }
      try {
        await this.queueNotifier.notify({ handoffId: created.handoffId, queueName: this.config.queueName, correlationId: request.correlationId });
      } catch {
        this.audit.error('handoff_queue_notification_failed', this.safeAudit(request, created.handoffId));
        await this.store.updateStatus(created.handoffId, 'cancelled');
        return { status: 'delivery_unavailable', reply: 'A human concierge could not be notified. Your trip details remain saved, and no booking or payment was attempted.' };
      }
    }
    await this.sessions.markHandedOff(request.sessionId, created.handoffId);
    this.audit.info('handoff_created', this.safeAudit(request, created.handoffId));
    return { status: 'handed_off', case: deliveredCase, duplicate: false, reply: this.statusReply(deliveredCase) };
  }

  async assign(handoffId: string, actorId: string, operatorId: string): Promise<HandoffMutationResult> {
    if (!this.authorizer || !(await this.authorizer.canAssign(actorId))) return { status: 'forbidden' };
    const handoff = await this.store.assign(handoffId, operatorId);
    this.audit.info('handoff_assigned', { handoffId, operatorId, actorId });
    return { status: 'updated', case: handoff };
  }

  async close(handoffId: string, status: 'resolved' | 'cancelled', actorId: string): Promise<HandoffMutationResult> {
    const current = await this.store.findById(handoffId);
    if (!current || !this.authorizer || !(await this.authorizer.canClose(actorId, current))) {
      return { status: 'forbidden' };
    }
    const handoff = await this.store.updateStatus(handoffId, status);
    await this.sessions.clearHandedOff(current.sessionId, handoffId);
    this.audit.info(`handoff_${status}`, { handoffId, sessionId: current.sessionId, actorId });
    return { status: 'updated', case: handoff };
  }

  async escalateOverdue(limit = 50): Promise<number> {
    if (!this.queueNotifier?.capabilities.queueNotification) return 0;
    const overdue = await this.store.findOverdue(this.clock(), limit);
    let escalated = 0;
    for (const handoff of overdue) {
      try {
        await this.queueNotifier.escalate({ handoffId: handoff.handoffId, queueName: this.config.queueName, correlationId: handoff.correlationId ?? handoff.handoffId });
        this.audit.info('handoff_sla_escalated', { handoffId: handoff.handoffId });
        escalated += 1;
      } catch {
        this.audit.error('handoff_sla_escalation_failed', { handoffId: handoff.handoffId });
      }
    }
    return escalated;
  }

  statusReply(handoff: HandoffCase): string {
    if (handoff.status === 'resolved') return 'Your human concierge case is closed.';
    if (handoff.status === 'cancelled') return 'Your human concierge request was cancelled.';
    const channel = handoff.channel === 'native_whatsapp_group'
      ? 'A supported WhatsApp group handoff has been requested.'
      : 'Your request is in the human concierge queue.';
    return `${channel} Target response time: ${this.config.slaMinutes} minutes. YANA will not book or charge while the concierge is handling this request.`;
  }

  private chooseInitialChannel(): HandoffChannel | undefined {
    if (this.config.nativeGroupEnabled && this.nativeProvider?.capabilities.nativeGroupCreation) {
      return 'native_whatsapp_group';
    }
    return this.config.fallbackQueueEnabled ? 'agent_queue' : undefined;
  }

  private safeAudit(request: NearBookingHandoffRequest, handoffId?: string): Record<string, unknown> {
    return { correlationId: request.correlationId, sessionId: request.sessionId, service: request.summary.service, handoffId };
  }
}
