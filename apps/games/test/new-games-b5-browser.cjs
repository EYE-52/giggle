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
    const intersects = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const utilities = [...document.querySelectorAll('#roomMenu > summary, .game-report-icon, .game-screen-toggle')]
      .filter(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    const headerOverlaps = [];
    const walker = document.createTreeWalker(document.querySelector('.bk-game'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!node.textContent.trim() || !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const visible = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
        // Text hidden by an ellipsis or a scrolling panel is not visible.
        for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
            visible.left = Math.max(visible.left, clip.left);
            visible.right = Math.min(visible.right, clip.right);
          }
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
            visible.top = Math.max(visible.top, clip.top);
            visible.bottom = Math.min(visible.bottom, clip.bottom);
          }
        }
        if (visible.right <= visible.left || visible.bottom <= visible.top) continue;
        for (const utility of utilities) {
          if (intersects(utility.getBoundingClientRect(), visible)) {
            headerOverlaps.push({ utility: utility.id || utility.className, text: node.textContent.trim() });
          }
        }
      }
    }
    return { rects, headerOverlaps, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, scrollY,
      controls: [...document.querySelectorAll('.b5-game button, .b5-game summary')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(el => {
        const r = el.getBoundingClientRect(); return { text: el.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      }) };
  });
}

function steady(before, after, label, keys = Object.keys(before.rects)) {
  assert(after.scrollWidth <= after.width + 1, label + ': horizontal overflow');
  assert.deepEqual(after.headerOverlaps, [], label + ': floating utilities cover visible text');
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

async function checkMegaBoards(frame) {
  const boards = await frame.evaluate(() => {
    const S = window.__b5state;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgb = color => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = color => rgb(color).map(v => {
      const s = v / 255;
      return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const family = rgb(getComputedStyle(document.querySelector('.mt-game')).getPropertyValue('--fam'));
    return [...document.querySelectorAll('.mt-small')].map((el, index) => {
      const cell = getComputedStyle(el.querySelector('.mt-cell'));
      const rim = getComputedStyle(el.querySelector('.mt-rim'));
      const trophy = el.querySelector('.mt-trophy');
      const winner = S.small[index];
      return {
        index, winner, open: el.classList.contains('is-open'), blocked: el.classList.contains('is-blocked'),
        expectedOpen: !winner && S.phase === 'play' && (S.forced < 0 || S.forced === index),
        opacity: Number(getComputedStyle(el).opacity), fill: luminance(cell.fill),
        familyRim: JSON.stringify(rgb(rim.stroke)) === JSON.stringify(family), rimWidth: Number.parseFloat(rim.strokeWidth),
        glow: rim.filter !== 'none',
        trophySide: trophy?.classList.contains('mt-x') ? 1 : trophy?.classList.contains('mt-o') ? 2 : null,
        trophyWidth: trophy?.getBBox().width || 0,
        trophyStroke: trophy ? Number.parseFloat(getComputedStyle(trophy).strokeWidth) : 0,
        boardWidth: el.querySelector('.mt-rim').getBBox().width,
      };
    });
  });
  assert.equal(boards.length, 9, 'Mega: all nine small boards are present');
  for (const board of boards) {
    assert.equal(board.open, board.expectedOpen, `Mega board ${board.index}: playable highlight follows the rules`);
    if (board.open) {
      assert(board.familyRim && board.rimWidth >= 8, 'Mega: playable board has a thick family-colour rim');
      assert.equal(board.opacity, 1, 'Mega: playable board stays bright');
    } else if (!board.winner) {
      assert(board.blocked && board.opacity <= .5, 'Mega: unplayable board is dimmed');
    }
    if (board.winner === 1 || board.winner === 2) {
      assert.equal(board.trophySide, board.winner, 'Mega: won board shows its winning X or O');
      assert(board.trophyWidth >= board.boardWidth * .65 && board.trophyStroke >= 20,
        'Mega: winning mark spans most of the small board');
      assert.equal(board.opacity, 1, 'Mega: the winning mark is not dimmed');
    }
  }
  const open = boards.find(b => b.open), blocked = boards.find(b => b.blocked);
  if (open && blocked) assert(open.fill - blocked.fill >= .15, 'Mega: playable cell fill is clearly lighter than blocked cells');
  return { open: boards.filter(b => b.open).length, winners: boards.filter(b => b.winner === 1 || b.winner === 2).map(b => b.winner) };
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
  const mega = { freeBoards: false, forcedBoard: false, wonX: false, wonO: false };
  const sidebarWidths = [];
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
    if (viewport.width === 800) {
      // Exercise both the sidebar breakpoint and wider board columns. These
      // widths used to hide HUD labels beneath the floating utility row.
      for (const width of [760, 960, 1024]) {
        await page.setViewportSize({ width, height: viewport.height });
        await wait(80);
        const layout = await geometry(host);
        steady(layout, layout, `${id} sidebar at ${width}px`);
        sidebarWidths.push(width);
      }
      await page.setViewportSize(viewport);
      await wait(80);
      steady(opening, await geometry(host), id + ' restored 800px layout');
    }
    if (id === 'mega-tic-tac-toe') {
      assert.equal((await checkMegaBoards(host)).open, 9, 'Mega: opening offers all nine boards');
      mega.freeBoards = true;
    }
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
      if (id === 'mega-tic-tac-toe') {
        const state = await checkMegaBoards(actor);
        if (state.open === 1 && !mega.forcedBoard) { await shot('forced-board'); mega.forcedBoard = true; }
        for (const [side, key] of [[1, 'wonX'], [2, 'wonO']]) {
          if (state.winners.includes(side) && !mega[key]) { await shot(`won-${side === 1 ? 'x' : 'o'}`); mega[key] = true; }
        }
      }
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
    if (id === 'mega-tic-tac-toe') assert.deepEqual(mega, { freeBoards: true, forcedBoard: true, wonX: true, wonO: true }, 'Mega: browser match covers free, forced and won X/O boards');
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
    const row = { id, viewport, theme, passed: true, seats, actions, opening, initialPhase, sidebarWidths, ...(id === 'mega-tic-tac-toe' ? { mega } : {}), scores: final.scores, naturalFinish: true, rematch: true, endGame: true, errors };
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
  const viewports = process.env.B5_VIEWPORTS ? process.env.B5_VIEWPORTS.split(',').map(size => {
    const [width, height] = size.split('x').map(Number);
    assert(width > 0 && height > 0, 'Invalid B5_VIEWPORTS size');
    return { width, height };
  }) : process.env.B5_PHONE_ONLY ? [{ width: 390, height: 844 }] : [
    { width: 390, height: 844 }, { width: 800, height: 600 }, { width: 1280, height: 800 },
  ];
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
