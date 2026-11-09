'use strict';
// 32-driver Pocket Karts match: the real server, 31 bot drivers over
// localhost WebSockets (rt1 binary frames, decoded with the shipping
// toolkit), and one real driver in headless Chromium using the keyboard.
// Fails on any page error, console error or server error. Needs Playwright
// on NODE_PATH. Writes a screenshot and metrics to $KART32_OUT (or /tmp).
const assert = require('node:assert/strict'), { spawn } = require('node:child_process'), net = require('node:net'), path = require('node:path'), fs = require('node:fs');
const WebSocket = require('ws'), { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), OUT = process.env.KART32_OUT || '/tmp';
const DRIVERS = Number(process.env.KART32_DRIVERS || 32), DRIVE_MS = Number(process.env.KART32_DRIVE_MS || 20000);
const MAP = process.env.KART32_MAP || 'Garden Circuit',RAISED=Object.hasOwn(require('../games/engines/kart-elevated-adapter').LAUNCH_ARENA_CAPS,MAP);
const live=s=>s?.phase===(RAISED?'live':'drive'),id=k=>k?.pid||k?.id,position=k=>k.pose?.position||{x:k.x,z:k.z};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); } throw Error('timeout: ' + label); }

(async () => {
  const { decodeFrame } = await import('../public/js/toolkit/realtime/client.mjs');
  const { createKartBot } = await import('../tools/realtime/kart-bot.mjs');
  const port = Number(process.env.KART32_PORT) || await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const url = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
  const bots = [], errors = [];
  let browser;
  try {
    await until(() => serverLog.includes('PartyBox on'), 'server boot');
    const bot = async (name, first) => {
      const ws = new WebSocket(url.replace('http', 'ws')), b = { ws, name, state: null, hello: null, seq: 0, frames: 0, bytes: 0, decoder: decodeFrame({ eventDeltas: true }), drive: null };
      ws.on('message', (raw, isBinary) => {
        b.bytes += raw.length;
        let m;
        if (isBinary) { b.frames++; m = b.decoder.apply(new Uint8Array(raw)); if (!m) { ws.send(JSON.stringify({ t: 'rt-key' })); return; } }
        else m = JSON.parse(raw);
        if (m.t === 'hello') b.hello = m;
        if (m.t === 'room') b.room = m.room;
        if (m.t === 'state') { b.state = m; if (m.preparing && !m.spectator) ws.send(JSON.stringify({ t: 'game-ready', i: m.instanceId, w: m.w })); }
      });
      await new Promise(r => ws.on('open', r));
      ws.send(JSON.stringify(first));
      await until(() => b.hello, 'hello ' + name);
      b.drive = createKartBot(b.hello.you);
      bots.push(b); return b;
    };
    const host = await bot('Bot 1', { t: 'create', name: 'Bot 1', kartEvents: 'delta-v1', realtime: 'rt1' });
    const code = host.hello.code;
    for (let i = 2; i < DRIVERS; i++) await bot('Bot ' + i, { t: 'join', name: 'Bot ' + i, code, kartEvents: 'delta-v1', realtime: 'rt1' });

    const angle=process.env.KART32_ANGLE||'swiftshader';
    browser = await chromium.launch({ executablePath:process.env.KART32_BROWSER||undefined, headless: true, args: ['--use-gl=angle', '--use-angle='+angle, ...(angle==='swiftshader'?['--enable-unsafe-swiftshader']:[])] });
    const page = await (await browser.newContext({ viewport: { width:Number(process.env.KART32_WIDTH||844),height:Number(process.env.KART32_HEIGHT||390) }, deviceScaleFactor:Number(process.env.KART32_SCALE||2) })).newPage();
    // Count WebGL draw calls per rendered frame (renderer cost, GPU-independent).
    await page.addInitScript(() => {
      window.__draws = 0;window.__triangles=0;
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const original = C.prototype[name]; if (!original) continue;
          C.prototype[name] = function (...args) { window.__draws++;if(args[0]===4){const count=name==='drawArrays'||name==='drawArraysInstanced'?args[2]:args[1],instances=name==='drawElementsInstanced'?args[4]:name==='drawArraysInstanced'?args[3]:1;window.__triangles+=count/3*instances;}return original.apply(this, args); };
        }
      }
    });
    if(process.env.KART32_CPU){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.KART32_CPU)});}
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    let pageFrames = 0, pageBytes = 0, pageText = 0;
    page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload === 'string') pageText++; else { pageFrames++; pageBytes += f.payload.length; } }));
    await page.goto(url + '/r/' + code);
    // The home form re-renders once the socket opens (clearing typed text and
    // dropping a click sent before it): retry on the settled page. The code
    // is set directly: the code box's letters-only filter strips the digits
    // that room codes can contain (reported separately).
    const allSeated = () => host.room?.players?.filter(p => p.connected !== false).length === DRIVERS;
    for (let attempt = 0; attempt < 6 && !allSeated(); attempt++) {
      await page.locator('#nm').fill('Chromium Driver');
      await page.evaluate(c => { document.getElementById('jc').value = c; }, code);
      await page.locator('#bJoin').click();
      await until(allSeated, 'seated', 5000).catch(async () => console.error('attempt', attempt, await page.evaluate(() => [document.getElementById('nm')?.value, document.getElementById('jc')?.value, document.querySelector('.toast, #toast')?.textContent, location.pathname].join(' / '))));
    }
    const seated = await until(() => host.room?.players?.filter(p => p.connected !== false).length === DRIVERS && host, 'all ' + DRIVERS + ' seated', 30000).catch(async e => { console.error(JSON.stringify(host.room?.players), errors, (await page.evaluate(() => document.body.innerText)).slice(0, 300)); throw e; });
    seated.ws.send(JSON.stringify({ t: 'start', game: 'pocket-karts', ready: true, settings: { map: MAP, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 60 } }));
    await until(() => live(host.state) && !host.state.preparing, 'drive phase (all ' + DRIVERS + ' ready)', 40000);
    const browserPid = id(host.state.karts.find(k => !bots.some(b => b.hello.you === id(k))));
    assert.equal(host.state.karts.length, DRIVERS, 'every seat drives');
    assert.ok(browserPid, 'browser seat has a kart');
    const start = host.state.karts.find(k => id(k) === browserPid);

    // Drive: bots on their decoded views; the browser holds throttle and weaves.
    let farthest = 0, fastestForward = 0;
    const timer = setInterval(() => {
      const now = Date.now(), me = host.state.karts.find(k => id(k) === browserPid);
      if (me) {farthest = Math.max(farthest, Math.hypot(position(me).x - position(start).x, position(me).z - position(start).z));fastestForward=Math.max(fastestForward,me.pose?.speed||me.speed||0);}
      for (const b of bots) { const v = b.state; if (v?.inputAck && live(v)) b.ws.send(JSON.stringify({ t: 'action', i: v.instanceId, w: v.w, a: { ...(RAISED?{type:'input',steer:Math.sin(now/3000+bots.indexOf(b))*.3,throttle:.45,brake:0,nitro:false,use:(now/250|0)%2===0}:{input:b.drive(v,now)}), seq: ++b.seq, life: v.inputAck.life, controlEpoch: v.inputAck.controlEpoch } })); }
    }, 50);
    await page.evaluate(() => { window.__draws = 0;window.__triangles=0; window.__fps = { n: 0, start: performance.now(), worst: 0, last: performance.now() }; const tick = t => { const f = window.__fps; f.n++; f.worst = Math.max(f.worst, t - f.last); f.last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    pageFrames = 0; pageBytes = 0; const t0 = Date.now();
    await page.keyboard.down('ArrowUp');
    let reversing = false;
    for (let t = 0; t < DRIVE_MS; t += 1500) {
      // This fixed keyboard route can meet authored cover near a spawn.
      // Back out using real input; broken browser controls still fail movement.
      if (!reversing && t >= 6000 && farthest < 5) { await page.keyboard.up('ArrowUp'); await page.keyboard.down('ArrowDown'); reversing = true; }
      const key = (t / 1500) % 2 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await sleep(500); await page.keyboard.up(key); await sleep(1000);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowDown');
    const seconds = (Date.now() - t0) / 1000;
    clearInterval(timer);
    const fps = await page.evaluate(() => { const f = window.__fps; return { fps: +(f.n / ((performance.now() - f.start) / 1000)).toFixed(1), worstFrameMs: +f.worst.toFixed(0), drawCallsPerFrame: Math.round(window.__draws / Math.max(1, f.n)),submittedTrianglesPerFrame:Math.round(window.__triangles/Math.max(1,f.n)) }; });
    await page.screenshot({ path: path.join(OUT, 'kart-32-browser.png') });
    const moved = farthest;
    const hud = await page.evaluate(() => ({ rows: document.querySelectorAll('.pk-stand .pk-row, #pk-stand .pk-row').length, canvas: !!document.querySelector('canvas') }));
    const metrics = {
      map:MAP,drivers: host.state.karts.length, connected: host.state.karts.filter(k => k.connected !== false).length, seconds: +seconds.toFixed(1),
      browser: { binaryFramesPerSec: +(pageFrames / seconds).toFixed(1), kbPerSec: +(pageBytes / seconds / 1024).toFixed(1), textFrames: pageText, ...fps, hud },
      bots: { framesPerSec: +(bots.reduce((a, b) => a + b.frames, 0) / bots.length / (seconds + 5)).toFixed(1) },
      browserKartMovedM: +moved.toFixed(1), fastestForward: +fastestForward.toFixed(1), errors,
    };
    fs.writeFileSync(path.join(OUT, 'kart-32-browser.json'), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics));
    assert.equal(metrics.connected, DRIVERS, 'all drivers stayed connected');
    assert.ok(metrics.browser.binaryFramesPerSec > (RAISED?15:20), 'browser receives real-time frames: ' + metrics.browser.binaryFramesPerSec);
    assert.ok(fastestForward > 1, 'browser throttle moved the kart forward: '+fastestForward);
    assert.ok(moved > 5, 'browser kart drove: ' + moved);
    assert.ok(hud.canvas, '3D canvas rendered');
    assert.deepEqual(errors, [], 'no page or console errors');
    assert.ok(!/error/i.test(serverLog.replace(/GAME_REPORT|errors?:\s*0/gi, '')), 'no server errors:\n' + serverLog);
    host.ws.send(JSON.stringify({ t: 'lobby' }));
    console.log('KART_32_BROWSER_PASS');
  } finally {
    for (const b of bots) try { b.ws.close(); } catch {}
    if (browser) await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
