import { randomUUID } from 'node:crypto';
import { pool } from '../db/connection.js';
import { env } from '../config/environment.js';
import { getOpenWaOutboundService } from './OpenWaOutboundService.js';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { getProfileGate } from './profileGate.js';
import { getLLMService } from './LLMService.js';

type ReminderFlow = 'profile' | 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary';
type FollowupType = 'unfinished_workflow' | 'confirmed_service_feedback';

/** One opt-in follow-up after 30 minutes of inactivity. The worker sends only through the
 * configured OpenWA path; Meta/Twilio need a separate approved-template adapter. */
export class UnfinishedWorkflowReminderService {
  async onInbound(userId: string): Promise<void> {
    if (!env.features.proactiveMessagingEnabled) return;
    await this.cancelPending(userId);
    await pool.query(`UPDATE notifications n SET scheduled_at=NOW() + INTERVAL '30 minutes',next_attempt_at=NULL
      FROM users u WHERE n.user_id=u.user_id AND u.phone_number=$1
        AND n.notification_type='confirmed_service_feedback' AND n.status IN ('scheduled','failed')`, [normalize(userId)]);
  }

  private async cancelPending(userId: string): Promise<void> {
    await pool.query(`UPDATE notifications n SET status='cancelled' FROM users u
      WHERE n.user_id=u.user_id AND u.phone_number=$1 AND n.notification_type='unfinished_workflow'
        AND n.status IN ('scheduled','failed')`, [normalize(userId)]);
  }

