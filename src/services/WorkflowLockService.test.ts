import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withWorkflowLock } from './WorkflowLockService.js';
const fixture = vi.hoisted(() => ({ held: false, releases: 0, fail: false, sql: [] as string[] }));
vi.mock('../db/connection.js', () => ({ pool: { connect: async () => ({
  query: async (sql: string) => {
    fixture.sql.push(sql);
    if (fixture.fail) throw new Error('private database error');
    if (sql.includes('pg_try_advisory_lock')) {
      const acquired = !fixture.held;
      if (acquired) fixture.held = true;
      return { rows: [{ acquired }] };
    }
    fixture.held = false;
    return { rows: [] };
  },
  release: () => { fixture.releases++; },
}) } }));
beforeEach(() => { fixture.held = false; fixture.releases = 0; fixture.fail = false; fixture.sql.length = 0; });
describe('workflow mutation lock', () => {
  it('rejects a simultaneous mutation and releases the lock after the winning operation', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const first = withWorkflowLock('fixture', () => pending);
    await vi.waitFor(() => expect(fixture.held).toBe(true));
    const mutation = vi.fn();
    await expect(withWorkflowLock('fixture', mutation)).rejects.toMatchObject({ status: 'conflict' });
    expect(mutation).not.toHaveBeenCalled();
    finish(); await first;
    expect(fixture.held).toBe(false);
    expect(fixture.releases).toBe(2);
    expect(fixture.sql.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
  });
  it('releases the shared lock when the operation fails and fails closed if locking is unavailable', async () => {
    await expect(withWorkflowLock('fixture', async () => { throw new Error('operation failure'); })).rejects.toThrow('operation failure');
    expect(fixture.held).toBe(false);
    fixture.fail = true;
    await expect(withWorkflowLock('fixture', async () => true)).rejects.toMatchObject({ status: 'failed' });
  });
});
