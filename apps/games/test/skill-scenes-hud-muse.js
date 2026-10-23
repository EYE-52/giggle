'use strict';
/* HUD-polish regressions for the 15 Muse-owned skill games: each game renders
 * its own phase/turn/actor/round/goal instrument (no uniform round strip),
 * active/reveal/done/watcher states stay distinct, and no duplicate clocks or
 * timers appear. Complements test/skill-scenes.js (contracts) and
 * test/skill-scenes-touch-muse.js (touch/keyboard) without weakening either.
 * Run: node test/skill-scenes-hud-muse.js */

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

/* ---- minimal DOM stubs (same shape as test/skill-scenes.js) ---- */

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
  querySelector(sel) {
    if (sel === '.sk-camhead') {
      return this.children.find((c) => c.className && c.className.split(' ').includes('sk-camhead')) || null;
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      const found = this.children.find((c) => c.className && c.className.split(' ').includes(cls));
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
  global.document = {
    body: { classList: { contains: () => false } },
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: (tag) => new FakeNode(tag),
  };
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
    instanceId: 'hud1', me: 'a', players: PLAYERS, scores: {}, spectator: false, endsAt: 0, ...over,
  };
}

function paint(view, el, S, api) {
  (view.update || view.render).call(view, el, S, api);
}

