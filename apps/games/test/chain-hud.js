'use strict';
/* Focused Chain HUD test: tabletop turn/mark/help/result copy without a browser.
 * Uses the real renderer source + planner via the same small DOM double as
 * test/chain-reaction.js clientTests, plus static markup/CSS checks for the
 * frame cleanup. Run with: node test/chain-hud.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const game = require('../games/chain-reaction/server');

class Clock {
  constructor(n = 2, settings = {}) {
    this.roster = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i, connected: true }));
    this.values = settings; this.time = 1700000000000; this.timers = [];
  }
  now() { return this.time; }
  allPlayers() { return this.roster.slice(); }
  players() { return this.roster.filter((p) => p.connected); }
  settings() { return this.values; }
  award() {}
  broadcast() {}
  later(ms, fn) {
    const timer = { at: this.time + ms, fn, canceled: false }; this.timers.push(timer);
    return () => { timer.canceled = true; };
  }
}

function makeHarness() {
  const timeouts = new Map(), frames = new Map(), intervals = new Map();
  let nextId = 0, visualTime = 0;
  let reducedMotion = false;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.parentNode = null;
      this.dataset = {}; this.attrs = {}; this.className = ''; this.listeners = new Map();
      this.style = { setProperty() {} };
      this.getBoundingClientRect = () => ({ left: 0, top: 0, width: 44, height: 44, right: 44, bottom: 44 });
      this.classList = {
        contains: (c) => this.className.split(' ').includes(c),
        add: (c) => { if (!this.classList.contains(c)) this.className += ' ' + c; },
        remove: (c) => { this.className = this.className.split(' ').filter((x) => x !== c).join(' '); },
        toggle: (c, flag) => { if (flag) this.classList.add(c); else this.classList.remove(c); },
      };
    }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    append(...children) { children.forEach((c) => this.appendChild(c)); }
    replaceChildren(...children) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this.append(...children); }
    set innerHTML(s) {
      this.replaceChildren();
      for (const m of s.matchAll(/<([a-z0-9]+)[^>]*class="([^"]+)"[^>]*>/g)) {
        const node = new Element(m[1]); node.className = m[2]; this.appendChild(node);
      }
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    querySelector(s) {
      for (const c of this.children) {
        if (s[0] === '.' && c.classList.contains(s.slice(1))) return c;
        const found = c.querySelector(s); if (found) return found;
      }
      return null;
    }
    closest(s) { if (s === '[data-cell]' && this.dataset.cell !== undefined) return this; return this.parentNode?.closest(s) || null; }
    contains(c) { return c === this || this.children.some((n) => n.contains(c)); }
    addEventListener(event, fn) { const set = this.listeners.get(event) || new Set(); set.add(fn); this.listeners.set(event, set); }
    removeEventListener(event, fn) { this.listeners.get(event)?.delete(fn); }
    emit(event, target = this, extra = {}) {
      for (const fn of this.listeners.get(event) || []) fn({ target, preventDefault() {}, ...extra });
    }
    dispatchEvent(event) { this.emit(event.type, this, event); return true; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
    focus() {}
  }
  const document = new Element('document');
  document.head = new Element('head'); document.createElement = (tag) => new Element(tag); document.hidden = false;
  const motion = new Element('mediaquery');
  Object.defineProperty(motion, 'matches', { get: () => reducedMotion });
  const rendererSource = fs.readFileSync(path.join(__dirname, '../public/js/games/chain-reaction.js'), 'utf8');
  const plannerSource = fs.readFileSync(path.join(__dirname, '../public/js/engines/chain-visual.mjs'), 'utf8')
    .replace(/^export /gm, '');
  const source = rendererSource
    .replace(/import\s*{[^}]+}\s*from\s*'[^']*';/g, '')
    .replace(/export default view;/, 'globalThis.view = view;');
  const sandbox = {
    document, Date: { now: () => visualTime }, console,
    nameOf: (s, id) => s.players.find((p) => p.id === id)?.name || '???',
    countdown: (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000)),
    setInterval: (fn) => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn, ms) => { const id = ++nextId; timeouts.set(id, { fn, at: visualTime + ms }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    requestAnimationFrame: (fn) => { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    matchMedia: () => motion,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(plannerSource, sandbox);
  vm.runInContext(source, sandbox);
  const drain = () => {
    let guard = 0;
    while (timeouts.size) {
      assert(guard++ < 10000, 'replay timers must terminate');
      const [id, task] = [...timeouts].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      visualTime = Math.max(visualTime, task.at); timeouts.delete(id); task.fn();
    }
    for (const fn of [...frames.values()]) fn(16);
    frames.clear();
  };
  return { document, view: sandbox.view, drain, timeouts };
}

function snapFor(s, ctx, you, instanceId, spectator = false) {
  return { ...game.view(s, you), you, players: ctx.roster, instanceId, spectator };
}

function hudTests() {
  const { document, view, drain, timeouts } = makeHarness();
  const el = document.createElement('div');
  const ctx = new Clock(3);
  const s = game.create(ctx);
  const sent = [];
  const api = { now: () => ctx.now(), send: (a) => sent.push(a) };

  // My turn: compact actor + brief next action + stable mark hook.
  view.mount(el, api);
  view.update(el, snapFor(s, ctx, 'p0', 'hud-1'), api);
  assert.equal(el.querySelector('.cr-round').textContent, 'Turn 1');
  assert.equal(el.querySelector('.cr-turn').textContent, 'Your turn');
  assert.equal(el.querySelector('.cr-help').textContent, 'Place an atom on an empty or owned cell.');
  const mark = el.querySelector('.cr-turn-mark');
  assert(mark, 'actor mark hook exists');
  assert.equal(mark.hidden, false);
  assert(mark.children[0].className.includes('cr-orb'), 'actor mark reuses orb shape');
  assert(el.querySelector('.cr-clock'), 'clock hook stays anchored right');
  assert(el.querySelector('.cr-grid').children.some((c) => c.dataset.playable === 'yes'), 'my turn keeps playable cells');

  // Pending: one intent, readable wait, no duplicate suggestion.
  const grid = el.querySelector('.cr-grid');
  grid.emit('click', grid.children[0]);
  assert.equal(sent.length, 1);
  assert.equal(el.querySelector('.cr-turn').textContent, 'Atom placed', 'pending feedback remains above the phone board');
  assert.equal(el.querySelector('.cr-help').textContent, 'Placed. Waiting for the room…');
  grid.emit('click', grid.children[1]);
  assert.equal(sent.length, 1, 'pending turn sends no duplicate');
  assert(!grid.children.some((c) => c.dataset.playable === 'yes'), 'pending cells lose playable styling');

  // Other turn: possessive actor, plan cue.
  game.onAction(s, ctx, 'p0', sent[0]);
  view.update(el, snapFor(s, ctx, 'p0', 'hud-1'), api);
  drain();
  assert.equal(el.querySelector('.cr-turn').textContent, 'Player 1’s turn');
  assert.equal(el.querySelector('.cr-help').textContent, 'Plan your next burst.', 'other turn plans briefly without repeating the actor name');

  // Watcher: honest Watching cue, never Your turn, never playable.
  const watchSnap = snapFor(s, ctx, 'watcher', 'hud-1', true);
  watchSnap.mySeat = -1;
  view.update(el, watchSnap, api);
  assert(el.querySelector('.cr-turn').textContent.startsWith('Watching ·'), 'watchers read Watching');
  assert(!el.querySelector('.cr-turn').textContent.includes('Your turn'), 'watchers never get Your turn');
  assert.equal(el.querySelector('.cr-help').textContent, 'Only seated players place atoms.', 'watcher help explains who can act');
  assert(!el.querySelector('.cr-grid').children.some((c) => c.dataset.playable === 'yes'), 'watchers never get playable styling');

  // Out: eliminated seat reads You're out, never Your turn, never playable.
  const octx = new Clock(3);
  const o = game.create(octx);
  const mv = (x, y) => game.onAction(o, octx, o.turnPid, { x, y, turnNo: o.turnNo });
  mv(0, 0); mv(1, 0); mv(4, 5); mv(0, 0);
  assert(o.eliminated.includes('p1'), 'fixture eliminates p1 during play');
  assert.equal(o.phase, 'play');
  view.update(el, snapFor(o, octx, 'p1', 'hud-out'), api);
  drain();
  assert(el.querySelector('.cr-turn').textContent.startsWith('You’re out ·'), 'eliminated reads You’re out');
  assert(!el.querySelector('.cr-turn').textContent.includes('Your turn'), 'eliminated never gets Your turn');
  assert(!el.querySelector('.cr-grid').children.some((c) => c.dataset.playable === 'yes'), 'eliminated never gets playable styling');
  const outSeat = view && el.querySelector('.cr-seats').children[1];
  assert(outSeat.attrs['aria-label'].includes('Player 1'), 'roster keeps stable names');

  // Motion: actor mark/color stays on the setter, not the next turn.
  const wctx = new Clock(2);
  const w = game.create(wctx);
  w.board[0] = { owner: 'p0', orbs: 1 }; w.board[1] = { owner: 'p1', orbs: 1 };
  w.entered.p0 = w.entered.p1 = true;
  view.update(el, snapFor(w, wctx, 'p0', 'hud-win'), api);
  game.onAction(w, wctx, 'p0', { x: 0, y: 0, turnNo: w.turnNo });
  assert.equal(w.phase, 'done');
  view.update(el, snapFor(w, wctx, 'p0', 'hud-win'), api);
  assert(timeouts.size > 0, 'winning burst replays before result');
  assert.equal(el.querySelector('.cr-round').textContent, 'Atoms in motion');
  assert.equal(el.querySelector('.cr-clock').hidden, true, 'a cascade does not present the next player clock as its own');
  assert(el.querySelector('.cr-turn').textContent.includes('set it off!'), 'motion names the setter');
  assert.equal(el.querySelector('.cr-turn-mark').hidden, false, 'motion keeps the setter mark, not next turn');
  assert.equal(el.querySelector('.cr-result').hidden, true, 'fallback result waits for settle');
  drain();
  assert(el.querySelector('.cr-turn').textContent.includes('wins'), 'winner shows after settle');
  assert.equal(el.querySelector('.cr-note').textContent, 'Settled.', 'no points callout in renderer note');
  assert(!el.querySelector('.cr-note').textContent.includes('100 session points'), 'renderer owns no night totals');
  assert.equal(el.querySelector('.cr-result').hidden, false, 'fallback result makes sense outside frame');

  view.dispose(el);
  game.dispose(s); game.dispose(o); game.dispose(w);
  console.log('CHAIN hud: Your turn / Watching / You’re out / pending / motion mark / winner fallback verified');
}

function frameStaticTests() {
  const html = fs.readFileSync(path.join(__dirname, '../games/chain-reaction/browser/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../games/chain-reaction/browser/play.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../public/js/games/chain-reaction.js'), 'utf8');
  assert(!html.includes('lab-head'), 'frame drops the duplicated masthead markup');
  assert(!html.includes('connPill'), 'frame drops the Live pill markup');
  assert(!html.includes('voiceBtn') && !html.includes('voiceLine'), 'frame drops voice markup; platform owns voice');
  assert(!html.includes('lab-foot'), 'frame drops the repetitive footer');
  assert(html.includes('visually-hidden'), 'frame keeps an accessible game name');
  assert(html.includes('id="statusLine"') && html.includes('id="openFrom"'), 'loading/error/standalone routing stays honest');
  assert(html.includes('id="result"') && html.includes('id="rematchBtn"') && html.includes('id="lobbyBtn"'), 'result + rematch/change stay reachable');
  assert(renderer.includes('grid-template-columns:128px minmax(0,1fr)'), 'short landscape places the compact HUD beside the full field');
  assert(!css.includes('padding: 72px') && !css.includes('padding:140px'), 'no oversized top clearance remains');
  // The frame now wears the room's tokens (Day, Night, Inside Giggle).
  assert(css.includes('--lab-bg: var(--bg)') && css.includes('background: var(--lab-bg)'), 'frame is full-bleed on the room background token');
  const play = fs.readFileSync(path.join(__dirname, '../games/chain-reaction/browser/play.js'), 'utf8');
  assert(play.includes('function mirrorTheme') && play.includes("'--accent'"), 'frame mirrors the parent page colour tokens');
  assert(css.includes('scroll-margin-top: max(64px, calc(52px + env(safe-area-inset-top, 0px)))'), 'winner scroll margin clears the notch and launcher');
  assert(css.includes('100dvh'), 'dynamic viewport height preserved');
  assert(css.includes('safe-area-inset'), 'safe-area padding preserved');
  assert(css.includes('.winner-mark'), 'winner atom mark styled');
  assert(css.includes('--font-display') && css.includes('Baloo 2'), 'frame uses the shared display and body fonts');
  assert(!css.includes('touch-action:none') && !css.includes('touch-action: none'), 'never board/page touch-action:none');
  const overflowHidden = (css.match(/overflow\s*:\s*hidden/g) || []).length;
  assert.equal(overflowHidden, 2, 'only screen-reader text and the bounded winner name clip, never board/page');
  assert(renderer.includes('.cr-turn-mark'), 'renderer ships the actor mark hook');
  assert(renderer.includes('Placed. Waiting for the room'), 'pending feedback readable');
  assert(!renderer.includes('100 session points'), 'renderer owns no points callout');
  assert(renderer.includes('minmax(44px,1fr)'), 'cells stay >=44px');
  assert(!renderer.includes('minmax(288px,300px)'), 'capped side-column layout is gone');
  assert(!renderer.includes('4px 5px 0 var(--cr-ink)'), 'rectangular card drop-shadow is gone');
  assert(renderer.includes('cr-arena'), 'canvas arena hook ships');
  assert(renderer.includes('data-transpose'), 'short-landscape visual transpose hook ships');
  assert(renderer.includes('#71edd1') && renderer.includes('#ff718f'), 'arena coral/teal ownership hues ship');
  console.log('CHAIN hud frame: markup cleanup, launcher gutter, arena skin, winner mark, touch/scroll guards verified');
}

hudTests();
frameStaticTests();
console.log('CHAIN_HUD_PASS');
