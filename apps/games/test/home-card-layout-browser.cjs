'use strict';
// Optional real Chromium acceptance. A fresh mobile context is essential:
// resizing a desktop page alone misses mobile viewport overflow regressions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-card-layout-'));
const out = process.env.HOME_LAYOUT_EVIDENCE_DIR || scratch;
fs.mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { pass: false, cases: [], scope: 'Isolated production app and Chromium desktop/mobile emulation; no physical-phone claim.' };
let server, browser, logs = '';
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished));
});
// Render beyond the authored viewBox. A normal screenshot cannot see pixels
// that the file itself has already discarded, even with object-fit: contain.
async function checkIllustrationEdges(page) {
  const sources = require('../games/registry').list().map(g => g.art).filter(src => src?.endsWith('.svg'));
  for (const src of sources) {
    const outside = await page.evaluate(async src => {
      const response = await fetch('/' + src);
      if (!response.ok) throw Error('Missing artwork ' + src);
      const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
      const { x, y, width, height } = svg.viewBox.baseVal;
      const margin = 8;
      const canvas = document.createElement('canvas');
      canvas.width = width + 2 * margin;
      canvas.height = height + 2 * margin;
      svg.setAttribute('viewBox', [x - margin, y - margin, canvas.width, canvas.height].join(' '));
      svg.setAttribute('width', canvas.width);
      svg.setAttribute('height', canvas.height);
      const file = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      const image = new Image();
      image.src = URL.createObjectURL(file);
      try {
        await image.decode();
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        ctx.clearRect(margin, margin, width, height);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 32);
      } finally { URL.revokeObjectURL(image.src); }
    }, src);
    assert.equal(outside, false, src + ' artwork stays inside its authored bounds');
  }
}
async function checkCase(url, viewport, theme) {
  const mobile = viewport.width < 1100;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [];
  const label = `${viewport.width}x${viewport.height}-${theme}`;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => localStorage.setItem('pb_theme', theme), theme);
  try {
    await page.goto(url);
    await page.locator('.home-picks .pick').first().waitFor();
    if (!report.cases.length) await checkIllustrationEdges(page);
    await page.locator('#bBrowse').click();
    await page.waitForFunction(n => document.querySelectorAll('#shelfGames [data-how]').length === n, require('../games/registry').list().length);
    await settle(page);
    const pageBounds = await page.evaluate(width => ({ width:document.documentElement.scrollWidth, innerWidth, innerHeight, overflow:[...document.querySelectorAll('body *')].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > width + 1).slice(0, 12).map(el => ({tag:el.tagName, className:el.className, right:el.getBoundingClientRect().right, width:el.getBoundingClientRect().width})) }), viewport.width);
    if (pageBounds.width > viewport.width + 1) console.log('HOME_PAGE_BOUNDS', label, JSON.stringify(pageBounds));
    assert(pageBounds.width <= viewport.width + 1, label + ' home page never widens the mobile layout viewport');
    const cards = await page.locator('.home-game-card').evaluateAll(elements => elements.map(card => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
      const art = card.querySelector('.home-card-art'), copy = card.querySelector('.home-card-copy'), badge = art.querySelector('.cat-tag');
      return { id:card.dataset.how || 'practice', variant:card.className, card:rect(card), art:rect(art), copy:rect(copy), badge:badge && rect(badge), parts:[...copy.children].map(rect), scrollWidth:card.scrollWidth, clientWidth:card.clientWidth };
    }));
    assert.equal(cards.length, 5 + require('../games/registry').list().length, 'four picks, practice and every catalogue card are checked');
    for (const card of cards) {
      const name = label + ' ' + card.variant + ' ' + card.id;
      assert(card.card.x >= -1 && card.card.right <= viewport.width + 1, name + ' fits the viewport');
      assert(card.scrollWidth <= card.clientWidth + 1, name + ' has no horizontal scroll');
      assert(Math.abs(card.art.width / card.art.height - 1.25) < .02, name + ' cover has its intended ratio');
      assert(Math.abs(card.art.y + card.art.height / 2 - card.copy.y - card.copy.height / 2) < 1, name + ' centres art against the text');
      assert(card.copy.x - card.art.right >= 9 && card.copy.x - card.art.right <= 15, name + ' art and text sit together');
      for (let i = 1; i < card.parts.length; i++) assert(Math.abs(card.parts[i].y - card.parts[i - 1].bottom - 3) < 1, name + ' keeps the copy together');
      assert.equal(card.badge, null, name + ' art stays unobstructed');
    }
    const illustratedIcons = page.locator('#shelfGames img[src$=".svg"]');
    for (const image of await illustratedIcons.all()) {
      const icon = await image.evaluate(el => ({
        src: el.getAttribute('src'),
        fit: getComputedStyle(el).objectFit,
        frame: getComputedStyle(el.parentElement).backgroundColor,
        inset: parseFloat(getComputedStyle(el).paddingTop),
      }));
      assert.equal(icon.fit, 'contain', icon.src + ' is shown whole');
      assert.equal(icon.frame, 'rgba(0, 0, 0, 0)', icon.src + ' has no visible bars around its outline');
      assert(icon.inset > 0, icon.src + ' has breathing room at the top and bottom');
    }
    await page.locator('.home-picks').screenshot({ path:path.join(out, label + '-picks.png') });
    await page.locator('#games').screenshot({ path:path.join(out, label + '-catalogue.png') });
    await page.locator('#games .catrow[data-how="pocket-karts"]').screenshot({ path:path.join(out, label + '-catalogue-card.png') });
    const sheets = [];
    for (const id of ['pocket-karts', 'chess', 'doodle-guess', 'ludo', 'trivia']) {
      await page.locator(`.home-game-card[data-how="${id}"]`).first().click();
      await settle(page);
      const sheet = await page.locator('.howto-start').evaluate(el => {
        const rect = el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
        const scroll = el.querySelector('.howto-seat-scroll');
        return { rect:rect(el), close:rect(el.querySelector('#howtoClose')), primary:rect(el.querySelector('#howtoGo')), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight, boxSizing:getComputedStyle(el).boxSizing, nodes:[...el.querySelectorAll('.howto-layout,.howto-main,.howto-seat-content,.howto-actions,.howto-controls li')].map(rect), contentScrollTop:scroll.scrollTop };
      });
      if (sheet.rect.width > viewport.width + 1 || sheet.rect.bottom > viewport.height + 1 || sheet.rect.top < -1) console.log('SHEET_BOUNDS_FAILURE', label, JSON.stringify(sheet));
      // Compare with the requested viewport, never innerWidth: mobile
      // innerWidth can itself grow when page content overflows.
      assert(sheet.rect.width <= viewport.width + 1, label + ' ' + id + ' phone sheet never exceeds viewport width');
      assert(sheet.rect.left >= -1 && sheet.rect.right <= viewport.width + 1, label + ' sheet stays inside horizontal bounds');
      assert(sheet.rect.top >= -1 && sheet.rect.bottom <= viewport.height + 1, label + ' sheet stays inside vertical bounds');
      assert.equal(sheet.boxSizing, 'border-box');
      assert(sheet.scrollWidth <= sheet.clientWidth + 1, label + ' sheet has no horizontal scroll');
      assert(sheet.scrollHeight <= sheet.clientHeight + 1, label + ' only sheet content scrolls');
      for (const control of [sheet.close, sheet.primary, ...sheet.nodes]) assert(control.left >= sheet.rect.left - 1 && control.right <= sheet.rect.right + 1, label + ' all controls stay inside sheet');
      assert(sheet.primary.bottom <= viewport.height + 1 && sheet.primary.top >= 0, label + ' primary action is fully visible');
      if (id === 'pocket-karts') await page.screenshot({ path:path.join(out, label + '-sheet.png') });
      if (viewport.width < 860) {
        assert(Math.abs(sheet.rect.width - viewport.width) <= 1, label + ' phone sheet fills available viewport width');
        await page.locator('.howto-seat-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
        const bottom = await page.locator('#howtoGo').evaluate(el => el.getBoundingClientRect().bottom);
        assert(Math.abs(bottom - sheet.primary.bottom) < 1, label + ' action stays put while content scrolls');
      }
      sheets.push({ id, ...sheet });
      await page.locator('#howtoClose').click();
    }
    if (viewport.width === 320 && theme === 'night') {
      await page.locator('#nm').fill('Layout host');
      await page.locator('#bCreate').click();
      await page.locator('.roomcode').first().waitFor();
      const peer = await browser.newContext();
      try {
        const guest = await peer.newPage();
        await guest.goto(page.url());
        await guest.locator('#nm').fill('Layout guest');
        await guest.locator('#bJoin').click();
        for (const shelf of ['.feat-strip', '.grid-games']) {
          const row = page.locator(shelf + ' .home-game-card').first();
          await row.scrollIntoViewIfNeeded();
          assert(await row.evaluate(el => {
            const art = el.querySelector('.home-card-art');
            const image = art.firstElementChild.getBoundingClientRect(), frame = art.getBoundingClientRect();
            return Math.abs(image.height - frame.height) <= 1 && Math.abs(image.width - frame.width) <= 1;
          }), shelf + ' artwork fits its frame in the room');
          await row.click();
          await page.getByRole('button', { name: 'Close game details' }).click();
        }
      } finally { await peer.close(); }
    }
    assert.deepEqual(errors, []);
    report.cases.push({ label, viewport, isMobile:mobile, cards, sheets });
    console.log('HOME_LAYOUT_BROWSER_CASE_PASS', label);
  } catch (error) {
    await page.screenshot({ path:path.join(out, label + '-failure.png') }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
(async () => {
  let url = process.env.HOME_LAYOUT_TEST_URL;
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
      if (n >= 200 || server.exitCode !== null) throw Error('Fixture server failed: ' + logs);
      await pause(50);
    }
  }
  browser = await chromium.launch({ headless:true, channel:'chromium' });
  report.browser = browser.version();
  console.log('HOME_LAYOUT_BROWSER_STARTED', report.browser);
  for (const theme of ['day', 'night']) for (const viewport of [{width:1280,height:720},{width:1440,height:800},{width:1280,height:800},{width:860,height:720},{width:768,height:1024},{width:390,height:844},{width:360,height:740},{width:430,height:932},{width:320,height:568}]) {
    if (!process.env.HOME_LAYOUT_TEST_CASE || process.env.HOME_LAYOUT_TEST_CASE === `${viewport.width}x${viewport.height}-${theme}`) await checkCase(url, viewport, theme);
  }
  report.pass = true;
  console.log('HOME_LAYOUT_BROWSER_PASS', report.cases.length + ' desktop/tablet/mobile theme cases');
})().catch(error => { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
});
