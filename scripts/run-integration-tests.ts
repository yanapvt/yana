import net from 'node:net';
import { spawn } from 'node:child_process';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

const checkOnly = process.argv.includes('--check-only');
const database = process.env.POSTGRES_INTEGRATION_DB?.trim();
const redisDb = process.env.REDIS_INTEGRATION_DB?.trim();
const prerequisites = {
  postgresTestDatabase: Boolean(database && /_test$/i.test(database)),
  redisTestDatabase: Boolean(redisDb && /^\d+$/.test(redisDb) && Number(redisDb) >= 1),
  postgresReachable: await reachable(process.env.POSTGRES_HOST || 'localhost', Number(process.env.POSTGRES_PORT || 5432)),
  redisReachable: await reachable(process.env.REDIS_HOST || 'localhost', Number(process.env.REDIS_PORT || 6379)),
};
const ready = Object.values(prerequisites).every(Boolean);
console.log(JSON.stringify({ event: 'integration_test_prerequisites', ready, prerequisites }));
if (checkOnly) process.exit(0);
if (!ready) process.exit(1);

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.integration.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, POSTGRES_DB: database!, REDIS_DB: redisDb! },
});
child.on('error', () => { console.error('Integration test runner could not start.'); process.exitCode = 1; });
child.on('exit', (code) => process.exit(code ?? 1));

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result: boolean) => { socket.destroy(); resolve(result); };
    socket.setTimeout(1000); socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false)); socket.once('error', () => done(false));
  });
}
