import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createGameScreen, createGameScreenPrompt } from '../public/js/toolkit/game-screen.mjs';

// Run the actual shell callbacks, including their controller and storage,
// rather than a second implementation of the button/prompt state rules.
const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const wire = source.slice(source.indexOf('function wireGameRoom() {'), source.indexOf('/* ---- game size'));
const paint = source.slice(source.indexOf('function paintGameScreen('), source.indexOf('\nfunction renderGame()'));
const resizeStart = source.indexOf("document.addEventListener('game-screenchange', () => {");
const resize = source.slice(resizeStart, source.indexOf('\n\nfunction render()', resizeStart));
assert(wire && paint && resize);
assert.match(source, /<\/details><button[^>]+id="bGameScreenToggle"/, 'visible toggle is outside the closed Room drawer');
assert.match(source, /id="bGameScreenPrompt"[^>]*>Play full screen<\/button>/);

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}
function rig({ touch = false, layout = 'immersive', enabled = true, request = true,
  navigator = {}, frame = false, storage = () => memory() } = {}) {
  const doc = new EventTarget(), win = new EventTarget(), frames = [], calls = [], messages = [];
  const classes = new Set();
  doc.body = { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } };
  doc.fullscreenEnabled = enabled;
  doc.fullscreenElement = null;
  doc.defaultView = win;
  win.parent = frame ? {} : win;
  doc.documentElement = {};
  if (request) doc.documentElement.requestFullscreen = async () => {
    calls.push('enter'); doc.fullscreenElement = doc.documentElement;
    doc.dispatchEvent(new Event('fullscreenchange'));
  };
  doc.exitFullscreen = async () => {
    calls.push('exit'); doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
  };
  const nodes = new Map();
  for (const id of ['bGameScreen', 'bGameScreenToggle', 'bGameScreenPrompt', 'bGameScreenDismiss', 'gameScreenPrompt']) {
    nodes.set(id, { hidden: true, disabled: false, attrs: {},
      setAttribute(key, value) { this.attrs[key] = value; }, focus() { calls.push('focus:' + id); } });
  }
  const menu = new EventTarget(); menu.open = false; menu.querySelector = () => null;
  nodes.set('roomMenu', menu);
  doc.getElementById = id => nodes.get(id);
  doc.querySelector = () => null;
  const sizes = [];
  win.addEventListener('resize', () => sizes.push(classes.has('game-fullscreen')));
  const context = vm.createContext({ document: doc, window: win, Event,
    requestAnimationFrame: fn => frames.push(fn),
    createGameScreen: options => createGameScreen({ ...options, doc, navigator, orientation: {}, isPortrait: () => true }),
    gameScreen: null, gameScreenPrompt: createGameScreenPrompt({ storage }),
    readInputCapabilities: () => ({ preferred: { touch } }),
    gameId: 'test-game', gameById: () => ({ layout }), toast: message => messages.push(message),
    renderHostStates() {}, applyGameZoom() {}, menuConfirm: null,
  });
  vm.runInContext(wire + '\n' + paint + '\n' + resize + '\nwireGameRoom();', context);
  return { doc, nodes, context, calls, messages, menu, sizes, classes,
    button: nodes.get('bGameScreenToggle'), prompt: nodes.get('gameScreenPrompt'),
    flush() { for (const fn of frames.splice(0)) fn(); } };
}

