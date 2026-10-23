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
 const document={activeElement:null,createElement(tag){return new Node(tag,this)},getElementById(id){return this.root.querySelector('#'+id)}};
 document.root=new Node('document',document);document.head=document.root.appendChild(new Node('head',document));document.body=document.root.appendChild(new Node('body',document));document.activeElement=document.body;
 document.addEventListener=document.root.addEventListener.bind(document.root);document.removeEventListener=document.root.removeEventListener.bind(document.root);
 const el=document.body.appendChild(new Node('main',document)),outside=document.body.appendChild(new Node('button',document)),window=new Node('window',document);window.PointerEvent=function(){};
 const timers=new Map(),sent=[],cues=[];let seq=0,now=1000;const api={cue:(name,options)=>cues.push({name,...options}),send:a=>sent.push(JSON.parse(JSON.stringify(a))),now:()=>now,focus:n=>n?.focus()};
 const context=vm.createContext({document,window,setInterval(fn,ms){timers.set(++seq,{fn,ms});return seq},clearInterval(n){timers.delete(n)},setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync('public/js/util.js','utf8').replace(/^export /gm,''),context);
 // The game kit shares util's helpers; inline it after util.
 vm.runInContext(fs.readFileSync('public/js/kit.js','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export \{[^}]*\};?\s*$/m,'').replace(/^export /gm,''),context);
 vm.runInContext(fs.readFileSync('public/js/games/doodle-guess.js','utf8').replace(/^import[^;]+;\s*/gm,'').replace('export default','globalThis.view='),context);
 const def=require('../games/doodle-guess/server'),players=[{id:'a',name:'Ada Fern, watercolor artist'},{id:'b',name:'Bo River, sketchbook collector'},{id:'c',name:'<img onerror="unsafe">'}];
 const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({rounds:1,roundSeconds:60}),content:()=>({words:Array(10).fill('private-secret')}),now:()=>now,later(){},award(){},broadcast(){}};
 const state=def.create(ctx);const artist=state.drawer,guesser=players.find(p=>p.id!==artist).id;
 const S=pid=>JSON.parse(JSON.stringify({...def.view(state,pid),players,me:pid,spectator:!players.some(p=>p.id===pid),instanceId:'one'}));
 const render=pid=>context.view.render(el,S(pid),api),act=(a,pid=artist)=>def.onAction(state,ctx,pid,a),click=selector=>{const n=el.querySelector(selector);ok(n&&!n.disabled,'active '+selector);n.dispatch('click');};
 const pointer=(target,type,id,x,y)=>target.dispatch(type,{pointerId:id,button:0,clientX:x*880,clientY:y*520});
 return{el,document,outside,window,api,sent,cues,timers,state,setNow:value=>now=value,tick:()=>def.onTick(state,ctx),artist,guesser,S,render,act,click,pointer,view:context.view};
}
function main(){
{
 const r=rig();r.render(r.artist);eq(r.document.activeElement,r.document.body,'mount does not autofocus');r.click('[data-w]');r.act(r.sent.at(-1));r.render(r.artist);
 ok(r.el.querySelector('.dg-easel')&&r.el.querySelector('#dPen')&&r.el.querySelector('#dEraser'),'physical studio controls mount');ok(!r.el.querySelector('img'),'player names cannot create markup');
 const canvas=r.el.querySelector('#dCanvas');eq(r.el.querySelector('.dg-header').closest('.dg-drawing'),canvas.closest('.dg-drawing'),'live header belongs to the drawing pane');eq(r.el.querySelector('.dg-view-controls').closest('.dg-drawing'),canvas.closest('.dg-drawing'),'view controls share the canvas frame');r.click('[data-c="#1d4ed8"]');r.click('[data-size="16"]');r.pointer(canvas,'pointerdown',1,.1,.4);r.pointer(r.window,'pointermove',1,.8,.4);r.pointer(r.window,'pointerup',1,.8,.4);
 const pen=r.sent.at(-1);eq(pen.stroke.color,'#1d4ed8');eq(pen.stroke.size,16);eq(pen.stroke.tool,'pen');eq(pen.inkNonce,r.state.inkNonce);eq(pen.inkRevision,0);r.act(pen);r.render(r.artist);eq(r.el.querySelector('#dCanvas'),canvas,'snapshot preserves drawing canvas');
 const focusSent=r.sent.length;r.click('#dFocus');ok(r.el.querySelector('.dg').classList.contains('is-canvas-focused'),'canvas focus is local');eq(r.el.querySelector('#dCanvas'),canvas,'focus preserves the real canvas');eq(r.el.querySelector('#dFocus').getAttribute('aria-label'),'Exit canvas focus');ok(r.el.querySelector('.dg').classList.contains('is-tools-collapsed'),'focused canvas starts without the palette');r.click('#dTools');ok(!r.el.querySelector('.dg').classList.contains('is-tools-collapsed'),'tools can reopen without touching ink');r.click('#dTools');ok(r.el.querySelector('.dg').classList.contains('is-tools-collapsed'),'tools can collapse without touching ink');eq(r.el.querySelector('#dTools').getAttribute('aria-expanded'),'false');r.render(r.artist);ok(r.el.querySelector('.dg').classList.contains('is-canvas-focused'),'snapshots preserve focused view');eq(r.sent.length,focusSent,'view controls send no game actions');r.el.querySelector('.dg').dispatch('keydown',{key:'Escape'});ok(!r.el.querySelector('.dg').classList.contains('is-canvas-focused'),'Escape restores studio');eq(r.document.activeElement,r.el.querySelector('#dFocus'),'Escape returns focus to view control');ok(r.el.querySelector('#dTools').hidden,'normal view restores tools');
 r.click('#dEraser');r.pointer(canvas,'pointerdown',2,.3,.4);r.pointer(r.window,'pointermove',2,.6,.4);r.pointer(r.window,'pointerup',2,.6,.4);const erase=r.sent.at(-1);eq(erase.stroke.tool,'eraser');eq(erase.stroke.color,'#ffffff');r.act(erase);r.render(r.artist);
 r.click('#dUndo');r.act(r.sent.at(-1));r.render(r.artist);eq(r.state.strokes.length,1,'Undo eraser restores prior ink');r.click('#dPen');eq(r.el.querySelector('#dPen').getAttribute('aria-pressed'),'true');eq(r.el.querySelector('#dEraser').getAttribute('aria-pressed'),'false');
 const before=r.sent.length;r.pointer(canvas,'pointerdown',3,.1,.6);for(let n=1;n<=230;n++)r.pointer(r.window,'pointermove',3,.1+n/230*.7,.6);r.pointer(r.window,'pointerup',3,.8,.6);const chunks=r.sent.slice(before).filter(a=>a.stroke);eq(chunks.length,2);eq(chunks[0].gestureId,chunks[1].gestureId);chunks.forEach(a=>r.act(a));r.render(r.artist);eq(r.state.strokes.length,3);r.click('#dUndo');r.act(r.sent.at(-1));r.render(r.artist);eq(r.state.strokes.length,1,'whole gesture Undo retains earlier pen');r.act(chunks[1]);eq(r.state.strokes.length,1,'stale chunk cannot return');
 r.render(r.guesser);ok(!r.el.querySelector('#dPen')&&!r.el.querySelector('#dEraser')&&!r.el.querySelector('#dClear'),'guesser has no artist tools');ok(!r.el.innerHTML.includes('private-secret'),'guesser never renders private word');
 r.click('#dFocus');ok(r.el.querySelector('#dGuessForm'),'focused guesser retains stable composer');ok(!r.el.querySelector('#dTools'),'guesser cannot operate artist tools');r.click('#dFocus');
 const input=r.el.querySelector('#dGuess');input.value='keyboard draft';input.focus();r.act({preview:{pts:[[.1,.1],[.8,.1]],color:'#111111',size:7,tool:'pen'},inkNonce:r.state.inkNonce,inkRevision:r.state.inkRevision,gestureId:10,chunk:0,sample:1});r.render(r.guesser);
 eq(r.el.querySelector('#dGuess'),input,'snapshot preserves guess input');eq(input.value,'keyboard draft');eq(r.document.activeElement,input,'snapshot preserves keyboard focus');r.outside.focus();r.render(r.guesser);eq(r.document.activeElement,r.outside,'snapshot does not steal Room focus');
 input.value='wrong';r.el.querySelector('#dGuessForm').dispatch('submit');eq(r.sent.at(-1).guess,'wrong');eq(input.value,'');eq(r.document.activeElement,input,'submitted guess keeps keyboard ready');r.act(r.sent.at(-1),r.guesser);r.render(r.guesser);ok(r.el.querySelector('#dFeed').textContent.includes('wrong'));
 r.act({guess:'private-secret'},r.guesser);r.render(r.guesser);ok(!r.el.innerHTML.includes('private-secret'),'correct word absent from feed');ok(input.disabled,'correct guess locks input');
 r.render('watcher');ok(!r.el.querySelector('#dGuess')&&!r.el.querySelector('#dClear')&&!r.el.querySelector('#dPen'),'watcher remains read-only');ok(r.el.querySelector('.dg-roster').textContent.includes('Ada Fern, watercolor artist'),'full names retained');
 r.render(r.artist);const held=r.el.querySelector('#dCanvas'),count=r.sent.length;r.pointer(held,'pointerdown',4,.1,.8);r.pointer(r.window,'pointermove',4,.8,.8);r.view.dispose();const finalCount=r.sent.length;r.pointer(r.window,'pointerup',4,.8,.8);r.pointer(held,'pointerdown',5,.1,.2);eq(r.sent.length,finalCount,'disposed input cannot commit');eq(r.timers.size,0,'dispose clears clock');ok(finalCount>=count);
 r.render(r.artist);ok(r.el.querySelector('#dCanvas'),'reconnect renders saved canvas');eq(r.state.strokes.length,1,'reconnect preserved authority ink');
 r.document.root.dispatch('keydown',{ctrlKey:true,key:'z',target:r.el});eq(r.sent.at(-1).undo,true,'keyboard shortcut sends Undo');eq(r.sent.at(-1).inkRevision,r.state.inkRevision,'keyboard Undo uses current authority revision');r.act(r.sent.at(-1));r.render(r.artist);eq(r.state.preview,null,'keyboard Undo removes the latest live gesture first');
 r.document.root.dispatch('keydown',{ctrlKey:true,key:'z',target:r.el});r.act(r.sent.at(-1));r.render(r.artist);eq(r.state.strokes.length,0,'successive keyboard Undo removes saved gesture');r.view.dispose();
}
{
 const r=rig();r.act({choose:r.state.choices[0]},r.artist);r.render('watcher');
 const lock=vm.createContext({lastState:{spectator:true}});
 vm.runInContext(fs.readFileSync('public/js/app.js','utf8').match(/function applySpectator\(el\) \{[\s\S]*?\n\}/)[0],lock);lock.applySpectator(r.el);
 const before=r.sent.length;r.click('#dZoomIn');eq(r.el.querySelector('#dZoomValue').textContent,'150%','watcher zoom survives shell guard');
 r.click('#dPan');eq(r.el.querySelector('#dPan').getAttribute('aria-pressed'),'true','watcher can choose local pan');
 r.click('#dFit');eq(r.el.querySelector('#dZoomValue').textContent,'100%','watcher can restore Fit');
 r.click('#dFocus');ok(r.el.querySelector('.dg').classList.contains('is-canvas-focused'),'watcher can focus shared canvas');
 r.click('#dGuesses');eq(r.el.querySelector('#dGuesses').getAttribute('aria-expanded'),'false','watcher can collapse guesses locally');
 r.pointer(r.el.querySelector('#dCanvas'),'pointerdown',1,.2,.2);r.pointer(r.window,'pointerup',1,.3,.3);
 eq(r.sent.length,before,'watcher view controls and canvas never send actions');ok(!r.el.querySelector('#dGuess')&&!r.el.querySelector('#dPen')&&!r.el.innerHTML.includes('private-secret'),'watcher has no private word, composer, or artist tools');r.view.dispose();
}
{
 const r=rig();r.act({choose:r.state.choices[0]},r.artist);r.render(r.guesser);eq(r.cues,[],'reconnected drawing is quiet');
 r.act({guess:'wrong'},r.guesser);r.render(r.guesser);eq(r.cues,[],'incorrect guess has no reward cue');
 r.setNow(31000);r.tick();r.render(r.guesser);ok(r.state.hintsUsed===1,'real timed hint threshold advanced');eq(r.cues.map(c=>c.name),['reveal'],'new public hint receives one soft cue');r.render(r.guesser);eq(r.cues.length,1,'hint heartbeat is silent');
 r.act({guess:'private-secret'},r.guesser);r.render(r.guesser);eq(r.cues.at(-1).name,'correct','actual accepted answer receives the success cue');r.render(r.guesser);eq(r.cues.length,2,'same accepted answer cannot replay');
 const other=r.S(r.guesser).players.find(p=>p.id!==r.artist&&p.id!==r.guesser).id;r.act({guess:'private-secret'},other);r.render(r.guesser);eq(r.state.phase,'reveal');eq(r.cues.slice(2).map(c=>c.name),['correct','reveal'],'last correct answer precedes the public word reveal');r.view.dispose();const count=r.cues.length;r.render(r.guesser);eq(r.cues.length,count,'first reconnected public reveal is silent');r.view.dispose();
 const baseline=rig();baseline.act({choose:baseline.state.choices[0]},baseline.artist);baseline.render(baseline.guesser);baseline.act({guess:'private-secret'},baseline.guesser);baseline.view.render(baseline.el,{...baseline.S(baseline.guesser),audioBaseline:true},baseline.api);eq(baseline.cues,[],'connection baseline cannot reward a historical correct guess');baseline.render(baseline.guesser);eq(baseline.cues,[],'baseline seeds future dedupe');baseline.view.dispose();
}
{
 const r=rig();r.act({choose:r.state.choices[0]},r.artist);r.render(r.guesser);
 const input=r.el.querySelector('#dGuess'),form=r.el.querySelector('#dGuessForm'),dispatch=r.api.send;
 const attempts=[];r.api.send=a=>{attempts.push(JSON.parse(JSON.stringify(a)));return false;};
 input.value='retained draft';input.selectionStart=3;input.selectionEnd=9;input.selectionDirection='backward';r.outside.focus();
 form.dispatch('submit');
 eq(attempts,[{guess:'retained draft'}],'current guess reaches the guarded API once');
 eq(input.value,'retained draft','refused readiness/window/disconnection send preserves the draft');
 eq([input.selectionStart,input.selectionEnd,input.selectionDirection],[3,9,'backward'],'refused send preserves selection');
 eq(r.document.activeElement,r.outside,'refused send does not move focus');
 eq(r.sent.length,0,'refused send has no accepted action');eq(r.S(r.guesser).guesses,[],'refused guess is absent from public projection');
 const ime=input.dispatch('keydown',{key:'Enter',isComposing:true});ok(ime.prevented,'IME Enter cannot submit the form');eq(attempts.length,1,'IME does not replay refused draft');
 r.api.send=dispatch;r.render(r.guesser);eq(r.el.querySelector('#dGuess'),input,'current readiness repaint preserves draft input');eq(r.sent.length,0,'readiness repaint does not auto-submit');
 form.dispatch('submit');eq(r.sent,[{guess:'retained draft'}],'later ordinary current submit dispatches exactly once');eq(input.value,'','accepted submit clears the draft');eq(r.document.activeElement,input,'accepted submit focuses composer');
 r.act(r.sent[0],r.guesser);r.render(r.guesser);eq(r.S(r.guesser).guesses.map(g=>g.text),['retained draft'],'only accepted current guess appears publicly');eq(r.sent.length,1,'authority repaint does not replay');
 input.value='disabled draft';input.disabled=true;form.dispatch('submit');eq(r.sent.length,1,'disabled composer cannot dispatch');eq(input.value,'disabled draft','disabled submit preserves input');
 r.render('watcher');form.dispatch('submit');eq(r.sent.length,1,'retired composer cannot dispatch after spectator render');ok(!r.el.querySelector('#dGuess'),'spectator gets no composer');r.view.dispose();
}
{
 const r=rig(),players=r.S(r.guesser).players,[a,b,c]=players.map(p=>p.id);
 for(const [scores,ranks,leaders,winner] of [[{[a]:100,[b]:100,[c]:50},['1','1','3'],2,/^It(&#39;|')s a tie: /],[{[b]:100},['1','2','2'],1,/ wins$/],[{},['1','1','1'],0,/^No one scored$/]]){
  for(const role of [r.guesser,'watcher']){
   r.view.render(r.el,{...r.S(role),phase:'done',scores,totals:{[c]:9999},audioBaseline:true},r.api);
   eq(r.el.querySelector('.gk-results-title').textContent,'Final scores','one final wording');
   ok(winner.test(r.el.querySelector('.gk-winner').textContent),'winner line names ties as ties');
   eq(r.el.querySelectorAll('.gk-rank').map(n=>n.textContent),ranks,'equal points share a rank');
   eq(r.el.querySelectorAll('.is-top').length,leaders,'only positive leaders highlighted');
   eq(r.el.querySelectorAll('.is-you').length,role==='watcher'?0:1,'the viewer row is highlighted');
   ok(!r.el.querySelector('img')&&!r.el.innerHTML.includes('9999'),'literal names escaped and night totals excluded');
   ok(r.el.innerHTML.includes('&lt;img onerror='),'literal unsafe-looking player name retained as text');
   eq(r.el.querySelectorAll('.gk-pts').length,3,'every participant remains in final');
   r.view.dispose();
  }
 }
}
console.log('DOODLE_VIEW_PASS:',checks,'production client tool/privacy/whole-gesture/stable-keyboard/disposal assertions');

}
module.exports={rig};
if(require.main===module)main();
