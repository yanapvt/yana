import { describe, expect, it, vi } from 'vitest';
import { StateStoreHandoffSessionControl } from './StateStoreHandoffSessionControl.js';

describe('StateStoreHandoffSessionControl', () => {
  it('preserves collected state while locking and closing the matching handoff', async () => {
    let state: any = { missingFields: [], collectedFields: { location: 'Galle' }, currentStep: 'results' };
    const store = {
      getSessionState: vi.fn(async () => state),
      setSessionState: vi.fn(async (_id, next) => { state = next; }),
    };
    const control = new StateStoreHandoffSessionControl(store as any);
    await control.markHandedOff('session-1', 'handoff-1');
    expect(state).toMatchObject({ collectedFields: { location: 'Galle' }, humanHandoff: { handoffId: 'handoff-1' } });
    await control.clearHandedOff('session-1', 'another-handoff');
    expect(state.humanHandoff).toBeDefined();
    await control.clearHandedOff('session-1', 'handoff-1');
    expect(state).toEqual({ missingFields: [], collectedFields: { location: 'Galle' }, currentStep: 'results' });
  });
});
