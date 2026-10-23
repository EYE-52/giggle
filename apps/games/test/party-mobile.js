'use strict';
// Party mobile regression: real-engine fixtures rendered by the production
// party clients into a minimal DOM stub. Exercises behavior — composer node
// preservation, draft/selection/focus retention, IME rejection, tap payloads,
// tap-only reorder, private-selection scope, watcher isolation, lock-in
// feedback — not markup strings. Geometry (44px targets, 24px prompts,
// overflow at real viewports) stays in the on-page QA fixture in
// test/party-scenes-browser.js; the browser pass uses actual viewport sizes.
// NOTE: simulated pointer/keyboard events here are regression fixtures,
// not physical-device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FIXTURES } = require('./party-scenes-browser');
const ROOT = path.resolve(__dirname, '..');
const dataModule = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
const utilUrl = dataModule(fs.readFileSync(path.join(ROOT, 'public/js/util.js'), 'utf8'));

/* ---- Minimal DOM stub: just what the party clients use ---- */
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
    children: [], parentNode: parent || null,
    onclick: null, onkeydown: null,
    value: attrs.value !== undefined ? attrs.value : '', style: {},
    checked: attrs.checked !== undefined,
    selectionStart: 0, selectionEnd: 0,
  };
  Object.defineProperties(el, {
    id: { get() { return el.attrs.id || ''; }, set(v) { el.attrs.id = String(v); } },
    type: { get() { return el.attrs.type || (el.tagName === 'INPUT' ? 'text' : ''); } },
    name: { get() { return el.attrs.name || ''; } },
    disabled: { get() { return el.attrs.disabled !== undefined; }, set(v) { if (v) el.attrs.disabled = ''; else delete el.attrs.disabled; } },
    hidden: { get() { return el.attrs.hidden !== undefined; }, set(v) { if (v) el.attrs.hidden = ''; else delete el.attrs.hidden; } },
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
  el.removeAttribute = (k) => { delete el.attrs[String(k).toLowerCase()]; };
  el.focus = () => { doc.activeElement = el; };
  el.click = () => {
    if (el.disabled) return;
    if (el.tagName === 'INPUT' && el.type === 'radio' && el.name) {
      for (const r of doc.querySelectorAll(`input[name="${el.name}"]`)) r.checked = false;
      el.checked = true;
    }
    if (typeof el.onclick === 'function') el.onclick();
  };
  el.setSelectionRange = (s, e) => { el.selectionStart = s; el.selectionEnd = e; };
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.insertBefore = (c, ref) => {
    c.parentNode = el;
    const i = ref ? el.children.indexOf(ref) : -1;
    if (i < 0) el.children.push(c); else el.children.splice(i, 0, c);
    return c;
  };
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
      el.children = [];
      for (const c of parseFragment(doc, String(html), el)) el.children.push(c);
    },
  });
  Object.defineProperty(el, 'outerHTML', {
    get() { return serialize(el); },
    set(html) {
      const parent = el.parentNode;
      if (!parent) return;
      const frag = parseFragment(doc, String(html), parent);
      const i = parent.children.indexOf(el);
      parent.children.splice(i < 0 ? parent.children.length : i, 1, ...frag);
      el.parentNode = null;
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
/* Selector support: tag, #id, .class, [attr], [attr="v"], :checked,
 * :not([disabled]), comma lists. Enough for the party clients. */
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
  if (rest.endsWith(':checked')) {
    if (!el.checked) return false;
    rest = rest.slice(0, -':checked'.length);
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
/* Key events bubble from the target up, like the browser. */
function keydown(node, init) {
  const e = {
    key: init.key, isComposing: !!init.isComposing, keyCode: init.keyCode || 0,
    bubbles: true, target: node, defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; },
  };
  let n = node;
  while (n && n.nodeType === 1) {
    if (typeof n.onkeydown === 'function') n.onkeydown(e);
    n = n.parentNode;
  }
  return e;
}
const clone = (s) => structuredClone(s);

async function loadUi(id) {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/games', id + '.js'), 'utf8')
    .replace("'../util.js'", JSON.stringify(utilUrl)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(utilUrl)));
  return (await import(dataModule(src))).default;
}

/* Text composers: phase, who holds the pen, fields, send control. */
const COMPOSERS = [
  { game: 'bluff', phase: 'bluff', role: (s) => s.me !== 'watch', inputs: ['bFake'], send: '#bSend', enter: 'bFake', key: 'fake' },
  { game: 'compliment-battle', phase: 'write', role: (s) => s.me !== 'watch' && s.me !== s.target, inputs: ['cbEntry'], send: '#cbSend', enter: 'cbEntry', key: 'entry' },
  { game: 'emoji-story', phase: 'emoji', role: (s) => s.me === s.director, inputs: ['eEmoji'], send: '#eSend2', enter: 'eEmoji', key: 'emoji', fill: { eEmoji: '🌊🐟🎉' } },
  { game: 'emoji-story', phase: 'guess', role: (s) => s.me !== 'watch' && s.me !== s.director && !s.mySolved, inputs: ['eGuess'], send: '#eSend', enter: 'eGuess', key: 'guess' },
  { game: 'five-second', phase: 'answer', role: (s) => s.me === s.performer, inputs: ['fAns'], send: '#fSend', enter: 'fAns', key: 'answers' },
  { game: 'funny-answer', phase: 'answer', role: (s) => s.me !== 'watch' && !s.myAnswer, inputs: ['fAns'], send: '#fSend', enter: 'fAns', key: 'answer' },
  { game: 'hot-takes', phase: 'submit', role: (s) => s.me !== 'watch', inputs: ['hTake'], send: '#hSend', enter: 'hTake', key: 'take' },
  { game: 'lyric-fill', phase: 'fill', role: (s) => s.me !== 'watch' && !s.mine, inputs: ['lfText'], send: '#lfGo', enter: 'lfText', key: 'text' },
  { game: 'rapid-polls', phase: 'pose', role: (s) => s.me !== 'watch', inputs: ['rpQ', 'rpO0', 'rpO1'], send: '#rpAsk', enter: 'rpO1', key: 'pose', next: [['rpQ', 'rpO0'], ['rpO0', 'rpO1']], fill: { rpQ: 'What makes game night great?', rpO0: 'A surprising story', rpO1: 'A close contest' } },
  { game: 'roast-toast', phase: 'write', role: (s) => s.me !== 'watch' && s.me !== s.target, inputs: ['rtEntry'], send: '#rtSend', enter: 'rtEntry', key: 'entry' },
  { game: 'story-builder', phase: 'build', role: (s) => s.me === s.turn, inputs: ['sLine'], send: '#sSend', enter: 'sLine', key: 'line' },
  { game: 'two-truths', phase: 'write', role: (s) => s.me === s.subject, inputs: ['tS0', 'tS1', 'tS2'], send: '#tSend', enter: 'tS2', key: 'statements', next: [['tS0', 'tS1'], ['tS1', 'tS2']] },
];
/* Pure tap actions (games without a text composer). */
const TAPS = [
  { game: 'dare-roulette', phase: 'verdict', role: (s) => s.me !== 'watch' && s.me !== s.victim && !s.myVote, sel: 'button[data-v]:not([disabled])', key: 'vote' },
  { game: 'most-likely', phase: 'vote', role: (s) => s.me !== 'watch' && !s.myVote, sel: 'button[data-v]:not([disabled])', key: 'vote' },
  { game: 'never-ever', phase: 'vote', role: (s) => s.me !== 'watch' && !s.myVote, sel: 'button[data-v]:not([disabled])', key: 'vote' },
  { game: 'pick-one', phase: 'vote', role: (s) => s.me !== 'watch' && !s.myVote, sel: 'button[data-v]:not([disabled])', key: 'vote' },
  { game: 'trivia', phase: null, role: (s) => s.me !== 'watch' && s.phase !== 'done' && s.phase !== 'reveal' && (s.myPick === null || s.myPick === undefined), sel: 'button[data-p]:not([disabled])', key: 'pick' },
  { game: 'would-you-rather', phase: 'vote', role: (s) => s.me !== 'watch' && !s.myVote, sel: 'button[data-v]:not([disabled])', key: 'vote' },
];
/* Private acted state per game and phase: when set outside reveal/done,
 * the actor must see visible lock-in feedback. */
const ACTED = {
  'bluff': { bluff: ['myFake'], pick: ['myPick'] },
  'compliment-battle': { write: ['myEntry'], vote: ['myVote'] },
  'dare-roulette': { verdict: ['myVote'] }, 'emoji-story': { guess: ['mySolved'] },
  'five-second': { vote: ['myVote'] },
  'funny-answer': { answer: ['myAnswer'], vote: ['myVote'] },
  'hot-takes': { submit: ['myTake'], vote: ['myVote'] },
  'lyric-fill': { fill: ['mine'] }, 'most-likely': { vote: ['myVote'] },
  'never-ever': { vote: ['myVote'] }, 'pick-one': { vote: ['myVote'] },
  'rank-it': { rank: ['myRank'] }, 'rapid-polls': { vote: ['myVote'] },
  'roast-toast': { write: ['myEntry'], vote: ['myVote', 'myPick'] },
  'story-builder': { vote: ['myVote'] }, 'trivia': { '*': ['myPick'] },
  'truth-dare': { vote: ['myVote'] }, 'two-truths': { vote: ['myVote'] },
  'would-you-rather': { vote: ['myVote'] },
};
const isActed = (s, k) => {
  const v = s[k];
  if (v === null || v === undefined || v === '' || v === false) return false;
  return true;
};
const LOCK_RE = /locked in|your vote|crowned|filed|sealed/i;
function lockEvidence(el) {
  return el.querySelector('.party-lock')
    || el.querySelector('[aria-pressed="true"]')
    || el.querySelector('.is-picked')
    || LOCK_RE.test(el.textContent);
}
function enabledControls(el) {
  return el.querySelectorAll('input,button,select,textarea').filter((n) => !n.disabled);
}
function findFrame(f, phase, role) {
  for (const frame of f.frames) {
    if (phase && frame.views[0].phase !== phase) continue;
    const view = frame.views.find((v) => v.me !== 'watch' && role(v));
    if (view) return { frame, view };
  }
  return {};
}
function draftFor(game, id, fill) {
  if (fill && fill[id]) return fill[id];
  return `A real typed draft ${game} ${id}`;
}

module.exports = { makeDocument, surface };

if (require.main === module) (async () => {
  const oldDoc = global.document, oldWindow = global.window;
  const doc = makeDocument();
  global.document = doc;
  global.window = { matchMedia: () => ({ matches: true }) };
  const counts = { renders: 0, watchViews: 0, acted: {}, composerChecks: 0, taps: 0, ime: 0 };
  const foundInputs = new Set();
  try {
    /* M1/M7/M8/M10/M11: full render matrix over real private projections. */
    for (const f of FIXTURES) {
      const ui = await loadUi(f.id);
      const el = surface(doc);
      counts.acted[f.id] = 0;
      for (const me of ['p1', 'p2', 'p3', 'p4', 'watch']) {
        ui.dispose?.();
        for (const frame of f.frames) {
          const state = clone(frame.views.find((v) => v.me === me));
          ui.render(el, state, { send() { throw Error('Rendering cannot send an action'); } });
          counts.renders++;
          const where = `${f.id} ${frame.label} ${me}`;
          // Trivia and Lyric Fill are built on the game kit (.wg + .gk-hud).
          const kitGame = f.id === 'lyric-fill' || f.id === 'trivia';
          assert(el.querySelector(kitGame ? '.wg' : '.party-scene,[data-scene]'),
            where + ' renders its owned game scene');
          if (state.phase === 'done') {
            // Every finale is the shared kit Final scores block, without a HUD row.
            assert(el.querySelector('.gk-final') && !el.querySelector('.gk-hud'), where + ' shows the kit Final scores');
          } else if (kitGame) {
            const scene = el.querySelector('.wg');
            assert(el.querySelector('.gk-hud') && scene.dataset.phase === state.phase, where + ' scene carries the true phase');
          } else {
            const hud = el.querySelector('.party-hud,.gk-hud');
            assert(hud && hud.dataset.phase === state.phase, where + ' HUD carries the true phase');
          }
          for (const n of el.querySelectorAll('input[type="text"]')) {
            foundInputs.add(`${f.id}#${n.id}`);
            assert(n.getAttribute('enterkeyhint'), where + ' input has a soft-keyboard hint');
            assert.equal(n.getAttribute('autocomplete'), 'off', where + ' input keeps autocomplete off');
            assert(n.getAttribute('maxlength'), where + ' input bounds its length');
            const labelled = n.getAttribute('aria-label') || el.querySelector(`label[for="${n.id}"]`);
            assert(labelled, where + ' input is labelled');
          }
          if (me === 'watch') {
            counts.watchViews++;
            /* The role rendering itself isolates watchers; no fixture forcing. */
            assert.equal(enabledControls(el).length, 0, where + ' watcher has no enabled control');
          }
          if (state.phase === 'done') {
            assert(el.querySelector(kitGame ? '.gk-results-title' : '.party-prompt,.gk-prompt,.gk-results-title'), where + ' finale names the result');
            assert.equal(enabledControls(el).length, 0, where + ' finale has no dead control');
          }
          const actedKeys = (ACTED[f.id] || {})[state.phase] || (ACTED[f.id] || {})['*'] || [];
          if (me !== 'watch' && state.phase !== 'done' && state.phase !== 'reveal'
            && actedKeys.some((k) => isActed(state, k))) {
            counts.acted[f.id]++;
            assert(lockEvidence(el), where + ' shows lock-in feedback after acting');
          }
        }
      }
      ui.dispose?.();
    }
    for (const f of FIXTURES) {
      assert(counts.acted[f.id] > 0, f.id + ' has acknowledged actor views proving lock-in feedback');
    }
    assert(counts.watchViews > 0, 'watcher isolation covered real projections');

    /* M2/M3/M4: typing — preservation, IME, Enter/send, draft clearing. */
    for (const cfg of COMPOSERS) {
      const f = FIXTURES.find((x) => x.id === cfg.game);
      const ui = await loadUi(cfg.game);
      const { frame, view } = findFrame(f, cfg.phase, cfg.role);
      assert(view, `${cfg.game} ${cfg.phase} has a live composer frame`);
      for (const id of cfg.inputs) assert(foundInputs.has(`${cfg.game}#${id}`), `${cfg.game} matrix covered ${id}`);
      const el = surface(doc);
      const drafts = Object.fromEntries(cfg.inputs.map((id) => [id, draftFor(cfg.game, id, cfg.fill)]));
      const fresh = (captured) => {
        ui.dispose?.();
        ui.render(el, clone(view), { send(a) { captured.push(a); } });
      };
      const fillAll = () => {
        for (const id of cfg.inputs) {
          const n = el.querySelector('#' + id);
          assert(n, `${cfg.game} composer keeps field ${id}`);
          n.value = drafts[id];
        }
      };
      const tapLie = (v) => {
        const radio = el.querySelector(`input[name="tLie"][value="${v}"]`);
        assert(radio, `${cfg.game} lie choice is tappable`);
        radio.click();
        assert(radio.checked, `${cfg.game} lie tap sticks`);
      };
      const leaked = () => el.querySelectorAll('input[type="text"]').some((n) => Object.values(drafts).includes(n.value));
      fresh([]);
      for (const id of cfg.inputs) assert.equal(el.querySelector('#' + id).value, '', `${cfg.game} ${id} starts empty`);
      if (cfg.game === 'two-truths') {
        assert.equal(doc.querySelector('input[name="tLie"]:checked').value, '2', 'two-truths fresh window defaults the lie mark');
      }
      /* Same-window broadcast keeps node, draft, selection, focus. */
      fillAll();
      const first = el.querySelector('#' + cfg.inputs[0]);
      first.focus();
      first.setSelectionRange(2, 5);
      const before = cfg.inputs.map((id) => el.querySelector('#' + id));
      const keep = [];
      ui.render(el, clone(view), { send(a) { keep.push(a); } });
      assert.equal(keep.length, 0, `${cfg.game} broadcast snapshot sends nothing`);
      cfg.inputs.forEach((id, i) => {
        const now = el.querySelector('#' + id);
        assert(now === before[i], `${cfg.game} ${id} node survives broadcast`);
        assert.equal(now.value, drafts[id], `${cfg.game} ${id} draft survives broadcast`);
      });
      assert(doc.activeElement === first, `${cfg.game} typing focus survives broadcast`);
      assert.equal(first.selectionStart, 2, `${cfg.game} selection start survives`);
      assert.equal(first.selectionEnd, 5, `${cfg.game} selection end survives`);
      if (cfg.game === 'two-truths') {
        tapLie('1');
        ui.render(el, clone(view), { send() {} });
        assert(el.querySelector('input[name="tLie"][value="1"]').checked, 'two-truths lie tap survives broadcast');
      }
      /* IME Enter never submits; soft Next advances; final Enter sends once. */
      const typed = [];
      fresh(typed); fillAll();
      if (cfg.game === 'two-truths') tapLie('1');
      const imeNode = el.querySelector('#' + cfg.enter);
      keydown(imeNode, { key: 'Enter', isComposing: true });
      keydown(imeNode, { key: 'Enter', keyCode: 229 });
      assert.equal(typed.length, 0, `${cfg.game} IME Enter submits nothing`);
      counts.ime++;
      for (const [from, to] of cfg.next || []) {
        keydown(el.querySelector('#' + from), { key: 'Enter' });
        assert(doc.activeElement === el.querySelector('#' + to), `${cfg.game} soft Next advances ${from} to ${to}`);
      }
      assert.equal(typed.length, 0, `${cfg.game} soft Next submits nothing`);
      keydown(el.querySelector('#' + cfg.enter), { key: 'Enter' });
      assert.equal(typed.length, 1, `${cfg.game} soft Send emits exactly once`);
      assert(cfg.key in typed[0], `${cfg.game} Enter payload carries ${cfg.key}`);
      if (cfg.game === 'two-truths') {
        assert.equal(typed[0].statements.length, 3, 'two-truths sends all three statements');
        assert.equal(typed[0].lie, 1, 'two-truths payload carries the tapped lie');
      }
      if (cfg.game === 'rapid-polls') assert(typed[0].pose.q && typed[0].pose.options.length >= 2, 'rapid-polls sends question plus options');
      /* The on-screen send button needs no hardware keyboard. */
      const tapped = [];
      fresh(tapped); fillAll();
      if (cfg.game === 'two-truths') tapLie('0');
      el.querySelector(cfg.send).click();
      assert.equal(tapped.length, 1, `${cfg.game} send tap emits exactly once`);
      assert(cfg.key in tapped[0], `${cfg.game} tap payload carries ${cfg.key}`);
      if (cfg.game === 'two-truths') assert.equal(tapped[0].lie, 0, 'two-truths tap payload carries the tapped lie');
      if (cfg.inputs[0] === 'eEmoji') {
        const invalid = [];
        fresh(invalid);
        const input = el.querySelector('#eEmoji');
        input.value = 'पार्टी 🎉';
        el.querySelector(cfg.send).click();
        assert.equal(invalid.length, 0, 'letters are rejected before sending an emoji story');
        assert.equal(input.getAttribute('aria-invalid'), 'true');
        assert(el.querySelector('#eEmojiError').textContent.includes('remove the letters'));
        ui.render(el, clone(view), { send(a) { invalid.push(a); } });
        assert.equal(input.value, 'पार्टी 🎉', 'validation preserves the editable draft');
        input.value = '🎉🌊';
        el.querySelector(cfg.send).click();
        assert.equal(invalid.length, 1, 'correcting a story to emoji recovers normally');
        assert.equal(input.getAttribute('aria-invalid'), null);
      }
      /* Private drafts never cross roles, players, windows, or remounts. */
      ui.render(el, clone(frame.views.find((v) => v.me === 'watch')), { send() {} });
      assert(!leaked(), `${cfg.game} draft never reaches a watcher`);
      const other = frame.views.find((v) => v.me !== 'watch' && v.me !== view.me);
      ui.render(el, clone(other), { send() {} });
      assert(!leaked(), `${cfg.game} draft never reaches another player`);
      const later = f.frames.find((x) => x.views[0].phase !== cfg.phase);
      if (later) {
        ui.render(el, clone(later.views.find((v) => v.me === view.me)), { send() {} });
        assert(!leaked(), `${cfg.game} draft clears across windows`);
      }
      const nextRound = f.frames.find((x) => x !== frame && x.views[0].phase === cfg.phase);
      if (nextRound) {
        ui.render(el, clone(nextRound.views.find((v) => v.me === view.me)), { send() {} });
        assert(!leaked(), `${cfg.game} draft clears across rounds`);
      }
      fresh([]);
      for (const id of cfg.inputs) {
        const n = el.querySelector('#' + id);
        if (n) assert.equal(n.value, '', `${cfg.game} ${id} clears on remount`);
      }
      counts.composerChecks++;
      ui.dispose?.();
    }

    /* M5: Rank It tap-only reorder. */
    {
      const f = FIXTURES.find((x) => x.id === 'rank-it');
      const ui = await loadUi('rank-it');
      const el = surface(doc);
      const frame = f.frames.find((x) => x.views[0].phase === 'rank');
      const view = frame.views.find((v) => v.me === 'p1');
      assert(view && !view.myRank, 'rank-it opens unranked');
      ui.dispose?.();
      const captured = [];
      ui.render(el, clone(view), { send(a) { captured.push(a); } });
      const names = () => el.querySelectorAll('.party-rank-name').map((n) => n.textContent.trim());
      const items = view.set.items;
      assert.deepEqual(names(), items, 'rank-it starts in dealt order');
      assert(el.querySelector('[data-up="0"]').disabled, 'rank-it first row cannot move up');
      assert(el.querySelector('[data-dn="4"]').disabled, 'rank-it last row cannot move down');
      const firstDown = el.querySelector('[data-dn="0"]');
      firstDown.focus();
      keydown(firstDown, { key: 'ArrowUp' });
      assert(el.querySelector('[data-dn="0"]') === firstDown, 'rank-it upper boundary keeps the focused control mounted');
      assert(doc.activeElement === firstDown, 'rank-it upper boundary keeps focus');
      const lastUp = el.querySelector('[data-up="4"]');
      lastUp.focus();
      keydown(lastUp, { key: 'ArrowDown' });
      assert(el.querySelector('[data-up="4"]') === lastUp, 'rank-it lower boundary keeps the focused control mounted');
      assert(doc.activeElement === lastUp, 'rank-it lower boundary keeps focus');
      assert.deepEqual(names(), items, 'rank-it boundary arrows preserve the order');
      assert.equal(captured.length, 0, 'rank-it boundary arrows never submit');
      el.querySelector('[data-dn="0"]').click();
      assert.deepEqual(names(), [items[1], items[0], items[2], items[3], items[4]], 'rank-it down tap reorders');
      const btn = el.querySelector('[data-up="1"]');
      btn.focus();
      ui.render(el, clone(view), { send(a) { captured.push(a); } });
      assert.deepEqual(names(), [items[1], items[0], items[2], items[3], items[4]], 'rank-it order survives broadcast');
      assert(doc.activeElement === btn, 'rank-it focus survives broadcast');
      el.querySelector('#rLock').click();
      assert.equal(captured.length, 1, 'rank-it lock-in emits one payload');
      assert.deepEqual(captured[0].order, [1, 0, 2, 3, 4], 'rank-it payload carries the displayed order');
      el.querySelector('[data-up="1"]').click();
      assert.deepEqual(names(), items, 'rank-it up tap restores');
      el.querySelector('[data-dn="0"]').click();
      ui.render(el, clone(frame.views.find((v) => v.me === 'watch')), { send() {} });
      assert.equal(el.querySelectorAll('[data-up],[data-dn]').length, 0, 'rank-it watcher gets no reorder controls');
      ui.dispose?.();
      ui.render(el, clone(view), { send() {} });
      assert.deepEqual(names(), items, 'rank-it remount clears the unsent draft');
      ui.dispose?.();
    }

    /* M6: truth/dare deck + kind private selection. */
    {
      const f = FIXTURES.find((x) => x.id === 'truth-dare');
      const ui = await loadUi('truth-dare');
      const el = surface(doc);
      const frame = f.frames.find((x) => x.views[0].phase === 'choose');
      const view = frame.views.find((v) => v.me === v.target);
      assert(view, 'truth-dare choose frame has its target');
      ui.dispose?.();
      const captured = [];
      ui.render(el, clone(view), { send(a) { captured.push(a); } });
      assert.equal(el.querySelector('[data-deck="classic"]').getAttribute('aria-pressed'), 'true', 'truth-dare deck starts classic');
      el.querySelector('[data-deck="wild"]').click();
      assert.equal(el.querySelector('[data-deck="wild"]').getAttribute('aria-pressed'), 'true', 'truth-dare deck tap sticks');
      assert.equal(el.querySelector('[data-deck="classic"]').getAttribute('aria-pressed'), 'false', 'truth-dare deck tap clears classic');
      const wildBtn = el.querySelector('[data-deck="wild"]');
      ui.render(el, clone(view), { send(a) { captured.push(a); } });
      assert(el.querySelector('[data-deck="wild"]') === wildBtn, 'truth-dare deck node survives broadcast');
      assert.equal(el.querySelector('[data-deck="wild"]').getAttribute('aria-pressed'), 'true', 'truth-dare deck survives broadcast');
      el.querySelector('[data-kind="dare"]').click();
      assert.equal(captured.length, 1, 'truth-dare kind tap emits once');
      assert.deepEqual(captured[0], { deck: 'wild', kind: 'dare' }, 'truth-dare payload carries deck + kind');
      ui.render(el, clone(frame.views.find((v) => v.me === 'watch')), { send() {} });
      assert.equal(el.querySelectorAll('[data-kind]').length, 0, 'truth-dare watcher gets no private choice');
      ui.dispose?.();
      ui.render(el, clone(view), { send() {} });
      assert.equal(el.querySelector('[data-deck="classic"]').getAttribute('aria-pressed'), 'true', 'truth-dare remount clears the deck draft');
      ui.dispose?.();
    }

    /* Pure tap actions emit one payload with the right key. */
    for (const tap of TAPS) {
      const f = FIXTURES.find((x) => x.id === tap.game);
      const ui = await loadUi(tap.game);
      const { view } = findFrame(f, tap.phase, tap.role);
      assert(view, `${tap.game} has a live tap frame`);
      const el = surface(doc);
      ui.dispose?.();
      const captured = [];
      ui.render(el, clone(view), { send(a) { captured.push(a); } });
      const btn = el.querySelector(tap.sel);
      assert(btn && !btn.disabled, `${tap.game} exposes an enabled tap target`);
      btn.click();
      assert.equal(captured.length, 1, `${tap.game} tap emits exactly once`);
      assert(tap.key in captured[0], `${tap.game} tap payload carries ${tap.key}`);
      counts.taps++;
      ui.dispose?.();
    }

    /* WYR: final copy and points reflect the transmitted match model. */
    {
      const fixture = FIXTURES.find(f => f.id === 'would-you-rather');
      const { view } = findFrame(fixture, 'done', v => v.me === 'p1');
      const ui = await loadUi('would-you-rather');
      const el = surface(doc);
      const state = { ...clone(view), rounds: 1, scores: { p1: 225 }, totals: { p1: 925 }, last: { votes: {}, winners: [] } };
      ui.dispose?.();
      ui.render(el, state, { send() {} });
      assert.equal(el.querySelector('.gk-results-title').textContent, 'Final scores');
      assert(el.querySelector('.gk-ranks').textContent.includes('225'), 'WYR renders transmitted match points');
      assert(!el.querySelector('.gk-ranks').textContent.includes('925'), 'WYR does not label session points as match points');
      ui.dispose?.();
    }

    /* Reaction Tap retains keyboard focus through wait, snapshots and go. */
    {
      const ui = await loadUi('reaction-tap');
      const el = surface(doc), sent = [];
      let window = 'wait';
      const apiFor = token => ({ send(a) { assert.equal(token, window, 'persistent pad dispatches through the current action-window API'); sent.push(a); } });
      const api = apiFor(window);
      const wait = { phase: 'wait', round: 1, rounds: 2, instanceId: 'reaction-focus', me: 'p1', players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }, { id: 'p3', name: 'Cat' }], fouled: [], taps: {}, tip: 'Stay loose', strings: {} };
      ui.dispose?.();
      ui.render(el, wait, api);
      const pad = el.querySelector('#rPad');
      pad.focus();
      ui.render(el, { ...wait, fouled: ['p3'] }, api);
      assert(el.querySelector('#rPad') === pad, 'same-phase reaction snapshots preserve the native pad');
      window = 'go';
      const goApi = apiFor(window);
      ui.render(el, { ...wait, phase: 'go', preparing: true, fouled: ['p3'] }, goApi);
      assert(el.querySelector('#rPad') === pad, 'wait-to-go preserves the native pad');
      assert(doc.activeElement === pad, 'green signal preserves keyboard focus');
      assert(pad.classList.contains('is-wait') && !pad.classList.contains('is-go'), 'preparation cannot show the human green cue before the reaction clock starts');
      pad.onclick({ detail: 0 });
      assert.equal(sent.length, 0, 'a preparing phase cannot consume the one-tap guard');
      ui.render(el, { ...wait, phase: 'go' }, goApi);
      assert(pad.classList.contains('is-go'), 'green follows the released authoritative go phase');
      pad.onclick({ detail: 0 });
      pad.onclick({ detail: 0 });
      assert.deepEqual(sent, [{ tap: true }], 'keyboard activation emits once per round');
      ui.render(el, { ...wait, phase: 'go', taps: { p1: 240 } }, goApi);
      assert(pad.disabled && pad.textContent.includes('240 ms'), 'acknowledged tap locks the same target');
      window = 'wait2';
      ui.render(el, { ...wait, round: 2 }, apiFor(window));
      const fresh = el.querySelector('#rPad');
      assert(fresh !== pad, 'fresh round resets the single-tap guard');
      fresh.onclick({ detail: 0 });
      assert.equal(sent.length, 2, 'next round accepts its first tap');
      ui.render(el, { ...wait, spectator: true, me: 'watch' }, apiFor(window));
      assert(el.querySelector('#rPad').disabled, 'watchers cannot activate the pad');
      ui.dispose?.();
    }

    /* M9: owned CSS mobile contract (static; geometry proven in-browser). */
    const css = fs.readFileSync(path.join(ROOT, 'public/css/party-scenes.css'), 'utf8');
    // GAME_UI_STANDARD: prompts 26–32px on desktop, 22–26px on phones.
    assert(/party-prompt\.party-prompt \{[^}]*clamp\(2[6-9]px, [^,]+, (2[6-9]|3[0-2])px\)/.test(css), 'prompts stay large on desktop');
    assert(/party-prompt\.party-prompt \{ font-size: clamp\(2[2-6]px, [^,]+, 2[2-6]px\)/.test(css), 'prompts never drop below 22px on phones');
    assert(!/position\s*:\s*(fixed|sticky)/.test(css), 'no fixed chrome covers prompts or fields');
    assert(css.includes('overflow-wrap: anywhere'), 'long content wraps instead of overflowing');
    assert(css.includes('@media (max-height: 500px)'), 'short landscape keeps prompts readable');
    assert(css.includes('@media (max-width: 640px)'), 'narrow phones reflow choice grids');
    const btnRule = css.slice(css.indexOf('.party-scene .btn {'), css.indexOf('.party-scene .btn {') + 200);
    const btnMin = /min-height:\s*(\d+)px/.exec(btnRule);
    assert(btnMin && Number(btnMin[1]) >= 44 && btnRule.includes('min-width: 44px'), 'owned buttons keep 44px targets');
    const sizeOf = (sel) => {
      const i = css.indexOf(sel + ' {');
      const m = /min-height:\s*(\d+)px/.exec(css.slice(i, i + 600));
      return m ? Number(m[1]) : 0;
    };
    assert(sizeOf('.party-choice') >= 44, 'choices keep 44px targets');
    assert(sizeOf('.party-person') >= 44, 'player ballots keep 44px targets');
    const inputRule = css.slice(css.indexOf('input[type="text"] {'), css.indexOf('input[type="text"] {') + 400);
    const fsMatch = /font-size:\s*(\d+)px/.exec(inputRule);
    assert(fsMatch && Number(fsMatch[1]) >= 16, 'editable inputs avoid phone zoom');

    console.log(`PARTY_MOBILE_PASS: ${counts.renders} renders, ${counts.watchViews} watcher views, ` +
      `${Object.values(counts.acted).reduce((a, b) => a + b, 0)} lock-in proofs, ` +
      `${counts.composerChecks} composers (preserve/IME/Enter/clear), ${counts.taps} tap actions, ` +
      `${counts.ime} IME guards, rank reorder, deck/kind selection, CSS contract`);
  } finally {
    if (oldDoc === undefined) delete global.document; else global.document = oldDoc;
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
