import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRepository } from './MessageRepository.js';
import { ContextBuilder } from '../../orchestration/ContextBuilder.js';
const fixture = vi.hoisted(() => ({ rows: [] as any[], statements: [] as string[], fail: false }));
vi.mock('../connection.js', () => {
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    fixture.statements.push(sql);
    if (fixture.fail && sql.includes('INSERT INTO messages')) throw new Error('private fixture DB detail');
    if (sql.includes('SELECT user_id FROM users')) return { rows: [{ user_id: 'fixture-user' }] };
    if (sql.includes('SELECT message_id FROM messages')) return { rows: fixture.rows.filter((row) => row.correlation === values[1] && row.role === values[2]) };
    if (sql.includes('SELECT session_id FROM sessions')) return { rows: [{ session_id: 'fixture-session' }] };
    if (sql.includes('INSERT INTO messages')) fixture.rows.push({ correlation: values[2], role: values[5], content: JSON.parse(values[6]), metadata: JSON.parse(values[7]) });
    if (sql.includes('SELECT m.role')) return { rows: [...fixture.rows].reverse() };
    return { rows: [] };
  });
  return { pool: { query, connect: async () => ({ query, release: vi.fn() }) } };
});
beforeEach(() => { fixture.rows.length = 0; fixture.statements.length = 0; fixture.fail = false; });

describe('durable conversation repository continuity', () => {
  it('persists both roles once, uses the traveller lock, and reloads bounded history on a new builder', async () => {
    const repository = new MessageRepository();
    const input = { traveller: 'whatsapp:+94770000001', peer: '+15550000000', requestId: 'request-1' };
    for (let retry = 0; retry < 2; retry++) {
      expect(await repository.appendConversationTurn({ ...input, role: 'user', text: 'Please remember vegetarian food.' })).toBe('durable');
      expect(await repository.appendConversationTurn({ ...input, role: 'assistant', text: 'Which area would you like?' })).toBe('durable');
    }
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.statements.some((sql) => sql.includes('FROM users') && sql.includes('FOR UPDATE'))).toBe(true);
    const history = await new ContextBuilder(new MessageRepository()).loadHistory(input.traveller);
    expect(history.historyStatus).toBe('available');
    expect(history.conversationHistory?.map((entry) => entry.role)).toEqual(['user', 'assistant']);
    expect(history.conversationHistory?.[0].content).toContain('vegetarian');
    expect(history.conversationHistory?.[1].content).toContain('delivery not verified');
  });
  it('rolls back a failed write and exposes a safe failure instead of reporting success', async () => {
    fixture.fail = true;
    await expect(new MessageRepository().appendConversationTurn({ traveller: 'fixture', peer: 'bot', requestId: 'request-1', role: 'user', text: 'fixture' }))
      .rejects.toThrow('Conversation persistence unavailable');
    expect(fixture.rows).toHaveLength(0);
    expect(fixture.statements).toContain('ROLLBACK');
  });
  it('starts model history after a reset while retaining the durable audit turns', async () => {
    const repository = new MessageRepository();
    const input = { traveller: 'whatsapp:+94770000001', peer: '+15550000000' };
    await repository.appendConversationTurn({ ...input, requestId: 'before', role: 'user', text: 'Restaurants in Colombo' });
    await repository.appendConversationTurn({ ...input, requestId: 'before', role: 'assistant', text: 'Which area?' });
    await repository.appendConversationTurn({ ...input, requestId: 'reset', role: 'user', text: 'reset', conversationBoundary: 'reset' });
    await repository.appendConversationTurn({ ...input, requestId: 'reset', role: 'assistant', text: 'Your saved requests are paused.' });
    await repository.appendConversationTurn({ ...input, requestId: 'after', role: 'user', text: 'What can I do in Galle?' });
    const history = await new ContextBuilder(repository).loadHistory(input.traveller);
    expect(fixture.rows).toHaveLength(5);
    expect(history.conversationHistory?.map((turn) => turn.content)).toEqual([
      expect.stringContaining('Your saved requests are paused.'),
      'What can I do in Galle?',
    ]);
  });
});
