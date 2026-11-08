'use strict';
// Focused checks for concrete screenshot reports, using shipped views and
// engine projections. The shared fixture supplies production shell styles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ids=['chess','countdown-word','dare-roulette','draw-phone','four-in-a-row','number-hunt','truth-dare','twenty-questions','typing-race','warm-words','trivia','rank-it','five-second','reversi'];
async function run(){
 const {chromium}=require('playwright'),out=process.env.QA151_SHOTS||'/tmp/codex-qa151-after';
 fs.mkdirSync(out,{recursive:true});let browser,server;const report=[];
 try{
  let base=process.env.QA151_URL;
  if(!base){server=require('./visual-qa-browser.cjs').createFixture();await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
  const cases=await(await fetch(base+'/cases')).json();browser=await chromium.launch({headless:true,channel:'chromium'});
  for(const width of [1280,390])for(const theme of ['day','night'])for(const id of ids){
   if(process.env.QA151_GAMES&&!process.env.QA151_GAMES.split(',').includes(id))continue;
   const height=width===390?844:800,context=await browser.newContext({viewport:{width,height},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));const d=cases.find(c=>c.id===id);assert(d,id+' fixture');
   await page.goto(base);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.evaluate(d=>window.loadCase(d),d);
   const frame=predicate=>d.frames.find(f=>predicate(f.state))?.state;
   const apply=async S=>{assert(S,id+' state');await page.evaluate(S=>window.applyFrame(S),S);await page.waitForTimeout(150);};
   const shot=label=>page.screenshot({path:path.join(out,`${width}-${theme}-${id}-${label}.png`),fullPage:label!=='scrolled'});
   const metrics={width,height,theme,id};
   if(id==='chess'){
    metrics.coordinates=await page.locator('.ch-file,.ch-rank').evaluateAll(nodes=>nodes.map(n=>{const a=n.getBoundingClientRect(),b=n.closest('.sq').getBoundingClientRect();let clipped=false;for(let p=n.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),r=p.getBoundingClientRect();if((c.overflowX!=='visible'&&(a.left<r.left-.5||a.right>r.right+.5))||(c.overflowY!=='visible'&&(a.top<r.top-.5||a.bottom>r.bottom+.5)))clipped=true;}return{outside:a.right<=b.left+.5||a.left>=b.right-.5||a.bottom<=b.top+.5||a.top>=b.bottom-.5,clipped};}));
    assert.equal(metrics.coordinates.length,16);assert(metrics.coordinates.every(c=>c.outside&&!c.clipped),'chess coordinates stay outside piece squares');
   }
   if(id==='countdown-word'){
    const S=frame(s=>s.phase==='make');await apply({...S,myFeedback:{ok:false,message:'Not on the tray: Z.'}});
    assert.match(await page.locator('#cwFeedback').textContent(),/Z/);
    await page.locator('#cwWord').fill('LEMON');assert.equal(await page.locator('#cwFeedback').textContent(),'');
    await apply({...S,myFeedback:{ok:false,message:'Not on the tray: Z.'}});
    assert.equal(await page.locator('#cwFeedback').textContent(),'','old feedback stays dismissed on heartbeat');
    await page.locator('#cwSave').click();await apply({...S,myFeedback:{ok:false,message:'Not on the tray: M, N.'}});
    assert.match(await page.locator('#cwFeedback').textContent(),/M, N/);
    await page.locator('#cwBack').click();assert.equal(await page.locator('#cwFeedback').textContent(),'');
   }
   if(id==='draw-phone'){
    await apply(frame(s=>s.phase==='draw'));metrics.header=await page.locator('.dp-identity,.sk-steps').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,display:getComputedStyle(n).display,width:n.clientWidth,needed:n.scrollWidth})));
    if(width===1280)assert(metrics.header.every(n=>n.width>=n.needed),'Draw Phone title and every step fit');
   }
   if(id==='four-in-a-row'){
    await apply(frame(s=>s.board.some(Boolean)));await page.waitForTimeout(700);
    const count=await page.locator('.fr-counter').count();assert(count>0,'played counters are mounted');
    assert(await page.locator('.fr-counter').first().evaluate(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(n).opacity!=='0';}),'counter is visible after its fall');metrics.counters=count;
   }
   if(id==='number-hunt'){
    const S=frame(s=>s.phase==='hunt');await apply({...S,history:[51,62,62,63,61,64].map(guess=>({guess,pid:S.me,dir:'higher',result:'hotter'}))});
    metrics.pins=await page.locator('.nh-pin').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    for(let i=0;i<metrics.pins.length;i++)for(let j=i+1;j<metrics.pins.length;j++)assert(Math.abs(metrics.pins[i].x-metrics.pins[j].x)>=24,'nearby ruler pins do not cover each other');
    assert(await page.locator('#nWin').evaluate(n=>{const a=n.getBoundingClientRect(),b=n.parentElement.getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom&&getComputedStyle(n.parentElement).overflow==='hidden';}),'range cannot protrude outside the ruler');
    const before=await page.locator('.nh-range,#nForm,.pl-live').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    await page.evaluate(()=>window.notify('Room not found. Check the code.'));
    assert(await page.locator('#toast').isHidden());assert.match(await page.locator('#playNotice').textContent(),/Room not found/);
    assert.deepEqual(await page.locator('.nh-range,#nForm,.pl-live').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON())),before,'notifications never move the game');
   }
   if(id==='truth-dare'){
    const S=frame(s=>s.phase==='spin');await apply(S);assert.equal(await page.locator('#tSpin').textContent(),'Spinning…');
    await page.waitForTimeout(3100);const name=S.players.find(p=>p.id===S.target).name;assert.equal(await page.locator('#tSpin').textContent(),name);
    metrics.wheel=await page.locator('.td-wheel').evaluate(n=>{const m=new DOMMatrixReadOnly(getComputedStyle(n).transform);return{angle:Math.atan2(m.b,m.a)*180/Math.PI,land:parseFloat(n.style.getPropertyValue('--td-land'))};});
    assert(Math.abs(((metrics.wheel.angle-metrics.wheel.land+180)%360+360)%360-180)<.2,'settled pointer agrees with the server target');
    const choose=frame(s=>s.phase==='choose'&&s.round===S.round);assert.equal(choose.target,S.target,'spin and choose keep one target');
    await shot('settled');await page.emulateMedia({reducedMotion:'reduce'});await apply({...S,round:S.round+100});assert.equal(await page.locator('#tSpin').textContent(),name,'reduced motion settles immediately');
   }
   if(['dare-roulette','twenty-questions'].includes(id)){
    await apply(frame(s=>id==='dare-roulette'?s.phase==='reveal':s.phase==='play'&&s.me!==s.answerer));
    if(id==='dare-roulette'){
     if(width===1280)await page.setViewportSize({width,height:732});
     await page.evaluate(()=>window.readyToast(true));
     assert(await page.locator('#gamePreparation').evaluate(n=>n.closest('#playNotice')!==null&&getComputedStyle(n).position==='static'&&getComputedStyle(n).borderTopWidth==='0px'),'ready message uses the header');
     assert(await page.locator('#drNext').evaluate(n=>{const r=n.getBoundingClientRect(),head=document.querySelector('.play-toolbar').getBoundingClientRect();return r.top>=head.bottom&&r.bottom<=innerHeight;}),'Next remains completely inside the viewport');
    }
    await page.evaluate(()=>scrollTo(0,300));await page.waitForTimeout(100);
    assert(await page.locator('.play-toolbar').evaluate(n=>{const a=n.getBoundingClientRect();return a.top>=-.5&&a.bottom>44;}),'scrolling keeps the title and utility row together');
    assert(await page.locator('.room-menu>summary,.game-report-icon').evaluateAll(nodes=>{const r=document.querySelector('.play-toolbar').getBoundingClientRect();return nodes.every(n=>{const a=n.getBoundingClientRect();return a.top>=r.top&&a.bottom<=r.bottom;});}),'room and report controls stay inside the header');
    if(id==='twenty-questions'){await page.locator('#tQ').fill('Is it alive?');await page.locator('#tQ').focus();assert(await page.locator('#tQSend').evaluate(n=>n.getBoundingClientRect().top>=document.querySelector('.play-toolbar').getBoundingClientRect().bottom),'Ask stays clear of the toolbar after focus');}await shot('scrolled');await page.evaluate(()=>scrollTo(0,0));
   }
   if(id==='typing-race'){
    const S=frame(s=>s.phase==='race');await apply(S);assert.equal(await page.locator('.tr-target').textContent(),S.target,'the prompt has no inserted caret glyphs');
   }
   if(id==='warm-words'){
    await apply(frame(s=>!!s.best));metrics.thermometer=await page.locator('.ww-bulb').evaluate(n=>({position:getComputedStyle(n).position,left:getComputedStyle(n).left}));
    assert.equal(await page.locator('.ww-fill').evaluate(n=>getComputedStyle(n,'::after').content),'none','the fixed bulb is the thermometer base, not a thumb');
   }
   if(['trivia','rank-it','five-second'].includes(id)){
    if(id==='five-second')await apply(frame(s=>s.phase==='done'));
    const selectors=id==='trivia'?'.gk-choice:nth-child(3),.gk-choice:nth-child(3) .gk-mark':id==='rank-it'?'.gk-hud-timer':'.gk-rank-row.is-top .gk-rank';
    metrics.contrast=await page.locator(selectors).evaluateAll(nodes=>{
     const rgb=s=>{const n=s.match(/[\d.]+/g).map(Number);return n.slice(0,3).map(v=>s.startsWith('color(srgb')?v*255:v);};
     const lum=a=>a.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
     return nodes.map(n=>{const c=getComputedStyle(n);let p=n,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;p=p.parentElement;}const a=lum(rgb(c.color)),b=lum(rgb(bg));return{text:n.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
    });
    assert(metrics.contrast.length,'contrast target is rendered');assert(metrics.contrast.every(c=>c.ratio>=4.5),JSON.stringify(metrics.contrast));
   }
   if(id==='reversi')metrics.turnRim=await page.locator('.bk-player.is-turn').evaluate(n=>getComputedStyle(n).borderColor);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),id+' has no horizontal page overflow');
   await shot('checked');assert.deepEqual(errors,[]);report.push(metrics);console.log('PRODUCTION_QA_CASE',width,theme,id);await context.close();
  }
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({pass:true,cases:report},null,2));console.log('PRODUCTION_QA_BROWSER_PASS',report.length);
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
