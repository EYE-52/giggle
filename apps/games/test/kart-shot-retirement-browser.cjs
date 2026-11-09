'use strict';
// Optional practice battle regression with real Chrome/WebGL and screenshots. All game
// code is shipped code; test-only server hooks grant each of the 13 pickups in
// order so coverage does not depend on luck. Input, payloads, physics, audio,
// HUD and transport still run normally. Needs Playwright and hardware WebGL.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
if (process.env.KART_PERF_SERVER === '1') {
  const Module = require('node:module'), compile = Module.prototype._compile;
  Module.prototype._compile = function (source, file) {
    if (file.endsWith('/kart-elevated-combat.js')) source = source.replace('function dispose() {', `global.__perfGive = weapon => {
      const k = [...karts.values()][0]; if (!k?.alive) return false;
      clean(k); k.weapon = weapon; k.ammo = COMBAT.weapons[weapon].ammo || 1; k.fireCd = 0;
      emit('pickup', k.id, { weapon, position: physics.pose(k.id).position }); return true;
    }; function dispose() {`);
    if (file.endsWith('/kart-rules-battle.js')) source += `\nmodule.exports.__perfGive = (state, weapon) => {
      const k = state.karts[0]; if (k.respawn > 0) return false;
      k.weapon = weapon; k.ammo = COMBAT.weapons[weapon].ammo || 1; k.fireCd = 0; k.prevAction = false;
      pushEvent(state, 'pickup', k.pid, undefined, weapon); return true;
    };`;
    return compile.call(this, source, file);
  };
  const { Rooms } = require('../server/room'), create = Rooms.prototype.create;
  let room;
  Rooms.prototype.create = function (...args) { return room = create.apply(this, args); };
  process.on('message', ({ weapon, id }) => {
    const state = room?.game?.state;
    const ok = state && (state.profile ? global.__perfGive?.(weapon) : require('../games/engines/kart-rules-battle').__perfGive(state, weapon));
    process.send({ id, ok: !!ok });
  });
  require('../server/server');
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
async function main() {
  const { chromium } = require(process.env.KART_PERF_PLAYWRIGHT || 'playwright');
  const { fork } = require('node:child_process'), net = require('node:net');
  const out = process.env.KART_PERF_OUT || '/tmp/kart-shot-browser'; fs.mkdirSync(out, { recursive: true });
  const port = await new Promise(resolve => { const s = net.createServer().listen(Number(process.env.KART_SHOT_PORT||8250), '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = fork(__filename, [], { cwd: root, env: { ...process.env, KART_PERF_SERVER: '1', PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', REPORT_DB_PATH: path.join(out, 'reports.json') }, silent: true });
  let log = ''; server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(50); } throw Error('Timed out: ' + log.slice(-1500)); };
  let browser;
  try {
    await until(() => log.includes('PartyBox on'));
    const results = [];
    for (const map of (process.env.KART_PERF_MAPS || 'Rookie Ring,Skyport').split(',')) {
      browser = await chromium.launch({ executablePath: process.env.KART_PERF_BROWSER || undefined, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
      const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [], slug = map.toLowerCase().replaceAll(' ', '-');
      page.on('pageerror', e => errors.push(e.stack));
      page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
      await context.route('**/js/app.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace("case 'state': {", "case 'state': { window.__latestShotState=msg; if(window.__shotDropUntil>performance.now())break; window.__perfObserve?.(msg);") });
      });
      await context.route('**/js/renderers/three-view.js', async route => {
        const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('built = await hooks.build(THREE, helper);','built = await hooks.build(THREE, helper);window.__shotBuilt=built;')});
      });
      await context.route('**/js/engines/kart-view.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('const currentZ=(ordnanceFresh()?S.zaps:[])||[];', 'window.__shotObjects={zaps,grenades,mines};window.__shotFrame={fresh:ordnanceFresh(),arrival:lastSnapshotArrival,clock:nowMs(),simAt:S.simAt,grenades:S.grenades?.length};const currentZ=(ordnanceFresh()?S.zaps:[])||[];')});});
      await context.route('**/js/engines/kart-elevated-view.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("const itemSnapshot=playback?.current.snapshot||S;","window.__shotObjects=objects;const itemSnapshot=playback?.current.snapshot||S;")});});
      await context.addInitScript(({ map }) => {
        const marks = [], gaps = [], longTasks = [],retirements=[];const ended=new Map(),trackedObjects=new Map();let maxStale=0,observations=0,observedBodies=0,registeredBodies=0,snapshotBodies=0;const shotSamples=[];window.__shotRetirements=retirements;
        let ready = 0, last = 0, frame = 0, prevPhase, prevPreparing, events = new Set();
        const mark = name => { const at = performance.now(); marks.push({ name, at }); performance.mark('kart:' + name); };
        const Native = WebSocket;
        window.WebSocket = class extends Native {
          send(data) {
            try {
              const m = JSON.parse(data);
              if (m.t === 'start') { m.settings = { ...m.settings, map, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 180 }; data = JSON.stringify(m); }
              if (m.t === 'game-ready' && !ready) { ready = performance.now(); mark('ready'); }
            } catch { /* binary or unrelated */ }
            return super.send(data);
          }
        };
        window.__perfObserve = state => {
          window.__perfState = state;
          if(state.preparing !== prevPreparing) { mark('preparing:' + !!state.preparing); prevPreparing = state.preparing; }
          if (state.phase !== prevPhase) { mark(state.phase + (state.preparing ? ':preparing' : '')); prevPhase = state.phase; }
          for (const event of state.events || []) if (!events.has(event.id)) {
            events.add(event.id); mark(event.type + ':' + (event.weapon || ''));
          }
        };
        new PerformanceObserver(list => { if (ready) for (const e of list.getEntries()) longTasks.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true });
        function tick(t) {
          const S=window.__latestShotState,graph=window.__shotObjects;
          if(S&&graph){observations++;const live=new Set([...(S.zaps||S.projectiles||[]),...(S.grenades||[]),...(S.mines||[])].map(v=>v.id));
            snapshotBodies+=live.size;if(live.size&&shotSamples.length<8)shotSamples.push({count:live.size,phase:S.phase,frame:window.__shotFrame,graph:graph instanceof Map?[...graph].map(([id,o])=>({id,visible:o.visible})):Object.fromEntries(["zaps","grenades","mines"].map(k=>[k,[...(graph[k]||[])].map(([id,o])=>({id,visible:o.visible}))]))});
            const inspect=(id,o)=>{registeredBodies++;if(o.visible)observedBodies++;const key=o.uuid;let ref=trackedObjects.get(key);if(!ref){ref={id,object:o};trackedObjects.set(key,ref);}else ref.id=id;if(live.has(id)){ended.delete(key);return;}if(!ended.has(key))ended.set(key,t);if(o.visible){const ms=t-ended.get(key);maxStale=Math.max(maxStale,ms);if(ms>150)retirements.push({id,ms});}};
            if(graph instanceof Map){for(const[id,o]of graph)if(/^(shot|grenade|warning|mine):/.test(id))inspect(id.slice(id.indexOf(':')+1),o);}
            else for(const list of [graph.zaps,graph.grenades,graph.mines])for(const[id,o]of list||[])inspect(id,o);
            for(const[key,ref]of trackedObjects){if(live.has(ref.id))continue;if(!ended.has(key))ended.set(key,t);if(ref.object.visible&&ref.object.parent){const ms=t-ended.get(key);maxStale=Math.max(maxStale,ms);if(ms>150)retirements.push({id:ref.id,ms});}}
          }
          if (ready) { if (last && frame > 30 && t - last > 50) gaps.push({ frame: frame - 30, at: +(t - ready).toFixed(1), ms: +(t - last).toFixed(1), absolute: t }); frame++; last = t; }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        window.__perfResult = () => ({ ready, frames: frame, marks, gaps, longTasks, origin: performance.timeOrigin,maxStale,retirements,observations,observedBodies,registeredBodies,snapshotBodies,shotSamples });
        window.__perfMark = mark;
      }, { map });
      const cdp = await context.newCDPSession(page);
      const traced = process.env.KART_PERF_TRACE === '1';
      if (traced) {
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
        await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
      }
      console.log('NAVIGATE ' + map);
      await page.goto(`http://127.0.0.1:${port}/practice/?game=pocket-karts`);
      await page.locator('#practiceStart:not([disabled])').click();
      await page.waitForFunction(() => document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'), null, { timeout: 30000 });
      const host = page.frames().find(f => /[?&]seat=1(?:&|$)/.test(f.url()));
      console.log('SEATED ' + map);
      await host.locator('#howtoGo:not([disabled])').click();
      console.log('STARTED ' + map);
      await host.waitForFunction(() => window.__perfResult().ready > 0, null, { timeout: 90000 }).catch(async e => { console.error(JSON.stringify({errors, frames: page.frames().map(f=>f.url()), state: await host.evaluate(()=>({probe:window.__perfResult(),state:window.__perfState,body:document.body.innerText.slice(-2500)}))})); throw e; });
      console.log('READY ' + map);
      const readyWall = Date.now();
      await host.waitForFunction(() => ['drive','live'].includes(window.__perfState?.phase) && !window.__perfState.preparing).catch(async e => { console.error(JSON.stringify({errors, frames: await Promise.all(page.frames().map(f=>f.evaluate(()=>({probe:window.__perfResult?.(),state:window.__perfState&&{phase:window.__perfState.phase,preparing:window.__perfState.preparing,w:window.__perfState.w},body:document.body.innerText.slice(-1200)}))))})); throw e; });
      await host.locator('.pk-stage canvas,.pke-stage canvas').click({ force: true });
      await page.keyboard.down('ArrowUp'); await page.keyboard.down('n');
      await sleep(800);await page.keyboard.up('ArrowUp');await page.keyboard.up('n');
      const weapons = (process.env.KART_SHOT_WEAPONS||'machinegun,trishot,missile,cannon,blades,supernova,mine,oil,frost,thunder,boomerang,ram,nuke').split(',');
      let next = 0, id = 0,windowFreeze=false;
      const seconds = Number(process.env.KART_PERF_SECONDS || 104);
      while (Date.now() - readyWall < seconds * 1000) {
        const age = Date.now() - readyWall;
        if (next < weapons.length && age >= Number(process.env.KART_SHOT_DELAY||12000) + next * Number(process.env.KART_SHOT_INTERVAL||6500)) {
          const weapon = weapons[next++], request = ++id;
          const ok = await new Promise(resolve => {
            const receive = m => { if (m.id === request) { server.off('message', receive); resolve(m.ok); } };
            server.on('message', receive); server.send({ weapon, id: request });
          });
          if (!ok) throw Error('Could not grant ' + weapon);
          await host.evaluate(w => window.__perfMark('grant:' + w), weapon);
          await sleep(700); await page.keyboard.press('Space', { delay: 150 });
        }
        // An initial drive/nitro burst tests GO. Release before the wall so
        // every projectile has a clear launch, rather than a blocked muzzle.
        if(next===4&&!windowFreeze){windowFreeze=true;await host.evaluate(()=>window.__shotDropUntil=performance.now()+1200);await sleep(1400);}
        await sleep(150);
      }
      await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowRight');
      await host.locator('.pk-stage canvas,.pke-stage canvas').screenshot({path:path.join(out,slug+'-arena.png')});
      await host.evaluate(()=>document.addEventListener('visibilitychange',()=>window.__shotVisibility=(window.__shotVisibility||[]).concat(document.hidden)));
      // Headless Chrome keeps document visibility 'visible'. Exercise the
      // production visibility listener explicitly, then really freeze JS/RAF.
      await host.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
      await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await sleep(2000);await cdp.send('Page.setWebLifecycleState',{state:'active'});
      await host.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await sleep(200);
      await host.locator('.pk-stage canvas,.pke-stage canvas').screenshot({path:path.join(out,slug+'-resumed.png')});
      const finalKarts = await host.evaluate(() => window.__perfState.karts.map(k=>({id:k.pid||k.id,x:k.x,z:k.z,pose:k.pose?.position,weapon:k.weapon})));
      const result = { map, traced, seconds, finalKarts,visibility:await host.evaluate(()=>window.__shotVisibility||[]), ...await host.evaluate(() => window.__perfResult()), errors };
      result.weaponsFired = [...new Set(result.marks.filter(m => /^(fire|mine):/.test(m.name)).map(m => m.name.split(':')[1]))];
      if (traced) {
        const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(path.join(out, slug + '.cpuprofile'), JSON.stringify(profile));
        const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end'); const { stream } = await completed;
        const file = fs.openSync(path.join(out, slug + '.trace.json'), 'w');
        for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); fs.writeSync(file, chunk.data); if (chunk.eof) break; }
        fs.closeSync(file); await cdp.send('IO.close', { handle: stream });
      }
      result.browser = browser.version();
      result.gpu = await host.evaluate(() => {
        const gl = document.querySelector('.pk-stage canvas,.pke-stage canvas').getContext('webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      });
      results.push(result); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ map, traced, frames: result.frames, gaps: result.gaps, longTasks: result.longTasks, weaponsFired: result.weaponsFired,maxStale:result.maxStale,retirements:result.retirements,observations:result.observations,observedBodies:result.observedBodies,registeredBodies:result.registeredBodies,snapshotBodies:result.snapshotBodies,shotSamples:result.shotSamples, errors }));
      if (seconds >= 100 && (errors.length || result.weaponsFired.length !== weapons.length || result.retirements.length || !result.observations || !result.observedBodies)) process.exitCode = 1;
      await context.close();await browser.close();browser=null;
    }
  } finally { await browser?.close(); server.kill(); fs.writeFileSync(path.join(out, 'server.log'), log); }
}
