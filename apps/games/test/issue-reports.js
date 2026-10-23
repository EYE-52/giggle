'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createReportApi } = require('../server/reports');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-reports-test-'));
  const file = path.join(dir, 'reports.sqlite'), token = 'private-test-access-'.repeat(3);
  let time = 100000, api, server, base;
  async function start(dbFile = file, secret = token) {
    api = createReportApi({ file: dbFile, token: secret, gameIds: new Set(['doodle-guess', 'pocket-karts']), catalog: [{ id: 'doodle-guess', name: 'Doodle Guess' }], version: 'test', now: () => time, originAllowed: origin => origin === 'https://play.test' });
    server = http.createServer(api.handle);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); api.close(); }
  const packet = (extra = {}) => ({ id: randomUUID(), game: 'doodle-guess', category: 'controls', impact: 'blocked', description: 'Canvas moves while I draw.', steps: 'Start drawing, then drag.', context: { browser: 'Safari test', width: 390, height: 844, room: 'PRIVATE', word: 'PRIVATE', token: 'PRIVATE', url: 'PRIVATE', drawing: 'PRIVATE' }, ...extra });
  async function call(route = '/api/reports', { body, method = body ? 'POST' : 'GET', admin = false, headers = {} } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, data: await response.json() };
  }
  try {
    await start();
    const first = packet(), created = await call(undefined, { body: first });
    assert.equal(created.status, 201); assert.equal(created.data.id, first.id);
    assert.deepEqual(Object.keys(created.data).sort(), ['createdAt', 'id', 'ok']);
    assert.equal((await call(undefined, { body: first })).status, 200, 'lost acknowledgement retry is idempotent');
    assert.equal((await call(undefined, { body: { ...first, description: 'Different report entirely.' } })).status, 409);
    assert.equal((await call()).status, 401, 'public clients cannot read reports');
    assert.equal((await call(undefined, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    let inbox = await call(undefined, { admin: true });
    assert.equal(inbox.data.items.length, 1); assert.deepEqual(inbox.data.items[0].context, { browser: 'Safari test', width: 390, height: 844 });
    assert.equal('fingerprint' in inbox.data.items[0], false);
    assert.equal(inbox.data.games[0].name, 'Doodle Guess');
    const diagnosed=packet({game:'pocket-karts',context:{run:{schema:1,game:'pocket-karts',frameP95Ms:22.45,frameMaxMs:130,rendererSampleCount:200,renderCpuP95Ms:3.2,renderCpuMaxMs:40,timings:{frame:[{atMs:330,durationMs:130,room:'PRIVATE'}],render:[{atMs:300,durationMs:40}],snapshot:[{atMs:300,durationMs:120},{atMs:10,durationMs:11}],private:'PRIVATE'},room:'PRIVATE',counts:{collision:2,chat:1},events:[{type:'collision',atMs:300,message:'PRIVATE'}]}}});
    const diagnosedValue=require('../server/reports').validateReport(diagnosed,new Set(['doodle-guess','pocket-karts']));
    assert.deepEqual(diagnosedValue.context.run,{schema:1,game:'pocket-karts',frameP95Ms:22.45,frameMaxMs:130,rendererSampleCount:200,renderCpuP95Ms:3.2,renderCpuMaxMs:40,counts:{collision:2},events:[{type:'collision',atMs:300}],timings:{frame:[{atMs:330,durationMs:130}],render:[{atMs:300,durationMs:40}],snapshot:[{atMs:300,durationMs:120}]}});
    for (const changed of [ { game: 'castle-clash' }, { id: 'bad' }, { description: ' short ' }, { category: 'hack' }, { impact: 'hack' }, { description: 'x'.repeat(4001) }, { steps: 'x'.repeat(1501) }, { context: { browser: 'x'.repeat(501) } } ]) {
      assert.equal((await call(undefined, { body: packet(changed) })).status, 400);
    }
    assert.equal((await call(undefined, { body: '[]' })).status, 400);
    assert.equal((await call(undefined, { body: '{' })).status, 400);
    assert.equal((await call(undefined, { body: packet(), headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await call(undefined, { body: 'x'.repeat(24577) })).status, 413);
    assert.equal((await call(undefined, { body: packet(), headers: { Origin: 'https://hostile.test' } })).status, 403);
    assert.equal((await call(undefined, { admin: true, headers: { Origin: 'https://hostile.test' } })).status, 403);
    const preflight = await fetch(base + '/api/reports', { method: 'OPTIONS', headers: { Origin: 'https://play.test', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://play.test');
    assert.equal((await call(undefined, { body: first, headers: { Origin: 'https://play.test' } })).status, 200);
    assert.equal((await call(`/api/reports/${first.id}`, { method: 'PATCH', body: { status: 'resolved' } })).status, 401);
    assert.equal((await call(`/api/reports/${first.id}`, { admin: true, method: 'PATCH', body: { status: 'resolved' } })).status, 200);
    assert.equal((await call(undefined, { admin: true })).data.items.length, 0);
    assert.equal((await call('/api/reports?status=resolved', { admin: true })).data.items.length, 1);
    assert.equal((await call(`/api/reports/${first.id}`, { admin: true, method: 'PATCH', body: { status: 'bad' } })).status, 400);
    assert.equal((await call(`/api/reports/${randomUUID()}`, { admin: true, method: 'PATCH', body: { status: 'new' } })).status, 404);
    assert.equal((await call('/api/reports?status=bad', { admin: true })).status, 400);
    assert.equal((await call('/api/reports?limit=101', { admin: true })).status, 400);
    assert.equal((await call('/api/reports?before=0', { admin: true })).status, 400);
    const second = packet({ game: 'platform', description: '<img src=x onerror=alert(1)> Keep this as text.' });
    assert.equal((await call(undefined, { body: second })).status, 201);
    assert.equal((await call('/api/reports?game=platform', { admin: true })).data.items[0].description, second.description);
    inbox = await call('/api/reports?status=all&limit=1', { admin: true });
    assert.equal(inbox.data.items[0].id, second.id);
    assert.equal((await call(`/api/reports?status=all&before=${inbox.data.before}`, { admin: true })).data.items[0].id, first.id);
    await stop(); await start();
    assert.equal((await call('/api/reports?status=all', { admin: true })).data.items.length, 2, 'reports and status survive server restart');
    assert.equal((await call(undefined, { body: first })).status, 200, 'receipt survives restart');
    for (let i = 0; i < 29; i++) assert.equal((await call(undefined, { body: second, headers: { 'X-Forwarded-For': `192.0.2.${i}`, 'X-Real-IP': `192.0.2.${i}` } })).status, 200);
    assert.equal((await call(undefined, { body: second, headers: { 'X-Forwarded-For': '192.0.2.250', 'X-Real-IP': '192.0.2.250' } })).status, 429, 'spoofed forwarding headers cannot rotate local rate buckets');
    time += 600001;
    assert.equal((await call(undefined, { body: second })).status, 200, 'abuse budget recovers');
    assert.equal((await call(undefined, { body: diagnosed })).status, 201);
    const attached = (await call('/api/reports?game=pocket-karts', { admin: true })).data.items[0];
    assert.deepEqual(attached.context.run, diagnosedValue.context.run, 'sanitized run metrics persist through the actual HTTP inbox');
    await stop(); await start();
    assert.deepEqual((await call('/api/reports?game=pocket-karts', { admin: true })).data.items[0].context.run, diagnosedValue.context.run, 'attached diagnostics survive restart');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    await stop(); await start(null);
    const unavailable = await call(undefined, { body: packet() });
    assert.equal(unavailable.status, 503); assert.equal(unavailable.data.ok, undefined, 'failed storage never reports success');
    await stop(); await start(path.join(file, 'impossible.sqlite'));
    assert.equal((await call(undefined, { body: packet() })).status, 503);
    assert.equal((await call(undefined, { body: packet() })).status, 503, 'initialization error stays recoverable');
    console.log('ISSUE_REPORTS_PASS: private HTTP inbox, validation, safe device context, receipts/retries, paging, triage, restart persistence, rate limits and storage failure');
  } finally { if (server?.listening) await stop(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
