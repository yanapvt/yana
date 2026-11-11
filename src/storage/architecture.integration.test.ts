import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db/connection.js';
import { PostgresItinerarySessionRepository } from './itinerarySessionRepository.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { withWorkflowLock } from '../services/WorkflowLockService.js';
import { PostgresJourneyEventCheckpointRepository } from './JourneyEventCheckpointRepository.js';
import { createInboundConversationEvent, createWebsiteConversationEvent } from '../orchestration/CanonicalConversationEvent.js';
import { normalizeInboundMessage } from '../utils/messageNormalizer.js';
import { normalizeOpenWaInboundMessage } from '../utils/openWaMessageNormalizer.js';
import { normalizeMetaWhatsAppInboundMessage } from '../utils/metaWhatsAppMessageNormalizer.js';
import { HotelSearchSessionService } from '../services/hotelSearchSessionService.js';
import { PostgresHotelSearchSessionRepository } from './hotelSearchSessionRepository.js';
import { StateStore } from '../services/StateStore.js';
import { ActiveConversationStateLoader } from '../orchestration/ActiveConversationStateLoader.js';
import { ConversationControlPlane } from '../orchestration/ConversationControlPlane.js';
import { JourneyEventCheckpointService } from '../services/JourneyEventCheckpointService.js';
import { FormTokenService } from '../services/formTokenService.js';
import type { ItinerarySession } from '../services/itinerarySessionService.js';

const phone = '+94770000991';
const traveller = `whatsapp:${phone}`;
const repository = new PostgresItinerarySessionRepository();

beforeEach(async () => {
  await pool.query('DELETE FROM journey_inbound_events WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM journey_event_checkpoints WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM journey_workflow_transitions WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM users WHERE phone_number=$1', [phone]);
  await pool.query('INSERT INTO users(phone_number,phone_hash) VALUES($1,$2)', [phone, 'architecture-integration-fixture']);
});
afterAll(async () => {
  await pool.query('DELETE FROM journey_inbound_events WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM journey_event_checkpoints WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM journey_workflow_transitions WHERE user_key=$1', [traveller]);
  await pool.query('DELETE FROM users WHERE phone_number=$1', [phone]);
  await pool.end();
});

function session(): ItinerarySession {
  return {
    id: 'architecture-trip', userId: traveller, whatsappUserId: traveller,
    criteria: {}, state: 'editing_itinerary', revision: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    workspaceAccess: { tokenHash: 'architecture-test-hash', createdAt: new Date().toISOString() },
  };
}

