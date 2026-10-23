'use strict';
// Engine-backed HUD fixtures and real WebSocket/Room action acknowledgements.
// Browser geometry/actions live in skill-scenes-hud-browser.js.
const assert=require('node:assert/strict');
const {once}=require('node:events');
const WebSocket=require('ws');
const {fixtures,ids,accepted}=require('./skill-scenes-hud-fixtures');
const {createServer,page}=require('./skill-scenes-hud-browser');
const vm=require('node:vm');
function action(id,s){switch(id){case'charades':return{guess:'a friendly guess'};case'chess':return{move:{from:'e2',to:'e4'}};case'countdown-word':return{word:'late',lock:true};case'doodle-guess':return{choose:s.choices[0]};case'draw-phone':return{phrase:'A tiny dragon baking a cake'};case'memory-tray':return{recall:'apple, candle'};case'number-hunt':return{guess:42};case'pose-party':case'show-and-go':return{ready:true};case'reaction-tap':return{tap:true};case'scattergories':return{answers:['seal','','','','']};case'twenty-questions':return{question:'Is it alive?'};case'typing-race':return{typed:s.target.slice(0,5)};case'warm-words':return{guess:'kitchen'};case'word-chain':return{word:s.current==='apple'?'fruit':'apple'};}}
async function main(){let checks=0;
 const {createResultPresentation}=await import('../public/js/toolkit/result-presentation.mjs');
 const browserModule=page().match(/<script type="module">([\s\S]*)<\/script>/)[1];
 new vm.Script('(async()=>{'+browserModule.replace(/^import[^\n]+\n/gm,'')+'})()');checks++;
 // Execute actual full-match branches and visible batch callbacks, with bounded
 // DOM/transport stand-ins; actual authority remains in the WS transport test.
 const matchSource=browserModule.slice(browserModule.indexOf('async function matchCommand('),browserModule.indexOf("document.querySelector('#live')"));
 const buttons={},saved=[],fullContext={assert:(ok,message)=>assert(ok,message),liveMode:false,S:null,actions:[],settlements:[],readyAcks:[],status:{},socket:null,Event:class {},PointerEvent:class {},document:{querySelector:id=>buttons[id]??=( {})},auditViewport:async fn=>fn(),save:async(kind,results)=>saved.push({kind,results}),retire:()=>{},stableMatch:async()=>{},utilityGeometry:()=>({pass:true})};
 function fixtureFinalProjection(id){const state=fixtures[id].find(f=>f.state.phase==='done')?.state;assert(state,'Actual engine done projection '+id);return state;}
 let ackResolve,instanceCount=0;
 fullContext.acknowledgement=()=>new Promise(resolve=>ackResolve=resolve);
 const acceptFixtureAction=()=>{fullContext.actions.push({});ackResolve({changed:true,preparingAtAction:false});};
 fullContext.fill=()=>({dispatchEvent:acceptFixtureAction});fullContext.click=acceptFixtureAction;fullContext.el={querySelector:()=>({dispatchEvent:acceptFixtureAction})};
 fullContext.prepareSocket=async(id,key)=>{if(!key){fullContext.S={instanceId:'match'+(++instanceCount),...fixtureFinalProjection(id),phase:'play',categories:['animal'],letter:'S',target:'words',current:'apple'};fullContext.readyAcks=[];}fullContext.socket={close(){},send(raw){const m=JSON.parse(raw),c=m.command;if(c==='deadline'&&fullContext.S.phase!=='done'){fullContext.S.phase='done';fullContext.settlements.push({});}if(c==='spectator')fullContext.S.spectator=true;if(c==='participant')fullContext.S.spectator=false;if(c==='rematch'){fullContext.S.instanceId='rematch'+instanceCount;fullContext.S.phase='play';fullContext.readyAcks.push({instanceId:fullContext.S.instanceId});}ackResolve({word:'apple',key:c==='retain'?'retained':undefined});}};};
 vm.createContext(fullContext);vm.runInContext(matchSource,fullContext);
 await buttons['#fullmatches'].onclick();await buttons['#cameramatches'].onclick();
 assert.equal(saved.length,2);assert.equal(saved[0].results.length,7);assert.equal(saved[1].results.length,3);
 for(const batch of saved)for(const result of batch.results){assert.equal(result.pass,true,result.id+': '+result.error);assert.equal(result.finishedReconnect,true);assert.equal(result.staleRejected,true);checks+=3;}
 checks+=3;
 const retiredContext=vm.createContext({hostMode:true,current:{},painted:{},el:{innerHTML:'retired warm-words markup'},hostReset:()=>{}});vm.runInContext(browserModule.match(/function retire\(\)\{[^}]*\}/)[0]+';retire()',retiredContext);assert.equal(retiredContext.el.innerHTML,'','Retirement clears fixture DOM after host disposes CSS');checks++;
 const oracle=browserModule.slice(browserModule.indexOf('const noScrollFields='),browserModule.indexOf('function geometry('));
 const target={left:10,top:100,right:500,bottom:410,width:490,height:310};
 const node={getBoundingClientRect:()=>target};
 const context={innerWidth:568,innerHeight:320,S:{phase:'go'},ownedIds:['reaction-tap','scattergories'],el:{querySelectorAll:selector=>selector==='#rPad'?[node]:[]},document:{querySelector:()=>null},getComputedStyle:()=>({display:'block',visibility:'visible'}),assert:(ok,message)=>assert(ok,message),rect:n=>{const r=n.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height};}};
 vm.createContext(context);vm.runInContext(oracle,context);
 assert.throws(()=>vm.runInContext('visiblePlayfield("reaction-tap","test")',context),/outside visible landscape/);checks++;
 target.bottom=310;target.height=210;assert.equal(vm.runInContext('visiblePlayfield("reaction-tap","test").checks',context),1);checks++;
 // Scattergories owns a flowing answer sheet; it must not inherit the
 // timed contact-pad's no-scroll requirement merely because it is long.
 assert.equal(vm.runInContext('visiblePlayfield("scattergories","long sheet").checks',context),0);checks++;

 // The utility oracle must detect missing/small/offscreen/covered controls
 // and collisions with either current title glyphs or timer text.
 const box=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
 const reportBox=box(512,10,44,44),roomBox=box(460,10,44,44),titleBox=box(12,18,150,24),timerBox=box(236,20,96,20);
 const targetNode=(id,b)=>({id,tagName:'BUTTON',getClientRects:()=>[b],getBoundingClientRect:()=>b,contains:()=>false,matches:()=>id==='title'});
 const reportNode=targetNode('report',reportBox),roomNode=targetNode('room',roomBox),titleNode=targetNode('title',titleBox),timerNode=targetNode('timer',timerBox);
 let cover=false,hidden=false;const utilityDoc={querySelector:s=>s==='.game-report-icon'?reportNode:roomNode,querySelectorAll:()=>[titleNode,timerNode],
  elementFromPoint:x=>cover?titleNode:x>=512?reportNode:roomNode,createRange:()=>({selectNodeContents(){},getClientRects:()=>[titleBox]})};
 const utilityContext=vm.createContext({innerWidth:568,innerHeight:320,S:{phase:'hunt'},lastUtilityGeometry:null,document:utilityDoc,insideViewport:context.insideViewport,
  getComputedStyle:()=>({visibility:hidden?'hidden':'visible',display:'block'}),assert});
 vm.runInContext(browserModule.slice(browserModule.indexOf('function utilityGeometry('),browserModule.indexOf('function geometry(')),utilityContext);
 const utilities=()=>vm.runInContext('utilityGeometry("number-hunt","oracle")',utilityContext);
 assert.equal(utilities().checks,13);checks++;
 reportBox.width=42;assert.throws(utilities,/target below44px/);reportBox.width=44;checks++;
 reportBox.right=570;assert.throws(utilities,/outside visible viewport/);reportBox.right=556;checks++;
 cover=true;assert.throws(utilities,/center covered/);cover=false;checks++;
 hidden=true;assert.throws(utilities,/is hidden/);hidden=false;checks++;
 roomBox.right=520;assert.throws(utilities,/Report intersects Room/);roomBox.right=504;checks++;
 titleBox.right=520;assert.throws(utilities,/intersects title/);titleBox.right=162;checks++;
 timerBox.right=530;assert.throws(utilities,/intersects timer/);timerBox.right=332;checks++;
 const html=page(),appSource=require('node:fs').readFileSync(require.resolve('../public/js/app.js'),'utf8');
 const reportDefinition=appSource.match(/function reportButton\(extraClass = ''\) \{[\s\S]*?\n\}/)[0];
 const actualMarkup=vm.runInNewContext(reportDefinition+"\nreportButton('game-report-icon')");
 assert(html.includes(actualMarkup),'fixture uses current pure production Report button');checks++;
 assert(html.includes('id="roomMenu"><summary aria-label="Room controls"><svg'),'fixture uses actual Room icon selector');checks++;
 assert(html.indexOf('/css/issues.css')>html.indexOf('/css/game-ui.css'),'production report CSS loads after game styles');checks++;
 assert(browserModule.includes("import {openIssueReport} from '/js/report-issue.js'"),'fixture opens production Report modal');checks++;

 // A fresh mounted projection must not inherit a previous field's focus
 // scroll. Exercise the actual mount and settlement functions; live paint
 // still preserves the player's intentional reading position.
 const events=[],nodes=new Map(),window={scrollY:103,scrollTo(x,y){events.push('restore');this.scrollY=y;}};
 const mounted={render(){events.push('paint');if(events.filter(e=>e==='paint').length===1)window.scrollY=103;}};
 const origin=vm.createContext({el:{innerHTML:''},current:null,S:null,Date,window,
  document:{querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},api:{},
  retire:()=>events.push('retire'),view:async()=>mounted,criticalStyles:async()=>events.push('required styles'),projection:()=>({endsAt:Date.now()+10000}),
  styles:async()=>{events.push('settled styles');window.scrollY=88;},wait:async()=>events.push('frame')});
 const sourceFunction=name=>browserModule.slice(browserModule.indexOf((name==='paint'?'function ':'async function ')+name+'(')).split('\n')[0];
 vm.runInContext([sourceFunction('paint'),sourceFunction('settleScenario'),sourceFunction('mount')].join('\n'),origin);
 await vm.runInContext('mount("typing-race")',origin);
 assert.deepEqual(events,['retire','required styles','paint','settled styles','restore','frame']);checks++;
 assert.equal(window.scrollY,0,'new scenario returns to document origin after asynchronous focus/styles');checks++;
 window.scrollY=37;await vm.runInContext('paint(current,S)',origin);
 assert.equal(window.scrollY,37,'same-window live paint preserves scroll');checks++;
 assert.equal(events.filter(e=>e==='restore').length,1,'only the new mount resets fixture scroll');checks++;

 // Room.onReady synchronously broadcasts release before the fixture sends
 // its separate qa-ready packet. Browser message tasks can paint release
 // first. Exercise the real prepareSocket function under both packet/paint
 // orders, including rejected/stale confirmations and an unfinished paint.
 const socketSource=browserModule.slice(browserModule.indexOf('async function prepareSocket('),browserModule.indexOf('function acknowledgement('));
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 async function readinessOrder(replyFirst){
  let outcome=null,finishPaint=null,timer=null;
  const readyAcks=[],readyReplies=[],view={},observations=[],settlements=[];
  const presentation=createResultPresentation(snapshot=>settlements.push(snapshot));
  const observe=presentation.observe;presentation.observe=(previous,snapshot)=>{observations.push({previous,snapshot});observe(previous,snapshot);};
  const boundary=vm.createContext({liveReady:false,socket:null,current:null,hostMode:false,lastSocketState:null,preparedMeta:null,S:null,painted:null,
   readyAcks,readyReplies,presentation,el:{setAttribute(){}},location:{host:'fixture'},retire(){},paintChrome(){},api:{},liveMode:false,assert,
   WebSocket:class {send(){}close(){}},
   setTimeout:fn=>(timer={fn,active:true}),clearTimeout:t=>{t.active=false;},
   hostShow:async(el,id,snapshot)=>{if(snapshot.preparing){readyAcks.push({instanceId:snapshot.instanceId,window:snapshot.w});return view;}
    if(replyFirst)return new Promise(resolve=>{finishPaint=()=>resolve(view);});return view;}});
  vm.runInContext(socketSource,boundary);
  const pending=vm.runInContext('prepareSocket("number-hunt")',boundary);
  pending.then(()=>{outcome='released';},error=>{outcome=error.message;});
  const emit=msg=>boundary.socket.onmessage({data:JSON.stringify(msg)});
  emit({t:'prepared',hostId:'a',phase:'hunt',strings:{}});
  const state={t:'state',instanceId:'scene',w:'2|hunt',you:'a',phase:'hunt',preparing:true};
  emit(state);await flush();assert.equal(readyAcks.length,1);checks++;
  assert.equal(observations.length,1,'painted preparation reaches the production presentation helper');assert.equal(observations[0].snapshot,boundary.painted);checks+=2;
  const reply={t:'qa-ready',i:'scene',w:'2|hunt',accepted:true};
  if(replyFirst){emit(reply);await flush();assert.equal(outcome,null,'accepted readiness cannot bypass preparation');checks++;}
  emit({...state,preparing:false});await flush();
  assert.equal(outcome,null,replyFirst?'accepted readiness cannot bypass pending scene paint':'painted release must wait for accepted readiness reply');checks++;
  assert.equal(boundary.liveReady,false,'action gate remains closed until both conditions');checks++;
  assert.equal(observations.length,replyFirst?1:2,'unpainted release cannot reach the presentation helper');checks++;
  if(replyFirst){finishPaint();}else{
   for(const bad of [{...reply,accepted:false},{...reply,i:'old-scene'},{...reply,w:'1|hunt'}]){
    emit(bad);await flush();assert.equal(outcome,null,'rejected/retired readiness reply cannot confirm current window');checks++;
   }
   emit(reply);
  }
  await pending;await flush();assert.equal(outcome,'released');assert.equal(boundary.liveReady,true);assert.equal(boundary.painted,boundary.S);assert.equal(timer.active,false);checks+=4;
  assert.equal(observations.length,2);assert.equal(observations[1].snapshot,boundary.painted,'presentation observes the accepted current paint');assert.equal(observations[1].previous.preparing,true);assert.equal(settlements.length,0,'ready active scenes do not settle a final result');checks+=4;
 }
 await readinessOrder(false);await readinessOrder(true);

 for(const id of ids){const states=fixtures[id].map(f=>f.state);assert(states.some(s=>s.phase==='done'),id+' finished projection');assert(states.some(s=>s.spectator&&s.phase!=='done'),id+' watcher projection');checks+=2;
  for(const s of states){assert.equal(typeof s.instanceId,'string');if(s.phase==='done')assert.equal(s.endsAt||0,0,id+' finished deadline');if(s.spectator){assert(!s.wordShown,id+' watcher secret');if(s.phase!=='reveal'&&s.phase!=='done'){assert(!s.word,id+' watcher word');assert(!s.myPrompt,id+' watcher prompt');assert(!s.choices?.length,id+' watcher word choices');}}if(id==='memory-tray'&&s.phase==='recall')assert(!s.items,'tray stays hidden during recall');if(id==='countdown-word'&&s.phase==='make')assert(!s.best&&Object.keys(s.answers||{}).length===0,'active letter desk hides answers');if(id==='warm-words'&&s.phase==='guess')assert(!s.target,'semantic target hidden');checks++;}
 }
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;const acknowledged=[],sockets=[];
 try{for(const id of ids){
  const ws=new WebSocket('ws://127.0.0.1:'+port+'/socket');sockets.push(ws);await once(ws,'open');
  let state=null,meta=null,autoReady=false;const inbox=[],delivered=[],readyWindows=new Set();
  const ready=s=>{if(!s?.preparing||readyWindows.has(s.w))return;readyWindows.add(s.w);ws.send(JSON.stringify({t:'game-ready',i:s.instanceId,w:s.w}));};
  ws.on('message',text=>{const m=JSON.parse(text);inbox.push(m);delivered.push(m);if(m.t==='state'){state=m;if(autoReady)ready(m);}if(m.t==='prepared')meta=m;});
  const until=async(fn,label)=>{const end=Date.now()+5000;for(;;){const error=inbox.find(m=>m.t==='qa-error');if(error)throw Error(error.error);const value=fn();if(value)return value;assert(Date.now()<end,id+' '+label+' timed out');await new Promise(r=>setTimeout(r,5));}};
  const next=(type,predicate=()=>true)=>until(()=>{const index=inbox.findIndex(m=>m.t===type&&predicate(m));return index<0?null:inbox.splice(index,1)[0];},type);
  ws.send(JSON.stringify({t:'prepare',id}));await until(()=>meta&&state?.preparing,'initial held visible readiness');
  // The old fixture submitted on `prepared`. It must now reject that path.
  ws.send(JSON.stringify({t:'action',a:action(id,state),i:state.instanceId,w:state.w}));
  const early=await next('qa-ack');assert.equal(early.changed,false,id+' action rejected before renderer readiness');assert.equal(early.preparingAtAction,true);checks+=2;
  for(const bad of [{i:'retired-instance',w:state.w},{i:state.instanceId,w:'retired-window'}]){
   ws.send(JSON.stringify({t:'game-ready',...bad}));const reply=await next('qa-ready');assert.equal(reply.accepted,false,id+' stale readiness rejected');assert.equal(reply.preparing,true,id+' stale readiness cannot release the visible seat');checks+=2;
  }
  autoReady=true;ready(state);await until(()=>state&&!state.preparing&&state.phase===meta.phase,'actual released playable window');
  assert(readyWindows.size>=(['memory-tray','reaction-tap'].includes(id)?2:1),id+' actual phase barriers acknowledged');checks++;
  const releasedInstance=state.instanceId,releasedWindow=state.w;
  const confirmation=await next('qa-ready',m=>m.accepted&&m.i===releasedInstance&&m.w===releasedWindow);
  assert(readyWindows.has(releasedWindow),id+' visible seat acknowledged the released window');checks++;
  assert(confirmation.visibleAcks>=1,id+' Room confirmed the visible readiness packet');checks++;
  const releaseIndex=delivered.findIndex(m=>m.t==='state'&&!m.preparing&&m.instanceId===releasedInstance&&m.w===releasedWindow);
  assert(releaseIndex>=0&&releaseIndex<delivered.indexOf(confirmation),id+' actual Room release arrives before the separate readiness reply');checks++;
  ws.send(JSON.stringify({t:'action',a:action(id,state),i:state.instanceId,w:'retired-window'}));const stale=await next('qa-ack');assert.equal(stale.changed,false,id+' stale action window rejected after release');checks++;
  ws.send(JSON.stringify({t:'action',a:action(id,state),i:state.instanceId,w:state.w}));const result=await next('qa-ack');
  assert(result.changed&&accepted(id,result.view,result.you,result.action),id+' Room accepts the intended released-window action');assert.equal(result.preparingAtAction,false);assert.equal(result.readiness.enabled,true);assert(result.readiness.visibleAcks>=1);checks+=4;
  ws.close();await once(ws,'close');acknowledged.push(id);
 }}
 finally{for(const ws of sockets)if(ws.readyState!==WebSocket.CLOSED)ws.terminate();await new Promise(resolve=>server.close(resolve));}
 assert.equal(acknowledged.length,15);console.log('SKILL_HUD_PASS: '+checks+' assertions, '+Object.values(fixtures).flat().length+' declared real-engine projections,15 tokenized readiness/released-window WebSocket actions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
