'use strict';
// Real practice UI, browser ErrorEvent/LayoutShift, failed game import,
// sendBeacon, SQLite, protected inbox and the operator CLI. Loopback only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-telemetry-browser-'));
const token = 'local-telemetry-browser-key-'.repeat(2), file = path.join(dir, 'reports.sqlite');
const artifacts = process.env.TELEMETRY_ARTIFACT_DIR || dir;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser, base, log = '';
async function digest() {
  const response = await fetch(base + '/api/telemetry?since=24h', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200); return response.json();
}
async function until(check, message, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await wait(150); }
  throw new Error(message);
}
async function practice(context, game = 'chess') {
  const page = await context.newPage();
  await page.goto(`${base}/practice/?game=${game}`);
  await page.locator('#practiceStart:not([disabled])').waitFor();
  await page.locator('#practiceStart').click();
  await page.waitForFunction(() => document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'));
  const host = page.frames().find(frame => { try { return new URL(frame.url()).searchParams.get('seat') === '1'; } catch { return false; } });
  assert(host);
  await host.locator('#howtoGo:not([disabled])').click();
  return { page, host };
}
(async () => {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', GAME_REPORT_DB: file, GAME_REPORT_ADMIN_TOKEN: token } });
  server.stdout.on('data', b => { log = (log + b).slice(-8000); }); server.stderr.on('data', b => { log = (log + b).slice(-8000); });
  await until(async () => { try { return (await fetch(base + '/config.json')).ok; } catch { return false; } }, 'Local server failed to start');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: [] });
  // Deterministic inclusion in the 10% performance sample, in this test only.
  await context.addInitScript(() => {
    Math.random = () => 0;
    const Native = WebSocket; window.__telemetrySockets = [];
    window.WebSocket = class extends Native { constructor(...args) { super(...args); window.__telemetrySockets.push(this); } };
  });
  const beacons = [];
  const referrers = [];
  context.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/telemetry') {
    beacons.push(request.postData()); referrers.push(request.headers().referer);
  } });
  const { page, host } = await practice(context);
  await host.waitForFunction(() => document.getElementById('gbody')?.getAttribute('aria-busy') === 'false');
  await host.evaluate(() => {
    setTimeout(() => { throw new TypeError('PRIVATE_ALICE https://site/?room=PRIVATE_ROOM'); }, 0);
    Promise.reject(new Error('PRIVATE_CHAT'));
    const image = new Image(); image.src = '/missing-PRIVATE_ALICE.png?room=PRIVATE_ROOM'; document.body.append(image);
    const moving = document.createElement('div'); moving.id = 'PRIVATE_ALICE'; moving.dataset.room = 'PRIVATE_ROOM';
    moving.style.cssText = 'position:fixed;top:40px;left:10px;width:280px;height:220px;background:#e3a23e;z-index:100000';
    document.body.append(moving);
    setTimeout(() => { moving.style.top = '360px'; }, 750);
    setTimeout(() => { const end = performance.now() + 120; while (performance.now() < end) { /* deliberate browser long task */ } }, 1500);
  });
  await until(async () => {
    const types = new Set((await digest()).items.filter(x => x.game === 'chess').map(x => x.type));
    return ['runtime-error', 'promise-error', 'resource-error', 'layout-shift', 'long-task'].every(type => types.has(type));
  }, 'Browser errors, asset failure, forced layout shift and long task did not reach SQLite');
  let result = await digest();
  let shift;
  for (const item of result.items.filter(x => x.type === 'layout-shift' && x.game === 'chess')) {
    if (await host.evaluate(selector => document.querySelector(selector)?.id === 'PRIVATE_ALICE', item.selector)) shift = item;
  }
  assert(shift, 'stored selector points to the actual forced moving box');
  assert(shift.selector.includes(':nth-of-type(')); assert.equal(shift.context.screen, 'practice');
  assert(result.items.some(x => x.type === 'runtime-error' && x.message === 'TypeError'));
  assert(!/PRIVATE_/.test(JSON.stringify(result)), 'private messages, URLs, ids, names and data attributes are absent');
  for (let i = 0; i < 3; i++) {
    const before = await host.evaluate(() => { const n = window.__telemetrySockets.length; window.__telemetrySockets.at(-1).close(); return n; });
    await host.waitForFunction(n => window.__telemetrySockets.length > n && window.__telemetrySockets.at(-1).readyState === 1, before);
  }
  await until(async () => (await digest()).items.some(x => x.type === 'socket-loop'), 'Actual socket reconnect loop did not reach digest');
  // An independent game document owns its collector too, including nested
  // practice frames. Its errors keep the game id rather than platform.
  const framed = await practice(context, 'chain-reaction');
  await framed.host.locator('iframe.game-document').waitFor();
  await framed.host.waitForFunction(() => document.getElementById('gbody')?.getAttribute('aria-busy') === 'false');
  const child = framed.page.frames().find(frame => frame.url().includes('/game-assets/chain-reaction/'));
  assert(child); await child.evaluate(() => setTimeout(() => { throw new ReferenceError('PRIVATE_FRAME'); }, 0));
  await until(async () => (await digest()).items.some(x => x.type === 'runtime-error' && x.game === 'chain-reaction' && x.message === 'ReferenceError'), 'Independent game iframe did not reach digest');
  // A fresh document ensures its import cache cannot hide the forced failure.
  await context.route('**/js/games/chess.js', route => route.abort());
  const failed = await practice(context);
  await failed.host.locator('.game-load-error').waitFor({ timeout: 20000 });
  await until(async () => (await digest()).items.some(x => x.type === 'load-error' && x.game === 'chess'), 'Failed practice game did not reach digest');
  assert((await digest()).items.some(x => x.type === 'load-retry'));
  // Inbox uses the existing key, filters the actual stored rows and saves triage.
  const inbox = await context.newPage(); await inbox.goto(base + '/reports/');
  await inbox.locator('#access').fill(token); await inbox.locator('#login button').click();
  await inbox.locator('#inbox').waitFor({ state: 'visible' }); await inbox.locator('#view').selectOption('problems');
  await inbox.waitForFunction(() => !document.getElementById('view').disabled);
  await inbox.locator('#type').selectOption('runtime-error');
  await inbox.waitForFunction(() => !document.getElementById('type').disabled);
  const card = inbox.locator('.inbox-report').filter({ hasText: 'TypeError' }).first();
  await card.getByRole('button', { name: 'Triaged', exact: true }).click();
  await inbox.getByText('Status saved.', { exact: true }).waitFor();
  assert((await digest()).items.some(x => x.type === 'runtime-error' && x.status === 'triaged'));
  await card.getByRole('button', { name: 'Resolved', exact: true }).click(); await inbox.getByText('Status saved.', { exact: true }).waitFor();
  await until(async () => (await digest()).items.some(x => x.type === 'runtime-error' && x.status === 'resolved'), 'Resolved status was not saved');
  fs.mkdirSync(artifacts, { recursive: true });
  await inbox.screenshot({ path: path.join(artifacts, 'problems-desktop.png'), fullPage: true });
  await inbox.setViewportSize({ width: 390, height: 844 });
  assert(await inbox.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Problems inbox fits a phone');
  await inbox.screenshot({ path: path.join(artifacts, 'problems-phone.png'), fullPage: true });
  await inbox.locator('#logout').click(); assert.equal(await inbox.locator('.inbox-report').count(), 0);
  const health = await (await fetch(base + '/health')).json();
  assert(health.telemetry.events24h >= 5); assert(!JSON.stringify(health).includes('TypeError'));
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/telemetry-digest.js', '--since', '24h', '--json'], { cwd: root, env: { ...process.env, GAME_REPORT_DB: file, GAME_REPORT_URL: '', GAME_REPORT_ACCESS_FILE: path.join(dir, 'missing') } });
    let out = '', err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
  for (const type of ['runtime-error', 'layout-shift', 'load-error']) assert(output.items.some(x => x.type === type && x.game === 'chess'), `${type} visible in real CLI`);
  assert(beacons.length > 0); for (const body of beacons) assert(!/PRIVATE_/.test(body), 'private data never leaves browser');
  assert(referrers.every(value => value === undefined || value === ''), 'beacons cannot attach room URLs in the Referer header');
  console.log(`TELEMETRY_BROWSER_PASS: real practice error/layout shift/asset failure/load failure → beacon → SQLite → CLI, protected triage, counts-only health, desktop/phone inbox; screenshots ${artifacts}`);
  await context.close();
})().catch(error => { console.error(error); console.error(log); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await exited; }
  // Retain screenshots for review; temporary DB contains synthetic data only.
});
