import crypto from 'node:crypto';
import { assertExpectedRevision } from '../../storage/Persistence.js';

export class FixtureStateStore {
  private readonly values = new Map<string, unknown>();
  async getJson<T>(key: string): Promise<T | null> { return structuredClone(this.values.get(key) as T ?? null); }
  async setJson(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async deleteKey(key: string): Promise<boolean> { return this.values.delete(key); }
  async deleteSessionState(): Promise<boolean> { return false; }
  clear(): void { this.values.clear(); }
}
export class FixtureSessionRepository<T extends { whatsappUserId: string; id: string; state: string; revision?: number; workspaceAccess?: { tokenHash: string }; stage?: string }> {
  readonly records = new Map<string, T>();
  fail = false;
  async upsert(session: T, expectedRevision?: number): Promise<void> {
    if (this.fail) throw new Error('fixture persistence failure');
    const expected = expectedRevision ?? session.revision ?? 0;
    assertExpectedRevision([...this.records.values()], session, expected);
    this.records.set(session.whatsappUserId, structuredClone({ ...session, revision: expected + 1 }));
  }
  async findLatestActiveByUserId(userId: string): Promise<T | null> {
    if (this.fail) throw new Error('fixture retrieval failure');
    const session = this.records.get(userId);
    return session && !['reset', 'completed'].includes(session.state) ? structuredClone(session) : null;
  }
  async clearActiveByUserId(userId: string): Promise<void> {
    const session = await this.findLatestActiveByUserId(userId);
    if (session) await this.upsert({ ...session, state: 'completed', stage: 'reset' });
  }
  async findByWorkspaceTokenHash(tokenHash: string): Promise<T | null> {
    if (this.fail) throw new Error('fixture retrieval failure');
    const session = [...this.records.values()].find((record) => record.workspaceAccess?.tokenHash === tokenHash && !['reset', 'completed'].includes(record.state));
    return session ? structuredClone(session) : null;
  }
}
