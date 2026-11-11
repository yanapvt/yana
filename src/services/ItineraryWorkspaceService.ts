import crypto from 'node:crypto';
import { getStateStore, type StateStore } from './StateStore.js';
import type { GeneratedItinerary } from './ItineraryPlannerService.js';
import type { ItineraryCriteria } from './itineraryRequestMapper.js';
import { getItineraryPlannerService } from './ItineraryPlannerService.js';
import { getItinerarySessionService, type ItinerarySessionService } from './itinerarySessionService.js';

export interface ItineraryWorkspace {
  tripId?: string;
  shareToken: string;
  userId: string;
  itinerary: GeneratedItinerary;
  criteria: ItineraryCriteria;
  selectedDay: number;
  expandedDays: number[];
  pendingChanges: string[];
  currentVersion: number;
  versions: ItineraryWorkspaceVersion[];
  lastSave: string;
  createdAt: string;
  updatedAt: string;
}

export interface ItineraryWorkspaceVersion {
  version: number;
  itinerary: GeneratedItinerary;
  savedAt: string;
  note: string;
}

const WORKSPACE_TTL_SECONDS = 60 * 60 * 24 * 30;

export class ItineraryWorkspaceService {
  constructor(private readonly store: StateStore = getStateStore(), private readonly sessions: ItinerarySessionService = getItinerarySessionService()) {}

  async generateFromSubmittedForm(
    userId: string,
    criteria: ItineraryCriteria,
    formResponseId: string
  ): Promise<{ itinerary: GeneratedItinerary; workspace: ItineraryWorkspace }> {
    await this.sessions.saveAwaitingPreferences(userId, criteria, { itineraryFormResponseId: formResponseId });
    await this.sessions.savePlanning(userId, criteria);
    const itinerary = await getItineraryPlannerService().plan(criteria);
    await this.sessions.saveItinerary(userId, criteria, itinerary);
    const workspace = await this.createOrUpdateWorkspace(userId, itinerary, criteria,
      'Generated after trip form submission');
    return { itinerary, workspace };
  }

  /** A bounded, token-free view of the current UI selection for conversation context. */
  async getCurrentSelection(userId: string): Promise<{
    workflowId?: string; selectedDay: number; revision: number;
  } | null> {
    const token = await this.store.getJson<string>(this.userKey(userId)).catch(() => null);
    if (!token) return null;
    const workspace = await this.getWorkspace(token);
    if (!workspace || workspace.userId !== userId) return null;
    return { workflowId: workspace.tripId, selectedDay: workspace.selectedDay,
      revision: workspace.currentVersion };
  }

  async createWorkspace(
    userId: string,
    itinerary: GeneratedItinerary,
    criteria: ItineraryCriteria
  ): Promise<ItineraryWorkspace> {
    const now = new Date().toISOString();
    const workspace: ItineraryWorkspace = {
      shareToken: crypto.randomBytes(24).toString('base64url'),
      userId,
      itinerary,
      criteria,
      selectedDay: 1,
      expandedDays: [1],
      pendingChanges: [],
      currentVersion: 1,
      versions: [
        {
          version: 1,
          itinerary,
          savedAt: now,
          note: 'Initial itinerary',
        },
      ],
      lastSave: now,
      createdAt: now,
      updatedAt: now,
    };

    const session = await this.sessions.attachWorkspace(userId, workspace.shareToken);
    workspace.currentVersion = session.revision ?? 0;
    workspace.tripId = session.id;
    workspace.itinerary = session.itinerary!;
    workspace.versions[0].version = workspace.currentVersion;
    await this.save(workspace).catch(() => undefined);
    await this.store.setJson(this.userKey(userId), workspace.shareToken, WORKSPACE_TTL_SECONDS).catch(() => undefined);
    return workspace;
  }

  async createOrUpdateWorkspace(
    userId: string,
    itinerary: GeneratedItinerary,
    criteria: ItineraryCriteria,
    note = 'Itinerary updated'
  ): Promise<ItineraryWorkspace> {
    const existingToken = await this.store.getJson<string>(this.userKey(userId)).catch(() => null);
    const existing = existingToken ? await this.getWorkspace(existingToken) : null;
    if (!existing) {
      return this.createWorkspace(userId, itinerary, criteria);
    }

    const now = new Date().toISOString();
    const session = await this.sessions.attachWorkspace(userId, existing.shareToken);
    const nextVersion = session.revision ?? 0;
    const workspace: ItineraryWorkspace = {
      ...existing,
      itinerary: session.itinerary!,
      criteria: session.criteria,
      tripId: session.id,
      selectedDay: Math.min(existing.selectedDay, itinerary.days.length || 1),
      pendingChanges: [],
      currentVersion: nextVersion,
      versions: [
        ...existing.versions,
        {
          version: nextVersion,
          itinerary,
          savedAt: now,
          note,
        },
      ].slice(-10),
      lastSave: now,
      updatedAt: now,
    };

    await this.save(workspace).catch(() => undefined);
    return workspace;
  }

  async getWorkspace(shareToken: string): Promise<ItineraryWorkspace | null> {
    const session = await this.sessions.getByWorkspaceToken(shareToken);
    if (!session?.itinerary) return null;
    const cached = await this.store.getJson<ItineraryWorkspace>(this.workspaceKey(shareToken)).catch(() => null);
    const now = new Date().toISOString();
    const workspace: ItineraryWorkspace = {
      shareToken, userId: session.whatsappUserId, tripId: session.id, itinerary: session.itinerary,
      criteria: session.criteria, selectedDay: Math.min(cached?.selectedDay ?? 1, session.itinerary.days.length || 1),
      expandedDays: cached?.expandedDays ?? [1], pendingChanges: [], currentVersion: session.revision ?? 0,
      versions: cached?.versions ?? [], lastSave: session.updatedAt, createdAt: session.createdAt, updatedAt: now,
    };
    await this.save(workspace).catch(() => undefined);
    await this.store.setJson(this.userKey(workspace.userId), shareToken, WORKSPACE_TTL_SECONDS).catch(() => undefined);
    return workspace;
  }

  async clearUserWorkspace(userId: string): Promise<void> {
    await this.store.deleteKey(this.userKey(userId));
  }

  async updateWorkspaceState(
    shareToken: string,
    updates: Partial<Pick<ItineraryWorkspace, 'selectedDay' | 'expandedDays' | 'pendingChanges'>>
  ): Promise<ItineraryWorkspace | null> {
    const workspace = await this.getWorkspace(shareToken);
    if (!workspace) return null;

    const updated: ItineraryWorkspace = {
      ...workspace,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  private async save(workspace: ItineraryWorkspace): Promise<void> {
    await this.store.setJson(
      this.workspaceKey(workspace.shareToken),
      workspace,
      WORKSPACE_TTL_SECONDS
    );
  }

  private workspaceKey(shareToken: string): string {
    return `itinerary-workspace:${shareToken}`;
  }

  private userKey(userId: string): string {
    return `itinerary-workspace-user:${userId.replace(/[^a-zA-Z0-9:+-]/g, '_')}`;
  }
}

let itineraryWorkspaceServiceInstance: ItineraryWorkspaceService | null = null;

export function getItineraryWorkspaceService(): ItineraryWorkspaceService {
  if (!itineraryWorkspaceServiceInstance) {
    itineraryWorkspaceServiceInstance = new ItineraryWorkspaceService();
  }
  return itineraryWorkspaceServiceInstance;
}

export function initItineraryWorkspaceService(
  service = new ItineraryWorkspaceService()
): ItineraryWorkspaceService {
  itineraryWorkspaceServiceInstance = service;
  return service;
}
