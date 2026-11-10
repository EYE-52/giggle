'use strict';
// Real practice rooms and native inputs. Run against PORT=8241 node server/server.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.QA_URL || 'http://localhost:8241';
const out = process.env.QA_EVIDENCE || '/private/tmp/qa58-layout-evidence';
const bounds = node => node.getBoundingClientRect().toJSON();
async function start(browser, game, width) {
 const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
 const page = await context.newPage();
 await page.goto(`${base}/practice/?game=${game}`);
 await page.waitForFunction(() => !document.querySelector('#practiceStart').disabled);
 await page.locator('#practiceStart').click();
 await page.waitForFunction(() => /seats ready/.test(document.querySelector('#practiceStatus').textContent));
 const seats = page.frames().filter(f => new URL(f.url()).searchParams.has('seat'));
 const host = seats.find(f => new URL(f.url()).searchParams.get('seat') === '1');
 await host.locator('#howtoGo').click();
 await host.waitForSelector('#gbody > *');
 await page.waitForTimeout(600);
 await host.evaluate(() => document.fonts.ready);
 return { context, page, seats, host };
}
async function shot(run, game, width, state) {
 await run.page.screenshot({ path: path.join(out, `${game}-${width}-${state}.png`) });
}
async function main() {
 fs.mkdirSync(out, { recursive: true });
 const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
 const results = [];
 try {
  for (const width of [1440, 390]) {
   for (const game of ['emoji-spotter', 'odd-one-out', 'whisper', 'clue-grid', 'undercover', 'letter-lock', 'sketchy-impostor', 'draw-off']) {
    const run = await start(browser, game, width);
    try {
     const metrics = await run.host.evaluate(() => {
      const rect = s => document.querySelector(s)?.getBoundingClientRect().toJSON();
      return { height: innerHeight, root: rect('#gbody'), players: rect('.pl-live'), helper: rect('.wp-status, .b2-status'), action: rect('.wp-primary, .b2-primary'), paper: rect('.si-canvas, .do-canvas'), label: rect('.si-page-label'), tiles: [...document.querySelectorAll('.ll-row')].map(n => n.getBoundingClientRect().toJSON()), lock: rect('.ll-lock') };
     });
     assert(metrics.players && metrics.players.bottom <= metrics.root.bottom + 1, `${game} ${width}: complete roster fits`);
     if (metrics.helper && metrics.action) assert(metrics.helper.bottom <= metrics.action.top + 1, `${game} ${width}: helper clears primary`);
     if (metrics.paper) {
      assert(metrics.paper.width >= 180, `${game} ${width}: usable paper`);
      if (metrics.label) assert(metrics.label.bottom <= metrics.paper.top, `${game} ${width}: label clears paper`);
     }
     if (metrics.tiles.length) assert(metrics.tiles.at(-1).bottom <= metrics.lock.bottom, `${game} ${width}: all six letter rows fit`);
     await shot(run, game, width, 'checked');
     results.push({ game, width, ...metrics });
    } finally { await run.context.close(); }
   }
   for (const game of ['pig-dice', 'dots-boxes', 'five-row']) {
    const run = await start(browser, game, width);
    try {
     const metrics = await run.host.evaluate(() => {
      const rect = s => document.querySelector(s)?.getBoundingClientRect().toJSON();
      return { board: rect('.bk-stage'), title: rect('.bk-head'), pot: rect('.pd-pot'), pig: rect('.pd-pig'), clock: rect('.b5-hud .gk-hud-timer'), time: document.querySelector('.b5-hud .gk-hud-timer')?.textContent };
     });
     assert(Math.abs((metrics.board.left + metrics.board.right) / 2 - (metrics.title.left + metrics.title.right) / 2) <= 1, `${game} ${width}: title shares board centre`);
     if (metrics.pot) {
      assert(metrics.pot.bottom <= metrics.pig.top, `${game} ${width}: score clears pig`);
      assert(/\d+s/.test(metrics.time) && metrics.clock.width > 0, `${game} ${width}: turn clock stays visible`);
     }
     await shot(run, game, width, 'checked');
     results.push({ game, width, ...metrics });
    } finally { await run.context.close(); }
   }
   for (const game of ['pick-one', 'reaction-tap']) {
    const run = await start(browser, game, width);
    try {
     if (game === 'reaction-tap') await run.host.locator('#rPad.is-go').waitFor({ timeout: 15000 });
     const selector = game === 'pick-one' ? '.pick-choices' : '.rt-pad';
     const before = await run.host.locator('.pl-live').evaluate(bounds);
     const board = await run.host.locator(selector).evaluate(bounds);
     if (game === 'reaction-tap') assert(board.height >= 180, `${game} ${width}: cabinet remains usable`);
     await shot(run, game, width, 'before-action');
     for (const frame of run.seats) {
      const seat = new URL(frame.url()).searchParams.get('seat');
      await run.page.locator(`#practiceTab${seat}`).click();
      await frame.locator(game === 'pick-one' ? '[data-v="a"]' : '#rPad').click();
     }
     await run.page.locator('#practiceTab1').click();
     await run.host.locator(game === 'pick-one' ? '.pick-choices.is-reveal' : '.rt[data-phase="roundEnd"]').waitFor();
     const after = await run.host.locator('.pl-live').evaluate(bounds);
     assert(Math.abs(before.y - after.y) <= 1 && Math.abs(before.height - after.height) <= 1, `${game} ${width}: roster stays fixed through results`);
     if (game === 'pick-one') {
      const finalBoard = await run.host.locator(selector).evaluate(bounds);
      assert(Math.abs(board.y - finalBoard.y) <= 1 && Math.abs(board.height - finalBoard.height) <= 1, `${game} ${width}: choice cards stay fixed through results`);
     }
     await shot(run, game, width, 'results');
     results.push({ game, width, before, after });
    } finally { await run.context.close(); }
   }
  }
 } finally {
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(results, null, 2));
  await browser.close();
 }
 console.log(`QA58_LAYOUT_PASS ${results.length} real practice cases`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
