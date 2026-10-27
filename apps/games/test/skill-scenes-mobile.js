'use strict';
// User-triggered mobile promotion: real production handlers + legal engine
// positions. Production api.focus prevents scrolling; only opening the chooser
// may reveal it. Pixel layout remains in the browser matrix, not this fixture.
const nativeAssert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('./skill-scenes-hud-fixtures');
let assertions = 0;
const assert = new Proxy(nativeAssert, {
  apply(t, self, args) { assertions++; return Reflect.apply(t, self, args); },
  get(t, key) { const v=t[key]; return typeof v==='function' ? (...args) => { assertions++; return v(...args); } : v; },
});
const events = [], timers = new Set(), registry = new Map();
let timerId = 0;
const timeoutFns = new Map();
class Element {
  constructor(tag='div', attrs='') {
    this.tagName=tag.toUpperCase(); this.nodes=[]; this.listeners=new Map();
    this.dataset={}; this.attrs={}; this.style={}; this.hidden=false;
    for (const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      this.attrs[m[1]]=m[2];
      if (m[1]==='id') { this.id=m[2]; registry.set(this.id,this); }
      if (m[1].startsWith('data-')) this.dataset[m[1].slice(5)]=m[2];
    }
    for (const m of attrs.matchAll(/\bdata-([\w-]+)(?=\s|$)/g)) this.dataset[m[1]]='';
    this.classes=new Set((this.attrs.class||'').split(/\s+/));
    this.classList={contains:c=>this.classes.has(c),toggle:(c,on)=>{
      const enabled=on===undefined?!this.classes.has(c):!!on;
      enabled?this.classes.add(c):this.classes.delete(c);return enabled;
    }};
  }
  set innerHTML(html) {
    this.html=String(html); this.nodes=[];
    for (const m of this.html.matchAll(/<(button|div|details|summary|span)\b([^>]*)>/g)) {
      const n=new Element(m[1],m[2]); this.nodes.push(n);
    }
  }
  get innerHTML() { return this.html||''; }
  matches(sel) {
    if (sel[0]==='#') return this.id===sel.slice(1);
    if (sel[0]==='.') return this.classes.has(sel.slice(1));
    const a=sel.match(/^\[data-([^=\]]+)(?:="([^"]*)")?\]$/);
    return !!a && this.dataset[a[1]]!==undefined && (a[2]===undefined||this.dataset[a[1]]===a[2]);
  }
  querySelector(sel) { return this.nodes.find(n=>n.matches(sel))||null; }
  querySelectorAll(sel) { return this.nodes.filter(n=>n.matches(sel)); }
  addEventListener(type,fn) { this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]); }
  removeEventListener(type,fn) { this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn)); }
  click() { for (const fn of [...(this.listeners.get('click')||[])]) fn({target:this}); }
  scrollIntoView(opts) { events.push({type:'scroll',element:this,opts}); }
  focus(opts) { document.activeElement=this; events.push({type:'focus',element:this,opts}); }
  remove() { if (this.id) registry.delete(this.id); }
}
const document = {
  body:new Element('body'), activeElement:null,
  createElement:tag=>new Element(tag), getElementById:id=>registry.get(id)||null,
  head:{appendChild:n=>{if(n.id)registry.set(n.id,n)}},
};
const context=vm.createContext({document,console,Date,
  setInterval:()=>{const id=++timerId;timers.add(id);return id},clearInterval:id=>timers.delete(id),
  setTimeout:fn=>{const id=++timerId;timers.add(id);timeoutFns.set(id,fn);return id},
  clearTimeout:id=>{timers.delete(id);timeoutFns.delete(id)},
  esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
  nameOf:(S,pid)=>S.players?.find(p=>p.id===pid)?.name||'???',
});
vm.runInContext(fs.readFileSync(require.resolve('../public/js/util.js'),'utf8').split('export function esc')[0].replace(/^export /gm,''),context);
vm.runInContext(fs.readFileSync(require.resolve('../public/js/games/board-kit.js'),'utf8').replace(/^export /gm,''),context);
let source=fs.readFileSync(require.resolve('../public/js/games/chess.js'),'utf8');
source=source.replace(/^import[^;]+;\s*/gm,'').replace('export default','this.view =');
vm.runInContext(source,context);
const view=context.view;
const root=()=>registry.get('chess-root');
const click=selector=>{const b=root().querySelector(selector); assert(b,'missing '+selector); b.click(); return b};
function setup(promotion=false,pid='a') {
  events.length=0;
  const run=create('chess');
  if (promotion) run.s.chess.load('6k1/P7/8/8/8/8/8/6K1 w - - 0 1');
  const el=new Element('main'),sent=[];
  const api={now:()=>run.ctx.now(),send:a=>sent.push(a),announce(){},focus:n=>n.focus({preventScroll:true})};
  const state=()=>({...run.game.view(run.s,pid),players:run.ctx.roster,me:pid,you:pid,
    spectator:pid==='watcher',instanceId:'mobile-'+(++timerId),strings:{}});
  const S=state();
  view.mount(el,api); view.update(el,S,api);
  assert.equal(events.length,0,'fresh engine view does not auto-focus or scroll');
  return {run,el,sent,api,S};
}
for (const piece of ['q','r','b','n']) {
  const {run,el,sent,api,S}=setup(true);
  assert.equal(S.legal.a7.filter(m=>m.to==='a8').length,4,'engine exposes all legal promotions');
  click('#chsq-a7');
  assert(root().querySelector('#chsq-a7').classes.has('sel'),'tap selects pawn');
  assert.equal(events.filter(e=>e.type==='scroll').length,0,'selection preserves scroll');
  events.length=0;
  click('#chsq-a8');
  const picker=root().querySelector('.promo'),first=root().querySelector('[data-promo]');
  assert(picker,'promotion chooser opens after legal destination');
  assert.equal(root().querySelectorAll('[data-promo]').length,4,'four choices mounted');
  assert.equal(events.length,2,'one scroll and one focus on user-triggered chooser');
  assert.equal(events[0].type,'scroll'); assert.equal(events[0].element,picker);
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].opts)),{block:'nearest',inline:'nearest'});
  assert.equal(events[1].type,'focus'); assert.equal(events[1].element,first);
  assert.equal(events[1].opts.preventScroll,true,'fixture matches production focus policy');
  assert.equal(sent.length,0,'opening chooser sends no premature move');
  const n=events.length;
  view.update(el,{...S,qaSnapshot:1},api);
  assert(root().querySelector('[data-promo]'),'same-position snapshot retains chooser');
  assert.equal(events.length,n,'snapshot never repeats scrolling or autofocus');
  click('[data-promo="'+piece+'"]');
  assert.equal(sent.length,1,'promotion tap sends exactly one move');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].move)),{from:'a7',to:'a8',promotion:piece});
  run.game.onAction(run.s,run.ctx,'a',sent[0]);
  assert.equal(run.s.chess.get('a8').type,piece,'real engine acknowledges chosen promotion');
  view.update(el,{...S,...run.game.view(run.s,'a')},api);
  assert.equal(root().querySelector('[data-promo]'),null,'acknowledged promotion closes chooser');
  view.dispose(el); assert.equal(timers.size,0,'promotion view clock disposed');
}
{
  const {el,sent,S,api}=setup(true);
  click('#chsq-a7');click('#chsq-a8');events.length=0;
  click('[data-promo-x]');
  assert.equal(sent.length,0,'Cancel sends no move');
  assert.equal(root().querySelector('[data-promo]'),null,'Cancel closes chooser');
  assert.equal(events.filter(e=>e.type==='scroll').length,0,'Cancel preserves current scroll');
  view.update(el,{...S,qaSnapshot:2},api);
  assert.equal(root().querySelector('[data-promo]'),null,'snapshot does not reopen canceled chooser');
  view.dispose(el);
}
{
  const {el,sent}=setup(true,'watcher');
  click('#chsq-a7');click('#chsq-a8');
  assert.equal(sent.length,0,'watcher cannot promote');
  assert.equal(events.length,0,'watcher taps do not reveal or focus an action');
  assert.equal(root().querySelector('[data-promo]'),null);
  view.dispose(el);
}
{
  const {run,el,sent}=setup();
  click('#chsq-e2');click('#chsq-e4');
  assert.equal(sent.length,1,'ordinary legal tap move remains exact once');
  assert.equal(events.filter(e=>e.type==='scroll').length,0,'ordinary move does not scroll promotion UI');
  run.game.onAction(run.s,run.ctx,'a',sent[0]);
  assert.equal(run.s.chess.get('e4').type,'p','ordinary move acknowledged by real engine');
  view.dispose(el);
}
{
  const {run,el,api,S}=setup();const presented=[];api.resultsReady=id=>presented.push(id);
  const snapshot=()=>({...S,...run.game.view(run.s,'a')});
  const turn=(pid,from,to)=>{run.game.onAction(run.s,run.ctx,pid,{move:{from,to}});view.update(el,snapshot(),api)};
  turn('a','f2','f3');turn('b','e7','e5');turn('a','g2','g4');turn('b','d8','h4');
  assert.equal(run.s.phase,'done','live legal mate reaches authority result');
  assert.equal(presented.length,0,'mate readiness waits for final queen slide');
  assert(root().html.includes('ch-moving'),'confirmed final move has live motion');
  assert(root().html.includes('ch-result-tools" hidden'),'final result controls wait');
  view.update(el,snapshot(),api);assert.equal(timeoutFns.size,1,'same-position result tick keeps one settle timer');
  for(const [id,fn] of [...timeoutFns]){timeoutFns.delete(id);timers.delete(id);fn()}
  assert.deepEqual(presented,[S.instanceId],'settled exact instance announces once');
  view.update(el,snapshot(),api);assert.equal(presented.length,1,'done ticks never replay readiness');
  const terminal=snapshot();view.dispose(el);view.mount(el,api);view.update(el,terminal,api);
  assert.equal(presented.length,1,'done first mount reconnect does not replay');view.dispose(el);
}
assert.equal(timeoutFns.size,0,'all confirmed move timers cleaned up');
assert.equal(timers.size,0,'all clocks cleaned up');
console.log(`SKILL_MOBILE_PASS: ${assertions} assertions; legal tap selection, all four engine-acknowledged promotions, reveal/focus order, snapshot scroll stability, Cancel, watchers and ordinary moves`);
