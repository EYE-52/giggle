'use strict';
// Optional signed, cross-origin browser regression. No accounts or media grants.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), net = require('node:net');
const { once } = require('node:events'), { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const WebSocket = require('ws');
const { issueGameTicket } = require('../../../server/src/services/gameBridgeService');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-framed-focus-'));
const secret = require('node:crypto').randomBytes(32).toString('hex');
let parent, child, browser, checks = 0, peerCount = 0;
const peers = new Set();
const ok = (value, label) => { assert(value, label); checks++; };
(async () => {
  const reserve = net.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const gameUrl = 'http://127.0.0.1:' + port;
  let parentUrl;
  parent = http.createServer((req, res) => {
    if (req.url === '/ticket') {
      const { ticket } = issueGameTicket({ squadId: 'browser-fixture', userId: 'synthetic-seat', displayName: 'Fixture Player' }, { NODE_ENV: 'development', GAMES_PUBLIC_URL: gameUrl, GAME_BRIDGE_SECRET: secret });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ticket }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><link rel="icon" href="${gameUrl}/favicon.ico"><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe title="Real Games fixture" src="${gameUrl}/?embed=1&parentOrigin=${encodeURIComponent(parentUrl)}" allow="autoplay"></iframe><script>
      const frame=document.querySelector('iframe');let pending=null;
      addEventListener('message',async e=>{if(e.origin!==${JSON.stringify(gameUrl)}||e.source!==frame.contentWindow)return;
      if(e.data.t==='ready'||e.data.t==='auth-needed'){pending=crypto.randomUUID();const {ticket}=await(await fetch('/ticket')).json();frame.contentWindow.postMessage({v:1,t:'auth',ticket,n:pending},${JSON.stringify(gameUrl)});}
      if(e.data.t==='authed'&&e.data.n===pending)document.documentElement.dataset.authorized='true';});</script>`);
  });
  parent.listen(0, '127.0.0.1'); await once(parent, 'listening');
  parentUrl = 'http://127.0.0.1:' + parent.address().port;
  child = spawn(process.execPath, ['server/server.js'], { cwd: path.resolve(__dirname, '..'), env: { PATH: process.env.PATH, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: path.join(scratch, 'reports.sqlite'), GAME_BRIDGE_SECRET: secret, GIGGLE_ALLOWED_ORIGINS: parentUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  for (let n = 0; n < 100 && !logs.includes('PartyBox on'); n++) await new Promise(r => setTimeout(r, 50));
  ok(logs.includes('PartyBox on'), 'actual Games server ready');
  async function addPeer() {
    const userId = 'roster-peer-' + (++peerCount);
    const { ticket } = issueGameTicket({ squadId: 'browser-fixture', userId, displayName: 'Peer ' + peerCount },
      { NODE_ENV: 'development', GAMES_PUBLIC_URL: gameUrl, GAME_BRIDGE_SECRET: secret });
    const peer = new WebSocket(gameUrl.replace('http:', 'ws:'), { origin: parentUrl });
    peers.add(peer);
    await once(peer, 'open');
    const accepted = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Roster peer did not join')), 5000);
      peer.on('message', bytes => {
        if (JSON.parse(String(bytes)).t === 'hello') { clearTimeout(timer); resolve(); }
      });
    });
    peer.send(JSON.stringify({ t: 'giggleJoin', ticket, n: userId }));
    await accepted;
    return peer;
  }

  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--mute-audio', '--deny-permission-prompts'] });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, permissions: [] }), page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(parentUrl); await page.locator('html[data-authorized="true"]').waitFor();
    ok(new URL(await page.locator('iframe').getAttribute('src')).origin !== parentUrl, 'actual cross-origin frame');
    const frame = page.frameLocator('iframe');
    for (const id of ['chess', 'ludo', 'doodle-guess']) {
      const opener = frame.locator(`[data-how="${id}"]`).first(); await opener.click();
      ok(await frame.locator('#howtoClose').evaluate(el => document.activeElement === el), 'dialog focuses Close');
      await page.keyboard.press('Tab'); ok(await frame.locator('.howto-dlg').evaluate(el => el.contains(document.activeElement)), 'Tab stays inside native dialog');
      // A real signed join rebuilds the whole lobby while the native dialog
      // is open. It must keep the dialog's own focus, not focus a card behind it.
      const staleOpener = await opener.elementHandle();
      const dialogPeer = await addPeer();
      await staleOpener.waitForElementState('hidden');
      ok(await frame.locator('.howto-dlg').evaluate(el => el.contains(document.activeElement)), 'roster repaint leaves native dialog focus alone');
      await page.keyboard.press('Escape');
      await frame.locator('.howto-dlg').waitFor({ state: 'detached' });
      ok(await opener.evaluate(el => document.activeElement === el), 'Escape restores live same-game opener after repaint');
      // A second real roster change after Escape replaces that focused card.
      // Restore the replacement synchronously; do not wait for a focus timer.
      const focusedOpener = await opener.elementHandle();
      dialogPeer.close();
      await focusedOpener.waitForElementState('hidden');
      ok(await opener.evaluate(el => document.activeElement === el), 'roster repaint preserves the focused live same-game card');
      await staleOpener.dispose(); await focusedOpener.dispose();
    }
    ok(errors.length === 0, 'no console/script errors: ' + JSON.stringify(errors));
    const permissions = await page.evaluate(async () => Promise.all(['camera', 'microphone'].map(async name => (await navigator.permissions.query({ name })).state)));
    ok(permissions.every(state => state === 'denied'), 'device permissions denied');
    await context.close();
  }
  console.log(`CANONICAL_BRIDGE_BROWSER_PASS: ${checks} checks; actual signed cross-origin iframe, explicit focus, Tab/Escape and strict console`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const peer of peers) peer.terminate();
  if (browser) await browser.close(); if (child) { child.kill(); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); }
  if (parent) { parent.closeAllConnections(); await new Promise(r => parent.close(r)); }
  fs.rmSync(scratch, { recursive: true, force: true });
});
