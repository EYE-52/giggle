'use strict';
/* Optional real-browser practice regression. Uses only a task-owned loopback
 * server/database and isolated browser contexts. No real media or accounts.
 * PRACTICE_ALL=1 covers entry, real minimum seats and readiness for all games;
 * it does not claim natural completion of every game. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const catalog = require('../games/registry').list();
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-practice-'));
const artifacts = process.env.PRACTICE_ARTIFACT_DIR || scratch;
fs.mkdirSync(artifacts, { recursive: true });
const rows = [];
const edgeResults = [];
let server, browser, port;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const frameFor = (page, number) => page.frames().find(frame => {
  try { return new URL(frame.url()).searchParams.get('seat') === String(number) && new URL(frame.url()).searchParams.has('practice'); } catch { return false; }
});

function observeErrors(page, allowedFailure) {
  const errors = [], expected = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const item = { text: message.text(), url: message.location().url };
    if (allowedFailure?.(item)) expected.push(item); else errors.push(item);
  });
  return { errors, expected };
}

async function customize(host, game, change) {
  await host.locator('#howtoCustom').click();
  await change();
  await host.locator('#dlgSave').click();
  await host.locator('#dlgSave').waitFor({ state: 'detached' });
  if (!await host.locator('#howtoGo').isVisible()) await host.locator(`[data-how="${game}"]`).first().click();
}

async function startGame(game, viewport) {
  const mobile = process.env.PRACTICE_MOBILE === '1';
  const context = await browser.newContext({ viewport, permissions: [], hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], socketTargets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('websocket', socket => socketTargets.push(socket.url()));
  // Observe the native decoded state path, including rt1 binary kart frames.
  // This callback records snapshots without changing messages or transport.
  await context.route('**/js/app.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    assert(source.includes("case 'state': {"), 'native state observer insertion point');
    await route.fulfill({ response, body: source.replace("case 'state': {", "case 'state': { window.__practiceObserve?.(msg);") });
  });
  await page.addInitScript(night => {
    localStorage.setItem('pb_name', 'Keep normal player');
    localStorage.setItem('seat1:pb_name', 'Keep legacy seat');
    sessionStorage.setItem('unrelated', 'Keep unrelated state');
    localStorage.setItem('pb_theme', night ? 'night' : 'day');
    localStorage.setItem('seat1:pb_theme', night ? 'day' : 'night');
    window.__practiceClosed = [];
    window.__practiceMessages = [];
    window.__practiceReadiness = [];
    window.__practiceObserve = message => {
      window.__practiceState = message;
      if (message.preparing !== window.__practiceLastPreparing) {
        window.__practiceReadiness.push({ event: message.preparing ? 'preparing' : 'playing', atMs: performance.now() });
        window.__practiceLastPreparing = message.preparing;
      }
    };
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.data?.t === 'giggle-practice-closed') window.__practiceClosed.push({ seat: event.data.seat, confirmed: event.data.confirmed });
    });
    const Native = WebSocket;
    window.WebSocket = class extends Native {
      send(data) {
        try { if (JSON.parse(data).t === 'game-ready') window.__practiceReadiness.push({ event: 'client-ready', atMs: performance.now() }); } catch { /* not JSON */ }
        return super.send(data);
      }
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          try {
            const message = JSON.parse(event.data);
            if (message.t === 'error') window.__practiceReadiness.push({ event: 'server-error', message: message.msg, atMs: performance.now() });
            window.__practiceMessages.push({ t: message.t, game: message.game || message.room?.game, phase: message.phase, preparing: message.preparing, error: message.t === 'error' ? message.msg : undefined });
            if (window.__practiceMessages.length > 12) window.__practiceMessages.shift();
          } catch { /* test-only observer, never changes transport */ }
        });
      }
    };
  }, process.env.PRACTICE_NIGHT === '1');
  try {
    await page.goto(`http://127.0.0.1:${port}/practice/?game=${game.id}`);
    await page.waitForFunction(() => !document.getElementById('practiceStart').disabled);
    assert.equal(await page.locator('#practiceGame').inputValue(), game.id);
    assert.equal(Number(await page.locator('#practiceCount').inputValue()), game.minPlayers);
    assert(await page.getByRole('heading', { name: 'Practice', exact: true }).isVisible());
    if (viewport.width >= 360) assert((await page.locator('.practice-bar').boundingBox()).height <= 56, 'setup keeps a single compact row');
    for (const selector of ['.practice-back', '#practiceLess', '#practiceCountLabel', '#practiceMore', '#practiceStart', '#practiceGuide summary']) {
      const box = await page.locator(selector).boundingBox();
      assert(box.width >= 44 && box.height >= 44, `${selector} keeps a44px target`);
    }
    const count = page.getByRole('spinbutton', { name: 'Players', exact: true });
    const maxSeats = Math.min(8, game.maxPlayers, game.seats || game.maxPlayers);
    assert.equal(await count.getAttribute('aria-valuemin'), String(game.minPlayers));
    assert.equal(await count.getAttribute('aria-valuemax'), String(maxSeats));
    assert(await page.locator('#practiceLess').isDisabled());
    if (game.minPlayers === maxSeats) {
      assert(await page.locator('#practiceMore').isDisabled());
      assert.equal(await count.getAttribute('aria-disabled'), 'true');
      assert.equal(await count.getAttribute('tabindex'), '-1');
    } else {
      await page.locator('#practiceMore').click();
      assert.equal(await count.getAttribute('aria-valuenow'), String(game.minPlayers + 1));
      await page.locator('#practiceLess').click();
      await count.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowUp');
      assert.equal(await count.getAttribute('aria-valuenow'), String(maxSeats));
      assert(await page.locator('#practiceMore').isDisabled());
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      assert.equal(await count.getAttribute('aria-valuenow'), String(game.minPlayers));
      assert(await page.locator('#practiceLess').isDisabled());
      await page.keyboard.press('ArrowRight');
      assert.equal(await count.getAttribute('aria-valuenow'), String(game.minPlayers + 1));
      await page.keyboard.press('ArrowLeft');
      assert.equal(await count.getAttribute('aria-valuenow'), String(game.minPlayers));
    }
    await page.locator('#practiceGuide summary').click();
    assert.equal(await page.locator('#practiceGuide').getAttribute('open'), '');
    assert(await page.locator('#practiceNote').isVisible());
    if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
    else await page.keyboard.press('Enter');
    assert.equal(await page.locator('#practiceGuide').getAttribute('open'), null);
    // Repeated submit cannot create two host rooms.
    await page.locator('#practiceStart').click();
    await page.evaluate(() => document.getElementById('practiceSetup').requestSubmit());
    await page.waitForFunction(n => document.getElementById('practiceStatus').textContent.startsWith(`${n} seats ready`), game.minPlayers, { timeout: 20000 });
    assert.equal(await page.locator('#practiceTable > .practice-seat').count(), game.minPlayers);
    const frames = Array.from({ length: game.minPlayers }, (_, n) => frameFor(page, n + 1));
    assert(frames.every(Boolean));
    for (const frame of frames) assert.equal(await frame.frameElement().then(element => element.getAttribute('allow')), "camera 'none'; microphone 'none'; autoplay; fullscreen");
    const host = frames[0];
    assert.equal(await host.evaluate(() => document.documentElement.dataset.theme || 'day'), process.env.PRACTICE_NIGHT === '1' ? 'night' : 'day', 'practice inherits its parent theme rather than a legacy test seat theme');
    // Same origin is not sufficient authority: a sibling practice seat or
    // a forged parent report must not close or replace the selected seat.
    if (game.id === 'trivia') {
      const session = new URL(host.url()).searchParams.get('practice');
      const before = await page.locator('#practiceStatus').textContent();
      await page.evaluate(session => {
        window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data: { t: 'giggle-practice-state', session, seat: 1, connected: false } }));
        frames[0].postMessage(null, location.origin);
        frames[0].postMessage({ t: 'giggle-practice-close', session: 'wrong' }, location.origin);
      }, session);
      await frames[1].evaluate(session => parent.frames[0].postMessage({ t: 'giggle-practice-close', session }, location.origin), session);
      await wait(100);
      assert.equal(await page.locator('#practiceStatus').textContent(), before);
    }
    if (game.id === 'trivia') await customize(host, game.id, () => host.locator('#df-trivia-rounds').fill('1'));
    if (game.id === 'word-chain') await customize(host, game.id, async () => {
      await host.locator('#df-word-chain-lives').fill('3');
      await host.locator('#df-word-chain-turnSeconds').fill('60');
    });
    let timerConfigured = false;
    if (game.id === 'pocket-karts') {
      await customize(host, game.id, async () => {
        // Keep the driving assertions on one explicit, normal classic arena.
        await host.getByRole('radio', { name: /^Rookie Ring, classic,/ }).click();
        const rounds = host.getByRole('radiogroup', { name: 'Round length', exact: true });
        assert.deepEqual(await rounds.getByRole('radio').allTextContents(), ['1 min', '2 min', '3 min', '5 min', '10 min', '15 min']);
        await rounds.getByRole('radio', { name: '5 min', exact: true }).click();
      });
      await customize(host, game.id, async () => {
        const rounds = host.getByRole('radiogroup', { name: 'Round length', exact: true });
        assert.equal(await rounds.getByRole('radio', { name: '5 min', exact: true }).getAttribute('aria-checked'), 'true');
        await rounds.getByRole('radio', { name: '1 min', exact: true }).click();
      });
      timerConfigured = true;
    }
    await host.locator('#howtoGo:not([disabled])').click();
    for (const frame of frames) await frame.waitForFunction(() => {
      const body = document.getElementById('gbody');
      return body && body.children.length > 0 && body.getAttribute('aria-busy') === 'false';
    }, null, { timeout: 20000 });
    for (let n = 1; n <= frames.length; n++) {
      await page.locator(`#practiceTab${n}`).click();
      await frames[n - 1].locator('#gbody').waitFor({ state: 'visible' });
      assert.equal(await frames[n - 1].evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${game.id} seat${n}: horizontal overflow`);
    }
    await page.locator('#practiceTab1').press('ArrowRight');
    assert.equal(await page.locator('#practiceTab2').getAttribute('aria-selected'), 'true');
    await page.locator('#practiceTab2').press('Home');
    assert.equal(await page.locator('#practiceTab1').getAttribute('aria-selected'), 'true');
    await page.locator('#practiceAll').click();
    assert.equal(await page.locator('#practiceTable').evaluate(el => el.classList.contains('is-all')), true);
    assert.equal(await page.locator('.practice-seat[inert]').count(), 0);
    await page.locator('#practiceAll').click();
    assert.equal(await page.locator('.practice-seat[inert]').count(), frames.length - 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'practice chrome does not overflow');
    let naturalCompletion = false, rematch = false, statusGeometry = null;
    if (game.id === 'trivia') {
      // Real actions from both seats reach the same reveal, without knowing
      // the answer or forcing the server into an end state.
      for (let n = 1; n <= frames.length; n++) {
        await page.locator(`#practiceTab${n}`).click();
        await frames[n - 1].locator('#gbody [data-p]:not([disabled])').first().click();
      }
      for (const frame of frames) await frame.locator('[data-game="trivia"][data-phase="reveal"]').waitFor({ state: 'attached' });
      await page.locator('#practiceTab1').click();
      await host.locator('#tNext').click();
      for (const frame of frames) await frame.locator('[data-game="trivia"][data-phase="done"]').waitFor({ state: 'attached' });
      naturalCompletion = true;
    }
    if (game.id === 'four-in-a-row') {
      for (const [move, col] of [0, 6, 1, 6, 2, 5, 3].entries()) {
        const n = move % 2;
        await page.locator(`#practiceTab${n + 1}`).click();
        await frames[n].locator(`[data-column="${col}"][aria-disabled="false"]`).click();
        for (const frame of frames) await frame.waitForFunction(rev => window.__practiceState?.rev >= rev, move + 1);
      }
      for (const frame of frames) await frame.waitForFunction(() => window.__practiceState?.phase === 'done');
      const outcome = await host.evaluate(() => ({ result: window.__practiceState.result, scores: window.__practiceState.scores }));
      assert.equal(outcome.result.reason, 'four'); assert.equal(outcome.result.winner, 1);
      assert.equal(outcome.scores[outcome.result.winnerPid], 300);
      naturalCompletion = true;
      await page.locator('#practiceTab1').click();
      await host.locator('#bRematch:not([disabled])').click();
      for (const frame of frames) await frame.waitForFunction(() => window.__practiceState?.phase === 'play' && window.__practiceState.rev === 0);
      rematch = true;
    }
    if (game.id === 'word-chain') {
      let active = -1;
      for (let n = 0; n < frames.length; n++) {
        if (await frames[n].evaluate(() => {
          const s = window.__practiceState; return s && s.turnPid === (s.me || s.you);
        })) active = n;
      }
      assert(active >= 0, 'a real Word Chain seat owns this turn');
      const frame = frames[active];
      await page.locator(`#practiceTab${active + 1}`).click();
      const bounds = async () => frame.evaluate(() => Object.fromEntries(['#gbody', '.wc-target', '#wcChallenge'].map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return [selector, { x: r.x, y: r.y, width: r.width, height: r.height }];
      })));
      const settle = () => frame.evaluate(async () => {
        await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await settle();
      const before = await bounds();
      await frame.locator('#wcWord').fill('zzqwxzz');
      await frame.locator('#wcGo').click();
      await frame.waitForFunction(() => window.__practiceState?.myFeedback?.code === 'dictionary');
      await frame.waitForFunction(() => !!document.getElementById('wcFeedback')?.textContent.trim());
      await settle();
      const feedback = await bounds();
      const turn = await frame.evaluate(() => window.__practiceState.turnNo);
      // A legal empty-word action costs one of the configured three lives and
      // advances the actual Room, rather than injecting a view-only status.
      await frame.locator('#wcWord').fill('');
      await frame.locator('#wcGo').click();
      await frame.waitForFunction(turn => window.__practiceState?.turnNo > turn, turn);
      await settle();
      const nextTurn = await bounds();
      for (const [label, after] of [['dictionary feedback', feedback], ['turn notice', nextTurn]]) {
        for (const selector of Object.keys(before)) for (const key of Object.keys(before[selector])) {
          assert(Math.abs(after[selector][key] - before[selector][key]) < 1, `full shell ${label} moved ${selector}.${key}: ${before[selector][key]} -> ${after[selector][key]}`);
        }
      }
      statusGeometry = { passed: true, before, feedback, nextTurn, authority: 'actual Room actions and snapshots' };
      await page.screenshot({ path: path.join(artifacts, `word-chain-status-${viewport.width}.png`) });
    }
    if (timerConfigured) assert.equal(await host.evaluate(() => window.__practiceState.roundMs), 60000, 'real server acknowledged the selected1-minute kart timer');
    let drivingChecked = false, touchDrivingChecked = false;
    if (timerConfigured) {
      for (const [index, frame] of frames.entries()) {
        await page.locator(`#practiceTab${index + 1}`).click();
        assert.equal(await frame.locator('.pk-stage canvas, .pke-stage canvas').evaluate(canvas => !!canvas.getContext('webgl2')), true, 'each selected practice kart has a real WebGL2 renderer');
        await frame.waitForFunction(() => window.__practiceState?.phase === 'drive');
      }
      await page.locator('#practiceTab1').click();
      const start = await host.evaluate(() => {
        const s = window.__practiceState, k = s.karts.find(k => k.pid === s.you); return { x: k.x, z: k.z };
      });
      // Exercise the visible drive stick; touch layouts hide the legacy gas key.
      const touchSession = mobile ? await context.newCDPSession(page) : null;
      let touchStarted = false;
      try {
        if (touchSession) {
          const stick = host.locator('#pk-stick');
          await stick.scrollIntoViewIfNeeded();
          const box = await stick.boundingBox();
          assert(box && box.width >= 44 && box.height >= 44, 'touch drive stick is a usable target');
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height * .15, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
          touchStarted = true;
        } else {
          await host.locator('.pk-stage canvas, .pke-stage canvas').click();
          await page.keyboard.down('ArrowUp');
        }
        await host.waitForFunction(start => {
          const s = window.__practiceState, k = s.karts.find(k => k.pid === s.you); return Math.hypot(k.x - start.x, k.z - start.z) > .15;
        }, start);
        await page.locator('#practiceTab2').click();
        // The seat switch must release held input before the physical key or
        // touch is released. Interval polling also observes the now-inert frame.
        await host.waitForFunction(() => {
          const s = window.__practiceState, k = s.karts.find(k => k.pid === s.you); return k.motionIntent?.throttle === 0;
        }, null, { polling: 50 });
        touchDrivingChecked = mobile;
      } finally {
        if (touchSession) {
          if (touchStarted) await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
          await touchSession.detach();
        } else await page.keyboard.up('ArrowUp');
      }
      drivingChecked = true;
    }
    const readiness = [];
    for (const frame of frames) readiness.push(await frame.evaluate(() => window.__practiceReadiness));
    await page.locator('#practiceTab1').click();
    // The selected frame must keep a real viewport and own the visible hit
    // surface; DOM readiness alone missed a zero-viewport frame regression.
    assert.equal(await page.locator('#practiceSeat1 iframe').evaluate(frame => {
      const box = frame.getBoundingClientRect();
      return box.width >= 300 && box.height >= 250 && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === frame;
    }), true, `${game.id}: selected frame is the real visible surface`);
    await host.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (['trivia', 'chess', 'pocket-karts'].includes(game.id)) await page.screenshot({ path: path.join(artifacts, `${game.id}-${viewport.width}.png`) });
    if (mobile) {
      await page.locator('#practiceTab2').tap();
      assert.equal(await page.locator('#practiceTab2').getAttribute('aria-selected'), 'true');
      await page.locator('#practiceTab1').tap();
      await page.setViewportSize({ width: 667, height: 375 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'landscape chrome fits');
      assert.equal(await page.locator('#practiceSeat1 iframe').evaluate(frame => frame.getBoundingClientRect().height >= 250), true, 'landscape keeps a usable game surface');
      await page.screenshot({ path: path.join(artifacts, `${game.id}-landscape.png`) });
      await page.setViewportSize(viewport);
    }
    // Reload the current, consumed URL, not the original ?game= create URL.
    if (game.id === 'trivia') {
      const before = await host.evaluate(async () => { const { store } = await import('/js/util.js'); return store.get('pb_room'); });
      await page.locator('#practiceReload').click();
      await page.waitForFunction(n => new RegExp(`^${n} seats (ready|connected)`).test(document.getElementById('practiceStatus').textContent), game.minPlayers);
      const reloaded = frameFor(page, 1);
      await reloaded.locator('#gbody').waitFor();
      const after = await reloaded.evaluate(async () => { const { store } = await import('/js/util.js'); return store.get('pb_room'); });
      assert.equal(after, before, 'reload resumes the same room rather than creating a second one');
    }
    await page.locator('#practiceStop').click();
    await page.waitForFunction(() => document.getElementById('practiceStatus').textContent === 'Practice ended');
    assert.equal(await page.evaluate(() => window.__practiceClosed.length), frames.length);
    assert.equal(await page.evaluate(() => window.__practiceClosed.every(seat => seat.confirmed === true)), true, 'each seat received the server Leave acknowledgement');
    await wait(100); // late home reconnect callbacks must not resurrect seat storage
    assert.equal(await page.locator('iframe').count(), 0);
    const preserved = await page.evaluate(() => [localStorage.getItem('pb_name'), localStorage.getItem('seat1:pb_name'), sessionStorage.getItem('unrelated'), Object.keys(sessionStorage).filter(key => key.startsWith('practice:')).map(key => key.split(':').slice(-1)[0].replace(/^pb_token_.*/, 'pb_token_<fixture-room>'))]);
    assert.deepEqual(preserved, ['Keep normal player', 'Keep legacy seat', 'Keep unrelated state', []]);
    assert(socketTargets.every(target => new URL(target).host === `127.0.0.1:${port}`));
    assert.deepEqual(errors, [], `${game.id}: browser errors`);
    const result = { game: game.id, viewport, passed: true, realSeats: frames.length, allSeatsReady: true, seatSwitching: true, cleanup: true, naturalCompletion, rematch, statusGeometry, timerConfigured, drivingChecked, touchDrivingChecked, readiness, errors };
    rows.push(result); console.log(JSON.stringify(result));
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `FAILED-${game.id}-${viewport.width}.png`), fullPage: true }).catch(() => {});
    const diagnostics = [];
    for (let n = 1; n <= game.minPlayers; n++) {
      const frame = frameFor(page, n);
      if (frame) diagnostics.push(await frame.evaluate(() => ({ messages: window.__practiceMessages, readiness: window.__practiceReadiness, busy: document.getElementById('gbody')?.getAttribute('aria-busy'), text: document.getElementById('gbody')?.textContent.slice(0, 300), stages: document.querySelectorAll('.pk-stage').length, canvases: [...document.querySelectorAll('canvas')].map(canvas => ({ parent: canvas.parentElement?.className, width: canvas.width, height: canvas.height })) })).catch(() => ({ unavailable: true })));
    }
    const result = { game: game.id, viewport, passed: false, error: error.stack, errors, diagnostics };
    rows.push(result); console.log(JSON.stringify(result)); throw error;
  } finally { await context.close(); }
}

