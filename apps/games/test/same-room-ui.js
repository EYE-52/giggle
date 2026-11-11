'use strict';
/* Execute the actual entry controller against a DOM and fake transport.
 * Browser layout/screenshots live in same-room-browser.cjs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { loadUi } = require('./truth-dare-modes-view');
const registry = require('../games/registry');

(async () => {
  const { sameRoomSupport, LOCAL_AVATARS } = await import('../public/js/same-room-support.mjs');
  const ui = await loadUi(), originalDocument = global.document;
  const html = fs.readFileSync(require.resolve('../public/same-room/index.html'), 'utf8');
  const themeSource = fs.readFileSync(require.resolve('../public/js/same-room-theme.js'), 'utf8');
  for (const [saved, expected] of [[null, 'day'], ['day', 'day'], ['night', 'night'], ['dark', 'night']]) {
    const page = { documentElement: { dataset: {} } };
    vm.runInNewContext(themeSource, { document: page, localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: true }) });
    assert.equal(page.documentElement.dataset.theme, expected, 'Day is the default; saved choices survive');
  }
  const { document, window } = parseHTML(html);
  global.document = document;
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
  const helpers=fs.readFileSync(require.resolve('../public/js/util.js'),'utf8');
  const {uiIcon,settingIcon}=await import('data:text/javascript;base64,'+Buffer.from(helpers).toString('base64'));
  const ctx = { document, window, uiIcon, settingIcon,
    getComputedStyle: () => ({ getPropertyValue: () => document.documentElement.dataset.theme === 'night' ? '#080808' : '#ffffff' }),
    location: { protocol: 'http:', host: 'localhost', search: '?game=truth-dare' },
    history: { replaceState() {} }, sessionStorage: storage, localStorage: storage, URLSearchParams,
    performance, WebSocket: FakeSocket, fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval: () => 0, console, sameRoomSupport, LOCAL_AVATARS,
    wsTargetFromConfig: () => '', reset: () => ui.dispose(), show: async (el, game, state, api) => { if (game === 'truth-dare') ui.render(el, state, api); return ui; },
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
  assert.deepEqual([...document.querySelectorAll('.sr-section-icon use,.sr-field-title use,.sr-pace-art use')].map(el=>el.getAttribute('href').split('#')[1]),
    ['users-three','sliders-horizontal','repeat','gauge','leaf','sneaker-move','rocket-launch','cards']);
  const sprite=fs.readFileSync(require.resolve('../public/assets/ui/settings-icons.svg'),'utf8');
  for(const game of registry.list())for(const setting of game.schema.settings){
    const icon=settingIcon(setting),ref=icon.match(/#([a-z-]+)"/)[1];
    assert(sprite.includes('id="'+ref+'"'),game.id+' has artwork for '+setting.key);
    assert(icon.includes('aria-hidden="true"') && icon.includes('focusable="false"'));
  }
  assert.equal(document.querySelectorAll('.sr-steps li').length, 3);
  assert(document.querySelector('.sr-hero-art .sr-cover'));
  assert.equal(document.querySelector('.sr-empty-friends use').getAttribute('href'), '/assets/ui/settings-icons.svg#armchair');
  assert.equal(document.querySelectorAll('.sr-prompt-styles .sr-prompt-art').length, 4);
  assert.equal(document.querySelectorAll('.sr-choice-desc').length, 4);
  assert.equal(document.querySelectorAll('.sr-pace-art').length, 3);
  $('srTheme').click(); assert.equal(document.documentElement.dataset.theme, 'night');
  assert.equal($('srTheme').getAttribute('aria-label'), 'Switch to day theme');
  assert.equal(document.querySelector('meta[name="theme-color"]').content, '#080808');
  $('srTheme').click(); assert.equal(document.documentElement.dataset.theme, 'day');
  assert.equal(document.querySelectorAll('[data-game-choice]').length, 21);
  assert.equal(document.querySelector('[data-game-choice="pose-party"]'), null);
  assert.equal(document.querySelectorAll('.sr-game-card img').length, 21, 'every game has a cover');
  for (const card of document.querySelectorAll('.sr-game-card')) {
    const meta = registry.meta(card.dataset.gameChoice);
    assert.equal(card.querySelector('.sr-game-tile').children.length, 3, 'art, name and count have separate rows');
    assert.equal(card.querySelector('.sr-game-name').textContent, meta.name);
    assert.match(card.querySelector('.sr-game-count').textContent, / people$/);
    assert.equal(card.querySelector('.sr-game-check use').getAttribute('href'), '/assets/ui/settings-icons.svg#check');
  }
  assert.equal($('srShowGames').getAttribute('aria-expanded'), 'false');
  $('srShowGames').click();
  assert($('srGameGrid').classList.contains('is-expanded'));
  assert.equal($('srShowGames').getAttribute('aria-expanded'), 'true');
  assert.equal($('srShowGames').textContent, 'Show fewer games');
  $('srShowGames').click();
  assert(!$('srGameGrid').classList.contains('is-expanded'));
  assert.equal($('srShowGames').textContent, 'Show all 21 games');
  assert.equal(document.querySelectorAll('select:not(.picker-native)').length, 0, 'settings expose tiles, not native selects');
  assert($('srStart').disabled);
  assert.match($('srReason').textContent, /Add 2 more names/);
  const add = text => { $('srName').value = text; $('srAdd').onclick(); };
  add('Sam, Jess, Mo');
  assert.equal(document.querySelectorAll('.sr-person.is-new').length, 3, 'only new seats get the entrance');
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 3);
  assert.equal($('srNames').querySelectorAll('.sr-avatar').length, 3);
  assert(!($('srStart').disabled)); assert.equal(focused, $('srName'));
  add('SAM'); assert.match($('srNameError').textContent, /different name/);
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 3);
  $('srNames').querySelector('[data-remove="2"]').onclick();
  assert.equal(document.querySelectorAll('.sr-person.is-new').length, 0, 'existing seats do not pop again');
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 2);
  $('srName').value = '';
  document.querySelector('[data-picker-for="sr-setting-pace"] [data-value="Quick"]').click();
  document.querySelector('[data-picker-for="sr-setting-promptStyle"] [data-value="Ask your own"]').click();
  $('srSetup').onsubmit({ preventDefault() {} });
  const start = sent.find(m => m.t === 'same-start');
  assert.deepEqual(start.names, ['Sam', 'Jess']); assert.equal(start.settings.promptStyle, 'Ask your own');
  assert.equal(start.settings.pace, 'Quick', 'segmented settings drive the real native value and start payload');
  assert.equal(start.game, 'truth-dare'); assert(!('code' in start));
  const before = sent.length; $('srSetup').onsubmit({ preventDefault() {} }); assert.equal(sent.length, before, 'double start is blocked');
  emit({ t: 'same-created', token: 'tab-only-secret' });
  const players = [{ id: 'a', name: 'Sam', avatar: '🦊', colour: 0 }, { id: 'b', name: 'Jess', avatar: '🐸', colour: 1 }, { id: 'c', name: 'Mo', avatar: '🐼', colour: 2 }];
  const chosen = { instanceId: 'one', phase: 'choose', target: 'c', me: 'c', kind: null,
    players, w: 'choose', round: 1, rounds: 1, roundStyle: 'Ask your own', endsAt: 20100 };
  emit({ t: 'same-state', game: 'truth-dare', step: 0, gate: 'play', private: false, kind: 'play', player: 'c', players, state: { ...chosen, phase: 'spin', w: 'spin' }, gameNow: 100, running: false });
  assert.equal($('srTurn').textContent, 'Mo’s turn!');
  assert(document.querySelector('.sr-play-head.is-new-turn'));
  assert($('tSpin'), 'actual game spinner is mounted');
  emit({ t: 'same-state', game: 'truth-dare', step: 1, gate: 'play', private: false, kind: 'play', player: 'c', players, state: chosen, gameNow: 100, running: false });
  assert.equal($('srTurn').textContent, 'Mo’s turn!');
  assert.equal(document.querySelector('.sr-play-head.is-new-turn'), null, 'same actor does not bounce on phase changes');
  const banner = document.querySelector('.sr-play-head');
  assert(document.querySelector('[data-deck="wild"]'), 'actual game deck chips are mounted');
  assert(document.querySelector('[data-kind="truth"]') && document.querySelector('[data-kind="dare"]'));
  assert($('tSpinForMe'), 'actual Spin for me control is mounted');
  assert.equal($('srDeck'), null, 'no stand-in prompt style selector during play');
  document.querySelector('[data-deck="wild"]').click(); $('tSpinForMe').click();
  assert.deepEqual(sent.at(-1).a, { deck: 'wild', kind: 'random' });
  // A same-phase snapshot can update the acting seat without rebuilding the
  // outer shell. This catches the previously stale header independently.
  $('srTurn').textContent = 'Sam’s turn!';
  emit({ t: 'same-state', game: 'truth-dare', step: 1, gate: 'play', private: false, kind: 'play', player: 'c', players, state: chosen, gameNow: 100, running: true });
  assert.equal($('srTurn').textContent, 'Mo’s turn!');
  assert.equal(document.querySelector('.sr-play-head'), banner, 'readiness keeps the banner mounted');
  emit({ t: 'same-state', game: 'truth-dare', step: 2, gate: 'pass', private: true, kind: 'write', player: 'b', players, gameNow: 100, running: false });
  assert.match(appText(), /Pass the phone to Jess/); assert.equal($('tEntry'), null);
  assert.equal(document.body.dataset.stage, 'pass');
  assert(document.querySelector('.sr-phone-art'));
  $('srUnlock').onclick(); assert.equal(sent.at(-1).op, 'unlock');
  const state = { instanceId: 'one', phase: 'compose', target: 'c', kind: 'truth', me: 'b', players, w: 'compose',
    round: 1, rounds: 1, roundStyle: 'Ask your own', endsAt: 40100, promptLimit: 180, submitted: [], myEntry: null };
  emit({ t: 'same-state', game: 'truth-dare', step: 3, gate: 'play', private: true, kind: 'write', player: 'b', players, state, gameNow: 100, running: false });
  assert.equal($('srTurn').textContent, 'Jess’s turn!');
  assert.equal(document.body.dataset.stage, 'private');
  assert.equal(document.querySelector('.sr-play-head').dataset.colour, '1');
  $('tEntry').value = 'A private question'; $('tEntry').oninput();
  const draft = $('tEntry');
  emit({ t: 'same-state', game: 'truth-dare', step: 3, gate: 'play', private: true, kind: 'write', player: 'b', players, state, gameNow: 100, running: true });
  assert.equal($('tEntry'), draft, 'readiness keeps the actual game composer mounted');
  assert.equal($('tEntry').value, 'A private question');
  $('tSendEntry').click(); assert.equal(sent.at(-1).a.entry, 'A private question');
  emit({ t: 'same-state', game: 'truth-dare', step: 4, gate: 'return', private: true, kind: 'prompt-vote', player: 'a', players, gameNow: 100, running: false });
  assert.equal($('tEntry'), null); assert(!document.toString().includes('A private question'));
  assert.match(appText(), /Done, pass it back/);
  assert.equal(document.body.dataset.stage, 'return');
  assert.equal(document.querySelector('.sr-hand').dataset.colour, '1', 'return cover keeps the previous player colour');
  $('srUnlock').onclick(); assert.equal(sent.at(-1).op, 'back');
  const ballot = { ...state, phase: 'prompt-vote', me: 'a', w: 'prompt-vote', myPromptVote: null,
    options: ['A shared story', 'A funny dare', 'A tiny dance'], promptVoted: [] };
  emit({ t: 'same-state', game: 'truth-dare', step: 5, gate: 'play', private: true, kind: 'prompt-vote', player: 'a', players, state: ballot, gameNow: 100, running: false });
  assert.equal($('srTurn').textContent, 'Sam’s turn!');
  assert.equal(document.querySelectorAll('[data-prompt-vote]').length, 3);
  document.querySelector('[data-prompt-vote="1"]').click(); assert.equal(sent.at(-1).a.promptVote, 1);
  const performing = { ...chosen, phase: 'perform', kind: 'truth', w: 'perform', prompt: 'Tell a shared story', endsAt: 60100 };
  emit({ t: 'same-state', game: 'truth-dare', step: 6, gate: 'play', private: false, kind: 'play', player: 'c', players, state: performing, gameNow: 100, running: false });
  assert.equal($('srTurn').textContent, 'Mo’s turn!');
  assert($('tReady') && appText().includes('Tell a shared story'), 'actual game prompt and performance controls are mounted');
  $('tReady').click(); assert.equal(sent.at(-1).a.ready, true);
  emit({ t: 'same-state', game: 'truth-dare', step: 7, gate: 'play', private: true, kind: 'vote', player: 'a', players, state: { ...performing, phase: 'vote', w: 'vote', me: 'a', voted: [], myVote: null }, gameNow: 100, running: false });
  assert.equal($('srTurn').textContent, 'Sam’s turn!');
  assert(document.querySelector('[data-v="yes"]') && document.querySelector('[data-v="no"]'), 'actual game judging controls are mounted');
  document.querySelector('[data-v="yes"]').click(); assert.equal(sent.at(-1).a.vote, 'yes');
  emit({ t: 'same-state', game: 'truth-dare', step: 8, gate: 'play', private: false, kind: 'play', player: 'a', players, state: { ...chosen, me: 'a', target: 'a', round: 2 }, gameNow: 100, running: false });
  assert(document.querySelector('.sr-play-head.is-new-turn'), 'a new round gets feedback even if the actor stays the same');
  emit({ t: 'same-state', game: 'truth-dare', step: 8, gate: 'play', private: false, kind: 'play', player: 'a', players, state: { ...performing, phase: 'done', me: 'a', scores: { a: 25, b: 25, c: 100 } }, gameNow: 100, running: false });
  assert.equal(document.body.dataset.stage, 'results');
  assert.equal($('srTurn').textContent, 'Final scores');
  assert(document.querySelector('.gk-final') && $('srAgain'));
  assert.equal(document.querySelector('.sr-head-avatar use').getAttribute('href'), '/assets/ui/settings-icons.svg#trophy');
  emit({ t: 'same-state', game: 'charades', step: 9, gate: 'play', private: false, kind: 'guess', player: 'b', players, state: { instanceId: 'charades', phase: 'act', me: 'b', actor: 'c', guessed: {}, players }, gameNow: 100, running: false });
  assert.equal($('srGuesser').type, 'hidden', 'guessers use avatar chips instead of a dropdown');
  assert.equal(document.querySelectorAll('[data-guesser]').length, 2);
  const guesserChip = document.querySelector('[data-guesser="a"]');
  emit({ t: 'same-state', game: 'charades', step: 9, gate: 'play', private: false, kind: 'guess', player: 'b', players, state: { instanceId: 'charades', phase: 'act', me: 'b', actor: 'c', guessed: {}, players }, gameNow: 200, running: true });
  assert.equal(document.querySelector('[data-guesser="a"]'), guesserChip, 'live snapshots retain the guesser button and focus');
  document.querySelector('[data-guesser="a"]').click();
  assert.equal(sent.at(-1).op, 'seat'); assert.equal(sent.at(-1).pid, 'a');
  emit({ t: 'same-stopped' });
  document.querySelector('[data-game-choice="chess"]').click();
  assert.equal($('srGameGrid').firstElementChild.dataset.gameChoice, 'chess', 'selected game stays in the two-row preview');
  assert.equal($('srGameGrid').firstElementChild.getAttribute('aria-pressed'), 'true');
  add('Mo'); assert.match($('srNameError').textContent, /up to 2/);
  assert.equal($('srNames').querySelectorAll('.sr-person').length, 2);
  assert.equal(data.get('giggle:one-device:token'), undefined);
  document.querySelector('[data-game-choice="truth-dare"]').click();
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
  ui.dispose(); global.document = originalDocument;
  console.log('SAME_ROOM_UI_PASS: real entry controller, catalog opt-ins, name chips, quick add, limits, settings, double-start, draft stability and private DOM removal');
})().catch(error => { console.error(error); process.exitCode = 1; });
