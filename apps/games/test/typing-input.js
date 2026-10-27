'use strict';
// Reproduce stale retained input events and the lost keyboard focus at a new
// Typing race. Production view + capability helper; no retry or fake scoring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

function dom() {
  const body = {}, doc = { body, activeElement: body, modal: false,
    querySelector() { return this.modal ? {} : null; } };
  const el = { ownerDocument: doc, isConnected: true, inert: false, nodes: {},
    set innerHTML(html) {
      if (this.nodes['#tInput']) this.nodes['#tInput'].isConnected = false;
      this.nodes = {};
      for (const id of ['tTarget', 'tInput', 'tGridStatus', 'tTypingStatus']) {
        if (!html.includes(`id="${id}"`)) continue;
        this.nodes['#' + id] = { value: '', innerHTML: '', textContent: '', isConnected: true,
          disabled: id === 'tInput' && /<input[^>]*\bdisabled\b/.test(html),
          closest: () => this.inert ? this : null };
      }
    },
    querySelector(id) { return this.nodes[id] || null; },
    querySelectorAll() { return []; } };
  return { el, doc };
}
const state = changes => ({ phase: 'race', instanceId: 'first', w: 'first-race',
  round: 1, rounds: 2, me: 'a', target: 'abc', progress: {}, finished: [],
  players: [{ id: 'a', name: 'Ada' }], scores: {}, ...changes });

