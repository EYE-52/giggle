'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

(async () => {
  const html = read('index.html');
  assert(html.includes('<title>Giggle Games — Free multiplayer games with friends</title>'));
  assert(html.includes('<link rel="canonical" href="https://play.gigglemeet.com/">'));
  const home = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const website = home['@graph'].find(item => item['@type'] === 'WebSite');
  const organization = home['@graph'].find(item => item['@type'] === 'Organization');
  assert.equal(website.name, 'Giggle Games');
  assert.equal(website.alternateName, 'Game Night by Giggle');
  assert.equal(website.publisher['@id'], organization['@id']);
  assert.equal(organization.logo.url, 'https://play.gigglemeet.com/pwa-512.png');
  const logo = fs.readFileSync(path.join(PUBLIC, 'pwa-512.png'));
  assert.equal(logo.readUInt32BE(16), 512);
  const image = fs.readFileSync(path.join(PUBLIC, 'og.png'));
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.equal(JSON.parse(read('manifest.webmanifest')).name, 'Giggle Games');
  const robots = read('robots.txt');
  assert(robots.includes('Sitemap: https://play.gigglemeet.com/sitemap.xml'));
  assert(!/Disallow:.*\/r\//.test(robots), 'Crawlers can read room noindex headers');
  assert(read('404.html').includes('content="noindex,follow"'));

  // Exercise the published static files with the exact configured room
  // rewrite and headers. This is a local config harness, not a Vercel deploy.
  const roomRewrite = config.rewrites.find(rule => rule.source === '/r/:code');
  assert.deepEqual(roomRewrite, { source: '/r/:code', destination: '/index.html' });
  const roomHeaders = config.headers.find(rule => rule.source === '/r/:code').headers;
  assert.equal(roomHeaders.find(header => header.key === 'X-Robots-Tag').value, 'noindex, nofollow');
  assert(roomHeaders.some(header => header.key === 'Content-Security-Policy'), 'Existing frame policy remains');
  const frontend = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://local').pathname;
    const room = /^\/r\/[^/]+\/?$/.test(route);
    if (room) for (const header of roomHeaders) res.setHeader(header.key, header.value);
    const file = path.join(PUBLIC, room ? roomRewrite.destination : route === '/' ? 'index.html' : route);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(read('404.html')); return; }
    res.writeHead(200); res.end(fs.readFileSync(file));
  });
  const frontPort = await listen(frontend);
  try {
    for (const route of ['/r/ABCD', '/r/EFGH?game=chess']) {
      const response = await fetch(`http://127.0.0.1:${frontPort}${route}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(await response.text(), html, 'Room rewrite keeps the actual app shell');
    }
    const homeResponse = await fetch(`http://127.0.0.1:${frontPort}/`);
    assert.equal(homeResponse.headers.get('x-robots-tag'), null);
    const unknown = await fetch(`http://127.0.0.1:${frontPort}/games/not-a-real-game/`);
    assert.equal(unknown.status, 404);
    assert((await unknown.text()).includes('noindex'));
  } finally { await new Promise(resolve => frontend.close(resolve)); }

  // Fresh, task-owned backend proves actual Node responses and WebSocket
  // upgrade handling. It never replaces or restarts the shared preview.
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server/server.js'], { cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), GAME_REPORT_DB: ':memory:' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  try {
    const deadline = Date.now() + 15000;
    while (!logs.includes('PartyBox on') && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert(logs.includes('PartyBox on'), 'Task-owned backend starts');
    const base = `http://127.0.0.1:${port}`;
    for (const route of ['/r/ABCD', '/r/EFGH?game=chess', '/%72/ABCD']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', route);
      assert.equal(await response.text(), html, route);
    }
    for (const route of ['/', '/games/chess/', '/config.json', '/robots.txt', '/sitemap.xml']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('x-robots-tag'), null, route);
    }
    for (const route of ['/missing-page', '/games/not-a-real-game/', '/games/!invalid']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 404, route);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', route);
    }
    const ws = new WebSocket(base.replace('http:', 'ws:'));
    try {
      await once(ws, 'open');
      const answer = once(ws, 'message');
      ws.send(JSON.stringify({ t: 'games' }));
      assert.equal(JSON.parse((await answer)[0]).t, 'games', 'WebSocket catalog still responds');
    } finally { ws.close(); }
    console.log('PASS Games SEO: homepage identity and assets; Vercel static config harness; actual Node room noindex, public pages, real 404s and WebSocket upgrade.');
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await once(child, 'exit');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
