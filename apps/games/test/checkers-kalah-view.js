'use strict';
// Shipped board clients: pending actions, retired callbacks and prepared roles.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
let checks=0;function ok(v,m){assert(v,m);checks++}function eq(a,b,m){assert.deepEqual(a,b,m);checks++}
class Node {
 constructor(tag,doc,attrs={}){this.tagName=tag;this.doc=doc;this.attrs=attrs;this.children=[];this.parentNode=null;this.text='';this.style={};this.events=new Map();this.dataset={};for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,a)=>a.toUpperCase())]=v;this.classList={contains:x=>(this.attrs.class||'').split(/\s+/).includes(x),add:(...xs)=>{this.attrs.class=[...new Set([...(this.attrs.class||'').split(/\s+/).filter(Boolean),...xs])].join(' ')},toggle:(x,on)=>{const present=this.classList.contains(x),want=on===undefined?!present:on;this.attrs.class=(this.attrs.class||'').split(/\s+/).filter(c=>c&&c!==x).concat(want?[x]:[]).join(' ');return want;}};}
 append(n){return this.appendChild(n);}
 contains(n){for(let p=n;p;p=p.parentNode)if(p===this)return true;return false;}
 get id(){return this.attrs.id||'';}set id(v){this.attrs.id=String(v);}
 hasAttribute(k){return k in this.attrs;}
 getClientRects(){for(let n=this;n;n=n.parentNode)if(n.hidden)return[];return[{}];}
 appendChild(n){n.parentNode=this;this.children.push(n);return n;}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
 set innerHTML(html){if(this.doc.activeElement!==this&&this.contains(this.doc.activeElement))this.doc.activeElement=this.doc.body;this.html=html;this.children=[];this.text='';const stack=[this],re=/<(\/?)([\w-]+)([^>]*)>|([^<]+)/g;let m;while((m=re.exec(html))){if(m[4]){stack.at(-1).text+=m[4];continue;}const [,closing,tag,raw]=m;if(closing){while(stack.length>1){const old=stack.pop();if(old.tagName===tag)break;}continue;}const attrs={},ar=/([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s/]+)))?/g;let a;while((a=ar.exec(raw)))attrs[a[1]]=a[2]??a[3]??a[4]??'';const n=new Node(tag,this.doc,attrs);stack.at(-1).appendChild(n);if(!raw.endsWith('/')&&!['link','input','br','img'].includes(tag))stack.push(n);}}
 get innerHTML(){return this.html||'';}
 matches(sel){sel=sel.trim();if(!sel)return false;const tag=sel.match(/^[\w-]+/);if(tag&&this.tagName!==tag[0])return false;for(const cls of sel.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls[1]))return false;const id=sel.match(/#([\w-]+)/);if(id&&this.attrs.id!==id[1])return false;for(const a of sel.matchAll(/\[([\w-]+)(?:="?([^\]"]+)"?)?\]/g)){if(!(a[1] in this.attrs))return false;if(a[2]!==undefined&&this.attrs[a[1]]!==a[2])return false;}return true;}
 closest(sel){for(let n=this;n;n=n.parentNode)if(sel.split(',').some(s=>n.matches(s)))return n;return null;}
 querySelectorAll(sel){const out=[];function walk(n){for(const child of n.children){if(sel.split(',').some(s=>{const parts=s.trim().split(/\s+/);if(!child.matches(parts.pop()))return false;let parent=child.parentNode;while(parts.length){const part=parts.pop();while(parent&&!parent.matches(part))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode}return true}))out.push(child);walk(child);}}walk(this);return out;}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null;}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 get hidden(){return 'hidden' in this.attrs;}set hidden(v){if(v)this.attrs.hidden='';else delete this.attrs.hidden;}
 get disabled(){return 'disabled' in this.attrs;}set disabled(v){if(v)this.attrs.disabled='';else delete this.attrs.disabled;}
 set textContent(s){this.text=String(s);this.children=[];}get textContent(){return this.text+this.children.map(n=>n.textContent).join('');}
 addEventListener(k,f){if(!this.events.has(k))this.events.set(k,new Set());this.events.get(k).add(f);}removeEventListener(k,f){this.events.get(k)?.delete(f);}
 dispatch(type,extra={}){const e={type,target:this,preventDefault(){this.prevented=true},...extra};for(let n=this;n;n=n.parentNode)for(const f of [...(n.events.get(type)||[])])f(e);return e;}
 focus(){this.doc.activeElement=this;this.dispatch('focusin');}
}

