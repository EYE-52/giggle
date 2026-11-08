'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, choose } = require('./truth-dare-modes');
const { makeDocument, surface } = require('./party-mobile');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
async function loadUi() {
  const util = data(fs.readFileSync(path.join(__dirname, '../public/js/util.js'), 'utf8'));
  return (await import(data(fs.readFileSync(path.join(__dirname, '../public/js/games/truth-dare.js'), 'utf8')
    .replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
}
async function run() {
  const ui = await loadUi(), prior = global.document;
  global.document = makeDocument();
  const el = surface(global.document), sent = [];
  const api = { send: a => { sent.push(a); return true; } };
  try {
    for (const n of [2, 3, 6]) {
      const x = setup(n, 'Ask your own'); choose(x, 'dare');
      const peer = x.peers()[0].id;
      const v = x.view(peer);
      ui.dispose(); ui.render(el, v, api);
      const input = el.querySelector('#tEntry'), button = el.querySelector('#tSendEntry');
      assert(input); assert.equal(input.getAttribute('maxlength'), '180'); assert(button.disabled);
      assert.equal(el.querySelector('#tEntryCount').textContent, '0 / 180');
      input.value = 'Act like a sleepy cat.'; input.oninput(); input.focus(); input.setSelectionRange(3, 7);
      assert(!button.disabled); assert.equal(el.querySelector('#tEntryCount').textContent, `${input.value.length} / 180`);
      ui.render(el, { ...v, submitted: ['someone-else'], myError: 'Please shorten your prompt.' }, api);
      assert.equal(el.querySelector('#tEntry'), input, 'broadcast keeps native field');
      assert.equal(input.value, 'Act like a sleepy cat.'); assert.equal(global.document.activeElement, input);
      assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 7);
      assert.equal(el.querySelector('#tEntryError').textContent, 'Please shorten your prompt.');
      const writingBefore = sent.length;
      ui.render(el, { ...v, preparing: true }, api); button.click();
      assert.equal(sent.length, writingBefore, 'preparation cannot send a prompt');
      ui.render(el, v, api);
      button.click(); button.click(); assert.deepEqual(sent.pop(), { entry: 'Act like a sleepy cat.' });
      assert(button.disabled); assert(el.querySelector('#tEntryHint').textContent.includes('Waiting'));
      const retired = button.onclick;
      x.act(peer, { entry: '<img src=x onerror=oops()> Be a cat.' });
      ui.render(el, x.view(peer), api);
      assert(!el.querySelector('#tEntry'), 'acknowledged writer sees a waiting card');
      assert(!el.querySelector('img'), 'written prompts are escaped');
      for (const role of [x.state.target, 'watch']) {
        ui.render(el, { ...x.view(role), spectator: role === 'watch' }, api);
        assert(!el.querySelector('#tEntry')); assert(!el.querySelector('#tSendEntry'));
      }
      const before = sent.length; retired(); assert.equal(sent.length, before, 'retired write handler cannot act');
      if (x.state.phase === 'compose') {
        ui.render(el, x.view(peer), api);
        assert(el.textContent.includes('locked in'));
      }

      const pool = setup(n, 'Room pool vote'); choose(pool);
      const voter = pool.peers()[0].id;
      ui.dispose(); ui.render(el, pool.view(voter), api);
      const cards = el.querySelectorAll('[data-prompt-vote]');
      assert.equal(cards.length, n >= 5 ? 4 : 3);
      cards[1].focus();
      ui.render(el, { ...pool.view(voter), serverNow: 3000, promptVoted: ['another-player'] }, api);
      assert.equal(el.querySelector('[data-prompt-vote="1"]'), cards[1], 'clock and peer votes keep cards mounted');
      assert.equal(global.document.activeElement, cards[1]);
      const pickingBefore = sent.length;
      ui.render(el, { ...pool.view(voter), preparing: true }, api); cards[1].click();
      assert.equal(sent.length, pickingBefore, 'preparation cannot lock a prompt pick');
      ui.render(el, pool.view(voter), api);
      cards[1].click(); cards[2].click(); assert.deepEqual(sent.pop(), { promptVote: 1 });
      pool.act(voter, { promptVote: 1 });
      ui.render(el, pool.view(voter), api);
      if (n > 2) {
        assert.equal(el.querySelectorAll('[data-prompt-vote]').length, cards.length, 'cards stay mounted after picking');
        assert(el.querySelectorAll('[data-prompt-vote]').every(b => b.disabled));
        assert.equal(el.querySelector('[data-prompt-vote="1"]').getAttribute('aria-pressed'), 'true');
        assert(el.textContent.includes('locked in'));
      }
      for (const role of [pool.state.target, 'watch']) {
        ui.render(el, { ...pool.view(role), spectator: role === 'watch' }, api);
        assert.equal(el.querySelectorAll('[data-prompt-vote]').length, 0, 'target/watcher cannot pick');
      }
      ui.dispose(); ui.render(el, v, api);
      assert.equal(el.querySelector('#tEntry').value, '', 'remount clears private draft');
      ui.render(el, { ...v, instanceId: 'new-match' }, api);
      assert.equal(el.querySelector('#tEntry').value, '', 'rematch clears private draft');
      ui.dispose();
    }
    const x = setup(2, 'Mixed');
    ui.render(el, x.view(x.state.target), api);
    el.querySelector('[data-deck="wild"]').click(); el.querySelector('#tSpinForMe').click();
    assert.deepEqual(sent.pop(), { deck: 'wild', kind: 'random' });
    assert.equal(sent.length, 0, 'each user action sends only once');
    // Cycling names looked like an early, conflicting result. Keep one
    // neutral label until the wheel's transition (or its fallback) settles.
    const savedInterval=global.setInterval,savedClear=global.clearInterval;
    let spinTick;
    try {
      global.setInterval=(fn,ms)=>{if(ms===110)spinTick=fn;return ms;};global.clearInterval=()=>{};
      ui.dispose();
      const spin={...x.view(x.state.target),phase:'spin',instanceId:'spin-label'};
      ui.render(el,spin,api);const label=el.querySelector('#tSpin');
      assert.equal(label.textContent,'Spinning…');
      for(let n=0;n<26;n++){spinTick();assert.equal(label.textContent,'Spinning…','no name is announced mid-spin');}
      spinTick();assert.equal(label.textContent,spin.players.find(p=>p.id===spin.target).name);
      ui.dispose();
    } finally {global.setInterval=savedInterval;global.clearInterval=savedClear;}
    console.log('TRUTH_DARE_MODES_VIEW_PASS: 2/3/6 player writing, counter, draft/focus, private roles, escaped cards, locked picks and Spin for me');
  } finally { ui.dispose(); if (prior === undefined) delete global.document; else global.document = prior; }
}
module.exports = { loadUi };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
