'use strict';
// Production views + legal engine moves, in Chromium. Optional visual/geometry
// check; screenshots include all shared-panel games, both themes and sizes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createFixture}=require('./layout-stability-browser.cjs');
const games=['ludo','four-in-a-row','reversi','chess','fleet-duel','checkers','kalah'];
function panelCases(){
 const out=[];
 for(const id of games)for(const count of id==='ludo'?[2,4]:[2]){
  const players=['a','b','c','d'].slice(0,count).map((id,i)=>({id,name:['Alexandria','Morgan','Charlotte','Dev'][i]}));
  const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({}),content:()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../locales/en/'+id+'.json'))),now:()=>1000,award(){},broadcast(){},later(){return()=>{}}};
  const def=require('../games/'+id+'/server'),state=def.create(ctx),frames=[];
  const capture=()=>frames.push(JSON.parse(JSON.stringify({...def.view(state,'a'),players,me:'a',instanceId:'panel-'+id,serverNow:1000})));
  const act=(pid,a)=>{def.onAction(state,ctx,pid,{...a,rev:def.view(state,pid).actionRev??state.rev,revision:state.revision});capture()};capture();
  if(id==='fleet-duel')for(const pid of ['a','b']){act(pid,{auto:true});act(pid,{ready:true})}
  for(let n=0;n<6;n++){
   const pid=id==='chess'?(state.turn==='w'?state.white:state.black):state.seats[['four-in-a-row','reversi'].includes(id)?state.turn-1:state.turn];
   const S=def.view(state,pid);
   if(id==='ludo')act(pid,S.phase==='roll'?{roll:true}:{move:S.legal[0]});
   if(id==='four-in-a-row')act(pid,{drop:n%2?6:n/2});
   if(id==='reversi')act(pid,{place:S.legal[0]});
   if(id==='fleet-duel')act(pid,{fire:n});
   if(id==='chess'){const [from,moves]=Object.entries(S.legal)[0];act(pid,{move:{from,to:moves[0].to}})}
   if(id==='checkers'){const [from,moves]=Object.entries(S.legal)[0];act(pid,{from:Number(from),to:moves[0].to})}
   if(id==='kalah')act(pid,{pit:S.legal[0]});
  }
  out.push({id,count,frames});
 }
 return out;
}
async function run(){
 const {chromium}=require('playwright'),out=process.env.BOARD_PANEL_SHOTS||'/tmp/codex-board-panel-after',baseline=process.env.BOARD_PANEL_BASELINE==='1';fs.mkdirSync(out,{recursive:true});
 let server,browser;const report={pass:false,cases:[]};
 try{
  let url=process.env.BOARD_PANEL_URL;if(!url){server=createFixture(panelCases());await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port}
  const cases=await(await fetch(url+'/cases')).json();browser=await chromium.launch({headless:true,channel:'chromium'});
  for(const width of [1280,390])for(const theme of ['day','night']){
   const context=await browser.newContext({viewport:{width,height:width===390?844:800},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   for(const data of cases){
    if(process.env.BOARD_PANEL_GAME&&process.env.BOARD_PANEL_GAME!==data.id)continue;
    await page.evaluate(d=>window.loadCase(d),data);await page.waitForTimeout(850);
    const boxes=()=>page.evaluate(()=>['.bk-stage','.bk-players','.bk-status',...Array.from({length:document.querySelectorAll('.bk-player').length},(_,i)=>'.bk-player:nth-child('+(i+1)+')')].map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return[r.x,r.y,r.width,r.height]}));
    const before=await boxes();let largestShift=0;const states=[];
    for(let i=0;i<data.frames.length;i++){
     await page.evaluate(S=>window.applyFrame(S),data.frames[i]);await page.waitForTimeout(850);
     const after=await boxes();largestShift=Math.max(largestShift,...after.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-before[i][j]))));
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),data.id+' fits horizontally');
     if(!baseline){
      const checks=await page.evaluate(()=>{
       const rows=[...document.querySelectorAll('.bk-player')];
       const alignment=rows.map(row=>{const rects=['.bk-chip','.bk-who','.bk-stat'].map(s=>row.querySelector(s).getBoundingClientRect());return Math.max(...rects.map(r=>r.y+r.height/2))-Math.min(...rects.map(r=>r.y+r.height/2))});
       const turn=rows.find(n=>n.classList.contains('is-turn')),status=document.querySelector('.bk-status');
       return{alignment,overflow:rows.some(n=>n.scrollWidth>n.clientWidth),statusOverflow:status.scrollHeight-status.clientHeight,statusDot:!!status.querySelector('.bk-status-dot'),color:turn?getComputedStyle(turn).borderTopColor:null,expected:turn?getComputedStyle(turn.querySelector('.bk-turn-text'),'::before').backgroundColor:null,heights:rows.map(n=>n.getBoundingClientRect().height)};
      });
      assert(checks.alignment.every(n=>n<1),data.id+' token/name/score centers align');assert(!checks.overflow,data.id+' cards fit');assert(checks.statusDot,data.id+' status keeps a color dot');assert(checks.statusOverflow<=1,data.id+' status fits its fixed height');if(checks.color)assert.equal(checks.color,checks.expected,data.id+' rim uses its player color');assert(checks.heights.every(h=>h===64),data.id+' fixed 64px cards');
     }
     if(i===0||i===data.frames.length-1){const name=`${width}-${theme}-${data.id}-${data.count}-${i===0?'start':'turn'}.png`;await page.screenshot({path:path.join(out,name),fullPage:true});states.push(name)}
    }
    if(!baseline&&data.id==='chess'){
     await page.evaluate(S=>window.applyFrame({...S,clocks:{w:600000,b:600000},timeControl:'10 min'}),data.frames.at(-1));
     const clocks=await page.locator('.has-clock .bk-stat').evaluateAll(nodes=>nodes.map(n=>({pill:n.clientWidth,value:n.querySelector('.bk-stat-value').getBoundingClientRect().width})));
     assert.equal(clocks.length,2,'both chess clocks keep their ids and slots');assert(clocks.every(n=>n.value<=n.pill),'five-character clocks fit the score pills');
     const clockName=`${width}-${theme}-chess-2-clock.png`;await page.screenshot({path:path.join(out,clockName),fullPage:true});states.push(clockName);
    }
    assert(largestShift<1,data.id+' panel/board stay fixed across moves');report.cases.push({width,theme,id:data.id,count:data.count,largestShift,screenshots:states});console.log('BOARD_PANEL_CASE',width,theme,data.id,data.count,largestShift);
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  report.pass=true;console.log('BOARD_PANEL_BROWSER_PASS',report.cases.length);
 }finally{fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));await browser?.close();if(server)await new Promise(r=>server.close(r))}
}
module.exports={panelCases};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
