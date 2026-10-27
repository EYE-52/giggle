'use strict';
/* Split-host check: Vercel static frontend (https://play.gigglemeet.com)
 * + one Railway backend process (giggle-play).
 * A. Client WS-target helper (exact ESM bytes): safe origins accepted,
 *    invalid URLs rejected, unset falls back to same-host ('').
 * B. vercel.json: ONLY the two HTTP backend rewrites + the /r route, exact
 *    CSP, no wildcard/secret/WS proxy; client/server/ignore wiring statics.
 * C. Split-prod server: /config.json carries the validated websocketUrl
 *    (never secrets/tickets); the WS gate accepts exactly PUBLIC_GAME_URL,
 *    keeps same-host/local + exact Giggle origins, rejects arbitrary
 *    preview/evil origins.
 * D. Invalid env: malformed URLs yield no override and no trust; legacy
 *    local sockets still work.
 * E. No split env at all: legacy same-host local preview, unchanged.
 * Boots scratch servers; no browser needed. Run: npm run test:splithost */
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SPLIT_PORT = 18240;
const INVALID_PORT = 18241;
const LOCAL_PORT = 18242;
const SECRET = 'test-split-secret-0123456789abcdef-0123456789';
const PLAY_ORIGIN = 'https://play.gigglemeet.com';
const WS_ORIGIN = 'wss://giggle-play-production.up.railway.app';
const GIGGLE_ORIGIN = 'https://www.gigglemeet.com';
const STABLE_ALIAS = 'https://giggle-play.vercel.app';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let children = [];
async function boot(port, extraEnv) {
  const srv = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1',
      GAME_BRIDGE_SECRET: SECRET,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(srv);
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  assert(out.includes('PartyBox on'), `server did not boot on ${port}: ${out}`);
  return { srv, out: () => out };
}

function rawGet(port, target) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${target} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    sock.on('data', (d) => { data += d.toString('latin1'); });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

function statusOf(res) {
  const m = /^HTTP\/\d[\d.]* (\d+)/.exec(res);
  return m ? Number(m[1]) : -1;
}

