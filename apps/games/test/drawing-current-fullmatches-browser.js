'use strict';
// Native browser entry point. --verify checks serving/WS contracts without a browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { Room } = require('../server/room');
const defs = { 'doodle-guess': require('../games/doodle-guess/server'), 'draw-phone': require('../games/draw-phone/server') };
const publicRoot = path.resolve(__dirname, '../public');
const helperRoot = path.resolve(__dirname, 'fixtures/drawing-current-fullmatches');
const reportDirectory = process.env.DRAWING_FULL_REPORT_DIR || path.resolve(__dirname, '../evidence/quality-20261009/drawing-current-fullmatches');

function createSession(id, hints = true) {
  const game = defs[id];
  if (!game) throw Error('Unknown drawing game');
  const pack = require('../locales/en/' + id + '.json');
  const room = new Room('DFQ', { [id]: pack });
  const bot = () => ({ readyState: 1, bufferedAmount: 0, send() {}, close() {} });
  const roles = Object.fromEntries(['a', 'b', 'c'].map((role, i) => [role, room.addPlayer(['Ada', 'Bo', 'Cam'][i], bot()).player]));
  const settings = id === 'doodle-guess' ? { rounds: 3, roundSeconds: 10, hints } : { writeSeconds: 10, drawSeconds: 30, guessSeconds: 10 };
  const started = room.startGame(game, { ready: true, settings }, roles.a.id);
  if (!started.ok) { room.destroy(); throw Error(started.error); }
  roles.watcher = room.addPlayer('Late watcher', bot()).player;
  // Keep the production clock, ctx.later scheduler, readiness and shuffle intact.
  return { room, game, roles, settings };
}

function reportMarkup() {
  const source = fs.readFileSync(path.join(publicRoot, 'js/app.js'), 'utf8');
  const declaration = source.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)?.[0];
  if (!declaration) throw Error('Production Report button declaration unavailable');
  return vm.runInNewContext(declaration + "\nreportButton('game-report-icon')", {}, { timeout: 1000 });
}

function clientPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Current drawing match client</title>
<link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/issues.css">
<style>body{margin:0;padding:0}.app{width:100%;max-width:none;margin:0;padding:0}[hidden]{display:none!important}#fixture-error{position:fixed;bottom:0;left:0;background:#711b35;color:white;z-index:99}#fixture-rematch{display:flex;justify-content:center;padding:12px}#fixture-rematch button{min-height:44px}</style>
<body class="game-playing"><main class="app"><header class="play-toolbar"><details class="room-menu" id="roomMenu"><summary aria-label="Room controls"><span>Room</span></summary><div class="room-menu-panel" role="dialog" aria-label="Fixture room"><p>Production Room and independent client; this drawer is fixture chrome.</p><button class="room-resume" id="bRoomResume">Back to game</button></div></details>${reportMarkup()}</header>
<main class="game-stage"><div class="game-clock"><div class="timerbar" id="tbar" hidden><div></div></div><div class="timertext" id="ttime" hidden></div></div><div id="gbody" data-layout="standard"></div><div id="fixture-rematch" hidden><button class="btn" id="bRematch">Rematch</button></div></main></main><p id="fixture-error" hidden></p><script type="module" src="/qa/client.mjs"></script></html>`;
}

function hubPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current drawing full matches</title>
<style>body{margin:16px;background:#171922;color:#f5f6fa;font:16px/1.5 system-ui}header{display:flex;gap:8px;flex-wrap:wrap}button,select{min-height:44px;font:inherit;padding:8px}article{margin:12px 0}h2{font-size:16px}iframe{display:block;border:0;background:white}#status{white-space:pre-wrap}a{color:#ffc6de}</style>
<h1>Current drawing full matches</h1><p>Production Room, timers, client and readiness. Inputs are dispatched by this visible fixture. No clock, position or authority override. Doodle runs three artists; Draw Phone uses its real 30-second drawing deadline. No automatic run on load.</p>
<header><select id="mode" aria-label="Match"><option value="doodle-guess:on">Doodle Guess · hints on</option><option value="doodle-guess:off">Doodle Guess · hints off</option><option value="draw-phone:on">Draw Phone</option></select><select id="size" aria-label="Client viewport"><option value="1024,600">1024 × 600</option><option value="390,844">390 × 844</option><option value="568,320">568 × 320</option></select><button id="run">Run selected full match + lifecycle</button><button id="stop" disabled>Stop and retire room</button><select id="role" aria-label="Show role"><option>a</option><option>b</option><option>c</option><option>watcher</option></select><button id="show">Show role</button></header><pre id="status">Ready. Choose a match and press Run.</pre><main id="clients"></main><script type="module" src="/qa/hub.mjs"></script></html>`;
}

