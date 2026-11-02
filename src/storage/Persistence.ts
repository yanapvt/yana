export type PersistenceOutcome = { status: 'durable' | 'degraded' | 'failed'; reason?: string };
export class PersistenceError extends Error {
  constructor(public readonly status: 'failed' | 'conflict' = 'failed') {
    super(status === 'conflict' ? 'This request is out of date. Reload the latest state and try again.' : 'I could not save this change safely. Please try again.');
    this.name = 'PersistenceError';
  }
}
export function assertExpectedRevision(
  records: Array<{ whatsappUserId: string; revision?: number; id?: string; state?: string }>,
  proposed: { whatsappUserId: string; revision?: number; id?: string }, expected: number
): void {
  const current = records.find((record) => record.whatsappUserId === proposed.whatsappUserId);
  if (expected === 0 && current && ['reset', 'completed'].includes(current.state ?? '') && current.id !== proposed.id) return;
  if ((current?.revision ?? 0) !== expected || (current?.id && expected > 0 && current.id !== proposed.id)) throw new PersistenceError('conflict');
}
