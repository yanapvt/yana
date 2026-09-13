import { Router, type Request, type Response } from 'express';
import { getHumanHandoffRuntime, isUuid, type HumanHandoffRuntime } from '../services/handoff/HumanHandoffRuntime.js';
import type { OperatorIdentity, OperatorRole } from '../services/handoff/OperatorIdentityService.js';
import { logSafeOperatorFailure } from '../services/SafeFailureService.js';

export function createHumanHandoffAdminRouter(getRuntime: () => HumanHandoffRuntime = getHumanHandoffRuntime): Router {
  const router = Router();
  router.use('/admin/handoffs', (req, res, next) => authenticate(req, res, next, getRuntime()));

  router.get('/admin/handoffs', async (req, res) => {
    if (!authorize(res, getRuntime(), 'viewer')) return;
    const operations = getRuntime().operations;
    if (!operations) return res.status(503).json({ error: 'Handoff operations are unavailable.' });
    try {
      const limit = Number.parseInt(readString(req.query.limit) ?? '25', 10);
      return res.status(200).json(await operations.list(Number.isFinite(limit) ? limit : 25, readString(req.query.cursor)));
    } catch (error) {
      logSafeOperatorFailure(console, 'handoff_list_failed', correlationId(req), error);
      return res.status(503).json({ error: 'Handoff cases are temporarily unavailable.' });
    }
  });

  router.get('/admin/handoffs/metrics', async (req, res) => {
    if (!authorize(res, getRuntime(), 'viewer')) return;
    try { return res.status(200).json(await getRuntime().operations!.metrics()); }
    catch (error) { logSafeOperatorFailure(console, 'handoff_metrics_failed', correlationId(req), error); return res.status(503).json({ error: 'Metrics unavailable.' }); }
  });

  router.get('/admin/handoffs/readiness', async (req, res) => {
    if (!authorize(res, getRuntime(), 'viewer')) return;
    const result = await getRuntime().operations!.readiness();
    return res.status(result.ready ? 200 : 503).json(result);
  });

  router.get('/admin/handoffs/dead-letters', async (req, res) => {
    if (!authorize(res, getRuntime(), 'admin')) return;
    const service = getRuntime().deadLetters;
    if (!service) return res.status(503).json({ error: 'Dead-letter operations are unavailable.' });
    try { return res.status(200).json({ items: await service.list(Number.parseInt(readString(req.query.limit) ?? '25', 10), identity(res)!.id) }); }
    catch (error) { logSafeOperatorFailure(console, 'handoff_dead_letter_list_failed', correlationId(req), error); return res.status(503).json({ error: 'Dead letters unavailable.' }); }
  });

  router.post('/admin/handoffs/dead-letters/:notificationId/replay', async (req, res) => {
    if (!authorize(res, getRuntime(), 'admin')) return;
    const actor = identity(res)!;
    if (!isUuid(req.params.notificationId)) return res.status(400).json({ error: 'Valid notification ID required.' });
    try { const replayed = await getRuntime().deadLetters?.replay(req.params.notificationId, actor.id); return res.status(replayed ? 202 : 409).json({ replayed: replayed === true }); }
    catch (error) { logSafeOperatorFailure(console, 'handoff_dead_letter_replay_failed', correlationId(req), error); return res.status(503).json({ error: 'Replay unavailable.' }); }
  });

  router.get('/admin/handoffs/:handoffId', async (req, res) => {
    if (!authorize(res, getRuntime(), 'viewer')) return;
    if (!isUuid(req.params.handoffId)) return res.status(400).json({ error: 'Valid handoff ID required.' });
    try {
      const item = await getRuntime().operations!.detail(req.params.handoffId);
      return item ? res.status(200).json(item) : res.status(404).json({ error: 'Not found' });
    } catch (error) { logSafeOperatorFailure(console, 'handoff_detail_failed', correlationId(req), error); return res.status(503).json({ error: 'Handoff unavailable.' }); }
  });

  router.post('/admin/handoffs/:handoffId/assign', async (req, res) => {
    if (!authorize(res, getRuntime(), 'operator')) return;
    const { handoffId } = req.params;
    const actorId = readString(req.body?.actorId);
    const operatorId = readString(req.body?.operatorId);
    if (!isUuid(handoffId) || !actorId || !operatorId || !isUuid(actorId) || !isUuid(operatorId) || actorId !== identity(res)!.id) {
      return res.status(400).json({ error: 'Valid UUID handoff, actor, and operator IDs are required.' });
    }
    try {
      const result = await getRuntime().service.assign(handoffId, actorId, operatorId);
      return result.status === 'forbidden'
        ? res.status(403).json({ error: 'Forbidden' })
        : res.status(200).json(publicCase(result.case));
    } catch (error) {
      logSafeOperatorFailure(console, 'handoff_assignment_failed', correlationId(req), error);
      return res.status(409).json({ error: 'Handoff is unavailable for assignment.' });
    }
  });

  router.post('/admin/handoffs/:handoffId/close', async (req, res) => {
    if (!authorize(res, getRuntime(), 'operator')) return;
    const { handoffId } = req.params;
    const actorId = readString(req.body?.actorId);
    const status = req.body?.status;
    if (!isUuid(handoffId) || !actorId || !isUuid(actorId) || actorId !== identity(res)!.id || !['resolved', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Valid IDs and a resolved or cancelled status are required.' });
    }
    try {
      const result = await getRuntime().service.close(handoffId, status, actorId);
      return result.status === 'forbidden'
        ? res.status(403).json({ error: 'Forbidden' })
        : res.status(200).json(publicCase(result.case));
    } catch (error) {
      logSafeOperatorFailure(console, 'handoff_closure_failed', correlationId(req), error);
      return res.status(409).json({ error: 'Handoff could not be closed.' });
    }
  });

  router.post('/admin/handoffs/sla/run', async (req, res) => {
    if (!authorize(res, getRuntime(), 'operator')) return;
    try {
      return res.status(200).json({ escalated: await getRuntime().runSlaCycle() });
    } catch (error) {
      logSafeOperatorFailure(console, 'handoff_sla_cycle_failed', correlationId(req), error);
      return res.status(503).json({ error: 'SLA processing is temporarily unavailable.' });
    }
  });

  router.post('/admin/handoffs/staging-drill', (req, res) => {
    if (!authorize(res, getRuntime(), 'admin')) return;
    const result = getRuntime().operations!.stagingDrill();
    return res.status(result.status === 'passed' ? 200 : 404).json(result);
  });
  return router;
}

function authenticate(req: Request, res: Response, next: () => void, runtime: HumanHandoffRuntime): void {
  if (!runtime.config.enabled) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const supplied = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const authenticated = runtime.operatorAuth.authenticate(supplied);
  if (!authenticated) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.locals.operatorIdentity = authenticated;
  next();
}

function identity(res: Response): OperatorIdentity | undefined { return res.locals.operatorIdentity as OperatorIdentity | undefined; }
function authorize(res: Response, runtime: HumanHandoffRuntime, role: OperatorRole): boolean {
  const actor = identity(res);
  if (!actor || !runtime.operatorAuth.permits(actor, role)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function correlationId(req: Request): string {
  return readString(req.header('x-correlation-id')) ?? 'operator-request';
}

function publicCase(value: { handoffId: string; sessionId: string; status: string; channel: string; operatorId?: string; createdAt: Date; slaDueAt: Date }) {
  return {
    handoffId: value.handoffId,
    sessionId: value.sessionId,
    status: value.status,
    channel: value.channel,
    operatorId: value.operatorId,
    createdAt: value.createdAt,
    slaDueAt: value.slaDueAt,
  };
}

export default createHumanHandoffAdminRouter();