(async () => {
  installDocument();
  let n = 0;
  const ok = (msg) => { n += 1; console.log(`ok ${n} - ${msg}`); };

  /* ---------- instruments exist in the stylesheets ---------- */
  const tqCss = fs.readFileSync(path.join(ROOT, 'public/css/twenty-questions.css'), 'utf8');
  assert(tqCss.includes('tq-budget'), 'twenty-questions.css styles the question budget');
  assert(fs.readFileSync(path.join(ROOT, 'public/js/games/warm-words.js'), 'utf8').includes('ww-rules'),
    'warm-words carries its own Rules disclosure styles');
  ok('twenty-questions and warm-words instruments are styled');

  /* ---------- no uniform round strip remains in any game client ---------- */
  for (const game of ['charades', 'chess', 'countdown-word', 'doodle-guess', 'draw-phone',
    'memory-tray', 'number-hunt', 'pose-party', 'reaction-tap', 'scattergories',
    'show-and-go', 'twenty-questions', 'typing-race', 'warm-words', 'word-chain']) {
    const src = fs.readFileSync(path.join(ROOT, 'public/js/games', `${game}.js`), 'utf8');
    assert(!src.includes('sk-roundline'), `${game} renders no uniform round strip`);
  }
  ok('all 15 game clients dropped the shared round-strip markup');

  /* ---------- 1. charades: cue placard names turn + actor ---------- */
  {
    const view = await loadView('charades');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({ phase: 'act', round: 2, rounds: 3, actor: 'b', masked: '____', guesses: [], guessed: {} }), api);
    // Word and speed games share the game kit HUD row (public/js/kit.js).
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Turn 2 of 3'), 'HUD names the turn');
    assert(el.innerHTML.includes('Ben acts') && el.innerHTML.includes('Your guess'), 'HUD names the actor; the guesser gets the field');
    paint(view, el, base({ phase: 'act', round: 2, rounds: 3, actor: 'a', wordShown: 'Dragonfruit', masked: '__________', guesses: [], guessed: {} }), api);
    assert(el.innerHTML.includes('You act'), 'actor cue claims the stage');
    paint(view, el, base({ phase: 'act', round: 2, rounds: 3, actor: 'b', masked: '____', guesses: [], guessed: {}, spectator: true }), api);
    assert(el.innerHTML.includes('Watching'), 'watcher cue stays honest');
    paint(view, el, base({ phase: 'reveal', round: 2, rounds: 3, actor: 'b', word: 'Kiwi', guessed: {}, endReason: '' }), api);
    assert(el.innerHTML.includes('The word'), 'reveal HUD labels the phase');
    view.dispose(el);
    ok('charades: turn/actor/watcher/reveal in the kit HUD');
  }

  /* ---------- 2. chess: opposing clocks, turn edge, collapsible moves ---------- */
  {
    const view = await loadView('chess');
    const api = makeApi();
    const el = makeEl();
    view.mount(el, api);
    const S = base({
      phase: 'play', white: 'a', black: 'b', youAre: 'w', turn: 'w', check: false, checkSquare: null,
      board: [], legal: {}, history: ['e4', 'e5'], lastMove: null, result: null,
      clocks: { w: 60000, b: 59000 }, clockStamp: NOW, boardTheme: 'Mono',
    });
    paint(view, el, S, api);
    const html = el._reg['#chess-root'].innerHTML;
    assert(html.includes('bk-players'), 'opposing clock pods render (shared board panel)');
    assert(html.includes('ch-clock-w') && html.includes('ch-clock-b'), 'both clocks keep their ids');
    assert(html.includes('tomove-w'), 'board edge answers white to move');
    assert(html.includes('chhist-wrap') && html.includes('Moves'), 'move history collapses naturally');
    assert(!html.includes('Round '), 'continuous chess shows no round strip');
    paint(view, el, { ...S, turn: 'b' }, api);
    assert(el._reg['#chess-root'].innerHTML.includes('tomove-b'), 'board edge follows black to move');
    view.dispose(el);
    ok('chess: clock pair, turn edge, collapsible moves, no round strip');
  }

  /* ---------- 3. countdown: deskline + longest-word goal + Rules ---------- */
  {
    const view = await loadView('countdown-word');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({
      phase: 'make', round: 1, rounds: 4, letters: ['C', 'H', 'O', 'C', 'O', 'L', 'A', 'T', 'E'],
      mine: '', locked: [], myLocked: false, myFeedback: null, hostId: 'b', contentNote: '',
    }), api);
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Round 1 of 4'), 'HUD names the round');
    assert(el.innerHTML.includes('Make the longest word'), 'concise longest-word objective');
    assert(el.innerHTML.includes('cw-rules') && el.innerHTML.includes('<summary>Rules</summary>'), 'explanations sit behind Rules');
    assert(el.innerHTML.includes('data-tile'), 'tile rack stays tappable');
    view.dispose(el);
    ok('countdown: slim round cue, longest-word goal, Rules disclosure');
  }

  /* ---------- 4. doodle: desk cue + tool rail on the easel ---------- */
  {
    const view = await loadView('doodle-guess');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({
      phase: 'draw', round: 1, rounds: 4, drawer: 'a', wordShown: 'robot', masked: '',
      strokes: [], guessed: {}, hints: true,
    }), api);
    assert(el.innerHTML.includes('sk-deskcue'), 'desk cue renders');
    assert(el.innerHTML.includes('Drawing'), 'desk cue names the phase');
    assert(el.innerHTML.includes('sk-toolrail'), 'tool rail aligns to the canvas desk');
    assert(el.innerHTML.includes('dCanvas'), 'canvas keeps its id');
    paint(view, el, base({
      phase: 'draw', round: 1, rounds: 4, drawer: 'b', masked: 'R___T', strokes: [], guessed: {}, hints: true,
    }), api);
    assert(!el.innerHTML.includes('robot'), 'guesser desk never leaks the word');
    paint(view, el, base({ phase: 'reveal', round: 1, rounds: 4, drawer: 'b', word: 'robot', strokes: [], guessed: {} }), api);
    assert(el.innerHTML.includes('Reveal'), 'reveal cue labels the phase');
    view.dispose(el);
    ok('doodle: desk cue, canvas-aligned tool rail, role-safe phases');
  }

  /* ---------- 5. draw-phone: numbered pages + draw desk ---------- */
  {
    const view = await loadView('draw-phone');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({ phase: 'write', myPhrase: '', submitted: [], suggestions: ['A cat'] }), api);
    assert(el.innerHTML.includes('sk-steps'), 'page progress renders');
    assert(el.innerHTML.includes('sk-step-n'), 'pages carry positions');
    assert(el.innerHTML.includes('Notebook pages'), 'sequence reads as a notebook');
    paint(view, el, base({ phase: 'draw', myPrompt: 'A cat', myStrokes: [], drawn: [] }), api);
    assert(el.innerHTML.includes('sk-drawdesk'), 'toolbar lives within the drawing desk');
    assert(el.innerHTML.includes('pCanvas'), 'draw canvas keeps its id');
    paint(view, el, base({ phase: 'guess', myDrawing: [], myGuess: '', guessed: [] }), api);
    assert(el.innerHTML.includes('pGuess'), 'caption box renders');
    const chains = [{ origin: 'a', phrase: 'hi', drawBy: 'b', strokes: [], guessBy: 'c', guess: 'yo' }];
    paint(view, el, base({ phase: 'reveal', chains, revealIdx: 0, hostId: 'a' }), api);
    assert(el.innerHTML.includes('Story 1 of 1'), 'story paging context remains');
    view.dispose(el);
    ok('draw-phone: numbered handoff pages, desked toolbar, story paging');
  }

  /* ---------- 6. memory-tray: study/recall cue on the shelf ---------- */
  {
    const view = await loadView('memory-tray');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({ phase: 'memorize', round: 1, rounds: 3, memMs: 12000, items: ['apple', 'zebra'] }), api);
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Study') && el.innerHTML.includes('2 items'), 'study HUD carries the tray size');
    paint(view, el, base({ phase: 'recall', round: 1, rounds: 3, submitted: [], myRecall: null }), api);
    assert(el.innerHTML.includes('Recall') && el.innerHTML.includes('What was on the tray?'), 'recall phase is explicit');
    assert(el.innerHTML.includes('mAns'), 'recall box renders');
    assert(!el.innerHTML.includes('zebra'), 'covered tray leaks nothing');
    paint(view, el, base({
      phase: 'reveal', round: 1, rounds: 3, hostId: 'a',
      last: { items: ['apple'], results: { a: { correct: ['apple'], count: 1, pts: 50 } } },
    }), api);
    assert(el.innerHTML.includes('The tray held'), 'results read as the tray coming back');
    view.dispose(el);
    ok('memory-tray: study goal, covered recall, returned-tray results');
  }

  /* ---------- 7. number-hunt: ruler header over the dial ---------- */
  {
    const view = await loadView('number-hunt');
    const api = makeApi();
    const el = makeEl();
    const S = base({
      phase: 'hunt', round: 1, rounds: 5, guesses: {}, history: [], finished: [], scores: {}, wins: {}, strings: {},
    });
    paint(view, el, S, api);
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Round 1 of 5') && el._reg['#nSub'].textContent.includes('1 to 100'), 'HUD round + prompt range');
    assert(!el.innerHTML.includes('Hunt the number'), 'no duplicate number title');
    assert(el.innerHTML.includes('nWin') && el.innerHTML.includes('nGuess'), 'dial window + input keep their ids');
    paint(view, el, { ...S, phase: 'overtime' }, api);
    assert.strictEqual(el._reg['.gk-hud-phase'].textContent, 'Overtime', 'overtime flag stays authoritative');
    view.dispose(el);
    ok('number-hunt: kit HUD, live range, no duplicate title');
  }

  /* ---------- 8. pose-party: compact performer/judge cue ---------- */
  {
    const view = await loadView('pose-party', 'camera-party');
    const api = makeApi();
    const S = base({
      phase: 'perform', round: 2, rounds: 4, mode: 'spotlight', prompt: 'Do the thing',
      actor: 'b', you: 'a', candidates: ['b'], ready: {}, votes: {}, myVotes: {},
      scores: {}, hostId: 'a', endsAt: NOW + 20000,
    });
    const el = new FakeNode();
    paint(view, el, S, api);
    assert(!el.querySelector('.sk-camhead'), 'no extra header line above the kit HUD');
    assert(el.querySelector('.cp-sub').textContent.includes('Ben is performing'), 'the line under the prompt names the performer');
    assert(el.innerHTML.includes('camera-party'), 'engine markup stays delegated');
    view.dispose(el);
    ok('pose-party: engine intact, one HUD row, performer cue');
  }

  /* ---------- 9. reaction: signal lamps + round cue ---------- */
  {
    const view = await loadView('reaction-tap');
    const api = makeApi();
    const oldDocument = global.document;
    const { makeDocument, surface } = require('./party-mobile');
    const doc = makeDocument();
    global.document = doc;
    const el = surface(doc);
    paint(view, el, base({ phase: 'wait', round: 1, rounds: 5, taps: {}, fouled: [], tip: 'Breathe.', strings: {} }), api);
    assert(el.querySelector('.gk-hud'), 'kit HUD renders');
    assert(el.querySelector('#rPad').className.includes('is-wait'), 'wait shows the neutral pad');
    assert(el.querySelector('.gk-hud-round').textContent.includes('Round 1 of 5') && /wait for green/i.test(el.querySelector('#rPad').textContent), 'HUD names round; pad says wait');
    const pad = el.querySelector('#rPad');
    paint(view, el, base({ phase: 'go', preparing: true, round: 1, rounds: 5, taps: {}, fouled: [], strings: {} }), api);
    assert(el.querySelector('#rPad') === pad, 'phase updates retain the native focused button');
    assert(pad.disabled && !pad.className.includes('is-go'), 'preparation never exposes green or playable input');
    paint(view, el, base({ phase: 'wait', round: 1, rounds: 5, taps: {}, fouled: ['a'], strings: {} }), api);
    assert(/fouled out/i.test(el.querySelector('#rPad').textContent), 'fouled cue is explicit');
    paint(view, el, base({ phase: 'go', round: 1, rounds: 5, taps: {}, fouled: [], strings: {} }), api);
    assert(el.querySelector('#rPad').className.includes('is-go'), 'go turns the pad green');
    assert(/TAP NOW/.test(el.querySelector('#rPad').textContent) && el.querySelector('.gk-hud-phase').textContent === 'Go!', 'cue calls the start');
    paint(view, el, base({ phase: 'go', round: 1, rounds: 5, taps: { a: 210 }, fouled: [], strings: {} }), api);
    assert(el.querySelector('#rPad').textContent.includes('210 ms') && el.querySelector('.gk-hud-phase').textContent === 'Locked in', 'locked cue shows the time');
    paint(view, el, base({ phase: 'go', round: 1, rounds: 5, taps: {}, fouled: [], spectator: true, strings: {} }), api);
    assert(/watching/i.test(el.querySelector('.gk-hud-phase').textContent) && el.querySelector('#rPad').disabled, 'watch cue stays honest and cannot tap');
    view.dispose(el);
    global.document = oldDocument;
    ok('reaction: pad follows the server phase; fouled/locked/watch cues');
  }

  /* ---------- 10. scattergories: notepad head + Rules ---------- */
  {
    const view = await loadView('scattergories');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({
      phase: 'write', round: 1, rounds: 3, letter: 'S', categories: ['Animals', 'Foods', 'Places', 'Movies', 'Songs'],
      mine: ['', '', '', '', ''], locked: ['b'], myLocked: false, hostId: 'b',
    }), api);
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Round 1 of 3'), 'HUD names the round');
    assert(el.innerHTML.includes('sc-rules') && el.innerHTML.includes('<summary>Rules</summary>'), 'scoring help sits behind Rules');
    assert(el.innerHTML.includes('sc0'), 'compose fields keep their ids');
    paint(view, el, base({
      phase: 'reveal', round: 1, rounds: 3, hostId: 'a',
      last: { letter: 'S', categories: ['Animals'], answers: { a: ['Seal'] }, unique: { a: [true] }, points: { a: 100 } },
    }), api);
    assert(el.innerHTML.includes('Unique'), 'reveal keeps uniqueness clear');
    view.dispose(el);
    ok('scattergories: round/letter head, lock cue, Rules, uniqueness');
  }

  /* ---------- 11. show-and-go: compact hunt cue ---------- */
  {
    const view = await loadView('show-and-go', 'camera-party');
    const api = makeApi();
    const el = new FakeNode();
    paint(view, el, base({
      phase: 'perform', round: 1, rounds: 4, mode: 'gallery', prompt: 'Find something blue',
      you: 'a', candidates: [], ready: {}, votes: {}, myVotes: {}, scores: {}, hostId: 'a', endsAt: NOW + 20000,
    }), api);
    assert(!el.querySelector('.sk-camhead'), 'no extra header line above the kit HUD');
    assert(el.querySelector('.cp-sub').textContent.includes('Find it'), 'the line under the prompt names the job');
    assert(el.innerHTML.includes('camera-party'), 'engine markup stays delegated');
    view.dispose(el);
    ok('show-and-go: engine intact, one HUD row, job cue');
  }

  /* ---------- 12. twenty-questions: budget instrument + role desks ---------- */
  {
    const view = await loadView('twenty-questions');
    const api = makeApi();
    const el = makeEl();
    const play = base({
      phase: 'play', round: 1, rounds: 3, answerer: 'b', masked: '______',
      questions: [], wrong: [], scores: {}, answered: 3, maxQ: 20,
      hints: false, hintsUsed: 0, hintCap: 2, hintCost: 50, hintAvailable: false,
    });
    paint(view, el, { ...play, me: 'b', wordShown: 'Piano' }, api);
    assert(el.innerHTML.includes('tqBudgetFill'), 'budget meter renders');
    assert(el._reg['#tqBudgetFill'].style.width === '15%', 'meter tracks answered of max');
    assert(el.innerHTML.includes('Round 1 of 3') && el._reg['#tqBadge'].textContent.includes('3 of 20'),
      'HUD carries the round and the question budget');
    assert(el._reg['#tqWord'].innerHTML.includes('Piano'), 'answerer keeps the secret');
    const elG = makeEl();
    paint(view, elG, play, api);
    let seen = elG.innerHTML;
    for (const node of Object.values(elG._reg)) seen += '\n' + node.innerHTML + '\n' + node.textContent;
    assert(!seen.includes('Piano'), 'guesser desk never leaks the secret');
    view.dispose(el);
    ok('twenty-questions: budget meter, badge, role-safe desks');
  }

  /* ---------- 13. typing-race: grid strip, single live count ---------- */
  {
    const view = await loadView('typing-race');
    const api = makeApi();
    const el = makeEl();
    el._reg['#tInput'] = new FakeNode();
    el._reg['#tInput'].value = '';
    paint(view, el, base({
      phase: 'race', round: 1, rounds: 4, target: 'hi there', progress: { a: 0, b: 5 }, finished: [],
    }), api);
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Round 1 of 4'), 'HUD names the round');
    assert(el._reg['.gk-hud-progress'].textContent.includes('0 of 8 typed'), 'HUD carries the live count');
    assert(el._reg['#tTypingStatus'].textContent === '', 'no duplicate progress box when clean');
    el._reg['#tInput'].value = 'hi tX';
    paint(view, el, base({
      phase: 'race', round: 1, rounds: 4, target: 'hi there', progress: { a: 0 }, finished: [],
    }), api);
    assert(el._reg['#tTypingStatus'].textContent.includes('Fix character 5:'), 'mistake guidance stays exact');
    assert(el._reg['#tLanes'].innerHTML.includes('tr-fill'), 'lanes keep moving');
    view.dispose(el);
    ok('typing-race: kit HUD, one live count, exact mistake cue');
  }

  /* ---------- 14. warm-words: thermometer, one clock, Rules ---------- */
  {
    const view = await loadView('warm-words');
    const api = makeApi();
    const el = new FakeNode();
    paint(view, el, base({
      phase: 'guess', round: 1, rounds: 3, hintsEnabled: false,
      hintsUsed: 0, hintCost: 50, vocabularySize: 1507, scores: {},
      history: [], best: null, startAt: NOW - 1000, endsAt: NOW + 80000,
      hostId: 'a', strings: {}, contentNote: '', myError: null,
    }), api);
    assert(el.innerHTML.includes('ww-meter'), 'meaning meter stays the instrument');
    assert(el.innerHTML.includes('Round 1 of 3'), 'concise round cue');
    assert(el.innerHTML.includes('ww-rules'), 'semantic help sits behind Rules');
    assert.strictEqual((el.innerHTML.match(/gk-hud-timer/g) || []).length, 1, 'exactly one calibrated clock');
    paint(view, el, base({
      phase: 'done', rounds: 3, scores: { a: 250 }, results: [{ target: 'apple', winner: 'a' }],
    }), api);
    assert(!el.innerHTML.includes('gk-hud-timer'), 'done shows no clock');
    view.dispose(el);
    ok('warm-words: meaning meter, concise round, single clock, Rules');
  }

  /* ---------- 15. word-chain: tabletop turn ribbon, no timer ---------- */
  {
    const view = await loadView('word-chain');
    const api = makeApi();
    const el = makeEl();
    paint(view, el, base({
      phase: 'play', turnMs: 10000, rules: 'Link it.', alive: ['a', 'b', 'c'],
      turnPid: 'a', turnNo: 3, current: 'apple', used: ['seed', 'apple'],
      author: 'c', challenges: {}, challenged: false, lastOut: null, winner: null,
      hostId: 'a', myFeedback: null, contentNote: '',
    }), api);
    assert(el.innerHTML.includes('class="gk-hud"'), 'kit HUD renders');
    assert(el.innerHTML.includes('Your turn'), 'HUD names the turn');
    assert(el.innerHTML.includes('wc-ribbon'), 'linked chain renders');
    assert.strictEqual(view.ownsTimer, true, 'the turn clock lives in the HUD timer slot, not a second bar');
    assert.strictEqual((el.innerHTML.match(/gk-hud-timer/g) || []).length, 1, 'exactly one turn clock');
    view.dispose(el);
    ok('word-chain: kit HUD turn clock, chain, single clock');
  }

  /* ---------- clock uniqueness: pairs stay pairs, singles stay single ---------- */
  {
    const chessSrc = fs.readFileSync(path.join(ROOT, 'public/js/games/chess.js'), 'utf8');
    assert(chessSrc.includes('ch-clock-w') && chessSrc.includes('ch-clock-b'), 'chess keeps its opposing pair');
    for (const game of ['charades', 'countdown-word', 'doodle-guess', 'draw-phone', 'memory-tray',
      'number-hunt', 'reaction-tap', 'scattergories', 'twenty-questions', 'typing-race', 'word-chain']) {
      const src = fs.readFileSync(path.join(ROOT, 'public/js/games', `${game}.js`), 'utf8');
      assert(!src.includes('ch-clock') && !src.includes('data-ww-clock') && !src.includes('cp-clock'),
        `${game} adds no duplicate clock`);
      if (game === 'doodle-guess') {
        const view = await loadView(game), el = makeEl();
        assert.strictEqual(view.ownsTimer, true, 'Doodle owns its single clock so the framework suppresses its timer');
        paint(view, el, base({ phase: 'draw', round: 1, rounds: 4, drawer: 'a', wordShown: 'robot', strokes: [], guessed: {}, endsAt: NOW + 1000 }), makeApi());
        assert.strictEqual((el.innerHTML.match(/id="dClock"/g) || []).length, 1, 'Doodle renders exactly one clock');
        view.dispose(el);
      } else if (src.includes("from '../kit.js'")) {
        // Kit games draw the one clock in the HUD timer slot (ownsTimer), so
        // the shell's timer row is given up; the loop only paints that slot.
        assert(/ownsTimer:\s*true/.test(src) && (src.match(/gk-hud-timer/g) || []).length === 1, `${game} owns exactly one HUD clock`);
      } else assert(!src.includes('setInterval('), `${game} runs no timer loop`);
    }
    for (const game of ['pose-party', 'show-and-go']) {
      const src = fs.readFileSync(path.join(ROOT, 'public/js/games', `${game}.js`), 'utf8');
      assert(!src.includes('cp-clock') && !src.includes('setInterval('), `${game} leaves the engine clock alone`);
    }
    ok('clocks: chess pair, Doodle and warm-words singles, engine-owned camera clocks, none elsewhere');
  }

  console.log(`HUD MUSE PASS: ${n} checks across 15 games`);
})().catch((error) => { console.error(error); process.exit(1); });
