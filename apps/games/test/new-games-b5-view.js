'use strict';

// Execute the shipped view modules against the existing board DOM double.
// This proves client actions/lifecycle only; it makes no browser layout claim.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ids = ['dots-boxes', 'mega-tic-tac-toe', 'five-row', 'pig-dice', 'snakes-ladders'];
let checks = 0;
const ok = (value, label) => { assert(value, label); checks++; };
const eq = (a, b, label) => { assert.equal(JSON.stringify(a), JSON.stringify(b), label); checks++; };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const old = read('test/board-duels-view.js');
const nodeSource = old.slice(old.indexOf('class Node {'), old.indexOf('// The shared board panel'));
const plain = s => s.replace(/^import[^;]+;\s*/gm, '').replace(/^export \{[^;]+;\s*/gm, '').replace(/^export /gm, '');

function rig(id) {
  let timerId = 0;
  const timers = new Map(), sends = [], results = [], rooms = [];
  const sandbox = vm.createContext({
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
    syncHudTimer() {}, stopHudTimer() {},
    esc: v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    nameOf: (S, pid) => S.players.find(p => p.id === pid)?.name || '?',
    MouseEvent: function (type, options) { return { type, ...options }; },
  });
  vm.runInContext(nodeSource + `
    Node.prototype.hasAttribute = function (k) { return this.getAttribute(k) !== null; };
    Node.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
    Node.prototype.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
    Node.prototype.dispatchEvent = function (e) { return this.dispatch(e.type, e); };
    Object.defineProperty(Node.prototype, 'id', { get() { return this.attrs.id || ''; } });
    Object.defineProperty(Node.prototype, 'style', { get() { return this._style || (this._style = { setProperty() {} }); } });
    const document = { activeElement: null, createElement(tag) { return new Node(tag, this); }, getElementById(id) { return this.root.querySelector('#' + id); } };
    document.root = new Node('document', document);
    document.head = document.root.appendChild(new Node('head', document));
    globalThis.document = document;
    globalThis.el = document.root.appendChild(new Node('main', document));
  `, sandbox);
  vm.runInContext(plain(read('public/js/games/board-kit.js')), sandbox);
  vm.runInContext(plain(read('public/js/games/batch5-kit.js')), sandbox);
  vm.runInContext(plain(read(`public/js/games/${id}.js`)).replace('default createBatch5View', 'globalThis.view = createBatch5View'), sandbox);
  const def = require(`../games/${id}/server`);
  const roster = [{ id: 'a', name: '<img onerror=evil>' }, { id: 'b', name: 'Bee' }];
  const ctx = { allPlayers: () => roster, settings: () => ({}), now: () => 1000, later() {}, award() {}, content: () => JSON.parse(read(`locales/en/${id}.json`)) };
  let state = def.create(ctx), host = true;
  const api = { send: a => sends.push(a), context: () => ({ isHost: host }), now: () => 1000,
    cue() {}, resultsReady: i => results.push(i), rematch: () => rooms.push('rematch'), lobby: () => rooms.push('lobby') };
  const render = (pid = 'a', instance = 'one', extra = {}) => {
    const S = { ...def.view(state, pid), instanceId: instance, players: roster, me: pid, spectator: !state.seats.includes(pid), ...extra };
    sandbox.view.update(sandbox.el, S, api); return S;
  };
  sandbox.view.mount(sandbox.el, api);
  return { ...sandbox, def, ctx, api, sends, timers, results, rooms, render,
    get state() { return state; }, fresh() { state = def.create(ctx); }, host: value => { host = value; } };
}

for (const id of ids) {
  const r = rig(id); r.render();
  eq(r.document.head.querySelectorAll('link').length, 0, 'mount preserves the host stylesheet order');
  ok(r.el.querySelector('.b5-game').getAttribute('data-family') === 'board', id + ': board family');
  eq(r.el.querySelector('.bk-name').textContent, '<img onerror=evil>', 'player names stay literal text');
  eq(r.el.querySelectorAll('img').length, 0, 'player text cannot create an image');
  const legal = r.def.view(r.state, 'a').legal[0];
  const selector = id === 'dots-boxes' ? `[data-edge="${legal}"]` : ['pig-dice', 'snakes-ladders'].includes(id) ? '[data-roll]' : `[data-cell="${legal}"]`;
  const click = selector => r.el.querySelector(selector).dispatch('click');
  r.render('watcher'); click(selector); eq(r.sends, [], 'watcher controls send nothing');
  r.render('b'); click(selector); eq(r.sends, [], 'waiting seat sends nothing');
  r.render('a', 'one', { preparing: true }); click(selector); eq(r.sends, [], 'preparing gate');
  r.render(); click(selector); click(selector);
  eq(r.sends.length, 1, id + ': rapid clicks deduplicated');
  eq(r.sends[0].rev, 0, 'current revision attached');
  r.def.onAction(r.state, r.ctx, 'a', r.sends[0]); r.render();
  eq(r.state.rev, 1); eq(r.timers.size, 0, 'ack clears pending timer');
  if (id === 'five-row') {
    r.render('b'); click('[data-swap]'); eq(r.sends[1], { swap: true, rev: 1 });
    r.def.onAction(r.state, r.ctx, 'b', r.sends[1]); r.render('b'); eq(r.state.colours, [2, 1]);
  }
  r.render('a'); click('[data-resign]');
  ok(!r.el.querySelector('.bk-row-confirm').hidden, 'resign confirmation');
  const count = r.sends.length;
  click('[data-keep]'); eq(r.sends.length, count, 'cancel is inert');
  click('[data-resign]'); click('[data-confirm-resign]');
  r.def.onAction(r.state, r.ctx, 'a', r.sends.at(-1)); r.render();
  ok(!r.el.querySelector('.bk-final').hidden, 'final scores visible');
  eq(r.results, ['one'], 'one result notification'); r.render(); eq(r.results, ['one']);
  click('[data-rematch]'); eq(r.rooms, ['rematch']);
  r.host(false); r.render(); click('[data-rematch]'); eq(r.rooms, ['rematch'], 'elected host gate');
  r.view.dispose(r.el); eq(r.timers.size, 0); ok(!r.el._b5, 'mount cache removed');
  const sent = r.sends.length;
  click(selector); eq(r.sends.length, sent, 'retired listeners removed');
  r.fresh(); r.view.mount(r.el, r.api); r.render('a', 'two'); click(selector);
  eq(r.sends.length, sent + 1, 'same-game restart sends once');
  r.view.dispose(r.el);
}

// Won boards keep their big mark while the remaining legal destinations
// change from a forced board to any open board.
{
  const r = rig('mega-tic-tac-toe');
  r.state.small[0] = 1;
  r.state.small[1] = 2;
  r.state.forced = 4;
  r.render();
  eq(r.el.querySelectorAll('.is-open').map(el => el.getAttribute('data-board')), ['4'], 'Mega highlights only the forced board');
  eq(r.el.querySelectorAll('.is-blocked').length, 6, 'Mega dims every other unfinished board');
  ok(r.el.querySelector('[data-board="0"]').querySelector('.mt-trophy').classList.contains('mt-x'), 'won X board has a large X');
  ok(r.el.querySelector('[data-board="1"]').querySelector('.mt-trophy').classList.contains('mt-o'), 'won O board has a large O');
  r.state.forced = -1;
  r.state.rev++;
  r.render();
  eq(r.el.querySelectorAll('.is-open').length, 7, 'Mega lights all unfinished boards for a free choice');
  eq(r.el.querySelectorAll('.is-blocked').length, 0, 'free choice leaves no unfinished board dimmed');
  r.view.dispose(r.el);
}
console.log(`NEW_GAMES_B5_VIEW_PASS: ${checks} real module action and lifecycle checks (DOM double, no layout claim)`);
