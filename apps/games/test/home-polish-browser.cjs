'use strict';
/* Optional local homepage acceptance. Actual Games HTTP/WS server and app,
 * task-owned SQLite,isolated anonymous players;no production/media/accounts. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'giggle-home-polish-'));
const artifacts=process.env.HOME_ARTIFACT_DIR||scratch,root=path.resolve(__dirname,'..');
fs.mkdirSync(artifacts,{recursive:true});
let server,browser,port,output='';const results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const originalApp=execFileSync('git',['show','da239a09:apps/games/public/js/app.js'],{cwd:root,encoding:'utf8'});
async function visit(viewport,night,before=false){
 const context=await browser.newContext({viewport,permissions:[],deviceScaleFactor:1});const page=await context.newPage(),errors=[],messages=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('websocket',socket=>{assert.equal(new URL(socket.url()).host,`127.0.0.1:${port}`);socket.on('framesent',frame=>{try{messages.push(JSON.parse(frame.payload).t)}catch{}})});
 await page.addInitScript(night=>localStorage.setItem('pb_theme',night?'night':'day'),night);
 if(before)await page.route('**/js/app.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:originalApp}));
 await page.goto(`http://127.0.0.1:${port}/`);
 await page.waitForFunction(()=>document.getElementById('shelfCount')?.textContent.includes('47'));
 const label=`${before?'before':'after'}-${viewport.width}x${viewport.height}-${night?'night':'day'}`;
 try{
  assert.equal(await page.locator('.pick-grid .pick').count(),4);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'homepage fits viewport');
  // Capture the settled surface,not an in-flight app entrance. Infinite
  // decorative loops are deliberately excluded from this bounded wait.
  await page.evaluate(async()=>{
   await document.fonts.ready;
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));
  });
  assert.equal(await page.locator('#app').evaluate(element=>Number(getComputedStyle(element).opacity)),1,'surface is fully revealed');
  await page.screenshot({path:path.join(artifacts,label+'-home.png')});
  await page.screenshot({path:path.join(artifacts,label+'-full.png'),fullPage:true});
  if(!before){
   assert.equal(await page.locator('.hero-art').count(),0,'decorative collage is removed');
   assert.equal(await page.locator('.home-welcome #bCreate').textContent(),'Create room');
   assert.equal(await page.locator('.home-welcome #bJoin').textContent(),'Join room');
   for(const id of ['nm','jc','bCreate','bJoin'])assert(await page.locator('#'+id).evaluate(e=>e.getBoundingClientRect().height>=44),id+' is a usable target');
   assert(await page.locator('.home-picks .gart').evaluateAll(elements=>elements.every(e=>Math.abs(e.getBoundingClientRect().width-e.getBoundingClientRect().height)<1)),'all picks use the same square image frame');
   const headerBefore=await page.locator('.topbar').boundingBox();
   await page.locator('#nm').fill('Fixture Host');await page.locator('#jc').fill('ABCD');
   await page.locator('#hq').fill('Chess');
   await page.waitForFunction(()=>document.querySelectorAll('#shelfGames [data-how]').length===1);
   assert.equal(await page.locator('#shelfGames [data-how]').getAttribute('data-how'),'chess');
   assert.equal(await page.locator('#nm').inputValue(),'Fixture Host');assert.equal(await page.locator('#jc').inputValue(),'ABCD');
   // A real home rerender (theme toggle) must retain name and join drafts.
   await page.locator('#bTheme').click();await page.locator('#bTheme').click();
   assert.equal(await page.locator('#nm').inputValue(),'Fixture Host');assert.equal(await page.locator('#jc').inputValue(),'ABCD');
   assert.deepEqual(await page.locator('.topbar').boundingBox(),headerBefore,'hero changes do not alter header geometry');
   await page.locator('#hq').fill('');
   if(viewport.width===1280&&!night){
    await page.locator('#bCreate').click();
    await page.waitForFunction(()=>/^\/r\/[A-Z0-9]{4}$/.test(location.pathname));
    // The room celebration stays inside the room card, behind its content.
    await page.locator('.partystrip').waitFor();
    assert.deepEqual(await page.evaluate(()=>{const strip=document.querySelector('.partystrip'),layer=strip.querySelector(':scope > .confetti');
     return {pageLayer:document.querySelectorAll('body > .confetti').length,inStrip:!!layer,clips:layer&&getComputedStyle(strip).overflow==='hidden',behind:layer&&Number(getComputedStyle(layer).zIndex)<Number(getComputedStyle(strip.querySelector('.ps-invite')).zIndex),inert:layer&&getComputedStyle(layer).pointerEvents==='none'}}),
     {pageLayer:0,inStrip:true,clips:true,behind:true,inert:true},'confetti is a clipped background layer of the room card');
    const code=new URL(page.url()).pathname.split('/').pop();
    const peer=await browser.newContext({viewport,permissions:[]});const guest=await peer.newPage();const peerMessages=[];
    guest.on('websocket',socket=>socket.on('framesent',frame=>{try{peerMessages.push(JSON.parse(frame.payload).t)}catch{}}));
    try{
     await guest.goto(`http://127.0.0.1:${port}/`);await guest.locator('#nm').waitFor();
     await guest.locator('#nm').fill('Fixture Guest');await guest.locator('#jc').fill(code);await guest.locator('#bJoin').click();
     await page.waitForFunction(()=>document.body.textContent.includes('For your group of 2'));
     await guest.waitForFunction(()=>document.body.textContent.includes('For your group of 2'));
     assert.equal(messages.filter(t=>t==='create').length,1);assert.equal(peerMessages.filter(t=>t==='join').length,1);
    }finally{await peer.close()}
   }else assert.equal(messages.some(t=>t==='create'||t==='join'),false,'visual/filter checks do not create rooms');
  }
  assert.deepEqual(errors,[]);results.push({label,passed:true,before,viewport,night,errors,createCount:messages.filter(t=>t==='create').length});console.log(label+' PASS');
 }catch(e){await page.screenshot({path:path.join(artifacts,'FAILED-'+label+'.png')}).catch(()=>{});results.push({label,passed:false,error:e.stack,errors});throw e}
 finally{await context.close()}
}
(async()=>{
 const net=require('node:net'),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));port=probe.address().port;await new Promise(r=>probe.close(r));output='';
 server=spawn(process.execPath,['server/server.js'],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:os.tmpdir(),NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),GAME_REPORT_DB:path.join(scratch,'reports.sqlite')},stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
 for(let n=0;n<200&&!output.includes('PartyBox on');n++){if(server.exitCode!==null)throw Error('local home fixture exited');await sleep(50)}assert(output.includes('PartyBox on'));
 browser=await chromium.launch({headless:true});
 await visit({width:1280,height:800},true,true);
 await visit({width:375,height:667},true,true);
 for(const [viewport,night]of [[{width:1280,height:800},false],[{width:1280,height:800},true],[{width:375,height:667},true],[{width:320,height:568},false]])await visit(viewport,night);
 console.log('HOME_POLISH_BROWSER_PASS:2 Night baselines,4 after cases,drafts,search,header,pick framing,actual create/join');
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),sleep(3000)])}fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify({at:new Date().toISOString(),results,realMedia:false,production:false},null,2)+'\n')});
