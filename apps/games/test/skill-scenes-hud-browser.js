'use strict';
// Browser HUD QA: production clients + real engine projections, and native
// DOM action routes through real WebSockets and Room.onAction. Timed engine
// preparation uses a controlled clock; no production session or account.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {WebSocketServer}=require('ws');
const {Room}=require('../server/room');
const {auditTextContrast}=require('./live-text-contrast');
const {ids,fixtures,Clock,accepted}=require('./skill-scenes-hud-fixtures');
const root=path.resolve(__dirname,'../public'),directory=process.env.SKILL_QA_REPORT_DIR||'/tmp/giggle-hud-20261006/skill';
function reportMarkup(){
 const source=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
 const definition=source.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)?.[0];
 if(!definition)throw Error('Production Report button not found');
 return vm.runInNewContext(definition+"\nreportButton('game-report-icon')",{},{timeout:1000});
}
function page(){return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Skill game HUD QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/issues.css"><style>body{padding:0;margin:0}#controls{padding:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-bottom:1px solid var(--line)}#controls button,#controls select{font-size:16px;min-height:44px;max-width:100%}#gbody{min-width:0;width:100%;box-sizing:border-box}#game-name{overflow-wrap:anywhere}#controls[hidden],#status[hidden]{display:none}#status{font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;margin:0}#shared-clock i{display:block;height:100%;background:var(--accent);width:85%}#shared-clock[hidden]{display:none}html[data-reduced="true"] #gbody *,html[data-reduced="true"] #gbody *::before,html[data-reduced="true"] #gbody *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}</style><body class="game-playing"><div id="controls"><button class="btn" id="run">Check all HUD states</button><button class="btn" id="socket-run">Check DOM socket actions</button><button class="btn" id="cameramatches">Complete camera matches</button><button class="btn" id="fullmatches">Complete7 skill matches</button><button class="btn ghost" id="live">Start live room</button><select id="game" aria-label="Game">${ids.map(id=>'<option>'+id+'</option>').join('')}</select><select id="state" aria-label="Scenario"></select><button class="btn ghost" id="long">Long text</button><button class="btn ghost" id="night">Night mode</button><button class="btn ghost" id="reduced">Reduced motion</button></div><div class="app" id="app"><header id="strip" class="play-toolbar"><div class="play-title"><div><h1 id="game-name"></h1><span class="play-status" id="play-role" hidden>Watching</span></div></div><details class="room-menu" id="roomMenu"><summary aria-label="Room controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg><span>Room</span></summary><button type="button" class="room-menu-scrim" id="bRoomScrim" tabindex="-1" aria-label="Close room menu"></button><div class="room-menu-panel" role="dialog" aria-modal="true" aria-labelledby="roomMenuTitle"><div class="room-menu-head"><span class="room-menu-kicker">ROOM QA</span><button type="button" class="room-close" id="bRoomClose" aria-label="Close room menu">×</button></div><h2 id="roomMenuTitle"></h2><p>Adapted app shell with shipping game view/locales and real Room readiness; full app acceptance remains separate.</p><button type="button" class="room-resume" id="bRoomResume">Back to game<span aria-hidden="true">▶</span></button></div></details>${reportMarkup()}</header><main class="game-stage"><div id="shared-clock" class="game-clock"><div class="timerbar"><i></i></div><span class="timertext" id="shared-time"></span></div><div id="gbody" data-layout="standard"></div></main></div><pre id="status" role="status">Ready</pre><script type="module">
import {show as hostShow,reset as hostReset} from '/js/game-host.js';
import {openIssueReport} from '/js/report-issue.js';
import {createResultPresentation} from '/js/toolkit/result-presentation.mjs';
import {createInput} from '/js/toolkit/input.js';
const auditTextContrast=${auditTextContrast.toString()};
const ownedIds=['countdown-word','memory-tray','number-hunt','reaction-tap','scattergories','twenty-questions','typing-race','warm-words','word-chain'];
const fixtures=${JSON.stringify(fixtures)},ids=${JSON.stringify(ids)},accepted=${accepted.toString()};
const el=document.querySelector('#gbody'), game=document.querySelector('#game'), scenario=document.querySelector('#state'),status=document.querySelector('#status'),modules={},actions=[];let current=null,S=null,long=false,socket=null,pendingAck=null,lastSocketState=null,liveMode=false,liveReady=false,hostMode=false,painted=null,preparedMeta=null,activeGame='platform',screenChanges=0,lastUtilityGeometry=null,lastReportGeometry=null;const readyAcks=[],readyReplies=[];
const settlements=[];const presentation=createResultPresentation(s=>settlements.push({instanceId:s.instanceId,scores:s.scores}));
const api={resultsReady:id=>presentation.ready(id),cue:()=>true,send:a=>{if(socket&&(!liveReady||S?.preparing||S?.spectator||painted?.instanceId!==S?.instanceId||painted?.w!==S?.w))return false;actions.push(a);if(socket&&socket.readyState===1)socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w}));return true;},ready:meta=>{if(!S?.preparing||meta.instanceId!==S.instanceId||meta.window!==S.w||socket?.readyState!==1)return false;readyAcks.push({...meta,phase:S.phase});socket.send(JSON.stringify({t:'game-ready',i:meta.instanceId,w:meta.window}));return true;},loadError:failure=>{status.textContent='Production game-host load error: '+failure.error;},now:()=>socket&&S?.gameNow!==undefined?S.gameNow:Date.now(),focus:n=>{if(roomMenu.open&&!roomMenu.contains(n))return;n?.focus({preventScroll:true});},announce:()=>{},toast:()=>{},sound:()=>{},voice:{state:()=>({enabled:false}),subscribe:()=>()=>{}}};
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const wait=()=>new Promise(r=>requestAnimationFrame(r));
const roomMenu=document.querySelector('#roomMenu');
for(const id of ['bRoomClose','bRoomResume','bRoomScrim'])document.getElementById(id).onclick=()=>{roomMenu.open=false;roomMenu.querySelector('summary').focus({preventScroll:true});};
roomMenu.addEventListener('toggle',()=>{if(roomMenu.open)document.getElementById('bRoomResume').focus({preventScroll:true});});
document.addEventListener('game-screenchange',()=>screenChanges++);
document.addEventListener('click',event=>{const opener=event.target.closest('[data-report]');if(!opener)return;roomMenu.open=false;openIssueReport({games:ids.map(id=>({id,name:id.replaceAll('-',' ')})),game:activeGame,phase:S?.phase||'',theme:document.documentElement.dataset.theme||'day',embedded:false},opener);});
async function styles(){await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(l=>l.sheet?Promise.resolve():new Promise(r=>{l.addEventListener('load',r,{once:true});l.addEventListener('error',r,{once:true})})));await document.fonts.ready;await wait();}
// A fresh fixture scenario has no navigation scroll history. Restore its
// origin after client focus/fonts settle; same-window paint keeps live scroll.
async function settleScenario(){await styles();window.scrollTo(0,0);await wait();}
async function view(id){return modules[id]||=(await import('/js/games/'+id+'.js?v='+Date.now())).default;}
function paint(v,s){(v.update||v.render).call(v,el,s,api)}
function projection(id,index,extended=false){const raw=JSON.parse(JSON.stringify(fixtures[id][index].state)),shift=Date.now()-raw.serverNow;raw.serverNow=Date.now();for(const key of ['endsAt','startAt','clockStamp','phaseStartedAt'])if(raw[key]>0)raw[key]+=shift;if(extended){raw.players=raw.players.map(p=>({...p,name:'Alexandria'+('w'.repeat(24))}));if(raw.wordShown)raw.wordShown='A'.repeat(60);if(raw.masked)raw.masked='_ '.repeat(38);if(raw.myPrompt)raw.myPrompt='A very small dragon patiently carries an enormous birthday cake across a windy mountain bridge';if(raw.choices)raw.choices=['A'.repeat(60),...raw.choices.slice(1)];if(raw.suggestions)raw.suggestions=['A very small dragon patiently carries an enormous birthday cake across a windy mountain bridge'];if(raw.target)raw.target='Words keep moving along this track. '+('W'.repeat(120));if(raw.categories)raw.categories=raw.categories.map(c=>c+' with a wonderfully long category description');if(raw.current)raw.current='W'.repeat(24);if(raw.prompt)raw.prompt+=' — take your time and make the whole room laugh';}return raw;}
async function criticalStyles(v){await Promise.all((v.styles||[]).map(href=>{let link=[...document.querySelectorAll('link[rel=stylesheet]')].find(l=>l.getAttribute('href')===href);if(link?.sheet)return Promise.resolve();return new Promise((resolve,reject)=>{if(!link){link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);}link.addEventListener('load',resolve,{once:true});link.addEventListener('error',()=>reject(Error('Required stylesheet '+href)),{once:true});});}));}
function retire(){if(hostMode)hostReset();else current?.dispose?.(el);current=null;hostMode=false;painted=null;el.innerHTML='';}
async function mount(id,index=0,extended=false){retire();activeGame=id;el.innerHTML='';current=await view(id);await criticalStyles(current);current.mount?.(el,api);S=projection(id,index,extended);paint(current,S);document.querySelector('#game-name').textContent=(id==='show-and-go'?'Show & Go':id.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase()));document.querySelector('#roomMenuTitle').textContent=document.querySelector('#game-name').textContent;document.querySelector('#play-role').hidden=!S.spectator;document.querySelector('#shared-clock').hidden=current.ownsTimer||!S.endsAt||S.phase==='done';document.querySelector('#shared-time').textContent=Math.max(0,Math.ceil((S.endsAt-Date.now())/1000))+'s remaining';await settleScenario();return current;}
async function show(){liveMode=false;liveReady=false;socket?.close();socket=null;await mount(game.value,Number(scenario.value)||0,long);status.textContent=game.value+' · '+fixtures[game.value][Number(scenario.value)||0].label;}
function populate(){scenario.innerHTML=fixtures[game.value].map((f,i)=>'<option value="'+i+'">'+f.label+' · '+f.state.phase+'</option>').join('');}
const click=selector=>{const b=el.querySelector(selector);assert(b&&!b.disabled,'missing enabled '+selector);b.click();};
const fill=(selector,value)=>{const input=el.querySelector(selector);assert(input&&!input.disabled,'missing enabled input '+selector);input.value=value;return input;};
const inputs={charades:'#cGuess','countdown-word':'#cwWord','draw-phone':'#pPhrase','memory-tray':'#mAns','number-hunt':'#nGuess',scattergories:'#sc0','twenty-questions':'#tQ','typing-race':'#tInput','warm-words':'[data-ww-input]','word-chain':'#wcWord'};
const fields=['input:not([type=range]):not([type=color]):not([type=checkbox]):not([type=radio])','textarea'];
const noScrollFields={
 'countdown-word':['.sk-rack','#cwWord','#cwLock'],
 'memory-tray':['.sk-tray','#mAns','#mSend'],
 'number-hunt':['.sk-dial','#nGuess','#nSend'],
 'reaction-tap':['#rPad','.sk-signal'],
 'typing-race':['#tTarget','#tInput'],
 'warm-words':['.ww-stage','[data-ww-input]','[data-ww-form] button'],
 'word-chain':['.sk-current','#wcWord','#wcGo']
};
function insideViewport(r){return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}
function visiblePlayfield(id,label){
 const landscape=innerWidth>innerHeight,active=!['done','reveal','roundEnd'].includes(S.phase),measured=[];let checks=0;
 if(landscape&&active&&ownedIds.includes(id)){
  for(const selector of noScrollFields[id]||[])for(const n of el.querySelectorAll(selector)){
   const r=n.getBoundingClientRect(),css=getComputedStyle(n);if(!r.width||!r.height||css.visibility==='hidden'||css.display==='none')continue;
   const fullyVisible=insideViewport(r);measured.push({selector,...rect(n),fullyVisible});assert(fullyVisible,id+' '+label+' active playfield/control outside visible landscape '+selector+' bottom'+r.bottom+'/'+innerHeight);checks++;
  }
  // Natural history/answer lists may scroll. The timer and Room utility
  // still belong to the visible game shell, independently of those lists.
  for(const selector of ['.room-menu>summary','#shared-clock:not([hidden])']){const n=document.querySelector(selector),r=n?.getBoundingClientRect();if(!r?.width||!r?.height)continue;assert(insideViewport(r),id+' '+label+' shell utility outside visible landscape '+selector);checks++;}
 }
 return{checks,scope:landscape&&active?'visible active landscape; text lists may flow':'natural text/result flow',width:innerWidth,height:innerHeight,measured};
}
function utilityGeometry(id,label){
 let checks=0;const check=(value,message)=>{assert(value,id+' '+label+' '+message);checks++;};
 const visible=n=>n&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none';
 const separate=(a,b)=>a.right<=b.left+.5||a.left>=b.right-.5||a.bottom<=b.top+.5||a.top>=b.bottom-.5;
 const box=b=>b&&({left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height});
 const report=document.querySelector('.game-report-icon'),room=document.querySelector('#roomMenu>summary'),reportBox=report?.getBoundingClientRect(),roomBox=room?.getBoundingClientRect();
 const metrics=lastUtilityGeometry={id,label,phase:S.phase,viewport:{width:innerWidth,height:innerHeight},report:box(reportBox),room:box(roomBox),regions:[]};
 for(const [name,n,b]of [['Report',report,reportBox],['Room',room,roomBox]]){
  check(visible(n),name+' is hidden');check(b.width>=43.5&&b.height>=43.5,name+' target below44px');check(insideViewport(b),name+' outside visible viewport');
  const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);check(hit&&(hit===n||n.contains(hit)),name+' center covered by '+(hit?.className||hit?.tagName));
 }
 check(separate(reportBox,roomBox),'Report intersects Room');
 for(const n of document.querySelectorAll('.play-title h1,.play-status,#shared-clock .timertext,.ww-clock,.sk-deskline,.sk-traycue,.sk-rulerhead,.sk-signal,.sk-gridline,.sk-tablecue,.sk-padhead,.ww-head,.tq-top')){
  if(!visible(n))continue;
  const boxes=n.matches('.play-title h1,.play-status')?(()=>{const range=document.createRange();range.selectNodeContents(n);return [...range.getClientRects()];})():[n.getBoundingClientRect()];
  for(const b of boxes){if(!b.width||!b.height)continue;const name=n.id||n.className||n.tagName;metrics.regions.push({name,...box(b)});check(separate(reportBox,b),'Report intersects '+name);check(separate(roomBox,b),'Room intersects '+name);}
 }
 return{checks,...metrics};
}
function geometry(id,label){let checks=0;const contrast=ownedIds.includes(id)?auditTextContrast(el):null;if(contrast){assert(!contrast.errors.length,id+' '+label+' contrast '+JSON.stringify(contrast.errors));checks++;}assert(el.textContent.trim().length>5,id+' '+label+' blank');checks++;assert(el.scrollWidth<=el.clientWidth+2,id+' '+label+' scene width '+el.scrollWidth+'/'+el.clientWidth);checks++;const bounds=el.getBoundingClientRect();for(const n of el.querySelectorAll('button,input,textarea,select,summary,canvas')){const r=n.getBoundingClientRect(),css=getComputedStyle(n);if(!r.width||!r.height||css.visibility==='hidden'||css.display==='none')continue;assert(r.left>=bounds.left-2&&r.right<=bounds.right+2,id+' '+label+' target outside scene '+(n.id||n.className));if(n.matches('button,summary')&&!n.matches('[data-sq]'))assert(r.height>=43&&r.width>=43,id+' '+label+' target <44 '+(n.id||n.className)+' '+r.width+'×'+r.height);if(n.matches(fields.join(',')))assert(parseFloat(css.fontSize)>=16,id+' text input <16px');}checks++;if(S.phase==='done'){assert(!el.querySelector('[data-ww-clock],.cp-clock[data-cp-clock],#ch-clock-w:empty'),'done has active empty clock');checks++;}const hud=el.querySelector('.sk-cue,.sk-deskline,.sk-deskcue,.sk-steps,.sk-traycue,.sk-rulerhead,.sk-signal,.sk-padhead,.sk-gridline,.sk-tablecue,.ww-head,.tq-top,.chstatus,.cp-head'),field=el.querySelector('canvas,.chboard,.sk-tray,.sk-lanes,.sk-target,.sk-pad,.tq-spot,.ww-stage,.sk-dial,.sk-stage,.sk-rack,.sk-sheet,.sk-current,.cp-prompt-card');if(hud&&field){const h=hud.getBoundingClientRect(),f=field.getBoundingClientRect();assert(!(h.left<f.right&&h.right>f.left&&h.top<f.bottom&&h.bottom>f.top),id+' HUD overlaps playfield');checks++;}const viewport=visiblePlayfield(id,label);checks+=viewport.checks;const utilities=ownedIds.includes(id)?utilityGeometry(id,label):null;if(utilities)checks+=utilities.checks;return {checks,contrast,viewport,utilities,bounds:{scene:{x:bounds.x,y:bounds.y,w:bounds.width,h:bounds.height},hud:hud&&rect(hud),playfield:field&&rect(field)}};}
function rect(n){const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}
async function reportModal(id){
 await styles();const opener=document.querySelector('.game-report-icon'),before=screenChanges,sent=actions.length,windowId=S.w,phase=S.phase;
 const selector=inputs[id],field=selector&&el.querySelector(selector),editable=field&&!field.disabled,original=editable?field.value:null;
 const selection=editable&&typeof field.selectionStart==='number'?{start:field.selectionStart,end:field.selectionEnd}:null;
 const draft=id==='number-hunt'?'63':id==='countdown-word'?'late':id==='typing-race'?S.target.slice(0,3):'apple';
 let checks=0;const check=(value,message)=>{assert(value,id+' Report '+message);checks++;};
 const keys=[],pointers=[],target=document.createElement('div'),probe=createInput(target,{window,document,onKey:event=>keys.push(event),onPointer:event=>pointers.push(event)});
 const metrics=lastReportGeometry={id,phase,source:'production Report modal; synthetic toolkit key/pointer release probe',dialog:null,releaseEvents:0};
 try{
  if(editable){field.value=draft;field.focus({preventScroll:true});if(selection)field.setSelectionRange(1,Math.min(3,draft.length));}
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',bubbles:true}));
  target.dispatchEvent(new PointerEvent('pointerdown',{pointerId:901,clientX:0,clientY:0}));
  check(probe.isDown('KeyW')&&probe.pointers().size===1,'release probe did not hold input');
  opener.focus({preventScroll:true});opener.click();await wait();
  let dialog=document.querySelector('dialog.issue-dialog[open]');check(dialog&&document.activeElement===dialog.querySelector('.issue-close'),'actual dialog did not open with safe focus');
  check(screenChanges===before+1&&!probe.isDown('KeyW')&&!probe.pointers().size&&keys.at(-1)?.released&&pointers.at(-1)?.type==='cancel','opening did not release held toolkit input');
  const b=dialog.getBoundingClientRect();metrics.dialog={left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};check(insideViewport(b),'dialog outside visible viewport');
  check(dialog.querySelector('[name=game]').value===id,'wrong current game context');
  const close=dialog.querySelector('.issue-close'),closeBox=close.getBoundingClientRect();check(closeBox.width>=43.5&&closeBox.height>=43.5&&insideViewport(closeBox),'close target below44px or outside viewport');
  let leaked=0;const listen=()=>leaked++;window.addEventListener('keydown',listen);
  close.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));window.removeEventListener('keydown',listen);
  check(!leaked&&actions.length===sent&&S.phase===phase&&S.w===windowId,'modal key leaked to game or changed authority');
  const description=dialog.querySelector('[name=description]'),reportDraft='QA draft for '+id+'. Preserve this text when returning to play.';
  description.value=reportDraft;description.focus({preventScroll:true});description.setSelectionRange(2,10);description.dispatchEvent(new Event('input',{bubbles:true}));
  if(hostMode){const view=await hostShow(el,id,S,api);check(view===current&&painted===S,'same-window host repaint lost released scene');}else paint(current,{...S,qaReportSnapshot:1});
  check(document.activeElement===description&&description.value===reportDraft&&description.selectionStart===2&&description.selectionEnd===10,'game repaint stole Report focus/draft/selection');
  if(editable){check(el.querySelector(selector)===field&&field.value===draft,'game repaint lost input node/draft');if(selection)check(field.selectionStart===1&&field.selectionEnd===Math.min(3,draft.length),'game repaint lost input selection');}
  close.click();check(!document.querySelector('dialog[open]')&&document.activeElement===opener,'close did not restore Report opener');check(screenChanges===before+2,'close did not refresh input lifecycle');
  opener.click();dialog=document.querySelector('dialog.issue-dialog[open]');check(dialog?.querySelector('[name=description]').value===reportDraft,'reopening lost report draft');
  dialog.querySelector('.issue-cancel').click();check(!document.querySelector('dialog[open]')&&document.activeElement===opener,'Cancel did not restore opener');
  check(screenChanges===before+4&&actions.length===sent&&S.phase===phase&&S.w===windowId,'report open/close changed authority or missed lifecycle events');
  metrics.releaseEvents=screenChanges-before;return{checks,...metrics,utility:utilityGeometry(id,'after Report')};
 }finally{
  document.querySelector('dialog.issue-dialog[open] .issue-close')?.click();probe.dispose();
  if(editable&&el.querySelector(selector)===field){field.value=original;if(selection)field.setSelectionRange(selection.start,selection.end);}
 }
}
async function check(id){
 let checks=0,report=null;const states=[];
 for(let i=0;i<fixtures[id].length;i++)for(const extended of [false,true]){
  await mount(id,i,extended);const label=fixtures[id][i].label+(extended?' · long':'');const g=geometry(id,label);checks+=g.checks;
  states.push({label,phase:S.phase,spectator:S.spectator,contrast:g.contrast,viewport:g.viewport,utilities:g.utilities,...g.bounds});
  const sel=inputs[id],input=sel&&el.querySelector(sel);
  if(input&&!input.disabled){const draft=id==='number-hunt'?'63':id==='typing-race'?S.target.slice(0,3):'A thoughtful draft';input.value=draft;input.focus();paint(current,{...S,qaSnapshot:1});assert(el.querySelector(sel)===input&&input.value===draft,id+' '+label+' loses draft');checks++;}
  if(S.spectator){for(const input of el.querySelectorAll(fields.join(',')))assert(input.disabled||input.readOnly,id+' watcher writable input');checks++;}
  if(ownedIds.includes(id)&&!report&&!extended&&!S.spectator&&!['done','reveal','roundEnd'].includes(S.phase)){report=await reportModal(id);checks+=report.checks+report.utility.checks;}
 }
 retire();return{id,checks,states,report,pass:true,source:'declared production-engine projections'};
}
async function save(kind,results){const data={kind,utilities:'production Room icon + app reportButton + issues.css; actual Report modal; no report submission',source:kind==='hud'?'declared production-engine projections':'production game-host + actual released Room windows',fixtureChromeHidden:document.querySelector('#controls').hidden,ownedOnly:params.get('owned')==='1',theme:document.documentElement.dataset.theme||'day',viewport:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,results};await fetch('/results',{method:'POST',body:JSON.stringify(data)});parent.postMessage({t:'skill-fixture-results',data},location.origin);return data;}
async function auditViewport(fn){const controls=document.querySelector('#controls'),wasControls=controls.hidden,wasStatus=status.hidden;controls.hidden=true;status.hidden=true;window.scrollTo(0,0);await styles();try{return await fn();}finally{controls.hidden=wasControls;status.hidden=wasStatus;window.scrollTo(0,0);}}
document.querySelector('#run').onclick=()=>auditViewport(async()=>{liveMode=false;liveReady=false;socket?.close();socket=null;const results=[];status.textContent='Checking actual HUD projections…';for(const id of (params.get('owned')==='1'?ownedIds:ids)){try{results.push(await check(id))}catch(e){results.push({id,pass:false,error:e.message,failureUtility:lastUtilityGeometry?.id===id?lastUtilityGeometry:null,failureReport:lastReportGeometry?.id===id?lastReportGeometry:null});retire();}status.textContent=results.map(r=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||r.checks+' checks')).join('\n');}await save('hud',results);game.value=params.get('owned')==='1'?'memory-tray':'doodle-guess';populate();scenario.value=String(Math.max(0,fixtures[game.value].findIndex(f=>f.label==='Drawing')));await mount(game.value,Number(scenario.value));status.textContent=results.map(r=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||r.checks+' checks')).join('\n');});
function paintChrome(id){document.querySelector('#game-name').textContent=id.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());document.querySelector('#roomMenuTitle').textContent=document.querySelector('#game-name').textContent;document.querySelector('#play-role').hidden=!S.spectator;document.querySelector('#shared-clock').hidden=S.preparing||current?.ownsTimer||!S.endsAt||S.phase==='done';document.querySelector('#shared-time').textContent=Math.max(0,Math.ceil((S.endsAt-api.now())/1000))+'s remaining';}
async function prepareSocket(id,resume=null){
 liveReady=false;activeGame=id;socket?.close();retire();hostMode=true;lastSocketState=null;preparedMeta=null;S=null;readyAcks.length=0;readyReplies.length=0;
 const active=socket=new WebSocket('ws://'+location.host+'/socket');
 const confirmed=()=>readyAcks.some(m=>m.instanceId===S?.instanceId&&m.window===S?.w)&&readyReplies.some(m=>m.accepted&&m.i===S?.instanceId&&m.w===S?.w);
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Production readiness did not release '+id)),12000);
  const fail=error=>{clearTimeout(timeout);reject(error instanceof Error?error:Error('Room socket failed'));};
  // Release paint and the fixture's separate acknowledgement are delivered
  // independently. Neither can release the action gate on its own.
  const complete=()=>{if(active!==socket||!preparedMeta||!S||S.preparing||S.phase!==preparedMeta.phase||painted!==S||(!resume&&!confirmed()))return;liveReady=true;clearTimeout(timeout);resolve();};
  active.onerror=fail;active.onopen=()=>active.send(JSON.stringify(resume?{t:'resume',key:resume}:{t:'prepare',id}));
  active.onmessage=event=>{
   if(active!==socket)return;const msg=JSON.parse(event.data);
   if(msg.t==='qa-error'){fail(Error(msg.error));return;}
   if(msg.t==='qa-ready'){readyReplies.push(msg);complete();return;}
   if(msg.t==='prepared'){preparedMeta=msg;complete();return;}
   if(msg.t==='state'){
    lastSocketState=msg;const previous=S,snapshot=S={...msg,me:msg.you,hostId:preparedMeta?.hostId||msg.hostId,strings:preparedMeta?.strings||{},audioBaseline:!previous};
    el.inert=!!S.preparing;el.setAttribute('aria-busy',String(!!S.preparing));
    hostShow(el,id,snapshot,api).then(view=>{
     if(active!==socket||!view||S!==snapshot)return;current=view;painted=snapshot;paintChrome(id);presentation.observe(previous,snapshot);
     complete();
    }).catch(fail);
   }
   if(msg.t==='qa-ack'){
    pendingAck?.(msg);pendingAck=null;
    if(liveMode){const pass=!msg.preparingAtAction&&!!accepted(id,msg.view,msg.you,msg.action);status.textContent=(pass?'Room confirmed: ':'Room rejected: ')+id+' '+JSON.stringify(msg.action);fetch('/native-results',{method:'POST',body:JSON.stringify({id,pass,action:msg.action,phase:msg.phase,readiness:msg.readiness,viewport:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight}})});}
   }
  };
 });
 assert(resume||confirmed(),'Visible production game-host readiness acknowledgement missing');
 assert(!S.preparing&&painted===S,'Released window not painted');
}
function acknowledgement(){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pendingAck=null;reject(Error('no Room socket acknowledgement'));},3000);pendingAck=m=>{clearTimeout(timer);resolve(m)}});}
async function nativeAction(id){liveMode=false;await prepareSocket(id);await settleScenario();const utilities=utilityGeometry(id,'Room released'),report=await reportModal(id),releasedWindow=S.w,readyWindows=[...readyAcks];const ack=acknowledgement();
 if(id==='charades'){fill('#cGuess','a friendly guess');click('#cSend');}
 if(id==='chess'){click('#chsq-e2');click('#chsq-e4');}
 if(id==='countdown-word'){fill('#cwWord','late');click('#cwLock');}
 if(id==='doodle-guess')click('[data-w]');
 if(id==='draw-phone'){fill('#pPhrase','A tiny dragon baking a cake');click('#pSend');}
 if(id==='memory-tray'){fill('#mAns','apple, candle');click('#mSend');}
 if(id==='number-hunt'){fill('#nGuess','42');click('#nSend');}
 if(id==='pose-party'||id==='show-and-go')click('.cp-ready');
 if(id==='reaction-tap')el.querySelector('#rPad').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',isPrimary:true,button:0}));
 if(id==='scattergories'){fill('#sc0','seal');click('#scSave');}
 if(id==='twenty-questions'){fill('#tQ','Is it alive?');click('#tQSend');}
 if(id==='typing-race'){fill('#tInput',S.target.slice(0,5)).dispatchEvent(new Event('input',{bubbles:true}));}
 if(id==='warm-words'){fill('[data-ww-input]','kitchen');el.querySelector('[data-ww-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
 if(id==='word-chain'){fill('#wcWord',S.current==='apple'?'fruit':'apple');click('#wcGo');}
 const result=await ack;assert(!result.preparingAtAction&&result.readiness?.enabled&&result.readiness.visibleAcks>0&&result.changed&&accepted(id,result.view,result.you,result.action),id+' Room did not accept a released-window action');retire();socket.close();socket=null;return{id,pass:true,checks:4+utilities.checks+report.checks+report.utility.checks,source:'real Room released-window DOM action',action:result.action,phase:result.phase,releasedWindow,readyWindows,readiness:result.readiness,utilities,report};}
async function stableMatch(){const end=performance.now()+12000;while(!S||S.preparing||painted!==S){assert(performance.now()<end,'Match readiness/paint timeout');await wait();}await wait();}
async function matchCommand(command){const ack=acknowledgement();socket.send(JSON.stringify({t:'match-command',command}));const result=await ack;assert(!result.error,result.error);await stableMatch();return result;}
function matchOutcome(id,state){if(id==='word-chain'){assert(Array.isArray(state.alive)&&Array.isArray(state.out)&&Array.isArray(state.used)&&'winner' in state,'Missing Word Chain authority result');return {winner:state.winner,alive:state.alive,out:state.out,used:state.used};}if(id==='countdown-word'||id==='scattergories'){assert(state.last&&typeof state.last==='object','Missing '+id+' authority round result');return {last:state.last};}assert(state.scores&&typeof state.scores==='object','Missing '+id+' authority scores');return {scores:state.scores};}
async function fullSkillMatch(id){liveMode=false;await prepareSocket(id);const instance=S.instanceId,start=actions.length,before=settlements.length;
const action=async fn=>{const ack=acknowledgement();fn();const a=await ack;assert(a.changed&&!a.preparingAtAction,'Shipping DOM action was not accepted');await stableMatch();};
if(id==='number-hunt'){const solution=await matchCommand('solution');await action(()=>{fill('#nGuess',String(solution.word));click('#nSend');});}
if(id==='warm-words'){const solution=await matchCommand('solution');await action(()=>{fill('[data-ww-input]',solution.word);el.querySelector('[data-ww-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});}
if(id==='countdown-word'){await action(()=>{fill('#cwWord','late');click('#cwLock');});await matchCommand('others');}
if(id==='scattergories'){await action(()=>{for(let i=0;i<S.categories.length;i++)fill('#sc'+i,S.letter+'omething');click('#scLock');});await matchCommand('others');}
if(id==='charades'){const solution=await matchCommand('solution');await action(()=>{fill('#cGuess',solution.word);click('#cSend');});}
if(id==='pose-party'||id==='show-and-go'){await action(()=>click('.cp-ready'));await matchCommand('others');await matchCommand('deadline');if(id==='show-and-go')await action(()=>click('.cp-yes'));await matchCommand('others');}
if(id==='typing-race'){await action(()=>fill('#tInput',S.target).dispatchEvent(new Event('input',{bubbles:true})));await matchCommand('others');}
if(id==='reaction-tap'){await action(()=>el.querySelector('#rPad').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:2,pointerType:'touch',isPrimary:true,button:0})));await matchCommand('others');}
if(id==='word-chain'){await action(()=>{fill('#wcWord',S.current==='apple'?'fruit':'apple');click('#wcGo');});await matchCommand('others');}
for(let n=0;n<12&&S.phase!=='done';n++)await matchCommand('deadline');assert(S.phase==='done','Complete match did not settle');await stableMatch();assert(settlements.length===before+1,'Missing or duplicate final settlement');const scores=JSON.stringify(matchOutcome(id,S));await matchCommand('snapshot');assert(JSON.stringify(matchOutcome(id,S))===scores&&settlements.length===before+1,'Final snapshot changed settlement');const final=utilityGeometry(id,'settled final');await matchCommand('spectator');assert(S.spectator,'Late watcher not projected as spectator');assert(JSON.stringify(matchOutcome(id,S))===scores&&settlements.length===before+1,'Spectator snapshot altered final settlement');const spectator=utilityGeometry(id,'late spectator final');await matchCommand('participant');const retained=await matchCommand('retain');await prepareSocket(id,retained.key);assert(S.instanceId===instance&&JSON.stringify(matchOutcome(id,S))===scores&&settlements.length===before+1,'Finished reconnect repeated settlement or changed scores');await matchCommand('rematch');assert(S.instanceId!==instance&&!S.preparing,'Rematch not released');assert(readyAcks.some(a=>a.instanceId===S.instanceId),'Rematch no shipping readiness');const result={id,pass:true,source:'Adapted shell: actual Room WS shipping game view/locales complete match; controlled engine deadlines; synthetic pointer; full app shell remains separate',actions:actions.length-start,finalOutcome:JSON.parse(scores),settlements:1,readyWindows:[...readyAcks],staleRejected:true,finishedReconnect:true,rematchInstance:S.instanceId,lateSpectator:true,spectator,final};retire();socket.close();socket=null;return result;}
document.querySelector('#cameramatches').onclick=()=>auditViewport(async()=>{const results=[];for(const id of ['charades','pose-party','show-and-go']){status.textContent='Completing '+id+' — media stand-in; no RTC';try{results.push({...await fullSkillMatch(id),media:'Explicit stand-in, no authenticated RTC'});}catch(e){results.push({id,pass:false,error:e.message});socket?.close();socket=null;retire();}}await save('cameramatches',results);status.textContent=results.map(r=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||'complete Room match; no RTC')).join('\n');});
document.querySelector('#fullmatches').onclick=()=>auditViewport(async()=>{const results=[];for(const id of ['word-chain','typing-race','reaction-tap','countdown-word','scattergories','number-hunt','warm-words']){status.textContent='Completing '+id;try{results.push(await fullSkillMatch(id));}catch(e){results.push({id,pass:false,error:e.message});socket?.close();socket=null;retire();}}await save('fullmatches',results);status.textContent=results.map(r=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||'complete match, settled final, ready rematch, stale rejection')).join('\n');});
document.querySelector('#live').onclick=async()=>{liveMode=true;await prepareSocket(game.value);status.textContent='Live Room: '+game.value+' — use the game control';};
document.querySelector('#socket-run').onclick=()=>auditViewport(async()=>{const results=[];status.textContent='Checking native controls through real Room sockets…';for(const id of (params.get('owned')==='1'?ownedIds:ids)){try{results.push(await nativeAction(id))}catch(e){results.push({id,pass:false,error:e.message,failureUtility:lastUtilityGeometry?.id===id?lastUtilityGeometry:null,failureReport:lastReportGeometry?.id===id?lastReportGeometry:null});socket?.close();socket=null;retire();}status.textContent=results.map(r=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||'Room action acknowledged')).join('\n');}await save('sockets',results);status.textContent=results.map(r=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||'Room action acknowledged')).join('\n');});
game.onchange=()=>{populate();show()};scenario.onchange=show;document.querySelector('#long').onclick=()=>{long=!long;show()};document.querySelector('#night').onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';document.querySelector('#reduced').onclick=()=>{document.documentElement.dataset.reduced=document.documentElement.dataset.reduced==='true'?'false':'true';status.textContent='Reduced motion preview; native preference: '+matchMedia('(prefers-reduced-motion:reduce)').matches};const params=new URLSearchParams(location.search);if(ids.includes(params.get('game')))game.value=params.get('game');populate();scenario.value=params.get('state')||'0';long=params.get('long')==='1';if(params.get('theme'))document.documentElement.dataset.theme=params.get('theme');if(params.get('reduced')==='1')document.documentElement.dataset.reduced='true';if(params.get('scene')==='1'){document.querySelector('#controls').hidden=true;status.hidden=true;}await show();
</script></html>`;}
function framed(params=''){return `<!doctype html><meta charset="utf-8"><title>Skill scenes — framed local QA</title><style>body{margin:0;background:#fafafd;color:#252237;font:16px system-ui}header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px}button{min-width:44px;min-height:44px;font:inherit;padding:10px 18px;border:1px solid #cfccdf;border-radius:24px;background:#fff;color:#252237}iframe{display:block;margin:auto;border:1px solid #cfccdf}pre{white-space:pre-wrap;padding:12px}</style><header><span>Local QA viewport</span><button data-size="1024,600">Low laptop1024×600</button><button data-size="1024,768">Tablet landscape1024×768</button><button data-size="768,1024">Tablet portrait768×1024</button><button data-size="390,844">Phone390×844</button><button data-size="320,640">Phone320×640</button><button data-size="844,390">Landscape844×390</button><button data-size="568,320">Landscape568×320</button><button data-action="run">Run HUD states</button><button data-action="cameramatches">Complete camera matches</button><button data-action="fullmatches">Complete7 skill matches</button><button data-action="socket-run">Run Room actions</button></header><iframe id="skillframe" src="/?${params}" width="1024" height="768" title="Actual game viewport"></iframe><pre id="report">HUD states are declared projections. Room actions use production game-host readiness.</pre><script>const frame=document.querySelector('#skillframe');for(const button of document.querySelectorAll('[data-size]'))button.onclick=()=>{const[w,h]=button.dataset.size.split(',');frame.width=w;frame.height=h};for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>frame.contentDocument.querySelector('#'+button.dataset.action)?.click();window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===frame.contentWindow&&e.data?.t==='skill-fixture-results')document.querySelector('#report').textContent=JSON.stringify(e.data.data,null,2);});</script>`;}
function createServer(){const retainedRooms=new Map();let retainSequence=0;const server=http.createServer((req,res)=>{if(new URL(req.url,'http://localhost').pathname==='/framed'){res.setHeader('Content-Type','text/html');res.end(framed(new URL(req.url,'http://localhost').searchParams.toString()));return;}if(new URL(req.url,'http://localhost').pathname==='/'||req.url==='/qa'){res.setHeader('Content-Type','text/html');res.end(page());return;}if(req.url==='/native-results'&&req.method==='POST'){let body='';req.on('data',d=>body+=d);req.on('end',()=>{try{fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'native-actual.json'),items=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];items.push(JSON.parse(body));fs.writeFileSync(file,JSON.stringify(items,null,2));res.end('saved');}catch(e){res.statusCode=400;res.end(e.message)}});return;}if(req.url==='/results'&&req.method==='POST'){let body='';req.on('data',d=>body+=d);req.on('end',()=>{try{const data=JSON.parse(body);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,(data.ownedOnly?'owned-':'')+data.kind+'-'+data.viewport.width+'x'+data.viewport.height+(data.theme==='night'?'-night':'')+'.json'),JSON.stringify(data,null,2));res.end('saved');console.log(data.results.filter(x=>!x.pass));}catch(e){res.statusCode=400;res.end(e.message)}});return;}const pathname=new URL(req.url,'http://localhost').pathname,shared=process.env.GIGGLE_QA_SHARED_PUBLIC && ['/css/style.css','/css/game-ui.css','/js/game-host.js'].includes(pathname),serving=shared?path.resolve(process.env.GIGGLE_QA_SHARED_PUBLIC):root;const file=path.resolve(serving,'.'+pathname);if(!file.startsWith(serving+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('Not found');return;}res.setHeader('Content-Type',(file.endsWith('.js')||file.endsWith('.mjs'))?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));});
 const wss=new WebSocketServer({server,path:'/socket'});
 wss.on('connection',ws=>{
  let room=null,clock=null,visiblePid=null,targetPhase=null,goalReached=false,visibleAcks=0,peerAcks=0,retainKey=null,liveStrings={},participantPid=null;
  function advanceToPlayable(){
   if(!room?.game||room.game.preparing||goalReached)return;
   if(room.game.state.phase===targetPhase){goalReached=true;return;}
   for(let n=0;n<12&&!room.game.preparing&&room.game.state.phase!==targetPhase;n++){clock.fire();room.broadcastState();}
   if(!room.game.preparing&&room.game.state.phase!==targetPhase)throw Error('Controlled deadline did not reach '+targetPhase);
   if(!room.game.preparing&&room.game.state.phase===targetPhase)goalReached=true;
  }
  function peerSocket(){
   const activeRoom=room;
   const peer={readyState:1,bufferedAmount:0,close(){},send(raw){
    const m=JSON.parse(raw);if(m.t!=='state'||!m.preparing)return;
    queueMicrotask(()=>{
     if(room!==activeRoom||!room.game?.preparing||room.bySocket(peer)?.id===visiblePid||m.instanceId!==room.game.instanceId||m.w!==room._actionToken())return;
     const pid=room.bySocket(peer)?.id;if(!pid||!room.game.requiredReady.has(pid)||room.game.ready.has(pid))return;
     peerAcks++;room.onReady(peer,{i:m.instanceId,w:m.w});advanceToPlayable();
    });
   }};return peer;
  }
  ws.on('message',text=>{try{
   const m=JSON.parse(text);
   if(m.t==='resume'){const retained=retainedRooms.get(m.key);if(!retained)throw Error('Unknown retained fixture');({room,clock,visiblePid,targetPhase,goalReached,visibleAcks,peerAcks}=retained);liveStrings=retained.strings;retainedRooms.delete(m.key);retainKey=null;const seat=room.players.find(p=>p.id===visiblePid);room.addPlayer(seat.name,ws,seat.token);ws.send(JSON.stringify({t:'prepared',id:room.game.def.id,hostId:room.hostId,phase:room.game.state.phase,strings:retained.strings}));room.broadcastState();
   }else if(m.t==='prepare'){
    room?.destroy();const id=m.id;if(!ids.includes(id))throw Error('Unknown skill fixture game');
    const game=require('../games/'+id+'/server'),p=path.join(__dirname,'../locales/en',id+'.json'),pack=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};liveStrings=pack.strings||{};
    room=new Room('HUDQ',{[id]:id==='countdown-word'?{sets:[{letters:'CHOCOLATE'.split(''),best:'chocolate'}]}:pack},{prepareTimeoutMs:20000});
    clock=new Clock(id);clock.time=Date.now();visiblePid=null;goalReached=false;visibleAcks=0;peerAcks=0;
    const original=room.ctx.bind(room);room.ctx=()=>({...original(),now:()=>clock.now(),later:(ms,fn)=>clock.later(ms,fn)});room._gameNow=()=>clock.now();
    const bots=['Ada','Bo','Cam'].map(name=>room.addPlayer(name,peerSocket()).player);
    const settings=Object.fromEntries((game.manifest.settings||[]).filter(s=>clock.opts[s.key]!==undefined).map(s=>[s.key,clock.opts[s.key]]));
    const r=room.startGame(game,{ready:true,settings},bots[0].id);if(!r.ok)throw Error(r.error);
    const s=room.game.state;targetPhase=id==='memory-tray'?'recall':id==='reaction-tap'?'go':s.phase;
    visiblePid=bots[0].id;if(id==='charades')visiblePid=bots.find(p=>p.id!==s.actor).id;if(id==='doodle-guess')visiblePid=s.drawer;if(id==='pose-party')visiblePid=s.actor;if(id==='twenty-questions')visiblePid=bots.find(p=>p.id!==s.answerer).id;if(id==='word-chain')visiblePid=s.turnPid;
    const seat=bots.find(p=>p.id===visiblePid);room.addPlayer(seat.name,ws,seat.token);
    ws.send(JSON.stringify({t:'prepared',id,hostId:room.hostId,phase:targetPhase,strings:pack.strings||{}}));room.broadcastState();
   }else if(m.t==='game-ready'&&room){
    const before=room.game,accepted=!!(before?.preparing&&m.i===before.instanceId&&m.w===room._actionToken()&&before.requiredReady.has(visiblePid)&&!before.ready.has(visiblePid));
    if(accepted)visibleAcks++;room.onReady(ws,{i:m.i,w:m.w});
    ws.send(JSON.stringify({t:'qa-ready',accepted,i:m.i,w:m.w,preparing:room.game.preparing,visibleAcks}));
    advanceToPlayable();room.broadcastState();
   }else if(m.t==='match-command'&&room){
    if(room.game.preparing)throw Error('Command cannot bypass readiness');const state=room.game.state,id=room.game.def.id;
    const act=(p,a)=>room.onAction(p.socket,a,{i:room.game.instanceId,w:room._actionToken()});
    if(m.command==='spectator'){if(state.phase!=='done')throw Error('Watcher fixture switches only after settlement');participantPid=visiblePid;room.disconnect(ws);const watcher=room.addPlayer('Late watcher',ws).player;visiblePid=watcher.id;room.broadcastState();}
    else if(m.command==='participant'){const seat=room.players.find(p=>p.id===participantPid);room.disconnect(ws);room.addPlayer(seat.name,ws,seat.token);visiblePid=participantPid;room.broadcastState();}
    else if(m.command==='retain'){retainKey='skill'+(++retainSequence);retainedRooms.set(retainKey,{room,clock,visiblePid,targetPhase,goalReached,visibleAcks,peerAcks,strings:liveStrings});ws.send(JSON.stringify({t:'qa-ack',key:retainKey}));return;}
    if(m.command==='spectator'||m.command==='participant'){ws.send(JSON.stringify({t:'qa-ack',command:m.command}));return;}
    if(m.command==='solution'){ws.send(JSON.stringify({t:'qa-ack',word:state.word??state.target??state.secret}));return;}
    if(m.command==='deadline'){clock.fire();room.broadcastState();}
    else if(m.command==='snapshot')room.broadcastState();
    else if(m.command==='others'){for(const p of room.players.filter(p=>p.id!==visiblePid)){if((id==='pose-party'||id==='show-and-go')&&state.phase==='perform')act(p,{ready:true});if((id==='pose-party'||id==='show-and-go')&&state.phase==='vote')for(const candidate of state.candidates)if(candidate!==p.id)act(p,{vote:candidate,approve:true});if(id==='countdown-word'&&state.phase==='make')act(p,{word:'late',lock:true});if(id==='scattergories'&&state.phase==='write')act(p,{answers:state.categories.map(()=>state.letter+'omething'),lock:true});if(id==='number-hunt'&&['hunt','overtime'].includes(state.phase))act(p,{guess:state.secret});if(id==='typing-race'&&state.phase==='race')act(p,{typed:state.target});if(id==='reaction-tap'&&state.phase==='go')act(p,{tap:true});if(id==='word-chain'&&state.phase==='play'&&state.turnPid===p.id)act(p,{word:state.current});}}
    else if(m.command==='rematch'){const old={i:room.game.instanceId,w:room._actionToken()},def=room.game.def;const r=room.startGame(def,{ready:true},room.hostId);if(!r.ok)throw Error(r.error);const before=JSON.stringify(def.view(room.game.state,visiblePid));room.onAction(ws,{tap:true,word:'apple',typed:room.game.state.target||''},old);if(JSON.stringify(def.view(room.game.state,visiblePid))!==before)throw Error('Stale previous-match action changed state');}
    else throw Error('Unknown match command');ws.send(JSON.stringify({t:'qa-ack',command:m.command}));
   }else if(m.t==='action'&&room){
    const preparingAtAction=room.game.preparing,actionWindow=room._actionToken(),you=room.bySocket(ws).id,before=JSON.stringify(room.game.def.view(room.game.state,you));
    room.onAction(ws,m.a,{i:m.i,w:m.w});const view=room.game.def.view(room.game.state,you),after=JSON.stringify(view);
    ws.send(JSON.stringify({t:'qa-ack',changed:before!==after,action:m.a,phase:room.game.state.phase,you,view,preparingAtAction,actionWindow,readiness:{enabled:room.game.waitForReady,visibleAcks,peerAcks}}));
   }
  }catch(e){ws.send(JSON.stringify({t:'qa-error',error:e.message}));}});
  ws.on('close',()=>{if(retainKey)room?.disconnect(ws);else room?.destroy();});
 });return server;}
module.exports={createServer,page};if(require.main===module)createServer().listen(Number(process.env.SKILL_QA_PORT||4328),'127.0.0.1',()=>console.log('Skill HUD QA: http://127.0.0.1:'+(process.env.SKILL_QA_PORT||4328)+'/'));
