'use strict';
/* Execute the actual entry controller against a DOM and fake transport.
 * Browser layout/screenshots live in same-room-browser.cjs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const registry = require('../games/registry');

(async () => {
  const { sameRoomSupport, LOCAL_AVATARS } = await import('../public/js/same-room-support.mjs');
  const html = fs.readFileSync(require.resolve('../public/same-room/index.html'), 'utf8');
  const { document, window } = parseHTML(html);
  // linkedom intentionally has no browser selection/focus engine.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    get() { return this.querySelector('option[selected]')?.getAttribute('value') || this.querySelector('option[selected]')?.textContent || this.querySelector('option')?.getAttribute('value') || this.querySelector('option')?.textContent || ''; },
    set(value) { for (const option of this.querySelectorAll('option')) { if ((option.getAttribute('value') || option.textContent) === String(value)) option.setAttribute('selected', ''); else option.removeAttribute('selected'); } },
    configurable: true,
  });
  let focused;
  window.HTMLElement.prototype.focus = function () { focused = this; };
  const data = new Map(), sent = [], sockets = [];
  const storage = { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; sockets.push(this); }
    send(raw) { sent.push(JSON.parse(raw)); }
  }
  const ctx = { document, window, location: { protocol: 'http:', host: 'localhost', search: '?game=truth-dare' },
    history: { replaceState() {} }, sessionStorage: storage, localStorage: storage, URLSearchParams,
    performance, WebSocket: FakeSocket, fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval: () => 0, console, sameRoomSupport, LOCAL_AVATARS,
    wsTargetFromConfig: () => '', reset() {}, show: async () => ({}),
    esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  };
  vm.createContext(ctx);
  ctx.Event = window.Event;
  vm.runInContext(fs.readFileSync(require.resolve('../public/js/pickers.js'), 'utf8').replace(/^export /gm, ''), ctx);
  const source = fs.readFileSync(require.resolve('../public/js/same-room.js'), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, ctx);
  await new Promise(resolve => setImmediate(resolve));
  const ws = sockets[0]; ws.onopen();
  const emit = message => ws.onmessage({ data: JSON.stringify(message) });
  emit({ t: 'games', games: registry.list() });
  const $ = id => document.getElementById(id);
  assert.equal($('srGame').querySelectorAll('option').length, 21);
  assert.equal($('srGame').querySelector('[value="pose-party"]'), null);
  assert($('srStart').disabled);
  assert.match($('srReason').textContent, /Add 2 more names/);
  const add = text => { $('srName').value = text; $('srAdd').onclick(); };
  add('Sam, Jess, Mo');
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 3);
  assert.equal($('srNames').querySelectorAll('.sr-avatar').length, 3);
  assert(!($('srStart').disabled)); assert.equal(focused, $('srName'));
  add('SAM'); assert.match($('srNameError').textContent, /different name/);
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 3);
  $('srNames').querySelector('[data-remove="2"]').onclick();
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 2);
  $('srName').value = '';
  document.querySelector('[data-picker-for="sr-setting-pace"] [data-value="Quick"]').click();
  $('sr-setting-promptStyle').value = 'Ask your own'; $('sr-setting-promptStyle').onchange();
  $('srSetup').onsubmit({ preventDefault() {} });
  const start = sent.find(m => m.t === 'same-start');
  assert.deepEqual(start.names, ['Sam', 'Jess']); assert.equal(start.settings.promptStyle, 'Ask your own');
  assert.equal(start.settings.pace, 'Quick', 'segmented settings drive the real native value and start payload');
  assert.equal(start.game, 'truth-dare'); assert(!('code' in start));
  const before = sent.length; $('srSetup').onsubmit({ preventDefault() {} }); assert.equal(sent.length, before, 'double start is blocked');
  emit({ t: 'same-created', token: 'tab-only-secret' });
  const players = [{ id: 'a', name: 'Sam', avatar: '🦊', colour: 0 }, { id: 'b', name: 'Jess', avatar: '🐸', colour: 1 }];
  emit({ t: 'same-state', game: 'truth-dare', step: 1, gate: 'pass', private: true, kind: 'write', player: 'b', players, gameNow: 100, running: false });
  assert.match(appText(), /Pass the phone to Jess/); assert.equal($('srPrompt'), null);
  $('srUnlock').onclick(); assert.equal(sent.at(-1).op, 'unlock');
  const state = { instanceId: 'one', phase: 'write', target: 'a', writer: 'b', kind: 'truth', me: 'b', players, w: 'write' };
  emit({ t: 'same-state', game: 'truth-dare', step: 2, gate: 'play', private: true, kind: 'write', player: 'b', players, state, gameNow: 100, running: false });
  $('srPrompt').value = 'A private question';
  // A readiness update must preserve the in-progress draft.
  emit({ t: 'same-state', game: 'truth-dare', step: 2, gate: 'play', private: true, kind: 'write', player: 'b', players, state, gameNow: 100, running: true });
  assert.equal($('srPrompt').value, 'A private question');
  $('srOwnPrompt').onsubmit({ preventDefault() {} }); assert.equal(sent.at(-1).a.prompt, 'A private question');
  emit({ t: 'same-state', game: 'truth-dare', step: 3, gate: 'return', private: false, kind: 'play', player: 'a', players, gameNow: 100, running: false });
  assert.equal($('srPrompt'), null); assert(!document.toString().includes('A private question'));
  assert.match(appText(), /Done, pass it back/);
  $('srUnlock').onclick(); assert.equal(sent.at(-1).op, 'back');
  emit({ t: 'same-stopped' });
  $('srGame').value = 'chess'; $('srGame').onchange();
  add('Mo'); assert.match($('srNameError').textContent, /up to 2/);
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 2);
  assert.equal(data.get('giggle:one-device:token'), undefined);
  $('srGame').value = 'truth-dare'; $('srGame').onchange();
  add(Array.from({ length: 18 }, (_, i) => `Friend ${i + 3}`).join(', '));
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 20);
  assert(!$('srStart').disabled);
  add('Friend 21'); assert.match($('srNameError').textContent, /up to 20/);
  // Home, the shared card dialog and authored game guides all expose entry.
  const home = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
  assert.match(home, /href="\/same-room\/">Play on one device/);
  assert.match(home, /game\.sameRoom \? .*same-room-link/);
  for (const g of registry.list()) {
    const guide = fs.readFileSync(require.resolve(`../public/games/${g.id}/index.html`), 'utf8');
    assert.equal(guide.includes('Play on one device'), !!g.sameRoom, g.id + ' guide respects opt-in');
  }
  function appText() { return $('srApp').textContent; }
  console.log('SAME_ROOM_UI_PASS: real entry controller, catalog opt-ins, name chips, quick add, limits, settings, double-start, draft stability and private DOM removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
