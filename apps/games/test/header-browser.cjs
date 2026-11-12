'use strict';
// Optional real-entry browser regression: the dock's painted silhouette,
// sticky scroll and real controls, on wide screens and fresh mobile contexts.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-header-'));
const out = process.env.HEADER_EVIDENCE_DIR || scratch;
fs.mkdirSync(out, { recursive:true });
let server, browser, logs = '';
const report = { pass:false, cases:[] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
async function check(page, label, capture = true) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished));
  });
  const bounds = await page.locator('.topbar').evaluate(header => {
    const box = n => { const r = n.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
    const backdrop = getComputedStyle(header, '::before'), app = header.parentElement, grid = getComputedStyle(app), r = box(header);
    return { header:r, app:box(app), viewport:innerWidth, scrollWidth:document.documentElement.scrollWidth,
      dockLeft:r.x + parseFloat(backdrop.left), dockRight:r.right - parseFloat(backdrop.right), bg:backdrop.backgroundColor,
      line:backdrop.borderBottomColor, radius:parseFloat(backdrop.borderBottomLeftRadius), gutter:parseFloat(grid.paddingLeft), brand:box(header.querySelector('.brand')),
      controls:[...header.querySelectorAll('button')].map(n => { const r = box(n); return { ...r, label:n.getAttribute('aria-label'), hit:n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }) };
  });
  assert(bounds.scrollWidth <= bounds.viewport + 1, label + ' no horizontal page overflow');
  assert(Math.abs(bounds.header.y) < 1, label + ' dock sticks to viewport top');
  assert(bounds.header.height <= 60, label + ' dock stays shallow');
  assert(bounds.dockLeft >= 0 && bounds.dockLeft <= 16, label + ' intentional small left inset');
  assert(bounds.viewport - bounds.dockRight >= 0 && bounds.viewport - bounds.dockRight <= 16, label + ' intentional small right inset');
  assert(bounds.dockRight - bounds.controls.at(-1).right >= 12, label + ' space between the last action and the dock edge');
  assert(bounds.radius >= 16, label + ' lower corners form a dock');
  assert(Math.abs(bounds.brand.x - (bounds.app.x + bounds.gutter)) < 1, label + ' brand keeps the content grid');
  for (const control of bounds.controls) {
    assert(control.x >= bounds.dockLeft && control.right <= bounds.dockRight, label + ' control stays within dock: ' + control.label);
    assert(control.width >= 44 && control.height >= 44, label + ' control has a usable target');
    assert(control.y >= bounds.header.y && control.bottom <= bounds.header.bottom, label + ' control is not clipped by the shallow dock');
    assert(control.hit, label + ' control is not covered by the decorative surface');
  }
  const image = PNG.sync.read(await page.screenshot({ ...(capture ? { path:path.join(out, label + '.png') } : {}) }));
  const y = Math.floor(bounds.header.y + bounds.header.height / 2);
  for (const x of [Math.ceil(bounds.dockLeft) + 2, Math.floor(bounds.dockRight) - 3]) assert.deepEqual(pixel(image, x, y), rgb(bounds.bg), label + ' surface paints its near-viewport side edges');
  const components = bounds.line.match(/[\d.]+/g).map(Number), alpha = components[3] ?? 1;
  const line = components.slice(0, 3).map((value, i) => Math.round(value * alpha + rgb(bounds.bg)[i] * (1 - alpha)));
  const painted = pixel(image, Math.floor(bounds.viewport / 2), Math.ceil(bounds.header.bottom) - 1);
  assert(painted.every((value, i) => Math.abs(value - line[i]) <= 2), label + ' bottom divider follows the dock');
  return bounds;
}
async function checkUtilities(page, width) {
  const buttons = page.locator('.topbar-actions button');
  assert.equal(await buttons.count(), 3);
  const inspect = n => {
    const s = getComputedStyle(n), r = n.getBoundingClientRect();
    const ink = n.querySelector('svg').getBoundingClientRect();
    return {
      surface: [s.backgroundColor, s.borderColor, s.borderWidth, s.borderRadius, s.boxShadow, s.transform, s.color],
      outline: [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset],
      left:r.left, right:r.right, height:r.height, icon: [ink.width, ink.height],
      textVisible:n.querySelector('.hlabel').getClientRects().length > 0
    };
  };
  await page.mouse.move(0, 0);
  const states = [];
  for (const button of await buttons.all()) states.push(await button.evaluate(inspect));
  for (const [index, state] of states.entries()) {
    assert.deepEqual(state.surface, states[0].surface, 'same resting face, stroke and shadow for each action');
    assert.equal(state.surface[2], '1px'); assert.equal(state.surface[4], 'none');
    assert.deepEqual(state.icon, [18, 18]); assert.equal(state.height, 44);
    assert.equal(state.textVisible, width > 720);
    if (index) assert(state.left - states[index-1].right >= 12, 'space between adjacent actions');
  }
  if (await page.evaluate(() => matchMedia('(hover:hover)').matches)) {
    const hovered = [];
    for (const button of await buttons.all()) { await button.hover(); hovered.push((await button.evaluate(inspect)).surface); }
    assert(hovered.every(face => JSON.stringify(face) === JSON.stringify(hovered[0])), 'hover feedback matches across controls');
    await page.mouse.move(0, 0);
  }
  await page.locator('.topbar .brand').focus();
  let expectedRing;
  for (const button of await buttons.all()) {
    await page.keyboard.press('Tab');
    assert(await button.evaluate(n => n === document.activeElement && n.matches(':focus-visible')));
    const { outline } = await button.evaluate(inspect);
    assert(parseFloat(outline[1]) >= 2);
    if (expectedRing) assert.deepEqual(outline, expectedRing);
    expectedRing = outline;
  }
  await page.locator('.topbar .brand').focus();
  await page.locator('.topbar .brand').evaluate(n => n.blur());
}
async function visit(url, viewport, theme) {
  const context = await browser.newContext({ viewport, isMobile:viewport.width < 560, hasTouch:viewport.width < 560, deviceScaleFactor:1 });
  await context.addInitScript(t => localStorage.setItem('pb_theme', t), theme);
  const page = await context.newPage(), errors = [], label = `${viewport.width}x${viewport.height}-${theme}`;
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.locator('.home-picks .pick').first().waitFor();
    await checkUtilities(page, viewport.width);
    const initial = await check(page, label + '-home');
    await page.evaluate(() => scrollTo(0, 700));
    await check(page, label + '-sticky');
    await page.locator('#bTheme').click();
    const toggled = await check(page, label + '-toggled', false);
    assert.notEqual(initial.bg, toggled.bg, 'theme control repaints the entire dock');
    await page.locator('#bTheme').click();
    const sound = page.locator('#bSound'), oldSound = await sound.getAttribute('data-state');
    await sound.click();
    assert.notEqual(await sound.getAttribute('data-state'), oldSound, 'sound remains clickable');
    await page.locator('[data-report]').first().click();
    await page.getByRole('dialog', { name:'Report an issue' }).waitFor();
    await page.getByRole('button', { name:'Close issue report' }).click();
    await page.waitForFunction(() => document.activeElement?.matches('[data-report]'));
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#nm').fill('Header QA');
    await page.locator('#bCreate').click();
    await page.locator('.roomcode').first().waitFor();
    await check(page, label + '-lobby');
    assert.deepEqual(errors, []);
    report.cases.push({ label, initial });
    console.log('HEADER_BROWSER_CASE_PASS', label);
  } finally { await context.close(); }
}
(async () => {
  let url = process.env.HEADER_TEST_URL;
  if (!url) {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    url = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server/server.js'], { cwd:root, env:{...process.env, HOST:'127.0.0.1', PORT:String(port), GAME_REPORT_DB:path.join(scratch, 'reports.sqlite')}, stdio:['ignore','pipe','pipe'] });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { logs += data; });
    for (let n = 0; ; n++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      if (n >= 200 || server.exitCode !== null) throw Error('Header test server failed: ' + logs);
      await pause(50);
    }
  }
  browser = await chromium.launch({ headless:true, ...(process.env.HEADER_BROWSER_PATH ? { executablePath:process.env.HEADER_BROWSER_PATH } : { channel:'chromium' }) });
  for (const theme of ['day', 'night']) for (const viewport of [{width:2048,height:900}, {width:1280,height:800}, {width:721,height:700}, {width:720,height:700}, {width:390,height:844}, {width:320,height:568}]) await visit(url, viewport, theme);
  report.pass = true;
  console.log('HEADER_BROWSER_PASS', report.cases.length, 'normal-entry desktop/mobile Day/Night home, sticky, theme, sound, report and lobby cases');
})().catch(error => { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
});
