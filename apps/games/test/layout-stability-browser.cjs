'use strict';
// Optional Chromium geometry regression. Uses production views and real engine
// projections, including legal board moves/results. No physical-device claim.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
function cases(){
 const party=require('./party-scenes-browser').FIXTURES,skill=require('./skill-scenes-hud-fixtures').fixtures;
 const ids=['compliment-battle','dare-roulette','roast-toast','story-builder','five-second','bluff','truth-dare','would-you-rather','rank-it'];
 const out=ids.map(id=>({id,frames:party.find(f=>f.id===id).frames.filter(f=>f.views[0].phase!=='done').map(f=>f.views[0])}));
 out.find(f=>f.id==='truth-dare').frames.push(...require('./truth-dare-modes').browserFrames());
 for(const id of ['reaction-tap','memory-tray','twenty-questions'])out.push({id,frames:skill[id].map(f=>({...f.state,instanceId:'layout-'+id})).filter(s=>s.phase!=='done')});
 const ps=['a','b','c','d'].map((id,i)=>({id,name:['Alexandria','Morgan','Charlotte','Dev'][i]}));
 for(const id of ['four-in-a-row','reversi','ludo','fleet-duel']) {
  const def=require('../games/'+id+'/server'),players=ps.slice(0,id==='ludo'?4:2),ctx={allPlayers:()=>players,players:()=>players,settings:()=>({}),now:()=>1000,award(){},broadcast(){},later(){return()=>{};}};
  const state=def.create(ctx),frames=[],capture=()=>frames.push(JSON.parse(JSON.stringify({...def.view(state,'a'),players,me:'a',instanceId:'layout-'+id,serverNow:1000})));
  const act=(pid,a)=>{def.onAction(state,ctx,pid,{...a,rev:state.rev});capture();};capture();
  if(id==='four-in-a-row')for(const drop of [0,6,1,6,2,5,3])act(state.seats[state.turn-1],{drop});
  if(id==='reversi'){for(let n=0;n<10;n++){const pid=state.seats[state.turn-1];act(pid,{place:def.view(state,pid).legal[0]});}act('a',{resign:true});}
  if(id==='ludo'){for(let n=0;n<20&&state.phase!=='done';n++){const pid=state.seats[state.turn],S=def.view(state,pid);act(pid,S.phase==='roll'?{roll:true}:{move:S.legal[0]});}for(const pid of players.slice(1).map(p=>p.id))act(pid,{resign:true});}
  if(id==='fleet-duel'){for(const pid of ['a','b']){act(pid,{auto:true});act(pid,{ready:true});}for(let n=0;n<6;n++)act(state.seats[state.turn],{fire:n});act('a',{resign:true});}
  out.push({id,frames});
 }
 // Keep each viewer/round fixed: these are live updates, not screen changes.
 const hunt=skill['number-hunt'].filter(f=>!f.state.spectator&&['hunt','overtime'].includes(f.state.phase)).map(f=>f.state);
 const hot=party.find(f=>f.id==='hot-takes').frames.filter(f=>f.views[0].phase==='submit'&&f.views[0].round===1).map(f=>f.views[0]);
 out.push({id:'number-hunt',frames:hunt},{id:'hot-takes',frames:[...hot,{...hot.at(-1),myTake:'A long take can still be edited without moving the composer. '.repeat(2).slice(0,140)}]});
 const emoji=party.find(f=>f.id==='emoji-story').frames.find(f=>f.views[0].phase==='emoji').views.find(S=>S.me===S.director);
 out.push({id:'emoji-story',frames:[emoji,{...emoji,heartbeat:true}]});
 const guess=party.find(f=>f.id==='emoji-story').frames.find(f=>f.views[0].phase==='guess').views.find(S=>!S.spectator&&S.me!==S.director&&!S.mySolved);
 out.push({id:'emoji-story',kind:'guess-feedback',frames:[guess,{...guess,heartbeat:true}]});
 return out;
}
const PAGE=`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/skins.css"><link rel="stylesheet" href="/css/game-ui.css"><style>body{margin:0}#gbody{width:100%;max-width:960px;margin:auto;padding:12px}body.game-immersive #gbody{max-width:none;padding:0}</style><body class="game-playing"><main id="gbody"></main><script type="module">
let view,S;const el=document.querySelector('#gbody');const api={send:()=>false,now:()=>S?.serverNow||1000,context:()=>({isHost:true}),announce(){},cue(){},focus:n=>n?.focus({preventScroll:true}),resultsReady(){}};
window.loadCase=async data=>{view?.dispose?.(el);el.innerHTML='';document.body.dataset.game=data.id;document.body.classList.toggle('game-immersive',['four-in-a-row','reversi','ludo','fleet-duel','chess','checkers','kalah'].includes(data.id));el.dataset.layout=document.body.classList.contains('game-immersive')?'immersive':'standard';view=(await import('/js/games/'+data.id+'.js')).default;view.mount?.(el,api);window.applyFrame=state=>{S=state;(view.update||view.render).call(view,el,state,api);};window.applyFrame(data.frames[0]);await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.sheet?Promise.resolve():new Promise(r=>{l.onload=r;l.onerror=r;})));await document.fonts.ready;};
</script></body></html>`;
function createFixture(data=cases()){return http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/cases'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));}if(u.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(PAGE);}const file=path.resolve(root,'public','.'+decodeURIComponent(u.pathname));if(!file.startsWith(path.join(root,'public')+path.sep)){res.statusCode=403;return res.end();}fs.readFile(file,(e,b)=>{if(e){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(b);});});}
async function run(){const {chromium}=require('playwright'),out=process.env.STABILITY_EVIDENCE_DIR||'/tmp/codex-sweep-shots';fs.mkdirSync(out,{recursive:true});let server,browser;const report={pass:false,cases:[]};
 try{let url=process.env.STABILITY_TEST_URL;if(!url){server=createFixture();await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;}const data=await(await fetch(url+'/cases')).json();browser=await chromium.launch({headless:true,channel:'chromium'});
 for(const width of [1280,390])for(const theme of ['day','night']) {
  const context=await browser.newContext({viewport:{width,height:width===390?844:800},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const dataCase of data){if(process.env.STABILITY_GAME&&!process.env.STABILITY_GAME.split(',').includes(dataCase.id))continue;await page.evaluate(data=>window.loadCase(data),dataCase);await page.evaluate(()=>new Promise(requestAnimationFrame));const seen=new Map(),moves=[];
   await page.evaluate(id=>{
    window.motionCheck={boardMoves:[],padShifts:[],gameShifts:[]};const seen=new Map();let stopped=false;
    const observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){if(['number-hunt','hot-takes','emoji-story'].includes(id)&&!e.hadRecentInput&&e.value>0.00001)window.motionCheck.gameShifts.push({value:e.value,sources:e.sources.filter(s=>s.node?.isConnected!==false).map(s=>s.node?.id||s.node?.nodeName)});const sources=e.sources.filter(s=>{const n=s.node;return n?.isConnected!==false&&(n?.id==='rPad'||n?.parentElement?.closest?.('#rPad')||n?.closest?.('#rPad'));});if(sources.length)window.motionCheck.padShifts.push({value:e.value,sources:sources.map(s=>({node:s.node?.nodeName,before:s.previousRect.toJSON(),after:s.currentRect.toJSON()}))});}});observer.observe({type:'layout-shift'});
    const tick=()=>{if(stopped)return;if(id==='ludo')for(const sel of ['.ld-stage','.ld-board']){const n=document.querySelector(sel);if(!n)continue;const r=n.getBoundingClientRect(),rect=[r.x,r.y,r.width,r.height],old=seen.get(sel);if(old&&Math.max(...rect.map((v,i)=>Math.abs(v-old[i])))>1)window.motionCheck.boardMoves.push({sel,before:old,after:rect});seen.set(sel,rect);}requestAnimationFrame(tick);};tick();window.stopMotionCheck=()=>{stopped=true;observer.disconnect();return window.motionCheck;};
   },dataCase.id);
   const selectors=dataCase.id==='number-hunt'?['.nh-range','#nForm','#nMine','.nh-reading','#nFeed','.pl-live']:dataCase.id==='hot-takes'?['.hot-sub','.party-compose','#hTake','#hSend','.pl-live']:dataCase.id==='emoji-story'?['.es-preview','.es-table','[data-gk-input]']:dataCase.id==='would-you-rather'?['.gk-hud-phase','.gk-hud-progress','.wyr-choice','.wyr-body','#wyrStatus','.wyr-actions','.pl-live']:['four-in-a-row','reversi','ludo','fleet-duel'].includes(dataCase.id)?['.bk-stage','.bk-players','.bk-player','.bk-actions','.bk-tools','.bk-status']:dataCase.id==='rank-it'?['.js-feedback','.party-rank-list','.gk-actions','.pl-live']:dataCase.id==='twenty-questions'?['.tq-askrow','.tq-arch','.pl-live']:dataCase.id==='reaction-tap'?['.gk-hud-phase','.gk-hud-progress','#rPad','.rt-pad-label']:['.gk-hud-phase','.gk-hud-progress'];
   for(let i=0;i<dataCase.frames.length;i++){const S=dataCase.frames[i];if(dataCase.id==='twenty-questions'&&S.phase!=='play')continue;
    await page.evaluate(S=>window.applyFrame(S),S);await page.waitForTimeout(['four-in-a-row','reversi','ludo','fleet-duel'].includes(dataCase.id)?750:60);
    const rects=await page.evaluate(selectors=>selectors.flatMap(sel=>[...document.querySelectorAll('#gbody '+sel)].map((el,n)=>{const r=el.getBoundingClientRect();return{key:sel+':'+n,rect:[r.x,r.y,r.width,r.height],visible:getComputedStyle(el).display!=='none'};})),selectors);
    // The question fixtures include different people's private projections;
    // compare updates within each seat, rather than pretending a guesser
    // becomes the answerer midway through the same round.
    for(const {key,rect,visible}of rects){if(!visible)continue;const seatKey=(dataCase.id==='twenty-questions'?S.me+':':dataCase.id==='would-you-rather'?S.round+':':'')+key;const baseline=seen.get(seatKey);if(baseline){const d=Math.max(...rect.map((v,j)=>key.startsWith('.gk-hud-phase')&&j===2?0:Math.abs(v-baseline[j])));if(d>1)moves.push({phase:S.phase,key,delta:d,before:baseline,after:rect});}else seen.set(seatKey,rect);}
    if(['number-hunt','hot-takes','emoji-story'].includes(dataCase.id))await page.screenshot({path:path.join(out,`${width}-${theme}-${dataCase.id}${dataCase.kind?'-'+dataCase.kind:''}-${i}.png`),fullPage:true});
    if(dataCase.id==='number-hunt'&&width>=1000)assert(await page.locator('.pl-live').evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight),'Number Hunt roster stays above the desktop fold');
    if(dataCase.id==='hot-takes'&&i===0)await page.locator('#hTake').fill(dataCase.frames[1].myTake);
    if(dataCase.id==='emoji-story'&&i===0&&await page.locator('#eEmoji').count()){
     const boxes=()=>page.locator('.es-preview,.es-table,[data-gk-input]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height]}));
     const before=await boxes();
     for(const text of ['letters are not emoji','🌊🐟🎉','🌊🐟🎉'.repeat(16),'']){
      await page.locator('#eEmoji').fill(text);await page.waitForTimeout(60);
      const after=await boxes(),delta=Math.max(0,...after.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-before[i][j]))));
      if(delta>1)moves.push({input:text,delta,before,after});
     }
     await page.locator('#eSend2').click();
     const after=await boxes(),delta=Math.max(0,...after.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-before[i][j]))));
     if(delta>1)moves.push({input:'empty submit',delta,before,after});
     await page.screenshot({path:path.join(out,`${width}-${theme}-emoji-story-feedback.png`),fullPage:true});
    }
    if(dataCase.kind==='guess-feedback'&&i===0){
     const boxes=()=>page.locator('.es-table,[data-gk-input]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height]}));
     const before=await boxes();await page.locator('#eGuess').fill('A careful guess');await page.locator('#eSend').click();
     const after=await boxes(),delta=Math.max(0,...after.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-before[i][j]))));
     if(delta>1)moves.push({input:'guess send feedback',delta,before,after});
     await page.screenshot({path:path.join(out,`${width}-${theme}-emoji-story-guess-feedback.png`),fullPage:true});
    }
    if(dataCase.id==='would-you-rather'){
     assert(await page.locator('.wyr-choice').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height<=200)),'ordinary WYR choices stay compact');
     assert(await page.locator('.wyr-fill').evaluateAll(nodes=>nodes.every(n=>n.clientHeight>0)),'reveal bars have a visible fill inside their rims');
     assert(await page.locator('.gk-hud-phase').evaluate(n=>n.clientWidth<n.parentElement.getBoundingClientRect().width/4),'phase pill fits its label');
     if(i===0||S.phase==='reveal')await page.screenshot({path:path.join(out,`${width}-${theme}-${dataCase.id}-${S.round}-${S.phase}.png`),fullPage:true});
    }
    if(dataCase.id==='reaction-tap'&&await page.locator('#rPad').count()){
     assert.equal(await page.locator('#rPad').evaluate(n=>getComputedStyle(n,'::before').position),'absolute');
     await page.screenshot({path:path.join(out,`${width}-${theme}-${dataCase.id}-${S.phase}-${S.spectator?'watch':S.me}.png`),fullPage:true});
    }
    if(dataCase.id==='ludo'&&i<3)await page.screenshot({path:path.join(out,`${width}-${theme}-ludo-${i}-${S.phase}.png`),fullPage:true});
    if(dataCase.id==='truth-dare'){
     if(['compose','prompt-vote'].includes(S.phase))await page.screenshot({path:path.join(out,`${width}-${theme}-truth-dare-${i}-${S.phase}.png`),fullPage:true});
     if(S.phase==='prompt-vote'&&S.myPromptVote===null&&S.me!==S.target&&!S.spectator){
      const before=await page.locator('.td-prompt-option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];}));
      assert(before.every(r=>r[3]>=44),'prompt cards keep finger-sized targets');
      await page.evaluate(S=>window.applyFrame({...S,myPromptVote:0,promptVoted:[S.me]}),S);
      const after=await page.locator('.td-prompt-option').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];}));
      assert.deepEqual(after,before,'locked prompt cards stay in place');
     }
     if(S.phase==='compose'&&!S.myEntry&&S.me!==S.target&&!S.spectator){
      await page.locator('#tEntry').fill('Act like a sleepy cat.');await page.locator('#tEntry').focus();
      await page.evaluate(S=>window.applyFrame({...S,submitted:['another-writer']}),S);
      assert.equal(await page.locator('#tEntry').inputValue(),'Act like a sleepy cat.');
      assert(await page.locator('#tEntry').evaluate(n=>n===document.activeElement),'writing focus stays put');
     }
    }
    if(i===0&&['four-in-a-row','reversi','ludo','fleet-duel'].includes(dataCase.id)){
     const delta=await page.evaluate(()=>{
      const nodes=['.bk-stage','.bk-players','.bk-actions','.bk-tools'].map(s=>document.querySelector(s));
      const rects=()=>nodes.map(n=>{const r=n.getBoundingClientRect();return[r.x,r.y,r.width,r.height];});
      const before=rects();document.querySelector('[data-resign]').click();const armed=rects();document.querySelector('[data-keep]').click();
      return Math.max(0,...[armed,rects()].flatMap(rs=>rs.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-before[i][j])))));
     });assert(delta<1,dataCase.id+' confirmation keeps board and tools steady');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),dataCase.id+' has no horizontal page overflow');
    if(dataCase.id==='memory-tray'&&S.phase==='memorize'){const delta=await page.locator('.mt-ico').evaluateAll(async nodes=>{const rects=nodes.map(n=>n.getBoundingClientRect());await new Promise(r=>setTimeout(r,150));return Math.max(0,...nodes.map((n,i)=>{const b=n.getBoundingClientRect(),a=rects[i];return Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));}));});assert(delta<1,'individual tray icons stay still');}
   }
   const motion=await page.evaluate(()=>window.stopMotionCheck());if(motion.gameShifts.length)moves.push({layoutShifts:motion.gameShifts});if(motion.boardMoves.length)moves.push({perFrame:motion.boardMoves});if(dataCase.id==='reaction-tap'&&motion.padShifts.length)moves.push({padShifts:motion.padShifts});
   await page.screenshot({path:path.join(out,`${width}-${theme}-${dataCase.id}${dataCase.kind?'-'+dataCase.kind:''}.png`),fullPage:true});report.cases.push({width,theme,id:dataCase.id,scenario:dataCase.kind||'live',moves});console.log('STABILITY_CASE',width,theme,dataCase.id,JSON.stringify(moves));
  }assert.deepEqual(errors,[]);await context.close();
 }report.pass=report.cases.every(c=>!c.moves.length);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));assert(report.pass,'layout moved; see summary.json');console.log('STABILITY_BROWSER_PASS',report.cases.length);
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}}
module.exports={createFixture,cases};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