for (const touch of [false, true]) {
  const r = rig({ touch });
  assert.equal(r.button.hidden, false);
  assert.equal(r.button.attrs['aria-label'], touch ? 'Play full screen' : 'Full screen');
  assert.equal(r.button.title, r.button.attrs['aria-label']);
  assert.equal(r.button.attrs['aria-pressed'], 'false');
  assert.equal(r.prompt.hidden, !touch);
  assert.deepEqual(r.calls, [], 'mounting never requests fullscreen without a tap');
  const expand = r.button.innerHTML;
  r.menu.open = true;
  r.button.onclick(); await Promise.resolve(); await Promise.resolve(); r.flush();
  assert.equal(r.menu.open, false);
  assert.equal(r.context.gameScreen.state().fullscreen, true);
  assert.equal(r.button.attrs['aria-label'], 'Exit full screen');
  assert.equal(r.button.attrs['aria-pressed'], 'true');
  assert.equal(r.nodes.get('bGameScreen').textContent, 'Exit full screen');
  assert.notEqual(r.button.innerHTML, expand, 'collapse icon replaces expand icon');
  assert(r.classes.has('game-fullscreen'));
  assert(r.sizes.includes(true), 'resize runs after fullscreen chrome is painted');
  assert.equal(r.prompt.hidden, true);
  // System Escape updates both controls and does not repeat the invitation.
  r.doc.fullscreenElement = null; r.doc.dispatchEvent(new Event('fullscreenchange')); r.flush();
  assert.equal(r.button.attrs['aria-pressed'], 'false');
  assert.equal(r.button.innerHTML, expand);
  assert.equal(r.classes.has('game-fullscreen'), false);
  assert.equal(r.prompt.hidden, true);
  r.context.gameScreen.dispose();
}
for (const options of [{ enabled: false }, { request: false }, { enabled: false, frame: true }]) {
  const r = rig({ ...options, touch: true });
  assert.equal(r.button.hidden, true, 'unsupported document/iframe hides the visible entry');
  assert.equal(r.nodes.get('bGameScreen').hidden, true);
  assert.equal(r.prompt.hidden, true);
}
{
  const r = rig({ touch: true, frame: true });
  r.nodes.get('bGameScreen').onclick(); await Promise.resolve(); await Promise.resolve();
  assert.equal(r.context.gameScreen.state().fullscreen, true, 'an allowed practice iframe can enter fullscreen');
  r.nodes.get('bGameScreen').onclick(); await Promise.resolve(); await Promise.resolve();
  assert.equal(r.context.gameScreen.state().fullscreen, false, 'Room uses the same toggle to exit');
}
for (const navigator of [
  { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1' },
  { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 },
]) {
  const r = rig({ enabled: false, request: false, touch: true, navigator });
  assert.equal(r.button.hidden, false, 'iOS Safari keeps the useful hint path');
  r.button.onclick(); await Promise.resolve();
  assert.equal(r.calls.includes('enter'), false);
  assert.equal(r.messages.length, 1, 'iOS tap gives a hint instead of a dead control');
  const deniedFrame = rig({ enabled: false, touch: true, navigator, frame: true });
  assert.equal(deniedFrame.button.hidden, true, 'iOS does not bypass iframe permissions');
}
{
  const saved = memory(), storage = () => saved;
  const r = rig({ touch: true, storage });
  r.nodes.get('bGameScreenDismiss').onclick();
  assert.equal(r.prompt.hidden, true);
  assert.equal(r.calls.includes('enter'), false, 'dismissing never requests fullscreen');
  assert.equal(rig({ touch: true, storage }).prompt.hidden, true, 'dismissal survives a new page/session');
}
for (const storage of [() => { throw Error('blocked'); }, () => ({ getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } })]) {
  const r = rig({ touch: true, storage });
  assert.equal(r.prompt.hidden, false);
  r.nodes.get('bGameScreenDismiss').onclick();
  vm.runInContext('paintGameScreen(gameScreen.state());', r.context);
  assert.equal(r.prompt.hidden, true, 'blocked storage still remembers dismissal during the session');
}
assert.equal(rig({ touch: true, layout: 'standard' }).prompt.hidden, true);
{
  const saved = memory(), storage = () => saved;
  const r = rig({ touch: true, storage });
  r.nodes.get('bGameScreenPrompt').onclick(); await Promise.resolve(); await Promise.resolve();
  assert.equal(r.context.gameScreen.state().fullscreen, true, 'the phone chip uses the same gesture controller');
  assert.equal(rig({ touch: true, storage }).prompt.hidden, true, 'accepting also retires the one-time invitation');
  r.context.gameScreen.dispose(); r.flush();
  assert.equal(r.classes.has('game-fullscreen'), false, 'leaving clears fullscreen chrome');
}
{
  const r = rig(); let resolve;
  r.doc.documentElement.requestFullscreen = () => new Promise(done => { resolve = done; });
  r.button.onclick();
  assert.equal(r.button.disabled, true);
  assert.equal(r.nodes.get('bGameScreen').disabled, true);
  assert.equal(r.button.attrs['aria-busy'], 'true');
  r.context.gameScreen.dispose(); resolve(); await Promise.resolve(); await Promise.resolve();
}
{
  const r = rig();
  r.doc.documentElement.requestFullscreen = async () => { throw Error('denied'); };
  r.button.onclick(); await Promise.resolve(); await Promise.resolve(); r.flush();
  assert.equal(r.button.disabled, false);
  assert.equal(r.button.attrs['aria-pressed'], 'false');
  assert.equal(r.classes.has('game-fullscreen'), false, 'a denied request never applies fullscreen chrome');
  assert.equal(r.messages.length, 1);
}
console.log('GAME_SCREEN_UI_PASS: actual shell controls, icons/labels, capability/iframe/iOS rules, resize, prompt gestures and saved/blocked-storage dismissal');
