'use strict';
/* Optional real browser acceptance and screenshots. No accounts or providers.
 * NODE_PATH may point to an existing Playwright install. CHROMIUM_EXECUTABLE
 * can select a cached browser when Playwright's preferred revision differs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const catalog = require('../games/registry').list();
const artifacts = process.env.SAME_ROOM_ARTIFACT_DIR || path.join(os.tmpdir(), 'giggle-same-room-shots');
fs.mkdirSync(artifacts, { recursive: true });
let server, browser;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const reserve = net.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  server = spawn(process.execPath, ['server/server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  for (let i = 0; i < 100 && !logs.includes('PartyBox on'); i++) { if (server.exitCode !== null) throw new Error(logs); await wait(100); }
  assert(logs.includes('PartyBox on'), logs);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const base = `http://127.0.0.1:${port}`;
  const fresh = await browser.newContext({ colorScheme: 'dark' });
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${base}/same-room/?game=truth-dare`);
  assert.equal(await freshPage.locator('html').getAttribute('data-theme'), 'day', 'new groups start in Day even on a dark device');
  await fresh.close();
  for (const [width,height] of [[375,667],[390,844],[1024,768],[1440,900]]) for (const theme of ['day', 'night']) for (const promptStyle of ['Random card', 'Ask your own']) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 768, reducedMotion: 'reduce' });
    await context.addInitScript(theme => {
      localStorage.setItem('pb_theme', theme);
      const Native = WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.t === 'same-state') window.__oneDevice = m; }); }
      };
    }, theme);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const shot = async name => {
      const style = promptStyle === 'Random card' ? 'random' : 'own';
      await page.screenshot({ path: path.join(artifacts, `${width}-${theme}-${style}-${name}.png`), fullPage: ['setup', 'game-picker', 'game-picker-all'].includes(name) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways overflow at ${width}`);
    };
    const actor = async (phase, privatePeer = false) => {
      await page.waitForFunction(phase => window.__oneDevice?.gate === 'play' && window.__oneDevice.running && window.__oneDevice.state?.phase === phase, phase);
      const seat = await page.evaluate(() => {
        const m = window.__oneDevice;
        return { id: m.state.me, active: m.player, target: m.state.target, name: m.players.find(p => p.id === m.state.me).name };
      });
      assert.equal(seat.active, seat.id, `${phase}: server and view use the same seat`);
      if (privatePeer) assert.notEqual(seat.id, seat.target, `${phase}: target cannot write or vote`);
      else assert.equal(seat.id, seat.target, `${phase}: target acts now`);
      assert.equal(await page.locator('#srTurn').textContent(), `${seat.name}’s turn!`, `${phase}: banner names the actor`);
      assert(await page.locator('#gbody .party-scene--truth').isVisible(), `${phase}: actual game scene is mounted`);
      return seat;
    };
    const shelf = async expanded => {
      const cards = page.locator('.sr-game-card:visible');
      assert.equal(await cards.count(), expanded ? 21 : width <= 600 ? 4 : 8, 'preview shows whole rows');
      assert(await page.locator('#srGameGrid').evaluate(grid => {
        const css = getComputedStyle(grid);
        return css.maxHeight === 'none' && css.overflowY === 'visible' && grid.scrollTop === 0;
      }), 'game shelf uses page scrolling');
      for (const card of await cards.all()) {
        assert(await card.evaluate(card => {
          const tile = card.querySelector('.sr-game-tile');
          const art = card.querySelector('.sr-game-art').getBoundingClientRect();
          const name = card.querySelector('.sr-game-name').getBoundingClientRect();
          const count = card.querySelector('.sr-game-count').getBoundingClientRect();
          const bounds = card.getBoundingClientRect();
          return getComputedStyle(tile).display === 'grid' && Math.abs(art.width - art.height) < 1 &&
            name.top >= art.bottom && count.top >= name.bottom && count.bottom <= bounds.bottom &&
            name.left >= bounds.left && name.right <= bounds.right;
        }), 'art, name and count stay in separate rows inside every tile');
      }
      assert.equal(await page.locator('.sr-game-card[aria-pressed="true"] .sr-game-check').evaluate(el => getComputedStyle(el).visibility), 'visible');
    };
    await page.goto(base);
    await page.locator('[data-how="truth-dare"]').first().click();
    await page.locator('.same-room-link').click();
    await page.locator('#srSetup').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'saved theme is respected');
    const ground = theme === 'night' ? 'rgb(8, 8, 8)' : 'rgb(255, 255, 255)';
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), ground);
    assert.match(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundImage), /radial-gradient/);
    assert.equal(await page.locator('.sr-prompt-art').count(), 4);
    assert.equal(await page.locator('.sr-pace-art').count(), 3);
    assert.equal(await page.locator('.sr-empty-friends').count(), 1);
    assert.equal(await page.locator('#srGame').inputValue(), 'truth-dare');
    assert(await page.locator('#srStart').isDisabled());
    await page.locator('#srGamePicker > summary').click();
    assert.equal(await page.locator('[data-game-choice] img').count(), 21);
    await shelf(false);
    await shot('game-picker');
    await page.locator('#srShowGames').click();
    await shelf(true);
    await page.locator('#srGameGrid img').evaluateAll(images => Promise.all(images.map(img => { img.loading = 'eager'; return img.decode(); })));
    await shot('game-picker-all');
    await page.locator('.sr-game-card').first().evaluate(el => el.scrollIntoView({ block:'center', behavior:'instant' }));
    const scrollOwner = page.locator('#srGamePicker dialog[open]');
    const beforeScroll = await scrollOwner.evaluate(el => el.scrollTop);
    const firstCard = await page.locator('.sr-game-card').first().boundingBox();
    await page.mouse.move(firstCard.x + firstCard.width / 2, firstCard.y + firstCard.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(before => document.querySelector('#srGamePicker dialog[open]').scrollTop > before, beforeScroll);
    assert.equal(await page.locator('#srGameGrid').evaluate(el => el.scrollTop), 0, 'wheel over cards scrolls the catalogue dialog');
    await page.locator('#srShowGames').click();
    await shelf(false);
    await page.locator('[data-game-choice="truth-dare"]').click();
    await page.locator('#srName').fill('Sam, Jess, Mo'); await page.locator('#srAdd').click();
    assert.equal(await page.locator('.sr-person').count(), 3);
    assert.equal(await page.locator('#srSeatCount').textContent(), '3 / 20');
    assert.equal(await page.locator('#srAdd').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    assert.equal(await page.locator('select:not(.picker-native)').count(), 0);
    await page.locator('#sr-setting-rounds').fill('1'); await page.locator('#sr-setting-rounds').dispatchEvent('change');
    await page.locator(`[data-picker-for="sr-setting-promptStyle"] [data-value="${promptStyle}"]`).click();
    await shot('setup');
    await page.locator('#srStart').click();
    const spinner = await actor('spin');
    assert.equal(await page.locator('#tSpin').textContent(), spinner.name, 'wheel lands on the same actor as the banner');
    const clockRow = await page.locator('.party-hud').boundingBox();
    const spinCard = await page.locator('.td-spin').boundingBox();
    if (width <= 390) assert(spinCard.y >= clockRow.y + clockRow.height - 1, 'turn prompt clears the timer row');
    await shot('spin');
    await page.locator('[data-kind="truth"]').waitFor({ timeout: 15000 });
    const chooser = await actor('choose');
    assert.equal(chooser.id, spinner.id);
    assert(await page.locator('#tSpinForMe').isVisible());
    assert.equal(await page.locator('#srDeck').count(), 0);
    for (const control of ['[data-kind="truth"]', '[data-kind="dare"]', '#tSpinForMe']) {
      assert(await page.locator(control).evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
      }), `${control}: visible without scrolling at ${width}`);
    }
    await shot('choose');
    await page.locator('[data-kind="truth"]').click();
    for (let writer = 0; promptStyle === 'Ask your own' && writer < 2; writer++) {
      await page.locator('body[data-stage="pass"] #srUnlock').waitFor();
      if (!writer) await shot('pass');
      assert.equal(await page.locator('body').getAttribute('data-stage'), 'pass');
      assert.equal(await page.locator('.sr-phone-art').count(), 1);
      assert.equal(await page.locator('textarea').count(), 0);
      await page.locator('#srUnlock').click();
      await page.locator('#tEntry').fill(`What is your favourite shared memory, writer ${writer}?`);
      await actor('compose', true);
      if (!writer) await shot('private-writing');
      await page.locator('#tSendEntry').click();
      await page.getByRole('button', { name: 'Done, pass it back', exact: true }).waitFor();
      assert(!(await page.content()).includes(`What is your favourite shared memory, writer ${writer}?`));
      if (!writer) await shot('pass-back');
      await page.locator('body[data-stage="return"] #srUnlock').click();
    }
    for (let voter = 0; promptStyle === 'Ask your own' && voter < 2; voter++) {
      await page.locator('body[data-stage="pass"] #srUnlock').click();
      await page.locator('[data-prompt-vote="0"]').waitFor();
      await actor('prompt-vote', true);
      if (!voter) await shot('prompt-pool');
      await page.locator('[data-prompt-vote="0"]').click();
      await page.getByRole('button', { name: 'Done, pass it back', exact: true }).click();
    }
    await page.locator('#tReady').waitFor();
    const performer = await actor('perform');
    assert.equal(performer.id, chooser.id);
    await shot('prompt');
    await page.locator('#tReady').click();
    const judges = new Set();
    for (let voter = 0; voter < 2; voter++) {
      await page.locator('body[data-stage="pass"] #srUnlock').click();
      await page.locator('[data-v="yes"]').waitFor();
      const judge = await actor('vote', true);
      judges.add(judge.id);
      if (!voter) await shot('vote');
      await page.locator('[data-v="yes"]').click();
      await page.getByRole('button', { name: 'Done, pass it back', exact: true }).click();
    }
    assert.equal(judges.size, 2, 'both other people judge, each under their own turn banner');
    await page.locator('#tNext').waitFor();
    await page.waitForFunction(() => window.__oneDevice.running);
    await page.locator('#tNext').click();
    await page.locator('#srAgain').waitFor();
    await shot('results');
    await page.locator('#srChange').click();
    await page.getByRole('button', { name: 'Remove Mo', exact: true }).click();
    await page.locator('#srGamePicker > summary').click();
    await page.locator('#srShowGames').click();
    await page.locator('[data-game-choice="four-in-a-row"]').click();
    await page.locator('#srStart').click();
    await page.locator('[data-column="0"]').waitFor();
    await page.waitForFunction(() => window.__oneDevice.running);
    await shot('board');
    await page.locator('[data-column="0"]').click();
    await page.waitForFunction(() => window.__oneDevice.state?.board?.filter(Boolean).length === 1);
    assert.match(await page.locator('#srTurn').textContent(), /Jess/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Every opt-in mounts its real view, including write / rank / draw controls.
  for (const g of catalog.filter(g => g.sameRoom)) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/same-room/?game=${g.id}`);
    await page.locator('#srName').fill('Sam, Jess'); await page.locator('#srAdd').click(); await page.locator('#srStart').click();
    await page.locator('#gbody, #srUnlock').first().waitFor();
    if (await page.locator('#srUnlock').isVisible()) await page.locator('#srUnlock').click();
    await page.locator('#gbody > *').first().waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${g.id}: phone fit`);
    assert.deepEqual(errors, [], g.id);
    await context.close();
  }
  console.log(`SAME_ROOM_BROWSER_PASS: tile rows and catalogue scrolling; full three-person Random card/Ask your own rounds with actor banners and real scenes; 21 game mounts; 375/390/1024/1440 Day/Night screenshots in ${artifacts}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.kill('SIGTERM'); });