(async () => {
  let source = fs.readFileSync(path.join(root, 'public/js/games/typing-race.js'), 'utf8');
  for (const [from, file] of [['../util.js', 'util.js'],
    ['../toolkit/input-capabilities.mjs', 'toolkit/input-capabilities.mjs']]) {
    source = source.replace(`'${from}'`, JSON.stringify(data(fs.readFileSync(path.join(root, 'public/js', file), 'utf8'))));
  }
  source = source.replace("'../kit.js'", JSON.stringify(require('./_kit-url')(data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8')))));
  const view = (await import(data(source))).default;
  const media = global.matchMedia, width = global.innerWidth;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const sent = [], focused = [];
  let { el, doc } = dom();
  const api = stamp => ({ send: action => sent.push({ stamp, ...action }),
    focus: input => { focused.push(input); doc.activeElement = input; } });
  try {
    global.innerWidth = 390;
    Object.defineProperty(global, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true });
    global.matchMedia = query => ({ matches: ['(pointer: fine)', '(hover: hover)', '(any-pointer: coarse)'].includes(query) });
    view.render(el, state(), api('old-snapshot'));
    const first = el.querySelector('#tInput');
    view.render(el, state({ progress: { a: 1 } }), api('latest-snapshot'));
    first.value = 'abc'; first.oninput();
    assert.deepEqual(sent, [{ stamp: 'latest-snapshot', typed: 'abc' }], 'same input dispatches through the latest rendered API');
    view.render(el, state({ finished: [{ pid: 'a', ms: 1000, pts: 150 }] }), api('finished'));
    first.disabled = false; first.value = 'aXc'; first.oninput();
    assert.equal(sent.length, 1, 'queued input after the authoritative finish cannot send again');
    assert.equal(el.querySelector('#tTypingStatus').textContent, 'Finished — your time is locked in.');

    const next = state({ round: 2, w: 'next-race', target: 'xyz', preparing: true });
    view.render(el, next, api('preparing'));
    const second = el.querySelector('#tInput');
    first.oninput(); second.value = 'xy'; second.oninput();
    await Promise.resolve();
    assert.equal(sent.length, 1, 'retired input and preparation events cannot send');
    assert.equal(focused.length, 0, 'preparation does not focus a new input');
    const painted = el.querySelector('#tTarget').innerHTML;
    first.oninput();
    assert.equal(el.querySelector('#tTarget').innerHTML, painted, 'retired input cannot repaint the next target');
    view.render(el, { ...next, preparing: false }, api('released'));
    await Promise.resolve();
    assert.equal(doc.activeElement, second, 'narrow touch laptop with fine pointer keeps keyboard focus after release');
    assert.equal(focused.length, 1);
    view.render(el, { ...next, preparing: false }, api('latest-released'));
    await Promise.resolve();
    assert.equal(focused.length, 1, 'heartbeat does not steal focus again');
    second.value = 'xyz'; second.oninput();
    assert.deepEqual(sent.at(-1), { stamp: 'latest-released', typed: 'xyz' });

    view.render(el, { ...next, preparing: false, spectator: true }, api('watching'));
    second.oninput();
    assert.equal(sent.length, 2, 'role transition retires the playing input');
    view.render(el, state({ instanceId: 'rematch', w: 'rematch-race' }), api('rematch'));
    const rematchInput = el.querySelector('#tInput');
    second.oninput();
    assert.equal(sent.length, 2, 'old round input cannot act in a rematch');
    view.dispose(); rematchInput.value = 'abc'; rematchInput.oninput();
    assert.equal(sent.length, 2, 'disposal invalidates the input handler');

    ({ el, doc } = dom()); focused.length = 0;
    global.matchMedia = query => ({ matches: ['(pointer: coarse)', '(any-pointer: coarse)'].includes(query) });
    view.render(el, next, api('phone-preparing'));
    view.render(el, { ...next, preparing: false }, api('phone-released'));
    await Promise.resolve();
    assert.equal(focused.length, 0, 'coarse phone input does not open a software keyboard automatically');
    el.querySelector('#tInput').value = 'xyz'; el.querySelector('#tInput').oninput();
    assert.equal(sent.at(-1).stamp, 'phone-released', 'phone still supports text input');
    view.dispose();

    global.matchMedia = query => ({ matches: ['(pointer: fine)', '(hover: hover)'].includes(query) });
    for (const block of ['modal', 'other-control', 'dispose']) {
      ({ el, doc } = dom());
      if (block === 'modal') doc.modal = true;
      if (block === 'other-control') doc.activeElement = {};
      view.render(el, { ...next, preparing: false }, api(block));
      if (block === 'dispose') view.dispose();
      await Promise.resolve();
      assert.equal(focused.length, 0, `${block} prevents deferred focus`);
      view.dispose();
    }
    ({ el, doc } = dom());
    view.render(el, state(), api('large-paste'));
    const pasted = el.querySelector('#tInput');
    pasted.value = 'abc' + 'x'.repeat(1024 * 1024);
    pasted.oninput();
    assert.deepEqual(sent.at(-1), { stamp: 'large-paste', typed: 'abc' + 'x'.repeat(20) }, 'large paste transmits only the authority-equivalent prefix');
    assert.equal(pasted.value.length, 1024 * 1024 + 3, 'local input is not silently rewritten');
    assert.match(el.querySelector('#tTypingStatus').textContent, /remove the extra text/, 'extra pasted text still requires correction');
    assert.ok(Buffer.byteLength(JSON.stringify(sent.at(-1))) < 1024 * 1024, 'shipping action stays below decoded socket cap');
    pasted.value = 'abc'; pasted.oninput();
    assert.deepEqual(sent.at(-1), { stamp: 'large-paste', typed: 'abc' }, 'correcting the paste can still submit the exact sentence');
    view.dispose(); ({ el, doc } = dom());
    let usable = false;
    const delayedApi = { ...api('after-fonts'), isUsable: () => usable };
    const delayedState = state({ round: 2 });
    view.render(el, delayedState, delayedApi);
    const delayed = el.querySelector('#tInput');
    assert.equal(delayed.disabled, true, 'live field stays disabled while host waits for fonts');
    const before = sent.length;
    delayed.value = 'a'; delayed.oninput();
    assert.equal(sent.length, before, 'preusable input cannot send');
    doc.modal = true; usable = true;
    view.usabilityChanged(el, delayedState, delayedApi); await Promise.resolve();
    assert.equal(delayed.disabled, false, 'readiness callback enables current live input');
    assert.notEqual(doc.activeElement, delayed, 'dialog focus is preserved when readiness releases');
    delayed.value = 'ab'; delayed.oninput();
    assert.deepEqual(sent.at(-1), { stamp: 'after-fonts', typed: 'ab' }, 'first legal input dispatches after readiness');
    view.render(el, { ...delayedState, w: 'new-window', preparing: true }, delayedApi);
    const nextDelayed = el.querySelector('#tInput');
    view.usabilityChanged(el, delayedState, delayedApi);
    assert.equal(nextDelayed.disabled, true, 'old-window callback cannot enable preparation');
    view.dispose(); view.usabilityChanged(el, delayedState, delayedApi);
    assert.equal(nextDelayed.disabled, true, 'retired callback cannot reenable input');
    console.log('Typing input: latest snapshot, finish lock, preparation, retired round/role/rematch/disposal, safe round focus and bounded large paste PASS');
  } finally {
    view.dispose();
    if (media === undefined) delete global.matchMedia; else global.matchMedia = media;
    if (width === undefined) delete global.innerWidth; else global.innerWidth = width;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor); else delete global.navigator;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
