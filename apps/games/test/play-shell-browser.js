'use strict';
// Local native-browser fixture: actual shared CSS and game clients inside a
// representative call panel. It models sizing, not authentication or video.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { fixtures } = require('./skill-scenes-hud-fixtures');
const ROOT = path.resolve(__dirname, '..');
function reportMarkup() {
 const source = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
 const definition = source.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)?.[0];
 if (!definition) throw Error('Production Report button declaration is unavailable.');
 return vm.runInNewContext(definition + "\nreportButton('game-report-icon')", {}, { timeout:1000 });
}
// One story has one turn per player (maximum20), not arbitrary line counts.
// Build the longest legal manuscript through the real engine, leaving turn20.
const storyDef = require('../games/story-builder/server');
const storyPlayers = Array.from({ length:20 }, (_, i) => ({ id:'shell-p' + i, name:'Friend ' + (i + 1), connected:true }));
const storyCtx = { content:() => ({}), allPlayers:() => storyPlayers, players:() => storyPlayers,
 hostId:() => storyPlayers[0].id,
 settings:() => ({ rounds:1, turnSeconds:120 }), now:() => Date.now(), later:() => () => {}, broadcast() {}, award() {} };
const storyState = storyDef.create(storyCtx);
for (let i=0;i<19;i++) storyDef.onAction(storyState,storyCtx,storyState.turn,{ line:('Sentence ' + (i + 1) + '. The unexpected visitor brought a singing suitcase. ').repeat(4).slice(0,200) });
const story = { ...storyDef.view(storyState,storyState.turn), players:storyPlayers, me:storyState.turn,
 hostId:storyPlayers[0].id, instanceId:'shell-story', serverNow:Date.now() };
