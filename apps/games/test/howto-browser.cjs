'use strict';
// Optional real-browser regression: production catalogue, Room, sheets,
// keyboard tabs, roster refresh, settings ACK and ordinary Play. No protocol
// actions or DOM/state injection. Uses an installed Playwright (NODE_PATH).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=process.env.HOWTO_TEST_ROOT||path.resolve(__dirname,'..'),out=process.env.HOWTO_EVIDENCE_DIR;
const pause=ms=>new Promise(r=>setTimeout(r,ms)),clean=x=>JSON.parse(JSON.stringify(x,(k,v)=>/token|credential|authorization/i.test(k)?'[redacted]':v));
let server,browser,checks=0,clients=[],catalog,errors=[];const report={pass:false,root,node:process.version,started:new Date().toISOString(),scope:'Real isolated shipping application/Room and ordinary browser UI; headless CSS viewport, no physical/touch/Meet authentication claim'};
function save(name,value){if(out)fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2));}
function append(name,value){if(out)fs.appendFileSync(path.join(out,name),JSON.stringify(value)+'\n');}
function eq(a,b,label){assert.deepEqual(a,b,label);checks++;}
async function scene(label,c){await c.page.locator('.howto-dlg').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});const dom=await c.page.evaluate(()=>({viewport:[innerWidth,innerHeight],text:document.querySelector('.howto-dlg')?.innerText,intro:document.querySelector('#howtoPlayPanel')?.textContent,introHidden:document.querySelector('#howtoPlayPanel')?.hidden,introHeight:document.querySelector('#howtoPlayPanel')?.getBoundingClientRect().height,note:document.querySelector('.howto-note')?.textContent,custom:!!document.querySelector('#howtoCustom'),ctaDisabled:document.querySelector('#howtoGo')?.disabled,dialog:document.querySelector('.howto-dlg')?.getBoundingClientRect().toJSON()}));save(label+'.json',dom);if(out)await c.page.screenshot({path:path.join(out,label+'.png')});return dom;}
async function open(c,id){await c.page.locator('[data-how="'+id+'"]').first().click();await c.page.locator('.howto-dlg[open]').waitFor();}
async function close(c){await c.page.locator('#howtoClose').click();}
async function liveLudoTimer(previousInstance) {
  const ready=c=>c.state?.game==='ludo'&&c.state.instanceId!==previousInstance&&c.state.preparing===false&&c.state.phase==='roll'&&c.state.endsAt>c.state.gameNow;
  for(let n=0;n<100&&!clients.every(ready);n++)await pause(50);
  for(const c of clients){
    eq(ready(c),true,c.name+' has a fresh ready Ludo clock');
    eq(c.state.moveTimerMs,30000,c.name+' retains the acknowledged Move timer');
    const remaining=c.state.endsAt-c.state.gameNow;
    eq(remaining>=25000&&remaining<=30000,true,c.name+' deadline is 30 seconds away within startup tolerance');
  }
  eq(clients[0].state.instanceId,clients[1].state.instanceId,'both peers share the same live instance');
  eq(clients[0].state.endsAt,clients[1].state.endsAt,'both peers receive one authoritative deadline');
  return clients[0].state.endsAt-clients[0].state.gameNow;
}
(async()=>{if(out)fs.mkdirSync(out,{recursive:true});const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'howto-browser-'));const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const url='http://127.0.0.1:'+port;
server=spawn(process.execPath,['server/server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),GAME_REPORT_DB:path.join(scratch,'reports.sqlite')},stdio:['ignore','pipe','pipe']});let logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{logs+=b;append('server-log.ndjson',{text:String(b)});});for(let n=0;n<200;n++){try{const response=await fetch(url+'/');if(response.ok)break;}catch{}await pause(50);if(n===199)throw Error('Server did not become ready: '+logs);}browser=await chromium.launch({headless:true,channel:'chromium'});report.browser=browser.version();
async function client(name){const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),c={name,page,context,state:null};clients.push(c);page.on('pageerror',e=>{errors.push(name+': '+e.message);append('pageerrors.ndjson',{name,error:e.message});});page.on('console',m=>{if(m.type()==='error')errors.push(name+': '+m.text()+' '+m.location().url);});page.on('response',async r=>{if(r.status()===200&&/\.(js|mjs|css)(\?|$)/.test(r.url()))try{append('response-hashes.ndjson',{name,url:r.url(),sha256:crypto.createHash('sha256').update(await r.body()).digest('hex')});}catch{}});page.on('websocket',ws=>{ws.on('framereceived',f=>{try{const m=JSON.parse(f.payload);append('public-projections.ndjson',{name,at:Date.now(),m:clean(m)});if(m.t==='games')catalog=m.games;if(m.t==='state')c.state=m;}catch{}});ws.on('framesent',f=>{try{append('inputs.ndjson',{name,at:Date.now(),m:clean(JSON.parse(f.payload))});}catch{}});});await page.goto(url);await page.locator('#bBrowse').waitFor();await page.locator('#bBrowse').click();await page.locator('[data-how="ludo"]').first().waitFor();return c;}
const host=await client('Host');await open(host,'ludo');let d=await scene('home-ludo',host);eq(d.intro,'Create a room and invite your friends. Choose your settings before playing.','Ludo home sheet explains its real settings');eq(d.introHeight>0,true,'Ludo settings guidance is visible');eq(d.custom,true,'Ludo offers its Move timer settings');eq(catalog.find(g=>g.id==='ludo').schema.settings.find(s=>s.key==='moveTimer').options,['Off','30 seconds','60 seconds'],'catalogue declares actual Ludo Move timer choices');await close(host);await host.page.locator('#nm').fill('Sheet Host');await host.page.locator('#bCreate').click();await host.page.waitForURL('**/r/*');const code=host.page.url().split('/').pop();report.room=code;await open(host,'ludo');d=await scene('solo-ludo',host);eq(d.note,'Invite 1 more friend to play Ludo','one precise shortage footer');eq(d.ctaDisabled,true,'solo Play keeps preflight');eq(d.intro,'Choose your settings, then play together.','solo host can configure Ludo before inviting');eq((d.text.match(/Invite 1 more friend/g)||[]).length,1,'one shortage instruction');
await host.page.locator('#howtoPlayTab').focus();await host.page.keyboard.press('ArrowRight');eq(await host.page.locator('#howtoRulesTab').getAttribute('aria-selected'),'true','keyboard selects actual rules tab');eq(await host.page.locator('#howtoRulesPanel').isVisible(),true,'rules remain available');await host.page.keyboard.press('Home');eq(await host.page.locator('#howtoPlayTab').getAttribute('aria-selected'),'true','Home restores Play tab');eq(await host.page.locator('#howtoPlayPanel').isVisible(),true,'returning to Play restores real Ludo settings guidance');await host.page.locator('#howtoPlayTab').focus();
const peer=await client('Peer');await peer.page.goto(url+'/r/'+code);await peer.page.locator('#nm').fill('Sheet Peer');await peer.page.locator('#bJoin').click();await peer.page.locator('[data-how="ludo"]').first().waitFor();await host.page.locator('#howtoGo:not([disabled])').waitFor();eq(await host.page.evaluate(()=>document.activeElement?.id),'howtoPlayTab','roster refresh preserves keyboard tab focus');d=await scene('ready-ludo',host);eq(d.note,'Fits your group of 2','footer responds to actual roster');eq(d.intro,'Choose your settings, then play together.','ready Ludo host retains settings guidance');await close(host);
// Read rendered colors and hit rectangles after ordinary theme controls. No
// theme/DOM mutation: native review reproduced Night metadata contrast and a
// 43.398px Play target on a568px sheet.
function rgb(color) {
  if (color.startsWith('#')) return color.slice(1).match(/../g).map(v=>parseInt(v,16));
  return color.match(/[\d.]+/g).slice(0,3).map(Number);
}
function luminance(color) { return rgb(color).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0); }
function contrast(fg,bg) { const a=luminance(fg),b=luminance(bg); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); }
report.sheetMetrics=[];
for (const theme of ['day','night']) {
  if (await host.page.evaluate(()=>document.documentElement.dataset.theme||'day') !== theme) await host.page.locator('#bTheme').click();
  eq(await host.page.evaluate(()=>document.documentElement.dataset.theme||'day'),theme,'ordinary theme switch reaches '+theme);
  for (const viewport of [{width:390,height:844},{width:568,height:320}]) {
    await host.page.setViewportSize(viewport);
    for (const game of ['ludo','chain-reaction']) {
      await open(host,game);
      await scene('contrast-'+theme+'-'+game+'-'+viewport.width,host);
      const m=await host.page.evaluate(()=>{
        const rendered=el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {text:el.textContent,color:c.color,background:c.backgroundColor,width:r.width,height:r.height};};
        const styles=getComputedStyle(document.documentElement);
        return {theme:document.documentElement.dataset.theme||'day',viewport:[innerWidth,innerHeight],pills:[...document.querySelectorAll('.howto-pill')].map(rendered),tabs:[...document.querySelectorAll('.howto-tabs button')].map(rendered),accentDeep:styles.getPropertyValue('--accent-deep').trim()};
      });
      report.sheetMetrics.push({game,...m});
      for (const pill of m.pills) { pill.contrast=contrast(pill.color,pill.background); eq(pill.contrast>=4.5,true,theme+' '+game+' metadata contrast >=4.5 ('+pill.contrast.toFixed(2)+')'); }
      eq(rgb(m.pills[1].color),rgb(m.accentDeep),theme+' second pill retains accent override');
      for (const tab of m.tabs) eq(tab.width>=44&&tab.height>=44,true,theme+' '+game+' '+tab.text+' target >=44x44');
      await close(host);
    }
  }
}
await host.page.setViewportSize({width:390,height:844});await host.page.locator('#bTheme').click();eq(await host.page.evaluate(()=>document.documentElement.dataset.theme||'day'),'day','ordinary controls restore Day');
eq(catalog.length,42,'real catalogue still has42 games');report.catalogue=[];for(const g of catalog){await open(host,g.id);const info=await host.page.evaluate(()=>({intro:document.querySelector('#howtoPlayPanel').textContent,introHidden:document.querySelector('#howtoPlayPanel').hidden,height:document.querySelector('#howtoPlayPanel').getBoundingClientRect().height,custom:!!document.querySelector('#howtoCustom'),tabs:[...document.querySelectorAll('.howto-tabs [role="tab"]')].map(t=>t.textContent)}));eq(info.custom,!!g.customizable,g.id+' options match real metadata');eq(info.tabs,['Play','How to play'],g.id+' keeps the two real tabs');eq(!!info.intro,!!g.customizable,g.id+' intro follows actual customization');if(!g.customizable)eq(info.height,0,g.id+' empty intro has no layout box');report.catalogue.push({id:g.id,customizable:!!g.customizable,...info});await close(host);}
await open(host,'chain-reaction');d=await scene('customizable-chain',host);eq(d.intro,'Choose your settings, then play together.','customizable host retains settings guidance');await host.page.locator('#howtoCustom').click();await host.page.locator('#df-chain-reaction-moveTimer').selectOption('60 seconds');await host.page.locator('#dlgSave').click();await host.page.locator('#dlgSave').waitFor({state:'detached'});await open(host,'chain-reaction');eq(await host.page.locator('.howto-meta').innerText().then(t=>t.includes('60 seconds')),true,'real settings ACK appears in sheet');await scene('saved-chain',host);await close(host);
await open(host,'ludo');await host.page.locator('#howtoCustom').click();
const moveTimer=host.page.locator('#df-ludo-moveTimer');eq(await moveTimer.inputValue(),'Off','Ludo Move timer defaults to Off');eq(await moveTimer.locator('option').allTextContents(),['Off','30 seconds','60 seconds'],'real customizer exposes the three supported timers');
await moveTimer.selectOption('30 seconds');await host.page.locator('#dlgSave').click();await host.page.locator('#dlgSave').waitFor({state:'detached'});await open(host,'ludo');eq(await host.page.locator('.howto-meta').innerText().then(t=>t.includes('30 seconds')),true,'Ludo settings ACK updates the sheet');await scene('saved-ludo-move-timer',host);await host.page.locator('#howtoCustom').click();eq(await host.page.locator('#df-ludo-moveTimer').inputValue(),'30 seconds','acknowledged Ludo timer persists when reopening');await host.page.locator('#dlgSave').click();await host.page.locator('#dlgSave').waitFor({state:'detached'});await open(host,'ludo');await host.page.locator('#howtoGo:not([disabled])').click();await host.page.locator('.ld-board').waitFor();await peer.page.locator('.ld-board').waitFor();eq(host.state.game,'ludo','ordinary sheet Play starts selected game');eq(host.state.spectator,false,'host is genuinely seated');eq(peer.state.spectator,false,'second player is genuinely seated');
const initialRemaining=await liveLudoTimer();
const firstInstance=host.state.instanceId,timedOutSide=host.state.turn,timeoutStarted=performance.now();
await host.page.locator('.bk-final').waitFor({timeout:45000});await peer.page.locator('.bk-final').waitFor();eq(performance.now()-timeoutStarted>=initialRemaining-1000,true,'natural timeout does not fire early');eq(host.state.outReason[timedOutSide],'timeout','real unmodified server clock forfeits the idle player');eq(peer.state.result.reason,'timeout','peer receives the same timed-out result');eq(host.state.phase,'done','two-player Ludo settles after timeout');eq(peer.state.outReason[timedOutSide],'timeout','both clients identify the forfeited side');eq(host.state.scores[host.state.seats[timedOutSide]],0,'timed-out player earns zero');eq(host.state.scores[host.state.result.winnerPid],300,'remaining player earns the authoritative win');if(out)await host.page.screenshot({path:path.join(out,'ludo-natural-timeout.png')});report.moveTimer={milliseconds:host.state.moveTimerMs,initialRemaining,observedElapsedMs:performance.now()-timeoutStarted,timedOutSide,result:host.state.result};
await host.page.locator('#bRematch').click();await liveLudoTimer(firstInstance);eq(host.state.outReason,{},'rematch clears prior timeout');
await host.page.locator('#roomMenu>summary').click();await host.page.locator('#bLobby').click();await host.page.locator('#bEndConfirm').click();await host.page.locator('#bChange').click();await host.page.locator('[data-how="ludo"]').first().waitFor();for(const c of clients){await c.page.locator('a.brand[href="/"]').click();await c.page.waitForURL(url+'/');}eq(errors,[],'no page or console errors, including asset failures');report.pass=true;report.checks=checks;
})().catch(async e=>{report.error=e.stack;report.checks=checks;if(out&&clients[0])try{await clients[0].page.screenshot({path:path.join(out,'failure.png')});}catch{}console.error(e.stack);process.exitCode=1;}).finally(async()=>{report.ended=new Date().toISOString();save('summary.json',report);if(browser)await browser.close();if(server)server.kill('SIGTERM');console.log('HOWTO_BROWSER',JSON.stringify({pass:report.pass,checks,error:report.error}));});
