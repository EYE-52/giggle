'use strict';
// Optional real-browser layout regression. Install Playwright separately and
// provide NODE_PATH plus PLAYWRIGHT_EXECUTABLE_PATH when needed. No fixtures,
// account access or external services: ordinary local rooms and pointer input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let server, browser, checks = 0;
function ok(value, label) { assert(value, label); checks++; }
(async () => {
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-compact-'));
  server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(scratch, 'reports.sqlite'), GAME_BRIDGE_SECRET: '', PUBLIC_GAME_URL: '', PUBLIC_WEBSOCKET_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const stream of [server.stdout, server.stderr]) stream.on('data', b => { logs += b; });
  for (let n = 0; n < 100 && !logs.includes('PartyBox on'); n++) await new Promise(r => setTimeout(r, 100));
  ok(logs.includes('PartyBox on'), 'local server ready');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: 'chromium' }) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [], monitoredPages = [];
  function monitor(page, name) {
    monitoredPages.push(page);
    page.on('pageerror', e => errors.push({ client: name, message: e.message }));
    page.on('console', m => { if (m.type() === 'error') errors.push({ client: name, message: m.text() }); });
  }
  const page = await context.newPage();
  monitor(page, 'host');
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#bBrowse').waitFor();
  await page.evaluate(() => document.fonts.ready);
  ok((await page.locator('.hero').boundingBox()).height <= 400, 'desktop discovery hero gives room to games');
  for (const [width, height] of [[320, 568], [390, 844], [760, 600], [1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home fits ${width}`);
    ok((await page.locator('#bCreate').boundingBox()).height >= 44, `create target >=44px at ${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#nm').fill('Alexandria-Playr');
  await page.locator('#bCreate').click();
  await page.waitForURL('**/r/*');
  for (const name of ['Morgan', 'Casey']) {
    const peer = await browser.newPage();
    monitor(peer, name);
    await peer.goto(page.url());
    await peer.locator('#nm').fill(name);
    await peer.locator('#bJoin').click();
    await peer.locator('.partystrip').waitFor();
  }
  await page.locator('.partystrip .player').filter({ hasText: 'Casey' }).waitFor();
  ok((await page.locator('.partystrip').boundingBox()).height <= 160, 'three-player lobby uses one compact invitation band');
  ok(monitoredPages.length === 3, 'all three clients monitored before navigation');
  const gameIds = await page.locator('#ggames [data-how]').evaluateAll(nodes => [...new Set(nodes.map(n => n.dataset.how))]);
  ok(gameIds.length === 42, 'all live catalogue games available for focus checks');
  let restoredSheets = 0;
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const id of gameIds) {
      const opener = page.locator(`[data-how="${id}"]`).first();
      await opener.click();
      await page.locator('.howto-dlg[open]').waitFor();
      await page.locator('#howtoPlayTab').focus();
      await page.keyboard.press('ArrowRight');
      ok(await page.locator('#howtoRulesTab').getAttribute('aria-selected') === 'true', `${id} keyboard tab at ${width}`);
      await page.keyboard.press('Escape');
      ok(await page.locator('.howto-dlg[open]').count() === 0, `${id} Escape closes at ${width}`);
      ok(await opener.evaluate(el => document.activeElement === el), `${id} returns focus to its live opener at ${width}`);
      restoredSheets++;
    }
  }
  console.log(`CATALOG_SHEET_FOCUS_PASS: ${restoredSheets} real sheets;42 games at1280x720 and390x844`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('[data-how="doodle-guess"]').first().click();
  await page.locator('#howtoGo:not([disabled])').click();
  let artist;
  for (let n = 0; n < 100 && !artist; n++) {
    artist = null;
    for (const candidate of browser.contexts().flatMap(c => c.pages())) {
      if (await candidate.locator('.dg-pick .gk-choice').count()) { artist = candidate; break; }
    }
    if (!artist) await page.waitForTimeout(50);
  }
  ok(artist, 'actual artist receives private word choices');
  ok(monitoredPages.includes(artist), 'actual artist has uncaught-error monitoring');
  await artist.locator('.dg-pick .gk-choice').first().click();
  const canvas = artist.locator('canvas[data-drawable="true"]');
  await canvas.waitFor();
  for (const [width, height, area] of [[1280, 720, 350000], [1366, 768, 425000]]) {
    await artist.setViewportSize({ width, height });
    await artist.waitForTimeout(100);
    const r = await canvas.boundingBox();
    ok(r.width * r.height >= area, `actual paper area at ${width}`);
    ok(r.y >= 0 && r.y + r.height <= height, `paper stays visible at ${width}`);
  }
  const r = await canvas.boundingBox();
  await artist.mouse.move(r.x + r.width * .3, r.y + r.height * .4);
  await artist.mouse.down();
  await artist.mouse.move(r.x + r.width * .6, r.y + r.height * .6, { steps: 12 });
  await artist.mouse.up();
  ok(await canvas.evaluate(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] < 500) return true;
    return false;
  }), 'ordinary pointer stroke reaches the resized drawing coordinates');
  await artist.locator('#roomMenu > summary').click();
  await artist.keyboard.press('Escape');
  ok(await artist.evaluate(() => !document.querySelector('#roomMenu').open && document.activeElement === document.querySelector('#roomMenu > summary')), 'Escape closes Room and restores focus');
  if (process.env.BROWSER_EVIDENCE_DIR) { fs.mkdirSync(process.env.BROWSER_EVIDENCE_DIR, { recursive: true }); await artist.screenshot({ path: path.join(process.env.BROWSER_EVIDENCE_DIR, 'doodle-desktop.png') }); }
  ok(errors.length === 0, `no uncaught errors across all three monitored clients: ${JSON.stringify(errors)}`);
  console.log(`COMPACT_DESKTOP_BROWSER_PASS: ${checks} checks`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) server.kill(); });
