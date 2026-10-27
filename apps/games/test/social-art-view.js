'use strict';
/* Social art view checks: Would You Rather, Never Ever, Most Likely To.
 * Focused runnable client verification for the three scoped scenes:
 * escaped arbitrary text, 20 people/full names, missing-imagery
 * independence, private ballots, unchanged actions, scoped world CSS.
 * Real server modules + production clients into a minimal DOM stub.
 * Geometry at real viewports stays in test/social-art-browser.js.
 * Run: node test/social-art-view.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../games/registry');
const ROOT = path.resolve(__dirname, '..');
const dataModule = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
const utilUrl = dataModule(fs.readFileSync(path.join(ROOT, 'public/js/util.js'), 'utf8'));

/* ---- Minimal DOM stub (party-client surface) ---- */
const VOID = new Set(['input', 'br', 'hr', 'img', 'link', 'meta']);
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m] || m);
function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  return attrs;
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function makeNode(doc, tag, attrs, parent) {
  const el = {
    nodeType: 1, doc, tagName: String(tag).toUpperCase(), attrs: { ...attrs },
    children: [], parentNode: parent || null, _raw: '',
    onclick: null, onkeydown: null,
    value: attrs.value !== undefined ? attrs.value : '',
    checked: attrs.checked !== undefined,
    selectionStart: 0, selectionEnd: 0,
  };
  Object.defineProperties(el, {
    id: { get() { return el.attrs.id || ''; }, set(v) { el.attrs.id = String(v); } },
    type: { get() { return el.attrs.type || (el.tagName === 'INPUT' ? 'text' : ''); } },
    name: { get() { return el.attrs.name || ''; } },
    disabled: { get() { return el.attrs.disabled !== undefined; } },
    className: {
      get() { return el.attrs.class || ''; },
      set(v) { el.attrs.class = String(v); },
    },
    dataset: {
      get() {
        const d = {};
        for (const k of Object.keys(el.attrs)) if (k.startsWith('data-')) d[camel(k.slice(5))] = el.attrs[k];
        return d;
      },
    },
    textContent: {
      get() { return el.children.map((c) => (c.nodeType === 3 ? c.textContent : c.textContent)).join(''); },
      set(v) { el.children = [{ nodeType: 3, textContent: String(v), parentNode: el }]; },
    },
  });
  el.getAttribute = (k) => {
    const v = el.attrs[String(k).toLowerCase()];
    return v === undefined ? null : v;
  };
  el.setAttribute = (k, v) => { el.attrs[String(k).toLowerCase()] = String(v); };
  el.focus = () => { doc.activeElement = el; };
  el.click = () => {
    if (el.disabled) return;
    if (typeof el.onclick === 'function') el.onclick();
  };
  el.setSelectionRange = (s, e) => { el.selectionStart = s; el.selectionEnd = e; };
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.remove = () => {
    if (!el.parentNode) return;
    el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
    el.parentNode = null;
  };
  el.closest = (sel) => {
    let n = el;
    while (n && n.nodeType === 1) { if (matchSel(n, sel)) return n; n = n.parentNode; }
    return null;
  };
  el.querySelector = (sel) => queryAll(el, sel)[0] || null;
  el.querySelectorAll = (sel) => queryAll(el, sel);
  const classes = () => (el.attrs.class || '').split(/\s+/).filter(Boolean);
  el.classList = {
    contains: (c) => classes().includes(c),
    add: (...cs) => { el.attrs.class = [...new Set([...classes(), ...cs])].join(' '); },
    remove: (...cs) => { el.attrs.class = classes().filter((c) => !cs.includes(c)).join(' '); },
    toggle: (c, force) => {
      const has = classes().includes(c);
      const on = force === undefined ? !has : !!force;
      el.attrs.class = on ? [...new Set([...classes(), c])].join(' ') : classes().filter((x) => x !== c).join(' ');
      return on;
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el.children.map(serialize).join(''); },
    set(html) {
      el._raw = String(html);
      el.children = [];
      for (const c of parseFragment(doc, String(html), el)) el.children.push(c);
    },
  });
  return el;
}
function serialize(n) {
  if (n.nodeType === 3) return n.textContent;
  const attrs = Object.entries(n.attrs).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`)).join('');
  if (VOID.has(n.tagName.toLowerCase())) return `<${n.tagName.toLowerCase()}${attrs}>`;
  return `<${n.tagName.toLowerCase()}${attrs}>${n.children.map(serialize).join('')}</${n.tagName.toLowerCase()}>`;
}
function parseFragment(doc, html, parent) {
  const top = [];
  const stack = [];
  const push = (n) => { (stack.length ? stack[stack.length - 1] : { children: top }).children.push(n); };
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>|[^<>]+/g;
  let m;
  while ((m = re.exec(html))) {
    const t = m[0];
    if (t.startsWith('<!--')) continue;
    if (!t.startsWith('<')) {
      const text = decode(t);
      if (text) push({ nodeType: 3, textContent: text, parentNode: stack[stack.length - 1] || parent });
      continue;
    }
    const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(t);
    if (close) {
      const want = close[1].toLowerCase();
      while (stack.length && stack[stack.length - 1].tagName.toLowerCase() !== want) stack.pop();
      if (stack.length) stack.pop();
      continue;
    }
    const open = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)\/?\s*>$/.exec(t);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const el = makeNode(doc, tag, parseAttrs(open[2] || ''), stack[stack.length - 1] || parent);
    push(el);
    if (!VOID.has(tag) && !/\/\s*>$/.test(t)) stack.push(el);
  }
  return top;
}
function matchSel(el, sel) {
  for (const part of String(sel).split(',')) {
    if (matchOne(el, part.trim())) return true;
  }
  return false;
}
function matchOne(el, sel) {
  if (!sel || el.nodeType !== 1) return false;
  let rest = sel;
  const not = /:not\(([^)]+)\)/.exec(rest);
  if (not) {
    if (matchOne(el, not[1])) return false;
    rest = rest.replace(not[0], '');
  }
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
  if (tag && tag[0]) {
    if (el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  for (;;) {
    if (rest.startsWith('#')) {
      const m = /^#([A-Za-z0-9_-]+)/.exec(rest);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('.')) {
      const m = /^\.([A-Za-z0-9_-]+)/.exec(rest);
      if (!m || !el.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('[')) {
      const m = /^\[([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(rest);
      if (!m) return false;
      const v = el.getAttribute(m[1]);
      if (v === null) return false;
      const want = m[2] ?? m[3] ?? m[4];
      if (want !== undefined && v !== want) return false;
      rest = rest.slice(m[0].length);
    } else break;
  }
  return rest.trim() === '';
}
function queryAll(root, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.nodeType === 1) {
        if (matchSel(c, sel)) out.push(c);
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}
function makeDocument() {
  const doc = { activeElement: null, roots: [] };
  doc.createElement = (tag) => makeNode(doc, tag, {}, null);
  doc.head = makeNode(doc, 'head', {}, null);
  doc.roots.push(doc.head);
  doc.getElementById = (id) => {
    for (let i = doc.roots.length - 1; i >= 0; i--) {
      const found = queryAll(doc.roots[i], '#' + id)[0];
      if (found) return found;
    }
    return null;
  };
  doc.querySelector = (sel) => {
    for (let i = doc.roots.length - 1; i >= 0; i--) {
      const found = queryAll(doc.roots[i], sel)[0];
      if (found) return found;
    }
    return null;
  };
  doc.querySelectorAll = (sel) => doc.roots.flatMap((r) => queryAll(r, sel));
  return doc;
}
function surface(doc) {
  const el = makeNode(doc, 'main', { id: 'gbody' }, null);
  doc.roots.push(el);
  return el;
}
const clone = (s) => structuredClone(s);
async function loadUi(id) {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/games', id + '.js'), 'utf8')
    .replace("'../util.js'", JSON.stringify(utilUrl)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(utilUrl)));
  return (await import(dataModule(src))).default;
}

/* ---- Real-engine harness ---- */
class FakeCtx {
  constructor(players, settings, packs) {
    this._players = players;
    this._settings = settings || {};
    this._packs = packs || {};
    this._now = 1700000000000;
    this.timers = [];
    this.awards = {};
    this.seq = 0;
  }
  players() { return this._players.slice(); }
  allPlayers() { return this._players.slice(); }
  content(id) { return this._packs[id] || {}; }
  settings() { return { ...this._settings }; }
  hostId() { return this._players[0].id; }
  broadcast() {}
  lobby() {}
  later(ms, fn) {
    const t = { at: this._now + ms, fn, dead: false, id: this.seq++ };
    this.timers.push(t);
    return () => { t.dead = true; };
  }
  award(pid, pts) { this.awards[pid] = (this.awards[pid] || 0) + pts; }
  now() { return this._now; }
}
function roster(n, evil) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = `Alexandria Wellington-${i} · Fjord-McAllister the Third`;
    out.push({ id: 'p' + (i + 1), name: evil && i === 1 ? '<img src=x onerror=alert(1)>Bo' : base });
  }
  return out;
}
function project(def, state, players, pid) {
  return {
    ...structuredClone(def.view(state, pid)),
    game: def.id, me: pid, hostId: state.hostId || players[0].id,
    players: players.slice(), totals: {}, spectator: pid === 'watch', serverNow: 1700000000000,
  };
}
function enabledControls(el) {
  return el.querySelectorAll('input,button,select,textarea').filter((n) => !n.disabled);
}
(async () => {
  const oldDoc = global.document, oldWindow = global.window;
  const doc = makeDocument();
  global.document = doc;
  global.window = { matchMedia: () => ({ matches: false }) };
  const counts = { renders: 0, taps: 0 };
  const noSend = { send() { throw Error('Rendering cannot send an action'); } };
  try {
    /* ---- Would You Rather ---- */
    {
      const def = registry.get('would-you-rather');
      const evilA = '<script>alert("wyr")</script>Fly ' + 'unexpectedly delightful '.repeat(6);
      const evilB = 'Teleport & <b>vanish</b> ' + 'surprisinglylongchoice '.repeat(4);
      const players = roster(4, true);
      const ctx = new FakeCtx(players, { rounds: 2 }, { 'would-you-rather': { prompts: [{ a: evilA, b: evilB }] } });
      const state = def.create(ctx);
      const ui = await loadUi('would-you-rather');
      const el = surface(doc);
      /* Vote: escaped, two doors, unchanged vote action. */
      let v = project(def, state, players, 'p1');
      ui.render(el, clone(v), noSend);
      counts.renders++;
      assert(el.querySelector('.party-scene'), 'wyr vote renders an owned scene');
      assert(el.querySelector('.wyr-world'), 'wyr vote adds the scoped world');
      assert(el.querySelector('.party-hud')?.dataset.phase === 'vote', 'wyr HUD carries the true phase');
      assert(!el._raw.includes('<script>alert'), 'wyr prompt script is escaped');
      assert(el._raw.includes('&lt;script&gt;'), 'wyr prompt shows escaped markup');
      assert(!el._raw.includes('<img src=x'), 'wyr never injects a raw image tag');
      assert(!el._raw.includes('<svg') === false, 'wyr doors use live SVG');
      assert(el._raw.includes('wyr-arch'), 'wyr door arch geometry present');
      assert(!el._raw.includes('/assets/'), 'wyr JS needs no raster content');
      const doors = el.querySelectorAll('button[data-v]:not([disabled])');
      assert.equal(doors.length, 2, 'wyr exposes two enabled doors');
      const tapped = [];
      ui.render(el, clone(v), { send(a) { tapped.push(a); } });
      el.querySelector('button[data-v="a"]:not([disabled])').click();
      assert.deepEqual(tapped[0], { vote: 'a' }, 'wyr tap keeps the vote payload');
      counts.taps++;
      /* Privacy: other ballots stay hidden; only myVote + count. */
      def.onAction(state, ctx, 'p2', { vote: 'b' });
      def.onAction(state, ctx, 'p3', { vote: 'b' });
      def.onAction(state, ctx, 'p1', { vote: 'a' });
      v = project(def, state, players, 'p1');
      assert.deepEqual(v.votes, {}, 'wyr server hides votes during voting');
      ui.render(el, clone(v), noSend);
      counts.renders++;
      assert(el.querySelector('[aria-pressed="true"]'), 'wyr locked door presses');
      assert(el.querySelector('.party-lock'), 'wyr shows lock-in feedback');
      assert(!el.querySelector('.party-result'), 'wyr vote shows no reveal rows');
      assert(el.textContent.includes('3 of 4 locked in'), 'wyr shows the true locked count');
      /* Watcher: read-only, no enabled control. */
      ui.render(el, clone(project(def, state, players, 'watch')), noSend);
      counts.renders++;
      assert.equal(enabledControls(el).length, 0, 'wyr watcher has no enabled control');
      assert(el.querySelector('.party-spectator'), 'wyr watcher HUD is honest');
      /* 20 players, full names at reveal; host next keeps its id. */
      const big = roster(20, false);
      const ctx2 = new FakeCtx(big, { rounds: 1 }, {});
      const st2 = def.create(ctx2);
      big.forEach((p, i) => def.onAction(st2, ctx2, p.id, { vote: i % 2 ? 'b' : 'a' }));
      assert.equal(st2.phase, 'reveal', 'wyr 20 ballots reveal');
      const rv = project(def, st2, big, 'p1');
      rv.totals = Object.fromEntries(big.map((p) => [p.id, 987654321]));
      ui.render(el, clone(rv), noSend);
      counts.renders++;
      for (const p of big) assert(el.textContent.includes(p.name), 'wyr reveal keeps full name ' + p.id);
      assert(!el._raw.includes('987654321'), 'wyr reveal never shows night totals');
      const nx = el.querySelector('#wNext');
      assert(nx && !nx.disabled, 'wyr host keeps the next control');
      const nexted = [];
      ui.render(el, clone(rv), { send(a) { nexted.push(a); } });
      el.querySelector('#wNext').click();
      assert.deepEqual(nexted[0], { next: true }, 'wyr next keeps its payload');
      ui.render(el, clone(project(def, st2, big, 'p2')), noSend);
      assert(!el.querySelector('#wNext'), 'wyr non-host gets no next control');
      /* Repeated snapshots are stable and send nothing. */
      ui.render(el, clone(rv), noSend);
      const first = el._raw;
      ui.render(el, clone(rv), noSend);
      assert.equal(el._raw, first, 'wyr repeated snapshots are stable');
      /* Done: real final split, no dead controls. */
      def.onAction(st2, ctx2, st2.hostId, { next: true });
      assert.equal(st2.phase, 'done', 'wyr completes');
      const dv = project(def, st2, big, 'p1');
      dv.totals = Object.fromEntries(big.map((p) => [p.id, 987654321]));
      ui.render(el, clone(dv), noSend);
      counts.renders++;
      assert(el.querySelector('.party-prompt'), 'wyr finale names the result');
      assert(el.textContent.includes('Final split: 10'), 'wyr finale reports the real split');
      assert(!el._raw.includes('987654321'), 'wyr finale never shows night totals');
      assert.equal(enabledControls(el).length, 0, 'wyr finale has no dead control');
      /* Loading without a prompt still paints a polished shell. */
      const loading = { ...clone(dv), phase: 'vote', prompt: null, last: null, myVote: null, voted: [] };
      ui.render(el, loading, noSend);
      counts.renders++;
      assert(el.querySelector('.party-scene'), 'wyr loading keeps an owned scene');
      assert.equal(enabledControls(el).length, 0, 'wyr loading has no dead control');
      ui.dispose?.();
      assert.equal(doc.getElementById('would-you-rather-css'), null, 'would-you-rather removes its owned style on exit');
      ui.render(el, loading, noSend);
      counts.renders++;

      /* Leave: 20 -> 19 still renders with a true count. */
      const left = big.slice(0, 19);
      const ctx3 = new FakeCtx(left, { rounds: 1 }, {});
      const st3 = def.create(ctx3);
      def.onAction(st3, ctx3, 'p1', { vote: 'a' });
      ui.render(el, clone(project(def, st3, left, 'p2')), noSend);
      counts.renders++;
      assert(el.textContent.includes('1 of 19 locked in'), 'wyr leave keeps a true count');
    }

    /* ---- Never Ever ---- */
    {
      const def = registry.get('never-ever');
      const evilStmt = 'Eaten <script>alert("never")</script> dessert ' + 'at midnight '.repeat(10);
      const players = roster(4, true);
      const ctx = new FakeCtx(players, { rounds: 2 }, {
        'never-ever': {
          statements: [evilStmt],
          labels: { have: '<b>Guilty</b> have', haveNot: 'Never & pure' },
        },
      });
      const state = def.create(ctx);
      const ui = await loadUi('never-ever');
      const el = surface(doc);
      let v = project(def, state, players, 'p1');
      ui.render(el, clone(v), noSend);
      counts.renders++;
      assert(el.querySelector('.never-world'), 'never adds the scoped world');
      assert(el.querySelector('.never-placard'), 'never renders one prompt placard');
      assert(!el._raw.includes('<script>alert'), 'never statement script is escaped');
      assert(el._raw.includes('&lt;b&gt;Guilty'), 'never custom label markup is escaped');
      assert(!/finger|lives/i.test(el._raw), 'never copies no finger-token mechanic');
      assert(!el._raw.includes('/assets/'), 'never JS needs no raster content');
      assert(!el._raw.includes('<img'), 'never injects no image tag');
      const paddles = el.querySelectorAll('button[data-v]:not([disabled])');
      assert.equal(paddles.length, 2, 'never exposes two enabled paddles');
      assert(el.querySelector('button[data-v="have"]'), 'never keeps the Have action');
      assert(el.querySelector('button[data-v="not"]'), 'never keeps the Never action');
      const tapped = [];
      ui.render(el, clone(v), { send(a) { tapped.push(a); } });
      el.querySelector('button[data-v="not"]:not([disabled])').click();
      assert.deepEqual(tapped[0], { vote: 'not' }, 'never tap keeps the vote payload');
      counts.taps++;
      def.onAction(state, ctx, 'p1', { vote: 'not' });
      def.onAction(state, ctx, 'p2', { vote: 'have' });
      v = project(def, state, players, 'p1');
      assert.deepEqual(v.votes, {}, 'never server hides votes during voting');
      ui.render(el, clone(v), noSend);
      counts.renders++;
      assert(el.querySelector('.party-lock'), 'never shows lock-in feedback');
      assert(el.querySelector('[aria-pressed="true"]'), 'never locked paddle presses');
      assert(!el.querySelector('.party-result'), 'never vote shows no reveal rows');
      ui.render(el, clone(project(def, state, players, 'watch')), noSend);
      counts.renders++;
      assert.equal(enabledControls(el).length, 0, 'never watcher has no enabled control');
      /* 20-player reveal: distribution + full names + match scores. */
      const big = roster(20, false);
      const ctx2 = new FakeCtx(big, { rounds: 1 }, {});
      const st2 = def.create(ctx2);
      big.forEach((p, i) => def.onAction(st2, ctx2, p.id, { vote: i % 3 ? 'not' : 'have' }));
      assert.equal(st2.phase, 'reveal', 'never 20 ballots reveal');
      const rv = project(def, st2, big, 'p1');
      rv.totals = Object.fromEntries(big.map((p) => [p.id, 987654321]));
      ui.render(el, clone(rv), noSend);
      counts.renders++;
      assert(el.textContent.includes('guilty') && el.textContent.includes('pure'), 'never reveal reports the distribution');
      for (const p of big) assert(el.textContent.includes(p.name), 'never reveal keeps full name ' + p.id);
      assert(!el._raw.includes('987654321'), 'never reveal never shows night totals');
      for (const p of big) assert(el._raw.includes('>' + Number(rv.scores[p.id] || 0) + '</b>'), 'never keeps authoritative match score');
      assert(el.querySelector('#nNext'), 'never host keeps the next control');
      const nexted = [];
      ui.render(el, clone(rv), { send(a) { nexted.push(a); } });
      el.querySelector('#nNext').click();
      assert.deepEqual(nexted[0], { next: true }, 'never next keeps its payload');
      ui.render(el, clone(rv), noSend);
      const first = el._raw;
      ui.render(el, clone(rv), noSend);
      assert.equal(el._raw, first, 'never repeated snapshots are stable');
      def.onAction(st2, ctx2, st2.hostId, { next: true });
      assert.equal(st2.phase, 'done', 'never completes');
      const dv = project(def, st2, big, 'p3');
      dv.totals = Object.fromEntries(big.map((p) => [p.id, 987654321]));
      ui.render(el, clone(dv), noSend);
      counts.renders++;
      assert(el.querySelector('.party-scoreboard'), 'never finale keeps the scoreboard');
      assert(!el._raw.includes('987654321'), 'never finale never shows night totals');
      assert.equal(enabledControls(el).length, 0, 'never finale has no dead control');
      const loading = { ...clone(dv), phase: 'vote', statement: '', last: null, myVote: null, voted: [] };
      ui.render(el, loading, noSend);
      counts.renders++;
      assert(el.querySelector('.never-placard'), 'never loading keeps the placard');
      ui.dispose?.();
      assert.equal(doc.getElementById('never-ever-css'), null, 'never-ever removes its owned style on exit');
      ui.render(el, loading, noSend);
      counts.renders++;

    }
    /* ---- Most Likely To ---- */
    {
      const def = registry.get('most-likely');
      const evilPrompt = 'Most likely to <script>alert("likely")</script> ' + 'win everything '.repeat(8);
      const players = roster(4, true);
      const ctx = new FakeCtx(players, { rounds: 2 }, { 'most-likely': { prompts: [evilPrompt] } });
      const state = def.create(ctx);
      const ui = await loadUi('most-likely');
      const el = surface(doc);
      let v = project(def, state, players, 'p1');
      ui.render(el, clone(v), noSend);
      counts.renders++;
      assert(el.querySelector('.likely-world'), 'likely adds the scoped world');
      assert(el.querySelector('.likely-lineup'), 'likely renders the nominee lineup');
      assert(!el._raw.includes('<script>alert'), 'likely prompt script is escaped');
      assert(!el._raw.includes('<img src=x'), 'likely evil name is escaped');
      assert(el._raw.includes('&lt;img'), 'likely evil name shows escaped markup');
      assert(!el._raw.includes('/assets/'), 'likely JS needs no raster content');
      assert(!el._raw.includes('<img'), 'likely injects no image tag');
      assert(el._raw.includes('likely-mark'), 'likely uses vector mascots');
      const ballot = el.querySelectorAll('button[data-v]:not([disabled])');
      assert.equal(ballot.length, 3, 'likely ballot lists everyone except self');
      assert(!el.querySelector('button[data-v="p1"]'), 'likely never lists self');
      for (const p of players.filter((p) => p.id !== 'p1')) {
        const btn = el.querySelector(`button[data-v="${p.id}"]`);
        assert(btn, 'likely ballot includes ' + p.id);
        assert(btn.textContent.includes(p.name.replace(/<[^>]*>/g, '').slice(0, 12)) || btn.textContent.includes('Alexandria'), 'likely button keeps the full name ' + p.id);
      }
      const tapped = [];
      ui.render(el, clone(v), { send(a) { tapped.push(a); } });
      el.querySelector('button[data-v="p2"]:not([disabled])').click();
      assert.deepEqual(tapped[0], { vote: 'p2' }, 'likely tap keeps the vote payload');
      counts.taps++;
      def.onAction(state, ctx, 'p1', { vote: 'p1' });
      assert(!state.votes.p1, 'likely server rejects self votes');
      def.onAction(state, ctx, 'p1', { vote: 'p2' });
      def.onAction(state, ctx, 'p2', { vote: 'p3' });
      v = project(def, state, players, 'p1');
      assert.deepEqual(v.votes, {}, 'likely server hides votes during voting');
      ui.render(el, clone(v), noSend);
      counts.renders++;
      assert(el.querySelector('.party-lock'), 'likely shows lock-in feedback');
      assert(!el.querySelector('.party-result'), 'likely vote shows no reveal rows');
      ui.render(el, clone(project(def, state, players, 'watch')), noSend);
      counts.renders++;
      assert.equal(enabledControls(el).length, 0, 'likely watcher has no enabled control');
      assert(el.querySelectorAll('button[data-v]').length === 0, 'likely watcher gets no vote buttons');
      /* 20 nominees: all reachable with full names. */
      const big = roster(20, false);
      const ctx2 = new FakeCtx(big, { rounds: 1 }, {});
      const st2 = def.create(ctx2);
      const bv = project(def, st2, big, 'p1');
      ui.render(el, clone(bv), noSend);
      counts.renders++;
      assert.equal(el.querySelectorAll('button[data-v]').length, 19, 'likely 20-room ballot has 19 nominees');
      for (const p of big.filter((p) => p.id !== 'p1')) assert(el.textContent.includes(p.name), 'likely ballot keeps full name ' + p.id);
      assert(el.querySelector('.likely-more'), 'likely discloses lineup overflow');
      /* Deterministic identity: same id, same mascot across renders. */
      const once = el._raw;
      ui.render(el, clone(bv), noSend);
      assert.equal(el._raw, once, 'likely lineup snapshots are stable');
      big.forEach((p) => { if (p.id !== 'p7') def.onAction(st2, ctx2, p.id, { vote: 'p7' }); });
      def.onAction(st2, ctx2, 'p7', { vote: 'p1' });
      assert.equal(st2.phase, 'reveal', 'likely 20 ballots reveal');
      const rv = project(def, st2, big, 'p1');
      rv.totals = Object.fromEntries(big.map((p) => [p.id, 987654321]));
      ui.render(el, clone(rv), noSend);
      counts.renders++;
      assert.equal(el.querySelectorAll('.party-result').length, 20, 'likely reveal rows cover every player');
      for (const p of big) assert(el.textContent.includes(p.name), 'likely reveal keeps full name ' + p.id);
      assert(el.textContent.includes('19 votes'), 'likely reveal reports the true tally');
      assert(!el._raw.includes('987654321'), 'likely reveal never shows night totals');
      assert(el.querySelector('#mNext'), 'likely host keeps the next control');
      const nexted = [];
      ui.render(el, clone(rv), { send(a) { nexted.push(a); } });
      el.querySelector('#mNext').click();
      assert.deepEqual(nexted[0], { next: true }, 'likely next keeps its payload');
      def.onAction(st2, ctx2, st2.hostId, { next: true });
      assert.equal(st2.phase, 'done', 'likely completes');
      const dv = project(def, st2, big, 'p2');
      dv.totals = Object.fromEntries(big.map((p) => [p.id, 987654321]));
      ui.render(el, clone(dv), noSend);
      counts.renders++;
      assert(el.querySelector('.party-scoreboard'), 'likely finale keeps the scoreboard');
      assert(!el._raw.includes('987654321'), 'likely finale never shows night totals');
      assert.equal(enabledControls(el).length, 0, 'likely finale has no dead control');
      const loading = { ...clone(dv), phase: 'vote', prompt: '', last: null, myVote: null, voted: [] };
      ui.render(el, loading, noSend);
      counts.renders++;
      assert(el.querySelector('.party-scene'), 'likely loading keeps an owned scene');
      ui.dispose?.();
      assert.equal(doc.getElementById('most-likely-css'), null, 'most-likely removes its owned style on exit');
      ui.render(el, loading, noSend);
      counts.renders++;

    }

    /* ---- Scoped CSS + approved backdrops ---- */
    const cssChecks = [
      ['would-you-rather', '.wyr-world', ['#261d43', '#ed9b78', '#f6dbac', '#76c4c1', '#152d40']],
      ['never-ever', '.never-world', ['#fff4dc', '#162c57', '#eea087', '#4faeae']],
      ['most-likely', '.likely-world', ['#342034', '#ffe9ce', '#efba48', '#bc5776']],
    ];
    for (const [id, scope, palette] of cssChecks) {
      const css = fs.readFileSync(path.join(ROOT, 'public/css', id + '.css'), 'utf8');
      assert(css.includes(scope), id + ' CSS scopes its world');
      for (const hex of palette) assert(css.includes(hex), id + ' CSS keeps ' + hex);
      assert(/font-family:\s*Georgia/.test(css), id + ' prompt uses Georgia');
      assert(css.includes('/assets/' + id + '/backdrop-v1.webp'), id + ' references its approved backdrop');
      assert(css.includes('background-color'), id + ' keeps a fallback behind the backdrop');
      assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important/, id + ' respects reduced motion');
      assert(css.includes('min-height: 44px') || css.includes('min-width: 44px'), id + ' keeps 44px targets');
      assert(css.includes('overflow-wrap: anywhere'), id + ' wraps long content');
      assert(!css.includes('text-overflow: ellipsis'), id + ' never truncates content');
      assert(css.includes(':focus-visible'), id + ' keeps keyboard focus visible');
      assert(css.includes('@media (max-width: 640px)'), id + ' reflows narrow phones');
      assert(css.includes('@media (max-height: 500px)'), id + ' keeps short landscape reachable');
    }
    /* Game CSS loads after the shared sheet. */
    {
      const head = doc.head.children.filter((n) => n.tagName === 'LINK');
      const ids = head.map((n) => n.id);
      assert(ids.includes('party-scenes-css'), 'shared sheet is requested');
      for (const id of ['would-you-rather-css', 'never-ever-css', 'most-likely-css']) {
        assert(ids.includes(id), id + ' is requested');
        const link = doc.getElementById(id);
        assert.equal(link.href || link.getAttribute('href'), '/css/' + id.replace(/-css$/, '.css'), id + ' href is exact');
        assert(ids.indexOf(id) > ids.indexOf('party-scenes-css'), id + ' loads after the shared sheet');
      }
    }
    /* Approved compressed backdrops are present at exact bytes. */
    const sizes = { 'would-you-rather': 138570, 'never-ever': 123452, 'most-likely': 63148 };
    for (const [id, bytes] of Object.entries(sizes)) {
      const p = path.join(ROOT, 'public/assets', id, 'backdrop-v1.webp');
      assert.equal(fs.statSync(p).size, bytes, id + ' backdrop keeps its approved bytes');
    }
    /* Client sources need no image pipeline and no second clock. */
    for (const id of ['would-you-rather', 'never-ever', 'most-likely']) {
      const src = fs.readFileSync(path.join(ROOT, 'public/js/games', id + '.js'), 'utf8');
      assert(!src.includes('/assets/'), id + ' paints no raster content');
      assert(!src.includes('<img'), id + ' creates no image element');
      assert(!src.includes('new Image'), id + ' preloads no image');
      assert(!src.includes('fetch('), id + ' fetches no art');
      assert(!src.includes('setInterval') && !src.includes('setTimeout'), id + ' owns no timer');
      assert(!src.includes('ownsTimer'), id + ' keeps shell clock ownership');
      assert(src.includes("from '../util.js'"), id + ' reuses the shared esc helper');
    }

    console.log(`SOCIAL_ART_VIEW_PASS: ${counts.renders} renders, ${counts.taps} tap payloads, escaped text, 20-player names, private ballots, scoped CSS, approved backdrops`);
  } finally {
    if (oldDoc === undefined) delete global.document; else global.document = oldDoc;
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });



