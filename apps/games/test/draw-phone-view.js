'use strict';
// Finite shipped-client checks. Actual browser layout/input is recorded separately.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let checks=0;function ok(v,m){assert(v,m);checks++;}function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
class Node {
 constructor(tag,doc,attrs={}){this.tagName=tag;this.doc=doc;this.attrs=attrs;this.children=[];this.parentNode=null;this.text='';this.events=new Map();this.dataset={};for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,a)=>a.toUpperCase())]=v;this.classList={contains:x=>(this.attrs.class||'').split(/\s+/).includes(x),add:(...xs)=>{this.attrs.class=[...new Set([...(this.attrs.class||'').split(/\s+/).filter(Boolean),...xs])].join(' ')},toggle:(x,on)=>{const present=this.classList.contains(x),want=on===undefined?!present:on;this.attrs.class=(this.attrs.class||'').split(/\s+/).filter(c=>c&&c!==x).concat(want?[x]:[]).join(' ');return want;}};}
 append(n){return this.appendChild(n);}
 contains(n){for(let p=n;p;p=p.parentNode)if(p===this)return true;return false;}
 get id(){return this.attrs.id||'';}set id(v){this.attrs.id=String(v);}
 hasAttribute(k){return k in this.attrs;}
 getClientRects(){for(let n=this;n;n=n.parentNode)if(n.hidden)return[];return[{}];}
 appendChild(n){n.parentNode=this;this.children.push(n);return n;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
 set innerHTML(html){if(this.doc.activeElement!==this&&this.contains(this.doc.activeElement))this.doc.activeElement=this.doc.body;this.html=html;this.children=[];this.text='';const stack=[this],re=/<(\/?)([\w-]+)([^>]*)>|([^<]+)/g;let m;while((m=re.exec(html))){if(m[4]){stack.at(-1).text+=m[4];continue;}const [,closing,tag,raw]=m;if(closing){while(stack.length>1){const old=stack.pop();if(old.tagName===tag)break;}continue;}const attrs={},ar=/([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s/]+)))?/g;let a;while((a=ar.exec(raw)))attrs[a[1]]=a[2]??a[3]??a[4]??'';const n=new Node(tag,this.doc,attrs);stack.at(-1).appendChild(n);if(!raw.endsWith('/')&&!['link','input','br','img'].includes(tag))stack.push(n);}}
 get innerHTML(){return this.html||'';}
 matches(sel){sel=sel.trim();if(!sel)return false;const base=sel.replace(/\[[^\]]*\]/g,'');const tag=base.match(/^[\w-]+/);if(tag&&this.tagName!==tag[0])return false;for(const cls of base.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls[1]))return false;const id=base.match(/#([\w-]+)/);if(id&&this.attrs.id!==id[1])return false;for(const a of sel.matchAll(/\[([\w-]+)(?:="?([^\]"]+)"?)?\]/g)){if(!(a[1] in this.attrs))return false;if(a[2]!==undefined&&this.attrs[a[1]]!==a[2])return false;}return true;}
 closest(sel){for(let n=this;n;n=n.parentNode)if(sel.split(',').some(s=>n.matches(s)))return n;return null;}
 querySelectorAll(sel){const out=[];function walk(n){for(const child of n.children){if(sel.split(',').some(s=>child.matches(s)))out.push(child);walk(child);}}walk(this);return out;}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 get hidden(){return 'hidden' in this.attrs;}set hidden(v){if(v)this.attrs.hidden='';else delete this.attrs.hidden;}
 get disabled(){return 'disabled' in this.attrs;}set disabled(v){if(v)this.attrs.disabled='';else delete this.attrs.disabled;}
 set textContent(s){this.text=String(s);this.children=[];}get textContent(){return this.text+this.children.map(n=>n.textContent).join('');}
 addEventListener(k,f){if(!this.events.has(k))this.events.set(k,new Set());this.events.get(k).add(f);}removeEventListener(k,f){this.events.get(k)?.delete(f);}
 dispatch(type,extra={}){const e={type,target:this,preventDefault(){this.prevented=true},...extra};for(let n=this;n;n=n.parentNode)for(const f of [...(n.events.get(type)||[])])f(e);return e;}
 focus(){this.doc.activeElement=this;this.dispatch('focusin');}
}

Object.defineProperties(Node.prototype,{width:{get(){return Number(this.attrs.width)||880}},height:{get(){return Number(this.attrs.height)||520}}});
Node.prototype.getBoundingClientRect=function(){return{left:0,top:0,width:this.width,height:this.height}};
Node.prototype.getContext=function(){if(!this.ctx)this.ctx={ops:[],clearRect(){this.ops=[]},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){this.ops.push({color:this.fillStyle,width:this.lineWidth})},stroke(){this.ops.push({color:this.strokeStyle,width:this.lineWidth})}};return this.ctx};
function rig(){
 const document={activeElement:null,createElement(tag){return new Node(tag,this)},getElementById(id){return this.root.querySelector('#'+id)},querySelector(sel){return this.root.querySelector(sel)}};
 document.root=new Node('document',document);document.head=document.root.appendChild(new Node('head',document));document.body=document.root.appendChild(new Node('body',document));document.activeElement=document.body;
 document.addEventListener=document.root.addEventListener.bind(document.root);document.removeEventListener=document.root.removeEventListener.bind(document.root);
 const el=document.body.appendChild(new Node('main',document)),outside=document.body.appendChild(new Node('button',document)),window=new Node('window',document);window.PointerEvent=function(){};
 const sent=[],timers=[],scrolls=[],cues=[];let clock=1000;window.scrollTo=options=>scrolls.push(options);
 const api={cue:(name,options)=>cues.push({name,...options}),send:a=>sent.push(JSON.parse(JSON.stringify(a))),focus:n=>n?.focus()};
 const context=vm.createContext({document,window});
 vm.runInContext(fs.readFileSync('public/js/util.js','utf8').replace(/^export /gm,''),context);
 // The game kit shares util's helpers; inline it after util.
 vm.runInContext(fs.readFileSync('public/js/kit.js','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export \{[^}]*\};?\s*$/m,'').replace(/^export /gm,''),context);
 vm.runInContext(fs.readFileSync('public/js/games/draw-phone.js','utf8').replace(/^import[^;]+;\s*/gm,'').replace('export default','globalThis.view='),context);
 const def=require('../games/draw-phone/server'),players=[{id:'a',name:'Ada Fern, watercolor artist'},{id:'b',name:'Bo River, sketchbook collector'},{id:'c',name:'<img onerror="unsafe">'}],awards=[];
 const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({writeSeconds:30,drawSeconds:90,guessSeconds:30}),content:()=>({starters:['A cat wearing a tiny hat','A koala piloting a balloon','An otter making waffles']}),now:()=>clock,later(ms,fn){timers.push({at:clock+ms,fn})},award:(...a)=>awards.push(a),broadcast(){}};
 const state=def.create(ctx);
 const S=pid=>JSON.parse(JSON.stringify({...def.view(state,pid),players,me:pid,spectator:!players.some(p=>p.id===pid),instanceId:'one'}));
 const render=pid=>context.view.render(el,S(pid),api),act=(a,pid='a')=>def.onAction(state,ctx,pid,a);
 const click=selector=>{const n=el.querySelector(selector);ok(n&&!n.disabled,'active '+selector);n.onclick?.({});};
 const pointer=(target,type,id,x,y)=>target.dispatch(type,{pointerId:id,button:0,clientX:x*880,clientY:y*520});
 const deadline=()=>{clock=state.endsAt;act({});};
 return{el,document,outside,window,api,sent,cues,timers,scrolls,awards,state,S,render,act,click,pointer,deadline,view:context.view};
}
function main(){
{
 const r=rig();r.render('a');eq(r.document.activeElement,r.document.body,'mount never autofocuses');ok(r.el.querySelector('.dp-book')&&r.el.querySelector('.gk-hud')&&r.el.querySelector('.sk-steps'),'flat page with the HUD and steps mounts');ok(!r.el.querySelector('img'),'escaped names do not make markup');
 const phrase=r.el.querySelector('#pPhrase');phrase.value='private phrase revision one';phrase.focus();phrase.onkeydown({key:'Enter',isComposing:true});eq(r.sent.length,0,'IME commit does not save');phrase.onkeydown({key:'Enter',isComposing:false});eq(r.sent.at(-1).phrase,phrase.value);r.act(r.sent.at(-1));phrase.value='private phrase revision two';r.render('a');eq(r.el.querySelector('#pPhrase'),phrase,'write node stable');eq(phrase.value,'private phrase revision two','unsaved draft retained');eq(r.document.activeElement,phrase,'write focus retained');r.click('#pSend');r.act(r.sent.at(-1));eq(r.state.phrases.a,'private phrase revision two','saved phrase can be edited');r.outside.focus();r.render('a');eq(r.document.activeElement,r.outside,'Room focus retained');
 r.render('watcher');ok(!r.el.querySelector('#pPhrase')&&!r.el.querySelector('#pSend'),'watcher write is read-only');ok(!r.el.innerHTML.includes('private phrase revision'),'watcher cannot read private phrase');
 r.act({phrase:'second private phrase'},'b');r.act({phrase:'third private phrase'},'c');eq(r.state.phase,'draw');r.render('a');ok(r.el.querySelector('#pPen')&&r.el.querySelector('#pEraser')&&r.el.querySelector('#pClear'),'supported tools mount');ok(r.el.querySelector('#pUndo')&&!r.el.innerHTML.includes('Finish drawing'),'whole-gesture Undo mounts without invented completion');
 const canvas=r.el.querySelector('#pCanvas'),focusSends=r.sent.length;r.click('#pFocus');ok(r.el.querySelector('.dp').classList.contains('dp-focus'),'canvas focus enters');eq(r.el.querySelector('#pCanvas'),canvas,'focus uses same canvas');eq(r.el.querySelector('#pFocus').getAttribute('aria-label'),'Exit canvas focus');ok(r.el.querySelector('.dp').classList.contains('dp-tools-hidden'),'focus starts with tools collapsed');r.click('#pTools');ok(!r.el.querySelector('.dp').classList.contains('dp-tools-hidden'),'tools open locally');r.click('#pTools');ok(r.el.querySelector('.dp').classList.contains('dp-tools-hidden'),'tools collapse locally');eq(r.sent.length,focusSends,'focus/tools send no authority action');r.render('a');ok(r.el.querySelector('.dp').classList.contains('dp-focus'),'snapshot preserves focus mode');r.outside.focus();r.document.root.dispatch('keydown',{key:'Escape',target:r.outside});ok(r.el.querySelector('.dp').classList.contains('dp-focus'),'Room Escape does not change local canvas mode');r.el.querySelector('#pFocus').focus();r.document.root.dispatch('keydown',{key:'Escape',target:r.el.querySelector('#pFocus')});ok(!r.el.querySelector('.dp').classList.contains('dp-focus'),'local Escape exits focus');eq(r.el.querySelector('#pCanvas'),canvas);r.click('[data-c="#1d4ed8"]');r.click('[data-size="16"]');r.pointer(canvas,'pointerdown',1,.1,.4);r.pointer(r.window,'pointermove',1,.8,.4);r.pointer(r.window,'pointerup',1,.8,.4);const ink=r.sent.at(-1);eq(ink.stroke.color,'#1d4ed8');eq(ink.stroke.size,16);eq(Object.keys(ink.stroke).sort(),['color','pts','size'],'original private stroke format');r.act(ink);r.render('a');eq(r.el.querySelector('#pCanvas'),canvas,'drawing canvas survives snapshot');
 r.click('#pEraser');r.pointer(canvas,'pointerdown',2,.3,.4);r.pointer(r.window,'pointermove',2,.6,.4);r.pointer(r.window,'pointerup',2,.6,.4);eq(r.sent.at(-1).stroke.color,'#ffffff','eraser uses original white ink');r.act(r.sent.at(-1));r.render('a');r.click('#pPen');eq(r.el.querySelector('#pPen').getAttribute('aria-pressed'),'true');eq(r.el.querySelector('#pEraser').getAttribute('aria-pressed'),'false');r.pointer(canvas,'pointerdown',3,.1,.6);r.pointer(r.window,'pointermove',3,.8,.6);r.pointer(r.window,'pointerup',3,.8,.6);eq(r.sent.at(-1).stroke.color,'#1d4ed8','pen restores prior ink');r.act(r.sent.at(-1));
 r.render('watcher');ok(!r.el.querySelector('#pPen')&&!r.el.querySelector('#pEraser')&&!r.el.querySelector('#pClear'),'watcher has no tools');eq(r.S('watcher').myPrompt,'');eq(r.S('watcher').myStrokes.length,0);ok(!r.el.innerHTML.includes('second private phrase')&&!r.el.innerHTML.includes('third private phrase'),'watcher private prompt hidden');r.act(ink,'watcher');eq(r.state.drawings.a.strokes.length,3,'watcher action ignored');
 r.render('a');const held=r.el.querySelector('#pCanvas'),before=r.sent.length;r.pointer(held,'pointerdown',4,.2,.7);r.pointer(r.window,'pointermove',4,.8,.7);r.click('#pClear');r.act(r.sent.at(-1));r.pointer(r.window,'pointerup',4,.8,.7);eq(r.sent.filter(a=>a.stroke).length,3,'clear cancels held gesture');eq(r.state.drawings.a.strokes.length,0);ok(r.sent.length>=before);
 r.pointer(held,'pointerdown',5,.2,.4);r.pointer(r.window,'pointermove',5,.8,.4);r.pointer(r.window,'pointercancel',5,.8,.4);const count=r.sent.length;r.pointer(r.window,'pointerup',5,.8,.4);held.dispatch('lostpointercapture',{pointerId:5});eq(r.sent.length,count,'cancel/lift finalizes once');r.act(r.sent.at(-1));
 const chunkStart=r.sent.length;r.pointer(held,'pointerdown',6,.1,.5);for(let n=1;n<=230;n++)r.pointer(r.window,'pointermove',6,.1+n/230*.7,.5);r.pointer(r.window,'pointerup',6,.8,.5);const chunks=r.sent.slice(chunkStart).filter(a=>a.stroke);eq(chunks.length,2,'long gesture retains original chunks');chunks.forEach(a=>r.act(a));
 r.pointer(held,'pointerdown',7,.2,.8);r.pointer(r.window,'pointermove',7,.8,.8);r.view.dispose();const disposed=r.sent.length;r.pointer(r.window,'pointerup',7,.8,.8);eq(r.sent.length,disposed,'dispose never sends held input');ok(!r.document.getElementById('draw-phone-css'),'own CSS retired');r.render('a');eq(r.state.drawings.a.strokes.length,3,'reconnect preserves authority drawing');
 r.click('#pFocus');r.deadline();eq(r.state.phase,'guess');r.render('a');ok(!r.el.querySelector('.dp').classList.contains('dp-focus'),'phase transition resets focus');ok(!r.el.querySelector('#pPen'),'caption has no tools');ok(!('myPrompt' in r.S('a')),'caption projection omits phrase');const caption=r.el.querySelector('#pGuess');caption.value='caption revision one';caption.focus();caption.onkeydown({key:'Enter',isComposing:true});const beforeGuess=r.sent.length;caption.onkeydown({key:'Enter',isComposing:false});eq(r.sent.length,beforeGuess+1);r.act(r.sent.at(-1));caption.value='caption revision two';r.render('a');eq(r.el.querySelector('#pGuess'),caption);eq(caption.value,'caption revision two');eq(r.document.activeElement,caption);r.click('#pSend');r.act(r.sent.at(-1));eq(r.state.guesses.a,'caption revision two');r.outside.focus();r.render('a');eq(r.document.activeElement,r.outside,'caption update preserves Room focus');r.render('watcher');ok(!r.el.querySelector('#pGuess')&&!r.el.querySelector('#pSend'),'watcher caption read-only');eq(r.S('watcher').myDrawing.length,0);eq(r.S('watcher').myGuess,'');
 r.act({guess:'second caption'},'b');r.act({guess:'third caption'},'c');eq(r.state.phase,'reveal');eq(r.awards.map(x=>x[1]),[25,25,25,50,25,25,25],'points are awarded as each page closes');r.render('a');ok(r.el.querySelector('#pNext')&&r.el.querySelector('#pPrev'),'host pages actual chains');ok(r.el.innerHTML.includes('private phrase revision two'),'revealed phrase public');r.el.querySelector('#pNext').focus();r.click('#pNext');r.act(r.sent.at(-1));r.render('a');eq(r.document.activeElement,r.el.querySelector('#pNext'),'successive page keyboard focus restored');r.outside.focus();r.click('#pNext');r.act(r.sent.at(-1));r.render('a');eq(r.document.activeElement,r.outside,'page change does not steal Room focus');r.render('b');ok(!r.el.querySelector('#pNext'),'nonhost cannot page');r.act({next:true},'b');eq(r.state.revealIdx,2,'nonhost action ignored');r.render('a');r.click('#pNext');r.act(r.sent.at(-1));r.render('a');eq(r.state.phase,'done');ok(r.el.innerHTML.includes('Final scores'));eq(r.awards.length,7,'finish does not award again');r.view.dispose();
}
{
 const r=rig();for(const pid of ['a','b','c'])r.act({phrase:'private '+pid},pid);r.render('a');
 const canvas=r.el.querySelector('#pCanvas');r.pointer(canvas,'pointerdown',1,.1,.3);for(let n=1;n<=230;n++)r.pointer(r.window,'pointermove',1,.1+n/230*.7,.3);r.pointer(r.window,'pointerup',1,.8,.3);
 const chunks=r.sent.filter(a=>a.stroke);eq(chunks.length,2);eq(chunks[0].gestureId,chunks[1].gestureId,'chunks share gesture');chunks.forEach(a=>r.act(a));r.render('a');r.click('#pUndo');r.act(r.sent.at(-1));r.render('a');eq(r.state.drawings.a.strokes.length,0,'one Undo removes whole long gesture');r.act(chunks[1]);r.render('a');eq(r.state.drawings.a.strokes.length,0,'late chunk cannot restore undone ink');
 r.pointer(canvas,'pointerdown',2,.2,.5);r.pointer(r.window,'pointermove',2,.8,.5);const old=r.sent.filter(a=>a.preview).at(-1);r.act(old);r.click('#pClear');r.act(r.sent.at(-1));r.act({...old,preview:undefined,stroke:old.preview,finished:true});eq(r.state.drawings.a.strokes.length,0,'clear rejects queued held commit');
 r.render('a');r.pointer(canvas,'pointerdown',3,.4,.7);r.pointer(r.window,'pointerup',3,.4,.7);r.act(r.sent.at(-1));r.render('a');ok(canvas.getContext('2d').ops.length>0,'tap paints an ink dot');
 eq(r.sent.at(-1).inkRevision,r.state.drawings.a.inkRevision,'client resumes latest drawing revision');r.render('watcher');ok(!r.S('watcher').inkNonce&&!r.el.querySelector('#pUndo'),'watcher sees no token or Undo');r.view.dispose();
}
{
 const r=rig();
 const lock=vm.createContext({lastState:{spectator:true}});
 vm.runInContext(fs.readFileSync('public/js/app.js','utf8').match(/function applySpectator\(el\) \{[\s\S]*?\n\}/)[0],lock);
 r.render('a');lock.applySpectator(r.el);ok(r.el.querySelector('#pSend').disabled,'shell still locks phrase submission');
 for(const pid of ['a','b','c'])r.act({phrase:'private '+pid},pid);
 r.deadline();for(const pid of ['a','b','c'])r.act({guess:'caption '+pid},pid);
 r.render('watcher');lock.applySpectator(r.el);const before=r.sent.length;
 r.click('#pZoomIn');eq(r.el.querySelector('#pZoomValue').textContent,'150%','watcher zoom survives shell guard');
 r.click('#pPan');eq(r.el.querySelector('#pPan').getAttribute('aria-pressed'),'true','watcher can choose local pan');
 r.click('#pFit');eq(r.el.querySelector('#pZoomValue').textContent,'100%','watcher can restore Fit');
 r.click('#pPan');r.pointer(r.el.querySelector('#pCanvas'),'pointerdown',1,.2,.2);r.pointer(r.window,'pointerup',1,.3,.3);
 eq(r.sent.length,before,'watcher view controls and canvas never send actions');ok(!r.el.querySelector('#pSend')&&!r.el.querySelector('#pNext'),'watcher has no submit or host paging control');r.view.dispose();
}
{
 const r=rig();r.render('a');eq(r.scrolls.length,0,'mount does not move the page');
 r.el.querySelector('#pPhrase').focus();for(const pid of ['a','b','c'])r.act({phrase:'private '+pid},pid);r.render('a');
 eq(r.scrolls.length,1,'retired phrase input starts the drawing page at the top');eq(r.scrolls[0].top,0);
 r.render('a');eq(r.scrolls.length,1,'same phase keeps scroll');
 const report=r.document.body.appendChild(new Node('dialog',r.document,{class:'report-dialog'}));
 const close=report.appendChild(new Node('button',r.document));close.focus();r.deadline();r.render('a');eq(r.scrolls.length,1,'report dialog focus prevents phase scroll');eq(r.document.activeElement,close,'report dialog keeps Close focus');
 r.el.querySelector('#pGuess').focus();const menu=r.document.body.appendChild(new Node('details',r.document,{class:'room-menu',open:''}));
 for(const pid of ['a','b','c'])r.act({guess:'caption '+pid},pid);r.render('a');eq(r.scrolls.length,1,'open Room prevents phase scroll even with retired game focus');r.view.dispose();
}
{
 const r=rig();r.render('a');r.outside.focus();for(const pid of ['a','b','c'])r.act({phrase:'outside focus '+pid},pid);r.render('a');
 eq(r.scrolls.length,0,'other app control focus prevents phase scroll');r.view.dispose();
}
{
 const r=rig();r.render('a');eq(r.cues,[],'first notebook is quiet');r.act({phrase:'An otter drawing a moon'});r.render('a');eq(r.cues.map(c=>c.name),['place'],'actual saved phrase confirms once');r.render('a');eq(r.cues.length,1);
 r.act({phrase:'A penguin baking a cake'},'b');r.act({phrase:'A koala riding a cloud'},'c');r.render('a');eq(r.state.phase,'draw');eq(r.cues.at(-1).name,'deal','authority passes the private drawing page');r.deadline();r.render('a');eq(r.state.phase,'guess');eq(r.cues.at(-1).name,'deal','authority passes the caption page');r.act({guess:'An otter looking at the sky'});r.render('a');eq(r.cues.at(-1).name,'place');r.act({guess:'A bird with a cake'},'b');r.act({guess:'A bear in the clouds'},'c');r.render('a');eq(r.cues.at(-1).name,'reveal','public story opens after private captions');
 r.act({next:true});r.render('a');r.act({prev:true});r.render('a');r.act({next:true});r.render('a');eq(r.cues.filter(c=>c.name==='reveal').length,2,'revisiting previously revealed stories is quiet');r.act({next:true});r.render('a');eq(r.cues.filter(c=>c.name==='reveal').length,3,'each actual story has one reveal cue');r.act({next:true});r.render('a');eq(r.state.phase,'done');eq(r.cues.filter(c=>c.name==='win').length,0,'root owns final sound');r.view.dispose();
 const q=rig();q.render('a');for(const pid of ['a','b','c'])q.act({phrase:'Phrase '+pid},pid);q.view.render(q.el,{...q.S('a'),audioBaseline:true},q.api);eq(q.cues,[],'new connection cannot play a historical page deal');q.render('a');eq(q.cues,[],'connection baseline seeds page state');q.view.dispose();
}
{
 // Rules standard: Pace, per-contribution points, the story bonus, paced
 // reveal pages, Done drawing, End game and players who leave.
 const def=require('../games/draw-phone/server');const {paced}=require('../games/_sdk');
 eq(def.manifest.settings[0].key,'pace','Pace setting offered');ok(!def.manifest.settings.some(x=>x.key==='rounds'),'a chain game has no Rounds');
 ok(def.storySurvived('A cat wearing a tiny hat','cat with tiny hat'),'caption keeps the story');ok(!def.storySurvived('A cat wearing a tiny hat','a dog'),'a different caption does not');ok(def.storySurvived('Two robots dancing','robot dancing!'),'plural and punctuation forgiving');
 for(const pace of ['Relaxed','Normal','Quick']){
  const players=['a','b','c'].map(id=>({id,name:id.toUpperCase()}));let clock=0;const timers=[],awards={};
  const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({pace}),content:()=>({starters:['A cat wearing a tiny hat']}),now:()=>clock,later(ms,fn){const t={at:clock+ms,fn};timers.push(t);return()=>{t.dead=true}},award(pid,n){awards[pid]=(awards[pid]||0)+n},broadcast(){},hostId:()=>'a'};
  const st=def.create(ctx),act=(pid,a)=>def.onAction(st,ctx,pid,a);
  act('a',{phrase:'A cat wearing a tiny hat'});act('b',{phrase:'A robot eating spaghetti'});
  eq(st.phase,'write');def.onPlayerGone(st,ctx,'c','left');eq(st.phase,'draw','a player who left is not waited for');
  eq(awards,{a:25,b:25},'own phrases score 25 when the page closes');eq(Object.keys(st.drawAssign).sort(),['a','b'],'only players still here draw');
  const meta=pid=>({inkNonce:st.drawings[pid].inkNonce,inkRevision:st.drawings[pid].inkRevision,gestureId:1,chunk:0,finished:true});
  act('a',{done:true});eq(st.finished.a,undefined,'Done needs some ink');
  for(const pid of ['a','b'])act(pid,{stroke:{pts:[[.1,.1],[.5,.5]],color:'#111111',size:7},...meta(pid)});
  act('a',{done:true});eq(st.phase,'draw');act('b',{done:true});eq(st.phase,'guess','everyone Done ends the drawing page early');
  eq(awards,{a:75,b:75},'drawings score 50');
  const phrase=pid=>st.phrases[st.drawAssign[st.guessAssign[pid]]];
  act('a',{guess:phrase('a')});act('b',{guess:'something else entirely'});eq(st.phase,'reveal');
  const kept=st.chains.find(c=>c.guessBy==='a');ok(kept.survived,'matching caption keeps the story');
  eq(awards[kept.drawBy]+awards.a>0,true);eq(awards.a,75+25+50+(kept.drawBy==='a'?50:0),'captioner gets 25 + 50 story bonus');
  ok(Object.values(awards).every(n=>n<=200),'never above 200 for the round');
  eq(st.endsAt-clock,paced({pace},20)*1000,`${pace} story page is paced`);
  act('b',{next:true});eq(st.revealIdx,0,'only the host turns pages');
  const t=timers.filter(x=>!x.dead).at(-1);clock=t.at;t.fn();eq(st.revealIdx,1,'story page turns itself');
  act('a',{prev:true});eq(st.revealIdx,0);act('a',{next:true});act('a',{next:true});eq(st.phase,'done');eq(st.endsAt,0);
  for(const p of players)eq(st.scores[p.id]||0,awards[p.id]||0,'scoreboard matches the awards');
 }
 // End game in the middle of drawing keeps ink drawn so far.
 const players=['a','b','c'].map(id=>({id,name:id}));let clock=0;const awards={};
 const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({}),content:()=>({}),now:()=>clock,later(){return()=>{}},award(pid,n){awards[pid]=(awards[pid]||0)+n},broadcast(){}};
 const st=def.create(ctx);for(const p of players)def.onAction(st,ctx,p.id,{phrase:'Phrase '+p.id});
 def.onAction(st,ctx,'a',{stroke:{pts:[[.1,.1],[.5,.5]],color:'#111111',size:7},inkNonce:st.drawings.a.inkNonce,inkRevision:0,gestureId:1,chunk:0,finished:true});
 def.onEnd(st,ctx,{reason:'host'});eq(st.phase,'done');eq(awards,{a:75,b:25,c:25},'End game counts the open page');
}
console.log('DRAW_PHONE_VIEW_PASS:' ,checks,'production client privacy, stable drafts, supported ink tools, replay, disposal and page-focus checks');

}
module.exports={rig};
if(require.main===module)main();
