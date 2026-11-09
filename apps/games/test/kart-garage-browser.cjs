'use strict';
/* Optional real Chromium check. The fixture uses the real classic authority,
 * production view/assets and actual garage action messages. Only the starting
 * wallet/levels and finished-match clock are seeded for repeatable screenshots. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
const PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/skins.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/kart-arena.css"><style>html,body{margin:0}#gbody{margin:0;padding:0}#view{min-width:0}</style></head><body class="game-immersive game-playing" data-game="pocket-karts" data-family="arcade"><main id="gbody" data-layout="immersive"><div id="view"></div></main><script type="module">
import {createKartView} from '/js/engines/kart-view.js';
const root=document.querySelector('#view'),view=createKartView({title:'Pocket Karts'});let S,base=0;
window.cues=[];window.sent=[];
const api={now:()=>S.serverNow+performance.now()-base,context:()=>({isHost:false,connected:true,sound:true,looks:{p0:{driver:'bunny',color:0x21a9af}}}),announce(){},cue:(name,options)=>window.cues.push({name,...options}),send:async action=>{window.sent.push(action);const s=await fetch('/qa/action',{method:'POST',body:JSON.stringify(action)}).then(r=>r.json());apply(s);}};
function apply(s){S=s;base=performance.now();view.update(root,S,api);window.snapshot=s;}
window.resetGarage=async options=>{const q=new URLSearchParams(options);apply(await fetch('/qa/reset?'+q).then(r=>r.json()));};
window.repaintGarage=()=>apply(S);
view.mount(root,api);await window.resetGarage({coins:120});window.garageReady=true;
</script></body></html>`;
async function createFixture() {
  const def=require('../games/pocket-karts/server');await def.initialize?.();
  const players=[{id:'p0',name:'Alex',connected:true},{id:'p1',name:'Sam',connected:true}];
  let state,ctx,instance=0;
  const project=()=>({...def.view(state,'p0'),you:'p0',me:'p0',players,instanceId:'garage-'+instance,game:'pocket-karts',serverNow:ctx.time});
  function reset(q) {
    if(state)def.dispose?.(state);
    ctx={time:7000000,wallet:{},now:()=>ctx.time,players:()=>players,allPlayers:()=>players,settings:()=>({mode:'Garage Battle',map:'Rookie Ring'}),content:()=>({}),session:()=>ctx.wallet,hostId:()=> 'p0',broadcast(){},lobby(){},award(){},later:()=>()=>{}};
    state=def.create(ctx);ctx.time+=3100;def.onTick(state,ctx);ctx.time=state.endsAt+1;def.onTick(state,ctx);
    assert.equal(state.phase,'done','fixture reaches real results');
    ctx.wallet.coins.p0=Number(q.get('coins')??120);
    ctx.wallet.upgrades.p0={engine:Number(q.get('engine')||0),handling:Number(q.get('handling')||0),reload:Number(q.get('reload')||0)};
    state.coins={...ctx.wallet.coins};state.garageUpgrades=structuredClone(ctx.wallet.upgrades);
    instance++;return project();
  }
  const server=http.createServer(async(req,res)=>{
    try {
      const u=new URL(req.url,'http://local');
      if(u.pathname==='/qa/reset'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(reset(u.searchParams)));}
      if(u.pathname==='/qa/action') {let body='';for await(const chunk of req)body+=chunk;def.onAction(state,ctx,'p0',JSON.parse(body));res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(project()));}
      if(u.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(PAGE);}
      const file=path.join(root,'public',decodeURIComponent(u.pathname));
      if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end('Not found');}
      res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.glb':'model/gltf-binary','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
    } catch(error){res.statusCode=500;res.end(error.stack);}
  });
  server.on('close',()=>{if(state)def.dispose?.(state);});return server;
}
async function run() {
  const {chromium}=require('playwright'),out=process.env.GARAGE_EVIDENCE_DIR||'/tmp/codex-garage-shots';fs.mkdirSync(out,{recursive:true});
  let server,browser;const report={pass:false,cases:[],scope:'Chromium emulation; real production view, GLBs and classic server garage actions; seeded finished-match wallet and levels.'};
  try {
    let url=process.env.GARAGE_TEST_URL;
    if(!url){server=await createFixture();await new Promise(r=>server.listen(Number(process.env.GARAGE_TEST_PORT||process.env.KART_BROWSER_PORT)||0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;}
    browser=await chromium.launch({headless:true,executablePath:process.env.KART_BROWSER||process.env.KART32_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=metal']});report.browser=browser.version();console.log('GARAGE_BROWSER_STARTED',report.browser);
    for(const theme of ['day','night'])for(const viewport of [{width:1280,height:800},{width:768,height:1024},{width:390,height:844},{width:320,height:740},{width:430,height:932}]) {
      const label=`${viewport.width}x${viewport.height}-${theme}`;
      if(process.env.GARAGE_TEST_CASE && process.env.GARAGE_TEST_CASE!==label)continue;
      const context=await browser.newContext({viewport,isMobile:viewport.width<860,hasTouch:viewport.width<860,deviceScaleFactor:1});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
      await context.route('**/js/renderers/three-view.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace("  } catch (e) {\n    signal?.removeEventListener('abort', releaseRenderer);","  } catch (e) {\n    console.error('Garage fixture build failed',e.stack);\n    signal?.removeEventListener('abort', releaseRenderer);")});});
      await page.addInitScript(theme=>document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.theme=theme),theme);
      await page.goto(url);await page.waitForFunction(()=>window.garageReady);await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>document.querySelector('.pk-garage-thumbnail')?.src.startsWith('data:image/png')&&!document.querySelector('.pk-garage-thumbnail').hidden,{},{timeout:30000}).catch(async error=>{
        await page.screenshot({path:path.join(out,label+'-preview-failure.png')});
        console.log('GARAGE_PREVIEW_DIAGNOSTIC',JSON.stringify({errors,dom:await page.evaluate(()=>({body:document.body.innerText,canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()})),image:document.querySelector('.pk-garage-thumbnail')?.outerHTML}))}));throw error;
      });
      const garage=page.locator('.pk-garage');await garage.scrollIntoViewIfNeeded();
      const sizes=()=>garage.evaluate(el=>({wallet:el.querySelector('.pk-wallet').offsetWidth,cards:[...el.querySelectorAll('.pk-upgrade')].map(c=>[c.offsetWidth,c.offsetHeight])}));
      const initialSizes=await sizes();
      await garage.evaluate(el=>{const p=el.closest('.pk-result');p.scrollTop+=el.getBoundingClientRect().top-p.getBoundingClientRect().top-12;});
      await page.screenshot({path:path.join(out,label+'-header.png')});
      await garage.scrollIntoViewIfNeeded();
      const geometry=await garage.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,pageWidth:document.documentElement.scrollWidth,buttons:[...el.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}),overflow:[...el.querySelectorAll('*')].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().right>el.getBoundingClientRect().right+1).map(n=>n.className)}));
      assert(geometry.pageWidth<=viewport.width+1,label+' viewport fits');assert(geometry.scroll<=geometry.client+1,label+' garage fits');assert.deepEqual(geometry.overflow,[],label+' no clipped contents');
      for(const b of geometry.buttons)assert(b.width>=44&&b.height>=44&&b.left>=0&&b.right<=viewport.width+1,label+' buy targets fit');
      await page.locator('.pk-result').screenshot({path:path.join(out,label+'-affordable.png')});await page.screenshot({path:path.join(out,label+'-screen.png')});
      const before=await page.locator('.pk-garage-thumbnail').getAttribute('src');
      await page.locator('[data-upgrade="engine"]').focus();
      await page.locator('[data-upgrade="engine"]').click();await page.waitForFunction(()=>document.querySelector('[data-part="engine"]')?.dataset.level==='1');
      await page.waitForFunction(before=>document.querySelector('.pk-garage-thumbnail')?.src!==before&&document.querySelector('.pk-garage-thumbnail')?.src.startsWith('data:image/png'),before);
      await page.waitForFunction(()=>document.querySelector('.pk-wallet-digits').textContent==='100');
      assert.equal(await page.evaluate(()=>window.cues.length),1);
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-upgrade')),'engine','focus returns to the buy button after confirmation');
      assert.deepEqual(await sizes(),initialSizes,label+' purchase keeps card and wallet sizes');
      assert.match(await page.locator('.pk-garage-feedback').textContent(),/Engine upgraded to level 1/);
      const sent=await page.evaluate(()=>window.sent);assert.equal(sent.filter(a=>a.garage).length,1);assert.equal(sent.find(a=>a.garage).garage.category,'engine');
      await page.evaluate(()=>window.repaintGarage());assert.equal(await page.evaluate(()=>window.cues.length),1);
      await page.locator('.pk-result').screenshot({path:path.join(out,label+'-bought.png')});
      // Different confirmed levels change steering and the mounted weapon rack too.
      if(viewport.width===1280) {
        for(const part of ['handling','reload']) {await page.locator(`[data-upgrade="${part}"]`).click();await page.waitForFunction(part=>document.querySelector(`[data-part="${part}"]`)?.dataset.level==='1',part);}
        await page.waitForTimeout(600);await page.locator('.pk-result').screenshot({path:path.join(out,label+'-all-parts.png')});
      }
      await page.evaluate(()=>window.resetGarage({coins:15}));await page.waitForFunction(()=>document.querySelector('[data-part="engine"]')?.dataset.state==='unaffordable');
      assert.match(await page.locator('#pk-upgrade-reason-engine').textContent(),/Need 5 more coins/);assert(await page.locator('[data-upgrade="engine"]').isDisabled());
      await page.locator('.pk-result').screenshot({path:path.join(out,label+'-unaffordable.png')});
      await page.evaluate(()=>window.resetGarage({coins:120,engine:2,handling:2,reload:2}));
      await page.waitForFunction(()=>document.querySelectorAll('[data-level="2"]').length===3);
      const statFits=await garage.locator('.pk-upgrade-stat b').evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1));
      assert(statFits,label+' current and next stats fit at level two');
      await page.evaluate(()=>window.resetGarage({coins:999,engine:3,handling:3,reload:3}));await page.waitForFunction(()=>document.querySelectorAll('[data-state="maxed"]').length===3);await page.waitForTimeout(600);
      assert.equal(await page.locator('.pk-upgrade-pips .is-filled').count(),9);
      assert.deepEqual(await sizes(),initialSizes,label+' MAX keeps card and wallet sizes');
      await garage.evaluate(el=>{const p=el.closest('.pk-result');p.scrollTop=p.scrollHeight;});
      await page.screenshot({path:path.join(out,label+'-footer.png')});
      await page.locator('.pk-result').screenshot({path:path.join(out,label+'-max.png')});
      const cues=await page.evaluate(()=>window.cues.length);await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.resetGarage({coins:120}));await page.locator('[data-upgrade="engine"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-part="engine"]')?.dataset.level==='1');
      assert.equal(await page.locator('.pk-garage').evaluate(el=>el.getAnimations({subtree:true}).length),0,label+' reduced motion has no purchase movement');
      assert.equal(await page.evaluate(()=>window.cues.length),cues+1);
      assert.deepEqual(errors,[],label+' browser errors');report.cases.push({label,geometry});console.log('GARAGE_BROWSER_CASE_PASS',label);await context.close();
    }
    report.pass=true;console.log('GARAGE_BROWSER_PASS',report.cases.length);
  } catch(error) {report.error=error.stack;throw error;} finally {await browser?.close();await new Promise(r=>server?server.close(r):r());fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));}
}
module.exports={createFixture};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