  async scheduleFromReply(userId: string, reply: string, inboundText = ''): Promise<void> {
    if (!env.features.proactiveMessagingEnabled || env.whatsapp.provider !== 'openwa') return;
    if (/^(?:yes[, ]+)?(?:remind me|send me a reminder)(?: in 30 minutes| tomorrow)?$/i.test(inboundText.trim()) ||
      /^(stop reminders|don't remind me|do not remind me)$/i.test(inboundText.trim())) return;
    const form = reply.match(/\/forms\/(profile|hotel|restaurant|excursion|logistics|itinerary)\//)?.[1] as ReminderFlow | undefined;
    const { activeSession, pausedSessions } = await new ActiveConversationStateLoader().loadWithPaused(userId)
      .catch(() => ({ activeSession: null, pausedSessions: [] }));
    const pending = [...new Set([form, ...[activeSession, ...pausedSessions]
      .filter((session) => session && session.flow !== 'none' && incomplete(session))
      .map((session) => session!.flow as ReminderFlow)].filter((flow): flow is ReminderFlow => Boolean(flow)))].slice(0, 3);
    if (pending.length) await this.schedule(userId, pending);
  }

  async handlePreferenceMessage(userId: string, message: string): Promise<string | null> {
    const text = message.trim();
    const stop = /^(stop reminders|don't remind me|do not remind me)$/i.test(text);
    const start = /^(?:yes[, ]+)?(?:remind me|send me a reminder)(?: in 30 minutes| tomorrow)?$/i.test(text);
    if (!stop && !start) return null;
    const result = await pool.query(`UPDATE user_preferences p SET proactive_messaging_enabled=$2,updated_at=NOW()
      FROM users u WHERE p.user_id=u.user_id AND u.phone_number=$1 RETURNING p.user_id`, [normalize(userId), start]);
    if (!result.rowCount) return 'Please complete your travel profile first so I can save that reminder preference.';
    if (stop) {
      await this.cancelPending(userId);
      await pool.query(`UPDATE notifications n SET status='cancelled' FROM users u
        WHERE n.user_id=u.user_id AND u.phone_number=$1 AND n.notification_type='confirmed_service_feedback'
          AND n.status IN ('scheduled','failed')`, [normalize(userId)]);
      return "Of course. I won't send follow-up messages. Your saved request is still available whenever you return.";
    }
    if (!env.features.proactiveMessagingEnabled || env.whatsapp.provider !== 'openwa') {
      return 'I saved your reminder preference. Timed reminders are not available on this channel yet, but your request will be here when you return.';
    }
    const { activeSession } = await new ActiveConversationStateLoader().loadWithPaused(userId);
    const flow = activeSession?.flow as ReminderFlow | undefined;
    if (flow && activeSession && (activeSession.missingFields.length || /awaiting|collect|form_sent/i.test(activeSession.state ?? ''))) {
      await this.schedule(userId, [flow], /tomorrow/i.test(text) ? '24 hours' : '30 minutes');
      return /tomorrow/i.test(text)
        ? "Of course. I'll send one reminder tomorrow if this request is still unfinished."
        : "Of course. I'll check back in 30 minutes if this request is still unfinished and you haven't messaged me.";
    }
    return "I saved your reminder preference. I'll offer a reminder when there's an unfinished request to complete.";
  }

  private async schedule(userId: string, flows: ReminderFlow[], delay: '30 minutes' | '24 hours' = '30 minutes'): Promise<void> {
    await pool.query(`INSERT INTO notifications (user_id, notification_type, scheduled_at, content, metadata)
      SELECT u.user_id,'unfinished_workflow',NOW() + ($4::text)::interval,$2::jsonb,$3::jsonb
      FROM users u JOIN user_preferences p ON p.user_id=u.user_id
      WHERE u.phone_number=$1 AND p.proactive_messaging_enabled=true`,
    [normalize(userId), JSON.stringify({ flow: flows[0], flows }), JSON.stringify({ source: 'concierge' }), delay]);
  }

  async processOne(): Promise<'idle' | 'sent' | 'skipped' | 'retry'> {
    if (!env.features.proactiveMessagingEnabled || env.whatsapp.provider !== 'openwa') return 'idle';
    const worker = randomUUID();
    const claimed = await pool.query<{ notification_id: string; phone_number: string; flow: ReminderFlow; flows: ReminderFlow[] | null; notification_type: FollowupType; booking_id: string | null; attempt_count: number }>(
      `WITH candidate AS (
        SELECT notification_id FROM notifications
        WHERE notification_type IN ('unfinished_workflow','confirmed_service_feedback')
          AND ((status IN ('scheduled','failed') AND COALESCE(next_attempt_at,scheduled_at)<=NOW())
            OR (status='processing' AND lease_expires_at<=NOW()))
          AND attempt_count<3
        ORDER BY COALESCE(next_attempt_at,scheduled_at) FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE notifications n SET status='processing',lease_owner=$1,
        lease_expires_at=NOW() + INTERVAL '2 minutes',attempt_count=attempt_count+1
      FROM candidate, users u WHERE n.notification_id=candidate.notification_id AND u.user_id=n.user_id
      RETURNING n.notification_id,u.phone_number,n.content->>'flow' AS flow,n.content->'flows' AS flows,n.notification_type,n.booking_id,n.attempt_count`, [worker]
    );
    const item = claimed.rows[0];
    if (!item) return 'idle';
    try {
      const preference = await pool.query<{ enabled: boolean }>(
        `SELECT proactive_messaging_enabled AS enabled FROM user_preferences p
         JOIN users u ON u.user_id=p.user_id WHERE u.phone_number=$1`, [item.phone_number]);
      const flows = item.notification_type === 'unfinished_workflow'
        ? (Array.isArray(item.flows) && item.flows.length ? item.flows : [item.flow]).filter(Boolean).slice(0, 3)
        : [item.flow];
      const incompleteFlags = item.notification_type === 'unfinished_workflow'
        ? await Promise.all(flows.map((flow) => this.stillIncomplete(item.phone_number, flow))) : [];
      const relevantFlows = item.notification_type === 'unfinished_workflow'
        ? flows.filter((_, index) => incompleteFlags[index]) : flows;
      const allowed = preference.rows[0]?.enabled === true &&
        (item.notification_type === 'unfinished_workflow'
          ? relevantFlows.length > 0
          : await this.stillConfirmed(item.booking_id));
      if (!allowed) {
        await this.finish(item.notification_id, worker, 'cancelled');
        return 'skipped';
      }
      const outbound = getOpenWaOutboundService();
      if (!outbound.isConfigured()) throw new Error('Outbound unavailable');
      const services = relevantFlows.map(label).join(relevantFlows.length === 2 ? ' and ' : ', ');
      const fallback = item.notification_type === 'unfinished_workflow'
        ? `Hello again. Your ${services} ${relevantFlows.length === 1 ? 'request is' : 'requests are'} still here. Would you like to finish ${relevantFlows.length === 1 ? 'it' : 'them'}? Reply “continue” whenever you're ready.`
        : `Hello again. How did your ${label(item.flow)} service go? I'd be glad to hear whether everything was as you hoped.`;
      const wording = await this.composeFollowup(item.notification_type, services, fallback);
      const sent = await outbound.sendWhatsAppReply(item.phone_number, wording);
      if (!sent) throw new Error('Delivery unavailable');
      await this.finish(item.notification_id, worker, 'sent');
      return 'sent';
    } catch {
      await pool.query(`UPDATE notifications SET status='failed',next_attempt_at=NOW() + INTERVAL '1 hour',
        lease_owner=NULL,lease_expires_at=NULL WHERE notification_id=$1 AND lease_owner=$2`,
      [item.notification_id, worker]);
      return 'retry';
    }
  }

  private async stillIncomplete(userId: string, flow: ReminderFlow): Promise<boolean> {
    if (flow === 'profile') return !(await getProfileGate().check(userId)).complete;
    const { activeSession, pausedSessions } = await new ActiveConversationStateLoader().loadWithPaused(userId);
    const session = [activeSession, ...pausedSessions].find((item) => item?.flow === flow);
    return Boolean(session && incomplete(session));
  }

  private async stillConfirmed(bookingId: string | null): Promise<boolean> {
    if (!bookingId) return false;
    const result = await pool.query<{ state: string }>('SELECT state FROM bookings WHERE booking_id=$1', [bookingId]);
    return result.rows[0]?.state === 'confirmed';
  }

  private async composeFollowup(type: FollowupType, services: string, fallback: string): Promise<string> {
    try {
      const proposal = (await getLLMService().generateUIContent({
        task: type === 'unfinished_workflow'
          ? 'Write a single gentle WhatsApp reminder that the traveller can finish an unfinished request by replying continue.'
          : 'Write a single courteous WhatsApp question asking whether the traveller was happy with a backend-confirmed service.',
        service: services, verifiedStatus: type === 'confirmed_service_feedback' ? 'confirmed' : 'unfinished',
        rules: 'Do not claim a booking was made, invent details, imply a service was delivered, or add links. At most 300 characters. No marketing pressure.',
      })).trim();
      if (proposal && proposal.length <= 300 && !/https?:\/\/|\b(booked|reserved|paid|charged|delivered)\b/i.test(proposal)) return proposal;
    } catch { /* deterministic wording is safe when the model is unavailable */ }
    return fallback;
  }

  private async finish(id: string, worker: string, status: 'sent' | 'cancelled'): Promise<void> {
    await pool.query(`UPDATE notifications SET status=$3,sent_at=CASE WHEN $3='sent' THEN NOW() ELSE sent_at END,
      lease_owner=NULL,lease_expires_at=NULL WHERE notification_id=$1 AND lease_owner=$2`, [id, worker, status]);
  }
}

function incomplete(session: { missingFields: string[]; state?: string }): boolean {
  return Boolean(session.missingFields.length || /awaiting|collect|form_sent|profile_required/i.test(session.state ?? ''));
}

function normalize(userId: string): string { return userId.replace(/^whatsapp:/, ''); }
function label(flow: string | undefined): string {
  return ({ profile: 'travel profile', hotel: 'hotel', restaurant: 'dining', excursion: 'activity',
    logistics: 'transport', itinerary: 'itinerary' } as Record<string, string>)[flow ?? ''] ?? 'travel';
}

let reminder: UnfinishedWorkflowReminderService | null = null;
export function getUnfinishedWorkflowReminderService(): UnfinishedWorkflowReminderService {
  if (!reminder) reminder = new UnfinishedWorkflowReminderService();
  return reminder;
}
