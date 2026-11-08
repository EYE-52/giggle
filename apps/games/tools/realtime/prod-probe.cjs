'use strict';
// Smoothness probe for a hosted (or local) Pocket Karts server. One real
// driver in Chromium plus Node bot drivers. The browser's socket goes
// through a local relay that adds latency, jitter and TCP-style loss
// (a lost segment holds everything behind it until the retransmit), so
// "freeze then skip" can be reproduced on demand. Diagnostics are injected
// into the shipped prediction/interpolation modules at request time; the
// hosted code itself is untouched.
//
//   node tools/realtime/prod-probe.cjs [--url https://play.gigglemeet.com]
//     [--map "Garden Circuit"] [--bots 5] [--seconds 25]
//     [--rtt 0] [--jitter 0] [--loss 0] [--cpu 1] [--out dir] [--label name]
//
// --rtt adds round-trip ms on top of the real link, --jitter is the mean
// extra one-way delay (exponential), --loss is the fraction of frames that
// pay a retransmit (~RTO) penalty, --cpu throttles the page's CPU.
const { chromium } = require('playwright'), WebSocket = require('ws'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const URL_BASE = arg('url', 'https://play.gigglemeet.com'), MAP = arg('map', 'Garden Circuit');
const BOTS = +arg('bots', 5), SECONDS = +arg('seconds', 25), RTT = +arg('rtt', 0), JITTER = +arg('jitter', 0), LOSS = +arg('loss', 0), CPU = +arg('cpu', 1);
// --stall E,MIN,MAX: on average every E seconds the downlink holds for MIN..MAX ms
// (a Wi-Fi/mobile radio stall or TCP retransmit burst), then releases at once.
const STALL = (arg('stall', '') || '').split(',').map(Number), SEED = +arg('seed', 7);
const OUT = arg('out', '/tmp'), LABEL = arg('label', `${MAP.replace(/\W+/g, '-').toLowerCase()}-rtt${RTT}-j${JITTER}-l${LOSS}-cpu${CPU}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); } throw Error('timeout: ' + label); }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
const summary = xs => ({ n: xs.length, p50: pct(xs, .5), p95: pct(xs, .95), p99: pct(xs, .99), max: xs.length ? +Math.max(...xs).toFixed(2) : null });

// TCP-like impaired relay: per direction, frames keep order; each pays
// base + exponential jitter, a "lost" one pays an RTO and blocks the rest.
let seed = SEED; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function relay(upstream, origin) {
  const server = http.createServer(), wss = new WebSocket.Server({ server });
  const oneWay = RTT / 2, rto = Math.max(200, 2 * (RTT + 90));
  const jitter = () => (JITTER ? -Math.log(1 - rnd()) * JITTER : 0);
  const lane = (down) => { let last = 0, stallUntil = 0, nextStall = Date.now() + 2000; return (send) => { const t = Date.now(); if (!impair) { last = Math.max(last, t); nextStall = t + 1000; if (last > t) setTimeout(send, last - t); else send(); return; } if (down && STALL[0] > 0 && t >= nextStall) { stallUntil = t + STALL[1] + rnd() * (STALL[2] - STALL[1]); nextStall = stallUntil - Math.log(1 - rnd()) * STALL[0] * 1000; } let at = Math.max(t + oneWay + jitter(), down ? stallUntil : 0); if (LOSS && rnd() < LOSS) at += rto; at = Math.max(at, last); last = at; setTimeout(send, Math.max(0, at - Date.now())); }; };
  let connections = 0, impair = false;
  wss.on('connection', (client, req) => {
    connections++;
    const up = new WebSocket(upstream, { headers: { Origin: req.headers.origin || origin } }), toClient = lane(true), toServer = lane(false), pending = [];
    up.on('open', () => { for (const m of pending.splice(0)) up.send(m.data, { binary: m.binary }); });
    up.on('message', (data, binary) => toClient(() => client.readyState === 1 && client.send(data, { binary })));
    client.on('message', (data, binary) => toServer(() => { if (up.readyState === 1) up.send(data, { binary }); else pending.push({ data, binary }); }));
    const close = () => { try { client.close(); } catch {} try { up.close(); } catch {} };
    up.on('close', close); client.on('close', close); up.on('error', close); client.on('error', close);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, close: () => { wss.close(); server.close(); }, connections: () => connections, impair: on => { impair = on; } })));
}

// Diagnostics patched into the served modules. Each patch must match once.
// An entry is [from, to] or a list of alternatives (old and new code).
function patch(src, pairs, file) {
  for (const entry of pairs) {
    const options = Array.isArray(entry[0]) ? entry : [entry], hit = options.find(([from]) => src.includes(from));
    if (!hit) throw Error(`probe patch did not match in ${file}: ${options[0][0].slice(0, 60)}`);
    src = src.replace(hit[0], hit[1]);
  }
  return src;
}
const PATCHES = {
  'kart-classic-prediction.mjs': [
    ['if(reset){history=[]', "globalThis.__pkD?.('ingest',{reset,gap:now-lastAt,simAt,serverAt,now,hist:history.length});if(reset){history=[]"],
    [['correction=Math.hypot(offset.x,offset.y,offset.z)<=.75', "globalThis.__pkD?.('corr',{d:Math.hypot(offset.x,offset.y,offset.z),now});correction=Math.hypot(offset.x,offset.y,offset.z)<=.75"],
     ['counters.corrections++;', "globalThis.__pkD?.('corr',{d:error,now,snap:error>8||angle>Math.PI/3});counters.corrections++;"]],
    ['return {x:p.position.x,z:p.position.z,y:p.position.y,', "globalThis.__pkD?.('frame',{x:p.position.x,y:p.position.y,z:p.position.z,speed:self.speed,stale:now-lastAt>250,now,delay:remotes.stats().delay});return {x:p.position.x,z:p.position.z,y:p.position.y,"],
    ['let pose=remoteSample(pid,serverAt);if(!pose)return null;', "let pose=remoteSample(pid,serverAt);if(!pose)return null;globalThis.__pkD?.('remote',{pid,x:pose.position.x,z:pose.position.z,now});"],
  ],
  'client.mjs': [
    [['const ahead = Math.min(extrapolate, time - b.at) / 1000;', "const ahead = Math.min(extrapolate, time - b.at) / 1000; globalThis.__pkD?.('under', { by: time - b.at });"],
     ['const ahead = Math.min(extrapolate, Math.max(0, time - b.at)) / 1000;', "const ahead = Math.min(extrapolate, Math.max(0, time - b.at)) / 1000; if (time > b.at) globalThis.__pkD?.('under', { by: time - b.at });"]],
  ],
  'kart-elevated-pose.mjs': [
    ['lastFrame=Math.max(lastFrame??time,time);', "globalThis.__pkD?.('eframe',{time,played,latest,wanted});lastFrame=Math.max(lastFrame??time,time);"],
    ['offset=offset===null?arrival-at:Math.min(offset,arrival-at);', "offset=offset===null?arrival-at:Math.min(offset,arrival-at);globalThis.__pkD?.('eingest',{at,arrival});"],
  ],
  'kart-elevated-prediction.mjs': [
    [['if(reset){history=[]', "globalThis.__pkD?.('ingest',{reset,gap:arrival-lastArrival,simAt:snapshot.simAt,serverAt,now:arrival,hist:history.length});if(reset){history=[]"],
     ['if(changed||!fresh||snapshot.audioBaseline||arrival-lastArrival>250)history=[];', "globalThis.__pkD?.('ingest',{reset:changed||!fresh||snapshot.audioBaseline||arrival-lastArrival>250,gap:arrival-lastArrival,simAt:snapshot.simAt,serverAt,now:arrival,hist:history.length});if(changed||!fresh||snapshot.audioBaseline||arrival-lastArrival>250)history=[];"]],
    [['counters.corrections++;', "globalThis.__pkD?.('corr',{d:error,now:arrival,snap:error>8||angle>Math.PI/3});counters.corrections++;"],
     // Older raised prediction restored/replayed directly, without a blend.
     ['const changed=!lastSnapshot', "const probeBefore=physics.pose(kart.id);const changed=!lastSnapshot"]],
    [['return {...current,renderPose:p};', "globalThis.__pkD?.('frame',{x:p.position.x,y:p.position.y,z:p.position.z,speed:pose.speed,stale:arrival-lastArrival>250,now:arrival,delay:0});return {...current,renderPose:p};"],
     ['return {...current,renderPose:blendElevatedPose(priorPose?{...kart,pose:priorPose}:null,current,Math.max(0,Math.min(1,accumulator/dt)),renderOutput)};', "const p=blendElevatedPose(priorPose?{...kart,pose:priorPose}:null,current,Math.max(0,Math.min(1,accumulator/dt)),renderOutput);globalThis.__pkD?.('frame',{x:p.position.x,y:p.position.y,z:p.position.z,speed:pose.speed,stale:arrival-lastArrival>250,now:arrival,delay:0});return {...current,renderPose:p};"]],
    [['lastSnapshot=snapshot;lastArrival=arrival;lastAt=snapshot.simAt;', "if(!changed){const p=physics.pose(kart.id),d=Math.hypot(probeBefore.position.x-p.position.x,probeBefore.position.y-p.position.y,probeBefore.position.z-p.position.z);globalThis.__pkD?.('corr',{d,now:arrival,snap:true});}lastSnapshot=snapshot;lastArrival=arrival;lastAt=snapshot.simAt;"],
     ['lastSnapshot=snapshot;lastArrival=arrival;', 'lastSnapshot=snapshot;lastArrival=arrival;']],
  ],
};

function initScript({ relayPort, upstreamHost }) {
  const D = { ingest: [], corr: [], frame: [], remote: [], under: [], eframe: [], eingest: [], msgs: [], raf: [] };
  window.__pkLog = D;
  let remotePid = null;
  window.__pkD = (kind, v) => {
    if (!window.__pkOn) return;
    if (kind === 'remote') { remotePid ??= v.pid; if (v.pid !== remotePid) return; }
    const list = D[kind]; if (list.length < 40000) list.push(v);
  };
  const Native = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const target = String(url).includes(upstreamHost) ? 'ws://127.0.0.1:' + relayPort : url;
    const ws = protocols === undefined ? new Native(target) : new Native(target, protocols);
    ws.addEventListener('message', e => { if (!window.__pkOn) return; const binary = typeof e.data !== 'string'; if (binary || e.data.startsWith('{"t":"state"')) D.msgs.push({ at: performance.now(), size: binary ? e.data.byteLength || e.data.size : e.data.length }); });
    return ws;
  };
  window.WebSocket.prototype = Native.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  let last = null; const tick = t => { if (window.__pkOn && last !== null) D.raf.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}

function analyse(D, elevated) {
  const gaps = D.msgs.slice(1).map((m, i) => m.at - D.msgs[i].at);
  const out = {
    snapshots: { count: D.msgs.length, interArrivalMs: summary(gaps), over100: gaps.filter(g => g > 100).length, over250: gaps.filter(g => g > 250).length, meanBytes: Math.round(D.msgs.reduce((a, m) => a + m.size, 0) / Math.max(1, D.msgs.length)) },
    raf: { frames: D.raf.length, gapMs: summary(D.raf), over33: D.raf.filter(g => g > 33.4).length, over50: D.raf.filter(g => g > 50).length, over100: D.raf.filter(g => g > 100).length },
  };
  if (!elevated || D.frame.length) {
    const sim = D.ingest.slice(1).map((x, i) => x.simAt - D.ingest[i].simAt).filter(x => x > 0), age = D.ingest.map(x => x.serverAt - x.simAt);
    out.server = { simAtStepMs: summary(sim), over50: sim.filter(s => s > 50).length };
    out.age = summary(age);
    out.prediction = { ingests: D.ingest.length, resets: D.ingest.filter(x => x.reset).length, staleFrames: D.frame.filter(f => f.stale).length, corrections: summary(D.corr.map(c => c.d)), snaps: D.corr.filter(c => c.snap ?? c.d > .75).length + D.ingest.filter(x => x.reset).length };
    // Own-kart motion: per-frame step, jerk (2nd difference), freeze frames
    // (no motion while the kart reports speed) and skips (> 3x the median step).
    const f = D.frame, step = [], jerk = []; let freezes = 0;
    for (let i = 1; i < f.length; i++) { const s = Math.hypot(f[i].x - f[i - 1].x, f[i].z - f[i - 1].z); step.push(s); if (s < 1e-4 && Math.abs(f[i].speed) > 3) freezes++; if (i > 1) jerk.push(Math.hypot(f[i].x - 2 * f[i - 1].x + f[i - 2].x, f[i].z - 2 * f[i - 1].z + f[i - 2].z)); }
    const med = pct(step, .5) || 0;
    out.ownKart = { frames: f.length, stepM: summary(step), jerkM: summary(jerk), freezeFrames: freezes, skipFrames: step.filter(s => med > .02 && s > 3 * med).length };
    if (!elevated) {
      const r = D.remote, rj = [];
      for (let i = 2; i < r.length; i++) rj.push(Math.hypot(r[i].x - 2 * r[i - 1].x + r[i - 2].x, r[i].z - 2 * r[i - 1].z + r[i - 2].z));
      const delays = f.map(x => x.delay).filter(Number.isFinite);
      out.remote = { delayMs: summary(delays), jerkM: summary(rj), jumpsOver05m: rj.filter(j => j > .5 && j < 15).length, underrunSamples: D.under.length, underrunMs: summary(D.under.map(u => u.by)), frozenOver120: D.under.filter(u => u.by > 120).length };
    }
  }
  if (elevated) {
    const e = D.eframe, adv = [];
    let starved = 0, stalls = 0, skips = 0;
    for (let i = 1; i < e.length; i++) { const dt = e[i].time - e[i - 1].time, d = e[i].played - e[i - 1].played; adv.push(d - dt); if (e[i].played >= e[i].latest) starved++; if (dt > 5 && d < 0.5) stalls++; if (d > dt + 30) skips++; }
    out.timeline = { frames: e.length, starvedFrames: starved, stalledFrames: stalls, skipFrames: skips, playbackMinusWallMs: summary(adv.map(Math.abs)), behindLatestMs: summary(e.map(x => x.latest - x.played)) };
    if (!D.ingest.length) {
      const sim = D.eingest.slice(1).map((x, i) => x.at - D.eingest[i].at).filter(x => x > 0);
      out.server = { simAtStepMs: summary(sim), over75: sim.filter(s => s > 75).length };
    }
  }
  return out;
}

(async () => {
  const cfg = await (await fetch(URL_BASE + '/config.json?t=' + Date.now())).json();
  const upstream = cfg.websocketUrl || URL_BASE.replace(/^http/, 'ws'), upstreamHost = new URL(upstream).host;
  const elevated = !['Ring Arena', 'Block Party', 'Garden Circuit', 'Frost Rink', 'Neon Grid'].includes(MAP) && !/^(ring|blocks|garden|frost|neon)$/.test(MAP);
  const rel = await relay(upstream, new URL(URL_BASE).origin);
  const { decodeFrame } = await import('../../public/js/toolkit/realtime/client.mjs');
  const { createKartBot } = await import('./kart-bot.mjs');
  const bots = []; let browser;
  try {
    const bot = async (name, first) => {
      const ws = new WebSocket(upstream, { headers: { Origin: new URL(URL_BASE).origin } }), b = { ws, name, state: null, hello: null, seq: 0, decoder: decodeFrame({ eventDeltas: true }), drive: null, t0: Math.random() * 6, gaps: [], on: false, lastAt: 0 };
      ws.on('message', (raw, isBinary) => {
        if (b.on) { const t = performance.now(); if (b.lastAt) b.gaps.push(t - b.lastAt); b.lastAt = t; }
        let m; if (isBinary) { m = b.decoder.apply(new Uint8Array(raw)); if (!m) { ws.send(JSON.stringify({ t: 'rt-key' })); return; } } else m = JSON.parse(raw);
        if (m.t === 'hello') b.hello = m; if (m.t === 'room') b.room = m.room;
        if (m.t === 'state') { b.state = m; if (m.preparing && !m.spectator) ws.send(JSON.stringify({ t: 'game-ready', i: m.instanceId, w: m.w })); }
      });
      ws.on('error', () => {});
      await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
      ws.send(JSON.stringify(first)); await until(() => b.hello, 'hello ' + name);
      b.drive = createKartBot(b.hello.you); bots.push(b); return b;
    };
    const host = await bot('Probe 1', { t: 'create', name: 'Probe 1', kartEvents: 'delta-v1', realtime: 'rt1' });
    const code = host.hello.code;
    for (let i = 2; i <= BOTS; i++) await bot('Probe ' + i, { t: 'join', name: 'Probe ' + i, code, kartEvents: 'delta-v1', realtime: 'rt1' });

    const GL = arg('gl', 'metal'), HEADED = arg('headed', '0') === '1';
    browser = await chromium.launch({ headless: !HEADED, args: GL === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: +arg('w', 1280), height: +arg('h', 720) } });
    await context.addInitScript(initScript, { relayPort: rel.port, upstreamHost });
    await context.route(/\/js\/(engines\/kart-classic-prediction|toolkit\/realtime\/client|engines\/kart-elevated-(?:pose|prediction))\.mjs(\?.*)?$/, async route => {
      const res = await route.fetch(), file = new URL(route.request().url()).pathname.split('/').pop();
      await route.fulfill({ response: res, body: patch(await res.text(), PATCHES[file], file), headers: { ...res.headers(), 'cache-control': 'no-store' } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    if (CPU > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
    await page.goto(URL_BASE + '/r/' + code);
    const seated = () => host.room?.players?.filter(p => p.connected !== false).length === BOTS + 1;
    for (let attempt = 0; attempt < 6 && !seated(); attempt++) {
      await page.locator('#nm').fill('Probe Driver').catch(() => {});
      await page.evaluate(c => { const el = document.getElementById('jc'); if (el) el.value = c; }, code);
      await page.locator('#bJoin').click().catch(() => {});
      await until(seated, 'seated', 6000).catch(() => {});
    }
    await until(seated, 'browser seated', 20000).catch(async e => { console.error('relay', rel.connections(), errors.slice(0, 5), JSON.stringify(host.room?.players?.map(p => [p.name, p.connected])), (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 300)); throw e; });
    host.ws.send(JSON.stringify({ t: 'start', game: 'pocket-karts', ready: true, settings: { map: MAP, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: Math.max(60, SECONDS + 30) } }));
    const live = s => s && !s.preparing && (s.phase === 'drive' || s.phase === 'live');
    await until(() => live(host.state), 'drive phase', 90000);
    await sleep(3000); // countdown and first ticks
    // Bots: classic snapshots carry pid/x/angle; raised ones use the elevated input message.
    const timer = setInterval(() => {
      const now = Date.now();
      for (const b of bots) {
        const v = b.state; if (!v || !live(v)) continue;
        if (elevated) { const ack = v.inputAck; if (!ack || !v.youDrive) continue; b.seq = Math.max(b.seq, ack.receivedSeq || 0) + 1; b.ws.send(JSON.stringify({ t: 'action', i: v.instanceId, w: v.w, a: { type: 'input', seq: b.seq, life: ack.life, controlEpoch: ack.controlEpoch, steer: +Math.sin(now / 900 + b.t0).toFixed(2), throttle: 1, brake: 0, nitro: false, use: Math.random() < .05 } })); }
        else if (v.inputAck) b.ws.send(JSON.stringify({ t: 'action', i: v.instanceId, w: v.w, a: { input: b.drive(v, now), seq: ++b.seq, life: v.inputAck.life, controlEpoch: v.inputAck.controlEpoch } }));
      }
    }, 50);
    rel.impair(true); await sleep(1500);
    await page.evaluate(() => { window.__pkOn = true; });
    for (const b of bots) b.on = true;
    await page.keyboard.down('ArrowUp');
    for (let t = 0; t < SECONDS * 1000; t += 1500) { const key = (t / 1500) % 2 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await sleep(500); await page.keyboard.up(key); await page.keyboard.press('Space').catch(() => {}); await sleep(1000); }
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => { window.__pkOn = false; });
    clearInterval(timer);
    const D = await page.evaluate(() => window.__pkLog);
    await page.screenshot({ path: path.join(OUT, `probe-${LABEL}.png`), timeout: 5000 }).catch(() => {});
    const result = { label: LABEL, url: URL_BASE, map: MAP, elevated, drivers: BOTS + 1, seconds: SECONDS, impairment: { relayed: rel.connections(), addedRttMs: RTT, meanJitterMs: JITTER, loss: LOSS, cpuThrottle: CPU, stall: STALL[0] > 0 ? STALL : null }, release: cfg.release?.sourceCommit?.slice(0, 7) || null, ...analyse(D, elevated), botsDirect: (() => { const g = bots.flatMap(b => b.gaps); return { interArrivalMs: summary(g), over100: g.filter(x => x > 100).length, over250: g.filter(x => x > 250).length }; })(), errors: errors.slice(0, 10) };
    fs.writeFileSync(path.join(OUT, `probe-${LABEL}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    host.ws.send(JSON.stringify({ t: 'lobby' }));
  } finally {
    for (const b of bots) try { b.ws.close(); } catch {}
    if (browser) await browser.close();
    rel.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
