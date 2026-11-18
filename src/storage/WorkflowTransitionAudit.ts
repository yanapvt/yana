import type { PoolClient } from 'pg';
import { validateCriteria } from '../orchestration/WorkflowDefinitions.js';

/** Written in the same transaction as the authoritative workflow snapshot. */
export async function appendWorkflowTransition(
  client: Pick<PoolClient, 'query'>,
  flow: 'hotel' | 'restaurant' | 'excursion' | 'logistics' | 'itinerary',
  session: {
    id: string; userId: string; revision?: number; state: string; schemaVersion?: string;
    lifecycleStatus?: 'active' | 'paused'; criteria: object;
    pendingLocationConfirmation?: string; pendingSourcingConsent?: boolean;
    pendingHumanHandoffConsent?: boolean; selectedHotel?: { selectedHotelId: string };
    currentDay?: number; sourcingRequestId?: string;
    humanHandoff?: { status: 'handed_off' }; recheckReceipt?: object;
  }
): Promise<void> {
  const pending = {
    ...(session.pendingLocationConfirmation ? { locationConfirmation: session.pendingLocationConfirmation.slice(0, 120) } : {}),
    ...(session.pendingSourcingConsent ? { sourcingConsent: true } : {}),
    ...(session.pendingHumanHandoffConsent ? { humanHandoffConsent: true } : {}),
  };
  const outcome = {
    ...(session.selectedHotel ? { selectedHotelId: session.selectedHotel.selectedHotelId } : {}),
    ...(session.currentDay ? { currentDay: session.currentDay } : {}),
    ...(session.sourcingRequestId ? { sourcingRequestSaved: true } : {}),
    ...(session.humanHandoff ? { humanHandoffStatus: session.humanHandoff.status } : {}),
    ...(session.recheckReceipt ? { recheckRecorded: true } : {}),
  };
  await client.query(
    `INSERT INTO journey_workflow_transitions
     (workflow_id,user_key,flow,state_version,schema_version,status,lifecycle_status,
      validated_criteria,pending_decisions,outcome_reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
    [session.id, session.userId, flow, session.revision ?? 0,
      session.schemaVersion ?? 'legacy', session.state, session.lifecycleStatus ?? 'active',
      JSON.stringify(validateCriteria(flow, session.criteria as Record<string, unknown>, false)),
      JSON.stringify(pending), JSON.stringify(outcome)]
  );
}
