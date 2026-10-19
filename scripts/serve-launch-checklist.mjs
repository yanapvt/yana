import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'output/yana-partner-launch-checklist.html');
const secretDir = resolve(root, '.secrets');
const accessPath = resolve(secretDir, 'checklist-access.json');
const statePath = resolve(secretDir, 'checklist-state.json');
const host = '127.0.0.1';
const port = Number(process.env.YANA_CHECKLIST_PORT || 8765);
const validStatus = new Set(['open', 'doing', 'blocked', 'done']);
const validId = /^[a-z][a-z0-9-]{1,64}$/;
await mkdir(secretDir, { recursive: true });
let access;
try { access = JSON.parse(await readFile(accessPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  access = { username: 'yana', password: randomBytes(24).toString('base64url') };
  await writeFile(accessPath, JSON.stringify(access, null, 2), { mode: 0o600, flag: 'wx' });
}
let statuses = {};
try { statuses = JSON.parse(await readFile(statePath, 'utf8')).statuses || {}; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let revision = 0;
const safeEqual = (a, b) => {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
function authorized(header = '') {
  if (!header.startsWith('Basic ')) return false;
  try {
    const value = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return safeEqual(value, `${access.username}:${access.password}`);
  } catch { return false; }
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON');
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 65536) throw new Error('Request too large');
  }
  return JSON.parse(data);
}
async function persist() {
  const next = `${statePath}.tmp`;
  await writeFile(next, JSON.stringify({ statuses }, null, 2), { mode: 0o600 });
  await rename(next, statePath);
  revision++;
}
const server = createServer(async (req, res) => {
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="YANA project checklist"', 'Cache-Control': 'no-store' });
    res.end('Authentication required');
    return;
  }
  const path = new URL(req.url, `http://${host}`).pathname;
  if (req.method === 'GET' && (path === '/' || path === '/checklist')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    res.end(await readFile(htmlPath));
    return;
  }
  if (req.method === 'GET' && path === '/api/status') { json(res, 200, { statuses, revision }); return; }
  if (req.method !== 'POST' || !['/api/task', '/api/import'].includes(path)) { json(res, 404, { error: 'Not found' }); return; }
  const origin = req.headers.origin;
  const expected = req.headers.host ? `https://${req.headers.host}` : '';
  const localExpected = req.headers.host ? `http://${req.headers.host}` : '';
  if (origin && origin !== expected && origin !== localExpected) { json(res, 403, { error: 'Origin denied' }); return; }
  try {
    const value = await body(req);
    if (path === '/api/task') {
      if (!validId.test(value.id) || !validStatus.has(value.status)) throw new Error('Invalid task update');
      statuses[value.id] = value.status;
    } else {
      if (!value.statuses || typeof value.statuses !== 'object' || Array.isArray(value.statuses)) throw new Error('Invalid import');
      const next = {};
      for (const [id, status] of Object.entries(value.statuses)) {
        if (!validId.test(id) || !validStatus.has(status)) throw new Error('Invalid import status');
        next[id] = status;
      }
      statuses = next;
    }
    await persist();
    json(res, 200, { statuses, revision });
  } catch (error) { json(res, 400, { error: error.message }); }
});
server.listen(port, host, () => console.log(`YANA checklist serving on http://${host}:${port}`));