function rig(game,initial={}, {reduced=false,portrait=false}={}){
 const document={activeElement:null,createElement(tag){return new Node(tag,this)},getElementById(id){return this.root.querySelector('#'+id)}};document.root=new Node('document',document);document.head=document.root.appendChild(new Node('head',document));document.body=document.root.appendChild(new Node('body',document));document.activeElement=document.body;const el=document.body.appendChild(new Node('main',document)),window=new Node('window',document);window.matchMedia=q=>({matches:q.includes("orientation")?portrait:reduced&&q.includes("prefers-reduced-motion")});const timers=new Map(),frames=new Map(),sent=[],toasts=[],announcements=[],cues=[];let sequence=0,decodeError=false;const decoded=[];class Image{decode(){decoded.push(this.src);return decodeError?Promise.reject(new Error('Broken board material')):Promise.resolve()}};
 const context=vm.createContext({document,window,Image,esc:s=>String(s),nameOf:(S,pid)=>S.players.find(p=>p.id===pid)?.name||'?',performance:{now:()=>0},setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},requestAnimationFrame(fn){const id=++sequence;frames.set(id,fn);return id},cancelAnimationFrame(id){frames.delete(id)}});
 const kit=path.join(__dirname,'../public/js/games/board-kit.js');vm.runInContext(fs.readFileSync(kit,'utf8').replace(/^export /gm,''),context,{filename:kit});const file=path.join(__dirname,'../public/js/games/'+game+'.js');vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import[^;]+;\s*/gm,'').replace('export default','globalThis.view='),context,{filename:file});const view=context.view,def=require('../games/'+game+'/server'),players=[{id:'a',name:'Anika'},{id:'b',name:'Bastian'}],ctx={allPlayers:()=>players,content:()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../locales/en/'+game+'.json'))),now:()=>10000,award(){}};const state=def.create(ctx),api={cue:(name,options)=>cues.push({name,...options}),send:a=>sent.push(a),announce:s=>announcements.push(s),toast:s=>toasts.push(s)};
 const S=(pid='a',extra={})=>({...def.view(state,pid),instanceId:'same-game',players,spectator:pid==='watcher',...extra});const render=(pid='a',extra={})=>view.update(el,S(pid,extra),api);view.mount(el,api);render('a',initial);const click=()=>{if(game==='checkers'){el.querySelector('[data-square="40"]').dispatch('click');el.querySelector('[data-square="33"]').dispatch('click')}else el.querySelector('[data-pit="2"]').dispatch('click')};return{el,view,state,def,ctx,S,api,sent,cues,timers,frames,toasts,announcements,render,click,decoded,setDecodeError:v=>decodeError=v};
}
function main(){
for(const game of ['checkers','kalah']){
 const r=rig(game),prefix=game==='checkers'?'ck':'kl';r.click();eq(r.sent.length,1,'first legal move sends once');r.render();r.click();eq(r.sent.length,1,'same-revision heartbeat does not unlock pending action');const [id,retiredRetry]=[...r.timers][0];r.timers.delete(id);retiredRetry.fn();eq(r.toasts.length,1,'bounded recovery tells the player to retry');r.click();eq(r.sent.length,2,'deliberate retry works');retiredRetry.fn();r.click();eq(r.sent.length,2,'retired timer cannot unlock a later pending action');eq(r.toasts.length,1,'retired retry cannot toast in a newer lifecycle');r.def.onAction(r.state,r.ctx,'a',r.sent.at(-1));r.render();eq(r.timers.size,0,'accepted snapshot cancels pending timeout');eq(r.frames.size,1,'confirmed move starts one animation');const retiredFrame=[...r.frames.values()][0];r.view.dispose();eq(r.frames.size,0,'dispose cancels animation');eq(r.timers.size,0,'dispose cancels retries');r.view.mount(r.el,r.api);r.render();const nextPlayer=r.state.seats[r.state.turn],v=r.def.view(r.state,nextPlayer),action=game==='checkers'?(()=>{const [from,moves]=Object.entries(v.legal)[0];return{from:Number(from),to:moves[0].to}})():{pit:v.legal[0]};r.def.onAction(r.state,r.ctx,nextPlayer,{...action,revision:r.state.revision});r.render();eq(r.frames.size,1,'same-instance reconnect owns a new move animation');const before=r.el.querySelector('.bk-status-text').textContent;retiredFrame(10000);eq(r.el.querySelector('.bk-status-text').textContent,before,'retired frame cannot settle the new animation');eq(r.frames.size,1,'retired frame cannot replace or cancel new replay');const current=[...r.frames][0];r.frames.delete(current[0]);current[1](10000);ok(r.el.querySelector('.bk-status-text').textContent!==before,'current animation settles normally');r.view.dispose();retiredRetry.fn();eq(r.toasts.length,1,'retired retry after dispose remains inert');
 const q=rig(game,{preparing:true});eq(q.el.querySelector('.bk-status-text').textContent,'','preparation does not mislabel the initial player turn');eq(q.el.querySelector('.bk-hint').textContent,'','preparation does not suggest that the peer is already playing');eq(q.announcements,[],'initial preparation does not announce Their move');q.render('a',{preparing:true});eq(q.announcements,[],'prepared heartbeat remains silent');q.render('a',{preparing:false});eq(q.el.querySelector('.bk-status-text').textContent,'Your move','release displays the current player turn');eq(q.announcements,['Your move'],'unchanged turn announces once when preparation releases');q.render('a',{preparing:false});eq(q.announcements,['Your move'],'released heartbeat does not repeat the turn announcement');q.render('b',{preparing:true});eq(q.el.querySelector('.bk-status-text').textContent,'','prepared role change remains neutral');q.render('b',{preparing:false});eq(q.el.querySelector('.bk-status-text').textContent,'Their move','released peer sees the actual current turn');eq(q.announcements,['Your move','Anika · Their move'],'released peer hears the current player name');q.view.dispose();
 const p=rig(game);p.render('a',{preparing:true});p.click();p.el.querySelector('[data-resign]').dispatch('click');p.el.querySelector('[data-resign]').dispatch('click');p.el.querySelector('[data-offer-draw]').dispatch('click');eq(p.sent.length,0,'prepared board cannot send moves or room-affecting resignation/draw');p.render('watcher');p.click();p.el.querySelector('[data-resign]').dispatch('click');p.el.querySelector('[data-resign]').dispatch('click');eq(p.sent.length,0,'same-revision spectator cannot send a hidden action');p.view.dispose();
}
function tick(r,time){const [id,fn]=[...r.frames][0]||[];ok(fn,'live animation frame exists');r.frames.delete(id);fn(time)}
for(const game of ['checkers','kalah']){
 const r=rig(game);eq(r.cues,[],'initial material table stays silent');r.click();r.def.onAction(r.state,r.ctx,'a',r.sent.at(-1));r.render();eq(r.cues,[],'authority confirmation starts motion before sound');const frame=[...r.frames.keys()][0];r.render();eq([...r.frames.keys()],[frame],'same revision keeps original motion frame');tick(r,2400);eq(r.frames.size,0,'normal move settles within a responsive budget');eq(r.cues.map(c=>c.name),['piece']);r.render();eq(r.cues.length,1,'landing sound cannot replay on heartbeat');r.view.dispose();
 const baseline=rig(game);baseline.click();baseline.def.onAction(baseline.state,baseline.ctx,'a',baseline.sent.at(-1));baseline.render();baseline.render('a',{audioBaseline:true});tick(baseline,2400);eq(baseline.cues,[],'reconnect suppresses a pending landing cue');baseline.view.dispose();
}
{
 const r=rig('checkers');let captured=false;
 for(let n=0;n<80&&r.state.phase==='play';n++){
  const pid=r.state.seats[r.state.turn],legal=r.def.view(r.state,pid).legal,[from,moves]=Object.entries(legal)[0],move=moves[0];
  r.def.onAction(r.state,r.ctx,pid,{from:Number(from),to:move.to,revision:r.state.revision});r.render();
  if(move.capture!==null){const before=r.cues.length;tick(r,200);eq(r.cues.length,before,'captured disc stays quiet before departure');const x=64+move.capture%8*96,y=64+Math.floor(move.capture/8)*96,opacity=Number(r.el.querySelector('.ck-art').innerHTML.match(new RegExp('translate\\('+x+' '+y+'\\)\" opacity=\"([^\"]+)'))[1]);ok(opacity>0&&opacity<1,'captured disc visibly fades during the jump');tick(r,300);eq(r.cues.at(-1).name,'capture','cue meets the disappearing disc');tick(r,400);eq(r.frames.size,0);eq(r.cues.length,before+1,'jump has one capture cue and no extra landing');captured=true;break}
  tick(r,400);
 }
 ok(captured,'natural legal opening sequence reached a real mandatory capture');r.view.dispose();
}
{
 const r=rig('kalah',{}, {portrait:true}),art=()=>r.el.querySelector('.kl-art');
 eq(art().getAttribute('viewBox'),'0 0 400 480','portrait recomposes the carved frame without scaling axes independently');
 const hits=r.el.querySelectorAll('.kl-hit');eq(hits.length,12,'compact portrait retains all twelve physical pit targets');
 for(const hit of hits){ok(Number(hit.getAttribute('height'))*304/400>=44,'320px portrait keeps a 44px pit height');ok(Number(hit.getAttribute('width'))*304/400>=44,'320px portrait keeps a 44px pit width');}
 const first=r.el.querySelector('[data-pit="0"]');first.focus();first.dispatch('keydown',{key:'ArrowDown'});eq(r.el.doc.activeElement.dataset.pit,'1','portrait arrows choose the next physical row after recomposition');
 const y0=Number(r.el.querySelector('[data-pit="0"] .kl-hit').getAttribute('y')),y1=Number(r.el.querySelector('[data-pit="1"] .kl-hit').getAttribute('y'));
 eq(y1-y0,58,'adjacent portrait hit rectangles meet without overlapping');
 r.el.querySelector('[data-flip]').dispatch('click');eq(Number(r.el.querySelector('[data-pit="0"] .kl-hit').getAttribute('y')),480-(y0+29)-29,'flip preserves the same portrait frame and pit identity');
 r.view.dispose();
}
{
 const r=rig('kalah'),readies=[];r.api.resultsReady=id=>readies.push({id,counts:r.el.querySelectorAll('.kl-bowl .kl-num').map(n=>Number(n.textContent))});
 r.state.pits=[0,0,1,0,0,0,20,4,0,1,0,0,0,22];r.render();r.def.onAction(r.state,r.ctx,'a',{pit:2,revision:0});r.render();
 eq(r.state.phase,'done','real capture and opposing sweep finish the round');eq(readies,[],'accepted final move begins with no early result presentation');
 tick(r,100);eq(readies,[],'one sow landing precedes both captures and the sweep');
 tick(r,540);eq(r.el.querySelector('[data-seat="0"] .bk-stat-value').textContent,'22','both captures have reached the correct store');eq(r.el.querySelector('[data-seat="1"] .bk-stat-value').textContent,'22','opposing sweep remains in flight');eq(readies,[],'capture alone cannot present the finished result');
 tick(r,760);eq(r.el.querySelector('[data-seat="1"] .bk-stat-value').textContent,'26','opposing sweep reaches its own store');eq(readies,[],'all transfers still retain the final 100ms presentation hold');
 tick(r,859);eq(readies,[],'the exact 860ms presentation has not settled one millisecond early');
 tick(r,860);eq(readies.length,1,'capture and sweep present once at actual 860ms settlement');eq(readies[0].counts,JSON.parse(JSON.stringify(r.state.pits)),'result readiness sees the fourteen final painted authoritative counts');
 r.render();eq(readies.length,1,'final heartbeat cannot repeat settlement');r.view.dispose();
}
{
 const r=rig('kalah');let captured=false;
 for(let n=0;n<100&&r.state.phase==='play';n++){
  const pid=r.state.seats[r.state.turn],view=r.def.view(r.state,pid);r.def.onAction(r.state,r.ctx,pid,{pit:view.legal[0],revision:r.state.revision});r.render();
  const move=r.state.lastMove,before=r.cues.length;tick(r,2400);eq(r.frames.size,0,'every legal sow/capture/sweep stays under 2.4 seconds');
  if(move.captures.length){eq(r.cues.slice(before).map(c=>c.name),['piece','capture'],'seed landing and capture transfers each cue once');captured=true;break}
 }
 ok(captured,'natural legal opening sequence reached a real Kalah capture');r.view.dispose();
}
async function assets(){for(const game of ['checkers','kalah']){const r=rig(game);r.setDecodeError(true);await r.view.ready();eq(r.decoded.length,0,'flat boards need no bitmap materials, so a broken image cannot block the host');ok(!r.el.innerHTML.includes('/assets/boards/materials/')&&!r.el.querySelector('.'+(game==='checkers'?'ck':'kl')+'-art').innerHTML.includes('<image'),'no textures are drawn');r.view.dispose()}console.log('CHECKERS_KALAH_VIEW_PASS: '+checks+' heartbeat/retry, prepared roles/turn announcements, same-instance replay disposal and critical material assertions')};assets().catch(e=>{console.error(e);process.exitCode=1});
}
module.exports={rig};
if(require.main===module)main();
