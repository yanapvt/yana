import crypto from 'node:crypto';
import { getStateStore, type StateStore } from './StateStore.js';
import type { GeneratedItinerary } from './ItineraryPlannerService.js';
import type { ItineraryCriteria } from './itineraryRequestMapper.js';

export interface ItineraryWorkspace {
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
  constructor(private readonly store: StateStore = getStateStore()) {}

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

    await this.save(workspace);
    await this.store.setJson(this.userKey(userId), workspace.shareToken, WORKSPACE_TTL_SECONDS);
    return workspace;
  }

  async createOrUpdateWorkspace(
    userId: string,
    itinerary: GeneratedItinerary,
    criteria: ItineraryCriteria,
    note = 'Itinerary updated'
  ): Promise<ItineraryWorkspace> {
    const existingToken = await this.store.getJson<string>(this.userKey(userId));
    const existing = existingToken ? await this.getWorkspace(existingToken) : null;
    if (!existing) {
      return this.createWorkspace(userId, itinerary, criteria);
    }

    const now = new Date().toISOString();
    const nextVersion = existing.currentVersion + 1;
    const workspace: ItineraryWorkspace = {
      ...existing,
      itinerary,
      criteria,
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

    await this.save(workspace);
    return workspace;
  }

  async getWorkspace(shareToken: string): Promise<ItineraryWorkspace | null> {
    return this.store.getJson<ItineraryWorkspace>(this.workspaceKey(shareToken));
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
