'use strict';
/* Exercise the view's real mount/update/dispose without creating a GPU.
 * The platform mount and nested game wrapper are deliberately distinct:
 * placing the done class on main#gbody leaves the driving HUD visible.
 * Thumb controls: LEFT fixed analog stick (x = steer, UP = throttle, DOWN =
 * brake/reverse) plus a RIGHT cluster (Fire pk-tb, Drift pk-th, Gas pk-tg,
 * Brake pk-td). Intent merge policy under test:
 * - steer: keyboard left/right wins when held, else stick x float.
 * - throttle: brake/down (-1) > gas/up (+1) > stick -y > auto gas (+1) > 0. */
const nativeAssert = require('node:assert/strict');
let assertions = 0;
const assert = new Proxy(nativeAssert, {
  apply(t, self, args) { assertions++; return Reflect.apply(t, self, args); },
  get(t, key) { const v=t[key]; return typeof v === 'function' ? (...args) => { assertions++; return v(...args); } : v; },
});
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
const { intentFromKeys } = await import('../public/js/engines/kart-pose.mjs');
const { createMobileStick } = await import('../public/js/toolkit/mobile-stick.mjs');
const {createKartFeedback}=await import('../public/js/engines/kart-feedback.mjs');
const groundMarkers=await import('../public/js/engines/kart-ground-markers.mjs');
const {weaponThumbnailArt}=await import('../public/js/engines/kart-assets.mjs');
const {paintKartWeapon}=await import('../public/js/engines/kart-weapon-hud.mjs');
const {kartResultView}=await import('../public/js/engines/kart-results.mjs');
const {readInputCapabilities,touchControlsFor}=await import('../public/js/toolkit/input-capabilities.mjs');
let clock = 1000;
class Node {
  constructor() {
    this.nodes = new Map(); this.classes = new Set(); this.hidden = false;
    this.events = new Map();
    this.style = {}; this.style.setProperty = (k, v) => { this.style[k] = String(v); };
    this.dataset = {}; this.textContent = ''; this.innerHTML = '';
    this.rect = { left: 0, top: 0, width: 120, height: 120 };
    this.releaseCalls = 0;
    this.classList = {add: c => this.classes.add(c), remove: c => this.classes.delete(c),
      toggle: (c, yes) => yes ? this.classes.add(c) : this.classes.delete(c),
      contains: c => this.classes.has(c)};
  }
  get disabled() { return !!this.isDisabled; }
  set disabled(value) { this.isDisabled=!!value; }
  get firstElementChild() { return this.html?.startsWith('<') ? {} : null; }
  get innerHTML() { return this.html || ''; }
  set innerHTML(value) {
    this.html = String(value);
    this.text = this.html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<');
    this.htmlWrites = (this.htmlWrites || 0) + 1;
  }
  get textContent() { return this.text || ''; }
  set textContent(value) { this.text = String(value); this.html = this.text; }
  querySelector(s) { if (!this.nodes.has(s)) this.nodes.set(s, new Node()); return this.nodes.get(s); }
  querySelectorAll() { return []; }
  addEventListener(type, fn) { const list=this.events.get(type)||[]; list.push(fn); this.events.set(type,list); }
  removeEventListener(type, fn) { this.events.set(type,(this.events.get(type)||[]).filter(f=>f!==fn)); }
  fire(type, event={}) { if (!event.burst) clock += 40; for (const f of [...(this.events.get(type)||[])]) f(event); }
  setAttribute(name, value) { (this.attrs ||= new Map()).set(name, String(value)); }
  getAttribute(name) { return this.attrs?.get(name) ?? null; }
  removeAttribute(name) { this.attrs?.delete(name); }
  getBoundingClientRect() { return { ...this.rect }; }
  setPointerCapture(id) { (this.captures ||= new Set()).add(id); }
  hasPointerCapture(id) { return this.captures?.has(id) || false; }
  releasePointerCapture(id) { this.releaseCalls += 1; this.captures?.delete(id); this.fire('lostpointercapture', {pointerId:id}); }
  appendChild() {} remove() {}
}
const timers = new Set(), analogTimeouts = new Map(); let seq = 0;
const flushAnalog = () => { clock += 34; for (const [id, fn] of [...analogTimeouts]) { analogTimeouts.delete(id); fn(); } };
const document = Object.assign(new Node(), {querySelector: () => null, createElement: () => new Node(),
  head: new Node(), hidden: false});
const window = new Node();
window.matchMedia = () => ({matches:false}); window.devicePixelRatio=1;
window.screen = {orientation: new Node()};
const audios=[];
const context = vm.createContext({document, window, console, Date,
  performance: {now: () => clock},
  setTimeout: fn => { const id=++seq; analogTimeouts.set(id,fn); return id; },
  clearTimeout: id => analogTimeouts.delete(id),
  setInterval: fn => {const id = ++seq; timers.add(id); timers.fn = fn; return id;},
  clearInterval: id => timers.delete(id),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  esc: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  createThreeView: () => new Promise(() => {}),
  createKartAudio: () => {const audio={cues:[],active:true,muted:false,unlock(){},setMuted(value){this.muted=value},update(frame){this.active=frame.active},cue(name){if(this.active&&!this.muted)this.cues.push(name)},dispose(){}};audios.push(audio);return audio;},
  createPoseStore: () => ({}), resetPoseStore() {}, ingestSnapshot() {}, framePoses: () => new Map(),
  forwardOf: () => ({x:0,z:1}), canvasNoseRotation: () => 0,
  intentFromKeys, createMobileStick,readInputCapabilities,touchControlsFor,createKartFeedback,weaponThumbnailArt,paintKartWeapon,kartResultView});
let src = fs.readFileSync(require.resolve('../public/js/engines/kart-view.js'),'utf8');
src = src.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g,'')
  .replace('export function createKartView','function createKartView')
  .replace('return { ownsTimer: true,', 'return { prediction: intentForPrediction, ownsTimer: true,');
vm.runInContext(src+'\nthis.makeView = createKartView;',context);
const view = context.makeView({});
const main = new Node(), sent = [];
const spoken=[];
const api = {send: a => sent.push(a), announce:message=>spoken.push(message), now: () => 1000};
const state = phase => ({phase, you:'one', youDrive:true, endsAt:phase==='done'?0:31000,
  mode:'battle', palette:'Daybreak', targetHits:3, targetStars:8, map:{id:'ring',blocks:[]},
  players:[{id:'one',name:'A'}], karts:[{pid:'one',hits:1,ammo:1,weapon:'pulse',respawn:0}],
  result:phase==='done'?{winner:'one',winners:['one'],standings:[{pid:'one',score:1}],endReason:'timeout'}:null});
