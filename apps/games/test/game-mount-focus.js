'use strict';
// Execute the actual app callbacks with a deferred view load. Client-only
// fixtures cannot catch shell focus theft or a stale callback touching a new game.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const bodyStart = source.indexOf('function mountGameBody() {');
const bodyEnd = source.indexOf('function ensureRematchFooter(el) {', bodyStart);
const focusStart = source.indexOf('focus: (sel) => {');
const focusEnd = source.indexOf('\n  announce:', focusStart);
assert(bodyStart >= 0 && bodyEnd > bodyStart && focusStart >= 0 && focusEnd > focusStart);
const bodyCode = source.slice(bodyStart, bodyEnd);
const preparationFocusCode = source.slice(source.indexOf('function rememberPreparationFocus('), source.indexOf('\nfunction paintGameLoadError('));
const focusCode = source.slice(focusStart, focusEnd);
let checks = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }

function rig({ touch = false, menuOpen = false, alreadyFocused = false, disabledFirst = false, playfield = false } = {}) {
  const calls = { focus: [], scroll: [], spectator: [], footer: [], timer: [], removed: 0, loads: [] };
  const nodes = [];
  const document = {
    activeElement: null,
    getElementById(id) { return id === 'gbody' ? this.body : id === 'roomMenu' ? menu : nodes.find(n => n.id === id); },
    querySelector(selector) { return nodes.find(n => '#' + n.id === selector); },
    querySelectorAll() { return [{ remove() { calls.removed++; } }]; },
  };
  function node(id, tagName = 'INPUT', disabled = false) {
    const n = { id, tagName, disabled, focus(options) { calls.focus.push({ id, options }); document.activeElement = n; } };
    nodes.push(n); return n;
  }
  const input = node('entry'), disabled = node('disabled-entry', 'INPUT', true), resume = node('resume', 'BUTTON'), canvas = node('drive', 'CANVAS');
  const menu = { open: menuOpen, contains: n => n === resume };
  const el = {
    innerHTML: 'current view',
    querySelector(selector) {
      if (selector.includes('data-game-focus')) return playfield ? canvas : null;
      const candidates = disabledFirst ? [disabled, input] : [input];
      return candidates.find(n => !selector.includes(':not(:disabled)') || !n.disabled);
    },
  };
  document.body = el;
  if (menuOpen) document.activeElement = resume;
  const context = {
    preparationFocus: null,
    document, window: { scrollTo: (...args) => calls.scroll.push(args) },
    gameId: 'typing-race', instanceId: 'match-1', lastState: { phase: 'race', endsAt: 1000 },
    focusGame: alreadyFocused ? 'typing-race' : null,
    gameById: () => ({}), isLoaded: () => false,
    readInputCapabilities: () => ({ preferred: { touch } }),
    applySpectator: n => calls.spectator.push(n), ensureRematchFooter: n => calls.footer.push(n),
    startTimer: (...args) => calls.timer.push(args),
    showView(...args) { return new Promise(resolve => calls.loads.push({ args, resolve })); },
  };
  vm.createContext(context);
  vm.runInContext('const api = {' + focusCode + '};\n' + preparationFocusCode + '\n' + bodyCode + '\nglobalThis.qa = { mountGameBody, paintGameBody, focus: api.focus };', context);
  async function finish(index = calls.loads.length - 1, view = {}) {
    calls.loads[index].resolve(view);
    await Promise.resolve();
    await Promise.resolve();
  }
  return { context, document, menu, el, input, resume, canvas, calls, finish, ...context.qa };
}