async function edgeCases() {
  // Explicit HTTP failure and recovery use only this isolated browser route.
  {
    // This width catches a Retry/Help overlap between phone and desktop bars.
    const context = await browser.newContext({ permissions: [], viewport: { width: 481, height: 844 }, hasTouch: true });
    const page = await context.newPage(); const targets = [];
    const { errors, expected } = observeErrors(page, item => /\/config\.json$/.test(item.url) && /^Failed to load resource:.*503/.test(item.text));
    page.on('websocket', socket => targets.push(socket.url()));
    await page.route('**/config.json', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
    await page.goto(`http://127.0.0.1:${port}/practice/`);
    await page.getByRole('heading', { name: 'Can’t reach the games' }).waitFor();
    assert(await page.locator('#practiceStart').isDisabled());
    assert.equal(await page.locator('.loading-mark').count(), 0);
    assert.equal(targets.length, 0, 'failed config never dials a socket');
    await page.unroute('**/config.json'); await page.locator('#practiceRetry').click();
    await page.waitForFunction(() => !document.getElementById('practiceStart').disabled);
    assert.equal(await page.locator('iframe').count(), 0, 'catalog retries do not create rooms');
    assert.deepEqual(errors, []);
    // The early telemetry request can fail before Practice's own config fetch.
    assert(expected.length >= 1 && expected.length <= 2);
    edgeResults.push({ case: 'config failure and explicit retry', passed: true, expectedHttp503: true });
    await context.close();
  }
  {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage(); const { errors } = observeErrors(page);
    await page.routeWebSocket(`ws://127.0.0.1:${port}/`, socket => socket.onMessage(message => {
      if (JSON.parse(message).t === 'games') socket.send(JSON.stringify({ t: 'games', games: [] }));
    }));
    await page.goto(`http://127.0.0.1:${port}/practice/`);
    await page.getByRole('heading', { name: 'No games right now' }).waitFor();
    assert(await page.locator('#practiceStart').isDisabled());
    assert.equal(await page.locator('iframe').count(), 0); assert.deepEqual(errors, []);
    edgeResults.push({ case: 'valid empty catalog', passed: true, catalogAdapter: 'isolated test-only WebSocket' }); await context.close();
  }
  {
    const context = await browser.newContext({ permissions: [] });
    await context.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('Test-only blocked storage', 'QuotaExceededError'); }; });
    const page = await context.newPage(); const { errors } = observeErrors(page);
    await page.goto(`http://127.0.0.1:${port}/practice/`);
    await page.waitForFunction(() => !document.getElementById('practiceStart').disabled);
    await page.locator('#practiceStart').click();
    await page.getByRole('heading', { name: 'Can’t open separate seats' }).waitFor();
    assert.equal(await page.locator('iframe').count(), 0); assert.deepEqual(errors, []);
    edgeResults.push({ case: 'blocked session storage', passed: true, storageAdapter: 'isolated test-only browser context' }); await context.close();
  }
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const context = await browser.newContext({ reducedMotion, permissions: [] });
    const page = await context.newPage();
    const { errors, expected } = observeErrors(page, item => /\/js\/app\.js$/.test(item.url) && /^Failed to load resource: net::ERR_FAILED$/.test(item.text));
    await page.clock.install();
    await page.route('**/js/app.js', route => route.abort());
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    const logo = page.locator('.boot-view--table .loading-mark.loading-logo');
    assert(await logo.isVisible(), 'the pending loader shows the shared Giggle logo');
    const animation = await logo.locator('i').first().evaluate(element => getComputedStyle(element).animationName);
    assert.equal(animation, 'none', 'the shared logo loader is still in both motion modes');
    await page.screenshot({ path: path.join(artifacts, `loader-pending-${reducedMotion}.png`) });
    await page.clock.fastForward(13000);
    await page.getByRole('heading', { name: 'Taking longer than expected' }).waitFor();
    assert.equal(await page.locator('.boot-view').getAttribute('aria-busy'), 'false');
    assert(await page.locator('.loading-mark').isHidden());
    assert(await page.getByRole('link', { name: 'Reload', exact: true }).isVisible());
    assert.deepEqual(errors, []); assert.equal(expected.length, 1);
    await page.screenshot({ path: path.join(artifacts, `loader-error-${reducedMotion}.png`) });
    edgeResults.push({ case: 'module-load timeout', reducedMotion, passed: true, expectedAppModuleNetworkAbort: true, clock: 'isolated browser clock' });
    await context.close();
  }
  console.log(JSON.stringify({ edgeResults }));
}

