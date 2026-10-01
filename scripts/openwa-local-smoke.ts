import net from 'node:net';
import { pool } from '../src/db/connection.js';
import { env } from '../src/config/environment.js';

const results: Record<string, unknown> = { event: 'openwa_local_smoke', sendsMessages: false };
results.yana = await httpStatus(`http://127.0.0.1:${process.env.PORT || '3000'}/health`);
results.openwaTcp = env.openwa.baseUrl ? await tcpStatus(new URL(env.openwa.baseUrl)) : 'not_configured';
results.openwaSession = env.openwa.baseUrl && env.openwa.sessionId && env.openwa.apiKey
  ? await httpStatus(`${env.openwa.baseUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(env.openwa.sessionId)}`, { 'X-API-Key': env.openwa.apiKey })
  : 'not_configured';
try {
  const check = await pool.query(`SELECT to_regclass('public.inbound_message_claims') AS claims, to_regclass('public.hotel_recheck_receipts') AS receipts`);
  results.postgres = check.rows[0]?.claims && check.rows[0]?.receipts ? 'ready' : 'migration_023_required';
} catch { results.postgres = 'unavailable'; }
console.log(JSON.stringify(results));
await pool.end();
if (results.yana !== 200 || results.openwaTcp !== 'reachable' || results.postgres !== 'ready') process.exitCode = 1;

async function httpStatus(url: string, headers: Record<string, string> = {}): Promise<number | 'unavailable'> {
  try { return (await fetch(url, { headers, signal: AbortSignal.timeout(2000) })).status; } catch { return 'unavailable'; }
}
async function tcpStatus(url: URL): Promise<'reachable' | 'unavailable'> {
  return new Promise((resolve) => { const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 80) }); const done = (v: 'reachable'|'unavailable') => { socket.destroy(); resolve(v); }; socket.setTimeout(2000); socket.once('connect', () => done('reachable')); socket.once('timeout', () => done('unavailable')); socket.once('error', () => done('unavailable')); });
}
