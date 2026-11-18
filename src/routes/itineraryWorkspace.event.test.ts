import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormTokenService, initFormTokenService } from '../services/formTokenService.js';

const mocks = vi.hoisted(() => ({
  acceptEvent: vi.fn(), getWorkspace: vi.fn(), updateWorkspaceState: vi.fn(),
  createOrUpdateWorkspace: vi.fn(), getAuthoritative: vi.fn(), apply: vi.fn(),
  interpret: vi.fn(), lock: vi.fn(),
}));
vi.mock('../orchestration/ConversationControlPlane.js', () => ({
  getConversationControlPlane: () => ({ acceptEvent: mocks.acceptEvent, interpret: mocks.interpret }),
}));
vi.mock('../services/WorkflowLockService.js', () => ({
  withWorkflowLock: (userId: string, operation: () => Promise<unknown>) => mocks.lock(userId, operation),
}));
vi.mock('../services/ItineraryWorkspaceService.js', () => ({
  getItineraryWorkspaceService: () => ({ getWorkspace: mocks.getWorkspace,
    updateWorkspaceState: mocks.updateWorkspaceState, createOrUpdateWorkspace: mocks.createOrUpdateWorkspace }),
}));
vi.mock('../services/itinerarySessionService.js', () => ({
  getItinerarySessionService: () => ({ getAuthoritative: mocks.getAuthoritative }),
}));
vi.mock('../services/ItineraryEditService.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/ItineraryEditService.js')>();
  return { ...original, ItineraryEditService: class { apply = mocks.apply; } };
});

import router from './itineraryWorkspace.js';

const userId = 'whatsapp:+94770000001';
const itinerary = { days: [{ day: 1, morning: 'Walk', afternoon: 'Lunch', evening: 'Dinner' },
  { day: 2, morning: 'Beach', afternoon: 'Museum', evening: 'Market' }] };
const workspace = { shareToken: 'share-token-1', userId, tripId: 'trip-1', currentVersion: 4,
  selectedDay: 1, itinerary, criteria: { location: 'Galle' }, pendingChanges: [] };

describe('itinerary website event adapter', () => {
  let server: Server;
  let origin: string;
  let tokens: FormTokenService;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => {
    vi.clearAllMocks();
    tokens = initFormTokenService(new FormTokenService());
    mocks.getWorkspace.mockResolvedValue(workspace);
    mocks.updateWorkspaceState.mockImplementation(async (_token: string, update: object) => ({ ...workspace, ...update }));
    mocks.createOrUpdateWorkspace.mockResolvedValue({ ...workspace, currentVersion: 5 });
    mocks.getAuthoritative.mockResolvedValue({ id: 'trip-1', revision: 4, itinerary });
    mocks.apply.mockResolvedValue({ itinerary, criteria: workspace.criteria });
    mocks.acceptEvent.mockImplementation(async (event) => event);
    mocks.lock.mockImplementation(async (_userId, operation) => operation());
    mocks.interpret.mockResolvedValue({ interpretation: { responseText: 'Which day and part of the plan should I change?' } });
  });

  it('sends a selected day through the control plane before changing display state', async () => {
    const token = tokens.createToken(userId, 'itinerary');
    tokens.bindRevision(token, 'itinerary', workspace.currentVersion, workspace.tripId);
    const csrf = tokens.createCsrfToken(token, 'itinerary');
    const response = await fetch(`${origin}/itinerary/share-token-1/state`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedDay: 2, expectedRevision: 4, _formToken: token, _csrf: csrf,
        userId: 'whatsapp:+19999999999', sessionId: 'client-session', workflowId: 'client-workflow' }) });
    expect(response.status).toBe(200);
    expect(mocks.acceptEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'website_ui', eventType: 'ui_selection', userId, workflowId: 'trip-1',
      expectedStateVersion: 4, correlationId: response.headers.get('x-correlation-id'),
      payload: { action: 'select_day', selectedDay: 2 },
    }));
    expect(mocks.updateWorkspaceState).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledWith(userId, expect.any(Function));
    expect(mocks.interpret).not.toHaveBeenCalled();
  });

  it('sends a validated edit action through the same boundary before applying it', async () => {
    const token = tokens.createToken(userId, 'itinerary');
    tokens.bindRevision(token, 'itinerary', workspace.currentVersion, workspace.tripId);
    const csrf = tokens.createCsrfToken(token, 'itinerary');
    const command = { version: '1.0', tripId: 'trip-1', expectedRevision: 4,
      day: 2, operation: 'replace', target: 'afternoon', value: 'Visit a fort' };
    const response = await fetch(`${origin}/itinerary/share-token-1/edit`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, selectedDay: 2, expectedRevision: 4, _formToken: token, _csrf: csrf }) });
    expect(response.status).toBe(200);
    expect(mocks.acceptEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'website_ui', eventType: 'ui_action', payload: { action: 'edit_itinerary', command },
    }));
    expect(mocks.apply).toHaveBeenCalledWith(userId, command);
    expect(mocks.lock).toHaveBeenCalledWith(userId, expect.any(Function));
    expect(mocks.interpret).not.toHaveBeenCalled();
  });

  it('uses the primary reasoning path to clarify an ambiguous website edit without changing state', async () => {
    const token = tokens.createToken(userId, 'itinerary');
    tokens.bindRevision(token, 'itinerary', workspace.currentVersion, workspace.tripId);
    const csrf = tokens.createCsrfToken(token, 'itinerary');
    const response = await fetch(`${origin}/itinerary/share-token-1/edit`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingChange: 'Make tomorrow more relaxed', selectedDay: 2,
        expectedRevision: 4, _formToken: token, _csrf: csrf }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Which day and part of the plan should I change?' });
    expect(mocks.acceptEvent).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'website_ui', eventType: 'ui_action', workflowId: 'trip-1', expectedStateVersion: 4,
      payload: { action: 'edit_itinerary', pendingChange: 'Make tomorrow more relaxed' },
    }));
    expect(mocks.interpret).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ workflowId: 'trip-1', channel: 'website_ui' }),
      text: 'Make tomorrow more relaxed', inboundMessage: expect.objectContaining({ from: userId }),
    }));
    expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('rejects an action token bound to another workflow or revision', async () => {
    const token = tokens.createToken(userId, 'itinerary');
    tokens.bindRevision(token, 'itinerary', 3, 'other-trip');
    const csrf = tokens.createCsrfToken(token, 'itinerary');
    const response = await fetch(`${origin}/itinerary/share-token-1/state`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedDay: 2, expectedRevision: 4, _formToken: token, _csrf: csrf }) });
    expect(response.status).toBe(403);
    expect(mocks.acceptEvent).not.toHaveBeenCalled();
    expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
  });

});