(async () => {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, ['server/server.js'], { cwd: root, env: {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir(), NODE_ENV: 'test',
    HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(scratch, 'reports.sqlite'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  for (let n = 0; n < 200 && !logs.includes('PartyBox on'); n++) { if (server.exitCode !== null) throw new Error('Local fixture exited'); await wait(50); }
  assert(logs.includes('PartyBox on'), 'local fixture startup');
  browser = await chromium.launch({ executablePath: process.env.PRACTICE_BROWSER || undefined, headless: true,
    args: process.env.PRACTICE_BROWSER ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader'] });
  const selected = process.env.PRACTICE_GAMES ? process.env.PRACTICE_GAMES.split(',') : ['trivia', 'chess', 'pocket-karts'];
  const games = process.env.PRACTICE_ALL === '1' ? catalog : selected.map(id => catalog.find(game => game.id === id));
  assert(games.every(Boolean));
  const viewport = process.env.PRACTICE_MOBILE === '1' ? { width: 375, height: 667 } : { width: 1280, height: 900 };
  for (const game of games) {
    try { await startGame(game, viewport); }
    catch (error) { if (process.env.PRACTICE_ALL !== '1') throw error; }
  }
  if (process.env.PRACTICE_SKIP_EDGES !== '1') await edgeCases();
  assert(rows.every(row => row.passed), 'one or more game entries failed; see preserved per-game evidence');
  console.log(`PRACTICE_BROWSER_PASS: ${rows.length} game entries, real seats, readiness, switching and cleanup`);
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(artifacts, 'practice-browser-results.json'), JSON.stringify({ at: new Date().toISOString(), rows, edgeResults, realMedia: false, externalServices: false }, null, 2) + '\n');
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([new Promise(resolve => server.once('exit', resolve)), wait(3000)]); }
});
