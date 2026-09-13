import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { getHumanHandoffRuntime, hashOperatorToken, isUuid, type HumanHandoffRuntime } from '../services/handoff/HumanHandoffRuntime.js';
import { logSafeOperatorFailure } from '../services/SafeFailureService.js';

export function createHumanHandoffAdminRouter(getRuntime: () => HumanHandoffRuntime = getHumanHandoffRuntime): Router {
  const router = Router();
  router.use('/admin/handoffs', (req, res, next) => authenticate(req, res, next, getRuntime()));

  router.post('/admin/handoffs/:handoffId/assign', async (req, res) => {
    const { handoffId } = req.params;
    const actorId = readString(req.body?.actorId);
    const operatorId = readString(req.body?.operatorId);
    if (!isUuid(handoffId) || !actorId || !operatorId || !isUuid(actorId) || !isUuid(operatorId)) {
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
    const { handoffId } = req.params;
    const actorId = readString(req.body?.actorId);
    const status = req.body?.status;
    if (!isUuid(handoffId) || !actorId || !isUuid(actorId) || !['resolved', 'cancelled'].includes(status)) {
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
    try {
      return res.status(200).json({ escalated: await getRuntime().runSlaCycle() });
    } catch (error) {
      logSafeOperatorFailure(console, 'handoff_sla_cycle_failed', correlationId(req), error);
      return res.status(503).json({ error: 'SLA processing is temporarily unavailable.' });
    }
  });
  return router;
}

function authenticate(req: Request, res: Response, next: () => void, runtime: HumanHandoffRuntime): void {
  if (!runtime.config.enabled || !runtime.config.operatorToken) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const supplied = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expectedHash = Buffer.from(hashOperatorToken(runtime.config.operatorToken), 'hex');
  const suppliedHash = Buffer.from(hashOperatorToken(supplied), 'hex');
  if (!timingSafeEqual(expectedHash, suppliedHash)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
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
