'use strict';
// Real app, Room, WebSockets and native clicks. In particular, a button
// below the iframe must not make native focus scroll Ludo's board away.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

function observePlayfield() {
  window.stability = { moves: [], padShifts: [], samples: 0 };
  const previous = new Map();
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      const sources = entry.sources.filter(({ node }) => node?.isConnected !== false &&
        (node?.id === 'rPad' || node?.parentElement?.closest?.('#rPad') || node?.closest?.('#rPad')));
      if (sources.length) window.stability.padShifts.push({ value: entry.value, sources: sources.map(s => s.node?.nodeName) });
    }
  });
  observer.observe({ type: 'layout-shift' });
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    window.stability.samples++;
    for (const selector of ['.ld-stage', '.ld-board']) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const r = node.getBoundingClientRect(), rect = [r.x, r.y, r.width, r.height], old = previous.get(selector);
      if (old && Math.max(...rect.map((v, i) => Math.abs(v - old[i]))) > 1) {
        window.stability.moves.push({ selector, before: old, after: rect, scrollY });
      }
      previous.set(selector, rect);
    }
    requestAnimationFrame(tick);
  };
  tick();
  window.finishStability = () => { stopped = true; observer.disconnect(); return window.stability; };
}

async function run() {
  const out = process.env.STABILITY_EVIDENCE_DIR || '/tmp/codex-sweep-followup-shots';
  fs.mkdirSync(out, { recursive: true });
  let child, browser, base = process.env.STABILITY_PRACTICE_URL;
  const report = [];
  try {
    if (!base) {
      const net = require('node:net'), reserve = net.createServer();
      await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
      const port = reserve.address().port;
      await new Promise(resolve => reserve.close(resolve));
      base = 'http://127.0.0.1:' + port;
      child = spawn(process.execPath, ['server/server.js'], {
        cwd: path.resolve(__dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(out, 'reports.sqlite') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('practice server did not start')), 10000);
        child.stdout.on('data', data => { if (String(data).includes('PartyBox on')) { clearTimeout(timeout); resolve(); } });
        child.once('error', reject);
      });
    }
    browser = await chromium.launch({ channel: 'chromium' });
    for (const width of [1280, 390]) for (const theme of ['day', 'night']) {
      if (process.env.STABILITY_WIDTH && width !== Number(process.env.STABILITY_WIDTH)) continue;
      for (const [game, count] of [['ludo', 2], ['ludo', 4], ['reaction-tap', 2]]) {
        if (process.env.STABILITY_GAME && game !== process.env.STABILITY_GAME) continue;
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 }, isMobile: width === 390, hasTouch: width === 390 });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(theme => {
          localStorage.setItem('pb_theme', theme);
          const Native = WebSocket;
          window.WebSocket = class extends Native {
            constructor(...args) {
              super(...args);
              this.addEventListener('message', event => { try { const message = JSON.parse(event.data); if (message.t === 'state') window.practiceState = message; } catch {} });
            }
          };
        }, theme);
        await page.goto(base + '/practice/?game=' + game);
        await page.waitForFunction(() => !document.querySelector('#practiceStart').disabled);
        await page.locator('#practiceCount').selectOption(String(count));
        await page.evaluate(() => document.querySelector('#practiceSetup').requestSubmit());
        await page.waitForFunction(count => document.querySelector('#practiceStatus').textContent.startsWith(count + ' seats ready'), count);
        const seats = page.frames().filter(frame => new URL(frame.url()).searchParams.has('practice'));
        const host = seats.find(frame => new URL(frame.url()).searchParams.get('seat') === '1');
        await host.locator('#howtoGo').click();
        for (const frame of seats) {
          await frame.waitForSelector(game === 'ludo' ? '.ld-board' : '#rPad');
          await frame.waitForFunction(() => window.practiceState && !window.practiceState.preparing);
          await frame.evaluate(async () => { await document.fonts.ready; });
          await frame.evaluate(observePlayfield);
        }
        if (game === 'ludo') {
          // Four iframe joins can arrive in a different order from their
          // tabs. Follow the server's private seat projection, not tab N.
          const bySide = new Map(await Promise.all(seats.map(async frame => [await frame.evaluate(() => window.practiceState.youAre), frame])));
          for (let i = 0; i < 16; i++) {
            const state = await host.evaluate(() => window.practiceState);
            const active = bySide.get(state.turn), seat = new URL(active.url()).searchParams.get('seat');
            await page.locator('#practiceTab' + seat).click();
            await active.locator(state.phase === 'roll' ? '[data-roll]' : '.ld-choices .is-legal').first().click();
            await host.waitForFunction(rev => window.practiceState.rev > rev, state.rev);
            await page.waitForTimeout(800);
          }
        } else {
          for (let round = 0; round < 2; round++) {
            await page.locator('#practiceTab1').click();
            await host.waitForFunction(() => window.practiceState.phase === 'go');
            await page.screenshot({ path: path.join(out, `practice-${width}-${theme}-${game}-go.png`) });
            await host.locator('#rPad').click();
            await page.waitForTimeout(100);
            await page.screenshot({ path: path.join(out, `practice-${width}-${theme}-${game}-locked.png`) });
            await page.locator('#practiceTab2').click();
            await seats.find(frame => new URL(frame.url()).searchParams.get('seat') === '2').locator('#rPad').click();
            await host.waitForFunction(() => window.practiceState.phase === 'roundEnd');
            if (!round) { await page.locator('#practiceTab1').click(); await host.locator('#rNext').click(); }
          }
        }
        await page.locator('#practiceTab1').click();
        await page.screenshot({ path: path.join(out, `practice-${width}-${theme}-${game}-${count}.png`) });
        const observations = [];
        for (const frame of seats) {
          observations.push(await frame.evaluate(() => {
            const status=document.querySelector('.ld-game .bk-status');
            return { ...window.finishStability(), scrollY, viewport: innerHeight, pageHeight: document.documentElement.scrollHeight,
              statusHeight:status?.getBoundingClientRect().height, statusOverflow:status?status.scrollHeight-status.clientHeight:0 };
          }));
        }
        report.push({ width, theme, game, count, observations });
        fs.writeFileSync(path.join(out, 'practice-summary.json'), JSON.stringify(report, null, 2));
        assert.deepEqual(errors, []);
        for (const observation of observations) {
          assert.deepEqual(observation.moves, [], game + ' board stays still during real clicks and animations');
          assert.deepEqual(observation.padShifts, [], game + ' pad has no layout-shift sources');
          if (game === 'ludo' && width === 390) {
            assert.equal(observation.scrollY, 0, 'Roll/pawn focus never scrolls the phone document');
            assert(observation.pageHeight <= observation.viewport + 1, 'phone Ludo fits its real iframe');
            assert.equal(observation.statusHeight, 88, 'Ludo turn card has room for the move and its hint');
            assert(observation.statusOverflow<=1, 'ordinary turn text fits without clipping');
          }
        }
        console.log('STABILITY_PRACTICE_CASE', width, theme, game, count, 'PASS');
        await context.close();
      }
    }
    console.log('STABILITY_PRACTICE_PASS', report.length);
  } finally { await browser?.close(); child?.kill(); }
}

module.exports = { observePlayfield };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