(async () => {
  // Desktop retains deliberate keyboard entry; phones wait for a user's tap.
  for (const touch of [false, true]) {
    const r = rig({ touch }); r.mountGameBody(); await r.finish();
    equal(r.calls.focus.map(c => c.id), touch ? [] : ['entry'], 'first mount respects input capability');
    equal(r.calls.scroll, [[0, 0]], 'fresh mount begins at top');
    equal(r.calls.timer, [[1000, false]], 'live mount paints the authoritative timer');
    r.context.lastState = { phase: 'race', endsAt: 2000 };
    r.paintGameBody(); await r.finish();
    equal(r.calls.focus.length, touch ? 0 : 1, 'snapshot ticks never steal focus');
    equal(r.calls.scroll.length, 1, 'snapshot ticks never yank page scroll');
    equal(r.calls.timer.at(-1), [2000, false], 'tick updates the live deadline');
  }
  {
    const r = rig({ disabledFirst: true }); r.mountGameBody(); await r.finish();
    equal(r.calls.focus.map(c => c.id), ['entry'], 'disabled watcher/finished controls are skipped');
  }
  for (const touch of [false, true]) {
    const r = rig({ playfield:true, touch });
    r.context.lastState.preparing = true; r.mountGameBody(); await r.finish();
    equal(r.calls.focus.length,0,'canvas waits for the same preparation barrier as text inputs');
    r.context.lastState.preparing = false; r.paintGameBody(); await r.finish();
    equal(r.calls.focus.map(c=>c.id),touch?[]:['drive'],'keyboard game focuses its real playfield instead of HUD buttons');
    r.paintGameBody(); await r.finish();
    equal(r.calls.focus.length,touch?0:1,'canvas focus runs once and never steals it on a heartbeat');
  }
  // The first paint normally resolves before the multiplayer preparation
  // barrier. Desktop autofocus must survive until that barrier releases.
  for (const touch of [false, true]) {
    const r = rig({ touch });
    r.context.lastState.preparing = true;
    r.mountGameBody(); await r.finish();
    equal(r.calls.focus.length, 0, 'preparing mount never focuses inert controls');
    equal(r.context.focusGame, null, 'preparation does not consume initial focus');
    r.paintGameBody(); await r.finish();
    equal(r.calls.scroll.length, 0, 'repeated preparation paints preserve scroll');
    r.context.lastState.preparing = false;
    r.paintGameBody(); await r.finish();
    equal(r.calls.focus.map(c => c.id), touch ? [] : ['entry'], 'release focuses desktop entry only');
    equal(r.calls.scroll.length, 1, 'released first view settles once');
    r.paintGameBody(); await r.finish();
    equal(r.calls.focus.length, touch ? 0 : 1, 'later snapshots do not repeat release focus');
  }
  // Room can open during an async import. Its Resume control keeps focus.
  {
    const r = rig(); r.mountGameBody(); r.menu.open = true; r.document.activeElement = r.resume;
    await r.finish();
    equal(r.document.activeElement, r.resume, 'delayed mount does not escape the Room dialog');
    equal(r.calls.focus.length, 0, 'Room blocks mount autofocus');
    equal(r.calls.scroll.length, 0, 'Room blocks mount scrolling');
    r.menu.open = false; r.mountGameBody(); await r.finish();
    equal(r.calls.focus.length, 0, 'closing Room does not replay the first-mount focus');
  }
  {
    const r = rig({ alreadyFocused: true }); r.mountGameBody(); await r.finish();
    equal(r.calls.focus.length, 0, 'settled game is not focused again');
    equal(r.calls.scroll.length, 0, 'settled game keeps its scroll position');
  }
  // Both mount and patch callbacks must retire on any ownership boundary.
  for (const method of ['mountGameBody', 'paintGameBody']) {
    for (const change of ['element', 'instance', 'game']) {
      for (const success of [true, false]) {
        const r = rig(); r[method]();
        if (change === 'element') r.document.body = { innerHTML: 'new view' };
        if (change === 'instance') r.context.instanceId = 'match-2';
        if (change === 'game') r.context.gameId = 'chess';
        await r.finish(0, success ? {} : null);
        equal(r.calls.spectator.length + r.calls.footer.length + r.calls.timer.length + r.calls.focus.length + r.calls.scroll.length,
          0, `${method} ignores ${change} after a ${success ? 'successful' : 'failed'} load`);
        equal(r.el.innerHTML, 'current view', 'stale failure never overwrites the retired view');
      }
    }
  }
  // A coalesced/null paint starts no timer and cannot overwrite a newer view.
  // Genuine failures are now reported by the host through api.loadError.
  {
    const r = rig(); r.mountGameBody(); await r.finish(0, null);
    equal(r.el.innerHTML, 'current view', 'null paints do not invent a load failure');
    equal(r.calls.timer.length + r.calls.focus.length, 0, 'failed current load starts no timer/focus');
  }
  // api.focus is also used by game-owned repaints (e.g. chess selection).
  {
    const r = rig({ menuOpen: true });
    r.focus(r.input); r.focus('#entry');
    equal(r.calls.focus.length, 0, 'element and selector focus cannot escape an open Room');
    r.focus(r.resume);
    equal(r.calls.focus.map(c => c.id), ['resume'], 'controls inside Room can still focus');
    r.menu.open = false; r.focus('#entry');
    equal(r.document.activeElement, r.input, 'focus works after Room closes');
    equal(JSON.stringify(r.calls.focus.at(-1).options), JSON.stringify({ preventScroll: true }), 'focus preserves scroll');
  }
  console.log(`GAME_MOUNT_FOCUS_PASS: ${checks} assertions (actual app async mount/patch ownership, Room focus, capability autofocus, snapshot stability)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
