'use strict';
// Execute the shipped SVG clients in a small DOM double. Browser fixtures
// separately verify real layout/animation; these checks target lifecycle races.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
let checks=0;function eq(a,b,m){if(a instanceof Node||b instanceof Node)assert(a===b,m||'DOM node identity differs');else assert.deepEqual(a,b,m);checks++;}function ok(v,m){assert(v,m);checks++;}
class Node {
 constructor(tag,doc,attrs={}){this.tagName=tag;this.doc=doc;this.attrs=attrs;this.children=[];this.parentNode=null;this.scrollLeft=0;this.scrollTop=0;this.text='';this.events=new Map();this.dataset={};for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,a)=>a.toUpperCase())]=v;this.classList={contains:x=>(this.attrs.class||'').split(/\s+/).includes(x),add:(...xs)=>{this.attrs.class=[...new Set([...(this.attrs.class||'').split(/\s+/).filter(Boolean),...xs])].join(' ')},toggle:(x,on)=>{const present=this.classList.contains(x),want=on===undefined?!present:on;this.attrs.class=(this.attrs.class||'').split(/\s+/).filter(c=>c&&c!==x).concat(want?[x]:[]).join(' ');return want;}};}
 append(n){return this.appendChild(n);}
 contains(n){for(let p=n;p;p=p.parentNode)if(p===this)return true;return false;}
 get id(){return this.attrs.id||'';}set id(v){this.attrs.id=String(v);}
 hasAttribute(k){return k in this.attrs;}
 getBoundingClientRect(){return this.rect||{left:0,right:0,top:0,bottom:0};}
 getClientRects(){for(let n=this;n;n=n.parentNode)if(n.hidden)return[];return[{}];}
 appendChild(n){n.parentNode=this;this.children.push(n);return n;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
 set innerHTML(html){if(this.doc.activeElement!==this&&this.contains(this.doc.activeElement))this.doc.activeElement=this.doc.body;this.html=html;this.children=[];this.text='';const stack=[this],re=/<(\/?)([\w-]+)([^>]*)>|([^<]+)/g;let m;while((m=re.exec(html))){if(m[4]){stack.at(-1).text+=m[4];continue;}const [,closing,tag,raw]=m;if(closing){while(stack.length>1){const old=stack.pop();if(old.tagName===tag)break;}continue;}const attrs={},ar=/([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s/]+)))?/g;let a;while((a=ar.exec(raw)))attrs[a[1]]=a[2]??a[3]??a[4]??'';const n=new Node(tag,this.doc,attrs);stack.at(-1).appendChild(n);if(!raw.endsWith('/')&&!['link','input','br','img'].includes(tag))stack.push(n);}}
 get innerHTML(){return this.html||'';}
 matches(sel){sel=sel.trim();if(!sel)return false;const tag=sel.match(/^[\w-]+/);if(tag&&this.tagName!==tag[0])return false;for(const cls of sel.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls[1]))return false;const id=sel.match(/#([\w-]+)/);if(id&&this.attrs.id!==id[1])return false;for(const a of sel.matchAll(/\[([\w-]+)(?:="?([^\]"]+)"?)?\]/g)){if(!(a[1] in this.attrs))return false;if(a[2]!==undefined&&this.attrs[a[1]]!==a[2])return false;}return true;}
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
function rig(game,{reduced=false}={}){
 const document={activeElement:null,createElement(tag){return new Node(tag,this)},getElementById(id){return this.root.querySelector('#'+id)}};
 document.root=new Node('document',document);document.head=document.root.appendChild(new Node('head',document));document.body=document.root.appendChild(new Node('body',document));document.activeElement=document.body;
 const el=document.body.appendChild(new Node('main',document)),roomButton=document.body.appendChild(new Node('button',document,{id:'room'}));
 const timers=new Map(),sent=[],ready=[],rooms=[],cues=[];let sequence=0,clock=0,host=true,roomActionPending=false;
 const api={cue:(name,options)=>cues.push({name,...options}),context:()=>({isHost:host,roomActionPending}),focus:n=>n?.focus(),send:a=>sent.push(a),resultsReady:i=>ready.push(i),rematch:()=>rooms.push('rematch'),lobby:()=>rooms.push('lobby')};
 const context=vm.createContext({document,esc:s=>String(s),nameOf:(S,pid)=>S.players.find(p=>p.id===pid)?.name||'?',matchMedia:()=>({matches:reduced}),setTimeout(fn,ms){const n=++sequence;timers.set(n,{fn,ms,at:clock+ms});return n},clearTimeout(n){timers.delete(n)}});
 const kit=path.join(__dirname,'../public/js/games/board-kit.js');vm.runInContext(fs.readFileSync(kit,'utf8').replace(/^export /gm,''),context,{filename:kit});const file=path.join(__dirname,'../public/js/games/'+game+'.js');vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import[^;]+;\s*/gm,'').replace('export default','globalThis.view='),context,{filename:file});
 const def=require('../games/'+game+'/server'),awards=[],ctx={allPlayers:()=>[{id:'a',name:'Anika'},{id:'b',name:'Bastian'}],award:(...a)=>awards.push(a)};let state=def.create(ctx);
 const S=(pid='a',instance='one')=>({...def.view(state,pid),players:ctx.allPlayers(),me:pid,spectator:!state.seats.includes(pid),instanceId:instance});
 function render(pid='a',instance='one'){const snapshot=S(pid,instance);ok(!('hostId' in snapshot));context.view.render(el,snapshot,api);return snapshot;}
 function action(a,pid=state.seats[state.turn]){def.onAction(state,ctx,pid,{...a,rev:def.view(state,pid).actionRev??state.rev});}
 function advance(ms){clock+=ms;for(const [n,t]of [...timers])if(t.at<=clock){timers.delete(n);t.fn();}}
 return {game,el,document,roomButton,api,view:context.view,sent,ready,rooms,cues,timers,def,ctx,awards,S,render,action,advance,setHost(v){host=v},setRoomPending(v){roomActionPending=v},get state(){return state},setState(s){state=s}};
}
function main(){
for(const game of ['ludo','fleet-duel']){
 const r=rig(game),key=game==='ludo'?'_ludo':'_fleet',control=game==='ludo'?'[data-roll]':'[data-auto]',status='.bk-status';r.render();const opening=r.S();
 eq(r.document.activeElement,r.document.body,'initial mount does not focus');r.el.querySelector(control).dispatch('click');eq(r.sent.length,1);ok(r.el[key].pending);eq([...r.timers.values()].map(t=>t.ms),[4000],'bounded retry timer');const retiredRetry=[...r.timers.values()][0].fn;
 r.render();r.el.querySelector(control).dispatch('click');eq(r.sent.length,1,'same revision reconnect cannot duplicate pending action');r.advance(3999);ok(r.el[key].pending,'keeps pending until deadline');r.advance(1);ok(!r.el[key].pending,'timeout releases input');eq(r.sent.length,1,'timeout never auto resends');ok(r.el.querySelector(status).textContent.includes('Try again'),'friendly retry status');r.el.querySelector(control).dispatch('click');eq(r.sent.length,2,'deliberate retry is available');
 retiredRetry();r.el.querySelector(control).dispatch('click');eq(r.sent.length,2,'retired retry cannot unlock a later attempt at the same revision');
 r.action(r.sent.at(-1),'a');r.render();ok(!r.el[key].pending,'accepted snapshot clears pending');ok(![...r.timers.values()].some(t=>t.ms===4000),'accepted revision cancels retry');r.advance(5000);eq(r.sent.length,2,'canceled retry remains inert');const accepted=r.el[key].S;r.view.render(r.el,opening,r.api);eq(r.el[key].S,accepted,'obsolete snapshot cannot rewind a confirmed turn');
 const n=rig(game);n.render();n.el.querySelector(control).dispatch('click');const old=[...n.timers.values()][0].fn;n.setState(n.def.create(n.ctx));n.render('a','new');eq(n.timers.size,0,'new instance cancels retry timer');old();ok(!n.el[key].pending&&!n.el[key].retry,'retired callback cannot affect new game');n.el.querySelector(control).dispatch('click');const retired=[...n.timers.values()][0].fn;n.view.dispose(n.el);eq(n.timers.size,0,'dispose cancels retry');retired();ok(!n.el[key],'retired callback cannot restore controller');
 const m=rig(game);m.render('watcher');m.el.querySelector(control).dispatch('click');eq(m.sent.length,0,'watcher input cannot send');ok(m.el.querySelector('[data-resign]').hidden);m.render();m.el.querySelector('[data-resign]').dispatch('click');m.el.querySelector('[data-keep]').dispatch('click');eq(m.sent.length,0,'cancel resignation sends nothing');
 m.el.querySelector('[data-resign]').dispatch('click');m.el.querySelector('[data-confirm-resign]').dispatch('click');eq(m.sent.length,1);m.action(m.sent[0],'a');m.render();eq(m.ready,['one'],'live resignation presents once');m.setRoomPending(true);m.render();ok(m.el.querySelector('[data-rematch]').disabled,'pending platform request disables rematch');m.el.querySelector('[data-rematch]').dispatch('click');eq(m.rooms,[],'pending platform request cannot resend');m.setRoomPending(false);m.render();m.el.querySelector('[data-rematch]').dispatch('click');eq(m.rooms,['rematch']);m.setHost(false);m.render();ok(m.el.querySelector('[data-rematch]').disabled);m.el.querySelector('[data-lobby]').dispatch('click');eq(m.rooms,['rematch'],'handler gates migrated host');m.render();eq(m.ready,['one'],'duplicate done does not replay');
 const reconnect=rig(game);reconnect.setState(m.state);reconnect.render();reconnect.advance(5000);eq(reconnect.ready,[],'first done mount does not replay celebration');
 const preparing=rig(game);preparing.view.render(preparing.el,{...preparing.S(),preparing:true},preparing.api);preparing.el.querySelector(control).dispatch('click');eq(preparing.sent.length,0,'preparing room cannot accept a turn');
}
{
 const r=rig('ludo');r.render();r.render('watcher');ok(r.el.querySelector('.ld-choices').hidden,'a role update hides private pawn controls without reading an absent seat');r.render();ok(!r.el.querySelector('.ld-choices').hidden);eq(r.el.querySelectorAll('[data-choice]').length,4,'player choice controls return with its actual pawns');
}
{
 const r=rig('fleet-duel');r.render();r.el.querySelector('[data-chart-zoom]').dispatch('click');ok(r.el.querySelector('.fl-stage').classList.contains('is-zoomed'),'chart zoom is local to its scroll region');r.el.querySelector('[data-chart-zoom]').dispatch('click');ok(!r.el.querySelector('.fl-stage').classList.contains('is-zoomed'));eq(r.sent,[],'zoom never sends placement or aim');eq(r.el.querySelectorAll('[data-square]').length,100,'zoom preserves authoritative logical squares');
 r.action({auto:true},'a');r.render();eq(r.el.querySelectorAll('.fl-vessel').length,5,'captain sees its own confirmed fleet');r.render('watcher');eq(r.el.querySelectorAll('.fl-vessel').length,0,'role change at the same revision removes previously painted private ships');eq(r.el.querySelectorAll('[data-tab]').length,0);eq(r.el.querySelectorAll('[data-watch]').length,2,'spectator harbor tabs replace private captain tabs');ok(r.el.querySelector('.fl-placement').hidden);r.render();eq(r.el.querySelectorAll('.fl-vessel').length,5,'captain reconnect restores only its actual fleet');eq(r.el.querySelectorAll('[data-tab]').length,2);
}
{
 const r=rig('ludo');r.render();const roll=r.el.querySelector('[data-roll]');roll.focus();roll.dispatch('click');r.state.phase='move';r.state.die=6;r.state.rev++;r.state.lastMove={kind:'roll',side:0,die:6,rev:r.state.rev};r.render();eq(r.document.activeElement,roll,'roll focus survives accepted snapshot');ok(r.el._ludo.rolling&&r.el._ludo.settling,'authoritative roll tumbles before selection');eq(r.el.querySelector('[data-choice="0"]').getAttribute('aria-disabled'),'true');r.advance(549);ok(r.el._ludo.settling);r.advance(1);ok(!r.el._ludo.rolling&&!r.el._ludo.settling);
 const first=r.el.querySelector('[data-choice="0"]');first.focus();first.dispatch('keydown',{key:'ArrowRight'});eq(r.document.activeElement,r.el.querySelector('[data-choice="1"]'),'arrows choose another pawn');r.document.activeElement.dispatch('click');r.action(r.sent.at(-1));r.render();eq(r.document.activeElement,r.el.querySelector('[data-choice="1"]'),'confirmed move preserves stable choice focus');ok(r.el._ludo.settling,'confirmed move settles');
 r.roomButton.focus();r.render();r.advance(550);eq(r.document.activeElement,r.roomButton,'room focus is not stolen by settlement');eq(r.state.phase,'roll','six returns to roll phase');r.el.querySelector('[data-roll]').dispatch('click');eq(r.sent.length,3,'next roll stays usable');
}
{
 const r=rig('fleet-duel');r.render();r.el.querySelector('[data-square="0"]').focus();r.el.querySelector('[data-square="0"]').dispatch('keydown',{key:'ArrowRight'});eq(r.document.activeElement.id,'fl-cell-1');r.document.activeElement.dispatch('keydown',{key:'r'});r.document.activeElement.dispatch('keydown',{key:'Enter'});eq(r.el.querySelector('[data-confirm-ship]').getAttribute('aria-disabled'),'false','keyboard placement is confirmable');r.el.querySelector('[data-confirm-ship]').focus();r.el.querySelector('[data-confirm-ship]').dispatch('click');eq(r.sent.length,1);eq(r.document.activeElement,r.el.querySelector('[data-confirm-ship]'),'pending confirm keeps keyboard focus');eq(r.sent[0].place.at,1);eq(r.sent[0].place.vertical,true);
 r.action(r.sent[0],'a');r.render();eq(r.document.activeElement,r.el.querySelector('[data-confirm-ship]'),'confirmed placement keeps keyboard focus');r.action({auto:true},'a');r.action({auto:true},'b');r.action({ready:true},'a');r.action({ready:true},'b');r.render();eq(r.state.phase,'play');
 r.el.querySelector('[data-square="1"]').focus();r.el.querySelector('[data-square="1"]').dispatch('keydown',{key:'ArrowRight'});r.document.activeElement.dispatch('keydown',{key:'Enter'});const fire=r.el.querySelector('[data-fire]');fire.focus();fire.dispatch('click');eq(r.sent.length,2);eq(r.sent[1].fire,2);r.action(r.sent[1],'a');r.render();eq(r.document.activeElement,fire,'Fire focus survives confirmed shot');r.roomButton.focus();r.advance(700);eq(r.document.activeElement,r.roomButton,'shot settlement does not steal room focus');r.action({fire:0},'b');r.render();r.advance(700);eq(r.document.activeElement,r.roomButton,'opponent update does not steal room focus');
 r.el.querySelector('[data-square="2"]').focus();r.el.querySelector('[data-square="2"]').dispatch('keydown',{key:'ArrowRight'});r.document.activeElement.dispatch('keydown',{key:'Enter'});fire.dispatch('click');eq(r.sent.length,3,'next keyboard aim and Fire works');eq(r.sent[2].fire,3);
}
for(const reduced of [false,true])for(const die of [1,2,3,4,5,6]){
 const r=rig('ludo',{reduced});r.state.pawns[0][0]=10;r.render();r.el.querySelector('[data-roll]').dispatch('click');eq(r.sent.length,1);eq(r.el._ludo.dieShown,1,'pending roll invents no result');
 const crypto=require('node:crypto'),original=crypto.randomInt;try{crypto.randomInt=()=>die;r.action(r.sent[0],'a');}finally{crypto.randomInt=original;}r.render();eq(r.el._ludo.dieShown,die,'cube pose uses only authoritative die');
 if(!reduced){ok(r.el._ludo.settling&&r.el._ludo.rolling);ok(r.el.querySelector('.bk-status').textContent.includes('Rolling'));eq(r.el.querySelector('[data-choice="0"]').getAttribute('aria-disabled'),'true');r.el.querySelector('[data-choice="0"]').dispatch('click');eq(r.sent.length,1,'pawn choice blocked during die tumble');r.render();eq(r.timers.size,1,'duplicate snapshot does not restart die settlement');r.roomButton.focus();r.advance(549);ok(r.el._ludo.settling);r.advance(1);eq(r.document.activeElement,r.roomButton,'die settlement preserves Room focus');}
 ok(!r.el._ludo.settling&&!r.el._ludo.rolling,'reduced motion or settled roll is stable');eq(r.el.querySelector('.ld-roll-label').textContent,'Move','die affordance names pawn-choice phase');ok(r.el.querySelector('[data-roll]').getAttribute('aria-label').includes(`Die shows ${die}`),'die accessible value follows authority');eq(r.el.querySelector('[data-choice="0"]').getAttribute('aria-disabled'),'false');r.el.querySelector('[data-choice="0"]').dispatch('click');eq(r.sent.length,2,'selection becomes usable only after settlement');r.view.dispose(r.el);eq(r.timers.size,0);
}
{
 const r=rig('ludo');r.render();r.state.phase='move';r.state.die=6;r.state.rev=1;r.state.lastMove={kind:'roll',die:6,side:0,rev:1};r.render();const retired=[...r.timers.values()][0].fn;r.setState(r.def.create(r.ctx));r.render('a','fresh');eq(r.timers.size,0,'new instance cancels die tumble');retired();ok(!r.el._ludo.rolling&&!r.el._ludo.settling,'retired die callback cannot mutate new game');
 const reconnect=rig('ludo');reconnect.setState({...r.state,phase:'move',die:6,rev:1,lastMove:{kind:'roll',die:6,side:0,rev:1}});reconnect.render();ok(!reconnect.el._ludo.rolling&&!reconnect.el._ludo.settling,'same roll on first reconnect mount does not tumble again');eq(reconnect.el._ludo.dieShown,6);eq(reconnect.timers.size,0);
}
for(const game of ['ludo','fleet-duel'])for(const reduced of [false,true]){
 const r=rig(game,{reduced});r.render();
 if(game==='ludo'){r.state.pawns[0]=[56,56,56,55];r.state.phase='move';r.state.die=1;r.state.rev++;r.render();r.action({move:3});}
 else{r.action({auto:true},'a');r.action({auto:true},'b');r.action({ready:true},'a');r.action({ready:true},'b');r.render();const fleet=r.state.fleets[1];for(let ship=0;ship<5;ship++)for(let i=0;i<[5,4,3,3,2][ship];i++)r.state.shots[0][fleet[ship].at+i*(fleet[ship].vertical?10:1)]=2;const last=fleet[4].at;r.state.shots[0][last]=0;r.action({fire:last},'a');}
 r.render();if(!reduced){eq(r.ready,[],'final animation delays result');ok(r.el.querySelector('.bk-final').hidden);r.render();eq(r.timers.size,1,'duplicate done keeps one settlement');r.advance(700);}eq(r.ready,['one'],'result presentation fires once after settlement');ok(!r.el.querySelector('.bk-final').hidden);r.render();r.advance(5000);eq(r.ready,['one']);eq(r.awards.length,game==='ludo'?2:1,'authority awarded once (Ludo also places second)');
}
{
 const r=rig('ludo');r.render();r.action({roll:true});r.render();eq(r.cues,[],'die remains quiet until its actual face settles');
 const timer=[...r.timers.keys()][0];r.advance(300);r.render();eq([...r.timers.keys()],[timer],'mid-roll heartbeat cannot extend the deadline');r.advance(249);eq(r.cues,[]);r.advance(1);eq(r.cues.map(c=>c.name),['dice']);r.render();r.advance(3000);eq(r.cues.length,1,'accepted die face has one cue');
 const q=rig('ludo');q.render();q.action({roll:true});q.render();q.view.render(q.el,{...q.S(),audioBaseline:true},q.api);q.advance(550);eq(q.cues,[],'reconnect during tumble cancels delayed die sound');
}
{
 // This declared unit position supplies one legal, authoritative capture.
 const r=rig('ludo');r.state.phase='move';r.state.die=1;r.state.pawns[0][0]=5;r.state.pawns[1][0]=32;r.render();r.action({move:0});r.render();eq(r.state.lastMove.captured.length,1,'authority actually captured a pawn');
 const actor=r.el.querySelector('#ld-pawn-0-0'),victim=r.el.querySelector('#ld-pawn-1-0'),motion=victim.querySelector('animateMotion');ok(motion,'captured pawn returns to its actual yard');eq(motion.getAttribute('keyTimes'),'0;.68;1','victim stays at the landing until the mover arrives');
 const coords=n=>n.getAttribute('transform').match(/translate\(([-.\d]+) ([-.\d]+)\)/).slice(1).map(Number),a=coords(actor),b=coords(victim),start=motion.getAttribute('values').split(';')[0].split(',').map(Number);ok(Math.abs(start[0]+b[0]-a[0])<1e-8&&Math.abs(start[1]+b[1]-a[1])<1e-8,'capture return starts at the real landing square');
 r.advance(550);ok(r.el._ludo.settling,'capture return stays locked after actor landing');eq(r.cues,[]);r.advance(210);ok(!r.el._ludo.settling);eq(r.cues.map(c=>c.name),['capture']);r.render();eq(r.cues.length,1);
}
{
 const r=rig('fleet-duel');r.render();r.el.querySelector('[data-auto]').dispatch('click');const pending=[...r.timers.keys()][0];r.action({auto:true},'b');r.render();ok(r.el._fleet.pending,'opponent private placement cannot acknowledge our pending placement');eq([...r.timers.keys()],[pending]);r.el.querySelector('[data-auto]').dispatch('click');eq(r.sent.length,1,'concurrent opponent placement cannot allow a duplicate command');r.action(r.sent[0],'a');r.render();ok(!r.el._fleet.pending);eq(r.cues.map(c=>c.name),['place'],'confirmed private fleet has one placement cue');
 r.action({ready:true},'a');r.action({ready:true},'b');r.render();r.el.querySelector('[data-tab="own"]').dispatch('click');const at=r.state.fleets[1][0].at;r.action({fire:at},'a');r.render();eq(r.el._fleet.tab,'target','confirmed shot shows the actual struck harbor');ok(r.el.querySelector('.fl-impact'),'shot impact remains mounted');eq(r.cues.at(-1).name,'capture');
 r.el.querySelector('[data-tab="own"]').dispatch('click');r.el.querySelector('[data-square="99"]').dispatch('click');ok(r.el.querySelector('.fl-impact'),'view actions cannot erase an active impact');const timer=[...r.timers.keys()][0];r.advance(200);r.render();eq([...r.timers.keys()],[timer],'mid-impact heartbeat preserves completion time');r.advance(500);eq(r.cues.length,2,'shot sound does not replay at settlement or heartbeat');r.view.dispose(r.el);
}
for(const game of ['ludo','fleet-duel']){
 const r=rig(game),key=game==='ludo'?'_ludo':'_fleet';r.render();if(game==='fleet-duel'){r.action({auto:true},'a');r.action({auto:true},'b');r.action({ready:true},'a');r.action({ready:true},'b');r.render();r.action({fire:0},'a')}else r.action({roll:true});r.render();const retired=[...r.timers.values()][0].fn;
 if(game==='fleet-duel')r.action({fire:0},'b');else r.action(r.state.phase==='move'?{move:r.S(r.state.seats[r.state.turn]).legal[0]}:{roll:true});r.render();const timer=[...r.timers.keys()][0],cues=r.cues.length;retired();ok(r.el[key].settling,'retired same-instance completion cannot settle a later action');eq([...r.timers.keys()],[timer]);eq(r.cues.length,cues,'retired completion stays silent');r.advance(1000);ok(!r.el[key].settling);r.view.dispose(r.el);
}
{
 const r=rig('fleet-duel');r.render();const stage=r.el.querySelector('.fl-stage');stage.rect={left:10,right:110,top:30,bottom:130};stage.scrollLeft=15;stage.scrollTop=20;
 r.el.querySelector('[data-chart-zoom]').dispatch('click');
 const original=Node.prototype.getBoundingClientRect;Node.prototype.getBoundingClientRect=function(){return this.id.startsWith('fl-cell-')?{left:95,right:145,top:115,bottom:165}:original.call(this)};
 Node.prototype.scrollIntoView=function(){throw Error('Cursor scrolled outer document')};
 try{r.el.querySelector('[data-square="0"]').dispatch('keydown',{key:'ArrowRight'});eq(r.document.activeElement.id,'fl-cell-1','actual arrow handler preserves cursor focus');eq(stage.scrollLeft,50,'zoomed keyboard cursor scrolls only chart horizontally');eq(stage.scrollTop,55,'zoomed keyboard cursor scrolls only chart vertically');
 Node.prototype.getBoundingClientRect=function(){return this.id.startsWith('fl-cell-')?{left:20,right:70,top:40,bottom:90}:original.call(this)};
 r.document.activeElement.dispatch('keydown',{key:'ArrowRight'});eq(stage.scrollLeft,50,'visible cursor preserves chart horizontal scroll');eq(stage.scrollTop,55,'visible cursor preserves chart vertical scroll');
 }finally{Node.prototype.getBoundingClientRect=original;delete Node.prototype.scrollIntoView;r.view.dispose(r.el)}
}
console.log(`LUDO_FLEET_VIEW_PASS: ${checks} shipped-client assertions (4s recovery, duplicate snapshots, timer disposal, keyboard continuity, external focus, result settlement, reconnect and host migration)`);
}
module.exports={rig};
if(require.main===module)main();
