'use strict';
// Execute the shipped SVG clients in a small DOM double. Browser fixtures
// separately verify real layout/animation; these checks target lifecycle races.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
let checks=0;function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}function ok(v,m){assert(v,m);checks++;}
class Node {
 constructor(tag,doc,attrs={}){this.tagName=tag;this.doc=doc;this.attrs=attrs;this.children=[];this.parentNode=null;this.text='';this.events=new Map();this.dataset={};for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,a)=>a.toUpperCase())]=v;this.classList={contains:x=>(this.attrs.class||'').split(/\s+/).includes(x),add:(...xs)=>{this.attrs.class=[...new Set([...(this.attrs.class||'').split(/\s+/).filter(Boolean),...xs])].join(' ')},toggle:(x,on)=>{const present=this.classList.contains(x),want=on===undefined?!present:on;this.attrs.class=(this.attrs.class||'').split(/\s+/).filter(c=>c&&c!==x).concat(want?[x]:[]).join(' ');return want;}};}
 appendChild(n){n.parentNode=this;this.children.push(n);return n;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
 set innerHTML(html){this.html=html;this.children=[];this.text='';const stack=[this],re=/<(\/?)([\w-]+)([^>]*)>|([^<]+)/g;let m;while((m=re.exec(html))){if(m[4]){stack.at(-1).text+=m[4];continue;}const [,closing,tag,raw]=m;if(closing){while(stack.length>1){const old=stack.pop();if(old.tagName===tag)break;}continue;}const attrs={},ar=/([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s/]+)))?/g;let a;while((a=ar.exec(raw)))attrs[a[1]]=a[2]??a[3]??a[4]??'';const n=new Node(tag,this.doc,attrs);stack.at(-1).appendChild(n);if(!raw.endsWith('/')&&!['link','input','br','img'].includes(tag))stack.push(n);}}
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
// The shared board panel ships as its own module; inline it like util.
function loadKit(context){const file=path.join(__dirname,'../public/js/games/board-kit.js');vm.runInContext(fs.readFileSync(file,'utf8').replace(/^export /gm,''),context,{filename:file});}
function rig(game,{reduced=false}={}){
 const document={activeElement:null,createElement(tag){return new Node(tag,this)},getElementById(id){return this.root.querySelector('#'+id)}};document.root=new Node('document',document);document.head=document.root.appendChild(new Node('head',document));const el=document.root.appendChild(new Node('main',document));
 const timers=new Map(),sent=[],ready=[],rooms=[],cues=[];let id=0,host=true,roomActionPending=false;
 const api={cue:(name,options)=>cues.push({name,...options}),context:()=>({isHost:host,roomActionPending}),focus:n=>n?.focus(),send:a=>sent.push(a),resultsReady:i=>ready.push(i),rematch:()=>rooms.push('rematch'),lobby:()=>rooms.push('lobby')};
 const context=vm.createContext({document,matchMedia:()=>({matches:reduced}),setTimeout(fn,ms){const n=++id;timers.set(n,{fn,ms});return n},clearTimeout(n){timers.delete(n)},nameOf:(S,pid)=>S.players.find(p=>p.id===pid)?.name||'?' });
 loadKit(context);const file=path.join(__dirname,'../public/js/games/'+game+'.js'),source=fs.readFileSync(file,'utf8').replace(/^import[^;]+;\s*/gm,'').replace('export default','globalThis.view=');vm.runInContext(source,context,{filename:file});
 const def=require('../games/'+game+'/server'),ctx={allPlayers:()=>[{id:'a',name:'AlexandertheGreat'},{id:'b',name:'BeatrixLongName'}],award(){}};let state=def.create(ctx);
 const S=(pid='a',instance='one')=>({...def.view(state,pid),players:ctx.allPlayers(),me:pid,spectator:!state.seats.includes(pid),instanceId:instance});
 function render(pid='a',instance='one'){const snapshot=S(pid,instance);ok(!('hostId' in snapshot),'fixture uses actual state without hostId');context.view.render(el,snapshot,api);return snapshot;}
 function turn(move){def.onAction(state,ctx,state.seats[state.turn-1],{...move,rev:state.rev})}
 function flush(){for(const [n,t]of [...timers]){timers.delete(n);t.fn()}}
 return {el,document,api,view:context.view,sent,ready,rooms,cues,timers,def,ctx,S,render,turn,flush,setHost(v){host=v},setRoomPending(v){roomActionPending=v},get state(){return state},setState(s){state=s}};
}
function main(){
for(const game of ['reversi','four-in-a-row']){
 const r=rig(game);r.render();const target=game==='reversi'?'[data-cell="19"]':'[data-column="3"]';
 r.el.querySelector(target).dispatch('click');const retiredRetry=[...r.timers.values()].find(t=>t.ms===4000).fn;
 r.render();r.el.querySelector(target).dispatch('click');eq(r.sent.length,1,'same-revision heartbeat cannot unlock an unconfirmed move');
 eq(r.el.querySelector(target).getAttribute('aria-disabled'),'true','pending move remains unavailable to assistive input');
 r.flush();ok(r.el.querySelector('.bk-status').textContent.includes('Try again'),'lost acknowledgement offers a bounded retry');
 r.el.querySelector(target).dispatch('click');eq(r.sent.length,2,'unconfirmed move may retry using the same authority revision');
 retiredRetry();r.el.querySelector(target).dispatch('click');eq(r.sent.length,2,'retired retry callback cannot unlock a later attempt');
 const old=r.S();r.turn(r.sent[1]);r.render();r.view.render(r.el,old,r.api);
 eq(game==='reversi'?r.el.querySelectorAll('.rv-disc').length:r.el.querySelectorAll('.fr-counter').length,game==='reversi'?5:1,'older revision cannot replace the confirmed board');
 r.view.dispose(r.el);eq(r.timers.size,0,'disposal cancels retry and presentation');retiredRetry();eq(r.timers.size,0,'disposed retry cannot create callbacks');
 const preparing=rig(game);preparing.view.render(preparing.el,{...preparing.S(),preparing:true},preparing.api);preparing.el.querySelector(target).dispatch('click');eq(preparing.sent.length,0,'preparing field cannot send a move');
}
for(const game of ['reversi','four-in-a-row']){
 const r=rig(game);r.render();eq(r.document.activeElement,null,'mount never summons board focus');const target=game==='reversi'?'[data-cell="19"]':'[data-column="3"]';
 eq(r.el.querySelectorAll('[tabindex="0"]').length,1,'one keyboard cursor');r.el.querySelector(target).focus();r.el.querySelector(target).dispatch('keydown',{key:'Enter'});r.el.querySelector(target).dispatch('keydown',{key:'Enter'});eq(r.sent.length,1,'pending input prevents duplicate send');eq(r.sent[0].rev,0);
 const focusedBefore=r.document.activeElement;r.turn(r.sent[0]);r.render();eq(r.sent.length,1,'snapshot does not send');
 ok(r.document.activeElement!==focusedBefore,'keyboard focus restores onto the new SVG hit node');eq(r.document.activeElement,r.el.querySelector(target),'keyboard focus follows the replaced board node');
 const help=r.el.querySelector('summary');help.focus();r.turn(game==='reversi'?{place:r.def.view(r.state,'b').legal[0]}:{drop:6});r.render();eq(r.document.activeElement,help,'board update leaves Help focus alone');
 r.render('watcher');r.el.querySelector(target).dispatch('click');eq(r.sent.length,1,'watcher click inert');ok(r.el.querySelector('[data-resign]').hidden,'watcher cannot resign');
 if(game==='reversi')eq(r.el.querySelectorAll('.rv-legal').length,0,'watcher dots absent');else{r.el.querySelector(target).dispatch('pointermove',{pointerType:'mouse'});eq(r.el.querySelectorAll('.fr-preview.is-visible').length,0,'watcher hover absent');}
 r.render('b');r.el.querySelector('[data-resign]').dispatch('click');ok(!r.el.querySelector('.bk-row-confirm').hidden);r.el.querySelector('[data-keep]').dispatch('click');ok(r.el.querySelector('.bk-row-confirm').hidden);eq(r.sent.length,1,'canceled resignation sends nothing');
 r.el.querySelector('[data-resign]').dispatch('click');r.el.querySelector('[data-confirm-resign]').dispatch('click');eq(r.sent.length,2);r.def.onAction(r.state,r.ctx,'b',r.sent[1]);r.render();r.flush();
 eq(r.ready,['one'],'one live to done presentation');ok(!r.el.querySelector('[data-rematch]').disabled,'host uses context, no snapshot hostId');r.el.querySelector('[data-rematch]').dispatch('click');eq(r.rooms,['rematch']);
 r.setHost(false);r.render();ok(r.el.querySelector('[data-rematch]').disabled,'lost host disables result action');r.el.querySelector('[data-lobby]').dispatch('click');eq(r.rooms,['rematch'],'non-host handler also gates');r.setHost(true);r.render('watcher');ok(!r.el.querySelector('[data-rematch]').disabled,'watcher host may control next match');r.el.querySelector('[data-lobby]').dispatch('click');eq(r.rooms,['rematch','lobby']);
 r.view.dispose(r.el);eq(r.timers.size,0);ok(!r.el._four&&!r.el._reversi,'view controller removed');const sends=r.sent.length;r.el.querySelector(target).dispatch('click');eq(r.sent.length,sends,'retired listeners inert');
 const reconnect=rig(game);reconnect.setState(r.state);reconnect.render();reconnect.flush();eq(reconnect.ready,[],'done first mount never replays result');
}
{
 const r=rig('reversi');r.state.board=Array(64).fill(1);r.state.board[0]=r.state.board[63]=0;r.state.board[1]=r.state.board[62]=2;r.render();r.turn({place:0});r.render();r.turn({place:63});r.render();eq(r.ready,[],'final flip delays celebration');ok(r.el.querySelector('.rv-flip'),'final capture animates');ok(r.el.querySelector('.bk-final').hidden,'result buttons wait for flip');eq(r.timers.size,1);r.render();eq(r.timers.size,1,'duplicate done retains one completion');r.flush();eq(r.ready,['one']);ok(!r.el.querySelector('.bk-final').hidden);r.render();r.flush();eq(r.ready,['one'],'done tick never repeats');
}
for(const reduced of [false,true]){
 const r=rig('four-in-a-row',{reduced});r.render();for(const drop of [0,6,1,6,2,5,3]){r.turn({drop});r.render();}
 if(!reduced){eq(r.ready,[],'last drop delays celebration');ok(!r.el.querySelector('.fr-board').classList.contains('fr-settled'),'winning glow waits');ok(r.el.querySelector('.bk-final').hidden);r.render();eq(r.timers.size,1);r.flush();}
 eq(r.ready,['one']);ok(r.el.querySelector('.fr-board').classList.contains('fr-settled'));ok(!r.el.querySelector('.bk-final').hidden);r.render();r.flush();eq(r.ready,['one']);
}
for(const game of ['reversi','four-in-a-row']){
 const r=rig(game);r.render();if(game==='reversi'){r.state.board=Array(64).fill(1);r.state.board[0]=0;r.state.board[1]=2;r.render('a','setup');r.turn({place:0});r.render('a','setup');}else{for(const drop of [0,6,1,6,2,5,3]){r.turn({drop});r.render();}}
 ok(r.timers.size>0,'pending old animation exists');r.setState(r.def.create(r.ctx));r.render('a','new-instance');eq(r.timers.size,0,'new instance cancels old presentation');r.flush();eq(r.ready,[],'old game completion cannot celebrate new game');
}
// A real opening move may change authority while its physical disc is settling.
for(const game of ['reversi','four-in-a-row'])for(const reduced of [false,true]){
 const r=rig(game,{reduced}),controller=game==='reversi'?'_reversi':'_four';r.render('b');eq(r.cues,[],'initial table is silent');
 r.turn(game==='reversi'?{place:19}:{drop:3});r.render('b');
 const target=game==='reversi'?`[data-cell="${r.S('b').legal[0]}"]`:'[data-column="4"]';
 if(!reduced){
  ok(r.el[controller].settling,'all confirmed moves own a settlement, not only finals');
  r.el.querySelector(target).dispatch('click');eq(r.sent.length,0,'next seat cannot act inside the previous move');
  eq(r.el.querySelector(target).getAttribute('aria-disabled'),'true','assistive input follows settlement gate');
  const timer=[...r.timers.keys()][0];r.render('b');eq([...r.timers.keys()],[timer],'heartbeat retains the original completion timer');eq(r.cues,[],'no landing cue before its visual completion');r.flush();
 }
 eq(r.cues.map(c=>c.name),[game==='reversi'?'capture':'piece'],'one rule-specific settled cue');ok(r.cues[0].id.startsWith('one:1:'),'cue is scoped to its real instance and action');
 r.render('b');r.flush();eq(r.cues.length,1,'same action cannot replay its cue');
 r.el.querySelector(target).dispatch('click');eq(r.sent.length,1,'legal input opens after visual completion');r.view.dispose(r.el);
 const q=rig(game);q.render('b');q.turn(game==='reversi'?{place:19}:{drop:3});q.render('b');q.view.render(q.el,{...q.S('b'),audioBaseline:true},q.api);q.flush();eq(q.cues,[],'reconnect baseline cancels an already pending sound');
 const z=rig(game);z.render('b');z.turn(game==='reversi'?{place:19}:{drop:3});z.view.render(z.el,{...z.S('b'),audioBaseline:true},z.api);eq(z.cues,[],'first state after reconnect is silent even one revision ahead');eq(z.timers.size,0,'reconnect does not schedule a delayed historical cue');
}
for(const game of ['reversi','four-in-a-row']){
 const r=rig(game),key=game==='reversi'?'_reversi':'_four';r.render('b');r.turn(game==='reversi'?{place:19}:{drop:3});r.render('b');const retired=[...r.timers.values()][0].fn;r.turn(game==='reversi'?{place:r.S('b').legal[0]}:{drop:4});r.render('b');const timer=[...r.timers.keys()][0];retired();ok(r.el[key].settling,'retired completion cannot unlock a newer move');eq([...r.timers.keys()],[timer],'retired completion cannot remove newer timer');eq(r.cues,[],'retired completion cannot emit a newer action cue');r.flush();eq(r.cues.length,1);r.view.dispose(r.el);
}
// Board arrows must leave native tools and result controls in control of focus.
for(const game of ['reversi','four-in-a-row']){
 const r=rig(game);r.render();const resign=r.el.querySelector('[data-resign]');resign.focus();
 for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']){const e=resign.dispatch('keydown',{key});ok(r.document.activeElement===resign,'tool arrows cannot steal focus into the board');ok(!e.prevented,'native tool arrows retain their default behavior');}
 r.el.querySelector('[data-resign]').dispatch('click');r.el.querySelector('[data-confirm-resign]').dispatch('click');r.turn(r.sent.at(-1));r.render();r.flush();
 r.setRoomPending(true);r.render();for(const selector of ['[data-rematch]','[data-lobby]']){const button=r.el.querySelector(selector);ok(button.disabled,'pending room change disables both final actions');button.dispatch('click');}
 eq(r.rooms,[],'pending room change cannot submit duplicate final actions');r.setRoomPending(false);r.render();r.el.querySelector('[data-rematch]').dispatch('click');eq(r.rooms,['rematch'],'final action returns after room request settles');r.view.dispose(r.el);
}
// Standard panel: draw offers, tie result with shared ranks, move timer.
for(const game of ['reversi','four-in-a-row']){
 const r=rig(game);r.render('a');eq(r.el.querySelector('.bk-timer').hidden,true,'move timer off: no timer row');
 r.el.querySelector('[data-offer-draw]').dispatch('click');eq(JSON.stringify(r.sent.at(-1)),JSON.stringify({offerDraw:true,rev:0}),'offer draw sends with the revision');
 r.def.onAction(r.state,r.ctx,'a',r.sent.at(-1));r.render('a');ok(r.el.querySelector('[data-offer-draw]').disabled,'own pending offer cannot repeat');eq(r.el.querySelector('[data-offer-draw]').textContent,'Draw offered');
 r.render('b');ok(!r.el.querySelector('.bk-row-offer').hidden,'opponent sees Accept draw / Decline');ok(r.el.querySelector('.bk-row-play').hidden,'the offer replaces the action row in the same space');
 r.el.querySelector('[data-decline-draw]').dispatch('click');eq(r.sent.at(-1).declineDraw,true);r.def.onAction(r.state,r.ctx,'b',r.sent.at(-1));r.render('b');ok(r.el.querySelector('.bk-row-offer').hidden,'decline clears the offer');
 r.render('a');ok(r.el.querySelector('[data-offer-draw]').disabled,'declined player waits for a move before offering again');
 r.turn(game==='reversi'?{place:19}:{drop:0});r.render('a');r.flush();r.def.onAction(r.state,r.ctx,'a',{offerDraw:true,rev:r.state.rev});r.render('b');
 r.el.querySelector('[data-accept-draw]').dispatch('click');eq(r.sent.at(-1).acceptDraw,true);r.def.onAction(r.state,r.ctx,'b',r.sent.at(-1));r.render('b');r.flush();
 eq(r.el.querySelector('.bk-winner').textContent,'It’s a tie','a draw is named as a tie');
 const ranks=r.el.querySelectorAll('.bk-rank').map(n=>n.textContent);eq(ranks,['1','1'],'tied players share the rank');
 ok(r.el.querySelectorAll('.bk-points').every(n=>n.textContent==='+150'),'a draw gives 150 each');
 ok(r.el.querySelector('.bk-rank-row.is-you'),'the viewer row is highlighted');
 const t=rig(game);t.ctx.now=()=>1000;t.ctx.settings=()=>({moveTimer:'30 seconds'});t.setState(t.def.create(t.ctx));t.render('a');
 ok(!t.el.querySelector('.bk-timer').hidden,'move timer row shows when on');ok(t.el.querySelector('.bk-meta').textContent.includes('Move timer 30 s'),'meta names the move timer');
}
console.log(`BOARD_DUELS_VIEW_PASS: ${checks} actual-client assertions (keyboard/tap ownership, pending duplicates, watcher preview, resignation, real API host migration, deferred/drop/flip readiness, reconnect, reduced motion and disposal)`);
}
module.exports={rig,loadKit};
if(require.main===module)main();
