import type { StateStore } from '../StateStore.js';
import type { HandoffSessionControl } from './NearBookingHandoffService.js';

/** Keeps the conversation read-only while a durable concierge case is open. */
export class StateStoreHandoffSessionControl implements HandoffSessionControl {
  constructor(private readonly stateStore: StateStore) {}

  async markHandedOff(sessionId: string, handoffId: string): Promise<void> {
    const state = await this.stateStore.getSessionState(sessionId);
    if (!state) throw new Error('Session unavailable for handoff lock');
    await this.stateStore.setSessionState(sessionId, {
      ...state,
      humanHandoff: { handoffId, status: 'handed_off' },
    });
  }

  async clearHandedOff(sessionId: string, handoffId: string): Promise<void> {
    const state = await this.stateStore.getSessionState(sessionId);
    if (!state || state.humanHandoff?.handoffId !== handoffId) return;
    const { humanHandoff: _closed, ...preserved } = state;
    await this.stateStore.setSessionState(sessionId, preserved);
  }
}