view.mount(main,api); view.update(main,state('drive'),api);
assert(!main.querySelector('.pk').classList.contains('pk-done'));
assert.equal(main.querySelector('#pk-touch').hidden,false);
assert.equal(main.querySelector('#pk-mine').textContent,'You · 1 KO');
assert.equal(main.querySelector('#pk-boost').querySelector('.kart-item-count').textContent,'×1');
assert(main.querySelector('#pk-boost').querySelector('.kart-item-art').innerHTML.includes('<svg'),'equip slot renders vector artwork');
assert.equal(main.querySelector('#pk-boost').getAttribute('aria-label'),'Machine gun, Ready, ×1','weapon name remains accessible while inventory shows the exact ammo');
assert.equal(main.querySelector('#pk-tb').disabled,false);
assert.equal(main.querySelector('#pk-tip').hidden,true,'normal driving shows no verbose paragraph');
assert.equal(main.querySelector('#pk-handling').textContent,'','ordinary driving does not need running commentary');
assert.equal(main.querySelector('#pk-handling').hidden,true,'quiet driving keeps the status line out of the playfield');
{
  for (const speed of [-0.01, -0.31, -0.9, -1]) {
    const coast=state('drive'); coast.karts[0].speed=speed; coast.map.label='Neon Yard'; view.update(main,coast,api);
    assert.equal(main.querySelector('#pk-handling').textContent,'','slow hillside coasting keeps the handling line quiet');
    assert.equal(main.querySelector('#pk-handling').hidden,true);
    assert.equal(main.querySelector('#pk-nitrolabel').textContent,'Nitro 100%','quiet coasting preserves the full charge label');
    assert.equal(main.querySelector('.pk-nitrometer').getAttribute('aria-valuenow'),'100');
  }
  const reverse=state('drive'); reverse.karts[0].speed=-2; view.update(main,reverse,api);
  assert.equal(main.querySelector('#pk-speed').textContent,'7');
  assert.equal(main.querySelector('#pk-handling').textContent,'Reversing');
  assert.equal(main.querySelector('#pk-handling').hidden,false,'a meaningful handling state remains visible');
  view.update(main,state('drive'),api);
}
{
  const slot = main.querySelector('#pk-boost');
  const writes = slot.htmlWrites;
  view.update(main,state('drive'),api);
  view.update(main,state('drive'),api);
  assert.equal(slot.htmlWrites,writes,'unchanged live HUD ticks retain the equipped SVG');
}
for (const [weapon,label] of [['pulse','Machine gun'],['scatter','Scatter gun'],['mine','Mine trail'],['shield','Invincibility'],['rocket','Rockets'],['rail','Railgun'],['grenade','Grenade'],['emp','EMP']]) {
  const w=state('drive'); w.karts[0].weapon=weapon; w.karts[0].ammo=2; w.karts[0].speed=10;
  view.update(main,w,api);
  const slot=main.querySelector('#pk-boost');
  assert(slot.querySelector('.kart-item-art').innerHTML.includes('<svg') && slot.querySelector('.kart-item-count').textContent==='×2',`${weapon} slot shows ammo beside its artwork`);
  assert.equal(slot.getAttribute('aria-label'),`${label}, Ready, ×2`,`${weapon} remains named for assistive readers`);
  const fire=main.querySelector('#pk-tb');
  assert(fire.innerHTML.includes('<svg') && fire.innerHTML.includes('pk-fire-ammo">2'),`${weapon} Fire carries its weapon silhouette and exact ammo`);
  const writes=fire.htmlWrites;
  view.update(main,w,api);
  assert.equal(fire.htmlWrites,writes,`${weapon} clock/snapshot paint does not overwrite the SVG`);
  w.karts[0].ammo=1;view.update(main,w,api);
  assert(fire.innerHTML.includes('pk-fire-ammo">1'),`${weapon} ammo paints after use without a text-only button`);
  assert.equal(main.querySelector('#pk-speed').textContent,'36','telemetry shows exact speed');
}
{
  for (const [weapon,label,detail] of [['pulse','Machine gun','Firing'],['mine','Mine trail','Deploying']]) {
    const busy=state('drive');Object.assign(busy.karts[0],{weapon,ammo:2,firing:true});view.update(main,busy,api);
    const slot=main.querySelector('#pk-boost');
    assert.equal(slot.dataset.state,'firing','committed payload retains the equipped item presentation');
    assert.equal(slot.getAttribute('aria-label'),`${label}, ${detail}, ×2`,'committed payload names the action and exact remaining rounds');
    assert.equal(main.querySelector('#pk-tb').disabled,true,'busy payload disables additional Fire presses');
  }
  view.update(main,state('drive'),api);
}
{
  const charged=state('drive');charged.karts[0].nitro=.35;
  const button=main.querySelector('#pk-tn'),writes=button.htmlWrites;
  view.update(main,charged,api);
  assert.equal(button.querySelector('.pk-nitro-arc').getAttribute('stroke-dashoffset'),'40.8','Nitro arc follows authoritative charge');
  assert.equal(button.htmlWrites,writes,'charge paint preserves the mounted bottle glyph');
  const empty=state('drive');empty.karts[0].weapon=null;empty.karts[0].ammo=0;view.update(main,empty,api);
  assert(main.querySelector('#pk-tb').innerHTML.includes('<svg'),'empty Fire uses a crosshair SVG');
  assert(main.querySelector('#pk-tb').innerHTML.includes('pk-fire-ammo" hidden'),'empty ammo badge hides');
  assert.equal(main.querySelector('#pk-boost').querySelector('strong').textContent,'No weapon','empty equip explains its inventory state');
  assert.equal(main.querySelector('#pk-boost').querySelector('.kart-item-count').textContent,'','empty equip has no phantom ammo');
  assert(!main.querySelector('#pk-tip').textContent.includes('pickup'),'empty equip does not add a persistent pickup paragraph');
  const named=state('drive');named.players[0].name='Alexandria Very Long Name';named.karts[0].hits=12;view.update(main,named,api);
  const lead=main.querySelector('#pk-lead');
  assert(lead.innerHTML.includes('pk-leadscore">12<small> KO'),'score owns a fixed span outside name truncation');
  assert(lead.getAttribute('aria-label').includes('Alexandria Very Long Name'),'full own name remains accessible');
  assert(!lead.innerHTML.includes('Alexandria'),'collapsed score console does not truncate or scatter player names');
  assert(main.querySelector('#pk-stand').innerHTML.includes('Alexandria Very Long Name'),'standings retain full player names');
  view.update(main,state('drive'),api);
}
{
  const arts=new Set();
  for (const weapon of ['pulse','scatter','mine','shield','rocket','rail','grenade','emp']) {
    const w=state('drive'); w.karts[0].weapon=weapon; w.karts[0].ammo=1;
    view.update(main,w,api);
    arts.add(main.querySelector('#pk-boost').querySelector('.kart-item-art').innerHTML.match(/<svg[\s\S]*?<\/svg>/)[0]);
  }
  assert.equal(arts.size,8,'each of the eight weapons has distinguishable artwork');
}
const keyEvent = code => ({code,repeat:false,target:{tagName:'BODY'},preventDefault(){}});
window.fire('keydown',keyEvent('ShiftLeft'));
assert.equal(sent.at(-1).input.drift,true,'Shift sends a held drift intent');
assert.equal(sent.at(-1).input.boost,false,'drift never fires the mode action');
window.fire('keyup',keyEvent('ShiftLeft'));
assert.equal(sent.at(-1).input.drift,false,'releasing Shift clears drift');
const drift=main.querySelector('#pk-th');
drift.fire('keydown',keyEvent('Enter'));
assert.equal(sent.at(-1).input.drift,true,'focused drift control works from the keyboard');
drift.fire('keyup',keyEvent('Enter'));
assert.equal(sent.at(-1).input.drift,false,'focused control releases cleanly');
// Discrete Space: fires once, auto-repeat never refires.
{
  const n = sent.length;
  window.fire('keydown',keyEvent('Space'));
  assert.equal(sent.at(-1).input.boost,true,'Space fires the action');
  window.fire('keydown',{...keyEvent('Space'),repeat:true});
  assert.equal(sent.length,n+1,'held Space does not repeat-fire');
  window.fire('keyup',keyEvent('Space'));
  assert.equal(sent.at(-1).input.boost,false,'Space release re-arms promptly');
  window.fire('keydown',keyEvent('Space'));
  assert.equal(sent.at(-1).input.boost,true,'fresh Space press works without waiting for keepalive');
  window.fire('keyup',keyEvent('Space'));
}
// Discrete contact and browser click are one action. Cancellation cannot
// poison a later keyboard/assistive activation; non-primary right fingers work.
const tb=main.querySelector('#pk-tb');
{
  timers.fn();
  const n = sent.length;
  tb.fire('pointerdown',{pointerId:50,pointerType:'touch',isPrimary:false,preventDefault(){}});
  assert.equal(sent.at(-1).input.boost,true,'non-primary right thumb fires alongside another contact');
  assert(tb.hasPointerCapture(50),'Fire owns capture');
  assert(tb.classList.contains('pk-held'),'Fire contact glows while held');
  tb.fire('pointerdown',{pointerId:51,pointerType:'touch',preventDefault(){}});
  tb.fire('click',{detail:1,pointerType:'touch'});
  window.fire('pointerup',{pointerId:51});
  assert.equal(sent.length,n+1,'second Fire finger, pointer-backed click and unrelated up do not re-fire');
  tb.fire('pointercancel',{pointerId:50});
  assert.equal(sent.at(-1).input.boost,false,'canceled Fire immediately re-arms the edge');
  assert(!tb.hasPointerCapture(50),'canceled Fire releases capture');
  tb.fire('click',{detail:0});
  assert.equal(sent.at(-1).input.boost,true,'keyboard/assistive click still fires after canceled contact');
  timers.fn();
  const keysBefore=sent.length;
  tb.fire('keydown',keyEvent('Enter'));
  tb.fire('keydown',{...keyEvent('Enter'),repeat:true});
  assert.equal(sent.length,keysBefore+1,'focused Enter fires once without repeat');
  tb.fire('keyup',keyEvent('Enter'));
  assert.equal(sent.at(-1).input.boost,false,'focused Enter release re-arms');
  tb.fire('pointerdown',{pointerId:52,pointerType:'touch',preventDefault(){}});
  tb.fire('pointerup',{pointerId:52});
  const released=sent.length;
  tb.fire('click',{detail:0,pointerType:'touch'});
  assert.equal(sent.length,released,'pointerType identifies a zero-detail pointer-backed click too');
  assert.equal(tb.getAttribute('aria-pressed'),'false');
}
const beforeFocus=sent.length;
window.fire('keydown',{...keyEvent('Space'),target:{tagName:'BUTTON'}});
assert.equal(sent.length,beforeFocus,'global Space never hijacks a room/call button');
window.fire('keydown',{...keyEvent('ArrowLeft'),target:{tagName:'INPUT'}});
assert.equal(sent.length,beforeFocus,'drive keys never hijack room forms');
{
  const event={...keyEvent('KeyW'),metaKey:true,preventDefault(){this.prevented=true;}};
  window.fire('keydown',event);
  assert.equal(sent.length,beforeFocus,'Command browser shortcut does not accelerate');
  assert.equal(event.prevented,undefined,'Command browser shortcut remains usable');
}
// Open room drawer owns the keyboard (atomic stop already fired on toggle).
{
  const query = document.querySelector;
  document.querySelector = s => (s === '.room-menu[open]' ? {} : null);
  window.fire('keydown',keyEvent('ArrowUp'));
  assert.equal(sent.length,beforeFocus,'drive keys ignored while the drawer is open');
  document.querySelector = query;
}
// Analog stick: center 60,60 radius 60 (120px pad). Deadzone .14 = 8.4px.
const touchEvent = (id,x=0,y=0) => ({pointerId:id,pointerType:'touch',clientX:x,clientY:y,preventDefault(){}});
const stick=main.querySelector('#pk-stick'), gas=main.querySelector('#pk-tg'), brake=main.querySelector('#pk-td');
// The connection can close while the last public snapshot still says drive.
// New outage input must not be held locally and replayed when sends resume.
{
  api.context=()=>({connected:false});
  document.fire('game-screenchange');
  const stopped=sent.length;
  window.fire('keydown',keyEvent('KeyW'));
  gas.fire('pointerdown',touchEvent(901));
  stick.fire('pointerdown',touchEvent(902,60,0));
  assert.equal(sent.length,stopped,'closed connection ignores fresh keyboard, button and stick input');
  api.context=()=>({connected:true});
  window.fire('keydown',{...keyEvent('KeyW'),repeat:true});
  clock+=600;timers.fn();
  assert.equal(sent.at(-1).input.throttle,0,'rejoining the same snapshot cannot replay outage input or continuing OS repeats');
  window.fire('keydown',keyEvent('KeyW'));
  assert.equal(sent.at(-1).input.throttle,1,'new deliberate input after reconnect drives normally');
  window.fire('keyup',keyEvent('KeyW'));
  delete api.context;
}
stick.fire('pointerdown',touchEvent(20,65,60));
assert.equal(sent.at(-1).input.steer,0,'stick deadzone reads zero steer');
assert.equal(sent.at(-1).input.throttle,0,'stick deadzone reads zero throttle');
stick.fire('pointerup',touchEvent(20,65,60));
stick.fire('pointerdown',touchEvent(21,90,60));
{
  const {steer,throttle} = sent.at(-1).input;
  assert.ok(steer>0.3&&steer<0.5,`partial analog steer keeps proportion (${steer})`);
  assert.equal(throttle,0,'pure sideways push sends no throttle');
}
// Second stick finger rejected without interfering; unrelated window contact ignored.
{
  const n = sent.length;
  stick.fire('pointerdown',touchEvent(22,30,60));
  window.fire('pointermove',touchEvent(99,0,0));
  window.fire('pointerup',touchEvent(99,0,0));
  assert.equal(sent.length,n,'secondary/unrelated fingers emit nothing');
  assert.ok(sent.at(-1).input.steer>0.3,'primary steer preserved');
}
// Independent right cluster while steering: gas + drift, then brake override.
gas.fire('pointerdown',touchEvent(10));
assert.equal(sent.at(-1).input.throttle,1,'gas thumb accelerates while the other steers');
assert.ok(sent.at(-1).input.steer>0.3,'steering survives simultaneous gas');
drift.fire('pointerdown',touchEvent(23));
assert.equal(sent.at(-1).input.drift,true,'drift holds alongside steer+gas');
brake.fire('pointerdown',touchEvent(24));
assert.equal(sent.at(-1).input.throttle,-1,'digital brake overrides gas and keeps reverse');
brake.fire('pointerup',touchEvent(24));
assert.equal(sent.at(-1).input.throttle,1,'releasing brake resumes held gas');
gas.fire('pointerup',touchEvent(10));
drift.fire('pointerup',touchEvent(23));
// Off-pad captured drag clamps to full; release springs to zero and sends it.
stick.fire('pointermove',touchEvent(21,400,60));
assert.equal(sent.at(-1).input.steer,1,'captured finger can drag outside the pad');
stick.fire('pointerup',touchEvent(21,400,60));
assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).input)),{steer:0,throttle:0,boost:false,drift:false,nitro:false},'stick release springs to zero');
assert.equal(stick.captures?.size||0,0,'stick capture released on up');
// Proportional UP = throttle, DOWN = brake/reverse, diagonal clamps to unit.
stick.fire('pointerdown',touchEvent(25,60,30));
{
  const {steer,throttle} = sent.at(-1).input;
  assert.equal(steer,0,'pure UP push sends no steer');
  assert.ok(throttle>0.3&&throttle<0.5,`partial UP throttle keeps proportion (${throttle})`);
}
stick.fire('pointermove',touchEvent(25,60,90));
assert.ok(sent.at(-1).input.throttle<-0.3,'DOWN push brakes/reverses');
stick.fire('pointermove',touchEvent(25,60+42.4,60-42.4));
{
  const {steer,throttle} = sent.at(-1).input;
  assert.ok(Math.abs(steer-0.707)<0.05&&Math.abs(throttle-0.707)<0.05,`diagonal stays proportional (${steer},${throttle})`);
}
stick.fire('pointerup',touchEvent(25,60,60));
// Window fallback when capture is unavailable.
{
  const keep = stick.setPointerCapture;
  stick.setPointerCapture = () => { throw new Error('no capture'); };
  stick.fire('pointerdown',touchEvent(26,60,30));
  assert.ok(sent.at(-1).input.throttle>0.3,'down without capture still drives');
  window.fire('pointermove',touchEvent(26,60,0));
  assert.equal(sent.at(-1).input.throttle,1,'window fallback tracks to the pad edge');
  window.fire('pointerup',touchEvent(26,60,0));
  assert.equal(sent.at(-1).input.throttle,0,'window fallback release springs to zero');
  stick.setPointerCapture = keep;
}
// Keyboard steering wins while held; stick resumes on release.
stick.fire('pointerdown',touchEvent(27,90,60));
window.fire('keydown',keyEvent('ArrowLeft'));
assert.equal(sent.at(-1).input.steer,-1,'keyboard left overrides stick right');
window.fire('keyup',keyEvent('ArrowLeft'));
assert.ok(sent.at(-1).input.steer>0.3,'stick resumes after keyboard release');
window.fire('pointercancel',touchEvent(27));
assert.equal(sent.at(-1).input.steer,0,'window cancellation releases the stick');
// Held gas survives focus change; lost capture cannot stick it.
gas.fire('pointerdown',touchEvent(28));
gas.fire('blur');
assert.equal(sent.at(-1).input.throttle,1,'focus changing does not cancel held fingers');
gas.fire('lostpointercapture',touchEvent(28));
assert.equal(sent.at(-1).input.throttle,0,'lost capture cannot leave gas stuck');
// Auto gas: opt-in, brake overrides and resumes, every global stop disables.
const automatic=main.querySelector('#pk-auto');
automatic.fire('click'); assert.equal(sent.at(-1).input.throttle,1,'auto gas is opt-in');
stick.fire('pointerdown',touchEvent(29,90,60)); drift.fire('pointerdown',touchEvent(30));
assert.equal(sent.at(-1).input.throttle,1,'auto gas leaves two thumbs free for stick/drift');
assert.equal(sent.at(-1).input.drift,true);
brake.fire('pointerdown',touchEvent(31));
assert.equal(sent.at(-1).input.throttle,-1,'brake overrides auto gas and allows reverse');
brake.fire('pointerup',touchEvent(31)); assert.equal(sent.at(-1).input.throttle,1);
document.hidden=true; document.fire('visibilitychange'); document.hidden=false;
assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).input)),{steer:0,throttle:0,boost:false,drift:false,nitro:false},'backgrounding stops every input and disables auto gas');
{
  const n = sent.length;
  stick.fire('pointerup',touchEvent(29)); drift.fire('pointerup',touchEvent(30));
  assert.equal(sent.length,n,'stale releases after a global stop send nothing');
}
automatic.fire('click'); window.fire('orientationchange'); assert.equal(sent.at(-1).input.throttle,0,'rotation stops auto gas');
automatic.fire('click'); document.fire('game-screenchange'); assert.equal(sent.at(-1).input.throttle,0,'screen change stops auto gas');
automatic.fire('click'); document.fire('toggle',{target:{matches:s=>s==='.room-menu',open:true}});
assert.equal(sent.at(-1).input.throttle,0,'opening room menu stops the kart');
automatic.fire('click'); window.fire('blur'); assert.equal(sent.at(-1).input.throttle,0,'leaving the window stops auto gas');
// Host stop is atomic across all contacts: helper reset/lost capture must
// never send an intermediate steer-zero while a right thumb still holds gas.
for (const stop of ['blur','hidden','orientation','modern-orientation','screen','drawer','help']) {
  view.update(main,state('drive'),api);
  automatic.fire('click');
  stick.fire('pointerdown',touchEvent(60,90,30));
  gas.fire('pointerdown',touchEvent(61));
  drift.fire('pointerdown',touchEvent(62));
  tb.fire('pointerdown',{...touchEvent(63),isPrimary:false});
  const n=sent.length;
  const released=[stick,gas,drift,tb].map(b=>b.releaseCalls);
  if (stop==='blur') window.fire('blur');
  if (stop==='hidden') { document.hidden=true; document.fire('visibilitychange'); document.hidden=false; }
  if (stop==='orientation') window.fire('orientationchange');
  if (stop==='modern-orientation') window.screen.orientation.fire('change');
  if (stop==='screen') document.fire('game-screenchange');
  if (stop==='help') {const h=main.querySelector('#pk-help');h.open=true;h.fire('toggle',{target:h});h.open=false;}
  if (stop==='drawer') document.fire('toggle',{target:{matches:s=>s==='.room-menu',open:true}});
  assert.equal(sent.length,n+1,`${stop}: exactly one packet for all held contacts`);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).input)),{steer:0,throttle:0,boost:false,drift:false,nitro:false},`${stop}: sole packet is neutral`);
  for (const [i,b] of [stick,gas,drift,tb].entries()) {
    assert.equal(b.captures.size,0,`${stop}: contact ${i} capture cleared`);
    assert.equal(b.releaseCalls,released[i]+1,`${stop}: contact ${i} capture released once`);
  }
  assert.equal(automatic.getAttribute('aria-pressed'),'false',`${stop}: Auto gas stops`);
  const settled=sent.length;
  for (const id of [60,61,62,63]) window.fire('pointerup',touchEvent(id));
  assert.equal(sent.length,settled,`${stop}: old contact releases are inert`);
}
{
  window.fire('keydown',keyEvent('KeyW'));
  document.fire('toggle',{target:{matches:s=>s==='.room-menu',open:true}});
  const stopped=sent.length;
  for(const code of ['KeyW','ArrowUp','Space']) {
    const event={...keyEvent(code),repeat:true,preventDefault(){this.prevented=true;}};
    window.fire('keydown',event);
    assert.equal(event.prevented,true,`${code}: cleared held-key repeat still prevents default on the playfield`);
  }
  assert.equal(sent.length,stopped,'continued OS repeats after closing Room never resume driving or fire');
  window.fire('keydown',keyEvent('KeyW'));
  assert.equal(sent.at(-1).input.throttle,1,'fresh press after Room resumes driving');
  window.fire('keyup',keyEvent('KeyW'));
}
// No new drive gesture or Auto gas starts behind Room or a modal.
for (const blocked of ['.room-menu[open]','#dlg-root .dlg']) {
  const query=document.querySelector;
  document.querySelector=s=>s===blocked?{}:null;
  const n=sent.length;
  stick.fire('pointerdown',touchEvent(64,90,30));
  gas.fire('pointerdown',touchEvent(65));
  tb.fire('pointerdown',touchEvent(66)); tb.fire('click',{detail:0});
  automatic.fire('click'); window.fire('keydown',keyEvent('ArrowUp'));
  assert.equal(sent.length,n,`${blocked}: controls ignore new contacts and keys`);
  assert(!stick.hasPointerCapture(64) && !gas.hasPointerCapture(65) && !tb.hasPointerCapture(66));
  document.querySelector=query;
}
// Missed mouseup outside browser chrome springs back on a buttons=0 move.
stick.fire('pointerdown',{...touchEvent(67,90,30),pointerType:'mouse',button:0,buttons:1});
window.fire('pointermove',{...touchEvent(67,200,30),pointerType:'mouse',buttons:0});
assert.equal(sent.at(-1).input.steer,0,'missed mouseup stops analog steering');
assert.equal(sent.at(-1).input.throttle,0,'missed mouseup stops analog gas');
// A high-refresh drag keeps immediate prediction but one bounded latest
// wire update. Neutral, Fire and global stops must cancel the pending timer.
{
  stick.fire('pointerdown',touchEvent(80,90,30));
  const first=sent.length;
  for (let i=0;i<100;i++) stick.fire('pointermove',{...touchEvent(80,75+i/100*30,35),burst:true});
  assert.equal(sent.length,first,'100 analog moves within one interval do not flood the wire');
  assert.equal(analogTimeouts.size,1,'burst retains one pending analog timeout');
  const prediction=view.prediction();
  assert(prediction.steer>sent.at(-1).input.steer,'prediction follows latest vector before the wire flush');
  flushAnalog();
  assert.equal(sent.length,first+1,'burst flush sends one latest vector');
  assert.equal(sent.at(-1).input.steer,prediction.steer,'flush uses the latest steer');
  assert.equal(sent.at(-1).input.throttle,prediction.throttle,'flush uses the latest throttle');
  assert.equal(analogTimeouts.size,0,'flush clears the pending timer');
  stick.fire('pointermove',{...touchEvent(80,90,30),burst:true});
  assert.equal(analogTimeouts.size,1);
  const release=sent.length;
  stick.fire('pointerup',{...touchEvent(80),burst:true});
  assert.equal(sent.length,release+1,'neutral release bypasses analog rate bound');
  assert.equal(sent.at(-1).input.steer,0); assert.equal(sent.at(-1).input.throttle,0);
  assert.equal(analogTimeouts.size,0,'release cancels deferred movement');
  flushAnalog(); assert.equal(sent.length,release+1,'no late movement after release');

  stick.fire('pointerdown',touchEvent(81,90,30));
  stick.fire('pointermove',{...touchEvent(81,100,30),burst:true});
  const fire=sent.length;
  tb.fire('pointerdown',{...touchEvent(82),isPrimary:false,burst:true});
  assert.equal(sent.length,fire+1,'Fire bypasses pending analog send immediately');
  assert.equal(sent.at(-1).input.boost,true);
  assert.equal(sent.at(-1).input.steer,view.prediction().steer,'Fire carries the latest analog vector');
  assert.equal(analogTimeouts.size,0,'Fire clears superseded analog timeout');
  tb.fire('pointerup',{...touchEvent(82),burst:true});
  stick.fire('pointermove',{...touchEvent(81,95,30),burst:true});
  const stop=sent.length;
  document.fire('game-screenchange',{burst:true});
  assert.equal(sent.length,stop+1,'global stop bypasses analog wait');
  assert.equal(sent.at(-1).input.throttle,0);
  assert.equal(analogTimeouts.size,0,'global stop cancels pending analog timeout');
  flushAnalog(); assert.equal(sent.length,stop+1,'no late movement after global stop');
}
// Keepalive re-sends held analog intent, and zeros after release.
stick.fire('pointerdown',touchEvent(32,90,60));
timers.fn();
assert.ok(sent.at(-1).input.steer>0.3,'500ms keepalive re-sends held analog steer');
stick.fire('pointerup',touchEvent(32,90,60));
timers.fn();
assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).input)),{steer:0,throttle:0,boost:false,drift:false,nitro:false},'keepalive sends zero after release');
// Watcher/done gates: no stick, button, or key action from outside the race.
{
  const driving = state('drive');
  stick.fire('pointerdown',touchEvent(90,90,30));
  gas.fire('pointerdown',touchEvent(91));
  view.update(main,{...driving,youDrive:false,you:'watcher'},api);
  assert(!stick.hasPointerCapture(90) && !gas.hasPointerCapture(91),'losing driver role releases live captures');
  const n = sent.length;
  stick.fire('pointerdown',touchEvent(33,90,60));
  gas.fire('pointerdown',touchEvent(34));
  tb.fire('pointerdown',{pointerId:35,pointerType:'touch',preventDefault(){}});
  window.fire('keydown',keyEvent('ArrowUp'));
  assert.equal(sent.length,n,'watchers cannot drive');
  stick.fire('pointerup',touchEvent(33)); gas.fire('pointerup',touchEvent(34));
  view.update(main,driving,api);
}
// A KO cancels every held source so a fresh life requires a fresh contact.
stick.fire('pointerdown',touchEvent(70,90,30)); gas.fire('pointerdown',touchEvent(71));
automatic.fire('click');
const koSends=sent.length;
const dead=state('drive'); dead.karts[0].respawn=1.8; dead.karts[0].ammo=0; dead.karts[0].weapon=null;
view.update(main,dead,api);
assert.equal(main.querySelector('#pk-respawn').textContent,'Back in 2…');
assert.equal(main.querySelector('#pk-respawn').hidden,false);
assert.equal(main.querySelector('#pk-tb').disabled,true,'KO disables item button');
assert.equal(main.querySelector('#pk-boost').getAttribute('aria-label'),'No weapon','KO cue is truthful for assistive readers');
assert.equal(main.querySelector('#pk-boost').dataset.state,'away','KO equip is not styled as armed');
{
  const n = sent.length;
  tb.fire('pointerdown',{pointerId:36,pointerType:'touch',preventDefault(){}});
  tb.fire('click');
  assert.equal(sent.length,n,'KO never fires the item');
}
assert.equal(sent.length,koSends+1,'KO sends one neutral intent for held drive');
assert(!stick.hasPointerCapture(70) && !gas.hasPointerCapture(71),'KO releases analog and digital capture');
const blockedKO=sent.length;
stick.fire('pointerdown',touchEvent(72,90,30)); gas.fire('pointerdown',touchEvent(73)); automatic.fire('click');
window.fire('keydown',keyEvent('ArrowUp'));
assert.equal(sent.length,blockedKO,'KO rejects new held inputs and Auto gas');
view.update(main,state('drive'),api); timers.fn();
assert.equal(sent.at(-1).input.throttle,0,'respawn never resumes old gas');
assert.equal(sent.at(-1).input.steer,0,'respawn never resumes old stick');
window.fire('keydown',{...keyEvent('ArrowUp'),repeat:true});
clock+=600;timers.fn();
assert.equal(sent.at(-1).input.throttle,0,'OS repeats from the old life cannot accelerate after respawn');
window.fire('keydown',keyEvent('ArrowUp'));
assert.equal(sent.at(-1).input.throttle,1,'new press after respawn accelerates');
window.fire('keyup',keyEvent('ArrowUp'));
const safe=state('drive'); safe.winRule='Time limit'; safe.karts[0].shield=2.5; safe.karts[0].weapon=null; safe.karts[0].ammo=0;
const emptyBeforeKO=state('drive'); emptyBeforeKO.karts[0].weapon=null; emptyBeforeKO.karts[0].ammo=0;
view.update(main,emptyBeforeKO,api);
assert.equal(main.querySelector('#pk-boost').getAttribute('aria-label'),'No weapon, Find a pickup');
view.update(main,dead,api);
assert.equal(main.querySelector('#pk-boost').getAttribute('aria-label'),'No weapon','an empty item changing to KO updates assistive status');
view.update(main,emptyBeforeKO,api);
assert.equal(main.querySelector('#pk-boost').getAttribute('aria-label'),'No weapon, Find a pickup','respawning from an empty item clears rejoin status');
view.update(main,safe,api);
assert.equal(main.querySelector('#pk-goal').textContent,'Most KOs wins');
assert.equal(main.querySelector('#pk-boost').querySelector('.kart-item-count').textContent,'3s');
assert.equal(main.querySelector('#pk-boost').getAttribute('aria-label'),'Spawn protection, Active, 3s');
assert(main.querySelector('#pk-boost').querySelector('.kart-item-art').innerHTML.includes('<svg'),'shield state keeps vector artwork');
assert.equal(main.querySelector('#pk-respawn').hidden,true);
const mine=state('drive'); mine.karts[0].weapon='mine'; view.update(main,mine,api);
assert.equal(main.querySelector('#pk-tb').getAttribute('aria-label'),'Activate Mine, full payload');
assert(main.querySelector('#pk-tb').innerHTML.includes('<svg'),'Mine button preserves its SVG instead of a text label');
const raceHud=state('drive'); raceHud.mode='race'; raceHud.karts[0].stars=2; raceHud.karts[0].boostCd=2.8;
view.update(main,raceHud,api);
assert.equal(main.querySelector('#pk-boost').hidden,true,'race hides the battle-only weapon inventory');
assert.equal(main.querySelector('#pk-tb').getAttribute('aria-label'),'Boost','race action retains its accessible identity');
assert(main.querySelector('#pk-tb').innerHTML.includes('<svg'),'race action keeps its authored boost glyph');
raceHud.karts[0].boostCd=0; view.update(main,raceHud,api);
assert.equal(main.querySelector('#pk-boost').hidden,true,'race readiness keeps battle inventory hidden');
assert.equal(main.querySelector('#pk-tb').disabled,false,'live race keeps the mode action available');
view.update(main,mine,api);
stick.fire('pointerdown',touchEvent(92,90,30)); gas.fire('pointerdown',touchEvent(93));
drift.fire('pointerdown',touchEvent(94)); tb.fire('pointerdown',touchEvent(95));
automatic.fire('click');
const endedInputs=sent.length;
view.update(main,state('done'),api);
assert.equal(sent.length,endedInputs,'done snapshot clears locally without sending rejected late drive intents');
for (const [b,id] of [[stick,92],[gas,93],[drift,94],[tb,95]]) assert(!b.hasPointerCapture(id),'done releases every native capture');
assert.equal(automatic.getAttribute('aria-pressed'),'false','done clears Auto gas');
assert(main.querySelector('.pk').classList.contains('pk-done'), 'CSS-owning game wrapper hides the driving HUD');
assert(!main.classList.contains('pk-done'), 'done class never leaks onto the platform mount');
assert.equal(main.querySelector('#pk-touch').hidden,true);
assert.equal(main.querySelector('#pk-result').hidden,false);
{
  const n = sent.length;
  stick.fire('pointerdown',touchEvent(37,90,60));
  stick.fire('pointerup',touchEvent(37,90,60));
  assert.equal(sent.length,n,'done phase ignores the stick');
}
const sendsAtDone = sent.length;
view.update(main,state('done'),api);
assert.equal(sent.length,sendsAtDone,'repeat results send no drive input');
const garage=state('done');garage.coins=35;garage.garage=true;
garage.upgrades={one:{engine:0,handling:0,reload:0}};
garage.garagePrices={cats:['engine','handling','reload'],max:3,prices:[20,35,55]};
view.update(main,garage,api);
const result=main.querySelector('#pk-result');
assert(result.innerHTML.includes('Your garage') && result.innerHTML.includes('35 coins'));
const buy={disabled:false,getAttribute:()=> 'engine'};
result.fire('click',{target:{closest:()=>buy}});
assert.equal(sent.at(-1).garage.category,'engine');
assert.equal(buy.disabled,true,'purchase disables immediately');
const request=sent.at(-1).garage,afterBuy=sent.length;
result.fire('click',{target:{closest:()=>({...buy,disabled:false})}});
assert.equal(sent.length,afterBuy,'pending purchase cannot double-send');
garage.coins=15;garage.upgrades.one.engine=1;garage.garageResult={...request,ok:true,level:1};
view.update(main,garage,api);
assert(result.innerHTML.includes('Engine upgraded to level 1!'));
const watcher={...garage,you:'watcher',youDrive:false};view.update(main,watcher,api);
assert(!result.innerHTML.includes('Your garage'),'watcher never gets purchase controls');
const beforeWatch=sent.length;result.fire('click',{target:{closest:()=>({...buy,disabled:false})}});
assert.equal(sent.length,beforeWatch);
view.update(main,state('countdown'),api);
assert(!main.querySelector('.pk').classList.contains('pk-done'),'rematch restores the HUD');
assert.equal(main.querySelector('#pk-touch').hidden,false);
assert.equal(main.querySelector('#pk-result').hidden,true);
{
  // Rematch carries no stale held state: a fresh push drives from zero.
  stick.fire('pointerdown',touchEvent(38,90,60));
  assert.ok(sent.at(-1).input.steer>0.3,'rematch stick drives');
  stick.fire('pointerup',touchEvent(38,90,60));
  assert.equal(sent.at(-1).input.steer,0,'rematch release returns to zero');
}
// Nitro (N / NITRO): independent hold alongside stick+fire+drift, exact-once
// releases, global-stop cleanup, watcher/done/KO gating, focus safeguards.
const nitro=main.querySelector('#pk-tn');
{
  view.update(main,state('drive'),api);
  window.fire('keydown',keyEvent('KeyN'));
  assert.equal(sent.at(-1).input.nitro,true,'N sends a held nitro intent');
  assert.equal(sent.at(-1).input.boost,false,'nitro never fires the mode action');
  assert.equal(sent.at(-1).input.drift,false,'nitro never arms drift');
  window.fire('keydown',keyEvent('Space'));
  assert.equal(sent.at(-1).input.boost,true,'Space fires while N held');
  assert.equal(sent.at(-1).input.nitro,true,'N survives a simultaneous Space edge');
  window.fire('keyup',keyEvent('Space'));
  window.fire('keyup',keyEvent('KeyN'));
  assert.equal(sent.at(-1).input.nitro,false,'releasing N clears nitro');
  // Button hold alongside stick+gas+drift+fire, then independent releases.
  stick.fire('pointerdown',touchEvent(100,90,60));
  gas.fire('pointerdown',touchEvent(101));
  drift.fire('pointerdown',touchEvent(102));
  nitro.fire('pointerdown',touchEvent(103));
  assert.equal(sent.at(-1).input.nitro,true,'NITRO thumb holds alongside stick+gas+drift');
  assert.ok(sent.at(-1).input.steer>0.3,'steering survives simultaneous nitro');
  assert.equal(sent.at(-1).input.throttle,1,'gas survives simultaneous nitro');
  assert.equal(sent.at(-1).input.drift,true,'drift survives simultaneous nitro');
  tb.fire('pointerdown',{pointerId:104,pointerType:'touch',isPrimary:false,preventDefault(){}});
  assert.equal(sent.at(-1).input.boost,true,'Fire works with nitro held');
  assert.equal(sent.at(-1).input.nitro,true,'nitro held through the Fire edge');
  tb.fire('pointerup',{pointerId:104});
  nitro.fire('pointerup',touchEvent(103));
  assert.equal(sent.at(-1).input.nitro,false,'releasing NITRO clears only nitro');
  assert.equal(sent.at(-1).input.drift,true,'drift survives a nitro release');
  assert.equal(sent.at(-1).input.throttle,1,'gas survives a nitro release');
  drift.fire('pointerup',touchEvent(102));
  gas.fire('pointerup',touchEvent(101));
  stick.fire('pointerup',touchEvent(100,90,60));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).input)),{steer:0,throttle:0,boost:false,drift:false,nitro:false},'all-contact release returns to neutral');
  // Global stop clears a held N with exactly one neutral packet.
  nitro.fire('pointerdown',touchEvent(105));
  window.fire('keydown',keyEvent('KeyN'));
  const n=sent.length;
  window.fire('blur');
  assert.equal(sent.length,n+1,'blur clears held nitro exactly once');
  assert.equal(sent.at(-1).input.nitro,false,'blur packet carries nitro false');
  assert.equal(nitro.captures?.size||0,0,'blur releases nitro capture');
  const settled=sent.length;
  nitro.fire('pointerup',touchEvent(105));
  assert.equal(sent.length,settled,'stale nitro release after a stop sends nothing');
  // Focus and dialog safeguards: N never drives from forms or modals.
  const beforeFocus=sent.length;
  window.fire('keydown',{...keyEvent('KeyN'),target:{tagName:'INPUT'}});
  assert.equal(sent.length,beforeFocus,'N never hijacks room forms');
  const query=document.querySelector;
  document.querySelector=s=>s==='#dlg-root .dlg'?{}:null;
  window.fire('keydown',keyEvent('KeyN'));
  assert.equal(sent.length,beforeFocus,'N ignored while a dialog is open');
  document.querySelector=query;
  // Watcher/done/KO gating.
  const driving=state('drive');
  nitro.fire('pointerdown',touchEvent(106));
  view.update(main,{...driving,youDrive:false,you:'watcher'},api);
  assert(!nitro.hasPointerCapture(106),'losing driver role releases nitro capture');
  const w=sent.length;
  nitro.fire('pointerdown',touchEvent(107));
  window.fire('keydown',keyEvent('KeyN'));
  assert.equal(sent.length,w,'watchers cannot hold nitro');
  nitro.fire('pointerup',touchEvent(107));
  view.update(main,driving,api);
  const dead=state('drive'); dead.karts[0].respawn=1.8; dead.karts[0].ammo=0; dead.karts[0].weapon=null;
  view.update(main,dead,api);
  assert.equal(main.querySelector('#pk-tn').disabled,true,'KO disables the nitro button');
  const k=sent.length;
  nitro.fire('pointerdown',touchEvent(108));
  assert.equal(sent.length,k,'KO rejects new nitro holds');
  nitro.fire('pointerup',touchEvent(108));
  view.update(main,driving,api);
  view.update(main,state('done'),api);
  assert.equal(main.querySelector('#pk-tn').disabled,true,'done disables nitro');
  view.update(main,driving,api);
}
// Shoot tutorial once: first pickup teaches Space, later pickups stay short.
{
  const audio=audios.at(-1),start=audio.cues.length,base=state('drive');
  view.update(main,{...base,audioBaseline:true,karts:[{...base.karts[0],boost:1}],events:[{id:'missed-baseline',type:'pickup',pid:'one',weapon:'pulse'}]},api);
  assert.equal(audio.cues.length,start,'legacy reconnect seeds historical pickup and ongoing boost quietly');
  assert.ok(!main.querySelector('.pk-hud').innerHTML.includes('id="pk-cue"'),'legacy reconnect never recreates center pickup instructions');
  view.update(main,{...base,events:[{id:'missed-baseline',type:'pickup',pid:'one',weapon:'pulse'},{id:'fresh-baseline',type:'fire',pid:'one',weapon:'pulse'}]},api);
  assert.equal(audio.cues.length,start+1,'legacy fresh event resumes once after reconnect');
  const context=api.context;api.context=()=>({sound:false});
  view.update(main,{...base,events:[{id:'muted-live',type:'fire',pid:'one',weapon:'pulse'}]},api);
  assert.equal(audio.cues.length,start+1,'legacy mute is synchronized before snapshot events');
  api.context=()=>({sound:true,connected:false});view.update(main,{...base,events:[{id:'offline-live',type:'fire',pid:'one',weapon:'pulse'}]},api);
  assert.equal(audio.cues.length,start+1,'legacy closed connection drops live event audio');
  api.context=context;view.update(main,{...base,audioBaseline:true,events:[]},api);
}
{
  const picker=main.querySelector('#pk-controls');picker.value='keyboard';picker.fire('change');
  const base=state('drive');
  view.update(main,{...base,events:[]},api);
  view.update(main,{...base,events:[{id:'e900',type:'pickup',pid:'one',weapon:'pulse'}]},api);
  assert.ok(!main.querySelector('#pk-boost').querySelector('kbd').hidden,'First keyboard pickup gets a small equipped-slot keycap');
  assert.equal(spoken.at(-1),'Pulse ready','Pickup remains concise and accessible');
  clock+=4100;view.update(main,{...base,events:[]},api);
  assert.ok(!!main.querySelector('#pk-boost').querySelector('kbd').hidden,'The edge keycap expires');
  view.update(main,{...base,events:[{id:'e901',type:'pickup',pid:'one',weapon:'scatter'}]},api);
  assert.equal(spoken.at(-1),'Scatter ready','Later pickups retain accessible weapon identity');
  assert.ok(!!main.querySelector('#pk-boost').querySelector('kbd').hidden,'The tutorial does not repeat on later pickups');
  assert.ok(!main.querySelector('.pk-hud').innerHTML.includes('id="pk-cue"'),'Pickup cues do not occupy the center playfield');
  view.update(main,state('drive'),api);
}
// Results next-arena chooser: preview for all, host-only configure, no
// active-map mutation, graceful without configure.
{
  const done=state('done');
  view.update(main,done,api);
  const html=main.querySelector('#pk-result').innerHTML;
  assert.ok(html.includes('Next arena'),'results carries a game-owned next-arena chooser');
  for (const label of ['Rookie Ring','Bumper Blocks','Garden Circuit','Frosty Pass','Neon Yard']) {
    assert.ok(html.includes(label),`chooser previews ${label}`);
  }
  for (const id of ['ring','blocks','garden','frost','neon']) {
    assert.ok(html.includes(`src="/assets/karts/previews/legacy-${id}.webp"`),`results shows the actual classic ${id} map overview`);
  }
  assert.ok(!html.includes('pk-swatch'),'results does not substitute colour swatches for map previews');
  const calls=[], notices=[]; let savedMap='Garden Circuit';
  const hostApi={...api,context:()=>({isHost:true,settings:{map:savedMap}}),configure:(s)=>{calls.push(s);return true;},announce:text=>notices.push(text)};
  view.update(main,done,hostApi);
  const res=main.querySelector('#pk-result');
  const btn={disabled:false,getAttribute:()=>'frost',closest:()=>'x'};
  res.fire('click',{target:{closest:(s)=>s==='[data-arena]'?btn:null}});
  assert.equal(calls.length,1,'host arena pick calls configure once');
  assert.equal(calls[0].map,'Frosty Pass','configure carries the label for the next rematch');
  assert.ok(res.innerHTML.includes('Saving Frosty Pass'),'queued configuration stays visibly pending');
  assert.ok(!notices.some(t=>t.includes('Next arena: Frosty')),'queued request is not called saved');
  res.fire('click',{target:{closest:(s)=>s==='[data-arena]'?btn:null}});
  assert.equal(calls.length,1,'pending map request cannot enqueue duplicates');
  savedMap='Frosty Pass'; view.update(main,done,hostApi);
  assert.ok(res.innerHTML.includes('Next: Frosty Pass'),'validated settings acknowledge next arena');
  assert.equal(notices.filter(t=>t.includes('Next arena: Frosty')).length,1,'save acknowledgement announced once');
  view.update(main,done,hostApi);
  assert.equal(notices.filter(t=>t.includes('Next arena: Frosty')).length,1,'repeated snapshots do not repeat acknowledgement');
  const neon={...btn,getAttribute:()=>'neon'};
  res.fire('click',{target:{closest:(s)=>s==='[data-arena]'?neon:null}});
  clock+=5001;view.update(main,done,hostApi);
  assert.ok(res.innerHTML.includes('Arena was not saved'),'missing acknowledgement times out with retry feedback');
  assert.ok(!notices.some(t=>t.includes('Next arena: Neon')),'timeout never pretends saved');
  const before=calls.length;
  const watchApi={...api,context:()=>({isHost:false,settings:{}}),configure:(s)=>{calls.push(s);return true;},announce(){}};
  view.update(main,done,watchApi);
  res.fire('click',{target:{closest:(s)=>s==='[data-arena]'?{...btn,disabled:false}:null}});
  assert.equal(calls.length,before,'spectators never configure');
  const noCfg={...api,context:()=>({isHost:true,settings:{}}),announce(){}};
  view.update(main,done,noCfg);
  res.fire('click',{target:{closest:(s)=>s==='[data-arena]'?{...btn,disabled:false}:null}});
  assert.equal(calls.length,before,'missing configure changes nothing');
  view.update(main,state('drive'),api);
}
// Width is layout only. Fine/hover touch laptops stay on keyboard in
// Auto; explicit preference wins and keyboard remains alive in every mode.
{
 const pk=main.querySelector('.pk'),picker=main.querySelector('#pk-controls');
 const media=new Node();let kind='hybrid';window.navigator={maxTouchPoints:10};
 window.matchMedia=q=>({matches:kind==='phone'?(q==='(pointer: coarse)'||q==='(any-pointer: coarse)'):(q==='(pointer: fine)'||q==='(hover: hover)'||q==='(any-pointer: coarse)'),addEventListener:media.addEventListener.bind(media),removeEventListener:media.removeEventListener.bind(media)});
 for(const width of [568,844]){window.innerWidth=width;document.fire('game-screenchange');assert.equal(pk.classList.contains('pk-touch-enabled'),false,'small hybrid laptop Auto remains keyboard');
  window.fire('keydown',{code:'ArrowUp',target:{tagName:'DIV'},preventDefault(){}});assert.equal(sent.at(-1).input.throttle,1,'small laptop keyboard accelerates');
  window.fire('keyup',{code:'ArrowUp',target:{tagName:'DIV'},preventDefault(){}});assert.equal(sent.at(-1).input.throttle,0,'small laptop keyboard release neutralizes');}
 kind='phone';document.fire('game-screenchange');assert.equal(pk.classList.contains('pk-touch-enabled'),true,'coarse no-hover phone Auto offers thumb controls');
 picker.fire('change',{target:{value:'keyboard'}});assert.equal(pk.classList.contains('pk-touch-enabled'),false,'explicit Keyboard suppresses thumb overlay');document.fire('game-screenchange');assert.equal(pk.classList.contains('pk-touch-enabled'),false,'screen change cannot override Keyboard');
 kind='hybrid';picker.fire('change',{target:{value:'touch'}});assert.equal(pk.classList.contains('pk-touch-enabled'),true,'explicit Touch works on fine/hover hybrid');
 window.fire('keydown',{code:'ArrowUp',target:{tagName:'DIV'},preventDefault(){}});assert.equal(sent.at(-1).input.throttle,1,'Touch preference keeps keyboard usable');window.fire('keyup',{code:'ArrowUp',target:{tagName:'DIV'},preventDefault(){}});
 picker.fire('change',{target:{value:'auto'}});assert.equal(pk.classList.contains('pk-touch-enabled'),false,'Auto returns to primary input preference');
}
// Preparation/pending transport rejects sends, so the local view must also
// reject fresh holds instead of silently reviving them once that gate clears.
{
  const originalContext=api.context;
  view.update(main,{...state('drive'),preparing:true},api);const held=sent.length;
  window.fire('keydown',keyEvent('KeyW'));window.fire('keydown',keyEvent('Space'));
  gas.fire('pointerdown',touchEvent(100));
  assert.equal(sent.length,held,'preparing state rejects fresh keyboard/fire/touch intent locally');
  view.update(main,state('drive'),api);timers.fn();
  assert.equal(sent.at(-1).input.throttle,0,'ready release cannot revive a key pressed during preparation');
  assert.equal(sent.at(-1).input.boost,false,'ready release cannot revive a Space edge pressed during preparation');
  api.context=()=>({preparing:true});const blocked=sent.length;
  window.fire('keydown',keyEvent('KeyW'));
  assert.equal(sent.length,blocked,'context preparation also guards before a new snapshot arrives');
  api.context=()=>({roomActionPending:true});document.fire('game-screenchange');const pending=sent.length;
  window.fire('keydown',keyEvent('KeyW'));gas.fire('pointerdown',touchEvent(101));
  assert.equal(sent.length,pending,'pending Room transition rejects new keyboard/touch holds locally');
  api.context=originalContext;timers.fn();
  assert.equal(sent.at(-1).input.throttle,0,'acknowledgement cannot revive input pressed while the Room transition was pending');
  window.fire('keydown',keyEvent('KeyW'));assert.equal(sent.at(-1).input.throttle,1,'a fresh deliberate key resumes after readiness and Room gates clear');
  window.fire('keyup',keyEvent('KeyW'));
}
// Dispose tells the server zero while active, then removes everything.
stick.fire('pointerdown',touchEvent(39,90,60)); gas.fire('pointerdown',touchEvent(41));
assert.ok(sent.at(-1).input.steer>0.3,'pre-dispose drive active');
stick.fire('pointermove',{...touchEvent(39,100,30),burst:true});
assert.equal(analogTimeouts.size,1,'dispose begins with analog timeout pending');
const disposalSends=sent.length;
view.dispose();
assert.equal(sent.length,disposalSends+1,'dispose sends exactly one final neutral packet');
assert.equal(analogTimeouts.size,0,'dispose clears the pending analog timeout');
flushAnalog(); assert.equal(sent.length,disposalSends+1,'disposed timeout never sends movement');
assert(!stick.hasPointerCapture(39) && !gas.hasPointerCapture(41),'dispose releases both actual captures');
assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).input)),{steer:0,throttle:0,boost:false,drift:false,nitro:false},'dispose sends a final zero while active');
const onceDisposed=sent.length; view.dispose(); assert.equal(sent.length,onceDisposed,'second dispose is silent'); assert.equal(timers.size,0,'disposal clears keepalive');
{
  const n = sent.length;
  stick.fire('pointerdown',touchEvent(40,90,60));
  window.fire('keydown',keyEvent('ArrowUp'));
  window.fire('blur');
  assert.equal(sent.length,n,'no callbacks after dispose');
  for (const [t,fns] of window.events) assert.equal(fns.length,0,`window listener removed: ${t}`);
  for (const [t,fns] of document.events) {
    if (t === 'toggle') continue; // stub-owned? no: view must remove it too
    assert.equal(fns.length,0,`document listener removed: ${t}`);
  }
  assert.equal((document.events.get('toggle')||[]).length,0,'document toggle listener removed');
}
for (const [t,fns] of window.screen.orientation.events) assert.equal(fns.length,0,`modern orientation listener removed: ${t}`);
// Build and frame the shipped compatibility renderer with the real GLB art.
// The GPU is deliberately absent: record the resources a renderer would first
// encounter, so a new shader/geometry cannot hide behind a tiny CPU clone cost.
// Pulse holds are born from an actual press, not an inventory snapshot.
{
  const s=state('drive');s.instanceId='pulse-hold';
  Object.assign(s.karts[0],{weapon:'pulse',ammo:12,spawnSeq:3,controlEpoch:7});
  view.update(main,s,api);
  window.fire('keydown',keyEvent('Space'));
  clock+=200;timers.fn();assert.equal(sent.at(-1).input.boost,true,'Pulse keyboard hold survives the initial consumed edge');
  window.fire('keyup',keyEvent('Space'));assert.equal(sent.at(-1).input.boost,false,'Pulse key release sends neutral immediately');
  const fire=main.querySelector('#pk-tb');
  fire.fire('pointerdown',{...touchEvent(121),isPrimary:false});
  fire.fire('keydown',keyEvent('Enter'));
  fire.fire('pointerup',touchEvent(121));clock+=200;timers.fn();
  assert.equal(sent.at(-1).input.boost,true,'A remaining owned keyboard contact retains Pulse hold');
  fire.fire('keyup',keyEvent('Enter'));assert.equal(sent.at(-1).input.boost,false,'Last contact releases Pulse hold');
  s.karts[0].weapon='rocket';view.update(main,s,api);
  window.fire('keydown',keyEvent('Space'));clock+=200;timers.fn();
  assert.equal(sent.at(-1).input.boost,false,'Rocket remains a discrete edge');
  s.karts[0].weapon='pulse';view.update(main,s,api);clock+=200;timers.fn();
  assert.equal(sent.at(-1).input.boost,false,'Held non-Pulse never fires a newly acquired Pulse');
  window.fire('keyup',keyEvent('Space'));window.fire('keydown',keyEvent('Space'));
  s.karts[0].spawnSeq++;view.update(main,s,api);clock+=200;timers.fn();
  assert.equal(sent.at(-1).input.boost,false,'New life cannot inherit Pulse hold');
  window.fire('keyup',keyEvent('Space'));window.fire('keydown',keyEvent('Space'));
  window.fire('blur');clock+=200;timers.fn();
  assert.equal(sent.at(-1).input.boost,false,'Blur cancels Pulse hold before keepalive');
  view.update(main,state('drive'),api);
}
{
  globalThis.self=globalThis;
  globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};};
  const THREE=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const {MeshoptDecoder}=await import('../public/vendor/three/libs/meshopt_decoder.mjs');await MeshoptDecoder.ready;
  const {createKartImpactFX}=await import('../public/js/engines/kart-impact-fx.mjs');
  const {createKartHealthBars}=await import('../public/js/engines/kart-health-bars.mjs');
  const models=await import('../public/js/engines/kart-model.mjs'),{createKartCombatArt}=await import('../public/js/engines/kart-combat-art.mjs'),flight=await import('../public/js/engines/kart-flight.mjs');
  const assets={};
  for(const [key,file]of [['kart','giggle-kart.meshopt'],['star','giggle-star'],['crate','giggle-crate.meshopt'],['combat','combat/combat.meshopt']]){
    const b=fs.readFileSync(require.resolve('../public/assets/karts/'+file+'.glb'));assets[key]=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
  }
  let build;const geometries=new Set(),materials=new Set();let compiles=0,warmFrames=0;
  const encounter=root=>{if(!root.visible)return;if(root.isMesh||root.isLine){if(root.geometry)geometries.add(root.geometry);for(const m of Array.isArray(root.material)?root.material:[root.material])if(m)materials.add(m);}for(const child of root.children)encounter(child);};
  const renderer={async compileAsync(scene){compiles++;encounter(scene);},render(scene){warmFrames++;encounter(scene);}};
  Object.assign(context,models,flight,groundMarkers,{createKartCombatArt,createKartHealthBars,createKartImpactFX,loadKartAssets:async(T,scene)=>{const library=new T.Group();library.visible=false;scene.add(library);for(const asset of Object.values(assets))library.add(asset);return assets;},
    createKartWorld:T=>({group:new T.Group(),palette:{horizon:0xd8f3ff},syncMap(){}}),createKartLighting:()=>()=>{},
    createThreeView:(el,hooks)=>{build=hooks.build;return new Promise(()=>{});}});
  const live=context.makeView({}),el=new Node(),s={...state('drive'),simAt:clock,events:[],zaps:[],grenades:[],mines:[],crates:[],stars:[]};
  Object.assign(s.karts[0],{x:0,z:0,angle:0,speed:0,weapon:null,ammo:0});
  live.mount(el,api);live.update(el,s,api);
  const built=await build(THREE,{renderer:()=>renderer,disposeObject(){}});
  assert.equal(compiles,2,'compatibility combat shaders compile while the arena is preparing');
  assert.equal(warmFrames,2,'compatibility combat geometry/effect buffers render before readiness');
  built.frame(1/60,clock/1000);encounter(built.scene);
  const geometryCount=geometries.size,materialCount=materials.size;
  for(const weapon of ['pulse','scatter','mine','shield','rocket','rail','grenade','emp']){
    const next=structuredClone(s);next.karts[0].weapon=weapon;next.karts[0].ammo=1;
    if(['pulse','scatter','rocket','rail'].includes(weapon))next.zaps=[{id:weapon,kind:weapon,x:0,z:3,angle:0,ttl:1}];
    if(weapon==='mine')next.mines=[{id:'mine',owner:'one',x:0,z:-3,armed:true}];
    if(weapon==='grenade')next.grenades=[{id:'grenade',x:0,z:3,y:1,angle:0,vx:0,vz:0,vy:0,fuse:1,warning:true}];
    if(weapon==='emp')next.events=[{id:'emp',type:'emp',pid:'one',x:0,z:3,angle:0}];
    live.update(el,next,api);built.frame(1/60,clock/1000);encounter(built.scene);
    assert.equal(geometries.size,geometryCount,weapon+' first use introduces no unprepared geometry');
    assert.equal(materials.size,materialCount,weapon+' first use introduces no unprepared material');
  }
  const bar=built.scene.getObjectByName('KartHealth:one');
  assert(bar&&!bar.visible,'classic full-health player has a prepared hidden scene health bar');
  const wounded=structuredClone(s);wounded.karts[0].health=60;wounded.karts[0].maxHealth=100;
  live.update(el,wounded,api);built.frame(1/60,clock/1000);
  const fill=bar.userData.fill;
  assert(bar.visible&&Math.abs(fill.scale.x-1.08)<1e-9&&Math.abs(fill.position.x+.36)<1e-9,'classic damaged bar shows actual60 of100, anchored left');
  assert.equal(bar.position.y,3,'classic bar stays above the player, independent of chassis yaw');
  assert(bar.quaternion.equals(built.camera.quaternion),'classic bar faces the current chase camera');
  assert(bar.children.every(o=>o.material.depthTest&&!o.material.depthWrite&&!o.material.map),'classic scene bars are occluded meshes without per-frame texture work');
  encounter(built.scene);assert.equal(geometries.size,geometryCount,'first damage uses prepared bar geometry');assert.equal(materials.size,materialCount,'first damage uses prepared bar materials');
  for(const patch of [{health:100},{health:0,respawn:2},{health:60,connected:false}]) {const next=structuredClone(wounded);Object.assign(next.karts[0],patch);live.update(el,next,api);built.frame(1/60,clock/1000);assert(!bar.visible,'classic hides full, KO and disconnected scene health');}
  const offline=structuredClone(wounded);offline.players=[{id:'one',connected:false}];live.update(el,offline,api);built.frame(1/60,clock/1000);assert(!bar.visible,'actual classic Room roster disconnection hides the bar');
  const watcher=structuredClone(wounded);watcher.you='watcher';watcher.youDrive=false;live.update(el,watcher,api);built.frame(1/60,clock/1000);assert(bar.visible,'classic spectator sees wounded players without a personal HUD');
  live.update(el,{...watcher,karts:[]},api);built.frame(1/60,clock/1000);assert.equal(bar.parent,null,'retired classic player detaches its bar');
  live.dispose();built.dispose();assert.equal(built.scene.getObjectByName('KartHealth:one'),undefined,'classic scene disposal removes health bars');
}
// Delayed renderer initialization must not expose countdown/GO or running time.
{
  const originalThreeView=context.createThreeView;
  let resolveGraphics;
  context.createThreeView=()=>new Promise(resolve=>{resolveGraphics=resolve;});
  const delayed=context.makeView({}),el=new Node(),announcements=[];
  const delayedApi={...api,announce:message=>announcements.push(message)};
  delayed.mount(el,delayedApi);
  delayed.update(el,state('countdown'),delayedApi);
  assert.equal(el.querySelector('#pk-count').hidden,true,'graphics pending suppresses countdown');
  assert.equal(el.querySelector('#pk-count').textContent,'','graphics pending has no stale GO');
  assert.equal(el.querySelector('#pk-timer').textContent,'Getting ready…','graphics pending exposes no running time');
  delayed.update(el,state('drive'),delayedApi);
  timers.fn();
  assert.equal(el.querySelector('#pk-timer').textContent,'Getting ready…','timer repaint cannot bypass delayed graphics');
  assert(el.querySelector('#pk-boost').querySelector('.kart-item-art').innerHTML.includes('<svg'),'equipped player retains the loading fallback before thumbnails decode');
  globalThis.Image=class{async decode(){const data=fs.readFileSync(require.resolve('../public'+this.src));assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}};
  const {loadKartWeaponThumbnails}=await import('../public/js/engines/kart-assets.mjs');
  await loadKartWeaponThumbnails();
  resolveGraphics({fallback:false,firstFrame:Promise.resolve(),dispose(){}});
  await delayed.ready();
  assert(el.querySelector('#pk-boost').querySelector('.kart-item-art').innerHTML.includes('/weapon-thumbnails/pulse.png'),'graphics-ready repaints already-equipped item without weapon/ammo change');
  assert(el.querySelector('#pk-tb').innerHTML.includes('/weapon-thumbnails/pulse.png'),'graphics-ready also repaints the touch action icon');
  delayed.update(el,{...state('countdown'),preparing:true},delayedApi);
  timers.fn();
  assert.equal(el.querySelector('#pk-count').hidden,true,'ready graphics do not bypass Room preparation');
  assert.equal(el.querySelector('#pk-timer').textContent,'Getting ready…');
  assert.equal(announcements.filter(message=>message.startsWith('Go!')).length,0,'preparing emits no GO announcement');
  delayed.update(el,state('countdown'),delayedApi);
  assert.equal(el.querySelector('#pk-count').hidden,false,'released graphics-ready countdown is visible');
  assert.equal(el.querySelector('#pk-count').textContent,'30','countdown follows authoritative endsAt');
  delayed.update(el,state('drive'),delayedApi);
  assert.equal(el.querySelector('#pk-count').hidden,true,'drive retires countdown');
  assert.notEqual(el.querySelector('#pk-timer').textContent,'Getting ready…','released drive exposes timer');
  delayed.update(el,{...state('drive'),preparing:true},delayedApi);
  assert.equal(el.querySelector('#pk-timer').textContent,'Getting ready…','a new preparation suppresses prior running time');
  delayed.dispose();
  let retiredDisposals=0;
  const retired=context.makeView({}),retiredEl=new Node();
  retired.mount(retiredEl,delayedApi);
  retired.update(retiredEl,state('countdown'),delayedApi);
  const resolveRetired=resolveGraphics;
  retired.dispose();
  resolveRetired({fallback:false,firstFrame:Promise.resolve(),dispose(){retiredDisposals++;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(retiredDisposals,1,'late graphics completion disposes its retired handle');
  assert.equal(retiredEl.querySelector('#pk-count').hidden,true,'retired renderer completion does not reveal countdown');
  context.createThreeView=originalThreeView;
}
console.log(`KART_VIEW_PASS: ${assertions} assertions; analog merge/coalescing, exact-once Fire, atomic multi-contact stops, KO/rematch, HUD/garage and cleanup`);
})().catch(e=>{console.error(e);process.exitCode=1;});