function createServer(directory = reportDirectory) {
  const sessions = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/session' && req.method === 'POST') {
      try { const session = randomUUID(), s = createSession(u.searchParams.get('game'), u.searchParams.get('hints') !== 'off'); sessions.set(session, s); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ session, game: s.game.id, roles: Object.keys(s.roles), settings: s.settings })); }
      catch (e) { res.statusCode = 400; res.end(e.message); } return;
    }
    if (u.pathname === '/close' && req.method === 'POST') { sessions.get(u.searchParams.get('session'))?.room.destroy(); sessions.delete(u.searchParams.get('session')); res.end('closed'); return; }
    if (u.pathname === '/results' && req.method === 'POST') {
      const name = u.searchParams.get('name');
      if (!/^(doodle-guess-hints-(on|off)|draw-phone)-(fullmatch|failure)$/.test(name || '')) { res.statusCode = 400; res.end('Invalid report name'); return; }
      let body = ''; req.on('data', d => { body += d; if (body.length > 250000) req.destroy(); });
      req.on('end', () => { try { const report = JSON.parse(body); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(report, null, 2)); res.end('saved'); } catch (e) { res.statusCode = 400; res.end(e.message); } }); return;
    }
    if (u.pathname === '/' || u.pathname === '/client') { res.setHeader('Content-Type', 'text/html'); res.end(u.pathname === '/' ? hubPage() : clientPage()); return; }
    const helper = u.pathname.startsWith('/qa/');
    const base = helper ? helperRoot : publicRoot;
    const file = path.resolve(base, '.' + (helper ? u.pathname.slice(3) : u.pathname));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('Not found'); return; }
    const ext = path.extname(file);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  const wss = new WebSocketServer({ server, path: '/socket' });
  wss.on('connection', ws => { let session; ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      if (m.t === 'join') { session = sessions.get(m.session); const p = session?.roles[m.role]; if (!p) throw Error('Fixture room unavailable'); const joined = session.room.addPlayer(p.name, ws, p.token); if (joined.error) throw Error(joined.error); session.room.broadcastLobby(); session.room.broadcastState(); }
      else if (session && m.t === 'game-ready') session.room.onReady(ws, { i: m.i, w: m.w });
      else if (session && m.t === 'action') { const before = JSON.stringify(session.room.game?.state); session.room.onAction(ws, m.a, { i: m.i, w: m.w }); ws.send(JSON.stringify({ t: 'qa-ack', qaId: m.qaId, accepted: before !== JSON.stringify(session.room.game?.state), instanceId: session.room.game?.instanceId })); }
      else if (session && m.t === 'rematch') { const r = session.room.startGame(session.game, { ready: true, settings: session.settings }, session.room.bySocket(ws)?.id); if (!r.ok) throw Error(r.error); }
      else throw Error('Unsupported fixture command');
    } catch (e) { ws.send(JSON.stringify({ t: 'qa-error', message: e.message })); }
  }); ws.on('close', () => session?.room.disconnect(ws)); });
  const heartbeat = setInterval(() => { for (const s of sessions.values()) s.room.onTick(Date.now()); }, 100);
  server.on('close', () => { clearInterval(heartbeat); for (const s of sessions.values()) s.room.destroy(); wss.close(); });
  return server;
}

module.exports = { createServer, createSession, clientPage, hubPage };
if (require.main === module) {
  if (process.argv.includes('--verify')) require('./fixtures/drawing-current-fullmatches/verify.cjs').verify().catch(e => { console.error(e); process.exitCode = 1; });
  else { const port = Number(process.env.DRAWING_FULL_QA_PORT || 8451); createServer().listen(port, '127.0.0.1', () => console.log('Current drawing full matches: http://127.0.0.1:' + port + '/')); }
}
