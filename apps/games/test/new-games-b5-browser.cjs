'use strict';

// Real practice app, real separate seats, ordinary UI actions, actual crypto
// dice and production Room. No state injection or external service is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-b5-browser-'));
const out = process.env.B5_ARTIFACT_DIR || path.join(scratch, 'evidence');
fs.mkdirSync(out, { recursive: true });
const IDS = ['dots-boxes', 'mega-tic-tac-toe', 'five-row', 'pig-dice', 'snakes-ladders'];
const rows = [];
let server, browser, failure = null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const selected = process.env.B5_GAMES?.split(',') || IDS;

function observer() {
  const Native = WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        try { const m = JSON.parse(event.data); if (m.t === 'state') window.__b5state = m; } catch { /* non-JSON */ }
      });
    }
  };
}

async function geometry(frame) {
  return frame.evaluate(() => {
    const selectors = ['.b5-playfield', '.b5-hud', '.bk-players', '.bk-status', '.bk-actions', '[data-roll]', '[data-hold]', '[data-swap]'];
    const rects = {};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getClientRects().length) {
        const r = el.getBoundingClientRect();
        rects[selector] = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    const title = document.querySelector('.bk-title')?.getBoundingClientRect();
    const subtitle = document.querySelector('.bk-meta')?.getBoundingClientRect();
    const intersects = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const headerOverlaps = [...document.querySelectorAll('#roomMenu > summary, .game-report-icon, .game-screen-toggle')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => intersects(el.getBoundingClientRect(), title) || intersects(el.getBoundingClientRect(), subtitle))
      .map(el => el.id || el.className);
    return { rects, headerOverlaps, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, scrollY,
      controls: [...document.querySelectorAll('.b5-game button, .b5-game summary')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(el => {
        const r = el.getBoundingClientRect(); return { text: el.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      }) };
  });
}

function steady(before, after, label, keys = Object.keys(before.rects)) {
  assert(after.scrollWidth <= after.width + 1, label + ': horizontal overflow');
  assert.deepEqual(after.headerOverlaps, [], label + ': header utilities cover the title');
  assert(after.scrollHeight <= after.height + 1, label + ': play screen needs vertical scrolling ' + JSON.stringify(after));
  for (const key of keys) {
    assert(after.rects[key], label + ': missing ' + key);
    for (const dimension of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(after.rects[key][dimension] - before.rects[key][dimension]) <= 1,
        `${label}: ${key}.${dimension} moved ${before.rects[key][dimension]} → ${after.rects[key][dimension]}`);
    }
  }
  for (const c of after.controls) assert(c.h >= 43.9, label + ': short control ' + c.text);
}

async function compareHeaders(base) {
  const comparisons = [];
  for (const id of ['four-in-a-row', 'reversi']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: [] });
    await context.addInitScript(observer);
    const page = await context.newPage();
    try {
      await page.goto(`${base}/practice/?game=${id}`);
      await page.waitForFunction(() => !document.getElementById('practiceStart').disabled);
      await page.locator('#practiceStart').click();
      await page.waitForFunction(() => document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'));
      const host = page.frames().find(frame => new URL(frame.url()).searchParams.get('seat') === '1');
      await host.locator('#howtoGo').click();
      await host.waitForFunction(id => window.__b5state?.game === id && !window.__b5state.preparing, id);
      await host.locator('.bk-title').waitFor();
      await host.evaluate(() => document.fonts.ready);
      const data = await geometry(host);
      comparisons.push({ id, ...data });
      await page.screenshot({ path: path.join(out, `reference-${id}-390-day.png`) });
      await page.locator('#practiceStop').click();
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(out, 'reference-headers.json'), JSON.stringify(comparisons, null, 2));
  console.log('B5_REFERENCE_HEADERS: ' + JSON.stringify(comparisons.map(({ id, headerOverlaps }) => ({ id, headerOverlaps }))));
}

async function play(base, id, viewport, theme) {
  const context = await browser.newContext({ viewport, reducedMotion: process.env.B5_REDUCED === '1' ? 'reduce' : 'no-preference', permissions: [] });
  await context.addInitScript(observer);
  await context.addInitScript(theme => localStorage.setItem('pb_theme', theme), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let actions = 0;
  try {
    await page.goto(`${base}/practice/?game=${id}`);
    await page.waitForFunction(() => !document.getElementById('practiceStart').disabled);
    const seats = ['dots-boxes', 'pig-dice', 'snakes-ladders'].includes(id) ? 4 : 2;
    await page.locator('#practiceCount').selectOption(String(seats));
    await page.locator('#practiceStart').click();
    await page.waitForFunction(n => document.getElementById('practiceStatus').textContent.startsWith(`${n} seats ready`), seats);
    const frames = Array.from({ length: seats }, (_, i) => page.frames().find(f => new URL(f.url()).searchParams.get('seat') === String(i + 1)));
    assert(frames.every(Boolean));
    const host = frames[0];
    if (id === 'pig-dice') {
      await host.locator('#howtoCustom').click();
      await host.getByRole('radiogroup', { name: 'Target', exact: true }).getByRole('radio', { name: '50', exact: true }).click();
      await host.locator('#dlgSave').click();
    }
    if (!await host.locator('#howtoGo').isVisible()) await host.locator(`[data-how="${id}"]`).first().click();
    await host.locator('#howtoGo').click();
    for (const f of frames) {
      await f.waitForFunction(id => window.__b5state?.game === id && !window.__b5state.preparing, id);
      await f.locator('.b5-game').waitFor();
      await f.evaluate(() => document.fonts.ready);
    }
    await wait(80);
    const opening = await geometry(host);
    steady(opening, opening, id + ' opening');
    if (id === 'five-row' && viewport.width === 390) {
      const target = await host.locator('.fv-hit').first().boundingBox();
      assert(target.width >= 22, `15×15 cell ${target.width} is below 22 px`);
    }
    const shot = suffix => page.screenshot({ path: path.join(out, `${id}-${viewport.width}-${theme}-${suffix}.png`) });
    await shot('opening');
    const baselines = [];
    for (let i = 0; i < seats; i++) {
      await page.locator(`#practiceTab${i + 1}`).click();
      baselines[i] = await geometry(frames[i]);
    }
    let initialPhase = null;
    while (actions < 2400) {
      const S = await host.evaluate(() => window.__b5state);
      if (S.phase === 'done') break;
      const actor = frames[S.turn];
      await page.locator(`#practiceTab${S.turn + 1}`).click();
      await actor.waitForFunction(rev => window.__b5state?.rev === rev && !window.__b5state.preparing, S.rev);
      let selector;
      if (id === 'dots-boxes') selector = `[data-edge="${S.legal[0] ?? (await actor.evaluate(() => window.__b5state.legal[0]))}"]`;
      else if (id === 'pig-dice') selector = S.turnTotal >= 18 ? '[data-hold]' : '[data-roll]';
      else if (id === 'snakes-ladders') selector = '[data-roll]';
      else if (id === 'five-row') selector = `[data-cell="${[112, 0, 113, 1, 114, 2, 115, 3, 116][actions]}"]`;
      else {
        const legal = await actor.evaluate(() => window.__b5state.legal);
        selector = `[data-cell="${legal[(actions * 13) % legal.length]}"]`;
      }
      // Use actual hit testing at opening, mid-game and on final moves. Bulk
      // moves use the same DOM click handler to keep a random dice match quick.
      if (actions < 3 || actions === 8) {
        await actor.locator(selector).click();
        await page.mouse.move(viewport.width - 1, 0);
        await wait(220); // Let the control's pointer-hover transform settle.
      }
      else await actor.locator(selector).dispatchEvent('click');
      for (const f of frames) await f.waitForFunction(rev => window.__b5state?.rev > rev && !window.__b5state.preparing, S.rev);
      actions++;
      const after = await actor.evaluate(() => window.__b5state);
      const bounds = await geometry(actor);
      if (after.phase === 'play') steady(baselines[S.turn], bounds, `${id} move ${actions}`);
      else {
        // The final score card grows in the panel, but neither board nor HUD
        // nor the live scoreboard may shift when match points arrive.
        // Final standings may scroll; the board and score strip stay put.
        const finalBounds = { ...bounds, scrollHeight: Math.min(bounds.scrollHeight, bounds.height) };
        steady(baselines[S.turn], finalBounds, id + ' final', ['.b5-playfield', '.b5-hud', '.bk-players']);
      }
      if (actions === 3) { initialPhase = bounds; await shot('playing'); }
    }
    const final = await host.evaluate(() => window.__b5state);
    assert.equal(final.phase, 'done', id + ': natural finish');
    assert(Object.values(final.scores).some(n => n > 0));
    await page.locator('#practiceTab1').click();
    await shot('final');
    // Finals may scroll. Also show the full standings and Rematch control,
    // instead of leaving the bottom ranks below the captured phone viewport.
    await host.locator('.bk-final').scrollIntoViewIfNeeded();
    await shot('final-scores');
    const old = final.instanceId;
    await host.locator('[data-rematch]').click();
    for (const f of frames) await f.waitForFunction(old => window.__b5state?.instanceId !== old && window.__b5state?.phase === 'play' && !window.__b5state.preparing, old);
    await host.locator('[data-resign]').click();
    await host.locator('[data-keep]').click();
    const fresh = await host.evaluate(() => window.__b5state);
    assert.equal(fresh.rev, 0, 'cancel resignation is inert');
    // End game goes through the real room menu on every rematch.
    await host.locator('#roomMenu > summary').click();
    await host.getByRole('button', { name: 'End game', exact: true }).click();
    await host.locator('#bEndConfirm').click();
    await host.waitForFunction(() => window.__b5state?.phase === 'done');
    await page.locator('#practiceStop').click();
    await page.waitForFunction(() => document.getElementById('practiceStatus').textContent === 'Practice ended');
    assert.deepEqual(errors, [], id + ': console errors');
    const row = { id, viewport, theme, passed: true, seats, actions, opening, initialPhase, scores: final.scores, naturalFinish: true, rematch: true, endGame: true, errors };
    rows.push(row); console.log(JSON.stringify({ id, viewport, theme, passed: true, seats, actions }));
  } catch (error) {
    await page.screenshot({ path: path.join(out, `${id}-${viewport.width}-${theme}-FAILED.png`), fullPage: true }).catch(() => {});
    rows.push({ id, viewport, theme, passed: false, actions, error: error.stack, errors });
    throw error;
  } finally { await context.close(); }
}

(async () => {
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir(), NODE_ENV: 'test',
    HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(scratch, 'reports.sqlite'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
  for (let n = 0; n < 200 && !logs.includes('PartyBox on'); n++) { assert(server.exitCode === null, logs); await wait(50); }
  assert(logs.includes('PartyBox on'), logs);
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  if (process.env.B5_REFERENCE_ONLY === '1') { await compareHeaders(`http://127.0.0.1:${port}`); return; }
  const viewports = process.env.B5_PHONE_ONLY ? [{ width: 390, height: 844 }] : [{ width: 390, height: 844 }, { width: 1280, height: 800 }];
  const themes = process.env.B5_DAY_ONLY ? ['day'] : ['day', 'night'];
  for (const viewport of viewports) for (const theme of themes) for (const id of selected) await play(`http://127.0.0.1:${port}`, id, viewport, theme);
  console.log(`NEW_GAMES_B5_BROWSER_PASS: ${rows.length} real practice matches; stable board, HUD, scores and controls`);
})().catch(error => { failure = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: !failure, failure, rows, physicalDevice: false, externalServices: false }, null, 2));
  console.log('B5 browser evidence: ' + out);
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([new Promise(r => server.once('exit', r)), wait(3000)]); }
  const resolvedOut = path.resolve(out);
  if (resolvedOut !== scratch && !resolvedOut.startsWith(scratch + path.sep)) fs.rmSync(scratch, { recursive: true, force: true });
});
