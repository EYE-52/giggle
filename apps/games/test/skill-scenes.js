'use strict';
/* Skill-scenes view/lifecycle coverage for the 15 party games owned by this
 * contributor. Each client ESM module is loaded for real (util + toolkit
 * inlined, no browser) and rendered against representative snapshots for
 * every phase, including actor/guesser, spectator, reveal, and done.
 * Run: node test/skill-scenes.js */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NOW = 1700000000000;
const PLAYERS = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cy <script>' },
];

function stripExport(src) {
  return src.replace(/^export\s+(default\s+)?/gm, '');
}

function stripImport(src, from) {
  const re = new RegExp(`^import\\s[^;]*from\\s+['"]${from}['"];?\\s*$`, 'm');
  return src.replace(re, '');
}

async function loadView(game, toolkit) {
  let util = fs.readFileSync(path.join(ROOT, 'public/js/util.js'), 'utf8');
  util = stripExport(util);
  let gameSrc = fs.readFileSync(path.join(ROOT, 'public/js/games', `${game}.js`), 'utf8');
  let prefix = util;
  if (gameSrc.includes("from '../toolkit/input-capabilities.mjs'")) {
    prefix += '\n' + stripExport(fs.readFileSync(path.join(ROOT, 'public/js/toolkit/input-capabilities.mjs'), 'utf8'));
    gameSrc = stripImport(gameSrc, '../toolkit/input-capabilities.mjs');
  }
  // Board games share the board kit module; inline it like util.
  if (gameSrc.includes("from './board-kit.js'")) {
    prefix += '\n' + stripExport(fs.readFileSync(path.join(ROOT, 'public/js/games/board-kit.js'), 'utf8'));
    gameSrc = stripImport(gameSrc, './board-kit.js');
  }
  if (gameSrc.includes("from '../kit.js'")) {
    // The game kit (public/js/kit.js) shares util's esc; inline it after util.
    const kit = fs.readFileSync(path.join(ROOT, 'public/js/kit.js'), 'utf8')
      .replace(/^import\s[^;]*from\s+['"]\.\/util\.js['"];?\s*$/m, '')
      .replace(/^export\s*\{[^}]*\};?\s*$/m, '');
    prefix += '\n' + stripExport(kit);
    gameSrc = stripImport(gameSrc, '../kit.js');
  }
  if (toolkit) {
    let tk = fs.readFileSync(path.join(ROOT, 'public/js/toolkit', `${toolkit}.js`), 'utf8');
    tk = stripImport(tk, '../util.js');
    tk = stripExport(tk);
    gameSrc = stripImport(gameSrc, `../toolkit/${toolkit}.js`);
    // The wrapper and the toolkit share helper names; namespace the wrapper's.
    gameSrc = gameSrc
      .replace(/\bensureCss\b/g, 'ensureWrapCss')
      .replace(/\bremoveCss\b/g, 'removeWrapCss')
      .replace(/\bCSS_ID\b/g, 'WRAP_CSS_ID')
      .replace(/\bCSS_HREF\b/g, 'WRAP_CSS_HREF');
    prefix += '\n' + tk;
  }
  gameSrc = stripImport(gameSrc, '../util.js');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(prefix + '\n' + gameSrc).toString('base64'));
  assert(mod.default && (typeof mod.default.render === 'function' || typeof mod.default.update === 'function'),
    `${game} exports a view with render() or update()`);
  return mod.default;
}

/* ---- minimal DOM/browsing stubs: string-capture els + fake nodes ---- */

function makeEl() {
  const el = {
    innerHTML: '',
    _key: undefined,
    _reg: Object.create(null),
    querySelector(sel) {
      if (!el._reg[sel]) el._reg[sel] = new FakeNode();
      return el._reg[sel];
    },
    querySelectorAll() { return []; },
  };
  return el;
}

/* Every string a player could see from one render: root HTML plus all
 * patched nodes. Used for the taxonomy-leak sweep at the end. */
const RENDERED = [];
function collect(el) {
  let s = el.innerHTML || '';
  if (el._reg) {
    for (const node of Object.values(el._reg)) s += '\n' + (node.innerHTML || '') + '\n' + (node.textContent || '');
  }
  RENDERED.push(s);
  return s;
}

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._html = '';
    this._cls = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.parentElement = null;
    this.scrollLeft = 0;
    this.scrollWidth = 0;
    this.scrollTop = 0;
    this.clientWidth = 0;
    const set = new Set();
    this.classList = {
      add: (...cs) => cs.forEach((c) => set.add(c)),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      toggle: (c, f) => { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (f) set.add(c); else set.delete(c); },
      contains: (c) => set.has(c),
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set className(v) { this._cls = String(v); }
  get className() { return this._cls; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); return this; }
  insertBefore(c, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    c.parentElement = this;
    return c;
  }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i >= 0) this.parentElement.children.splice(i, 1);
  }
  replaceChildren() { this.children = []; }
  get firstChild() { return this.children[0] || null; }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const i = this.parentElement.children.indexOf(this);
    return this.parentElement.children[i + 1] || null;
  }
  querySelector(sel) {
    // The camera wrappers probe for .sk-camhead presence: only that
    // selector is nullable; engine refs always resolve to a live node.
    if (sel === '.sk-camhead') {
      return this.children.find((c) => c.className && c.className.split(' ').includes('sk-camhead')) || null;
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      const descend = (nodes) => nodes.flatMap(n => [n, ...descend(n.children || [])]);
      const found = descend(this.children).find((c) => c.className && c.className.split(' ').includes(cls));
      if (found) return found;
    }
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      const found = this.children.find((c) => c.id === id);
      if (found) return found;
    }
    // Engine refs resolve to one live node per selector (as in a real DOM).
    this._q = this._q || Object.create(null);
    return this._q[sel] || (this._q[sel] = new FakeNode());
  }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  focus() {}
  // This structural smoke stub does not model a drawing viewport; actual
  // zoom/pan geometry and pointer input have their own drawing view tests.
  closest() { return null; }
  getContext() {
    return {
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      set strokeStyle(v) { this._s = v; }, set lineWidth(v) { this._w = v; },
      set lineCap(v) { this._c = v; }, set lineJoin(v) { this._j = v; },
    };
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 880, height: 520 }; }
}

