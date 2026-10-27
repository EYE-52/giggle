'use strict';
// Optional real-browser regression for the test table (/test/) and the
// shell's End game / Leave / Rematch / Change game flow, driven through the
// real frames exactly as a person would. Uses an installed Playwright:
//   NODE_PATH=/opt/node-tools/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/test-table-browser.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let checks = 0;
const ok = (v, m) => { assert(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

(async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'test-table-'));
  const server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(scratch, 'reports.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const s of [server.stdout, server.stderr]) s.on('data', (b) => { logs += b; });
  for (let i = 0; i < 200 && !/PartyBox on/.test(logs); i++) await new Promise((r) => setTimeout(r, 50));
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() + ' ' + m.location().url); });
    await page.goto(`http://127.0.0.1:${port}/test/`);
    await page.locator('#game option[value="trivia"]').waitFor({ state: 'attached' });
    await page.selectOption('#players', '3');
    await page.selectOption('#game', 'trivia');
    await page.selectOption('#look', 'giggle');
    await page.click('#start');
    await page.locator('iframe').nth(2).waitFor();
    const frame = async (n) => {
      for (let i = 0; i < 100; i++) {
        const f = page.frames().find((x) => new URL(x.url()).searchParams.get('seat') === String(n));
        if (f) return f;
        await page.waitForTimeout(100);
      }
      throw Error('seat ' + n + ' frame missing');
    };
    const [p1, p2, p3] = [await frame(1), await frame(2), await frame(3)];
    ok(await p1.evaluate(() => document.body.classList.contains('is-embed')), 'Inside Giggle look applies the navy palette');

    // Host plays from the setup dialog the table opened.
    await p1.locator('#howtoGo:not([disabled])').click();
    for (const f of [p1, p2, p3]) await f.locator('.play-toolbar').waitFor();
    ok(true, 'all three seats reach the game');

    // Game size control: auto default from the frame size, per-seat memory,
    // correct hit-testing at 130%, reset by tapping the percentage.
    const frameSize = await p1.evaluate(() => [innerWidth, innerHeight]);
    const auto = frameSize[0] < 520 || frameSize[1] < 560 ? (frameSize[0] < 400 && frameSize[1] < 600 || frameSize[1] < 520 ? '80%' : '90%') : '100%';
    eq(await p1.locator('#gameZoom .game-zoom-value').innerText(), auto, 'small frames start smaller');
    ok(await p1.locator('#gameZoom [aria-label="Make game bigger"]').count(), 'accessible labels');
    while ((await p1.locator('#gameZoom .game-zoom-value').innerText()) !== '130%') await p1.locator('#gameZoom [data-zoom="1"]').click();
    ok(await p1.locator('#gameZoom [data-zoom="1"]').isDisabled(), 'bigger stops at 130%');
    eq(await p1.evaluate(() => document.getElementById('gbody').style.zoom), '1.3', 'playfield zoomed');
    eq(await p1.evaluate(() => localStorage.getItem('seat1:pb_zoom')), '1.3', 'choice remembered for this seat');
    eq(await p2.evaluate(() => localStorage.getItem('seat2:pb_zoom')), null, 'other seats keep their own size');
    eq(await p1.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal scroll at 130%');
    const hit = await p1.evaluate(() => {
      const t = [...document.querySelectorAll('#gbody button')].find((b) => b.getClientRects().length && !b.disabled);
      if (!t) return 'none';
      const r = t.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === t;
    });
    eq(hit, true, 'hit-testing lands on the zoomed control');
    await p1.locator('#gameZoom .game-zoom-value').click();
    eq(await p1.locator('#gameZoom .game-zoom-value').innerText(), '100%', 'tapping the percentage resets to 100%');
    eq(await p1.evaluate(() => document.getElementById('gbody').style.zoom), '', 'reset removes the zoom');

    // Player 3 leaves mid-match: back to the picker, the others play on.
    await p3.locator('#roomMenu > summary').click();
    await p3.locator('#bLeave').click();
    await p3.locator('#bLeaveConfirm').click();
    await p3.locator('.lobby-running').waitFor();
    ok(/being played/.test(await p3.locator('.lobby-running').innerText()), 'leaver sees the running game line');
    await p3.locator('#bWatch').click();
    await p3.locator('.play-toolbar').waitFor();
    ok(/left this match/i.test(await p3.locator('.specbanner').innerText()), 'Watch shows the match as a watcher');
    ok(await p1.locator('.play-toolbar').count(), 'others keep playing');

    // Only the host sees End game; it asks first, then everyone sees final scores.
    await p2.locator('#roomMenu > summary').click();
    ok(await p2.locator('#bLobby').isHidden(), 'guests do not see End game');
    await p2.locator('#bRoomClose').click();
    await p1.locator('#roomMenu > summary').click();
    eq(await p1.locator('#bLobby').innerText(), 'End game', 'one name: End game');
    await p1.locator('#bLobby').click();
    await p1.locator('#bEndConfirm').click();
    for (const f of [p1, p2]) await f.locator('#rematch').waitFor();
    for (const f of [p1, p2]) ok(/Final scores/.test(await f.locator('#gbody').innerText()), 'Final scores shown');
    eq(await p1.locator('#bRematch').innerText(), 'Rematch', 'Rematch');
    eq(await p1.locator('#bChange').innerText(), 'Change game', 'Change game');
    ok(await p2.locator('#bRematch').isDisabled(), 'guest waits for the host');

    // Rematch: a fresh match for everyone, including the player who left.
    await p1.locator('#bRematch').click();
    for (const f of [p1, p2, p3]) await f.waitForFunction(() => !document.querySelector('#rematch') && !!document.querySelector('.play-toolbar'));
    ok(!(await p3.locator('.specbanner').count()), 'the leaver plays the next game');

    // Change game from the drawer after ending again.
    await p1.locator('#roomMenu > summary').click();
    await p1.locator('#bLobby').click();
    await p1.locator('#bEndConfirm').click();
    await p1.locator('#bChange').click();
    for (const f of [p1, p2, p3]) await f.locator('.partystrip').waitFor();
    ok(true, 'Change game returns everyone to the picker');
    for (const f of [p1, p2, p3]) eq(await f.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal scroll');
    eq(errors, [], 'no page or console errors');
    console.log(`TEST_TABLE_BROWSER_PASS: ${checks} checks`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
