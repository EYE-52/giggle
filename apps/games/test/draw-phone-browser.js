'use strict';
// Open this fixture in CUA and press Run multiplayer checks. It uses the real
// client modules and real Room/WebSocket routing; no browser driver is needed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { Room } = require('../server/room');
const game = require('../games/draw-phone/server');
const pack = require('../locales/en/draw-phone.json');
const root = path.resolve(__dirname, '../public');
const directory = process.env.DRAW_PHONE_REPORT_DIR || '/tmp/giggle-draw-phone-art-v2-20261007';
function createSession() {
  const room = new Room('DQA', { [game.id]: pack });
  const clock = { time: Date.now(), timers: [] };
  const original = room.ctx.bind(room);
  room.ctx = () => ({ ...original(), now: () => clock.time,
    later(ms, fn) { const t = { at: clock.time + ms, fn }; clock.timers.push(t); return () => { t.dead = true; }; } });
  const bot = () => ({ readyState: 1, bufferedAmount: 0, send() {}, close() {} });
  const seats = ['Ada', 'Bo', 'Cam'].map(name => room.addPlayer(name, bot()).player);
  room.startGame(game, { ready: true, settings: { writeSeconds: 30, drawSeconds: 90, guessSeconds: 30 } }, seats[0].id);
  const watcher = room.addPlayer('Watcher', bot()).player;
  return { room, clock, roles: { first: seats[0], second: seats[1], third: seats[2], watcher } };
}
function reportMarkup() {
  const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const definition = source.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)?.[0];
  if (!definition) throw Error('Production Report button declaration is unavailable.');
  return vm.runInNewContext(definition + "\nreportButton('game-report-icon')", {}, { timeout: 1000 });
}
function clientPage() { return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Draw Phone live client</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/issues.css"><style>body{margin:0;padding:0}#client-bar{display:flex;gap:10px;align-items:center;padding:8px 14px;background:#eef0f4;color:#252a31;font-size:14px}#client-bar button{font:inherit;min-height:44px}#client-status{overflow-wrap:anywhere}#client-bar[hidden]{display:none}</style><body class="game-playing"><div id="client-bar"><b id="client-name">Connecting</b><button id="reconnect">Reconnect</button><span id="client-status"></span></div><main class="app"><header class="play-toolbar"><div class="play-title"><div><h1>Draw Phone</h1></div></div><details class="room-menu" id="roomMenu"><summary aria-label="Room controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg><span>Room</span></summary><button type="button" class="room-menu-scrim" id="bRoomScrim" tabindex="-1" aria-label="Close room menu"></button><div class="room-menu-panel" role="dialog" aria-modal="true" aria-labelledby="roomMenuTitle"><div class="room-menu-head"><span class="room-menu-kicker">ROOM QA</span><button type="button" class="room-close" id="bRoomClose" aria-label="Close room menu">×</button></div><h2 id="roomMenuTitle">Draw Phone</h2><p>Real Room and independent WebSocket client.</p><button type="button" class="room-resume" id="bRoomResume">Back to game<span aria-hidden="true">▶</span></button></div></details>${reportMarkup()}</header><main class="game-stage" aria-label="Draw Phone"><div class="game-clock"><div class="timerbar" id="tbar" hidden><div></div></div><div class="timertext" id="ttime" hidden></div></div><div id="gbody" data-layout="standard"></div></main></main><script type="module">
import {show,reset} from '/js/game-host.js';
import {createServerClock} from '/js/server-clock.js';
import {openIssueReport} from '/js/report-issue.js';
const params=new URLSearchParams(location.search),el=document.querySelector('#gbody'),role=params.get('role')||'first',session=params.get('session'),sent=[],readyAcks=[],cues=[],presented=[],errors=[],acks=new Map(),clock=createServerClock();
let socket,S=null,rendered=null,active=true,host=null,sequence=0,readyResolve,screenChanges=0;
document.addEventListener('game-screenchange',()=>screenChanges++);
const ready=new Promise(r=>readyResolve=r);
// Authority time remains manually controlled for the existing deadline races.
function sendAction(a,meta={},wait=false){
 if(!active||socket?.readyState!==1)return wait?Promise.reject(Error('Client disconnected')):false;
 const qaId=++sequence;let result=true;
 if(wait)result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{acks.delete(qaId);reject(Error('Action acknowledgement timed out'))},4000);acks.set(qaId,{resolve,reject,timer})});
 socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w,qaId,...meta}));return result;
}
const api={context:()=>({isHost:(host||S?.hostId)===S?.me}),send:a=>{sent.push(a);return sendAction(a)},now:()=>S?.preparing?S.gameNow:clock.now()-(S?.clockOffset||0),focus:n=>n?.focus({preventScroll:true}),announce(){},toast(){},cue:(name,options)=>cues.push({name,...options}),resultsReady:id=>presented.push(id),ready:({instanceId,window})=>{if(!active||socket?.readyState!==1||!S?.preparing||S.instanceId!==instanceId||S.w!==window||S.spectator)return false;readyAcks.push({instanceId,window});socket.send(JSON.stringify({t:'game-ready',i:instanceId,w:window}));return true},loadError:e=>{errors.push(e.error);document.querySelector('#client-status').textContent=e.error;document.querySelector('#client-bar').hidden=false}};
// Mirror the framework clock, including its preparation freeze.
function updateClock(){if(!S)return;const n=document.getElementById('ttime');n.hidden=!!S.preparing||!S.endsAt||S.phase==='reveal'||S.phase==='done';document.getElementById('tbar').hidden=n.hidden;if(!n.hidden){const seconds=Math.max(0,Math.ceil((S.endsAt-api.now())/1000));n.textContent=seconds>0?seconds+'s left':'Time’s up'}}
const fixtureClock=setInterval(updateClock,250);window.addEventListener('pagehide',()=>clearInterval(fixtureClock),{once:true});
async function paint(snapshot){
 const view=await show(el,'draw-phone',snapshot,api);if(!view||!active||S!==snapshot)return;
 rendered=snapshot;const note=document.querySelector('.specbanner');if(snapshot.spectator&&!note){const n=document.createElement('div');n.className='specbanner';n.setAttribute('role','status');n.textContent='You joined mid-game — you are spectating. You join the next game automatically.';document.querySelector('.game-stage').prepend(n)}else if(!snapshot.spectator)note?.remove();
 updateClock();
 if(!snapshot.preparing)readyResolve();return view;
}
function connect(){active=true;clock.reset();let baseline=true;return new Promise((resolve,reject)=>{
 const peer=socket=new WebSocket('ws://'+location.host+'/socket');peer.onopen=()=>peer.send(JSON.stringify({t:'join',session,role}));peer.onerror=reject;
 peer.onmessage=async e=>{if(peer!==socket||!active)return;const m=JSON.parse(e.data);
  if(m.t==='room'){host=m.room.hostId;if(S)await paint(S)}
  if(m.t==='state'){clock.observe(m.serverNow);const snapshot=S={...m,me:m.you,audioBaseline:baseline};baseline=false;await paint(snapshot);if(rendered===snapshot&&!snapshot.preparing)resolve()}
  if(m.t==='qa-ack'){const ack=acks.get(m.qaId);if(ack){clearTimeout(ack.timer);acks.delete(m.qaId);ack.resolve(m)}}
  if(m.t==='qa-error'){errors.push(m.message);document.querySelector('#client-status').textContent=m.message;document.querySelector('#client-bar').hidden=false;}
 };
 peer.onclose=()=>{if(peer===socket&&active)document.querySelector('#client-status').textContent='Disconnected'};
})}
window.qa={ready,sent,readyAcks,get screenChanges(){return screenChanges},cues,presented,errors,el,api,get state(){return S},get rendered(){return rendered},get socket(){return socket},async reconnect(){active=false;rendered=null;reset();const retired=socket;if(retired.readyState!==3){const closed=new Promise(r=>retired.addEventListener('close',r,{once:true}));retired.close();await closed;}document.querySelector('#client-status').textContent='';await connect();},dispose(){active=false;rendered=null;reset()},async render(s){S=s;await paint(s)},raw(a,meta={}){return sendAction(a,meta,true)},command(t){socket.send(JSON.stringify({t,i:S.instanceId,w:S.w}));}};
window.addEventListener('pagehide',()=>{window.qa.dispose();socket?.close()},{once:true});
document.querySelector('#client-name').textContent=role;document.querySelector('#reconnect').onclick=()=>window.qa.reconnect();
if(params.get('scene')==='1')document.querySelector('#client-bar').hidden=true;
const roomMenu=document.querySelector('#roomMenu');roomMenu.addEventListener('toggle',()=>{if(roomMenu.open)document.querySelector('#bRoomResume').focus({preventScroll:true})});for(const id of ['bRoomResume','bRoomClose','bRoomScrim'])document.getElementById(id).onclick=()=>{roomMenu.open=false;roomMenu.querySelector('summary').focus({preventScroll:true})};
document.addEventListener('click',event=>{const opener=event.target.closest('[data-report]');if(!opener)return;roomMenu.open=false;openIssueReport({games:[{id:'draw-phone',name:'Draw Phone'}],game:'draw-phone',phase:S?.phase||'',theme:document.documentElement.dataset.theme||'day',embedded:false},opener);});
await connect();
</script></html>`; }
function hubPage() { return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Draw Phone multiplayer QA</title><style>body{font:16px/1.4 system-ui;margin:16px;background:#eef0f4;color:#252a31}button,select{font:inherit;min-height:44px;padding:8px 12px}#tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}#clients{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}article h2{font-size:16px;margin:0 0 4px}iframe{display:block;border:1px solid #c6cbd3;background:white}#status{white-space:pre-wrap;font-size:15px}a{color:#1646aa}</style><p>QA fixture: real Room/WebSocket clients and production standard Room/clock shell. Authority timers are paused for repeatable checks. The framework-style clock uses wall time, so 0s alone does not advance this fixture. Fixture deadline advances the authority. Native input proof is separate from the synthetic input/race matrix.</p><div id="tools"><button id="run">Run multiplayer checks</button><button id="new">Fresh writing room</button><button id="draw">Fresh drawing scene</button><button id="caption">Fresh caption scene</button><button id="reveal">Fresh reveal scene</button><button id="deadline">Fixture deadline</button><select id="shape" aria-label="Client viewport"><option value="1280,800">Desktop 1280 × 800</option><option value="1024,600">Laptop 1024 × 600</option><option value="640,740">Narrow desktop 640 × 740</option><option value="760,650">Intermediate desktop 760 × 650</option><option value="390,844">Phone portrait 390 × 844</option><option value="320,640">Small phone 320 × 640</option><option value="844,390">Phone landscape 844 × 390</option><option value="568,320">Compact landscape 568 × 320</option></select><span id="links"></span></div><p id="status" role="status">Connecting…</p><div id="clients"></div><script type="module">
const roles=['first','second','third','watcher'],active=['first','second','third'],frames={};let session;
const shape=document.querySelector('#shape'),status=document.querySelector('#status'),clients=document.querySelector('#clients');
const pause=ms=>new Promise(r=>setTimeout(r,ms));function assert(ok,message){if(!ok)throw Error(message)}
async function until(fn,message){for(let n=0;n<120;n++){if(usable()&&fn())return;await pause(30)}throw Error(message)}
function client(role){return frames[role].contentWindow.qa}
function usable(){return roles.every(r=>{const qa=frames[r]?.contentWindow.qa;return !!qa?.state&&qa.rendered===qa.state&&!qa.state.preparing})}function node(role,selector){return client(role).el.querySelector(selector)}
async function click(role,selector){await until(()=>true,role+' ready for UI action');const n=node(role,selector);assert(n&&!n.disabled,role+' missing '+selector);n.click()}
async function enter(role,selector,text){await until(()=>true,role+' ready to enter text');node(role,selector).value=text;await click(role,'#pSend')}
async function fresh(){if(session)await fetch('/close?session='+session,{method:'POST'});session=(await(await fetch('/session')).json()).session;clients.innerHTML='';const[w,h]=shape.value.split(',').map(Number);for(const role of roles){const article=document.createElement('article'),title=document.createElement('h2'),frame=document.createElement('iframe');title.textContent=role;frame.title=role+' Draw Phone client';frame.width=w;frame.height=h;frame.src='/client?session='+session+'&role='+role+'&scene=1';article.append(title,frame);clients.append(article);frames[role]=frame}await until(()=>roles.every(r=>frames[r].contentWindow.qa),'module boot');await Promise.all(roles.map(r=>client(r).ready));await until(()=>true,'Every client painted authoritative readiness release');assert(roles.filter(r=>!client(r).state.spectator).every(r=>client(r).readyAcks.length),'Active clients did not ACK production readiness');assert(!client('watcher').readyAcks.length,'Watcher entered the initial ready quorum');document.querySelector('#links').innerHTML='<a href="/client?session='+session+'&role=first&scene=1" target="_blank">Open first player</a> · <a href="/client?session='+session+'&role=watcher&scene=1" target="_blank">Open watcher</a>';status.textContent='Ready · authority timers paused';return{w,h}}
function point(role,type,id,x=.2,y=.35,target){const cv=node(role,'canvas'),r=cv.getBoundingClientRect(),win=frames[role].contentWindow;(target||cv).dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',button:0,buttons:type==='pointerup'?0:1,clientX:r.left+r.width*x,clientY:r.top+r.height*y}))}
function line(role,y=.5,id=1){point(role,'pointerdown',id,.2,y);point(role,'pointermove',id,.8,y,frames[role].contentWindow);point(role,'pointerup',id,.8,y,frames[role].contentWindow)}
function strokeCount(role){return(client(role).state.myStrokes||[]).length}function sends(role){return client(role).sent.filter(a=>a.stroke).length}
function pixel(role,x=.5,y=.5){return[...node(role,'canvas').getContext('2d').getImageData(x*880,y*520,1,1).data]}
async function toDraw(){await Promise.all(active.map((r,i)=>enter(r,'#pPhrase',['A cat wearing a tiny hat','A penguin opening a bakery','An otter making waffles'][i])));await until(()=>roles.every(r=>client(r).state.phase==='draw'),'write to draw')}
async function toCaption(){active.forEach((r,i)=>line(r,.35+i*.1,i+1));await until(()=>active.every(r=>strokeCount(r)===1),'private committed drawing');client('first').command('qa-expire');await until(()=>roles.every(r=>client(r).state.phase==='guess'),'drawing deadline to caption')}
async function toReveal(){await Promise.all(active.map((r,i)=>enter(r,'#pGuess',['A cat in a party hat','A bird baking bread','A chef by the river'][i])));await until(()=>roles.every(r=>client(r).state.phase==='reveal'),'caption to reveal')}
// Wait for the real ResizeObserver/fit and any CSS movement to settle, rather
// than taking a layout sample during the first asynchronous canvas resize.
async function settleGeometry(role){
 const win=frames[role].contentWindow;let previous,stable=0;
 for(let n=0;n<120;n++){
  await new Promise(resolve=>win.requestAnimationFrame(resolve));
  const nodes=[...client(role).el.querySelectorAll('.dp,.dp-prompt,.sk-canvaswrap,canvas,button,input')].filter(n=>n.getClientRects().length);
  const sample=nodes.flatMap(n=>{const b=n.getBoundingClientRect();return[b.left,b.top,b.width,b.height]});
  stable=previous?.length===sample.length&&sample.every((v,i)=>Math.abs(v-previous[i])<.1)?stable+1:0;
  if(stable>=3)return;previous=sample;
 }
 throw Error(role+' canvas/tool layout did not settle');
}
function separate(a,b){return a.right<=b.left+.5||a.left>=b.right-.5||a.bottom<=b.top+.5||a.top>=b.bottom-.5}
function utilityGeometry(role){
 const qa=client(role),win=frames[role].contentWindow,doc=win.document,report=doc.querySelector('.game-report-icon'),roomNode=doc.querySelector('.room-menu>summary');
 const visible=n=>n&&n.getClientRects().length&&win.getComputedStyle(n).visibility!=='hidden'&&win.getComputedStyle(n).display!=='none';
 const reportBox=report?.getBoundingClientRect(),room=roomNode?.getBoundingClientRect();
 const separate=(a,b)=>a.right<=b.left+.5||a.left>=b.right-.5||a.bottom<=b.top+.5||a.top>=b.bottom-.5;
 qa.utilityDebug={phase:qa.state.phase,report:reportBox?.toJSON(),room:room?.toJSON(),regions:[]};
 for(const [name,n,b] of [['Report',report,reportBox],['Room',roomNode,room]]){
  assert(visible(n),role+' '+name+' is hidden in '+qa.state.phase);
  assert(b.width>=43.5&&b.height>=43.5,role+' '+name+' target below44px');
  assert(b.left>=-.5&&b.right<=win.innerWidth+.5&&b.top>=-.5&&b.bottom<=win.innerHeight+.5,role+' '+name+' outside visible viewport');
  const target=doc.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
  assert(target&&(target===n||n.contains(target)),role+' '+name+' is covered by '+(target?.className||target?.tagName));
 }
 assert(separate(reportBox,room),role+' Report intersects Room');
 const regions=qa.utilityDebug.regions;
 for(const n of doc.querySelectorAll('#ttime,.dg-round,.dg-word,.dg-clock,.dg-artist,.dg-view-actions button,.dg-pick h3,.dg-wait h3,.dg-done h3,.dp-identity,.sk-steps,.dp-prompt,.dp-caption-heading,.dp-story-heading,.dp-writing h3,.dp-finished h3,.dp-view-controls button')){
  if(!visible(n))continue;
  const boxes=n.matches('button,#ttime,.dg-clock,.dp-prompt')?[n.getBoundingClientRect()]:(()=>{const range=doc.createRange();range.selectNodeContents(n);return [...range.getClientRects()]})();
  for(const box of boxes){if(!box.width||!box.height)continue;assert(separate(reportBox,box),role+' Report intersects '+(n.id||n.className||n.tagName)+' in '+qa.state.phase);assert(separate(room,box),role+' Room intersects '+(n.id||n.className||n.tagName)+' in '+qa.state.phase);regions.push({name:n.id||n.className||n.tagName,...box.toJSON()});}
 }
 return{phase:qa.state.phase,viewport:{width:win.innerWidth,height:win.innerHeight},report:reportBox.toJSON(),room:room.toJSON(),regions};
}
async function reportModal(role){
 const qa=client(role),win=frames[role].contentWindow,doc=win.document,opener=doc.querySelector('.game-report-icon'),before=qa.screenChanges;
 await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
 utilityGeometry(role);opener.focus({preventScroll:true});opener.click();
 const dialog=doc.querySelector('dialog.issue-dialog[open]');
 assert(dialog&&doc.activeElement===dialog.querySelector('.issue-close'),role+' actual report did not open with safe initial focus');
 assert(qa.screenChanges===before+1,role+' report opening did not dispatch input release');
 const b=dialog.getBoundingClientRect();assert(b.left>=-.5&&b.right<=win.innerWidth+.5&&b.top>=-.5&&b.bottom<=win.innerHeight+.5,role+' report dialog outside viewport');
 const sent=qa.sent.length;let leaked=0;const listener=()=>leaked++;win.addEventListener('keydown',listener);
 dialog.querySelector('.issue-close').dispatchEvent(new win.KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}));
 win.removeEventListener('keydown',listener);
 assert(leaked===0&&qa.sent.length===sent,role+' report keyboard escaped into game input');
 dialog.querySelector('.issue-close').click();
 assert(!doc.querySelector('dialog[open]')&&doc.activeElement===opener,role+' report close did not restore its opener');
 assert(qa.screenChanges===before+2,role+' report close did not refresh input lifecycle');
 utilityGeometry(role);return{phase:qa.state.phase,dialog:b.toJSON(),releaseEvents:qa.screenChanges-before};
}
async function geometry(role){
 await settleGeometry(role);
 const qa=client(role),el=qa.el,win=frames[role].contentWindow,doc=win.document,bounds=el.getBoundingClientRect(),room=doc.querySelector('.room-menu>summary').getBoundingClientRect(),cv=node(role,'canvas'),controls=[],drawing=qa.state.phase==='draw',caption=qa.state.phase==='guess'&&win.innerWidth>win.innerHeight&&win.innerHeight<=500,bounded=drawing||caption,clock=doc.querySelector('#ttime');
 const utilities=utilityGeometry(role),report=doc.querySelector('.game-report-icon').getBoundingClientRect();
 const clockBox=clock.hidden?null:clock.getBoundingClientRect(),h=Math.max(doc.documentElement.scrollHeight,doc.body.scrollHeight);
 qa.geometryDebug={phase:qa.state.phase,scene:el.querySelector('.dp')?.className,viewport:{width:win.innerWidth,height:win.innerHeight},document:{width:doc.documentElement.scrollWidth,height:h},room:room.toJSON(),clock:clock.hidden?null:{text:clock.textContent,...clockBox.toJSON()},clockShell:{...doc.querySelector('.game-clock').getBoundingClientRect().toJSON(),padding:win.getComputedStyle(doc.querySelector('.game-clock')).padding},paper:cv?.parentElement.getBoundingClientRect().toJSON(),regions:[...el.querySelectorAll('.dp-identity,.sk-steps,.dp-prompt')].filter(n=>n.getClientRects().length).map(n=>({name:n.className,...n.getBoundingClientRect().toJSON()})),controls:[...el.querySelectorAll('button,input,summary')].filter(n=>n.getClientRects().length).map(n=>({id:n.id||n.getAttribute('aria-label')||n.textContent,...n.getBoundingClientRect().toJSON()}))};
 assert(doc.documentElement.scrollWidth<=win.innerWidth+2,role+' horizontal overflow');
 assert(room.width>=43&&room.height>=43,role+' small Room');
 if(bounded){assert(h<=win.innerHeight+2,role+' '+qa.state.phase+' document scrolls below viewport: '+h+' > '+win.innerHeight);assert(room.top>=-.5&&room.bottom<=win.innerHeight+.5,role+' Room outside bounded scene');if(clockBox)assert(clockBox.top>=-.5&&clockBox.bottom<=win.innerHeight+.5&&clockBox.height>=43,role+' clock outside bounded scene')}
 for(const n of el.querySelectorAll('button,input,summary')){
  if(n.closest('.sk-sugg')&&win.getComputedStyle(n.parentElement).overflowX==='auto')continue;
  if(!n.getClientRects().length||n.closest('details:not([open])')&&!n.matches('summary'))continue;
  const b=n.getBoundingClientRect(),id=n.id||n.getAttribute('aria-label')||n.textContent;
  assert(b.width>=43&&b.height>=43,role+' small control '+id);
  assert(b.left>=bounds.left-2&&b.right<=bounds.right+2,role+' control outside scene');
  if(bounded){
   assert(separate(b,report),role+' '+qa.state.phase+' control overlaps Report '+id);
   assert(b.top>=-.5&&b.bottom<=win.innerHeight+.5,role+' '+qa.state.phase+' control below viewport '+id+': '+b.bottom);
   assert(separate(b,room)&&(!clockBox||separate(b,clockBox)),role+' '+qa.state.phase+' control overlaps Room/clock '+id);
  }
  if(n.matches('input[type="text"]'))assert(parseFloat(win.getComputedStyle(n).fontSize)>=16,role+' tiny input');
  controls.push({id,width:b.width,height:b.height,top:b.top,bottom:b.bottom,left:b.left,right:b.right});
 }
 for(const n of el.querySelectorAll('.dp-identity,.sk-steps,.dp-prompt,.dp-caption-heading')){
  if(!n.getClientRects().length)continue;
  const b=n.getBoundingClientRect();assert(separate(b,room),role+' Room overlaps '+n.className);
  if(bounded&&clockBox)assert(separate(b,clockBox),role+' clock overlaps '+n.className);
 }
 let canvas,paper;
 if(cv){
  const b=cv.getBoundingClientRect(),view=cv.parentElement.getBoundingClientRect();
  assert(Math.abs(b.width/b.height-880/520)<.015,role+' distorted canvas');
  assert(view.height>=160,role+' unusable canvas viewport: '+view.height);
  if(bounded){
   assert(view.top>=-.5&&view.bottom<=win.innerHeight+.5&&view.left>=-.5&&view.right<=win.innerWidth+.5,role+' paper viewport is outside visible screen');
   for(const n of el.querySelectorAll('.dp-tools button,.dp-zoom button,.dp-caption-strip input,.dp-caption-strip button'))if(n.getClientRects().length)assert(separate(view,n.getBoundingClientRect()),role+' tools/composer overlap the paper viewport');
   if(node(role,'#pZoomValue')?.textContent==='100%')assert(b.left>=view.left-.5&&b.right<=view.right+.5&&b.top>=view.top-.5&&b.bottom<=view.bottom+.5,role+' fitted paper leaves its viewport');
  }else if(win.innerWidth<=700)assert(Math.abs(b.height-view.height)<3,role+' phone paper has unused vertical bands');
  assert(win.getComputedStyle(cv).touchAction===(drawing&&role!=='watcher'?'none':'pan-y'),role+' wrong canvas input mode');
  canvas={width:b.width,height:b.height,top:b.top,bottom:b.bottom};paper={...view.toJSON()};
 }
 const pagination=[];
 if(qa.state.phase==='reveal')for(const n of el.querySelectorAll('.dp-page-actions button')){n.scrollIntoView({block:'center'});await settleGeometry(role);const b=n.getBoundingClientRect();assert(b.top>=-.5&&b.bottom<=win.innerHeight+.5&&separate(b,room)&&separate(b,report),role+' story pagination unreachable or overlaps Room/Report');pagination.push({id:n.id,...b.toJSON()})}
 return{utilities,phase:qa.state.phase,bounded,viewport:{width:win.innerWidth,height:win.innerHeight},document:{width:doc.documentElement.scrollWidth,height:h},canvas,paper,controls,pagination,clock:clock.hidden?null:{text:clock.textContent,...clockBox.toJSON()}};
}
async function check(){const{w,h}=await fresh(),result={viewport:{width:w,height:h},checks:[],geometry:{}};const pass=m=>result.checks.push(m);result.utilities={write:Object.fromEntries(roles.map(r=>[r,utilityGeometry(r)]))};result.reports={write:await reportModal('first')};result.geometry.write=await geometry('first');const phrase=node('first','#pPhrase');phrase.value='A private phrase revised';phrase.focus();await enter('first','#pPhrase','A private phrase revised');await until(()=>client('first').state.myPhrase==='A private phrase revised','saved phrase');phrase.value='A secret second draft';await enter('second','#pPhrase','A second private phrase');await until(()=>client('first').state.submitted.length===2,'second write');assert(node('first','#pPhrase')===phrase&&phrase.value==='A secret second draft'&&frames.first.contentDocument.activeElement===phrase,'write snapshot lost draft/focus');assert(!client('watcher').state.myPhrase&&!node('watcher','#pSend'),'watcher private phrase/action leak');await enter('first','#pPhrase','A secret second draft');await until(()=>client('first').state.myPhrase==='A secret second draft','write edit');pass('Private phrases can be saved/edited; snapshots preserve keyboard draft');await enter('third','#pPhrase','A third private phrase');await until(()=>roles.every(r=>client(r).state.phase==='draw'),'draw opens');result.geometry.draw=await geometry('first');result.geometry.drawWatcher=await geometry('watcher');result.utilities.draw=Object.fromEntries(roles.map(r=>[r,utilityGeometry(r)]));assert(!node('watcher','#pPen')&&!node('watcher','#pClear')&&!client('watcher').state.myPrompt&&!client('watcher').state.myStrokes.length,'watcher sees private drawing/tools');for(const r of active)assert(!('myPhrase' in client(r).state)&&client(r).state.myPrompt,'assigned prompt missing or old phrase leaks');pass('Private drawing desk and watcher paper stay within the viewport; all tools are 44px');const mounted=node('first','canvas'),beforeFocus=client('first').sent.length;await click('first','#pFocus');result.geometry.focus=await geometry('first');result.reports.focus=await reportModal('first');assert(node('first','canvas')===mounted,'focus rebuilt drawing canvas');await click('first','#pTools');result.geometry.focusToolsVisible=await geometry('first');assert(node('first','canvas')===mounted&&client('first').sent.length===beforeFocus,'focus/tools changed authority');await click('first','#pFocus');assert(node('first','canvas')===mounted,'exit focus rebuilt canvas');pass('Same live page focuses, collapses tools and exits without authority actions');
 // Writing/story pages may scroll; drawing and short-landscape caption desks stay visible. Local zoom/pan must not create authority
 // actions, stretch the bitmap, or change canonical replay coordinates.
 const fitRect=node('first','canvas').getBoundingClientRect(),viewActions=client('first').sent.length;
 await click('first','#pZoomIn');await click('first','#pZoomIn');
 const enlarged=node('first','canvas').getBoundingClientRect();assert(Math.abs(enlarged.width/fitRect.width-2)<.02&&Math.abs(enlarged.width/enlarged.height-880/520)<.015,'zoom stretches canonical canvas');
 await click('first','#pPan');point('first','pointerdown',91,.4,.4);point('first','pointermove',91,.5,.5,frames.first.contentWindow);point('first','pointerup',91,.5,.5,frames.first.contentWindow);assert(client('first').sent.length===viewActions,'pan transmitted private ink');
 await click('first','#pPan');point('first','pointerdown',92,.35,.5);point('first','pointermove',92,.65,.5,frames.first.contentWindow);point('first','pointerup',92,.65,.5,frames.first.contentWindow);await until(()=>strokeCount('first')===1,'zoomed private ink');assert(pixel('first').slice(0,3).every(c=>c<100)&&strokeCount('second')===0,'zoomed canonical replay/privacy differs');
 await client('first').reconnect();assert(pixel('first').slice(0,3).every(c=>c<100),'zoomed gesture reconnect replay differs');await click('first','#pUndo');await until(()=>strokeCount('first')===0,'zoomed gesture undo');await click('first','#pFit');pass('Uniform zoom and private pan retain canonical ink through reconnect');

 const room=frames.first.contentDocument.querySelector('#roomMenu');room.querySelector('summary').click();await until(()=>room.open,'Room open');line('second',.3,20);await until(()=>strokeCount('second')===1,'other draws');assert(frames.first.contentDocument.activeElement.id==='bRoomResume','snapshot stole Room focus');frames.first.contentDocument.querySelector('#bRoomResume').click();pass('Room dialog focus survives another player snapshot');
 await click('first','[data-c="#1d4ed8"]');await click('first','[data-size="16"]');line('first');await until(()=>strokeCount('first')===1,'blue ink');assert(client('first').state.myStrokes[0].color==='#1d4ed8'&&client('first').state.myStrokes[0].size===16,'brush/color contract');assert(strokeCount('second')===1&&strokeCount('watcher')===0,'private ink broadcast to someone else');await click('first','#pEraser');point('first','pointerdown',2,.35,.5);point('first','pointermove',2,.65,.5,frames.first.contentWindow);point('first','pointerup',2,.65,.5,frames.first.contentWindow);await until(()=>strokeCount('first')===2,'white erase');assert(pixel('first').slice(0,3).every(c=>c===255),'eraser replay differs');await click('first','#pPen');line('first',.6,3);await until(()=>strokeCount('first')===3,'pen restored');assert(client('first').state.myStrokes.at(-1).color==='#1d4ed8','pen did not restore previous ink');pass('Physical palette, brush and eraser use original deterministic stroke replay');
 const reportHeld=sends('first');point('first','pointerdown',711,.15,.65);point('first','pointermove',711,.65,.65,frames.first.contentWindow);result.reports.draw=await reportModal('first');assert(sends('first')===reportHeld+1,'Report opening did not finish held private ink once');point('first','pointerup',711,.65,.65,frames.first.contentWindow);assert(sends('first')===reportHeld+1,'Lift after Report duplicated private ink');await until(()=>strokeCount('first')===4,'Report releases private ink to authority');
 const before=sends('first');point('first','pointerdown',4,.2,.7);point('first','pointermove',4,.7,.7,frames.first.contentWindow);await click('first','#pClear');point('first','pointerup',4,.7,.7,frames.first.contentWindow);await until(()=>strokeCount('first')===0,'held clear');assert(sends('first')===before,'clear submitted cancelled gesture');pass('Clear cancels held input and clears private authority drawing');
 const start=sends('first');point('first','pointerdown',5,.1,.5);for(let n=1;n<=230;n++)point('first','pointermove',5,.1+n/230*.7,.5,frames.first.contentWindow);point('first','pointerup',5,.8,.5,frames.first.contentWindow);await until(()=>strokeCount('first')===2,'chunk drawing');assert(sends('first')===start+2,'long gesture chunks differ');const oldChunks=client('first').sent.filter(a=>a.stroke).slice(start);assert(oldChunks[0].gestureId===oldChunks[1].gestureId,'chunk gesture identity');await click('first','#pUndo');await until(()=>strokeCount('first')===0,'whole gesture undo');await client('first').raw(oldChunks[1]);await until(()=>true,'Undone private chunk rejected');assert(strokeCount('first')===0,'queued chunk restores Undo');point('first','pointerdown',51,.1,.5);for(let n=1;n<=230;n++)point('first','pointermove',51,.1+n/230*.7,.5,frames.first.contentWindow);point('first','pointerup',51,.8,.5,frames.first.contentWindow);await until(()=>strokeCount('first')===2,'redrawn gesture');await client('first').reconnect();assert(strokeCount('first')===2&&pixel('first')[3]>0,'reconnect lost drawing');pass('230-point gesture undoes once, rejects delayed chunks and restores privately after reconnect');
 const cv=node('first','canvas');point('first','pointerdown',6,.2,.6);point('first','pointermove',6,.6,.6,frames.first.contentWindow);point('first','pointerdown',7,.8,.8);point('first','pointerup',7,.8,.8,frames.first.contentWindow);const beforeCancel=sends('first');point('first','pointercancel',6,.6,.6,frames.first.contentWindow);point('first','pointerup',6,.6,.6,frames.first.contentWindow);cv.dispatchEvent(new Event('lostpointercapture'));assert(sends('first')===beforeCancel+1,'cancel/lift duplicated');await until(()=>strokeCount('first')===3,'cancel stroke');const beforeDispose=sends('first');point('first','pointerdown',8,.2,.8);point('first','pointermove',8,.7,.8,frames.first.contentWindow);client('first').dispose();point('first','pointerup',8,.7,.8,frames.first.contentWindow);assert(sends('first')===beforeDispose,'dispose submitted stale input');await client('first').reconnect();pass('Second contact ignored; cancel once; dispose retires stale input');
 line('third',.7,9);await until(()=>strokeCount('third')===1,'third draws');client('first').command('qa-expire');await until(()=>roles.every(r=>client(r).state.phase==='guess'),'caption phase');result.geometry.caption=await geometry('first');result.geometry.captionWatcher=await geometry('watcher');result.utilities.caption=Object.fromEntries(roles.map(r=>[r,utilityGeometry(r)]));result.reports.caption=await reportModal('first');assert(!node('first','#pPen')&&!('myPrompt' in client('first').state)&&!client('watcher').state.myDrawing.length&&!node('watcher','#pSend'),'caption privacy/tools leak');const guess=node('first','#pGuess');guess.value='A caption saved';guess.focus();await click('first','#pSend');await until(()=>client('first').state.myGuess==='A caption saved','caption save');guess.value='A caption edited';await enter('second','#pGuess','A second caption');await until(()=>client('first').state.guessed.length===2,'other caption');assert(node('first','#pGuess')===guess&&guess.value==='A caption edited'&&frames.first.contentDocument.activeElement===guess,'caption snapshot lost keyboard');await click('first','#pSend');await until(()=>client('first').state.myGuess==='A caption edited','caption edit');result.geometry.captionSaved=await geometry('first');assert(client('watcher').state.myGuess==='','watcher caption leak');pass('Assigned drawings only; caption edits preserve focused draft and keyboard, with visible landscape paper/composer');
 await enter('third','#pGuess','A third caption');await until(()=>roles.every(r=>client(r).state.phase==='reveal'),'reveal');result.geometry.reveal=await geometry('first');result.utilities.reveal=Object.fromEntries(roles.map(r=>[r,utilityGeometry(r)]));result.reports.reveal=await reportModal('watcher');assert(client('watcher').state.chains.length===3&&client('watcher').state.chains.some(c=>c.phrase==='A secret second draft'),'completed chains not public');const host=active.find(r=>client(r).state.me===client(r).state.hostId),nonhost=active.find(r=>r!==host);assert(host&&node(host,'#pNext')&&!node(nonhost,'#pNext'),'current host paging gate');node(host,'#pNext').focus();await click(host,'#pNext');await until(()=>client(host).state.revealIdx===1,'next story');assert(frames[host].contentDocument.activeElement===node(host,'#pNext'),'next story lost keyboard continuity');await click(host,'#pPrev');await until(()=>client(host).state.revealIdx===0,'previous story');pass('Reveal follows the current elected host after reconnect, with forward/back keyboard continuity');
 await client(nonhost).raw({next:true});await until(()=>true,'Nonhost story paging rejected');assert(client(host).state.revealIdx===0,'nonhost pages');for(let n=1;n<=3;n++){await click(host,'#pNext');await until(()=>n===3?client(host).state.phase==='done':client(host).state.revealIdx===n,'finish story '+n)}assert(node('first','.dp-finished')&&!node('first','canvas'),'done still has active canvas');pass('Nonhost paging rejected; all stories complete once');result.utilities.done=Object.fromEntries(roles.map(r=>[r,utilityGeometry(r)]));result.reports.done=await reportModal('first');const old=client('first').state;client('first').command('qa-rematch');await until(()=>roles.every(r=>client(r).state.instanceId!==old.instanceId),'rematch');assert(roles.every(r=>client(r).state.phase==='write')&&!client('first').state.myPhrase,'rematch retained phrase');await client('first').raw({phrase:'stale old phrase'},{i:old.instanceId,w:old.w});await until(()=>true,'Old instance phrase rejected');assert(!client('first').state.myPhrase,'stale instance wrote new phrase');pass('Rematch clears private pages and rejects stale instance');result.utilities.rematch=Object.fromEntries(roles.map(r=>[r,utilityGeometry(r)]));pass('Production Report stays visible and separate through every phase; actual dialog releases held ink, isolates keyboard and restores focus');result.pass=true;return result}
async function scene(target){await fresh();if(target!=='write')await toDraw();if(target==='guess'||target==='reveal')await toCaption();if(target==='reveal')await toReveal();status.textContent='Ready · '+target+' scene · timers paused'}
document.querySelector('#new').onclick=()=>scene('write');document.querySelector('#draw').onclick=()=>scene('draw');document.querySelector('#caption').onclick=()=>scene('guess');document.querySelector('#reveal').onclick=()=>scene('reveal');document.querySelector('#deadline').onclick=()=>client('first').command('qa-expire');shape.onchange=()=>scene('write');document.querySelector('#run').onclick=async()=>{const run=document.querySelector('#run');run.disabled=true;const results=[];for(const value of ['1280,800','1024,600','760,650','640,740','320,640','390,844','844,390','568,320']){shape.value=value;status.textContent='Checking '+value+'…';try{results.push(await check())}catch(e){results.push({viewport:value,pass:false,error:e.stack||e.message,failureGeometry:Object.fromEntries(roles.map(role=>[role,{game:client(role)?.geometryDebug,utilities:client(role)?.utilityDebug}]))})}}await fetch('/results',{method:'POST',body:JSON.stringify(results)});status.textContent=results.map(r=>(r.pass?'PASS ':'FAIL ')+(typeof r.viewport==='string'?r.viewport:r.viewport.width+' × '+r.viewport.height)+' '+(r.pass?r.checks.length+' multiplayer checks':r.error)).join('\n');run.disabled=false};await fresh();
</script></html>`; }
function createServer() {
  const sessions = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/session') { const session = randomUUID(); sessions.set(session, createSession()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ session })); return; }
    if (url.pathname === '/close' && req.method === 'POST') { sessions.get(url.searchParams.get('session'))?.room.destroy(); sessions.delete(url.searchParams.get('session')); res.end('closed'); return; }
    if (url.pathname === '/results' && req.method === 'POST') { let body = ''; req.on('data', d => { body += d; }); req.on('end', () => { try { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'browser-results.json'), JSON.stringify(JSON.parse(body), null, 2)); res.end('saved'); } catch (e) { res.statusCode = 400; res.end(e.message); } }); return; }
    if (url.pathname === '/' || url.pathname === '/client') { res.setHeader('Content-Type', 'text/html'); res.end(url.pathname === '/client' ? clientPage() : hubPage()); return; }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('Not found'); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  const wss = new WebSocketServer({ server, path: '/socket' });
  const heartbeat = setInterval(() => { for (const session of sessions.values()) session.room.onTick(); }, 100);
  wss.on('connection', ws => { let session = null; ws.on('message', text => { try {
    const m = JSON.parse(text);
    if (m.t === 'join') { session = sessions.get(m.session); if (!session || !session.roles[m.role]) throw Error('Fixture room is unavailable.'); const seat = session.roles[m.role]; session.room.addPlayer(seat.name, ws, seat.token); session.room.broadcastLobby(); session.room.broadcastState(); }
    else if (session && m.t === 'game-ready') { session.room.onReady(ws, { i: m.i, w: m.w }); }
    else if (session && m.t === 'action') { session.room.onAction(ws, m.a, { i: m.i, w: m.w }); ws.send(JSON.stringify({ t: 'qa-ack', qaId: m.qaId, phase: session.room.game.state.phase })); }
    else if (session && m.t === 'qa-rematch') { const r = session.room.startGame(game, { ready: true, settings: { writeSeconds: 30, drawSeconds: 90, guessSeconds: 30 } }, session.room.hostId); if (!r.ok) throw Error(r.error); }
    else if (session && m.t === 'qa-expire') { if(session.room.game.preparing||m.i!==session.room.game.instanceId||m.w!==session.room._actionToken())throw Error('Wait for the current round to prepare.');session.clock.time = session.room.game.state.endsAt; session.room.onAction(ws, {}, {i:m.i,w:m.w}); }
    else if (session && m.t === 'qa-advance') { if(session.room.game.preparing||m.i!==session.room.game.instanceId||m.w!==session.room._actionToken())throw Error('Wait for the current round to prepare.');const phase = session.room.game.state.phase; for (let n = 0; n < 12 && session.room.game.state.phase === phase; n++) { const timer = session.clock.timers.filter(t => !t.dead).sort((a, b) => a.at - b.at)[0]; if (!timer) break; timer.dead = true; session.clock.time = Math.max(session.clock.time, timer.at); timer.fn(); } session.room.broadcastState(); }
  } catch (e) { ws.send(JSON.stringify({ t: 'qa-error', message: e.message })); } }); ws.on('close', () => session?.room.disconnect(ws)); });
  server.on('close', () => { clearInterval(heartbeat); for (const s of sessions.values()) s.room.destroy(); wss.close(); });
  return server;
}
module.exports = { createServer, createSession };
if (require.main === module) { const port=Number(process.env.DRAW_PHONE_QA_PORT||8400);createServer().listen(port,'127.0.0.1',()=>console.log('Draw Phone multiplayer QA: http://127.0.0.1:'+port+'/')); }