function installDocument() {
  const links = {};
  global.document = {
    body: { classList: { contains: () => false } },
    head: { appendChild: () => {} },
    getElementById: (id) => links[id] || null,
    createElement: (tag) => {
      const n = new FakeNode(tag);
      if (tag === 'link') {
        Object.defineProperty(n, 'id', {
          get: () => n._lid || '',
          set: (v) => { n._lid = v; links[v] = n; },
        });
        n.remove = () => { delete links[n._lid]; };
      }
      return n;
    },
  };
  return links;
}

function makeApi() {
  return {
    sent: [],
    announced: [],
    send(a) { this.sent.push(a); },
    now: () => NOW,
    focus() {},
    announce(m) { this.announced.push(m); },
  };
}

function base(over) {
  return {
    instanceId: 'i1', me: 'a', players: PLAYERS, scores: {}, spectator: false, endsAt: 0, ...over,
  };
}

(async () => {
  const links = installDocument();
  let n = 0;
  const ok = (msg) => { n += 1; console.log(`ok ${n} - ${msg}`); };


  /* ---------- 1. charades ---------- */
  {
    const view = await loadView('charades');
    const api = makeApi();
    const el = makeEl();
    view.render(el, base({ phase: 'act', round: 1, rounds: 3, actor: 'a', wordShown: 'Dragonfruit', masked: '__________', guesses: [], guessed: {} }), api);
    assert(el.innerHTML.includes('Dragonfruit'), 'actor sees the private word');
    assert(!el.innerHTML.includes('cGuess'), 'actor gets no guess box');
    collect(el);
    view.render(el, base({ phase: 'act', round: 1, rounds: 3, actor: 'b', masked: '____', guesses: [{ pid: 'a', text: 'kiwi' }], guessed: {} }), api);
    assert(el.innerHTML.includes('cGuess'), 'guesser gets the guess box');
    assert(el._reg['#cFeed'].innerHTML.includes('kiwi'), 'guesser sees own tries');
    assert(!el.innerHTML.includes('Dragonfruit'), 'guesser never sees the secret');
    collect(el);
    view.render(el, base({ phase: 'act', round: 1, rounds: 3, actor: 'b', masked: '____', guesses: [], guessed: {}, spectator: true }), api);
    assert(el.innerHTML.includes('Watching') && !el.innerHTML.includes('cGuess'), 'spectators get no guess controls');
    assert(el.innerHTML.includes('watching the actor') && !el.innerHTML.includes('Your guess'), 'watcher cue never invites a guess');
    collect(el);
    view.render(el, base({ phase: 'reveal', round: 1, rounds: 3, actor: 'b', word: 'Kiwi', guessed: { a: 150 }, endReason: "Time's up" }), api);
    assert(el.innerHTML.includes('Kiwi') && el.innerHTML.includes('+150'), 'reveal shows word + scorers');
    collect(el);
    view.render(el, base({ phase: 'done', scores: { a: 10, b: 30 } }), api);
    assert(el.innerHTML.includes('&lt;script&gt;'), 'names are escaped in standings');
    assert(!el.innerHTML.includes('<script>'), 'no raw script tag leaks');
    collect(el);
    view.dispose(el);
    ok('charades: actor/guesser/reveal/done, private word, escaped names');
  }

  /* ---------- 2. chess ---------- */
  {
    const view = await loadView('chess');
    const api = makeApi();
    const el = makeEl();
    assert(typeof view.mount === 'function' && typeof view.update === 'function', 'chess keeps mount/update');
    view.mount(el, api);
    const row = () => [null, null, null, null, null, null, null, null];
    const board = [row(), row(), row(), row(), row(), row(), row(), row()];
    board[7][4] = { s: 'e1', t: 'k', c: 'w' };
    board[0][4] = { s: 'e8', t: 'k', c: 'b' };
    board[6][4] = { s: 'e2', t: 'p', c: 'w' };
    const S = base({
      phase: 'play', white: 'a', black: 'b', youAre: 'w', turn: 'w', check: false, checkSquare: null,
      board, legal: { e2: [{ to: 'e4' }] }, history: [], fen: 'x', lastMove: null, result: null,
      clocks: null, clockStamp: NOW, timeControl: 'Untimed', boardTheme: 'Mono', players: PLAYERS,
    });
    view.update(el, S, api);
    const boardHtml = el._reg['#chess-root'].innerHTML;
    assert(boardHtml.includes('data-sq="e2"'), 'board squares render');
    assert(boardHtml.includes('White to move'), 'status names the side to move');
    assert(boardHtml.includes('No time control'), 'untimed games say so');
    collect(el);
    view.update(el, { ...S, phase: 'done', result: { outcome: 'checkmate', winner: 'w', winnerPid: 'a' } }, api);
    assert(el._reg['#chess-root'].innerHTML.includes('Checkmate'), 'done shows the result');
    collect(el);
    view.dispose(el);
    ok('chess: tactile board, status, untimed + checkmate states');
  }

  /* ---------- 3. countdown-word ---------- */
  {
    const view = await loadView('countdown-word');
    const api = makeApi();
    const el = makeEl();
    const S = base({
      phase: 'make', round: 1, rounds: 4, letters: ['C', 'H', 'O', 'C', 'O', 'L', 'A', 'T', 'E'],
      mine: '', locked: [], myLocked: false, myFeedback: null, hostId: 'b', contentNote: '',
    });
    view.render(el, S, api);
    assert(el.innerHTML.includes('cw-tile') && el.innerHTML.includes('cwWord'), 'tiles + input render');
    assert(el.innerHTML.includes('cwSave') && el.innerHTML.includes('cwLock') && el.innerHTML.includes('cwPass'), 'save/lock/pass present');
    collect(el);
    view.render(el, { ...S, myLocked: true, mine: 'CHOCOLATE' }, api);
    assert(el.innerHTML.includes('disabled'), 'locked players cannot edit');
    collect(el);
    view.render(el, base({
      phase: 'reveal', round: 1, rounds: 4, hostId: 'a',
      last: { answers: { a: 'CHOCOLATE', b: 'COOL' }, valid: { a: true, b: true }, points: { a: 140, b: 40 }, longest: 9, best: 'chocolate' },
    }), api);
    assert(el.innerHTML.includes('chocolate') && el.innerHTML.includes('cwNext'), 'reveal shows best + host next');
    collect(el);
    view.render(el, { ...S, myLocked: false, myFeedback: { ok: false, message: 'Unsupported word' } }, api);
    assert(el._reg['#cwFeedback'].textContent.includes('Unsupported word'), 'feedback paints without rebuild');
    collect(el);
    view.render(el, base({ phase: 'done', rounds: 4, scores: { a: 140, b: 40 } }), api);
    assert(el.innerHTML.includes('aria-label="Word Countdown final scores"') && el.innerHTML.includes('>Final scores</h2>'), 'done identifies the Countdown final');
    assert(el.innerHTML.includes('class="gk-ranks"') && el.innerHTML.includes('>140 <small') && el.innerHTML.includes('>40 <small'), 'done shows exact match scores');
    assert(!el.innerHTML.includes('id="cwWord"'), 'done removes the active word composer');
    collect(el);
    view.dispose(el);
    ok('countdown-word: active tiles, lock, feedback, reveal, done');
  }

  /* ---------- 4. doodle-guess ---------- */
  {
    const view = await loadView('doodle-guess');
    const api = makeApi();
    const el = makeEl();
    view.render(el, base({ phase: 'pick', round: 1, rounds: 4, drawer: 'a', choices: ['apple', 'robot', 'pirate'] }), api);
    assert(el.innerHTML.includes('apple') && el.innerHTML.includes('data-w'), 'drawer picks a word');
    collect(el);
    view.render(el, base({ phase: 'pick', round: 1, rounds: 4, drawer: 'b' }), api);
    assert(el.innerHTML.includes('Ben') && el.innerHTML.includes('picking'), 'waiters see the named artist');
    collect(el);
    view.render(el, base({
      phase: 'draw', round: 1, rounds: 4, drawer: 'a', wordShown: 'robot', masked: '',
      strokes: [{ pts: [[0, 0], [0.5, 0.5]], color: '#111111', size: 5 }], guessed: {}, hints: true,
    }), api);
    assert(el.innerHTML.includes('robot') && el.innerHTML.includes('dCanvas'), 'drawer sees word + canvas');
    assert(el.innerHTML.includes('dClear'), 'drawer tools render');
    collect(el);
    view.render(el, base({
      phase: 'draw', round: 1, rounds: 4, drawer: 'b', masked: 'R___T', strokes: [], guessed: { c: 120 }, hints: true,
    }), api);
    assert(el.innerHTML.includes('dGuess'), 'guessers get the guess box');
    assert(el.innerHTML.includes('R _ _ _ T'), 'mask renders spaced');
    assert(el.innerHTML.includes('+120'), 'correct guesses show outcomes');
    assert(!el.innerHTML.includes('robot'), 'guessers never see the word');
    collect(el);
    view.render(el, base({ phase: 'reveal', round: 1, rounds: 4, drawer: 'b', word: 'robot', strokes: [], guessed: {} }), api);
    assert(el.innerHTML.includes('robot'), 'reveal names the word');
    collect(el);
    view.render(el, base({ phase: 'done', scores: { a: 5 } }), api);
    assert(el.innerHTML.includes('Final scores') && el.innerHTML.includes('gk-rank-row'), 'done shows the kit final scores');
    collect(el);
    view.dispose(el);
    ok('doodle-guess: pick/draw/reveal/done, named artist, hint, outcomes');
  }

  /* ---------- 5. draw-phone ---------- */
  {
    const view = await loadView('draw-phone');
    const api = makeApi();
    const el = makeEl();
    view.render(el, base({ phase: 'write', myPhrase: '', submitted: [], suggestions: ['A cat in a hat'] }), api);
    assert(el.innerHTML.includes('pPhrase') && el.innerHTML.includes('A cat in a hat'), 'write shows input + inspiration');
    assert(el.innerHTML.includes('sk-steps'), 'progress steps render');
    collect(el);
    view.render(el, base({ phase: 'draw', myPrompt: 'A cat in a hat', myStrokes: [{ pts: [[0, 0], [1, 1]], color: '#111111', size: 5 }], drawn: [] }), api);
    assert(el.innerHTML.includes('A cat in a hat') && el.innerHTML.includes('pCanvas'), 'draw shows prompt + canvas');
    collect(el);
    view.render(el, base({ phase: 'guess', myDrawing: [], myGuess: '', guessed: [] }), api);
    assert(el.innerHTML.includes('pGuess'), 'guess shows the caption box');
    collect(el);
    const chains = [{ origin: 'a', phrase: 'hi', drawBy: 'b', strokes: [], guessBy: 'c', guess: 'yo' }];
    view.render(el, base({ phase: 'reveal', chains, revealIdx: 0, hostId: 'a' }), api);
    assert(el.innerHTML.includes('Story 1 of 1') && el.innerHTML.includes('pNext'), 'host steps the storybook');
    collect(el);
    view.render(el, base({ phase: 'reveal', chains, revealIdx: 0, hostId: 'b' }), api);
    assert(!el.innerHTML.includes('pNext'), 'non-hosts get no page controls');
    collect(el);
    view.render(el, base({ phase: 'done', scores: { a: 50 } }), api);
    assert(el.innerHTML.includes('Final scores') && el.innerHTML.includes('gk-rank-row'), 'done shows the kit final scores');
    collect(el);
    view.dispose(el);
    ok('draw-phone: paper flow, steps, storybook reveal with host paging');
  }

  /* ---------- 6. memory-tray ---------- */
  {
    const view = await loadView('memory-tray');
    const api = makeApi();
    const el = makeEl();
    view.render(el, base({ phase: 'memorize', round: 1, rounds: 3, memMs: 12000, items: ['apple', 'key', 'zebra'] }), api);
    assert(el.innerHTML.includes('<svg'), 'tray shows real object art');
    assert(el.innerHTML.includes('apple') && el.innerHTML.includes('zebra'), 'known + custom words label');
    collect(el);
    const builtIns = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en/memory-tray.json'))).items;
    view.render(el, base({ phase: 'memorize', round: 2, rounds: 3, memMs: 12000, items: builtIns }), api);
    assert.equal((el.innerHTML.match(/<svg/g) || []).length, builtIns.length, 'every built-in tray object has artwork');
    assert(!el.innerHTML.includes('<text '), 'built-in objects never fall back to an initial medallion');
    view.render(el, base({ phase: 'recall', round: 1, rounds: 3, submitted: [], myRecall: null }), api);
    assert(el.innerHTML.includes('mAns'), 'recall shows the answer box');
    assert(!el.innerHTML.includes('zebra'), 'tray stays hidden while recalling');
    collect(el);
    view.render(el, base({
      phase: 'reveal', round: 1, rounds: 3, hostId: 'a',
      last: { items: ['apple', 'key'], results: { a: { correct: ['apple'], count: 1, pts: 50 } } },
    }), api);
    assert(el.innerHTML.includes('mNext') && el.innerHTML.includes('+50'), 'host advances; scores shown');
    collect(el);
    view.render(el, base({ phase: 'done', scores: { a: 50 } }), api);
    assert(el.innerHTML.includes('Final scores'), 'done shows standings');
    collect(el);
    view.dispose(el);
    ok('memory-tray: object shelf, hidden recall, reveal, done');
  }

  /* ---------- 7. number-hunt ---------- */
  {
    const view = await loadView('number-hunt');
    const api = makeApi();
    const el = makeEl();
    const S = base({
      phase: 'hunt', round: 1, rounds: 5, guesses: { a: [50] }, history: [{ pid: 'a', guess: 50, result: 'first', dir: 'higher', flavor: 'first — higher' }],
      finished: [], scores: {}, wins: {}, strings: {},
    });
    view.render(el, S, api);
    assert(el.innerHTML.includes('nGuess') && el.innerHTML.includes('nWin'), 'dial + input render');
    assert(el._reg['#nBetween'].textContent.includes('between 51 and 100'), 'bounds narrow from public hints');
    collect(el);
    const first = el.innerHTML;
    view.render(el, S, api); // same snapshot: must patch, never rebuild typing
    assert.strictEqual(el.innerHTML, first, 'snapshots patch without rebuilding the input');
    view.render(el, {
      ...S,
      history: [
        ...S.history,
        { pid: 'b', guess: 75, result: 'hotter', dir: 'lower', flavor: 'hotter — lower' },
      ],
    }, api);
    assert(el._reg['#nBetween'].textContent.includes('between 51 and 74'), 'upper bound tightens live');
    collect(el);
    // Real public bisection can deduce a singleton without anyone finding it.
    const deduced = { ...S, history: [
      { pid: 'a', guess: 50, result: 'first', dir: 'higher' },
      { pid: 'a', guess: 75, result: 'hotter', dir: 'lower' },
      { pid: 'a', guess: 62, result: 'colder', dir: 'higher' },
      { pid: 'a', guess: 68, result: 'hotter', dir: 'higher' },
      { pid: 'a', guess: 71, result: 'hotter', dir: 'higher' },
      { pid: 'a', guess: 73, result: 'same', dir: 'lower' },
    ], guesses: { a: [50, 75, 62, 68, 71, 73] } };
    const draft = el._reg['#nGuess'];
    draft.value = '72';
    view.render(el, deduced, api);
    assert.strictEqual(el._reg['#nBetween'].textContent, 'Only 72 remains.', 'deduction does not announce a nonexistent finder');
    assert.strictEqual(el._reg['#nGuess'], draft, 'deduction preserves input node');
    assert.strictEqual(draft.value, '72', 'deduction preserves draft');
    assert(!draft.disabled && !el._reg['#nSend'].disabled, 'deduced number still needs a legal guess');
    const correct = { ...deduced, phase: 'overtime', finished: [{ pid: 'b', tries: 1 }],
      history: [...deduced.history, { pid: 'b', guess: 72, result: 'correct' }] };
    view.render(el, correct, api);
    assert.strictEqual(el._reg['#nBetween'].textContent, 'Someone found it: 72. Seconds left to finish!', 'actual public correct guess announces finder');
    assert(!draft.disabled && draft.value === '72', 'other player can finish without losing draft');
    view.render(el, { ...correct, finished: [] }, api);
    assert(el._reg['#nBetween'].textContent.startsWith('Someone found it: 72.'), 'public correct history confirms finding');
    view.render(el, { ...correct, history: deduced.history }, api);
    assert(el._reg['#nBetween'].textContent.startsWith('Someone found it: 72.'), 'public finished list confirms finding');
    collect(el);
    view.render(el, { ...S, phase: 'overtime', finished: [{ pid: 'b', tries: 2 }] }, api);
    assert.strictEqual(el._reg['.gk-hud-phase'].textContent, 'Overtime', 'overtime is labeled in the HUD');
    collect(el);
    view.render(el, base({
      phase: 'roundEnd', round: 1, rounds: 5, strings: {},
      last: { secret: 63, finished: [{ pid: 'a', tries: 3, pts: 100 }] },
    }), api);
    assert(el.innerHTML.includes('63') && el.innerHTML.includes('+100'), 'round end reveals the number');
    collect(el);
    view.render(el, base({ phase: 'done', scores: {}, wins: {}, strings: {} }), api);
    assert(el.innerHTML.includes('Final scores'), 'done shows standings');
    collect(el);
    view.dispose(el);
    ok('number-hunt: live bounds, patch-in-place typing, overtime, reveal, done');
  }

  /* ---------- 8/9. pose-party + show-and-go ---------- */
  for (const [game, mode] of [['pose-party', 'spotlight'], ['show-and-go', 'gallery']]) {
    const view = await loadView(game, 'camera-party');
    assert(view.ownsTimer === true, `${game} owns its clock HUD`);
    const api = makeApi();
    const el = new FakeNode();
    const S = base({
      phase: 'perform', round: 1, rounds: 4, mode, prompt: 'Do the thing',
      actor: 'a', you: 'a', candidates: ['a'], ready: {}, votes: {}, myVotes: {},
      scores: {}, players: PLAYERS, hostId: 'a', endsAt: NOW + 20000,
    });
    view.render(el, S, api);
    assert(el.innerHTML.includes('camera-party'), `${game} delegates to the engine markup`);
    // One header row like every other game: the kit HUD, no extra scene line above it.
    assert(!el.querySelector('.sk-camhead') && (el.innerHTML.match(/class="cp-head gk-hud"/g) || []).length === 1, `${game} has one HUD row`);
    const cue = el.querySelector('.cp-sub');
    assert(cue.textContent.includes(game === 'pose-party' ? 'You are on' : 'Find it'), `${game} names the active job under the prompt`);
    view.render(el, { ...S, spectator: true }, api);
    assert(/Watch/.test(cue.textContent), `${game} names the watcher role`);
    assert(!cue.textContent.includes('You are on') && !cue.textContent.includes('Find it'), `${game} does not invite watchers to act`);
    view.render(el, { ...S, phase: 'vote', you: 'b', actor: 'a', candidates: ['a'] }, api);
    assert(cue.textContent.includes(game === 'pose-party' ? 'Judge Ada' : 'Judge 1 find'), `${game} names who to judge`);
    assert(!el.innerHTML.includes('getUserMedia') && !el.innerHTML.includes('<video'), `${game} captures no media`);
    RENDERED.push(el.innerHTML + cue.textContent);
    view.render(el, { ...S, phase: 'done' }, api);
    assert.equal(el.querySelector('.cp-head').hidden, true, `${game} final scores have no HUD row`);
    view.dispose(el);
    ok(`${game}: engine intact, one HUD row, role line, no new capture`);
  }

  /* ---------- 10. reaction-tap ---------- */
  {
    const view = await loadView('reaction-tap');
    const api = makeApi();
    const el = makeEl();
    view.render(el, base({ phase: 'wait', round: 1, rounds: 5, taps: {}, fouled: [], tip: 'Breathe.', strings: {} }), api);
    assert(el.querySelector('#rPad').className.includes('is-wait'), 'wait renders the red pad');
    assert(!el.querySelector('#rPad').className.includes('is-go'), 'no green before the server says go');
    collect(el);
    view.render(el, base({ phase: 'wait', round: 1, rounds: 5, taps: {}, fouled: ['a'], strings: {} }), api);
    assert(el.querySelector('#rPad').disabled, 'fouled players lock out');
    collect(el);
    view.render(el, base({ phase: 'go', round: 1, rounds: 5, taps: {}, fouled: [], strings: {} }), api);
    assert(el.querySelector('#rPad').className.includes('is-go'), 'go renders the green pad');
    assert.strictEqual(el.querySelector('#rStatus').innerHTML, '', 'zero taps and fouls have no separator');
    const pad = el.querySelector('#rPad');
    const press = pad.onpointerdown || pad.onmousedown;
    const beforeTap = api.sent.length;
    press({ button: 2, preventDefault() {} });
    assert.strictEqual(api.sent.length, beforeTap, 'secondary contact never taps');
    press({ button: 0, preventDefault() {} });
    assert.strictEqual(api.sent.length, beforeTap + 1, 'reaction sends on contact before release');
    assert.deepStrictEqual(api.sent.at(-1), { tap: true });
    pad.onclick({ detail: 1 });
    press({ button: 0, preventDefault() {} });
    assert.strictEqual(api.sent.length, beforeTap + 1, 'release/click/repeated contact cannot duplicate the tap');
    const keyboardEl = makeEl();
    view.render(keyboardEl, base({ phase: 'go', round: 1, rounds: 5, taps: {}, fouled: [], strings: {} }), api);
    keyboardEl.querySelector('#rPad').onclick({ detail: 0 });
    assert.strictEqual(api.sent.length, beforeTap + 2, 'native keyboard and assistive activation still taps');
    collect(el);
    view.render(el, base({ phase: 'go', round: 1, rounds: 5, taps: { a: 210 }, fouled: [], strings: {} }), api);
    assert(el.querySelector('#rPad').textContent.includes('210 ms'), 'locked taps show the time');
    assert.strictEqual(el.querySelector('#rStatus').innerHTML, '1 tapped in', 'tap-only status has no trailing separator');
    view.render(el, base({ phase: 'go', round: 1, rounds: 5, taps: {}, fouled: ['c'], strings: {} }), api);
    assert.strictEqual(el.querySelector('#rStatus').innerHTML, 'Fouled: Cy &lt;script&gt;', 'foul-only status escapes names without a leading separator');
    view.render(el, base({ phase: 'go', round: 1, rounds: 5, taps: { a: 210 }, fouled: ['c'], strings: {} }), api);
    assert.strictEqual(el.querySelector('#rStatus').innerHTML, '1 tapped in · Fouled: Cy &lt;script&gt;', 'nonempty mounted status parts get exactly one separator');
    view.render(el, base({ phase: 'wait', round: 1, rounds: 5, taps: { a: 210 }, fouled: ['c'], strings: {} }), api);
    assert.strictEqual(el.querySelector('#rStatus').innerHTML, 'Fouled: Cy &lt;script&gt;', 'wait retains foul status without advertising taps');
    collect(el);
    view.render(el, base({
      phase: 'roundEnd', round: 1, rounds: 5, strings: {},
      last: { order: [{ pid: 'a', ms: 210 }], fouled: ['b'] },
    }), api);
    assert(el.innerHTML.includes('210 ms'), 'results rank the taps');
    collect(el);
    view.render(el, base({ phase: 'done', scores: {}, wins: {}, strings: {} }), api);
    assert(el.innerHTML.includes('Final scores'), 'done shows standings');
    collect(el);
    view.dispose(el);
    ok('reaction-tap: server-driven stop/go, fouls, results, done');
  }

  /* ---------- 11. scattergories ---------- */
  {
    const view = await loadView('scattergories');
    const api = makeApi();
    const el = makeEl();
    const S = base({
      phase: 'write', round: 1, rounds: 3, letter: 'S', categories: ['Animals', 'Foods', 'Places', 'Movies', 'Songs'],
      mine: ['', '', '', '', ''], locked: [], myLocked: false, hostId: 'b',
    });
    view.render(el, S, api);
    assert(el.innerHTML.includes('sg-letter') && el.innerHTML.includes('>S<'), 'big letter leads the sheet');
    assert(el.innerHTML.includes('Animals') && el.innerHTML.includes('sc0'), 'checklist fields render');
    collect(el);
    view.render(el, { ...S, myLocked: true }, api);
    assert(el.innerHTML.includes('Locked in') && el.innerHTML.includes('disabled'), 'locked players cannot edit');
    collect(el);
    view.render(el, base({
      phase: 'reveal', round: 1, rounds: 3, hostId: 'a',
      last: {
        letter: 'S', categories: ['Animals'],
        answers: { a: ['Seal'], b: ['Seal'] }, unique: { a: [false], b: [false] }, points: { a: 0, b: 0 },
      },
    }), api);
    assert(el.innerHTML.includes('Seal'), 'reveal lists every answer');
    collect(el);
    view.render(el, base({ phase: 'done', rounds: 3, scores: { a: 120, b: 60 } }), api);
    assert(el.innerHTML.includes('aria-label="Scattergories final scores"') && el.innerHTML.includes('>Final scores</h2>'), 'done identifies the Scattergories final');
    assert(el.innerHTML.includes('class="gk-ranks"') && el.innerHTML.includes('>120 <small') && el.innerHTML.includes('>60 <small'), 'done shows exact match scores');
    assert(!el.innerHTML.includes('id="sc0"'), 'done removes the active answer composer');
    collect(el);
    view.dispose(el);
    ok('scattergories: big-letter sheet, lock, uniqueness reveal, done');
  }

  /* ---------- 12. twenty-questions ---------- */
  {
    const view = await loadView('twenty-questions');
    const api = makeApi();
    const el = makeEl();
    const play = base({
      phase: 'play', round: 1, rounds: 3, answerer: 'b', masked: '______',
      questions: [], wrong: [], scores: {}, order: ['a', 'b', 'c'], last: null,
      answered: 0, maxQ: 20, hints: false, hintsUsed: 0, hintCap: 2, hintCost: 50, hintAvailable: false,
    });
    view.render(el, { ...play, me: 'b', wordShown: 'Piano' }, api);
    assert(el._reg['#tqWord'].innerHTML.includes('Piano'), 'answerer sees the secret');
    assert(el.innerHTML.includes('tqYes'), 'answerer gets yes/no/sometimes');
    collect(el);
    const elG = makeEl();
    view.render(elG, play, api);
    assert(elG.innerHTML.includes('tQ') && elG.innerHTML.includes('tG'), 'guessers ask + guess');
    assert(!collect(elG).includes('Piano'), 'guessers never see the secret');
    assert(elG.innerHTML.includes('data-filter="yes"'), 'history filters persist');
    view.render(elG, { ...play, me: 'watch', spectator: true }, api);
    for (const id of ['#tQ', '#tQSend', '#tG', '#tGSend']) {
      assert(elG._reg[id].disabled, `watcher cannot use ${id} before shell protection`);
    }
    assert(elG._reg['#tqRole'].textContent.includes('Watching'), 'watcher follows the clue desk');
    view.render(elG, play, api);
    assert(!elG._reg['#tG'].disabled && !elG._reg['#tGSend'].disabled, 'active guess controls unlock after watcher role');
    view.render(el, { ...play, phase: 'reveal', word: 'Piano', last: { reason: 'guessed', winner: 'a', answered: 4 } }, api);
    assert(el._reg['#tqRWord'].innerHTML.includes('Piano'), 'reveal names the word');
    collect(el);
    view.render(el, { ...play, phase: 'done', scores: { a: 300 } }, api);
    assert(el.innerHTML.includes('Final scores'), 'done shows standings');
    collect(el);
    view.dispose(el);
    ok('twenty-questions: roles, private word, filters, reveal, done');
  }

  /* ---------- 13. typing-race ---------- */
  {
    const view = await loadView('typing-race');
    const api = makeApi();
    const el = makeEl();
    el._reg['#tInput'] = new FakeNode();
    el._reg['#tInput'].value = 'hi tX';
    view.render(el, base({
      phase: 'race', round: 1, rounds: 4, target: 'hi there', progress: { a: 2, b: 5 }, finished: [],
    }), api);
    assert(el.innerHTML.includes('tTarget') && el.innerHTML.includes('tInput'), 'sentence + input render');
    assert(el._reg['#tLanes'].innerHTML.includes('tr-lane'), 'racers ride lanes');
    assert(el._reg['#tLanes'].innerHTML.includes('tr-fill'), 'lane progress bars render');
    assert(el._reg['#tTarget'].innerHTML.includes('typing-correct'), 'correct characters highlight');
    assert(el._reg['#tTarget'].innerHTML.includes('typing-wrong'), 'errors underline as well as status text');
    assert(el._reg['#tTypingStatus'].textContent.includes('Fix character 5:'), 'status names the expected character');
    assert(!el.innerHTML.includes('class="bar"'), 'no generic bars — lanes only');
    collect(el);
    view.render(el, base({
      phase: 'roundEnd', round: 1, rounds: 4,
      last: { target: 'hi', finished: [{ pid: 'a', ms: 900, pts: 150 }], progress: { b: 1 } },
    }), api);
    assert(el.innerHTML.includes('0.90 s'), 'results show finish times');
    collect(el);
    view.render(el, base({ phase: 'done', scores: { a: 150 } }), api);
    assert(el.innerHTML.includes('Final scores'), 'done shows standings');
    collect(el);
    view.dispose(el);
    ok('typing-race: highlighted sentence, lane racers, results, done');
  }

  /* ---------- 14. warm-words ---------- */
  {
    const view = await loadView('warm-words');
    const api = makeApi();
    const el = new FakeNode();
    view.render(el, base({
      phase: 'guess', round: 1, rounds: 3, roundSeconds: 90, hintsEnabled: false,
      hintsUsed: 0, hintCost: 50, vocabularySize: 1507, scores: {},
      history: [{ word: 'car', rank: 12, similarity: 61.2, pid: 'a', hint: false }],
      best: { word: 'car', rank: 12, similarity: 61.2, pid: 'a' },
      last: null, results: [], startAt: NOW - 1000, endsAt: NOW + 80000,
      hostId: 'a', strings: {}, contentNote: '', myError: null,
    }), api);
    assert(el.innerHTML.includes('ww-meter') && el.innerHTML.includes('data-ww-mercury'), 'meaning meter renders');
    assert(el.innerHTML.includes('data-ww-input'), 'guess box renders');
    RENDERED.push(el.innerHTML);
    view.render(el, base({
      phase: 'reveal', round: 1, rounds: 3, endsAt: NOW + 4000, hostId: 'a',
      history: [], last: { target: 'apple', winner: 'a', points: 250 }, results: [],
    }), api);
    assert(el.innerHTML.includes('apple'), 'reveal names the word');
    RENDERED.push(el.innerHTML);
    view.render(el, base({
      phase: 'done', rounds: 3, scores: { a: 250 },
      results: [{ target: 'apple', winner: 'a' }],
    }), api);
    assert(el.innerHTML.includes('Final scores') && !el.innerHTML.includes('gk-hud-timer'), 'done shows scores, no timer');
    RENDERED.push(el.innerHTML);
    view.dispose(el);
    ok('warm-words: thermometer guess, reveal, timer-free done');
  }

  /* ---------- 15. word-chain ---------- */
  {
    const view = await loadView('word-chain');
    const api = makeApi();
    const el = makeEl();
    const S = base({
      phase: 'play', turnMs: 10000, rules: 'Link it.', alive: ['a', 'b', 'c'], out: [],
      turnIdx: 0, turnPid: 'a', turnNo: 3, current: 'apple', used: ['seed', 'apple'],
      author: 'c', challenges: {}, challenged: false, lastOut: null, winner: null,
      hostId: 'a', myFeedback: null, contentNote: '',
    });
    view.render(el, S, api);
    assert(el.innerHTML.includes('wc-ribbon') && el.innerHTML.includes('apple'), 'ribbon links the chain');
    assert(el.innerHTML.includes('wcWord') && el.innerHTML.includes('wcGo'), 'current player gets the word box');
    collect(el);
    view.render(el, { ...S, turnPid: 'b' }, api);
    assert(!el.innerHTML.includes('wcWord'), 'waiting players get no word box');
    assert(el._reg['#wcChallenge'].innerHTML.includes('Challenge'), 'room can challenge the word');
    collect(el);
    view.render(el, { ...S, turnPid: 'b', alive: ['b', 'c'], lastOut: { pid: 'a', reason: 'timeout' } }, api);
    assert(el._reg['#wcOut'].textContent.includes('ran out of time'), 'eliminations are narrated');
    collect(el);
    view.render(el, base({ phase: 'done', winner: 'b', used: ['seed', 'apple'] }), api);
    assert(el.innerHTML.includes('last player standing'), 'done crowns the survivor');
    collect(el);
    view.dispose(el);
    ok('word-chain: ribbon, turn box, challenge, outs, done');
  }

  /* ---------- contracts: payloads, privacy, lifecycle ---------- */
  const contracts = {
    charades: ['{ guess', '{ next'],
    chess: ['{ move', 'resign'],
    'countdown-word': ['{ word', 'lock', '{ pass', '{ finish', '{ next'],
    'doodle-guess': ['{ choose', '{ stroke', '{ clear', '{ guess', '{ next'],
    'draw-phone': ['{ phrase', '{ stroke', '{ guess', '{ next', '{ prev'],
    'memory-tray': ['{ recall', '{ next'],
    'number-hunt': ['{ guess'],
    'pose-party': ['renderCameraParty'],
    'reaction-tap': ['{ tap'],
    scattergories: ['{ answers', 'lock', '{ finish', '{ next'],
    'show-and-go': ['renderCameraParty'],
    'twenty-questions': ['{ question', '{ guess', '{ answer', '{ next'],
    'typing-race': ['{ typed'],
    'warm-words': ['{ guess', '{ hint', '{ next'],
    'word-chain': ['{ word', '{ challenge'],
  };
  const toolkitSrc = fs.readFileSync(path.join(ROOT, 'public/js/toolkit/camera-party.js'), 'utf8');
  assert(toolkitSrc.includes('instanceId'), 'camera engine keys local state by instanceId');
  const sceneStyles = {
    charades: ['charades.css', '.ch .ch-stage'],
    chess: ['chess-tabletop.css', '.ch-tabletop'],
    'countdown-word': ['countdown-word-world.css', '.cw .cw-tiles'],
    'doodle-guess': ['doodle-guess.css', '.sk-doodle.dg'],
    'draw-phone': ['draw-phone.css', '.sk-phone.dp'],
    'pose-party': ['camera-party.css', '.camera-party'],
    'show-and-go': ['camera-party.css', '.camera-party'],
    'number-hunt': ['number-hunt-world.css', '.nh .nh-range'],
    'memory-tray': ['memory-tray.css', '.mt .mt-tray'],
    'reaction-tap': ['compact-answer-games.css', '.rt .rt-pad'],
    'typing-race': ['compact-answer-games.css', '.tr .tr-lane'],
    scattergories: ['scattergories-world.css', '.sg .sg-letter'],
    'twenty-questions': ['twenty-questions.css', '.tq'],
    'warm-words': ['warm-words-world.css', '.ww'],
    'word-chain': ['word-chain-world.css', '.wc .wc-word'],
  };
  for (const [game, keys] of Object.entries(contracts)) {
    const src = fs.readFileSync(path.join(ROOT, 'public/js/games', `${game}.js`), 'utf8');
    for (const k of keys) assert(src.includes(k), `${game} keeps the ${k} contract`);
    assert(sceneStyles[game], `${game} has its own scoped stylesheet`);
    const [stylesheet, sceneScope] = sceneStyles[game];
    assert(src.includes(stylesheet), `${game} loads the scoped stylesheet`);
    if (sceneScope) assert(fs.readFileSync(path.join(ROOT, 'public/css', stylesheet), 'utf8').includes(sceneScope), `${game} stylesheet scopes its scene`);
    // Camera wrappers hold no per-instance cache; the engine owns instanceId.
    // Other views key stable DOM by the current instance.
    if (game !== 'pose-party' && game !== 'show-and-go') {
      assert(src.includes('instanceId'), `${game} keys caches by instanceId`);
    }
    assert(/dispose\s*\(/.test(src), `${game} implements dispose`);
    assert(!src.includes('getUserMedia') && !src.includes('getDisplayMedia'), `${game} adds no media capture`);
  }
  ok('all 15 keep server payloads, stylesheet, instanceId keys, dispose, no capture');

  // No camelCase taxonomy labels leak into any rendered player UI.
  const all = RENDERED.join('\n');
  for (const key of ['instanceId', 'turnMs', 'endsAt', 'myLocked', 'myFeedback', 'wordShown',
    'myRecall', 'turnPid', 'myStrokes', 'myDrawing', 'myVotes', 'clockStamp', 'checkSquare']) {
    assert(!all.includes(key), `player UI never shows ${key}`);
  }
  assert(!JSON.stringify(links).includes('vectors'), 'stylesheet registry stays clean');
  ok('no taxonomy labels leak into player UI');

  console.log(`SKILL SCENES PASS: ${n} checks across 15 games`);
})().catch((error) => { console.error(error); process.exit(1); });
