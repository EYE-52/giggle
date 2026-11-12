'use strict';
// Native UI, real room configuration and real classic/raised rematches. The
// current source runtime is bundled in memory; the shipping bundle is untouched.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.KART_PICKER_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'kart-picker-')),pause=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});}),base=`http://127.0.0.1:${port}`;
 const runtime=require('../scripts/build-kart-runtime').build(false).outputFiles[0].text;
 const server=spawn(process.execPath,['server/server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'test',REPORT_DB_PATH:out+'/reports-db.json'},stdio:['ignore','pipe','pipe']});
 let logs='',browser;server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);const reports=[];
 async function fresh(width){
  const c=await browser.newContext({viewport:{width,height:width===390?844:800},hasTouch:width===390,isMobile:width===390,serviceWorkers:'block'});
  await c.route('**/js/engines/kart-runtime.mjs*',route=>route.fulfill({contentType:'text/javascript',body:runtime}));
  await c.route('**/js/app.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("case 'state': {","case 'state': { window.__pickerState=msg;")});});
  await c.addInitScript(()=>{const Native=WebSocket;window.WebSocket=class extends Native{constructor(...a){super(...a);this.addEventListener('message',e=>{if(typeof e.data!=='string')return;const m=JSON.parse(e.data);if(m.t==='room')window.__pickerRoom=m.room;});}};});return c;
 }
 const activate=(node,width)=>width===390?node.tap():node.click();
 async function clear(node){await node.scrollIntoViewIfNeeded();return node.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return{width:b.width,height:b.height,top:b.top,bottom:b.bottom,unobscured:el===hit||el.contains(hit),overflow:document.documentElement.scrollWidth-innerWidth};});}
 async function live(host,peer,mapId){for(const f of [host,peer])await f.waitForFunction(id=>(window.__pickerState?.mapId||window.__pickerState?.map?.id)===id&&['live','drive'].includes(window.__pickerState.phase)&&!window.__pickerState.preparing,mapId,{timeout:90000}).catch(async error=>{fs.writeFileSync(out+'/failure-state.json',JSON.stringify(await f.evaluate(()=>({state:window.__pickerState,room:window.__pickerRoom,body:document.body.innerText.slice(-3000)})),null,2));throw error;});return host.evaluate(()=>({map:window.__pickerState.mapId||window.__pickerState.map?.id,profile:window.__pickerState.profile,karts:window.__pickerState.karts.length,instance:window.__pickerState.instanceId}));}
 async function end(host,width){console.log(width+' waiting for natural60s results');await host.waitForFunction(()=>window.__pickerState?.phase==='done',null,{timeout:90000});await host.locator('#bRematch').waitFor();}

 async function next(host,width,key,label){const tile=host.locator(`button[data-arena="${key}"]`);const rect=await clear(tile);if(!rect.unobscured)await (typeof host.page==='function'?host.page():host).screenshot({path:out+'/'+width+'-covered-result.png'});assert(rect.unobscured,'last result row is above footer');if(width===1280){await tile.focus();await tile.press('Enter');}else await tile.tap();await host.waitForFunction(map=>window.__pickerRoom.config['pocket-karts'].settings.map===map,label);await host.locator(`button[data-arena="${key}"][aria-pressed="true"]`).waitFor();if(width===1280)assert.equal(await host.evaluate(()=>document.activeElement?.dataset.arena),key,'save ACK preserves keyboard focus');return rect;}
 try{
  for(let i=0;i<200&&!logs.includes('PartyBox on');i++)await pause(25);assert(logs.includes('PartyBox on'),logs);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
  for(const width of [1280,390]){
   const c=await fresh(width),page=await c.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});let host,peer,guestContext;
   if(width===390){await page.goto(base+'/practice/?game=pocket-karts');await page.locator('#practiceStart:not([disabled])').click();await page.waitForFunction(()=>document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'),null,{timeout:45000});host=page.frames().find(f=>/[?&]seat=1(?:&|$)/.test(f.url()));peer=page.frames().find(f=>/[?&]seat=2(?:&|$)/.test(f.url()));await host.locator('#howtoCustom').click();}
   else{await page.goto(base);await page.locator('[data-how="pocket-karts"]:not(.hand-card)').first().click();await page.locator('#howtoName').fill('Arena host');await page.locator('#howtoCustom').click();await page.locator('#dlgSave').waitFor();const code=await page.evaluate(()=>window.__pickerRoom.code);guestContext=await fresh(width);peer=await guestContext.newPage();await peer.goto(base+'/r/'+code);await peer.locator('#nm').fill('Arena peer');await peer.locator('#bJoin').click();host=page;}
   await host.locator('#dlgSave').waitFor();assert.equal(await host.locator('.ks-map:not([hidden])').count(),18);
   await host.locator('.ks-map img').evaluateAll(images=>Promise.all(images.map(async image=>{await image.decode();if(image.naturalWidth!==480||image.naturalHeight!==270)throw Error('Incorrect preview dimensions');})));
   // Native End key selects and reveals the final tile, including its label.
   await host.locator('.ks-map[aria-checked="true"]').focus();await host.locator('.ks-map[aria-checked="true"]').press('End');
   const lastSetup=await clear(host.locator('.ks-map[data-kart-value="Neon Yard"]'));assert(lastSetup.unobscured,'last setup tile is not under Save');assert.equal(lastSetup.overflow,0);
   await page.screenshot({path:`${out}/${width}-setup-final-row.png`});
   for(const mode of ['Zap Battle','Team Battle','Capture the Flag','Star Rush','Garage Battle']){await activate(host.locator(`[data-kart-key="mode"][data-kart-value="${mode}"]`),width);assert.equal(await host.locator('.ks-map:not([hidden])').count(),18);}
   await activate(host.locator('[data-kart-key="mode"][data-kart-value="Garage Battle"]'),width);await activate(host.locator('[data-kart-key="roundSeconds"][data-kart-value="60"]'),width);await host.locator('#dlgSave').click();await host.locator('#howtoGo').waitFor();await activate(host.locator('#howtoGo'),width);console.log(width+' starting classic');
   const first=await live(host,peer,'neon');assert.equal(first.karts,2);await end(host,width);
   assert.equal(await host.locator('button[data-arena]').count(),18);assert.equal(await peer.locator('button[data-arena]:disabled').count(),18);
   assert.equal(await host.locator('[data-next-mode]').count(),5,'results offer five modes');assert.equal(await host.locator('[data-next-mode="Garage Battle"]').getAttribute('aria-pressed'),'true','Garage stays selected');
   if(width===1280){await host.locator('button[data-arena]').first().focus();for(let i=1;i<18;i++)await host.locator(':focus').press('Tab');assert.equal(await host.evaluate(()=>document.activeElement.dataset.arena),'legacy-neon','all18maps reachable by native Tab');}
   const lastResult=await clear(host.locator('button[data-arena="legacy-neon"]'));assert(lastResult.unobscured);await page.screenshot({path:`${out}/${width}-classic-results-final-row.png`});
   await next(host,width,'arena-skyport-split','Skyport Split');await host.waitForFunction(()=>window.__pickerRoom.config['pocket-karts'].settings.mode==='Garage Battle');await page.screenshot({path:`${out}/${width}-classic-next-skyport.png`});
   await activate(host.locator('#bRematch'),width);const raised=await live(host,peer,'skyport-split');assert.equal(raised.profile,'elevated-combat-v1');await end(host,width);assert.equal(await host.locator('button[data-arena]').count(),18);
   const raisedLast=await next(host,width,'legacy-frost','Frosty Pass');await page.screenshot({path:`${out}/${width}-raised-next-legacy.png`});
   // Shared Arenas opens the full editor from results without inventing a card.
   await activate(host.locator('#bKartArenas'),width);await host.locator('#dlgSave').waitFor();assert.equal(await host.locator('.ks-map:not([hidden])').count(),18);assert.equal(await host.locator('#df-pocket-karts-map').inputValue(),'Frosty Pass');
   await activate(host.locator('.ks-map[data-kart-value="Bumper Blocks"]'),width);await host.locator('#dlgSave').click();await host.locator('#dlgSave').waitFor({state:'detached'});assert.equal(await host.locator('.howto-dlg[open]').count(),0);await host.locator('button[data-arena="legacy-blocks"][aria-pressed="true"]').waitFor();
   await activate(host.locator('#bRematch'),width);const legacy=await live(host,peer,'blocks');assert.notEqual(legacy.profile,'elevated-combat-v1');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);assert.deepEqual(errors,[]);
   await page.screenshot({path:`${out}/${width}-legacy-rematch.png`});
   await activate(host.locator('#roomMenu > summary'),width);await activate(host.locator('#bLobby'),width);await activate(host.locator('#bEndConfirm'),width);await host.locator('#bKartArenas').waitFor();await activate(host.locator('#bKartArenas'),width);await host.locator('#dlgSave').waitFor();assert.equal(await host.locator('.ks-map:not([hidden])').count(),18,'host-end shell Battle picker also exposes all18');await activate(host.locator('#dlgClose'),width);
   reports.push({width,entry:width===390?'practice':'normal room',lastSetup,lastResult,raisedLast,first,raised,legacy,errors});fs.writeFileSync(out+'/report.json',JSON.stringify({base,reports},null,2));console.log(JSON.stringify(reports.at(-1)));
   if(width===390)await page.locator('#practiceStop').click();await guestContext?.close();await c.close();
  }
  console.log('KART_ARENA_PICKER_BROWSER_PASS '+out);
 }finally{await browser?.close();server.kill();fs.writeFileSync(out+'/server.log',logs);}
})().catch(error=>{console.error(error);process.exitCode=1;});
