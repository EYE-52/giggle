'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const apiCode = source.slice(source.indexOf('const api = {'), source.indexOf('\nfunction isHost()', source.indexOf('const api = {')));
const timerCode = source.slice(source.indexOf('function startTimer('), source.indexOf("\ndocument.addEventListener('click'", source.indexOf('function startTimer(')));
const preparationCode = source.slice(source.indexOf('function paintGamePreparation()'), source.indexOf('\nfunction paintGameLoadError(', source.indexOf('function paintGamePreparation()')));
const packets = [], clicks = [], ticks = [];
const fill = { style: {} }, text = { hidden: true, textContent: '' };
const bar = { hidden: true, firstElementChild: fill, classList: { toggle() {} } };
const body = { inert: false, setAttribute() {} }, preparation = { hidden: true };
const pageBody = {};
const noop = () => {};
const ctx = {
  serverClock: { now: () => 12000 }, lastState: { instanceId: 'match-a', w: '1|vote', preparing: true, gameNow: 8000, clockOffset: 4000, endsAt: 18000, phase: 'vote', phaseStartedAt: 8000 },
  ws: { readyState: 1 }, instanceId: 'match-a', gameId: 'would-you-rather', room: null,
  send: value => packets.push(value), sound: { click: () => clicks.push('click'), tick: () => ticks.push('tick') },
  playGameCue: noop, paintGameLoadError: noop, isHost: () => true, pendingRoomAction: null, theme: () => 'day',
  runLog: { snapshot: noop, event: noop, finish: noop, pause: noop, save: noop, latest: () => null },
  voiceClient: { getStatus: noop }, resultPresentation: { ready: noop }, toast: noop,
  createCanvasView: noop, createInput: noop, createMobileStick: noop, createSoundBank: noop, createThreeView: noop, createSessionToolkit: noop, announce: noop,
  preparationFocus: null,
  document: { body: pageBody, activeElement: pageBody, querySelector: selector => selector === '#tbar' ? bar : selector === '#ttime' ? text : null, getElementById: id => id === 'gbody' ? body : preparation },
  gameById: () => ({ runtime: { type: 'module' } }),
  timerRaf: 0, requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
};
vm.createContext(ctx);
vm.runInContext(apiCode + '\n' + timerCode + '\n' + preparationCode + '\nglobalThis.qa = { api, startTimer, paintGamePreparation, rememberPreparationFocus, restorePreparationFocus };', ctx);
const { api, startTimer, paintGamePreparation } = ctx.qa;
paintGamePreparation();
assert.equal(body.inert, true, 'ordinary game inputs remain inert during preparation');
ctx.gameById = () => ({ runtime: { type: 'frame' } });
paintGamePreparation();
assert.equal(body.inert, false, 'frame Help and Finish animation remain locally usable');
assert.equal(api.now(), 8000, 'phase preparation freezes game time');
assert.equal(api.send({ vote: 'a' }), false);
assert.equal(clicks.length + packets.length, 0, 'interactive local frame controls cannot send gameplay during preparation');
assert.equal(api.ready({ instanceId: 'old-match', window: '1|vote' }), false);
assert.equal(api.ready({ instanceId: 'match-a', window: 'old-window' }), false);
assert.equal(packets.length, 0, 'stale view completion cannot acknowledge current preparation');
assert.equal(api.ready({ instanceId: 'match-a', window: '1|vote' }), true);
assert.equal(JSON.stringify(packets.pop()), JSON.stringify({ t: 'game-ready', i: 'match-a', w: '1|vote' }));
startTimer(18000);
assert.equal(bar.hidden, true, 'no running shell countdown over unloaded content');
ctx.lastState.preparing = false;
assert.equal(api.now(), 8000, 'release uses the same game-clock domain');
startTimer(18000);
assert.equal(bar.hidden, false);
assert.equal(text.textContent, '10s left', 'preparation offset is subtracted from live countdown');
assert.equal(fill.style.width, '100%');
api.send({ vote: 'b' });
assert.equal(packets[0].i, 'match-a');
assert.equal(packets[0].w, '1|vote');
ctx.ws.readyState = 3;
assert.equal(api.send({ vote: 'a' }), false, 'offline inputs cannot appear queued');
assert.equal(clicks.length, 0,'sending an accepted action is silent until gameplay confirms its effect');
ctx.ws.readyState=1;ctx.pendingRoomAction={kind:'lobby'};
assert.equal(api.send({vote:'a'}),false,'leaving/rematch pending state cannot submit more moves');
ctx.pendingRoomAction=null;
ctx.lastState = { phase: 'done', endsAt: 18000, clockOffset: 4000 };
startTimer(18000);
assert.equal(bar.hidden, true, 'final screens have no remaining-time countdown');
// Execute the real preparation focus hooks. Browser disabling/inertness
// blurs a persistent pad; only the same released window may restore it.
const { rememberPreparationFocus, restorePreparationFocus } = ctx.qa;
let focusCount = 0;
const pad = { disabled: false, isConnected: true, focus() { focusCount++; ctx.document.activeElement = pad; } };
body.contains = element => element === pad;
const previous = { instanceId: 'reaction-a', w: '1|wait', preparing: false };
const preparing = { instanceId: 'reaction-a', w: '2|go', preparing: true };
function capture() {
  ctx.preparationFocus = null;
  ctx.document.activeElement = pad;
  ctx.lastState = preparing;
  rememberPreparationFocus(preparing, previous);
  assert.equal(ctx.preparationFocus.element, pad);
  ctx.document.activeElement = pageBody;
  body.inert = true;
  restorePreparationFocus(body);
  assert.equal(ctx.document.activeElement, pageBody, 'no focus during preparation');
  ctx.lastState = { ...preparing, preparing: false };
  body.inert = false;
}
capture();
restorePreparationFocus(body);
assert.equal(ctx.document.activeElement, pad, 'keyboard pad regains focus after its released window paints');
restorePreparationFocus(body);
assert.equal(focusCount, 1, 'restoration runs once, not on every tick');
for (const boundary of ['window', 'instance', 'removed', 'disabled', 'menu', 'user-focus', 'body']) {
  capture();
  if (boundary === 'window') ctx.lastState.w = '3|results';
  if (boundary === 'instance') ctx.lastState.instanceId = 'reaction-b';
  if (boundary === 'removed') pad.isConnected = false;
  if (boundary === 'disabled') pad.disabled = true;
  if (boundary === 'menu') ctx.document.querySelector = selector => selector === 'dialog[open]' ? { open: true } : null;
  if (boundary === 'user-focus') ctx.document.activeElement = { id: 'another-control' };
  restorePreparationFocus(boundary === 'body' ? {} : body);
  assert.equal(focusCount, 1, `${boundary} prevents delayed focus theft`);
  pad.isConnected = true;
  pad.disabled = false;
  ctx.document.querySelector = () => null;
}
console.log('GAME_READINESS_SHELL_PASS: clocks, loading/action gating, offline/final states, exact-window keyboard focus and focus-theft guards');
