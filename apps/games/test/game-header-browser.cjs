'use strict';
// Optional real-entry check: no injected game snapshots or CSS fixtures.
// Companions join normal rooms, and a signed cross-origin frame uses the bridge.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium, webkit } = require('playwright'), WebSocket = require('ws');
const { issueGameTicket } = require('../../../server/src/services/gameBridgeService');
const root = path.resolve(__dirname, '..');
const out = process.env.GAME_HEADER_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-game-header-'));
fs.mkdirSync(out, { recursive:true });
const rows = [], errors = [], diagnostics = [], companions = new Set();
const pause = ms => new Promise(r => setTimeout(r, ms));
let server, parent, browser, base, parentUrl, logs = '';
const secret = crypto.randomBytes(32).toString('hex');
const games = (process.env.GAME_HEADER_GAMES || 'two-truths,never-ever,compliment-battle,would-you-rather,clue-grid,doodle-guess,draw-phone,number-hunt,reaction-tap,mega-tic-tac-toe,chess,pocket-karts').split(',');
function ticket(squad, user) {
  return issueGameTicket({ squadId:squad, userId:user, displayName:user }, { NODE_ENV:'development', GAMES_PUBLIC_URL:base, GAME_BRIDGE_SECRET:secret }).ticket;
}
async function join(message) {
  const ws = new WebSocket(base.replace('http:', 'ws:')); companions.add(ws);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Companion join timed out')), 10000);
    ws.on('open', () => ws.send(JSON.stringify(message)));
    ws.on('error', reject);
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'hello') { clearTimeout(timer); resolve(); }
      if (m.t === 'error') { clearTimeout(timer); reject(Error(m.message || m.code)); }
      if (m.t === 'state' && m.preparing) ws.send(JSON.stringify({ t:'game-ready', i:m.instanceId, w:m.w }));
    });
  });
  return ws;
}
function closeBots(bots) { for (const ws of bots) { ws.close(); companions.delete(ws); } }
async function geometry(frame, label) {
  await frame.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const r = await frame.evaluate(() => {
    const rect = n => { const r = n.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    const title = document.querySelector('.play-title h1,.bk-title');
    const range = document.createRange(); if (title) range.selectNodeContents(title);
    const textBounds = title ? range.getBoundingClientRect().toJSON() : null;
    const titleClip = title?.closest('.bk-head');
    const status = document.querySelector('.mt-game .bk-status');
    const controls = [...document.querySelectorAll('#roomMenu > summary,.game-screen-toggle')].filter(n => n.getClientRects().length).map(n => {
      const r = rect(n); return { ...r, label:n.getAttribute('aria-label'), hit:n.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)), bg:getComputedStyle(n).backgroundColor };
    });
    return { width:innerWidth, scrollWidth:document.documentElement.scrollWidth, controls, title:title ? { ...rect(title), text:title.textContent, scrollWidth:title.scrollWidth, scrollHeight:title.scrollHeight, textBounds, clip:titleClip ? rect(titleClip) : null } : null,
      flat:!document.querySelector('.pk,.pke,.bs-game'),status:status ? { ...rect(status), scrollHeight:status.scrollHeight, clientHeight:status.clientHeight } : null,reportIcons:document.querySelectorAll('.game-report-icon').length, prompts:document.querySelectorAll('#gameScreenPrompt').length,
      toolbar:document.querySelector('.play-toolbar') ? rect(document.querySelector('.play-toolbar')) : null };
  });
  assert(r.scrollWidth <= r.width + 1, label+' no sideways page scroll');
  assert.equal(r.reportIcons, 0, label+' Report uses the labelled drawer action');
  assert.equal(r.prompts, 0, label+' no duplicate full-screen invitation');
  assert(r.controls.length >= 1 && r.controls.length <= 2, label+' at most two live utilities');
  for (const c of r.controls) {
    assert(c.width >= 44 && c.height >= 44, label+' 44px control '+c.label);
    assert(c.x >= 0 && c.right <= r.width && c.y >= 0, label+' control stays on screen '+c.label);
    assert(c.hit, label+' control receives taps '+c.label);
    if (r.flat) assert.equal(c.bg, 'rgba(0, 0, 0, 0)', label+' flat-game utility has no resting box '+c.label);
  }
  if (r.controls.length === 2) assert(r.controls[0].right <= r.controls[1].x || r.controls[1].right <= r.controls[0].x, label+' utilities do not overlap');
  if (r.status) assert(r.status.scrollHeight <= r.status.clientHeight + 1, label+' complete turn instruction and hint fit');
  if (r.title) {
    assert(r.title.scrollWidth <= r.title.width + 1, label+' complete title fits: '+JSON.stringify(r.title));
    if (r.title.clip) assert(r.title.textBounds.top >= r.title.clip.y && r.title.textBounds.bottom <= r.title.clip.bottom, label+' title glyphs clear the header clip');
    for (const c of r.controls) assert(r.title.right <= c.x || r.title.x >= c.right || r.title.bottom <= c.y || r.title.y >= c.bottom, label+' title clears '+c.label);
  }
  rows.push({ label, ...r });
}
async function roomActions(frame, page, label) {
  const launcher = frame.locator('#roomMenu > summary');
  await launcher.click();
  await frame.locator('#bRoomResume').waitFor();
  const panel = await frame.locator('#roomMenuPanel').evaluate(n => { const r=n.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, w:innerWidth, h:innerHeight }; });
  assert(panel.x >= 0 && panel.y >= 0 && panel.right <= panel.w+1 && panel.bottom <= panel.h+1, label+' drawer stays in its viewport');
  await frame.locator('#roomMenu [data-report]').click();
  await frame.getByRole('dialog', { name:'Report an issue' }).waitFor();
  await frame.getByRole('button', { name:'Close issue report' }).click();
  assert(await launcher.evaluate(n => document.activeElement === n), label+' Report returns focus to Room');
  await launcher.click();
  await frame.locator('#bControls').click();
  await frame.locator('#howtoClose').waitFor();
  await frame.locator('#howtoClose').click();
  assert(await launcher.evaluate(n => document.activeElement === n), label+' Controls returns focus to Room');
  await launcher.click();
  const old = await frame.locator('#bSound').getAttribute('aria-checked');
  await frame.locator('#bSound').click();
  assert.notEqual(await frame.locator('#bSound').getAttribute('aria-checked'), old, label+' Sound works');
  await frame.locator('#bLobby').click();
  assert(await frame.locator('#roomConfirm').isVisible(), label+' End game asks before ending');
  await page.keyboard.press('Escape');
  assert(!(await frame.locator('#roomMenu').evaluate(n => n.open)), label+' Escape closes Room');
  assert(await launcher.evaluate(n => document.activeElement === n), label+' Escape restores Room focus');
}
async function visit(id, desktop = false, embedded = false) {
  const viewport = desktop ? { width:1280, height:800 } : { width:320, height:568 };
  const context = await browser.newContext({ viewport, isMobile:!desktop, hasTouch:!desktop, deviceScaleFactor:1, reducedMotion:'reduce', permissions:[] });
  await context.addInitScript(() => localStorage.setItem('pb_theme', 'day'));
  const page = await context.newPage(), bots = [];
  const recordError = message => {
    const item = { id, embedded, message };
    // Baseline c8844e1c logs these same guarded frameElement and resize
    // diagnostics in WebKit; retain them separately from unexpected errors.
    if (process.env.GAME_HEADER_BROWSER === 'webkit' && embedded &&
      ((message.includes('from accessing a frame with origin') && message.includes('Protocols, domains, and ports must match.')) || message === 'ResizeObserver loop completed with undelivered notifications.')) diagnostics.push(item);
    else errors.push(item);
  };
  page.on('pageerror', e => recordError(e.message));
  page.on('console', m => { if (m.type() === 'error') recordError(m.text()); });
  try {
    let frame = page;
    if (embedded) {
      const squad = 'header-'+crypto.randomUUID();
      await page.goto(parentUrl+'/?squad='+encodeURIComponent(squad));
      await page.locator('html[data-authorized="true"]').waitFor();
      frame = page.frames().find(f => f.url().startsWith(base));
      assert(frame, 'real signed cross-origin child');
      for (let i=0;i<3;i++) bots.push(await join({ t:'giggleJoin', ticket:ticket(squad,'Companion '+i) }));
    } else {
      await page.goto(base);
      await page.locator('#nm').fill('Header QA'); await page.locator('#bCreate').click();
      await page.locator('.roomcode').first().waitFor();
      const code = await page.locator('.roomcode').first().textContent();
      for (let i=0;i<3;i++) bots.push(await join({ t:'join', code, name:'Companion '+i }));
    }
    await frame.locator(`[data-how="${id}"]`).first().click();
    await frame.locator('#howtoGo:not([disabled])').click();
    await frame.locator('#gbody > *').first().waitFor({ timeout:90000 });
    await frame.locator('#roomMenu > summary').waitFor();
    if (id === 'pocket-karts') await frame.locator('.pke-stage canvas').waitFor({ timeout:90000 });
    await pause(650);
    for (const width of desktop ? [1280] : [320,375,390]) {
      await page.setViewportSize({ width, height:desktop?800:({320:568,375:667,390:844})[width] });
      for (const theme of ['day','night']) {
        const launcher = frame.locator('#roomMenu > summary');
        if (theme === 'night') { await launcher.click(); await frame.locator('#bTheme').click(); await frame.locator('#bRoomResume').click(); }
        const label = `${embedded?'embedded':'public'}-${id}-${width}-${theme}`;
        await page.mouse.move(0,desktop?799:567);
        await geometry(frame, label);
        if (process.env.GAME_HEADER_EVIDENCE && ([320,390,1280].includes(width))) await page.screenshot({ path:path.join(out,label+'.png') });
        if (width === viewport.width) await roomActions(frame,page,label);
        if (theme === 'night') { await launcher.click(); await frame.locator('#bTheme').click(); await frame.locator('#bRoomResume').click(); }
      }
    }
    if (!embedded && id === 'two-truths') {
      const button = frame.locator('#bGameScreenToggle');
      if (await button.isVisible() && await frame.evaluate(() => document.fullscreenEnabled && !!document.documentElement.requestFullscreen)) {
        await button.click(); await frame.waitForFunction(() => !!document.fullscreenElement);
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        await button.click(); await frame.waitForFunction(() => !document.fullscreenElement);
        assert.equal(await button.getAttribute('aria-pressed'), 'false');
      }
      await frame.evaluate(() => scrollTo(0,400));
      const launcher = frame.locator('#roomMenu > summary');
      await launcher.click(); await frame.locator('#bRoomResume').click();
      await frame.evaluate(() => scrollTo(0,0));
    }
  } finally { closeBots(bots); await context.close(); }
}
async function localHeaders() {
  for (const [width,height] of [[320,568],[375,667],[390,844]]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,deviceScaleFactor:1,reducedMotion:'reduce'});
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push({id:'local-two-truths',message:e.message}));
    try {
      await page.goto(base+'/same-room/?game=two-truths');
      await page.locator('#srName').fill('Sam, Jess, Mo'); await page.locator('#srAdd').click(); await page.locator('#srStart:not([disabled])').click();
      await page.locator('#srUnlock,.sr-play-head').first().waitFor();
      if (await page.locator('#srUnlock').isVisible()) await page.locator('#srUnlock').click();
      await page.locator('.sr-play-head').waitFor();
      for (const theme of ['day','night']) {
        if (theme==='night') await page.locator('#srTheme').click();
        await page.evaluate(async()=>{scrollTo(0,0);await document.fonts.ready;});
        const label='local-two-truths-'+width+'-'+theme;
        const state=await page.evaluate(()=>{
          const title=document.querySelector('.sr-turn-copy > p'),r=title.getBoundingClientRect();
          return {title:title.textContent,width:r.width,scrollWidth:title.scrollWidth,pageWidth:document.documentElement.scrollWidth,
            controls:[...document.querySelectorAll('.sr-bar a,.sr-bar button,#srCover')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};
        });
        assert(state.pageWidth<=width && state.scrollWidth<=state.width+1,label+' complete title and round metadata fit');
        for(const c of state.controls) assert(c.width>=44&&c.height>=44&&c.hit,label+' safe live controls');
        if(process.env.GAME_HEADER_EVIDENCE) await page.screenshot({path:path.join(out,label+'.png')});
        await page.locator('#srEnd').click(); await page.locator('#srCancelEnd').click();
        rows.push({label,...state});
      }
    } finally { await context.close(); }
  }
}
(async () => {
  const reserve = net.createServer(); await new Promise(r => reserve.listen(0,'127.0.0.1',r)); const port=reserve.address().port; await new Promise(r=>reserve.close(r)); base='http://127.0.0.1:'+port;
  parent=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/ticket'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ticket:ticket(u.searchParams.get('squad'),'Header QA')}));}
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="${base}/?embed=1&parentOrigin=${encodeURIComponent(parentUrl)}" allow="fullscreen"></iframe><script>const f=document.querySelector('iframe');addEventListener('message',async e=>{if(e.origin!==${JSON.stringify(base)}||e.source!==f.contentWindow)return;if(e.data.t==='ready'||e.data.t==='auth-needed'){const {ticket}=await(await fetch('/ticket?squad='+new URL(location).searchParams.get('squad'))).json();f.contentWindow.postMessage({v:1,t:'auth',ticket,n:crypto.randomUUID()},${JSON.stringify(base)});}if(e.data.t==='authed')document.documentElement.dataset.authorized='true';});</script>`);
  });
  await new Promise(r=>parent.listen(0,'127.0.0.1',r)); parentUrl='http://127.0.0.1:'+parent.address().port;
  server=spawn(process.execPath,['server/server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'development',GAME_BRIDGE_SECRET:secret,GIGGLE_ALLOWED_ORIGINS:parentUrl,GAME_REPORT_DB:path.join(out,'reports.sqlite')},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  for(let n=0;n<200&&!logs.includes('PartyBox on');n++){assert(server.exitCode===null,logs);await pause(50);}assert(logs.includes('PartyBox on'),logs);
  browser=await (process.env.GAME_HEADER_BROWSER === 'webkit' ? webkit.launch({headless:true}) : chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--use-angle=metal','--mute-audio']}));
  for(const id of games) { await visit(id); await visit(id,true); console.log('HEADER_PASS '+id); }
  if (!process.env.GAME_HEADER_SKIP_EMBED) for(const id of ['two-truths','doodle-guess','mega-tic-tac-toe']) await visit(id,false,true);
  if (!process.env.GAME_HEADER_SKIP_LOCAL) await localHeaders();
  assert.deepEqual(errors,[]);
  console.log(`GAME_HEADER_BROWSER_PASS: ${rows.length} game/size/theme cases; public controls and title fit; ${rows.filter(r=>r.label.startsWith('embedded-')).length} signed frame cases; ${diagnostics.length} known WebKit diagnostics; ${out}`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({pass:!process.exitCode,rows,errors,diagnostics},null,2));
  for(const ws of companions)ws.terminate();await browser?.close();server?.kill();if(parent){parent.closeAllConnections();parent.close();}
});
