// Gallery server: serves a giggle-games checkout's public/ and answers its
// WebSocket with one recorded snapshot. The embed ticket names the moment:
// "<game>:<snapIndex>:<pid>". A parent page on PPORT frames it like Giggle.
// Usage: node serve.js <repoPath> <gamePort> <parentPort> [snapsDir]
const [REPO_ARG = require('path').join(__dirname, '..', '..'), GP = '8150', PP = '8151', SNAPS = __dirname + '/snaps'] = process.argv.slice(2);
const REPO = require('path').resolve(REPO_ARG);
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require(REPO + '/node_modules/ws');
const registry = require(REPO + '/games/registry');
const PUBLIC = path.join(REPO, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const parentOrigin = `http://127.0.0.1:${PP}`;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(String(req.url).split('?')[0]);
  if (p === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, bridgeVersion: 1, giggleEnabled: true, giggleAllowedOrigins: [parentOrigin], allowHttp: true, websocketUrl: '' }));
  }
  let file = path.normalize(path.join(PUBLIC, p));
  if (p.startsWith('/r/')) file = path.join(PUBLIC, 'index.html');
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  let snap = null, game = null, pid = null, t0 = Date.now();
  // Standalone mode: the moment comes from a 'gal' cookie instead of a ticket.
  const cookie = /(?:^|;\s*)gal=([^;]+)/.exec(req.headers.cookie || '');
  const soloTicket = cookie ? decodeURIComponent(cookie[1]) : null;
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'clock') return send({ t: 'clock', id: msg.id, serverNow: Date.now() });
    if (msg.t === 'games') return send({ t: 'games', games: registry.list() });
    if ((msg.t === 'join' || msg.t === 'create') && soloTicket) { msg = { t: 'giggleJoin', ticket: soloTicket, solo: true }; }
    if (msg.t === 'giggleJoin' || msg.t === 'giggleRenew') {
      const [g, idx, who] = String(msg.ticket).split(':');
      const snaps = JSON.parse(fs.readFileSync(path.join(SNAPS, g + '.json'), 'utf8'));
      snap = snaps[+idx]; game = g;
      // Recorded on a virtual clock: shift every timestamp onto real time.
      const delta = Date.now() - snap.now;
      const shift = (o) => { if (Array.isArray(o)) return o.map(shift); if (o && typeof o === 'object') { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = (typeof v === 'number' && v > 1e12 && v < 3e12) ? v + delta : shift(v); return r; } return o; };
      snap = { ...snap, views: shift(snap.views), now: snap.now + delta }; pid = who || snap.players[0].id; t0 = Date.now();
      const players = snap.players.map((x) => ({ id: x.id, name: x.name, connected: true }));
      const spectator = !players.some((x) => x.id === pid);
      const def = registry.get(g);
      send({ t: 'hello', you: pid, name: spectator ? 'Watcher' : players.find((x) => x.id === pid).name, code: 'GALY', ...(msg.solo ? { seatToken: 'tok' } : { giggle: true }), ...(msg.n ? { n: msg.n } : {}) });
      send({ t: 'games', games: registry.list() });
      const seats = def.manifest && def.manifest.seats;
      const allPlayers = spectator ? players.concat([{ id: pid, name: 'Watcher', connected: true }]) : players;
      send({ t: 'room', room: { code: 'GALY', players: allPlayers, totals: snap.totals, game: g, hostId: snap.hostId, config: {}, instanceId: 'gal-' + g, participants: players, spectators: spectator ? [{ id: pid, name: 'Watcher' }] : [], ...(seats ? { seats } : {}) } });
      const view = snap.views[pid] || snap.views[Object.keys(snap.views)[0]];
      send({ t: 'state', game: g, instanceId: 'gal-' + g, w: snap.w, you: pid, spectator, players, participants: players, spectators: spectator ? [{ id: pid, name: 'Watcher' }] : [], totals: snap.totals, matchScores: snap.totals, ...view, serverNow: snap.now, phaseStartedAt: snap.now - 4000 });
    }
  });
});
server.listen(+GP, '127.0.0.1');
// Parent page: frames the child like Giggle and hands it the snapshot "ticket".
http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const ticket = q.get('m') || '';
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#171922"><iframe id=f style="border:0;width:100vw;height:100vh" src="http://127.0.0.1:${GP}/?embed=1&parentOrigin=${encodeURIComponent(parentOrigin)}"></iframe>
<script>const f=document.getElementById('f');let n=0;
addEventListener('message',(e)=>{if(e.source!==f.contentWindow)return;const d=e.data||{};
if(d.t==='ready'){f.contentWindow.postMessage({v:1,t:'context',theme:'night'},'http://127.0.0.1:${GP}');}
if(d.t==='ready'||d.t==='auth-needed'){f.contentWindow.postMessage({v:1,t:'auth',ticket:${JSON.stringify(ticket)},n:'n'+(++n)},'http://127.0.0.1:${GP}');}});</script>`);
}).listen(+PP, '127.0.0.1');
console.log('gallery on', GP, 'parent', PP);
