'use strict';
/* Optional browser visual regression. Serves actual public assets on loopback.
 * Explicit test-only app-module adapters hold pending work, simulate a failed
 * import, or replace the loader. No game server, socket, account or media. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');
const publicRoot = path.resolve(__dirname, '../public');
const artifacts = process.env.LOADING_ARTIFACT_DIR || path.join(os.tmpdir(), 'giggle-loading-review');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server, browser;
const results = [];
async function run(viewport, reducedMotion, night, failImport = false) {
  const context = await browser.newContext({ viewport, reducedMotion, permissions: [], deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [], expectedErrors = [], requests = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (failImport && /\/js\/app\.js$/.test(message.location().url) && /^Failed to load resource: net::ERR_FAILED$/.test(message.text())) expectedErrors.push(message.text());
    else errors.push(message.text());
  });
  page.on('request', request => requests.push(request.url()));
  page.on('websocket', socket => sockets.push(socket.url()));
  await page.addInitScript(night => localStorage.setItem('pb_theme', night ? 'night' : 'day'), night);
  await page.clock.install({ time: new Date('2026-11-04T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-04T12:00:01Z'));
  await page.route('**/js/app.js', route => failImport ? route.abort() : route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* Test-only pending-work adapter: production source is unchanged. */' }));
  const label = `${viewport.width}x${viewport.height}-${night ? 'night' : 'day'}-${reducedMotion}${failImport ? '-failed-import' : ''}`;
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.boot-view--table').waitFor();
    const pending = await page.locator('[data-app-boot]').getAttribute('aria-busy');
    assert.equal(pending, 'true');
    assert.equal(await page.locator('.loading-table i').count(), 3);
    assert.equal(await page.locator('.loading-table').getAttribute('aria-hidden'), 'true');
    const animations = await page.locator('.loading-table i').evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
    assert.deepEqual(animations, reducedMotion === 'reduce' ? ['none', 'none', 'none'] : ['boot-deal-left', 'boot-deal-centre', 'boot-deal-right']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
    assert.equal(await page.locator('.loading-table').evaluate(element => {
      const artBottom = Math.max(...[...element.querySelectorAll('i')].map(card => card.getBoundingClientRect().bottom));
      return artBottom + 6 <= document.querySelector('[data-boot-title]').getBoundingClientRect().top;
    }), true, 'card artwork cannot overlap the loading heading');
    assert.equal(await page.locator('.boot-reload').evaluate(element => element.getBoundingClientRect().height >= 44), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.boot-reload').evaluate(element => element === document.activeElement), true, 'only actionable loading control is keyboard reachable');
    await page.screenshot({ path: path.join(artifacts, `pending-${label}.png`) });
    await page.clock.fastForward(11999);
    assert.equal(await page.locator('[data-app-boot]').count(), 1, 'no premature timeout');
    await page.clock.fastForward(1);
    await page.getByRole('heading', { name: 'Taking longer than expected' }).waitFor();
    assert.equal(await page.locator('[data-boot-state="error"]').getAttribute('role'), 'alert');
    assert.equal(await page.locator('[data-boot-state="error"]').getAttribute('aria-busy'), 'false');
    assert(await page.locator('.loading-table').isHidden());
    assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0, 'no decorative animation after failure');
    assert(await page.getByRole('link', { name: 'Reload', exact: true }).isVisible());
    await page.screenshot({ path: path.join(artifacts, `error-${label}.png`) });
    assert.equal(sockets.length, 0);
    assert(requests.every(url => new URL(url).host === `127.0.0.1:${server.address().port}`));
    assert.deepEqual(errors, []);
    assert.equal(expectedErrors.length, failImport ? 1 : 0);
    const row = { label, passed: true, viewport, reducedMotion, night, importAdapter: failImport ? 'isolated app-module network abort' : 'isolated empty app module holds loading', animations, errors, expectedErrors: expectedErrors.length, sockets: sockets.length };
    results.push(row);console.log(JSON.stringify(row));
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `FAILED-${label}.png`) }).catch(() => {});
    results.push({ label, passed: false, error: error.stack, errors });throw error;
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  server = http.createServer(async (request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); } catch { response.writeHead(400);response.end();return; }
    const file = path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(publicRoot + path.sep)) { response.writeHead(403);response.end();return; }
    try { const bytes = await fs.readFile(file);response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });response.end(bytes); }
    catch { response.writeHead(404);response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  for (const [viewport, reducedMotion, night] of [
    [{ width: 1280, height: 800 }, 'no-preference', false],
    [{ width: 375, height: 667 }, 'no-preference', false],
    [{ width: 320, height: 568 }, 'reduce', false],
    [{ width: 667, height: 375 }, 'reduce', false],
    [{ width: 375, height: 667 }, 'no-preference', true],
  ]) await run(viewport, reducedMotion, night);
  await run({ width: 375, height: 667 }, 'reduce', false, true);
  // A successful app replacement must retire the watchdog, even when its
  // timer later fires. This adapter tests the real guard,not real gameplay.
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-11-04T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-04T12:00:01Z'));
  await page.route('**/js/app.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'document.getElementById("app").innerHTML="<h1>Fixture ready</h1>";' }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading', { name: 'Fixture ready', exact: true }).waitFor();
  await page.clock.fastForward(13000);
  assert(await page.getByRole('heading', { name: 'Fixture ready', exact: true }).isVisible());
  assert.equal(await page.locator('.loading-table,[data-boot-state="error"]').count(), 0);
  results.push({ label: 'app replacement retires watchdog', passed: true, adapter: 'isolated replacement fixture;not gameplay readiness' });await context.close();
  console.log('LOADING_BROWSER_PASS: pending,error,reduced motion,Day/Night,small landscape and replacement guard');
})().catch(error => { console.error(error.stack);process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ at: new Date().toISOString(), realMedia: false, production: false, results }, null, 2) + '\n');
});
