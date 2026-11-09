'use strict';
// Natural practice dice and ordinary player buttons. This uses an existing
// local server and never changes authority, dice or positions.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BOARD_MOTION_BASE||'http://127.0.0.1:8240';
const out=path.resolve(__dirname,'../../../artifacts/board-motion');
fs.mkdirSync(out,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const report=[];
async function geometry(frame){return frame.evaluate(()=>{
 const rects={};for(const selector of ['.bk-players','.bk-status','[data-roll]']){const r=document.querySelector(selector).getBoundingClientRect();rects[selector]={x:r.x,y:r.y,w:r.width,h:r.height};}
 return {rects,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
});}
async function checkOtherDice(browser,id,width,reduced=false){
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:reduced?'reduce':'no-preference'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/practice/?game=${id}`);await page.waitForFunction(()=>!document.getElementById('practiceStart').disabled);
 await page.locator('#practiceCount').selectOption('2');await page.locator('#practiceStart').click();
 await page.waitForFunction(()=>document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'));
 const frames=[1,2].map(n=>page.frames().find(f=>new URL(f.url()).searchParams.get('seat')===String(n)));
 await frames[0].locator('#howtoGo').click();
 const key=id==='ludo'?'_ludo':'_b5';
 for(const f of frames){await f.locator('.bk-game').waitFor();await f.evaluate(key=>{let e=document.querySelector('.bk-game');while(e&&!e[key])e=e.parentElement;window.__boardEl=e;window.__boardKey=key;},key);await f.waitForFunction(()=>!window.__boardEl[window.__boardKey].S.preparing);}
 const get=f=>f.evaluate(()=>window.__boardEl[window.__boardKey].S);
 const finish=async()=>{for(const f of frames)await f.evaluate(()=>window.__boardEl[window.__boardKey].motion.stop(true));};
 let seenDie=false,seenHop=false,actions=0;
 while(actions++<100){
  await finish();let S=await get(frames[0]);if(S.phase==='done')break;
  const actor=frames[S.turn];await page.locator(`#practiceTab${S.turn+1}`).click();
  await actor.waitForFunction(()=>!window.__boardEl[window.__boardKey].S.preparing);
  S=await get(actor);
  const isMove=id==='ludo'&&S.phase==='move',selector=isMove?`[data-choice="${S.legal[0]}"]`:'[data-roll]';
  const before=await geometry(actor);await actor.locator(selector).click();
  await actor.waitForFunction(rev=>window.__boardEl[window.__boardKey].S.rev>rev&&!window.__boardEl[window.__boardKey].S.preparing,S.rev);
  const next=await get(actor),m=next.lastMove;
  const suffix=reduced?'reduced':'day';
  if(!isMove&&!seenDie){await wait(reduced?150:180);await page.screenshot({path:path.join(out,`${id}-${width}-${suffix}-dice.png`)});seenDie=true;}
  if(isMove&&m.from>=0&&!seenHop){await wait(reduced?150:190);await page.screenshot({path:path.join(out,`${id}-${width}-${suffix}-hop.png`)});seenHop=true;}
  await finish();const after=await geometry(actor);assert.deepEqual(before.rects,after.rects);assert(after.scrollWidth<=after.width+1&&after.scrollHeight<=after.height+1,`${id}: fits viewport`);
  if(!isMove)assert.equal(await actor.locator(`[data-face="${next.die||m.die}"]`).getAttribute('opacity'),'1');
  if(id!=='ludo'||seenHop)break;
 }
 assert(seenDie);if(id==='ludo')assert(seenHop);assert.deepEqual(errors,[]);
 await frames[0].evaluate(()=>document.documentElement.dataset.theme='night');await page.locator('#practiceTab1').click();
 await page.screenshot({path:path.join(out,`${id}-${width}-${reduced?'reduced-':''}night.png`)});
 report.push({id,width,reduced,actions,errors,seenDie,seenHop});await page.locator('#practiceStop').click();await context.close();
}
async function main(){
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{channel:'chromium'})});
try{
 for(const width of process.env.BOARD_MOTION_EXTRA_ONLY?[]:[1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/practice/?game=snakes-ladders`);
  await page.waitForFunction(()=>!document.getElementById('practiceStart').disabled);
  await page.locator('#practiceCount').selectOption('2');await page.locator('#practiceStart').click();
  await page.waitForFunction(()=>document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'));
  const frames=[1,2].map(n=>page.frames().find(f=>new URL(f.url()).searchParams.get('seat')===String(n)));
  await frames[0].locator('#howtoGo').click();
  for(const f of frames){await f.locator('.b5-game').waitFor();await f.evaluate(()=>{let e=document.querySelector('.b5-game');while(e&&!e._b5)e=e.parentElement;window.__boardEl=e;});await f.waitForFunction(()=>!window.__boardEl._b5.S.preparing);}
  const seen=new Set();let rolls=0;
  while(rolls++<220){
   let S=await frames[0].evaluate(()=>window.__boardEl._b5.S);
   if(S.phase==='done'){
    if(['dice','hop','ladder','snake','finish'].every(k=>seen.has(k)))break;
    const instance=S.instanceId;await page.locator('#practiceTab1').click();await frames[0].locator('[data-rematch]').click();
    for(const f of frames)await f.waitForFunction(instance=>window.__boardEl._b5.S.instanceId!==instance&&!window.__boardEl._b5.S.preparing,instance);
    continue;
   }
   const actor=frames[S.turn];await page.locator(`#practiceTab${S.turn+1}`).click();
   await actor.waitForFunction(()=>!window.__boardEl._b5.S.preparing);
   // End only old presentation so a full natural game remains quick.
   for(const f of frames)await f.evaluate(()=>window.__boardEl._b5.motion.stop(true));
   await actor.locator('[data-roll]').click();
   await actor.waitForFunction(rev=>window.__boardEl._b5.S.rev>rev&&!window.__boardEl._b5.S.preparing,S.rev);
   const start=Date.now();S=await actor.evaluate(()=>window.__boardEl._b5.S);
   const m=S.lastMove,type=m.to>m.landing?'ladder':m.to<m.landing?'snake':m.to===100?'finish':'hop';
   const before=await geometry(actor),shots=[];
   if(!seen.has('dice')){await wait(100);const p=path.join(out,`snakes-${width}-dice.png`);await page.screenshot({path:p});shots.push(p);seen.add('dice');}
   if(!seen.has(type)){
    const times=type==='hop'?[540,640,800]:type==='finish'?[900,1100]:[500+m.die*130+220,500+m.die*130+450,500+m.die*130+650];
    for(let i=0;i<times.length;i++){await wait(Math.max(0,times[i]-(Date.now()-start)));const p=path.join(out,`snakes-${width}-${type}-${i+1}.png`);await page.screenshot({path:p});shots.push(p);}
    seen.add(type);
   }
   for(const f of frames)await f.evaluate(()=>window.__boardEl._b5.motion.stop(true));
   const after=await geometry(actor);
   assert.deepEqual(before.rects,after.rects,'roster, status and Roll keep their size/position');
   assert(after.scrollWidth<=after.width+1,'no horizontal overflow');assert(after.scrollHeight<=after.height+1,'no page scroll');
   const placed=await actor.evaluate(()=>{const c=window.__boardEl._b5;return [...document.querySelectorAll('[data-sl-pawn]')].map(n=>({square:Number(n.dataset.square),transform:n.querySelector('.sl-pawn-motion').getAttribute('transform'),expected:c.S.positions[c.S.seats[Number(n.dataset.slPawn)]]}));});
   for(const p of placed){assert.equal(p.square,p.expected);assert(!p.transform||p.transform==='translate(0 0) scale(1 1)');}
   if(shots.length)report.push({width,roll:rolls,move:m,type,shots});
   if(seen.has('snake')&&seen.has('ladder')&&seen.has('hop')&&seen.has('finish'))break;
  }
  for(const kind of ['dice','hop','ladder','snake'])assert(seen.has(kind),`${width}: naturally exercised ${kind}`);
  await frames[0].evaluate(()=>document.documentElement.dataset.theme='night');
  await page.locator('#practiceTab1').click();await page.screenshot({path:path.join(out,`snakes-${width}-night.png`)});
  assert.deepEqual(errors,[]);report.push({width,rolls,seen:[...seen],errors});
  fs.writeFileSync(path.join(out,'practice-report.json'),JSON.stringify(report,null,2));
  await page.locator('#practiceStop').click();await context.close();
 }
 for(const width of [1440,390])for(const id of ['ludo','pig-dice'])await checkOtherDice(browser,id,width);
 await checkOtherDice(browser,'ludo',390,true);await checkOtherDice(browser,'pig-dice',390,true);await checkOtherDice(browser,'snakes-ladders',390,true);
 fs.writeFileSync(path.join(out,process.env.BOARD_MOTION_EXTRA_ONLY?'extra-report.json':'practice-report.json'),JSON.stringify(report,null,2));fs.rmSync(path.join(out,'failure.txt'),{force:true});console.log('BOARD_MOTION_BROWSER_PASS: '+out);
}finally{await browser.close();}
}
main().catch(e=>{fs.writeFileSync(path.join(out,'failure.txt'),e.stack);console.error(e);process.exitCode=1;});