async function main() {
  const logs = [];
  const sockets = [];
  const die = (msg) => {
    console.error('SPLITHOST_FAIL', msg, '\n--- server logs ---\n' + logs.map((l) => l()).join('\n'));
    for (const s of sockets) try { s.close(); } catch {}
    for (const c of children) try { c.kill(); } catch {}
    process.exit(1);
  };
  process.on('uncaughtException', (e) => die(e.stack || String(e)));

  /* ---- A. client WS-target helper (exact ESM bytes via data URL) ---- */
  const netSrc = fs.readFileSync(path.join(ROOT, 'public/js/netconfig.js'), 'utf8');
  const netcfg = await import('data:text/javascript;base64,' + Buffer.from(netSrc).toString('base64'));
  assert(netcfg.isValidWebsocketUrl(WS_ORIGIN), 'deployment wss origin accepted');
  assert(netcfg.isValidWebsocketUrl('wss://backend.test:8443'), 'wss with port accepted');
  assert(!netcfg.isValidWebsocketUrl('ws://127.0.0.1:8125'), 'ws: rejected unless allowed');
  assert(netcfg.isValidWebsocketUrl('ws://127.0.0.1:8125', { allowWs: true }), 'ws: allowed for local pages');
  for (const bad of ['', null, undefined, 42, 'notaurl', 'http://x.test', 'https://x.test',
      'ftp://x.test', 'wss://user@h.test', 'wss://u:p@h.test', 'wss://h.test/path',
      'wss://h.test/?q=1', 'wss://h.test/#f', 'wss://h.test:bad', '   ']) {
    assert(!netcfg.isValidWebsocketUrl(bad), `invalid ws url rejected: ${JSON.stringify(bad)}`);
  }
  assert.equal(netcfg.wsTargetFromConfig({ websocketUrl: WS_ORIGIN }), WS_ORIGIN, 'override resolves');
  assert.equal(netcfg.wsTargetFromConfig({ websocketUrl: 'ws://127.0.0.1:8125' }, { allowWs: true }),
    'ws://127.0.0.1:8125', 'local ws override resolves');
  assert.equal(netcfg.wsTargetFromConfig({}), '', 'unset falls back to same-host');
  assert.equal(netcfg.wsTargetFromConfig(null), '', 'null config falls back to same-host');
  assert.equal(netcfg.wsTargetFromConfig({ websocketUrl: 'http://evil.test' }), '',
    'unsafe override rejected to same-host');
  assert.equal(netcfg.wsTargetFromConfig({ websocketUrl: 42 }), '', 'non-string rejected');
  console.log('SPLITHOST ok: client ws-target validation + same-host fallback');

  /* ---- B. vercel.json + wiring statics ---- */
  const vercelRaw = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  const vercel = JSON.parse(vercelRaw);
  assert.equal(vercel.framework, null, 'no framework');
  assert.equal(vercel.outputDirectory, 'public', 'Vercel serves local assets');
  assert.equal(vercel.installCommand, 'npm ci', 'locked install');
  assert.equal(vercel.buildCommand, 'npm run build', 'production generates vendor assets and every registry game page');
  const buildPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(buildPkg.scripts.build, /vendor/);
  assert.match(buildPkg.scripts.build, /build:pages/);
  assert.equal(vercel.rewrites.length, 5, 'Only config, QR, two report endpoints and the room route');
  assert.deepEqual(vercel.rewrites[0], {source:'/api/reports', destination:'https://giggle-play-production.up.railway.app/api/reports'});
  assert.deepEqual(vercel.rewrites[1], {source:'/api/reports/:id', destination:'https://giggle-play-production.up.railway.app/api/reports/:id'});
  assert.deepEqual(vercel.rewrites[2],
    { source: '/config.json', destination: 'https://giggle-play-production.up.railway.app/config.json' },
    'config rewrite exact');
  assert.deepEqual(vercel.rewrites[3],
    { source: '/qr.svg', destination: 'https://giggle-play-production.up.railway.app/qr.svg' },
    'qr rewrite exact');
  assert.deepEqual(vercel.rewrites[4], { source: '/r/:code', destination: '/index.html' }, 'room route local');
  for (const r of vercel.rewrites) {
    assert(!r.destination.includes('?'), 'no declared query, so Vercel forwards the incoming query');
  }
  const external = vercel.rewrites.filter((r) => /^https?:\/\//.test(r.destination));
  assert.equal(external.length, 4, 'four bounded backend HTTP endpoints');
  assert(!vercelRaw.includes('wss:') && !vercelRaw.includes('"ws:'), 'no WS proxy through Vercel');
  assert(!vercelRaw.includes('*'), 'no wildcard anywhere');
  assert(!/secret|ticket|GAME_BRIDGE/i.test(vercelRaw), 'no secret material');
  assert(!/permissions-policy|allow=/i.test(vercelRaw), 'no iframe permission grants');
  const csp = "frame-ancestors 'self' https://www.gigglemeet.com";
  assert.equal(vercel.headers.length, 3, 'CSP on the framable documents only');
  assert.deepEqual(vercel.headers.map((h) => h.source).sort(), ['/', '/index.html', '/r/:code'].sort(),
    'CSP covers /, /index.html, /r/:code');
  for (const h of vercel.headers) {
    assert.equal(h.headers.length, 1, 'CSP is the only header');
    assert.equal(h.headers[0].key, 'Content-Security-Policy', 'header is CSP');
    assert.equal(h.headers[0].value, csp, 'frame-ancestors self + exact giggle origin');
  }
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  assert(app.includes("from './netconfig.js'"), 'shell uses the target helper');
  assert(app.includes('loadPublicConfig'), 'config-first connect');
  assert(app.includes('wsTargetFromConfig(publicConfig'), 'validated override dialed');
  assert(app.includes('connectPending'), 'single in-flight resolution, no duplicate sockets');
  assert(app.includes('function openSocket()'), 'one socket opener');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
  assert(serverSrc.includes('PUBLIC_WEBSOCKET_URL'), 'server reads the ws env');
  assert(serverSrc.includes('websocketUrl: publicWebsocketUrl()'), 'config carries the validated url');
  assert(serverSrc.includes('origin === playOrigin'), 'exact play-origin match');
  assert(!serverSrc.includes('*.vercel.app'), 'no vercel wildcard in the origin gate');
  for (const f of ['.gitignore', '.railwayignore', '.vercelignore']) {
    const rules = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#'));
    assert(rules.includes('node_modules/'), `${f} excludes installs`);
    assert(rules.some((l) => l.startsWith('.env')), `${f} excludes env files`);
    assert(rules.includes('!.env.example'), `${f} keeps the inert sample`);
    assert(rules.includes('secrets/') && rules.includes('screens/'), `${f} excludes secrets/screens`);
    // Explicit development fixture exclusion is safe. Any broader public
    // path, game code, vendored library or licensed runtime art stays guarded.
    const developmentOnly = new Set(['public/fixtures/', 'public/test/']);
    assert(!rules.some((l) => !developmentOnly.has(l) && /games|public|vendor|scripts|locales/.test(l)),
      `${f} hides no game or licensed asset`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.engines && pkg.engines.node, '24.x', 'Node 24 engines');
  console.log('SPLITHOST ok: vercel.json shape + wiring + ignores + engines');

  const mk = (port, origin) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : undefined);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    ws.on('open', () => { sockets.push(ws); resolve(ws); });
    ws.on('error', reject);
  });
  const send = (ws, o) => ws.send(JSON.stringify(o));
  const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);

  /* ---- C. split-prod server ---- */
  const split = await boot(SPLIT_PORT, {
    NODE_ENV: 'production',
    PUBLIC_GAME_URL: PLAY_ORIGIN,
    PUBLIC_WEBSOCKET_URL: WS_ORIGIN,
    GIGGLE_ALLOWED_ORIGINS: GIGGLE_ORIGIN,
    STANDALONE_ALLOWED_ORIGINS: STABLE_ALIAS,
  });
  logs.push(split.out);
  let res = await rawGet(SPLIT_PORT, '/config.json');
  assert.equal(statusOf(res), 200, 'split /config.json serves');
  const body = res.slice(res.indexOf('\r\n\r\n') + 4);
  const cfg = JSON.parse(body);
  assert.equal(cfg.ok, true, 'config ok');
  assert.equal(cfg.websocketUrl, WS_ORIGIN, 'config carries the validated ws origin');
  assert.deepEqual(cfg.giggleAllowedOrigins, [GIGGLE_ORIGIN], 'config lists the giggle origin');
  assert(!cfg.giggleAllowedOrigins.includes(STABLE_ALIAS), 'stable alias is WS-only, never Giggle trust');
  assert(!body.includes(SECRET), 'config leaks no secret');
  assert(!/ticket/i.test(body), 'config carries no ticket material');
  assert(res.includes('frame-ancestors') && res.includes("'self'") && res.includes(GIGGLE_ORIGIN),
    'backend framing stays self + exact giggle origin');
  const play = await mk(SPLIT_PORT, PLAY_ORIGIN);
  send(play, { t: 'create', name: 'Vera' });
  await sleep(150);
  assert(last(play, 'hello') && last(play, 'room'), 'exact play frontend accepted');
  const stable = await mk(SPLIT_PORT, STABLE_ALIAS);
  send(stable, { t: 'create', name: 'Ali' });
  await sleep(150);
  assert(last(stable, 'hello') && last(stable, 'room'), 'stable own alias accepted');
  const gig = await mk(SPLIT_PORT, GIGGLE_ORIGIN);
  gig.close();
  for (const bad of ['https://partygames-xyz123.vercel.app', 'https://giggle-play-xyz123.vercel.app',
      'https://evil.test', 'http://play.gigglemeet.com',
      'https://play.gigglemeet.com.evil.test', PLAY_ORIGIN + '/']) {
    await assert.rejects(mk(SPLIT_PORT, bad), /403/, `preview/evil origin rejected: ${bad}`);
  }
  const bare = await mk(SPLIT_PORT);
  bare.close();
  const sameHost = await mk(SPLIT_PORT, `http://127.0.0.1:${SPLIT_PORT}`);
  sameHost.close();
  console.log('SPLITHOST ok: split config + exact play origin + giggle/same-host kept + previews rejected');

  /* ---- D. invalid env: no override, no trust, legacy works ---- */
  const invalid = await boot(INVALID_PORT, {
    NODE_ENV: 'production',
    PUBLIC_GAME_URL: 'notaurl',
    PUBLIC_WEBSOCKET_URL: 'ws://127.0.0.1:9',
    GIGGLE_ALLOWED_ORIGINS: GIGGLE_ORIGIN,
  });
  logs.push(invalid.out);
  res = await rawGet(INVALID_PORT, '/config.json');
  const badCfg = JSON.parse(res.slice(res.indexOf('\r\n\r\n') + 4));
  assert.equal(badCfg.websocketUrl, '', 'ws: rejected in production, malformed yields no override');
  await assert.rejects(mk(INVALID_PORT, PLAY_ORIGIN), /403/, 'unconfigured play origin rejected');
  const legacyD = await mk(INVALID_PORT);
  send(legacyD, { t: 'create', name: 'Lee' });
  await sleep(150);
  assert(last(legacyD, 'hello'), 'legacy socket works with invalid env');
  console.log('SPLITHOST ok: invalid env rejected, legacy intact');

  /* ---- E. no split env: legacy same-host local preview ---- */
  const local = await boot(LOCAL_PORT, {
    NODE_ENV: 'test',
    PUBLIC_GAME_URL: '',
    PUBLIC_WEBSOCKET_URL: '',
  });
  logs.push(local.out);
  res = await rawGet(LOCAL_PORT, '/config.json');
  const localCfg = JSON.parse(res.slice(res.indexOf('\r\n\r\n') + 4));
  assert.equal(localCfg.websocketUrl, '', 'unset env yields empty setting (same-host fallback)');
  const legacyE = await mk(LOCAL_PORT);
  send(legacyE, { t: 'create', name: 'Loc' });
  await sleep(150);
  assert(last(legacyE, 'hello') && last(legacyE, 'room'), 'local same-host play works without env changes');
  const localSame = await mk(LOCAL_PORT, `http://127.0.0.1:${LOCAL_PORT}`);
  localSame.close();
  console.log('SPLITHOST ok: legacy local preview without env changes');

  for (const s of sockets) try { s.close(); } catch {}
  for (const c of children) try { c.kill(); } catch {}
  console.log('SPLITHOST_PASS');
}

main().catch((e) => {
  console.error('SPLITHOST_FAIL', e);
  for (const c of children) try { c.kill(); } catch {}
  process.exit(1);
});
