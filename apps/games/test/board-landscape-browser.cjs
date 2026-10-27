'use strict';
// Real local UI regression for board/sidebar clearance around fixed controls.
// Uses external Playwright like the other optional browser checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
let browser, server, checks = 0;
const ok = (v, message) => { assert(v, message); checks++; };
async function waitFor(fn, page) {
  for (let n = 0; n < 200; n++) { if (fn()) return; await page.waitForTimeout(50); }
  throw Error('Authoritative UI state did not settle');
}
async function clearOfControls(page, selector, message) {
  const target = page.locator(selector).first();
  await target.evaluate(el => el.scrollIntoView({ block: 'start' }));
  const result = await target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('#roomMenu > summary, .game-report-icon')].some(control => {
      const c = control.getBoundingClientRect();
      return r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
    });
    const panel = el.closest('.bk-panel');
    const p = panel?.getBoundingClientRect();
    const clipped = panel && getComputedStyle(panel).overflowY === 'auto' && (r.top < p.top - 1 || r.bottom > p.bottom + 1);
    return { overlaps, clipped, visible: r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1, rect: r.toJSON(), panel: p?.toJSON(), scrollY };
  });
  ok(!result.overlaps && !result.clipped && result.visible, message + ': ' + JSON.stringify(result));
}
(async () => {
  const root = path.resolve(__dirname, '..'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-board-landscape-'));
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(scratch, 'reports.sqlite'), GAME_BRIDGE_SECRET: '', PUBLIC_GAME_URL: '', PUBLIC_WEBSOCKET_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', b => { logs += b; });
  for (let n = 0; n < 100 && !logs.includes('PartyBox on'); n++) await new Promise(r => setTimeout(r, 100));
  ok(logs.includes('PartyBox on'), 'local server ready');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: 'chromium' }) });
  const clients = [], errors = [];
  for (const name of ['Alexandria-Playr', 'Morgan']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage(), client = { page, state: null };
    clients.push(client);
    page.on('pageerror', e => errors.push({ client: name, message: e.message }));
    page.on('console', m => { if (m.type() === 'error') errors.push({ client: name, message: m.text() }); });
    page.on('websocket', ws => ws.on('framereceived', frame => { try { const m = JSON.parse(frame.payload); if (m.t === 'state') client.state = m; } catch {} }));
    await page.goto(clients.length === 1 ? `http://127.0.0.1:${port}` : clients[0].page.url());
    await page.locator('#nm').fill(name);
    await page.locator(clients.length === 1 ? '#bCreate' : '#bJoin').click();
    await page.locator('.partystrip').waitFor();
  }
  const host = clients[0], page = host.page;
  async function start(id) {
    await page.locator(`[data-how="${id}"]`).first().click();
    await page.locator('#howtoGo:not([disabled])').click();
    await waitFor(() => clients.every(c => c.state?.game === id && !c.state.preparing), page);
  }
  await start('chess');
  for (const [width, height] of [[568, 320], [842, 388], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await clearOfControls(page, '.bk-title', `chess title clear at ${width}`);
    if (height < 500) {
      const m = await page.evaluate(() => ({ stage: document.querySelector('.bk-stage').getBoundingClientRect().toJSON(), panel: document.querySelector('.bk-panel').getBoundingClientRect().toJSON(), room: document.querySelector('#roomMenu > summary').getBoundingClientRect().toJSON() }));
      ok(await page.locator('.bk-name').evaluateAll(names => names.every(el => el.getBoundingClientRect().width >= 80)), `roster names retain readable space at ${width}`);
      ok(m.panel.top >= m.room.bottom + 8 && m.stage.right <= m.panel.left, `separate board/sidebar/control regions at ${width}`);
      await page.locator('.bk-help > summary').click();
      await clearOfControls(page, '.bk-help > summary', `help heading clear at ${width}`);
      await page.locator('.bk-help > summary').click();
    }
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}`);
  }
  await page.setViewportSize({ width: 568, height: 320 });
  await page.locator('#roomMenu > summary').click();
  const menu = await page.locator('.room-menu-panel').boundingBox();
  ok(menu.y >= 0 && menu.y + menu.height <= 320, 'short Room overlay fits');
  await page.keyboard.press('Escape');
  ok(await page.locator('#roomMenu > summary').evaluate(el => document.activeElement === el), 'Room focus returns to relocated launcher');
  await page.locator('.game-report-icon').click();
  const issue = await page.locator('.issue-dialog[open]').boundingBox();
  ok(issue.y >= 0 && issue.y + issue.height <= 320, 'short Report dialog fits');
  await page.locator('.issue-close').click();
  for (const [side, from, to] of [['w', 'f2', 'f3'], ['b', 'e7', 'e5'], ['w', 'g2', 'g4'], ['b', 'd8', 'h4']]) {
    const actor = clients.find(c => c.state.youAre === side);
    await actor.page.locator(`[data-sq="${from}"][aria-disabled="false"]`).click();
    await actor.page.locator(`[data-sq="${to}"].dest`).click();
    await waitFor(() => actor.state.lastMove?.to === to, page);
    await page.waitForTimeout(400);
  }
  ok(clients.every(c => c.state.phase === 'done' && c.state.result.outcome === 'checkmate'), 'legal Fool’s Mate naturally completes');
  for (const [width, height] of [[568, 320], [842, 388], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const selector of ['.bk-final-title', '.bk-winner', '#bRematch']) await clearOfControls(page, selector, `${selector} clear at ${width}`);
    if (process.env.BROWSER_EVIDENCE_DIR && [568, 1280, 390].includes(width)) { fs.mkdirSync(process.env.BROWSER_EVIDENCE_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.BROWSER_EVIDENCE_DIR, `chess-final-${width}.png`) }); }
    await page.locator('#bRematch').focus();
    ok(await page.locator('#bRematch').evaluate(el => document.activeElement === el), `rematch focus at ${width}`);
  }
  const old = host.state.instanceId;
  await page.locator('#bRematch').click();
  await waitFor(() => host.state.instanceId !== old && !host.state.preparing, page);
  ok(host.state.phase === 'play', 'fresh chess rematch');
  await page.locator('#roomMenu > summary').click();
  await page.locator('#bLobby').click();
  await page.locator('#bEndConfirm').click();
  await page.locator('#bChange').click();
  await start('ludo');
  for (const [width, height] of [[568, 320], [842, 388], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await clearOfControls(page, '.bk-title', `Ludo title clear at ${width}`);
    await clearOfControls(page, '.ld-dice', `Ludo die clear at ${width}`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Ludo fits at ${width}`);
  }
  ok(errors.length === 0, 'zero uncaught errors on both clients: ' + JSON.stringify(errors));
  console.log(`BOARD_LANDSCAPE_BROWSER_PASS: ${checks} checks`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) server.kill(); });
