'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto'),{WebSocketServer}=require('ws'),{Room}=require('../server/room');
const defs={ludo:require('../games/ludo/server'),'fleet-duel':require('../games/fleet-duel/server')};
const publicRoot=path.resolve(__dirname,'../public'),directory=process.env.LUDO_FLEET_REPORT_DIR||'/tmp/giggle-board-games-20261007/ludo-fleet';
function createSession(id){const game=defs[id];if(!game)throw Error('Unknown game');const room=new Room('LFQ',{}),bot=()=>({readyState:1,bufferedAmount:0,send(){},close(){}}),roles={};
for(const [role,name] of (id==='ludo'?[['a','Anika'],['b','Bastian'],['c','Cora'],['d','Davi']]:[['a','Anika'],['b','Bastian']]))roles[role]=room.addPlayer(name,bot()).player;
roles.earlier=room.addPlayer('Early watcher',bot()).player;const started=room.startGame(game,{ready:true},roles.a.id);if(!started.ok)throw Error(started.error);roles.watcher=room.addPlayer('Late watcher',bot()).player;return{room,game,roles};}
function reportMarkup(){
 const source=fs.readFileSync(path.join(publicRoot,'js/app.js'),'utf8');
 const definition=source.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)?.[0];
 if(!definition)throw Error('Production Report button not found');
 return vm.runInNewContext(definition+"\nreportButton('game-report-icon')",{},{timeout:1000});
}
function clientPage() { return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Board game client QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/issues.css"><style>body{padding:0;margin:0}#client-tools{display:flex;gap:8px;align-items:center;padding:4px 12px;font:13px system-ui}#client-tools button{min-height:44px;font:inherit}.app{width:100%;max-width:none;padding:0;margin:0 auto}.game-stage{padding:0}#gbody{min-width:0;width:100%}#fixture-rematch{display:flex;justify-content:center;gap:8px;margin-top:10px}#fixture-rematch button{font:700 14px system-ui;min-height:44px;padding:10px 16px}[hidden]{display:none!important}.qa-reduced .ld-game *, .qa-reduced .fl-game *{animation:none!important;transition:none!important}</style><body class="game-playing game-immersive touch-preferred"><details class="room-menu room-menu-floating" id="roomMenu"><summary aria-label="Room controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg><span>Room</span></summary><button type="button" class="room-menu-scrim" id="bRoomScrim" tabindex="-1" aria-label="Close room menu"></button><div class="room-menu-panel" role="dialog" aria-modal="true" aria-labelledby="roomMenuTitle"><div class="room-menu-head"><span class="room-menu-kicker">ROOM QA</span><button type="button" class="room-close" id="bRoomClose" aria-label="Close room menu">×</button></div><h2 id="roomMenuTitle"></h2><p id="gContext">Real Room and independent WebSocket client. Fixture uses the production Room footprint and actual Report modal.</p><button type="button" class="room-resume" id="bRoomResume">Back to game<span aria-hidden="true">▶</span></button></div></details>${reportMarkup()}<div id="client-tools"><span id="role"></span><button id="reconnect">Reconnect</button><span id="connection"></span></div><main class="app" data-layout="immersive"><div class="game-stage"><div id="gbody" data-layout="immersive"></div><div id="fixture-rematch" hidden><button id="rematch">Rematch</button></div></div></main><script type="module">
import {show,reset} from '/js/game-host.js';
import {createServerClock} from '/js/server-clock.js';
import {openIssueReport} from '/js/report-issue.js';
const params=new URLSearchParams(location.search),role=params.get('role')||'a',session=params.get('session'),game=params.get('game')||'ludo',el=document.getElementById('gbody'),sent=[],presented=[],cues=[],errors=[],readyAcks=[],acks=[],clock=createServerClock(),cueIds=new Set();
if(params.get('theme')==='night')document.documentElement.dataset.theme='night';
if(params.get('motion')==='reduce'){document.documentElement.classList.add('qa-reduced');const media=window.matchMedia.bind(window);window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true}:media(q);}
if(params.get('scene')==='1')document.getElementById('client-tools').hidden=true;
document.getElementById('roomMenuTitle').textContent=game==='ludo'?'Ludo':'Fleet Duel';const menu=document.getElementById('roomMenu');for(const id of ['bRoomClose','bRoomResume','bRoomScrim'])document.getElementById(id).onclick=()=>{menu.open=false;menu.querySelector('summary').focus({preventScroll:true})};menu.ontoggle=()=>{if(menu.open)document.getElementById('bRoomResume').focus({preventScroll:true})};document.getElementById('role').textContent=role;
let socket,S=null,rendered=null,roomHost=null,active=true,stateCount=0,screenChanges=0,resolveReady;const ready=new Promise(r=>resolveReady=r);
document.addEventListener('game-screenchange',()=>screenChanges++);
document.addEventListener('click',event=>{const opener=event.target.closest('[data-report]');if(!opener)return;menu.open=false;openIssueReport({games:[{id:'ludo',name:'Ludo'},{id:'fleet-duel',name:'Fleet Duel'}],game,phase:S?.phase||'',theme:document.documentElement.dataset.theme||'day',embedded:false},opener);});
const api={context:()=>({isHost:roomHost===S?.me}),send:a=>{if(!active||socket?.readyState!==1||!S)return false;sent.push(a);socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w}));return true;},focus:n=>n?.focus({preventScroll:true}),announce(){},resultsReady:id=>presented.push(id),cue:(name,options)=>{const id=options?.id,key=name+':'+id;if(!active||!id?.startsWith(S?.instanceId+':')||cueIds.has(key))return false;cueIds.add(key);if(S.preparing||S.audioBaseline)return false;cues.push({name,...options});return true;},rematch:()=>socket.send(JSON.stringify({t:'qa-rematch'})),now:()=>S?.preparing?S.gameNow:clock.now()-(S?.clockOffset||0),ready:({instanceId,window})=>{if(!active||socket?.readyState!==1||!S?.preparing||S.instanceId!==instanceId||S.w!==window||S.spectator)return false;readyAcks.push({instanceId,window});socket.send(JSON.stringify({t:'game-ready',i:instanceId,w:window}));return true;},loadError:e=>{errors.push(e.error);document.getElementById('connection').textContent=e.error;}};
async function paint(snapshot){const view=await show(el,game,snapshot,api);if(active&&S===snapshot&&view){rendered=snapshot;document.getElementById('fixture-rematch').hidden=true;document.getElementById('rematch').disabled=roomHost!==S.me;if(!snapshot.preparing)resolveReady();}}
async function connect(){active=true;clock.reset();let baseline=true;return new Promise((resolve,reject)=>{const peer=socket=new WebSocket('ws://'+location.host+'/socket');peer.onopen=()=>peer.send(JSON.stringify({t:'join',session,role}));peer.onerror=reject;peer.onmessage=async e=>{if(peer!==socket||!active)return;const m=JSON.parse(e.data);if(m.t==='room'){roomHost=m.room.hostId;if(S)await paint(S);}if(m.t==='state'){stateCount++;clock.observe(m.serverNow);const snapshot=S={...m,me:m.you,audioBaseline:baseline};baseline=false;await paint(snapshot);if(active&&peer===socket)resolve();}if(m.t==='qa-ack')acks.push(m);if(m.t==='qa-error'){errors.push(m.message);document.getElementById('connection').textContent=m.message;}};});}
window.qa={ready,sent,presented,cues,errors,readyAcks,acks,el,api,get stateCount(){return stateCount},get screenChanges(){return screenChanges},get state(){return S},get rendered(){return rendered},get socket(){return socket},async reconnect(){active=false;rendered=null;reset();const retired=socket;const closed=new Promise(r=>retired.addEventListener('close',r,{once:true}));retired.close();await closed;await connect();},raw(a,meta={}){socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w,...meta}));},dispose(){active=false;rendered=null;reset();socket?.close();}};
document.getElementById('reconnect').onclick=()=>window.qa.reconnect();document.getElementById('rematch').onclick=api.rematch;
window.addEventListener('pagehide',()=>window.qa.dispose());await connect();
</script></html>`; }
function hubPage(){return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ludo and Fleet Duel QA</title><style>body{margin:12px;background:#dddfe4;color:#252938;font:16px system-ui}header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}button,select,a{min-height:44px;box-sizing:border-box;padding:8px;font:inherit}iframe{display:block;border:0;background:#fff}iframe[hidden]{display:none}#frames{margin-top:12px}#status{font-size:14px;white-space:pre-wrap}</style><header><select id="game" aria-label="Game"><option value="ludo">Ludo</option><option value="fleet-duel">Fleet Duel</option></select><button id="fresh">Fresh room</button><label>Player <select id="role"></select></label><select id="size" aria-label="Client viewport"><option value="390,844">Portrait390×844</option><option value="320,640">Small portrait320×640</option><option value="1280,800">Desktop1280×800</option><option value="1024,600">Laptop 1024 × 600</option><option value="844,390">Landscape844×390</option><option value="568,320">Compact568×320</option></select><button id="reconnect">Reconnect player</button><button id="bot">Play remaining turns (live clients)</button><button id="lifecycle">Check finished lifecycle</button><button id="geometry">Check viewports</button><a id="open" target="_blank">Open player</a></header><p id="status">Connecting…</p><main id="frames"></main><script type="module">
const roles=document.querySelector('#role'),game=document.querySelector('#game'),size=document.querySelector('#size'),frames={},status=document.querySelector('#status');let session,playing=false,playRun=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let n=0;n<750;n++){if(fn())return;await wait(20)}throw Error('Client did not become ready')}
function dimensions(){const [w,h]=size.value.split(',');for(const f of Object.values(frames)){f.width=w;f.height=h;f.style.width=w+'px';f.style.height=h+'px';}}
function show(){for(const [role,f]of Object.entries(frames))f.hidden=role!==roles.value;document.querySelector('#open').href='/client?session='+session+'&game='+game.value+'&role='+roles.value+'&scene=1';dimensions();}
async function fresh(){playing=false;playRun++;document.querySelector('#bot').textContent='Play remaining turns (live clients)';for(const f of Object.values(frames))f.contentWindow.qa?.dispose();if(session)await fetch('/close?session='+session,{method:'POST'});const data=await(await fetch('/session?game='+game.value)).json();session=data.session;document.querySelector('#frames').innerHTML='';roles.innerHTML='';for(const k of Object.keys(frames))delete frames[k];for(const role of data.roles){const f=document.createElement('iframe');f.title=role+' live player';f.src='/client?session='+session+'&game='+game.value+'&role='+role+'&scene=1';frames[role]=f;document.querySelector('#frames').append(f);roles.add(new Option(role,role));}show();await settle();if(Object.values(frames).some(f=>!f.contentWindow.qa.state.spectator&&!f.contentWindow.qa.readyAcks.length))throw Error('Active seat did not ACK readiness');if(Object.values(frames).some(f=>f.contentWindow.qa.state.spectator&&f.contentWindow.qa.readyAcks.length))throw Error('Watcher entered readiness quorum');status.textContent='Released, painted Room '+session;}
const q=role=>frames[role]?.contentWindow.qa;
function painted(role){const qa=q(role);return !!qa?.state&&qa.rendered===qa.state&&!qa.state.preparing;}
function settled(role){if(!painted(role))return false;const c=q(role).el[game.value==='ludo'?'_ludo':'_fleet'];return !!c&&!c.pending&&!c.settling;}
async function settle(){await until(()=>Object.keys(frames).every(settled));}
function click(role,selector){const n=q(role).el.querySelector(selector);if(!n)throw Error('Missing '+role+' '+selector);n.dispatchEvent(new frames[role].contentWindow.MouseEvent('click',{bubbles:true}));}
async function save(name,result){const response=await fetch('/results?name='+name,{method:'POST',body:JSON.stringify(result)});if(!response.ok)throw Error(await response.text());}
function assert(value,message){if(!value)throw Error(message)}
function utilityGeometry(role){
 const qa=q(role),win=frames[role].contentWindow,doc=win.document,root=qa.el;
 const visible=n=>n&&n.getClientRects().length&&win.getComputedStyle(n).visibility!=='hidden'&&win.getComputedStyle(n).display!=='none';
 const inside=b=>b.left>=-.5&&b.top>=-.5&&b.right<=win.innerWidth+.5&&b.bottom<=win.innerHeight+.5;
 const separate=(a,b)=>a.right<=b.left+.5||a.left>=b.right-.5||a.bottom<=b.top+.5||a.top>=b.bottom-.5;
 const report=doc.querySelector('.game-report-icon'),room=doc.querySelector('.room-menu>summary'),reportBox=report?.getBoundingClientRect(),roomBox=room?.getBoundingClientRect();
 const metrics=qa.utilityDebug={phase:qa.state.phase,viewport:[win.innerWidth,win.innerHeight],report:reportBox?.toJSON(),room:roomBox?.toJSON(),regions:[]};
 for(const [name,n,b]of [['Report',report,reportBox],['Room',room,roomBox]]){
  assert(visible(n),name+' is hidden');assert(b.width>=43.5&&b.height>=43.5,name+' target below44px');assert(inside(b),name+' outside visible viewport');
  const hit=doc.elementFromPoint(b.left+b.width/2,b.top+b.height/2);assert(hit&&(hit===n||n.contains(hit)),name+' covered by '+(hit?.className||hit?.tagName));
 }
 assert(separate(reportBox,roomBox),'Report intersects Room');
 for(const n of root.querySelectorAll('.bk-head,.bk-status,.bk-players>div,.ld-board,.ld-dice,.ld-choices button,.bk-tools summary,.bk-head,.bk-status,.bk-players>div,.fl-stage,.fl-chart-tools button,.bk-panel button,.bk-tools summary')){
  if(!visible(n))continue;
  const boxes=n.matches('.bk-head,.bk-status,.bk-head,.bk-status')?(()=>{const range=doc.createRange();range.selectNodeContents(n);return [...range.getClientRects()]})():[n.getBoundingClientRect()];
  for(const b of boxes){if(!b.width||!b.height)continue;metrics.regions.push({name:n.className||n.getAttribute('aria-label')||n.textContent.trim(),...b.toJSON()});assert(separate(reportBox,b),'Report intersects '+n.className);assert(separate(roomBox,b),'Room intersects '+n.className);}
 }
 return metrics;
}
async function reportModal(role){
 const qa=q(role),win=frames[role].contentWindow,doc=win.document,opener=doc.querySelector('.game-report-icon'),before=qa.screenChanges,sent=qa.sent.length,revision=qa.state.actionRev??qa.state.rev;
 await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));utilityGeometry(role);opener.focus({preventScroll:true});opener.click();
 const dialog=doc.querySelector('dialog.issue-dialog[open]');assert(dialog&&doc.activeElement===dialog.querySelector('.issue-close'),'actual Report did not open with safe focus');assert(qa.screenChanges===before+1,'Report did not dispatch input release');
 const b=dialog.getBoundingClientRect();assert(b.left>=-.5&&b.right<=win.innerWidth+.5&&b.top>=-.5&&b.bottom<=win.innerHeight+.5,'Report dialog outside viewport');
 let leaked=0;const listener=()=>leaked++;win.addEventListener('keydown',listener);dialog.querySelector('.issue-close').dispatchEvent(new win.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));win.removeEventListener('keydown',listener);
 assert(!leaked&&qa.sent.length===sent&&(qa.state.actionRev??qa.state.rev)===revision,'Report keyboard changed game input/authority');dialog.querySelector('.issue-close').click();
 assert(!doc.querySelector('dialog[open]')&&doc.activeElement===opener,'Report close did not restore opener');assert(qa.screenChanges===before+2,'Report close did not dispatch lifecycle refresh');utilityGeometry(role);return{phase:qa.state.phase,dialog:b.toJSON(),releaseEvents:qa.screenChanges-before};
}
async function phaseUtilities(){const previous=roles.value,result={};try{for(const role of Object.keys(frames)){roles.value=role;show();await wait(40);result[role]={geometry:utilityGeometry(role),report:await reportModal(role)};}return result;}finally{roles.value=previous;show();}}
async function playRemaining(){
 if(playing){playing=false;playRun++;document.querySelector('#bot').textContent='Play remaining turns (live clients)';return;}
 const current=session,id=game.value,button=document.querySelector('#bot'),run=++playRun,live=()=>run===playRun&&session===current&&game.value===id;let actions=0;playing=true;button.textContent='Stop live play';
 try{
  while(playing&&live()&&actions<20000){
   await settle();if(!live())return;const state=q('a').state;if(state.phase==='done')break;
   const side=id==='fleet-duel'&&state.phase==='place'?state.ready.findIndex(v=>!v):state.turn,role=['a','b','c','d'][side],s=q(role).state;
   const counts=Object.fromEntries(Object.keys(frames).map(r=>[r,q(r).stateCount])),revision=s.actionRev??s.rev;
   if(id==='ludo'){
    if(s.phase==='roll')click(role,'[data-roll]');
    else{const choice=[...s.legal].sort((a,b)=>s.pawns[side][b]-s.pawns[side][a])[0];click(role,'[data-choice="'+choice+'"]');}
   }else if(s.phase==='place')click(role,s.ownFleet.length===5?'[data-ready]':'[data-auto]');
   else{const at=s.shots[side].findIndex(v=>!v);click(role,'[data-tab="target"]');click(role,'[data-square="'+at+'"]');click(role,'[data-fire]');}
   await until(()=>!live()||(Object.keys(frames).every(r=>q(r).stateCount>counts[r]&&painted(r))&&(q(role).state.actionRev??q(role).state.rev)!==revision));if(!live())return;
   await settle();if(!live())return;actions++;status.textContent='Live clients · '+actions+' confirmed, released, settled actions';
  }
  if(!live())return;
  const state=q('a').state,complete=state.phase==='done';
  if(complete)await until(()=>Object.keys(frames).every(r=>q(r).presented.includes(state.instanceId)));
  const utilities=complete?await phaseUtilities():null;
  const result={pass:complete,game:id,actions,stopped:!complete,utilities,physicalDevice:false,scope:'Actual Room/readiness/WS; legal inputs dispatched through shipped client controls, each confirmed action awaits every released painted seat and visual settlement. Natural server dice; no authority/clock/position override.',instanceId:state.instanceId,result:state.result,clients:Object.fromEntries(Object.keys(frames).map(r=>[r,{readyAcks:q(r).readyAcks.length,presented:q(r).presented,cues:q(r).cues.length,errors:q(r).errors}]))};
  await save('live-play-'+id,result);status.textContent=complete?'PASS: full live match and settled results ('+actions+' actions)':'Stopped after '+actions+' actions';
 }catch(e){if(!live())return;status.textContent='FAIL: '+e.message;await save('live-play-'+id,{pass:false,game:id,actions,error:e.message,physicalDevice:false});}
 finally{if(live()){playing=false;button.textContent='Play remaining turns (live clients)';}}
}
async function checkLifecycle(){
 try{
  await settle();if(q('a').state.phase!=='done')throw Error('Complete the live match first');
  const instance=q('a').state.instanceId,window=q('a').state.w,cues=q('a').cues.length,presented=q('a').presented.length,result=q('a').state.result;
  await q('a').reconnect();await settle();
  if(!q('a').state.audioBaseline||q('a').cues.length!==cues||q('a').presented.length!==presented)throw Error('Reconnect replayed final feedback');
  const host=Object.keys(frames).find(r=>q(r).api.context().isHost);if(!host)throw Error('No current host');click(host,'[data-rematch]');
  await until(()=>Object.keys(frames).every(r=>q(r).state.instanceId!==instance&&painted(r)));await settle();
  const ack=q('a').acks.length;q('a').raw(game.value==='ludo'?{roll:true,rev:0}:{auto:true,rev:0},{i:instance,w:window});await until(()=>q('a').acks.length>ack);await settle();
  if(q('a').state.rev!==0||q('a').state.lastMove!==null)throw Error('Retired action crossed rematch');
  const utilities=await phaseUtilities();
  const report={pass:true,game:game.value,utilities,physicalDevice:false,scope:'Actual Room and shipped-client reconnect/rematch, fixture-dispatched controls.',checks:['Finished owner reconnect is quiet','Current host rematches into production readiness','Every active seat ACKs the new instance; watchers do not','Old instance/window action rejected'],result};await save('lifecycle-'+game.value,report);status.textContent='PASS: quiet reconnect, ready rematch and retired action';
 }catch(e){status.textContent='FAIL: '+e.message;await save('lifecycle-'+game.value,{pass:false,error:e.message,physicalDevice:false});}
}
document.querySelector('#fresh').onclick=fresh;game.onchange=fresh;roles.onchange=show;size.onchange=dimensions;document.querySelector('#reconnect').onclick=()=>frames[roles.value].contentWindow.qa.reconnect();document.querySelector('#bot').onclick=playRemaining;document.querySelector('#lifecycle').onclick=checkLifecycle;
document.querySelector('#geometry').onclick=async()=>{
 const button=document.querySelector('#geometry');button.disabled=true;const issues=[],scenes=[];
 try{
  await settle();
  for(const setting of ['1024,600','390,844','320,640','1280,800','844,390','568,320']){
   size.value=setting;dimensions();await wait(120);
   for(const [role,f]of Object.entries(frames)){
    roles.value=role;show();await wait(60);const d=f.contentDocument,w=f.contentWindow,qa=q(role),root=qa.el,board=root.querySelector('.ld-board,.fl-chart'),r=board?.getBoundingClientRect();
    const requested=setting.split(',').map(Number),shortLandscape=w.innerWidth>w.innerHeight&&w.innerHeight<=500,zoomed=!!root.querySelector('.fl-stage.is-zoomed'),visibleBoard=(zoomed?root.querySelector('.fl-stage'):board)?.getBoundingClientRect(),inside=a=>!!a&&a.left>=-.5&&a.top>=-.5&&a.right<=w.innerWidth+.5&&a.bottom<=w.innerHeight+.5;
    if(d.documentElement.scrollWidth>w.innerWidth+1)issues.push(setting+' '+role+' horizontal overflow');if(!r||r.width<150||r.height<150)issues.push(setting+' '+role+' collapsed board');
    if(w.innerWidth!==requested[0]||w.innerHeight!==requested[1])issues.push(setting+' '+role+' requested viewport differs from actual');if(shortLandscape&&!inside(visibleBoard))issues.push(setting+' '+role+' board/chart viewport outside visible landscape');
    const controls=[];for(const b of root.querySelectorAll('button,summary'))if(b.getClientRects().length){const a=b.getBoundingClientRect(),name=b.textContent.trim()||b.getAttribute('aria-label');controls.push({name,...a.toJSON(),visible:inside(a)});if(a.height<43.5||a.width<43.5)issues.push(setting+' '+role+' target below44px '+name);if(a.left<0||a.right>w.innerWidth+1)issues.push(setting+' '+role+' escaped control '+name);if(shortLandscape&&!inside(a))issues.push(setting+' '+role+' control outside visible landscape '+name);}
    const documentHeight=Math.max(d.documentElement.scrollHeight,d.body.scrollHeight),primary=Array.from(root.querySelectorAll('[data-roll],[data-confirm-ship],[data-auto],[data-ready],[data-fire]')).filter(n=>n.getClientRects().length).map(n=>{const a=n.getBoundingClientRect();return{name:n.textContent.trim(),...a.toJSON(),aboveFold:inside(a),reachable:a.bottom<=documentHeight+1}});
    if(primary.some(a=>!a.reachable))issues.push(setting+' '+role+' unreachable primary action');if(shortLandscape&&primary.some(a=>!a.aboveFold))issues.push(setting+' '+role+' primary action outside visible landscape');
    if(zoomed){const target=root.querySelector('.fl-cell').getBoundingClientRect();if(target.width<43.99||target.height<43.99)issues.push(setting+' '+role+' zoomed chart target below44px');}
    let utilities,report;try{utilities=utilityGeometry(role);report=await reportModal(role);}catch(error){issues.push(setting+' '+role+' '+error.message);d.querySelector('.issue-close')?.click();utilities=qa.utilityDebug;}
    scenes.push({requestedViewport:requested,viewport:[w.innerWidth,w.innerHeight],role,phase:qa.state.phase,shortLandscape,zoomed,fullBoardVisible:inside(r),chartViewportVisible:inside(visibleBoard),documentHeight,verticalOverflow:Math.max(0,documentHeight-w.innerHeight),utilities,report,controls,primary,board:r?.toJSON(),chartViewport:visibleBoard?.toJSON()});
   }
  }
 }catch(error){issues.push(error.message);}finally{button.disabled=false;}
 const result={pass:!issues.length,issues,scenes,game:game.value,physicalDevice:false,scope:'Actual released Room/client browser geometry plus production Report modal. Explicit zoom pans the chart; short-landscape board/chart viewport and all ordinary controls must fit. Not physical-device, actual Room drawer or complete app acceptance.'};await save('geometry-'+game.value,result);status.textContent=result.pass?'PASS: all required viewports, roles and actual Report modal':result.issues.join('\n');
};
setInterval(()=>{const s=frames[roles.value]?.contentWindow.qa?.state;if(s)status.dataset.phase=s.phase;},100);await fresh();
</script></html>`;}
function createServer(){const sessions=new Map();const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/session'){try{const game=u.searchParams.get('game')||'ludo',session=randomUUID(),s=createSession(game);sessions.set(session,s);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({session,game,roles:Object.keys(s.roles)}));}catch(e){res.statusCode=400;res.end(e.message)}return;}
if(u.pathname==='/close'&&req.method==='POST'){const s=sessions.get(u.searchParams.get('session'));s?.room.destroy();sessions.delete(u.searchParams.get('session'));res.end('closed');return;}
if(u.pathname==='/results'&&req.method==='POST'){let text='';req.on('data',d=>text+=d);req.on('end',()=>{try{const name=u.searchParams.get('name');if(!/^[a-z0-9-]+$/.test(name))throw Error('Bad report name');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify(JSON.parse(text),null,2));res.end('saved');}catch(e){res.statusCode=400;res.end(e.message)}});return;}
if(u.pathname==='/'||u.pathname==='/client'){res.setHeader('Content-Type','text/html');res.end(u.pathname==='/client'?clientPage():hubPage());return;}
const file=path.resolve(publicRoot,'.'+u.pathname);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('Not found');return;}res.setHeader('Content-Type',(file.endsWith('.js')||file.endsWith('.mjs'))?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});
const wss=new WebSocketServer({server,path:'/socket'});wss.on('connection',ws=>{let session;ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.t==='join'){session=sessions.get(m.session);if(!session?.roles[m.role])throw Error('Room unavailable');const p=session.roles[m.role];session.room.addPlayer(p.name,ws,p.token);session.room.broadcastLobby();session.room.broadcastState();}else if(session&&m.t==='game-ready'){session.room.onReady(ws,{i:m.i,w:m.w});}else if(session&&m.t==='action'){session.room.onAction(ws,m.a,{i:m.i,w:m.w});ws.send(JSON.stringify({t:'qa-ack',rev:session.room.game.state.rev}));}else if(session&&m.t==='qa-rematch'){const r=session.room.startGame(session.game,{ready:true},session.room.bySocket(ws)?.id);if(!r.ok)throw Error(r.error);}else if(session&&m.t==='qa-autoplay'){throw Error('Play is driven by released, settled live clients.');}}catch(e){ws.send(JSON.stringify({t:'qa-error',message:e.message}));}});ws.on('close',()=>session?.room.disconnect(ws));});server.on('close',()=>{for(const s of sessions.values())s.room.destroy();wss.close()});return server;}
module.exports={createServer,createSession};if(require.main===module)createServer().listen(Number(process.env.LUDO_FLEET_QA_PORT||8393),'127.0.0.1',()=>console.log('Ludo/Fleet QA http://localhost:'+Number(process.env.LUDO_FLEET_QA_PORT||8393)+'/'));