const questions = structuredClone(fixtures['twenty-questions'].find(f => f.label === 'Ask').state);
questions.instanceId = 'shell-questions';
questions.maxQ = 50;
questions.questions = Array.from({ length:40 }, (_, i) => ({ pid:questions.me, text:`Question ${i + 1}: could this unusual object fit inside a singing suitcase?`, answer:['yes','no','sometimes'][i % 3] }));
questions.answered = questions.questions.length;
const menu = `<details class="room-menu" id="roomMenu"><summary aria-label="Room controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg><span>Room</span></summary><button type="button" class="room-menu-scrim" aria-label="Close room menu"></button><div class="room-menu-panel" role="dialog" aria-modal="true" aria-labelledby="roomMenuTitle"><div class="room-menu-head"><span class="room-menu-kicker">LOCAL FIXTURE</span><button type="button" class="room-close" aria-label="Close room menu">×</button></div><h2 id="roomMenuTitle">Room controls</h2><button type="button" class="room-resume">Back to game</button><div class="room-menu-actions">${['Sound on','Day','Full screen','End match'].map(x=>`<button type="button">${x}</button>`).join('')}</div><div class="scoreboard">${Array.from({length:20},(_,i)=>`<div class="score">Player ${i+1}<b>${i*100}</b></div>`).join('')}</div></div></details>`;
const PARENT = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Play shell — framed geometry</title><style>*{box-sizing:border-box}body{margin:0;padding:12px;color:#252237;background:#fafafd;font:16px/1.4 system-ui}header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}button,select{font:inherit;min-height:44px;padding:8px 12px}#call{display:flex;flex-direction:column;max-width:100%;margin:auto;border:1px solid #cfccdf;background:white;overflow:hidden}.callbar,.dock{flex:none;display:flex;align-items:center}.callbar{height:51px;padding:12px 20px;border-bottom:1px solid #cfccdf;font-size:12px;line-height:26px;white-space:nowrap;overflow:hidden}.dock{height:88px;padding:12px 8px}.dock span{height:64px;display:flex;align-items:center}.callbody{display:flex;flex:1;min-height:0;min-width:0;container:meet-call/size}.panel{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;border:2px solid #cfccdf;border-radius:16px;overflow:hidden}.panelhead{display:flex;align-items:center;gap:8px;flex:none;min-height:61px;padding:8px 10px 8px 16px;border-bottom:1px solid #cfccdf}.panelhead strong{flex:1;min-width:0}.framewrap{position:relative;flex:1;min-height:0;min-width:0}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.rail{flex:none;width:232px;overflow:auto;overscroll-behavior:contain;background:#f1f0f8}.rail p{padding:10px}#call[data-phone] .callbody{flex-direction:column}#call[data-compact-chrome] .callbar{height:47px;padding:8px 10px 12px}#call[data-compact-chrome] .dock{height:84px}#call[data-compact-chrome] .dock span{height:60px}#call[data-phone] .rail{width:auto;height:108px;display:flex;gap:12px}@container meet-call (max-height:480px){#call[data-phone] .rail{height:min(108px,22cqh)}}#call:not([data-video]) .rail{display:none}pre{white-space:pre-wrap}#metrics{margin:12px auto;max-width:1000px}</style><header><label>Game <select id="game"><option value="story">Long story</option><option value="questions">40 questions</option><option value="immersive">Immersive viewport</option></select></label><label>View <select id="size"><option>390,844</option><option>844,390</option><option>641,720</option><option>699,720</option><option>720,641</option><option>768,1024</option><option>820,1180</option><option>1024,768</option><option>1024,600</option><option>1200,836</option><option>1024,320</option><option>1024,366</option><option>806,526</option></select></label><button id="video">Video rail on</button><button id="keyboard">Reduce height for keyboard</button><button id="check">Check shell</button><button id="theme">Night theme</button></header><div id="call" data-video><div class="callbar">Representative Giggle Meet call sizing · local fixture</div><div class="callbody"><section class="panel"><div class="panelhead"><strong>Game Night</strong><span>Auto</span><button aria-label="Close games">×</button></div><div class="framewrap"><iframe id="gameframe" src="/embed?game=story" title="Actual game shell" allow="fullscreen"></iframe></div></section><aside class="rail" aria-label="Representative call friends"><p>Asha</p><p>Bo</p><p>Charlie</p><p>Dev</p></aside></div><div class="dock"><span>Call controls remain in the parent</span></div></div><pre id="metrics">Ready. This is a sizing fixture, not a live call.</pre><script>
const call=document.querySelector('#call'), frame=document.querySelector('#gameframe'), metrics=document.querySelector('#metrics');let keyboard=false,night=false;function size(){const[w,h]=document.querySelector('#size').value.split(',').map(Number);call.style.width=w+'px';call.style.height=Math.max(0,h-(keyboard?280:0))+'px';call.toggleAttribute('data-phone',w<=699&&h>w);call.toggleAttribute('data-compact-chrome',w<=699||(h<=500&&w<=950));call.toggleAttribute('data-keyboard',keyboard);metrics.textContent='Call '+w+'×'+h+'; iframe '+frame.clientWidth+'×'+frame.clientHeight+(keyboard?' (height reduction models keyboard)':'');}document.querySelector('#size').onchange=size;document.querySelector('#game').onchange=e=>{frame.src='/embed?game='+e.target.value;};document.querySelector('#keyboard').onclick=()=>{keyboard=!keyboard;size();};document.querySelector('#video').onclick=e=>{call.toggleAttribute('data-video');e.target.textContent='Video rail '+(call.hasAttribute('data-video')?'on':'off');size();};document.querySelector('#theme').onclick=()=>{night=!night;frame.contentWindow.postMessage({t:'shell-theme',night},location.origin);};document.querySelector('#check').onclick=()=>{if(frame.clientHeight<160){const report={game:document.querySelector('#game').value,geometry:'Representative encounter sizing; unsupported collapsed child',supported:false,width:frame.clientWidth,height:frame.clientHeight,callWidth:call.clientWidth,callHeight:call.clientHeight,theme:night?'night':'day',issues:['Unsupported collapsed child viewport: less than160px available after representative call chrome']};metrics.textContent=JSON.stringify(report,null,2);fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});return;}frame.contentWindow.postMessage({t:'shell-check'},location.origin);};window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin||e.data?.t!=='shell-result')return;metrics.textContent=JSON.stringify(e.data.report,null,2);fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(e.data.report)});});size();</script>`;
function child(game) {
 const immersive = game === 'immersive', utilities = menu + reportMarkup();
 return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Framed game shell</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/issues.css"><style>.fixture-viewport{height:100dvh;background:#163649;color:white;display:grid;place-items:center;font:800 24px system-ui}.fixture-viewport span{padding:20px}.fixture-footer{padding:20px;color:var(--ink-dim)}</style><body class="game-playing is-embed${immersive?' game-immersive':''}"><div id="app" class="app" ${immersive?'data-layout="immersive"':''}>${immersive?utilities+'<main id="gbody" data-layout="immersive"><div class="fixture-viewport"><span>Game-owned 100dvh viewport</span></div></main>':`<header class="play-toolbar"><div class="play-title"><div><h1>${game==='questions'?'20 Questions':'Story Builder'}</h1></div></div>${utilities}</header><main class="game-stage"><div class="game-clock"><div class="timerbar" id="tbar"><div style="width:70%"></div></div><div class="timertext" id="ttime">0:42</div></div><div id="gbody" data-layout="standard"></div></main>`}</div><script type="module">
import {openIssueReport,isReportOpen} from '/js/report-issue.js';
import {createInput} from '/js/toolkit/input.js';
const game=${JSON.stringify(game)}, root=document.querySelector('#gbody');
if(game!=='immersive'){
 const states=await(await fetch('/states')).json();
 const ui=(await import('/js/games/'+(game==='questions'?'twenty-questions':'story-builder')+'.js')).default;
 const state=states[game==='questions'?'questions':'story'];
 ui.mount?.(root,state,{});
 ui.render(root,state,{send(){return false;},now:()=>state.serverNow});
}
const room=document.querySelector('#roomMenu'), launcher=room.querySelector('summary'), reportButton=document.querySelector('[data-report]');
for(const b of document.querySelectorAll('.room-close,.room-resume,.room-menu-scrim'))b.onclick=()=>room.open=false;
const reportOptions={games:[{id:'story-builder',name:'Story Builder'},{id:'twenty-questions',name:'20 Questions'}],game:game==='story'?'story-builder':game==='questions'?'twenty-questions':'platform',phase:'play',embedded:true,url:'/fixture-report-disabled'};
reportButton.onclick=()=>{room.open=false;openIssueReport({...reportOptions,theme:document.documentElement.dataset.theme||'day'},reportButton);};
// Only the immersive shell placeholder owns a held-input probe. It uses the
// actual shared input module; this does not certify any immersive game client.
const keyEdges=[],pointerEdges=[];
const inputProbe=game==='immersive'?createInput(root,{onKey:e=>keyEdges.push(e),onPointer:e=>pointerEdges.push(e)}):null;
let releaseEvents=0,checking=false;
document.addEventListener('game-screenchange',()=>releaseEvents++);
const bounds=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
const visible=n=>{const r=bounds(n);return !!r&&r.width>0&&r.height>0&&r.top>=-1&&r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1;};
const hit=n=>{if(!visible(n))return false;const r=bounds(n),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!top&&(top===n||n.contains(top));};
const overlap=(a,b)=>!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
async function checkShell(){
 const issues=[],checks=[],supported=innerHeight>=160;
 const check=(yes,label)=>{checks.push({label,pass:!!yes});if(!yes)issues.push(label);};
 check(supported,'Supported child viewport (at least160px)');
 const clock=document.querySelector('.game-clock'),inputs=[...root.querySelectorAll('input:not(:disabled)')],input=inputs[0];
 const drafts=inputs.map(n=>({node:n,value:n.value,start:n.selectionStart,end:n.selectionEnd}));
 const composerFocus=[];
 const recordFocus=label=>{if(input)composerFocus.push({label,activeId:document.activeElement?.id,activeTag:document.activeElement?.tagName,connected:input.isConnected,value:input.value,start:input.selectionStart,end:input.selectionEnd,bounds:bounds(input)});};
 if(input){input.value='A private draft';input.focus();input.setSelectionRange(2,5);recordFocus('draft focused');}
 const snapshots=[];
 const utilityCheck=label=>{
  const snapshot={label,scrollY,room:bounds(launcher),report:bounds(reportButton),clock:bounds(clock),roomHit:hit(launcher),reportHit:hit(reportButton)};
  snapshots.push(snapshot);
  for(const [name,node] of [['Room',launcher],['Report',reportButton]]){
   const r=bounds(node);
   check(visible(node),name+' stays inside child viewport '+label);
   check(r.width>=44&&r.height>=44,name+' target is at least44×44 '+label);
   check(hit(node),name+' receives native center hit '+label);
  }
  check(!overlap(bounds(launcher),bounds(reportButton)),'Room and Report stay separate '+label);
  if(clock){
   check(visible(clock),'Timer stays inside child viewport '+label);
   for(const part of clock.querySelectorAll('.timerbar,.timertext'))for(const [name,node] of [['Room',launcher],['Report',reportButton]])check(!overlap(bounds(part),bounds(node)),'Timer content stays clear of '+name+' '+label);
  }
 };
 window.scrollTo(0,0);await tick();utilityCheck('before long scroll');recordFocus('before long scroll');
 window.scrollTo(0,document.documentElement.scrollHeight);await tick();utilityCheck('after long scroll');recordFocus('after long scroll');
 check(document.documentElement.scrollWidth<=innerWidth+1,'No horizontal document overflow');
 const longContent=document.documentElement.scrollHeight>innerHeight;
 if(game==='questions')check(root.querySelector('.tq-filter[data-filter="all"]')?.getAttribute('aria-label')==='All answers: 40','Established client retains40 history answers, including when filtered');
 if(game==='story')check(root.querySelectorAll('.party-story-line').length===19,'Legal19-line manuscript remains in established client');
 room.open=true;await tick();recordFocus('Room opened');
 const panel=room.querySelector('.room-menu-panel');
 check(visible(panel),'Room panel stays inside child viewport');
 check(panel.scrollHeight<=panel.clientHeight||getComputedStyle(panel).overflowY==='auto','Room roster has independent scroll when needed');
 room.open=false;await tick();recordFocus('Room closed');
 if(input){
  input.scrollIntoView({block:'start'});await tick();recordFocus('composer scrolled into view');
  check(visible(input),'Focused composer stays inside child viewport');
  for(const [name,node] of [['timer',clock],['Room',launcher],['Report',reportButton]])check(!overlap(bounds(input),bounds(node)),'Focused composer stays clear of '+name);
  check(document.activeElement===input&&input.value==='A private draft'&&input.selectionStart===2&&input.selectionEnd===5,'Scroll and Room preserve game draft, focus and selection');
 }
 const modalChecks=[],releaseBefore=releaseEvents,downBefore=keyEdges.length,pointerBefore=pointerEdges.length;
 if(inputProbe){
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));
  root.dispatchEvent(new PointerEvent('pointerdown',{pointerId:917,clientX:innerWidth/2,clientY:innerHeight/2,bubbles:true}));
  check(inputProbe.isDown('KeyW')&&inputProbe.pointers().size===1,'Shared input probe actually holds key and pointer before Report');
 }
 // The hit test above establishes reachability; click invokes the production
 // dialog handler. No report request is submitted by these automatic checks.
 reportButton.focus({preventScroll:true});reportButton.click();await tick();
 const dialog=document.querySelector('dialog[open]');
 check(isReportOpen()&&!!dialog,'Actual Report modal opens');
 if(dialog){
  const close=dialog.querySelector('.issue-close'),cancel=dialog.querySelector('.issue-cancel'),send=dialog.querySelector('.issue-send'),fields=dialog.querySelector('.issue-fields'),title=dialog.querySelector('#issueTitle');
  const modalGeometry=label=>{
   modalChecks.push({label,dialog:bounds(dialog),header:bounds(dialog.querySelector('.issue-head')),footer:bounds(dialog.querySelector('.issue-actions')),title:bounds(title),titleFontSize:getComputedStyle(title).fontSize,closeHit:hit(close),cancelHit:hit(cancel),sendHit:hit(send),fields:bounds(fields),fieldsClientHeight:fields.clientHeight,fieldsScrollHeight:fields.scrollHeight});
   check(visible(dialog),'Report dialog stays inside child viewport '+label);
   check(visible(fields)&&fields.clientHeight>=44,'Report fields remain visible with at least44px available '+label);
   check(visible(title)&&!overlap(bounds(title),bounds(close)),'Report title stays visible and clear of Close '+label);
   check(!overlap(bounds(title),bounds(fields))&&!overlap(bounds(title),bounds(dialog.querySelector('.issue-actions'))),'Report title stays clear of fields and footer '+label);
   for(const [name,node] of [['Close',close],['Cancel',cancel],['Send',send]]){
    const r=bounds(node);check(visible(node)&&r.width>=44&&r.height>=44&&hit(node),'Report '+name+' stays visible,44px and receives native hit '+label);
   }
  };
  check(document.activeElement===close,'Report initially focuses Close without focusing a text field');
  check(releaseEvents===releaseBefore+1,'Report opening dispatches one input-release event');
  if(inputProbe){
   check(!inputProbe.keys().length&&!inputProbe.pointers().size,'Report releases shared toolkit held key and pointer');
   check(keyEdges.slice(downBefore).filter(e=>e.type==='up').length===1&&pointerEdges.slice(pointerBefore).filter(e=>e.type==='cancel').length===1,'Held key/pointer each release once on Report opening');
  }
  modalGeometry('before field scroll');
  fields.scrollTop=fields.scrollHeight;await tick();modalGeometry('after field scroll');
  check(fields.scrollHeight<=fields.clientHeight||getComputedStyle(fields).overflowY==='auto','Report fields own independent scrolling when needed');
  let escaped=0;const leak=()=>escaped++;window.addEventListener('keydown',leak);
  close.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));
  window.removeEventListener('keydown',leak);
  check(escaped===0&&(!inputProbe||!inputProbe.isDown('KeyW')),'Report keyboard does not reach game input');
  const description=dialog.querySelector('[name=description]');
  description.value='A fixture-only unsent report draft.';description.dispatchEvent(new Event('input',{bubbles:true}));
  close.click();await tick();
  check(!isReportOpen()&&document.activeElement===reportButton,'Closing Report restores its current opener focus');
  check(releaseEvents===releaseBefore+2,'Report closing dispatches one input-release event');
  check(visible(reportButton)&&hit(reportButton),'Report opener remains inside child viewport and receives native hit after close');
  if(inputProbe){
   window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w',bubbles:true}));
   root.dispatchEvent(new PointerEvent('pointerup',{pointerId:917,bubbles:true}));
   check(keyEdges.slice(downBefore).filter(e=>e.type==='up').length===1&&pointerEdges.slice(pointerBefore).filter(e=>e.type==='cancel').length===1,'Late physical release does not duplicate released toolkit inputs');
   window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w',bubbles:true}));
   check(inputProbe.isDown('KeyW'),'Shared toolkit input resumes after Report close');inputProbe.releaseAll();
  }
  reportButton.click();await tick();
  const reopened=document.querySelector('dialog[open]');
  check(reopened?.querySelector('[name=description]').value==='A fixture-only unsent report draft.','Report draft survives closing and reopening');
  reopened?.querySelector('.issue-cancel').click();await tick();
  check(document.activeElement===reportButton,'Report Cancel restores opener focus');
 }
 for(const d of drafts){
  check(d.node.isConnected&&root.contains(d.node)&&d.node.value===(d.node===input?'A private draft':d.value),'Report preserves mounted game composer and private draft');
  if(d.node===input){d.node.focus({preventScroll:true});d.node.setSelectionRange(2,5);check(d.node.selectionStart===2&&d.node.selectionEnd===5,'Game selection remains available after modal focus recovery');}
  d.node.value=d.value;if(d.start!==null)d.node.setSelectionRange(d.start,d.end);
 }
 const viewport=document.querySelector('.fixture-viewport');
 if(viewport)check(Math.abs(viewport.clientHeight-innerHeight)<=1,'Immersive shell surface fits actual child viewport');
 return {game,geometry:'Representative encounter sizing from Meet source; actual React host verified separately',coverage:'Long embedded shell composition, not all42 games or a Room readiness certification',supported,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',clockHeight:clock?.getBoundingClientRect().height,roomHeight:launcher.getBoundingClientRect().height,reportHeight:reportButton.getBoundingClientRect().height,inputHeight:input?.getBoundingClientRect().height,historyRows:root.querySelectorAll('.party-story-line,.tq-row').length,longContent,utilitySnapshots:snapshots,composerFocus,modalGeometry:modalChecks,heldInputCoverage:inputProbe?'Actual shared input toolkit on shell placeholder; no immersive game client certified':'Not applicable: actual text clients have no continuously held controls',checks,issues};
}
window.addEventListener('message',async e=>{
 if(e.source!==parent||e.origin!==location.origin)return;
 if(e.data?.t==='shell-theme'){document.documentElement.dataset.theme=e.data.night?'night':'day';return;}
 if(e.data?.t!=='shell-check'||checking)return;
 checking=true;
 try{parent.postMessage({t:'shell-result',report:await checkShell()},location.origin);}
 catch(error){document.querySelector('.issue-close')?.click();parent.postMessage({t:'shell-result',report:{game,supported:innerHeight>=160,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',issues:['Fixture check failed: '+error.message]}},location.origin);}
 finally{checking=false;}
});</script></body></html>`;
}
if (require.main === module && process.argv.includes('--serve')) {
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(PARENT);return;}
  if(url.pathname==='/embed'){res.setHeader('Content-Type','text/html');res.end(child(['story','questions','immersive'].includes(url.searchParams.get('game'))?url.searchParams.get('game'):'story'));return;}
  if(url.pathname==='/states'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({story,questions}));return;}
  if(url.pathname==='/report'&&req.method==='POST'){let data='';req.on('data',x=>data+=x);req.on('end',()=>{const report=JSON.parse(data),dir=path.join(ROOT,'evidence/quality-20261009');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`play-shell-${report.game}-${report.width}x${report.height}-${report.theme}.json`),JSON.stringify(report,null,2)+'\n');res.end('Saved');});return;}
  const file=path.resolve(ROOT,'public','.'+url.pathname),base=path.join(ROOT,'public')+path.sep;
  if(!file.startsWith(base)||!fs.existsSync(file)){res.statusCode=404;res.end('Not found');return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 server.listen(Number(process.env.PLAY_SHELL_QA_PORT||8167),'127.0.0.1',()=>console.log('PLAY_SHELL_QA http://127.0.0.1:'+server.address().port));
}
if (require.main === module && process.argv.includes('--check')) {
 const assert=require('node:assert/strict'), AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 let checks=0;
 const check=(value,message)=>{assert.ok(value,message);checks++;};
 check(story.phase==='build'&&story.me===story.turn&&story.totalTurns===20&&story.lines.length===19,'Story is legal twentieth writer after19 accepted lines');
 check(story.lines.every(line=>line.text.length===200),'Story stress uses authority-bounded200-character lines');
 check(questions.maxQ===50&&questions.answered===40&&questions.questions.length===40,'20Q history remains within its established50-question budget');
 new vm.Script(PARENT.match(/<script>([\s\S]*?)<\/script>/)[1]);checks++;
 check(PARENT.includes('<option>806,526</option>'),'806×526 representative call option exposes568×320 child with video rail');
 for(const game of ['story','questions','immersive']){
  const html=child(game),script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  new AsyncFunction(script.replace(/^import .*?;$/gm,''));checks++;
  check(html.includes(reportMarkup())&&(html.match(/data-report aria-label/g)||[]).length===1,game+' uses exactly one current production Report button');
  check(html.indexOf('/css/style.css')<html.indexOf('/css/game-ui.css')&&html.indexOf('/css/game-ui.css')<html.indexOf('/css/issues.css'),game+' preserves production shared stylesheet order');
  check(script.includes("from '/js/report-issue.js'")&&script.includes("from '/js/toolkit/input.js'"),game+' imports real report modal and held-input toolkit');
  check(script.includes("document.elementFromPoint(")&&script.includes("utilityCheck('before long scroll')")&&script.includes("utilityCheck('after long scroll')"),game+' checks native hit targets on both sides of scroll');
  check(script.includes('visible(fields)&&fields.clientHeight>=44')&&script.includes('!overlap(bounds(title),bounds(close))'),game+' rejects collapsed fields and title/Close overlap');
  check(script.includes("url:'/fixture-report-disabled'")&&!script.includes('requestSubmit('),game+' automatic checks do not submit an external report');
  check(script.includes('composerFocus,modalGeometry:')&&['draft focused','before long scroll','after long scroll','Room opened','Room closed','composer scrolled into view'].every(label=>script.includes("recordFocus('"+label+"')")),game+' retains passive composer focus/draft/selection diagnostics at all six checkpoints');
 }
 console.log('PLAY_SHELL_FIXTURE_PASS: '+checks+' source/fixture checks; browser geometry remains native-only');
}
module.exports={story,questions,child,reportMarkup};
