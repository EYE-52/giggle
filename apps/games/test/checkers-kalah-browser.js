'use strict';
// Native-browser fixture server. Open /, click Run checks; reports stay internal.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..'), reports = process.env.CHECKERS_KALAH_REPORT_DIR || '/tmp/giggle-board-games-20261007';
const defs = { checkers: require('../games/checkers/server'), kalah: require('../games/kalah/server') }, runs = new Map();
let serial = 0;
function reset(token, id, scenario) {
  const def = defs[id], players = [{ id: 'a', name: 'Alexandria' }, { id: 'b', name: 'Bo' }], awards = {};
  const ctx = { now: () => Date.now(), allPlayers: () => players, content: () => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en/' + id + '.json'))), award: (pid, n) => { awards[pid] = (awards[pid] || 0) + n; } };
  const s = def.create(ctx), seat = scenario.includes('watch') ? 'watch' : scenario === 'wait' ? 'b' : 'a';
  if (id === 'checkers' && ['capture', 'crown', 'win', 'done', 'watch-done'].includes(scenario)) {
    s.board.fill(0); const position = scenario === 'capture' ? { 49: 1, 42: 2, 28: 2, 7: 2 } : scenario === 'crown' ? { 17: 1, 10: 2, 12: 2 } : { 17: 1, 10: 2 };
    for (const [i, p] of Object.entries(position)) s.board[i] = p;
    if (scenario.endsWith('done')) def.onAction(s, ctx, 'a', { from: 17, to: 3, revision: 0 });
  }
  if (id === 'kalah' && scenario === 'capture') s.pits = [0, 0, 1, 0, 0, 0, 20, 4, 0, 1, 0, 0, 0, 22];
  if (id === 'kalah' && ['win', 'done', 'watch-done'].includes(scenario)) {
    s.pits = [0, 0, 0, 0, 0, 1, 23, 1, 0, 0, 0, 0, 0, 23];
    if (scenario.endsWith('done')) def.onAction(s, ctx, 'a', { pit: 5, revision: 0 });
  }
  runs.set(token, { def, s, ctx, id, seat, players, instanceId: 'board-qa-' + (++serial) });
  return project(token);
}
function project(token) { const r = runs.get(token); return { ...r.def.view(r.s, r.seat), game: r.id, instanceId: r.instanceId, players: r.players, you: r.seat, me: r.seat, spectator: r.seat === 'watch', totals: r.ctx.awards }; }
// Boards that extend below a short landscape viewport are not playable fit,
// even if the document is tall enough to scroll to their bottom edge.
function insideViewport(rect, width, height) {
  return rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1;
}

function reportMarkup() {
  const source=fs.readFileSync(path.join(ROOT,'public/js/app.js'),'utf8');
  const definition=source.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)?.[0];
  if(!definition)throw Error('Production Report button not found');
  return vm.runInNewContext(definition+"\nreportButton('game-report-icon')",{},{timeout:1000});
}
function framePage() { return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/issues.css"><style>html,body{padding:0;margin:0}#gbody{padding:0;margin:0;max-width:none}.qa-room{position:absolute;top:8px;left:8px;z-index:9;background:#193127;color:white;border:1px solid #cadaca55;box-shadow:none;border-radius:8px;height:44px;padding:0 14px;font:700 13px Nunito,sans-serif}</style></head><body class="game-immersive game-playing touch-preferred"><details class="room-menu room-menu-floating" id="roomMenu"><summary aria-label="Room controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg><span>Room</span></summary><button type="button" class="room-menu-scrim" tabindex="-1" aria-label="Close room menu"></button><div class="room-menu-panel" role="dialog" aria-modal="true" aria-label="Room"><h2>Room QA</h2><button type="button" class="room-resume">Back to game</button></div></details>${reportMarkup()}<main id="gbody" data-layout="immersive"></main><script type="module">
import { createResultPresentation } from '/js/toolkit/result-presentation.mjs';
import {openIssueReport} from '/js/report-issue.js';
const q=new URLSearchParams(location.search),id=q.get('game')||'checkers',scenario=q.get('scenario')||'opening',token=q.get('token');
const {default:view}=await import('/js/games/'+id+'.js'),el=document.querySelector('#gbody');let S=null,previous=null,sent=[],celebrations=[],readies=[],transitions=[],mounted=false,doneAt=0,screenChanges=0;
document.addEventListener('game-screenchange',()=>screenChanges++);
document.addEventListener('click',event=>{const opener=event.target.closest('[data-report]');if(!opener)return;document.querySelector('#roomMenu').open=false;openIssueReport({games:[{id:'checkers',name:'Checkers'},{id:'kalah',name:'Kalah'}],game:id,phase:S?.phase||'',theme:document.documentElement.dataset.theme||'day',embedded:false},opener);});
// Shell footer footprint only. Moves and resets still use the actual kernel.
function footer(){let n=el.querySelector('#rematch');if(!n){n=document.createElement('div');n.id='rematch';n.className='rematch';n.innerHTML='<button type="button" id="bRematch">Rematch</button><button type="button" id="bChange" class="ghost">Change game</button>';n.style.display='flex';el.append(n);n.querySelector('#bRematch').onclick=()=>load('opening')}n.hidden=S?.phase!=='done'||el.querySelector('.bk-final,.bk-final')?.hidden;n.querySelectorAll('button').forEach(b=>b.disabled=S?.youAre!==0)}
const gate=createResultPresentation(snapshot=>celebrations.push({revision:snapshot.revision,at:performance.now()}));
const api={send:async a=>{sent.push(a);const next=await (await fetch('/api/action?token='+token,{method:'POST',body:JSON.stringify(a)})).json();update(next)},name:pid=>S.players.find(p=>p.id===pid)?.name,announce(){},focus:n=>n.focus({preventScroll:true}),now:()=>Date.now(),resultsReady:instance=>{readies.push({instance,at:performance.now(),pitCounts:[...el.querySelectorAll('.kl-bowl>text')].map(n=>Number(n.textContent))});gate.ready(instance);footer()}};
function update(next){const finishing=S?.phase==='play'&&next.phase==='done';gate.observe(S,next,true);previous=S;if(finishing)doneAt=performance.now();S=next;view.update(el,S,api);footer();if(finishing)transitions.push({revision:S.revision,receivedAt:doneAt,readiesAtPaint:readies.length,resultVisibleAtPaint:!el.querySelector('.bk-final,.bk-final').hidden})}
async function load(which=scenario){if(mounted)view.dispose(el);gate.reset();S=null;sent=[];celebrations=[];readies=[];transitions=[];doneAt=0;const next=await(await fetch('/api/reset?token='+token+'&game='+id+'&scenario='+which)).json();view.mount(el,api);mounted=true;update(next);await view.ready?.(el,next,api);await new Promise(r=>setTimeout(r,80));return S}
window.qa={get state(){return S},get screenChanges(){return screenChanges},get sent(){return sent},get celebrations(){return celebrations},get readies(){return readies},get doneAt(){return doneAt},get transitions(){return transitions},get reduced(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches},load,refresh:()=>view.update(el,S,api),stale:()=>view.update(el,previous,api),dispose:()=>view.dispose(el),el,view};
document.querySelectorAll('.room-resume,.room-menu-scrim').forEach(n=>n.addEventListener('click',()=>document.querySelector('#roomMenu').open=false));await load();window.qa.ready=true;
</script></body></html>`; }
const page = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkers and Kalah QA</title><style>body{margin:0;background:#102b27;color:#f4eddc;font:15px system-ui;padding:16px}h1{font-size:20px}button,select{font:inherit;min-height:44px;padding:8px;border-radius:8px;margin:4px}iframe{display:block;border:0;background:#2b4339;max-width:none;margin-top:16px}#status{white-space:pre-wrap;max-width:1000px}#controls{display:flex;gap:8px;flex-wrap:wrap}</style></head><body><h1>Checkers + Kalah · native browser QA</h1><div id="controls"><label>Game <select id="game"><option value="checkers">Checkers</option><option value="kalah">Kalah</option></select></label><label>Scene <select id="scene"><option>opening</option><option>capture</option><option>crown</option><option>win</option><option>wait</option><option>watch</option><option>done</option><option>watch-done</option></select></label><label>Size <select id="size"><option value="1280x800">1280 × 800</option><option value="1024x600">1024 × 600</option><option value="390x844">390 × 844</option><option value="320x640">320 × 640</option><option value="844x390">844 × 390</option><option value="568x320">568 × 320</option></select></label><button id="load">Load scene</button><button id="run">Run checks</button><button id="night">Toggle night shell</button></div><div id="status" role="status">Ready.</div><iframe title="Playable board fixture" id="board"></iframe><script>
const frame=document.querySelector('#board'),status=document.querySelector('#status'),by=id=>document.querySelector('#'+id),reports=[];let serial=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(ok,msg)=>{if(!ok)throw Error(msg)};
async function load(game=by('game').value,scene=by('scene').value,size=by('size').value){const[w,h]=size.split('x').map(Number);frame.width=w;frame.height=h;frame.src='/frame?game='+game+'&scenario='+scene+'&token=frame'+(++serial);await new Promise(r=>frame.onload=r);for(let n=0;n<100&&!frame.contentWindow.qa?.ready;n++)await wait(20);assert(frame.contentWindow.qa?.ready,'frame loaded');const until=Date.now()+5000;while(!frame.contentDocument.getElementById(game+'-css')?.sheet&&Date.now()<until)await wait(25);assert(frame.contentDocument.getElementById(game+'-css')?.sheet,'game styles loaded');return frame.contentWindow.qa}
${insideViewport.toString()}
function utilityGeometry(qa){
 const win=frame.contentWindow,doc=win.document,root=qa.el,report=doc.querySelector('.game-report-icon'),room=doc.querySelector('.room-menu>summary');
 const visible=n=>n&&n.getClientRects().length&&win.getComputedStyle(n).visibility!=='hidden'&&win.getComputedStyle(n).display!=='none',separate=(a,b)=>a.right<=b.left+.5||a.left>=b.right-.5||a.bottom<=b.top+.5||a.top>=b.bottom-.5;
 const reportBox=report?.getBoundingClientRect(),roomBox=room?.getBoundingClientRect(),metrics=qa.utilityDebug={phase:qa.state.phase,viewport:{width:win.innerWidth,height:win.innerHeight},report:reportBox?.toJSON(),room:roomBox?.toJSON(),regions:[]};
 for(const [name,n,b]of [['Report',report,reportBox],['Room',room,roomBox]]){
  assert(visible(n),name+' is hidden');assert(b.width>=43.5&&b.height>=43.5,name+' target below44px');assert(insideViewport(b,win.innerWidth,win.innerHeight),name+' outside visible viewport');
  const hit=doc.elementFromPoint(b.left+b.width/2,b.top+b.height/2);assert(hit&&(hit===n||n.contains(hit)),name+' covered by '+(hit?.className||hit?.tagName));
 }
 assert(separate(reportBox,roomBox),'Report intersects Room');
 for(const n of root.querySelectorAll('.bk-head,.bk-head,.bk-players,.bk-players,.ck-board,.kl-board,.bk-tools button,.bk-tools button,.bk-tools summary,.bk-tools summary')){
  if(!visible(n))continue;const b=n.getBoundingClientRect();metrics.regions.push({name:n.className||n.textContent.trim(),...b.toJSON()});assert(separate(reportBox,b),'content intersects Report '+n.className);assert(separate(roomBox,b),'content intersects Room '+n.className);
 }
 return metrics;
}
async function reportModal(qa){
 const win=frame.contentWindow,doc=win.document,opener=doc.querySelector('.game-report-icon'),before=qa.screenChanges,sent=qa.sent.length,revision=qa.state.revision;
 await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));utilityGeometry(qa);opener.focus({preventScroll:true});opener.click();
 const dialog=doc.querySelector('dialog.issue-dialog[open]');assert(dialog&&doc.activeElement===dialog.querySelector('.issue-close'),'actual Report did not open with safe focus');assert(qa.screenChanges===before+1,'Report did not dispatch input release');
 const b=dialog.getBoundingClientRect();assert(insideViewport(b,win.innerWidth,win.innerHeight),'Report dialog outside viewport');
 let leaked=0;const listener=()=>leaked++;win.addEventListener('keydown',listener);dialog.querySelector('.issue-close').dispatchEvent(new win.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));win.removeEventListener('keydown',listener);
 assert(!leaked&&qa.sent.length===sent&&qa.state.revision===revision,'Report keyboard changed game input/authority');dialog.querySelector('.issue-close').click();
 assert(!doc.querySelector('dialog[open]')&&doc.activeElement===opener,'Report close did not restore opener');assert(qa.screenChanges===before+2,'Report close did not refresh lifecycle');utilityGeometry(qa);return{phase:qa.state.phase,dialog:b.toJSON(),releaseEvents:qa.screenChanges-before};
}
function geometry(qa,game,size){
 const utilities=utilityGeometry(qa);
 const d=frame.contentDocument,root=qa.el,art=root.querySelector('svg'),r=art.getBoundingClientRect(),width=frame.contentWindow.innerWidth,height=frame.contentWindow.innerHeight,portrait=height>width,fit=!portrait||game==='kalah';
 assert(root.scrollWidth<=width+2,'horizontal overflow '+root.scrollWidth+'/'+width);assert(r.width>0&&r.height>0,'visible SVG');
 const launchers=[...d.querySelectorAll('.room-menu>summary,.game-report-icon')].filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect());
 for(const n of root.querySelectorAll('.bk-head,.bk-head,.bk-players,.bk-players,.ck-board,.kl-board')){const a=n.getBoundingClientRect();for(const b of launchers)assert(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top),'content overlaps Room or Report');}
 const buttons=[...root.querySelectorAll(game==='checkers'?'[data-square]':'.kl-hit')],targetFloor=game==='checkers'?(portrait?(width<384?35:43.99):29.5):(portrait?43.99:36);
 for(const b of buttons){const x=b.getBoundingClientRect();assert(x.width>=targetFloor&&x.height>=targetFloor,'small board target '+x.width+'×'+x.height);assert(x.left>=-1&&x.right<=width+1,'unreachable board cell');if(fit)assert(insideViewport(x,width,height),'board target outside visible viewport');}
 const controls=[];
 for(const b of root.querySelectorAll('button:not([data-square]),summary')){if(b.hidden||!b.getClientRects().length)continue;const x=b.getBoundingClientRect();assert(x.width>=43.5&&x.height>=43.5,'small control '+b.textContent+' '+x.width+'×'+x.height);const inView=insideViewport(x,width,height);controls.push({label:b.textContent.trim()||b.getAttribute('aria-label'),top:x.top,bottom:x.bottom,inView});if(fit&&!b.closest('#rematch'))assert(inView,'primary control outside visible viewport '+b.textContent);}
 const boardFullyVisible=insideViewport(r,width,height);
 if(fit){assert(boardFullyVisible,'board outside visible viewport '+r.bottom+'/'+height);for(const n of root.querySelectorAll('.bk-status,.bk-status,.bk-players,.bk-players'))assert(insideViewport(n.getBoundingClientRect(),width,height),'turn information outside visible viewport');}
 else assert(r.bottom<=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight)+1,'portrait board reachable in natural flow');
 assert(Math.abs(r.width/r.height-(game==='checkers'?1:portrait?400/480:840/360))<.03,'board aspect');
 if(game==='kalah'&&qa.state.phase==='play')assert(d.documentElement.scrollHeight<=height+1,'live Kalah workspace scrolls below viewport');
 return{utilities,width:r.width,height:r.height,top:r.top,bottom:r.bottom,viewport:{width,height},boardFullyVisible,scope:fit?'board and primary controls in visible viewport':'portrait natural flow',targetFloor,targets:buttons.length,controls,documentHeight:d.documentElement.scrollHeight};
}
function click(qa,selector){const node=qa.el.querySelector(selector);assert(node,'missing '+selector);node.dispatchEvent(new frame.contentWindow.MouseEvent('click',{bubbles:true,cancelable:true}));return node}
async function action(qa,game,from,to){const count=qa.sent.length,rev=qa.state.revision;if(game==='checkers'){click(qa,'[data-square="'+from+'"]');click(qa,'[data-square="'+to+'"]')}else click(qa,'[data-pit="'+from+'"]');if(qa.sent.length>count){const until=Date.now()+5000;while(qa.state.revision===rev&&Date.now()<until)await wait(25);assert(qa.state.revision>rev,'action acknowledged')}else await wait(80)}
async function settled(qa,game,label){
 const deadline=performance.now()+8000;
 while(qa.el.querySelector(game==='checkers'?'.bk-status':'.bk-status').textContent===qa.state.strings[game==='checkers'?'moving':'sowing']||qa.state.phase==='done'&&(qa.readies.length!==1||qa.el.querySelector(game==='checkers'?'.bk-final':'.bk-final').hidden)){
  assert(performance.now()<deadline,label+' actual presentation did not settle');await wait(25);
 }
}
by('load').onclick=()=>load();by('night').onclick=()=>{const d=frame.contentDocument.documentElement;d.dataset.theme=d.dataset.theme==='night'?'day':'night'};
by('run').onclick=async()=>{by('run').disabled=true;reports.length=0;try{for(const game of ['checkers','kalah'])for(const size of ['1280x800','1024x600','390x844','320x640','844x390','568x320']){let qa=await load(game,'opening',size);const report={game,size,checks:0};const check=(ok,msg)=>{assert(ok,game+' '+size+' '+msg);report.checks++};report.geometry=geometry(qa,game,size);report.reports={opening:await reportModal(qa)};check(true,'opening actual Report modal');
if(game==='checkers'){click(qa,'[data-square="40"]');check(qa.el.querySelector('[data-square="40"]').classList.contains('is-selected'),'tap selects');qa.refresh();check(qa.el.querySelector('[data-square="40"]').classList.contains('is-selected'),'same snapshot keeps selection');const cell=qa.el.querySelector('[data-square="40"]');cell.focus();cell.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));check(frame.contentDocument.activeElement.dataset.square==='32','keyboard arrows');click(qa,'[data-square="33"]');await wait(80)}else{const cell=qa.el.querySelector('[data-pit="0"]');cell.focus();const arrow=Number(frame.height)>Number(frame.width)?'ArrowDown':'ArrowRight';cell.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:arrow,bubbles:true,cancelable:true}));check(frame.contentDocument.activeElement.dataset.pit==='1','keyboard arrows follow physical board');const first=qa.el.querySelector('[data-pit="2"]');first.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(80)}
check(qa.sent.length===1,'one legal action');check(qa.sent[0].revision===0,'action has revision');if(game==='checkers')check([...qa.el.querySelectorAll('.bk-stat-value')].every(n=>n.textContent==='12 pieces'),'piece counts stay accurate while a piece animates');await settled(qa,game,'opening move');check(qa.state.revision===1,'server acknowledged');qa.stale();check(qa.el.querySelector(game==='checkers'?'.bk-status':'.bk-status').textContent!=='Making a move…'&&qa.el.querySelector(game==='checkers'?'.bk-status':'.bk-status').textContent!=='Sowing seeds…','old snapshot does not replay animation');
for(const scene of ['wait','watch']){qa=await load(game,scene,size);geometry(qa,game,size);report.reports[scene]=await reportModal(qa);check(true,scene+' actual Report modal');if(game==='checkers')await action(qa,game,40,33);else await action(qa,game,2);check(qa.sent.length===0,scene+' cannot act');click(qa,'[data-flip]');check(qa.sent.length===0,scene+' flip stays local');}
qa=await load(game,'win',size);await action(qa,game,game==='checkers'?17:5,3);check(qa.state.phase==='done','legal winning move');check(qa.reduced||qa.transitions[0].readiesAtPaint===0&&!qa.transitions[0].resultVisibleAtPaint,'confirmed final state starts with a deferred result');await settled(qa,game,'winning move');check(qa.celebrations.length===1,'one settled celebration');check(qa.reduced||qa.readies[0].at-qa.doneAt>=(game==='checkers'?400:420),'celebration follows animation duration, including background timer throttling');check(!qa.el.querySelector(game==='checkers'?'.bk-final':'.bk-final').hidden,'results visible');report.finalGeometry=geometry(qa,game,size);report.reports.settledFinal=await reportModal(qa);check(true,'settled final actual Report modal');if(Number(frame.height)>Number(frame.width)||Number(frame.width)<=660)check(report.finalGeometry.width>=report.geometry.width-1,'settled phone board keeps its opening width');const statusNode=qa.el.querySelector(game==='checkers'?'.bk-status':'.bk-status'),reasonNode=qa.el.querySelector(game==='checkers'?'.bk-hint':'.bk-hint');check(statusNode.getAttribute('role')==='status'&&statusNode.textContent.trim()&&statusNode.getClientRects().length,'winner remains visible and accessible');check(reasonNode.textContent.trim()&&reasonNode.getClientRects().length,'finish reason remains visible');const resultBox=qa.el.querySelector(game==='checkers'?'.bk-game':'.bk-game').getBoundingClientRect(),footerBox=qa.el.querySelector('#bRematch').getBoundingClientRect();check(footerBox.top>=resultBox.bottom&&footerBox.top-resultBox.bottom<120,'shell result actions follow the board naturally');check(footerBox.height>=43.99,'shell result action target44px');qa.refresh();check(qa.celebrations.length===1,'duplicate snapshot no second celebration');await qa.load('done');report.reports.firstDone=await reportModal(qa);check(true,'first finished mount actual Report modal');check(qa.celebrations.length===0,'finished first mount has no replay');await qa.load('watch-done');report.reports.watcherDone=await reportModal(qa);check(true,'finished watcher actual Report modal');check(qa.celebrations.length===0,'finished watcher has no replay');await qa.load('opening');report.reports.rematch=await reportModal(qa);check(true,'rematch actual Report modal');await action(qa,game,game==='checkers'?40:2,33);check(qa.sent.length===1,'rematch listeners exact once');await settled(qa,game,'rematch move');report.pass=true;reports.push(report);status.textContent=reports.map(x=>'PASS '+x.game+' '+x.size+' · '+x.checks+' checks').join('\n');}
const qa=await load('checkers','capture','390x844');await action(qa,'checkers',49,35);await settled(qa,'checkers','first forced capture');checkCapture(qa);await action(qa,'checkers',35,21);await settled(qa,'checkers','continued forced capture');assert(qa.state.turn===1&&qa.state.forced===null,'forced chain finishes');
function checkCapture(q){assert(q.state.forced===35,'continued jump');assert(q.el.querySelector('[data-square="35"]').classList.contains('is-selected'),'continued piece preselected')}
status.textContent+='\nPASS forced capture continuation';
const capture=await load('kalah','capture','390x844');await action(capture,'kalah',2);
assert(capture.reduced||capture.transitions[0].readiesAtPaint===0&&!capture.transitions[0].resultVisibleAtPaint,'capture ACK cannot present the result before motion');
await settled(capture,'kalah','capture and opposing sweep');
// One100ms sow, three220ms transfers, then the actual100ms final hold.
const captureTiming={expectedMs:860,receivedAt:capture.doneAt,readyAt:capture.readies[0].at,elapsedMs:capture.readies[0].at-capture.doneAt,transition:capture.transitions[0],paintedPits:capture.readies[0].pitCounts};
assert(capture.reduced||captureTiming.elapsedMs>=captureTiming.expectedMs,'capture/sweep result precedes its actual860ms animation schedule');
assert(capture.state.pits[6]===22&&capture.state.pits[13]===26,'capture and opposing sweep enter correct stores');
assert(capture.state.pits.reduce((a,b)=>a+b,0)===48,'all seeds remain conserved');
assert(JSON.stringify(captureTiming.paintedPits)===JSON.stringify(capture.state.pits),'result readiness sees all final painted authoritative counts');
assert(capture.readies.length===1&&capture.celebrations.length===1,'capture and sweep present once after settlement');
status.textContent+='\nPASS Kalah capture plus opposing sweep settlement '+captureTiming.elapsedMs.toFixed(1)+'ms';await fetch('/report',{method:'POST',body:JSON.stringify({pass:true,reports,extra:{forcedCapture:true,captureTiming},at:new Date().toISOString()})});by('game').value='kalah';by('scene').value='opening';by('size').value='390x844';await load();}catch(e){status.textContent+='\nFAIL '+e.stack;await fetch('/report',{method:'POST',body:JSON.stringify({pass:false,reports,error:e.stack,failureGeometry:frame.contentWindow.qa?.utilityDebug})})}finally{by('run').disabled=false}};load();
</script></body></html>`;
function createServer() { return http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/' || u.pathname === '/frame') { res.setHeader('Content-Type', 'text/html'); return res.end(u.pathname === '/' ? page : framePage()); }
    if (u.pathname === '/api/reset') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(reset(u.searchParams.get('token'), u.searchParams.get('game'), u.searchParams.get('scenario')))); }
    if (u.pathname === '/api/action') { let raw = ''; for await (const chunk of req) raw += chunk; const token = u.searchParams.get('token'), r = runs.get(token); r.def.onAction(r.s, r.ctx, r.seat, JSON.parse(raw)); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(project(token))); }
    if (u.pathname === '/report') { let raw = ''; for await (const chunk of req) raw += chunk; fs.mkdirSync(reports, { recursive: true }); fs.writeFileSync(path.join(reports, 'checkers-kalah-browser.json'), JSON.stringify(JSON.parse(raw), null, 2)); return res.end('saved'); }
    const file = path.resolve(ROOT, 'public', '.' + u.pathname);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
}); }
module.exports = { createServer, insideViewport };
if (require.main === module && process.argv.includes('--verify-oracle')) {
  const assert = require('node:assert/strict'), vm = require('node:vm');
  assert.equal(insideViewport({left:8,top:58,right:258,bottom:308},568,320),true);
  // A tall document used to make this offscreen board pass. Only the visible
  // viewport may admit a landscape board, regardless of document height.
  assert.equal(insideViewport({left:10,top:58,right:566,bottom:614},844,390),false);
  assert.equal(insideViewport({left:8,top:58,right:558,bottom:608},568,320),false);
  assert.equal(insideViewport({left:8,top:-2,right:258,bottom:308},568,320),false);
  assert.equal(insideViewport({left:8,top:58,right:570,bottom:308},568,320),false);
  assert.equal(insideViewport({left:8,top:133,right:312,bottom:696},320,640),false);
  assert.equal(insideViewport({left:8,top:108,right:312,bottom:472.8},320,640),true);
  new vm.Script(page.match(/<script>([\s\S]*)<\/script>/)[1]);
  const syntax = require('node:child_process').spawnSync(process.execPath, ['--check', '--input-type=module'], {input:framePage().match(/<script type="module">([\s\S]*)<\/script>/)[1],encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  console.log('Checkers/Kalah viewport oracle:7 edge checks and both browser scripts passed syntax.');
} else if (require.main === module) createServer().listen(Number(process.env.PORT || 8358), '127.0.0.1', () => console.log('CHECKERS_KALAH_QA http://127.0.0.1:' + (process.env.PORT || 8358)));
