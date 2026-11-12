'use strict';
// Real entries, configure ACKs, native focus and two-seat matches; no injected
// snapshots. Optional browser regression with installed Playwright/Chrome.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.CUSTOMIZER_RETURN_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'customizer-return-'));
fs.mkdirSync(out,{recursive:true});const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})}),base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,['server/server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'test',REPORT_DB_PATH:out+'/reports-db.json'},stdio:['ignore','pipe','pipe']});
 let logs='',browser;server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);const reports=[],contexts=[];
 async function fresh(width){
  const c=await browser.newContext({viewport:{width,height:width===390?844:800},hasTouch:width===390,isMobile:width===390,serviceWorkers:'block'});contexts.push(c);
  // Observe the app's decoded realtime packets without changing their content.
  await c.route('**/js/app.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("case 'state': {","case 'state': { window.__settingsState=msg;")});});
  await c.addInitScript(()=>{const Native=WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{if(typeof e.data!=='string')return;const m=JSON.parse(e.data);if(m.t==='state')window.__settingsState=m;if(m.t==='room')window.__settingsRoom=m.room;})}}});return c;
 }
 const activate=(locator,width)=>width===390?locator.tap():locator.click();
 async function editor(frame,width){await activate(frame.locator('#howtoCustom'),width);await frame.locator('#dlgSave').waitFor();assert.equal(await frame.locator('.howto-dlg[open]').count(),0,'one modal at a time');}
 async function returned(frame,focus){await frame.locator('#dlgSave').waitFor({state:'detached'});await frame.locator('.howto-dlg[open]').waitFor();await frame.waitForFunction(id=>document.activeElement?.id===id,focus);assert.equal(await frame.locator('.howto-dlg').count(),1,'exactly one parent returns');await frame.locator('.howto-dlg').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));}
 async function choose(frame,width,map){const card=frame.locator('.ks-map[data-kart-value="'+map+'"]');await card.scrollIntoViewIfNeeded();await activate(card,width);await activate(frame.locator('[data-kart-key="roundSeconds"][data-kart-value="60"]'),width);}
 try{
  for(let i=0;i<150&&!logs.includes('PartyBox on');i++)await pause(50);assert(logs.includes('PartyBox on'),logs);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
  for(const width of [1280,390])for(const entry of ['home-card','practice']){
   const c=await fresh(width),page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let host,guest,guestContext;
   if(entry==='practice'){
    await page.goto(base+'/practice/?game=pocket-karts');await page.locator('#practiceStart:not([disabled])').click();await page.waitForFunction(()=>document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'),null,{timeout:45000});
    host=page.frames().find(f=>/[?&]seat=1(?:&|$)/.test(f.url()));guest=page.frames().find(f=>/[?&]seat=2(?:&|$)/.test(f.url()));await host.locator('#howtoCustom').waitFor();await editor(host,width);
   }else{
    await page.goto(base);await page.locator('[data-how="pocket-karts"]:not(.hand-card)').first().click();await page.locator('#howtoName').fill('Settings host');await activate(page.locator('#howtoCustom'),width);await page.locator('#dlgSave').waitFor();
    const code=await page.evaluate(()=>__settingsRoom.code);guestContext=await fresh(width);guest=await guestContext.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto(base+'/r/'+code);await guest.locator('#nm').fill('Settings peer');await guest.locator('#bJoin').click();await page.waitForFunction(()=>__settingsRoom.players.filter(p=>p.connected).length===2);host=page;
   }
   const map=entry==='practice'?'Harbor Fork':'Skyport Split',mapId=entry==='practice'?'harbor-fork':'skyport-split';
   // Escape and Close discard drafts and return focus to Maps & settings.
   await choose(host,width,map);await page.keyboard.press('Escape');await returned(host,'howtoCustom');assert(await host.locator('#howtoGo').isEnabled(),'Play available after Cancel');
   await editor(host,width);await choose(host,width,map);await activate(host.locator('#dlgClose'),width);await returned(host,'howtoCustom');
   await editor(host,width);await choose(host,width,map);
   if(width===1280){await host.locator('#dlgSave').focus();await page.keyboard.press('Enter');}else await host.locator('#dlgSave').tap();
   await returned(host,'howtoGo');
   const saved=await host.evaluate(()=>({settings:__settingsRoom.config['pocket-karts'].settings,focus:document.activeElement.id,meta:document.querySelector('.howto-meta').innerText,overflow:document.documentElement.scrollWidth-innerWidth}));
   assert.equal(saved.settings.map,map);assert.equal(saved.settings.roundSeconds,60);assert(saved.meta.includes(map),'card shows confirmed map');assert.equal(saved.overflow,0);
   await page.screenshot({path:out+'/'+width+'-'+entry+'-saved.png'});
   await editor(host,width);assert.equal(await host.locator('#df-pocket-karts-map').inputValue(),map,'reopening retains confirmed map');await activate(host.locator('#dlgClose'),width);await returned(host,'howtoCustom');
   await activate(host.locator('#howtoGo'),width);
   for(const seat of [host,guest])await seat.waitForFunction(()=>['live','drive'].includes(window.__settingsState?.phase)&&!window.__settingsState.preparing,null,{timeout:120000});
   const initial=await host.evaluate(()=>{const s=__settingsState,k=s.karts.find(k=>k.id===s.you||k.pid===s.you);return{map:s.mapId,karts:s.karts.length,position:k.pose?.position||k.physicalPose?.position}});
   assert.equal(initial.map,mapId);assert.equal(initial.karts,2);
   await host.locator('canvas[data-engine]').first().click({force:true});await page.keyboard.down('ArrowUp');await pause(1000);await page.keyboard.up('ArrowUp');
   const end=await host.evaluate(()=>{const s=__settingsState,k=s.karts.find(k=>k.id===s.you||k.pid===s.you);return k.pose?.position||k.physicalPose?.position}),movement=Math.hypot(end.x-initial.position.x,end.z-initial.position.z);
   assert(movement>1,'selected arena actually drives');await page.screenshot({path:out+'/'+width+'-'+entry+'-started.png'});assert.deepEqual(errors,[]);
   reports.push({width,entry,saved,initial,movement,errors});console.log(JSON.stringify(reports.at(-1)));fs.writeFileSync(out+'/report.json',JSON.stringify({base,reports},null,2));
   if(entry==='practice')await page.locator('#practiceStop').click();await guestContext?.close();await c.close();
  }
  // A direct settings link has no parent card to restore.
  for(const width of [1280,390]){
   const c=await fresh(width),page=await c.newPage();await page.goto(base+'/?game=pocket-karts&name=Direct%20setup&wantsetup=1');await page.locator('#dlgSave').waitFor();await choose(page,width,'Skyport Split');await activate(page.locator('#dlgSave'),width);await page.locator('#dlgSave').waitFor({state:'detached'});
   assert.equal(await page.locator('.howto-dlg[open]').count(),0,'standalone setup returns to its own lobby');assert.equal(await page.evaluate(()=>__settingsRoom.config['pocket-karts'].settings.map),'Skyport Split');reports.push({width,entry:'direct-settings',standalone:true});await c.close();
  }
  fs.writeFileSync(out+'/report.json',JSON.stringify({base,reports},null,2));console.log('CUSTOMIZER_RETURN_BROWSER_PASS '+out);
 }finally{for(const c of contexts)await c.close().catch(()=>{});await browser?.close();server.kill();fs.writeFileSync(out+'/server.log',logs);}
})().catch(e=>{console.error(e);process.exitCode=1;});
