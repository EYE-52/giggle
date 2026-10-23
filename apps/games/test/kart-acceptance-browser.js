'use strict';
// Local diagnostics around the real app and WebSocket server. No game state,
// clock, map, inventory, collision or physics override. Held input is explicitly
// synthetic DOM input; this is not evidence of a physical held key or phone.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const upstreamPort = Number(process.env.KART_ACCEPTANCE_UPSTREAM || 8447);
const port = Number(process.env.PORT || 8448);
const directory = process.env.KART_ACCEPTANCE_EVIDENCE || '/tmp/giggle-kart-acceptance-20261009';
const source = path.join(__dirname, 'fixtures/kart-acceptance-input.js');
let jitterUntil = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__qa/jitter' && req.method === 'POST') {
    jitterUntil = Date.now() + 5000;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ durationMs: 5000, delaysMs: [0, 180, 40, 260, 70], preservesOrder: true,
      scope: 'Actual upstream frames delayed in order for QA proxy sockets; game authority and payloads unchanged' }));
  }
  if (url.pathname === '/__qa/viewport') {
    const width = Math.max(280, Math.min(1280, Number(url.searchParams.get('width')) || 390));
    const height = Math.max(260, Math.min(1000, Number(url.searchParams.get('height')) || 844));
    const room = String(url.searchParams.get('room') || '');
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(room)) { res.writeHead(400); return res.end('QA room code required'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html><meta charset="utf-8"><title>Kart viewport diagnostic</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#112433;color:#fff;font:14px system-ui}iframe{display:block;border:1px solid #99cadb;margin:16px auto}</style><h1>Actual app inside ${width} × ${height} CSS-pixel iframe</h1><p>Viewport fixture, native desktop input capabilities. Explicit Touch selection is a control-layout check; no physical phone claim.</p><iframe title="Actual game viewport" src="/r/${room}" width="${width}" height="${height}"></iframe>`);
  }
  if (req.url === '/__qa/input.js') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(fs.readFileSync(source));
  }
  if (req.url === '/__qa/report' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 600000) { res.writeHead(413); return res.end('Too large'); }
    }
    try {
      const data = JSON.parse(body);
      fs.mkdirSync(directory, { recursive: true });
      const file = `${Date.now()}-${String(data.label || 'report').replace(/[^a-z0-9-]/gi, '-').slice(0, 60)}.json`;
      fs.writeFileSync(path.join(directory, file), JSON.stringify(data, null, 2));
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ file }));
    } catch { res.writeHead(400); return res.end('Bad report'); }
  }
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  // Mirror only this loopback fixture's own origin across its local proxy.
  // Other origins retain the production authority's rejection.
  if (headers.origin === `http://127.0.0.1:${port}`) headers.origin = `http://127.0.0.1:${upstreamPort}`;
  const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url,
    method: req.method, headers }, response => {
    const html = String(response.headers['content-type']).includes('text/html');
    if (!html) { res.writeHead(response.statusCode, response.headers); response.pipe(res); return; }
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const body = Buffer.from(Buffer.concat(chunks).toString().replace('</head>', '<script src="/__qa/input.js"></script></head>'));
      res.writeHead(response.statusCode, { ...response.headers, 'content-length': body.length }); res.end(body);
    });
  });
  upstream.on('error', () => { res.writeHead(502); res.end('Start the isolated production server first.'); });
  req.pipe(upstream);
});
const wsServer = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => wsServer.handleUpgrade(req, socket, head, downstream => {
  const upstream = new WebSocket(`ws://127.0.0.1:${upstreamPort}`, { origin: `http://127.0.0.1:${upstreamPort}` });
  const queue = [];
  downstream.on('message', (message, binary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(message, { binary });
    else if (queue.length < 32) queue.push([message, binary]);
  });
  upstream.on('open', () => { for (const [message, binary] of queue.splice(0)) upstream.send(message, { binary }); });
  let releaseAt = 0, frame = 0, releaseTimer;
  const pending = [];
  const flush = () => {
    releaseTimer = undefined;
    while (pending.length && pending[0].releaseAt <= Date.now()) {
      const { message, binary } = pending.shift();
      if (downstream.readyState === WebSocket.OPEN) downstream.send(message, { binary });
    }
    if (pending.length) releaseTimer = setTimeout(flush, Math.max(0, pending[0].releaseAt - Date.now()));
  };
  upstream.on('message', (message, binary) => {
    const now = Date.now(), delay = now < jitterUntil ? [0, 180, 40, 260, 70][frame++ % 5] : 0;
    releaseAt = Math.max(releaseAt, now + delay);
    pending.push({ message, binary, releaseAt });
    if (releaseTimer === undefined) flush();
  });
  downstream.on('close', () => { clearTimeout(releaseTimer); pending.length = 0; });
  downstream.on('close', () => upstream.close()); upstream.on('close', () => downstream.close());
  downstream.on('error', () => upstream.close()); upstream.on('error', () => downstream.close());
}));
server.listen(port, '127.0.0.1', () => console.log(`KART_ACCEPTANCE http://127.0.0.1:${port}; actual upstream ${upstreamPort}; synthetic held DOM keys only`));
