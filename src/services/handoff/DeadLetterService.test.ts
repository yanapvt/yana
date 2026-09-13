import { describe, expect, it } from 'vitest';
import { DeadLetterService, type DeadLetterStore } from './DeadLetterService.js';
class Store implements DeadLetterStore {
  state = 'dead_letter';
  async list() { return [{ notificationId:'n',handoffId:'h',type:'x',attemptCount:5,errorCode:'SAFE',deadLetteredAt:new Date(0),replayCount:0 }]; }
  async replay() { if (this.state !== 'dead_letter') return false; this.state = 'scheduled'; return true; }
}
describe('DeadLetterService', () => {
  it('returns minimal inspection and prevents duplicate replay', async () => { const store=new Store(); const service=new DeadLetterService(store);
    expect(JSON.stringify(await service.list(1000,'actor'))).not.toMatch(/content|metadata|token/i);
    expect(await service.replay('n','actor')).toBe(true); expect(await service.replay('n','actor')).toBe(false);
  });
});