describe('architecture persistence against PostgreSQL', () => {
  it('keeps one durable journey across WhatsApp, bound website UI, voice and WhatsApp', async () => {
    const cache = new StateStore();
    try {
      const sessions = new HotelSearchSessionService(cache, new PostgresHotelSearchSessionRepository());
      await sessions.saveAwaitingPreferences(traveller, { location: 'Hikkaduwa', guests: 2 });
      const loader = new ActiveConversationStateLoader({
        loadHotel: async (id) => {
          const session = await sessions.getAuthoritative(id);
          return session && { id: session.id, revision: session.revision,
            lifecycleStatus: session.lifecycleStatus, flow: 'hotel', state: session.state,
            stage: session.stage, schema: 'search_hotels', fields: session.criteria,
            requiredFields: ['location'], updatedAt: session.updatedAt };
        },
        loadRestaurant: async () => null, loadExcursion: async () => null,
        loadLogistics: async () => null, loadItinerary: async () => null,
      });
      const control = new ConversationControlPlane({ stateLoader: loader,
        checkpoints: new JourneyEventCheckpointService(new PostgresJourneyEventCheckpointRepository(), cache) });
      const start = await control.acceptEvent(createInboundConversationEvent(normalizeInboundMessage({
        MessageSid: 'SM-cross-start', From: traveller, To: 'whatsapp:+15550000000', Body: 'Hotels in Hikkaduwa',
      }), 'corr-cross-start'));
      const tokens = new FormTokenService();
      const token = tokens.createToken(traveller, 'hotel');
      tokens.bindRevision(token, 'hotel', start.stateVersion!, start.workflowId!);
      const bound = tokens.resolveToken(token, 'hotel')!;
      const ui = await control.acceptEvent(createWebsiteConversationEvent({
        sourceEventId: bound.requestId!, correlationId: 'corr-cross-ui', userId: bound.userId,
        channel: 'website_ui', eventType: 'ui_action', workflowId: bound.workflowId,
        expectedStateVersion: bound.workflowRevision,
        payload: { action: 'update_draft', fields: { checkinDate: '2026-12-01' } },
      }));
      await sessions.applyCriteriaPatch(traveller, ui.expectedStateVersion!, { checkinDate: '2026-12-01' });
      const voice = await control.acceptEvent(createInboundConversationEvent(normalizeOpenWaInboundMessage({
        data: { id: 'OW-cross-voice', from: '94770000991@c.us', type: 'ptt',
          mimetype: 'audio/ogg', mediaUrl: 'https://example.test/voice.ogg' },
      }), 'corr-cross-voice'));
      await sessions.applyCriteriaPatch(traveller, voice.expectedStateVersion!, { checkinDate: '2026-12-02' });
      const followup = await control.acceptEvent(createInboundConversationEvent(normalizeMetaWhatsAppInboundMessage({
        entry: [{ changes: [{ value: { messages: [{ id: 'wamid.cross-return', from: '94770000991',
          type: 'text', text: { body: 'Continue the hotel search' } }] } }] }],
      }), 'corr-cross-return'));
      const interactions = [start, ui, voice, followup];
      expect(new Set(interactions.map((event) => event.eventId)).size).toBe(4);
      for (const event of interactions) expect(event).toMatchObject({
        userId: traveller, conversationId: start.conversationId, sessionId: start.sessionId,
        workflowId: start.workflowId,
      });
      expect((await new HotelSearchSessionService(cache, new PostgresHotelSearchSessionRepository())
        .getAuthoritative(traveller))?.criteria).toMatchObject({
          location: 'Hikkaduwa', guests: 2, checkinDate: '2026-12-02',
        });
    } finally { await cache.disconnect(); }
  });

  it('restores a paused workflow, validated fields and pending consent after Redis loss and restart', async () => {
    const liveCache = new StateStore();
    const restartedCache = new StateStore();
    try {
      const original = new HotelSearchSessionService(liveCache, new PostgresHotelSearchSessionRepository());
      const criteria = { location: 'Hikkaduwa', checkinDate: '2026-12-01',
        checkoutDate: '2026-12-03', guests: 2 };
      await original.saveResults(traveller, criteria, [{ id: 'hotel-recovery-1', name: 'Beach Stay' }], 1);
      await original.selectHotel(traveller, 1);
      await original.markSourcingConsentPending(traveller);
      await original.pause(traveller);
      const before = (await original.getAuthoritative(traveller))!;
      await liveCache.deleteKey(`hotel-search:${traveller}`);
      const restarted = new HotelSearchSessionService(restartedCache, new PostgresHotelSearchSessionRepository());
      expect(await restarted.get(traveller)).toMatchObject({
        id: before.id, revision: before.revision, lifecycleStatus: 'paused',
        pendingSourcingConsent: true, criteria,
        selectedHotel: { selectedHotelId: 'hotel-recovery-1' },
      });
      expect(await restartedCache.getJson(`hotel-search:${traveller}`)).toMatchObject({
        id: before.id, revision: before.revision,
      });
    } finally {
      await liveCache.disconnect();
      await restartedCache.disconnect();
    }
  });

  it('deduplicates accepted interactions and orders the durable checkpoint by event sequence', async () => {
    const events = new PostgresJourneyEventCheckpointRepository();
    const makeEvent = (sourceEventId: string, body: string) => {
      const event = createInboundConversationEvent(normalizeInboundMessage({
        MessageSid: sourceEventId, From: traveller, To: 'whatsapp:+15550000000', Body: body,
      }), `corr-${sourceEventId}`);
      return { ...event, sessionId: event.conversationId.replace('conversation:', 'session:') };
    };
    const first = makeEvent('SM-architecture-1', 'Start in Galle');
    const retry = makeEvent('SM-architecture-1', 'Start in Galle');
    const second = makeEvent('SM-architecture-2', 'Change to Hikkaduwa');
    expect(await events.saveAccepted(first, first.payload, first.metadata)).toBe(true);
    expect(await events.saveAccepted(retry, retry.payload, retry.metadata)).toBe(false);
    expect(await events.saveAccepted(second, second.payload, second.metadata)).toBe(true);
    const audit = await pool.query<{ event_id: string; event_sequence: string; payload: object }>(
      'SELECT event_id,event_sequence,payload FROM journey_inbound_events WHERE user_key=$1 ORDER BY event_sequence',
      [traveller]);
    expect(audit.rows.map((row) => row.event_id)).toEqual([first.eventId, second.eventId]);
    expect(audit.rows[1].payload).toMatchObject({ content: { body: 'Change to Hikkaduwa' } });
    expect((await events.findByUserId(traveller))?.eventId).toBe(second.eventId);
  });

  it('allows one concurrent revision update and rejects the stale writer', async () => {
    await repository.upsert(session(), 0);
    const saved = (await repository.findLatestActiveByUserId(traveller))!;
    expect(saved.revision).toBe(1);
    const outcomes = await Promise.allSettled([
      repository.upsert({ ...saved, additionalPreferences: 'first' }, 1),
      repository.upsert({ ...saved, additionalPreferences: 'second' }, 1),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 'conflict' } });
    expect((await repository.findLatestActiveByUserId(traveller))?.revision).toBe(2);
    const transitions = await pool.query<{ state_version: number; validated_criteria: object }>(
      'SELECT state_version,validated_criteria FROM journey_workflow_transitions WHERE workflow_id=$1 ORDER BY state_version',
      ['architecture-trip']);
    expect(transitions.rows.map((row) => row.state_version)).toEqual([1, 2]);
  });

  it('recovers workspace access from JSON storage and excludes cleared sessions', async () => {
    await repository.upsert(session(), 0);
    expect((await new PostgresItinerarySessionRepository().findByWorkspaceTokenHash('architecture-test-hash'))?.id).toBe('architecture-trip');
    await repository.clearActiveByUserId(traveller);
    expect(await repository.findByWorkspaceTokenHash('architecture-test-hash')).toBeNull();
    await expect(repository.upsert(session(), 0)).rejects.toMatchObject({ status: 'conflict' });
  });

  it('rolls back the workflow snapshot if its transition audit cannot commit', async () => {
    await repository.upsert(session(), 0);
    const saved = (await repository.findLatestActiveByUserId(traveller))!;
    await pool.query(`INSERT INTO journey_workflow_transitions
      (workflow_id,user_key,flow,state_version,schema_version,status,lifecycle_status,
       validated_criteria,pending_decisions,outcome_reference)
      VALUES ($1,$2,'itinerary',2,'1.0','fixture','active','{}','{}','{}')`,
      [saved.id, traveller]);
    await expect(repository.upsert({ ...saved, additionalPreferences: 'new' }, 1)).rejects.toThrow();
    const recovered = await repository.findLatestActiveByUserId(traveller);
    expect(recovered?.revision).toBe(1);
    expect(recovered?.additionalPreferences).toBeUndefined();
  });

  it('persists both conversation roles exactly once under concurrent retries', async () => {
    const messages = new MessageRepository();
    const input = { traveller, peer: '+15550000000', requestId: 'architecture-message' };
    await Promise.all(Array.from({ length: 3 }, () => messages.appendConversationTurn({ ...input, role: 'user', text: 'Vegetarian food please.' })));
    await messages.appendConversationTurn({ ...input, role: 'assistant', text: 'Which city?' });
    const history = await new MessageRepository().findRecentByTraveller(traveller);
    expect(history).toHaveLength(2);
    expect(history.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(history[1].content).toContain('delivery not verified');
  });

  it('excludes a second connection while locked and releases after an operation fails', async () => {
    await withWorkflowLock(traveller, async () => {
      await expect(withWorkflowLock(traveller, async () => 'unexpected')).rejects.toMatchObject({ status: 'conflict' });
    });
    await expect(withWorkflowLock(traveller, async () => { throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
    await expect(withWorkflowLock(traveller, async () => 'released')).resolves.toBe('released');
  });
});
