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
  for (const width of [390, 800, 1280]) for (const theme of ['day', 'night']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 800 ? 600 : 800 }, hasTouch: width === 390, reducedMotion: 'reduce' });
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
      await page.screenshot({ path: path.join(artifacts, `${width}-${theme}-${name}.png`), fullPage: ['setup', 'game-picker'].includes(name) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways overflow at ${width}`);
    };
    await page.goto(base);
    await page.locator('[data-how="truth-dare"]').first().click();
    await page.locator('.same-room-link').click();
    await page.locator('#srSetup').waitFor();
    assert.equal(await page.locator('#srGame').inputValue(), 'truth-dare');
    assert(await page.locator('#srStart').isDisabled());
    await page.locator('#srGamePicker > summary').click();
    assert.equal(await page.locator('[data-game-choice] img').count(), 21);
    await shot('game-picker');
    await page.locator('[data-game-choice="truth-dare"]').click();
    await page.locator('#srName').fill('Sam, Jess, Mo, Ali, Bea'); await page.locator('#srAdd').click();
    assert.equal(await page.locator('.sr-person').count(), 5);
    assert.equal(await page.locator('#srAdd').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    assert.equal(await page.locator('select:not(.picker-native)').count(), 0);
    await page.locator('#sr-setting-rounds').fill('1'); await page.locator('#sr-setting-rounds').dispatchEvent('change');
    await page.locator('[data-picker-for="sr-setting-promptStyle"] [data-value="Ask your own"]').click();
    await shot('setup');
    await page.locator('#srStart').click();
    await page.locator('[data-kind="truth"]').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => window.__oneDevice.running);
    const actorName = await page.evaluate(() => { const m = window.__oneDevice; return m.players.find(p => p.id === m.state.target).name; });
    assert.equal(await page.locator('#srTurn').textContent(), `${actorName}’s turn`);
    assert(await page.locator('#tSpinForMe').isVisible());
    assert.equal(await page.locator('#srDeck').count(), 0);
    for (const control of ['[data-kind="truth"]', '[data-kind="dare"]', '#tSpinForMe']) {
      assert(await page.locator(control).evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
      }), `${control}: visible without scrolling at ${width}`);
    }
    await shot('turn');
    await page.locator('[data-kind="truth"]').click();
    for (let writer = 0; writer < 4; writer++) {
      await page.locator('#srUnlock').waitFor();
      if (!writer) await shot('pass');
      assert.equal(await page.locator('textarea').count(), 0);
      await page.locator('#srUnlock').click();
      await page.locator('#tEntry').fill(`What is your favourite shared memory, writer ${writer}?`);
      await page.waitForFunction(() => window.__oneDevice.running);
      if (!writer) await shot('private-writing');
      await page.locator('#tSendEntry').click();
      await page.getByRole('button', { name: 'Done, pass it back', exact: true }).waitFor();
      assert(!(await page.content()).includes(`What is your favourite shared memory, writer ${writer}?`));
      if (!writer) await shot('pass-back');
      await page.locator('#srUnlock').click();
    }
    for (let voter = 0; voter < 4; voter++) {
      await page.locator('#srUnlock').click();
      await page.locator('[data-prompt-vote="0"]').waitFor();
      await page.waitForFunction(() => window.__oneDevice.running);
      assert(await page.evaluate(() => window.__oneDevice.player !== window.__oneDevice.state.target));
      if (!voter) await shot('prompt-pool');
      await page.locator('[data-prompt-vote="0"]').click();
      await page.getByRole('button', { name: 'Done, pass it back', exact: true }).click();
    }
    await page.locator('#tReady').waitFor();
    await shot('prompt');
    await page.locator('#tReady').click();
    for (let voter = 0; voter < 4; voter++) {
      await page.locator('#srUnlock').click();
      await page.locator('[data-v="yes"]').waitFor();
      await page.waitForFunction(() => window.__oneDevice.running);
      await page.locator('[data-v="yes"]').click();
      await page.getByRole('button', { name: 'Done, pass it back', exact: true }).click();
    }
    await page.locator('#tNext').waitFor();
    await page.waitForFunction(() => window.__oneDevice.running);
    await page.locator('#tNext').click();
    await page.locator('#srAgain').waitFor();
    await shot('results');
    await page.locator('#srChange').click();
    await page.getByRole('button', { name: 'Remove Mo', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Ali', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Bea', exact: true }).click();
    await page.locator('#srGamePicker > summary').click();
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
  console.log(`SAME_ROOM_BROWSER_PASS: entry, private DOM, live turns and 21 game mounts; 390/800/1280 day/night screenshots in ${artifacts}`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); server?.kill('SIGTERM'); });
