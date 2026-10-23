'use strict';
// Mounted-client regressions, using engine-derived party projections and the
// existing skill fixtures. This minimal DOM does not establish browser geometry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument, surface } = require('./party-mobile');
const { FIXTURES } = require('./party-scenes-browser');
const { fixtures, create } = require('./skill-scenes-hud-fixtures');
const root = path.resolve(__dirname, '..');
const data = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const util = data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));
async function load(id) {
  return (await import(data(fs.readFileSync(path.join(root, 'public/js/games', id + '.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
}
const copy = structuredClone;
const phases = { bluff:'pick', trivia:'answer', 'dare-roulette':'verdict' };
(async () => {
  const oldDoc = global.document, oldWindow = global.window;
  const doc = global.document = makeDocument();
  global.window = { matchMedia:() => ({ matches:true }) };
  let retained = 0, cueChecks = 0;
  try {
    for (const id of ['never-ever','most-likely','hot-takes','two-truths','funny-answer','bluff','story-builder','trivia','roast-toast','compliment-battle','truth-dare','dare-roulette','pick-one','rapid-polls']) {
      const ui = await load(id), el = surface(doc), sent = [];
      const api = version => ({ send(a) { sent.push({ version, a }); } });
      const states = FIXTURES.find(f => f.id === id).frames.flatMap(f => f.views);
      let S, button;
      for (const state of states.filter(s => s.phase === (phases[id] || 'vote') && s.me !== 'watch')) {
        ui.dispose?.();
        S = { ...copy(state), instanceId:'quality-' + id };
        ui.render(el, S, api(1));
        button = el.querySelectorAll('button').find(b => !b.disabled && (b.dataset.v != null || b.dataset.p != null));
        if (button) break;
      }
      assert(button, id + ' has an actionable projection');
      button.focus();
      const peer = S.players.find(p => p.id !== S.me).id;
      const update = { ...S, voted:[peer], answered:[peer] };
      if (id === 'rapid-polls') update.counts = S.poll.options.map((_, i) => i ? 0 : 1);
      ui.render(el, update, api(2));
      assert(el.querySelectorAll('button').includes(button), id + ' retains the live ballot');
      assert.equal(doc.activeElement, button, id + ' retains focused vote');
      const oldClick = button.onclick;
      oldClick();
      assert.equal(sent.at(-1).version, 2, id + ' uses the fresh API on the retained ballot');
      const accepted = sent.length;
      ui.render(el, { ...update, preparing:true }, api(3));
      oldClick();
      assert.equal(sent.length, accepted, id + ' blocks same-phase preparation without relying on the transport gate');
      ui.render(el, { ...update, spectator:true }, api(3));
      oldClick();
      assert.equal(sent.length, accepted, id + ' retires a player control when the player becomes a spectator');
      ui.render(el, { ...update, players:update.players.filter(p => p.id !== update.me) }, api(3));
      oldClick();
      assert.equal(sent.length, accepted, id + ' blocks a removed player even when the spectator flag is absent');
      const role = id === 'hot-takes' ? { current:{ ...update.current, mine:true } }
        : id === 'bluff' ? { myOption:button.dataset.v }
        : id === 'funny-answer' || id === 'compliment-battle' ? { myEntry:button.dataset.v }
        : id === 'story-builder' ? { myLines:[Number(button.dataset.v)] }
        : id === 'two-truths' ? { subject:update.me }
        : id === 'dare-roulette' ? { victim:update.me }
        : { target:update.target === update.me ? peer : update.me };
      ui.render(el, { ...update, ...role }, api(3));
      oldClick();
      assert.equal(sent.length, accepted, id + ' retires the old role or own-entry ballot');
      ui.render(el, { ...update, round:(S.round || 0) + 1 }, api(3));
      const before = sent.length;
      oldClick();
      assert.equal(sent.length, before, id + ' retires the previous round handler');
      ui.dispose?.();
      oldClick();
      assert.equal(sent.length, before, id + ' retires disposed handlers');
      retained++;
    }
    {
      const ui = await load('two-truths'), el = surface(doc), sent = [];
      const S = { ...copy(FIXTURES.find(f => f.id === 'two-truths').frames.flatMap(f => f.views).find(s => s.phase === 'write' && s.me === s.subject)), instanceId:'quality-truths-writer', idea:'A <garden> & picnic' };
      ui.render(el, S, { send:a => sent.push(a) });
      assert(ui.styles.includes('/css/two-truths.css'));
      assert(el.querySelector('.truths-writer'));
      assert.equal(el.querySelector('details').getAttribute('open'), null, 'optional idea starts closed');
      assert.equal(el.querySelector('.truths-idea').textContent, 'Need an idea?A <garden> & picnic');
      assert.equal(el.querySelector('garden'), null, 'idea renders as text rather than markup');
      assert(el.innerHTML.indexOf('id="tSend"') < el.innerHTML.indexOf('<details'), 'optional idea follows writing controls');
      const first = el.querySelector('#tS0'), submit = el.querySelector('#tSend').onclick;
      first.value = 'My private draft'; first.focus(); first.setSelectionRange(3, 7);
      ui.render(el, { ...S, voted:['peer'] }, { send:a => sent.push(a) });
      assert.equal(el.querySelector('#tS0'), first); assert.equal(first.value, 'My private draft');
      assert.equal(doc.activeElement, first); assert.equal(first.selectionStart, 3);
      ui.render(el, { ...S, spectator:true }, { send:a => sent.push(a) });
      assert.equal(el.querySelector('#tS0'), null); assert.equal(el.querySelector('.truths-writer'), null);
      submit(); assert.equal(sent.length, 0, 'retired private author control cannot submit');
      ui.dispose(); submit(); assert.equal(sent.length, 0);
    }
    {
      const ui = await load('rank-it'), el = surface(doc), sent = [];
      const S = { ...copy(FIXTURES.find(f => f.id === 'rank-it').frames.flatMap(f => f.views).find(s => s.phase === 'rank' && s.me !== 'watch')), instanceId:'quality-rank' };
      const api = { send(a) { sent.push(a); } };
      ui.render(el, S, api);
      const lock = el.querySelector('#rLock'), reorder = el.querySelector('[data-dn="0"]');
      const rank = el.querySelector('.party-rank-list');
      ui.render(el, { ...S, preparing:true }, api);
      lock.onclick(); reorder.onclick();
      assert.equal(sent.length, 0, 'rank preparation blocks sending and stale reordering');
      assert.equal(el.querySelector('.party-rank-list'), rank, 'rank preparation preserves the private ladder');
      ui.render(el, { ...S, players:S.players.filter(p => p.id !== S.me) }, api);
      lock.onclick(); reorder.onclick();
      assert.equal(sent.length, 0, 'rank removal retires private controls');
      ui.dispose();
    }
    {
      const ui = await load('emoji-story'), el = surface(doc), sent = [];
      const S = { ...copy(FIXTURES.find(f => f.id === 'emoji-story').frames.flatMap(f => f.views).find(s => s.phase === 'guess' && s.me !== 'watch' && s.me !== s.director && !s.mySolved)), instanceId:'quality-emoji' };
      const api = version => ({ send(a) { sent.push({ version, a }); } });
      ui.render(el, S, api(1));
      const input = el.querySelector('#eGuess'), send = el.querySelector('#eSend').onclick;
      input.value = 'My guess'; input.focus(); input.setSelectionRange(1, 4);
      ui.render(el, { ...S, preparing:true }, api(2)); send();
      assert.equal(sent.length, 0, 'emoji readiness preserves the unsent draft');
      assert.equal(input.value, 'My guess'); assert.equal(doc.activeElement, input);
      ui.render(el, S, api(3)); send();
      assert.equal(sent.at(-1).version, 3, 'emoji retained draft uses the released API');
      assert.equal(input.value, '');
      ui.render(el, { ...S, director:S.me }, api(4)); send();
      assert.equal(sent.length, 1, 'emoji old guesser control retires when becoming director');
      ui.dispose(); send(); assert.equal(sent.length, 1);
    }
    {
      const ui = await load('story-builder'), el = surface(doc), sent = [];
      const view = FIXTURES.find(f => f.id === 'story-builder').frames.flatMap(f => f.views).find(s => s.phase === 'build' && s.me === s.turn);
      const S = { ...copy(view), instanceId:'quality-story-long', lines:Array.from({ length:40 }, (_, i) => ({ pid:view.players[i % view.players.length].id, text:`Sentence ${i + 1}: ` + 'An unexpected visitor rang the bell. '.repeat(6) })) };
      ui.render(el, S, { send(a) { sent.push(a); } });
      assert(el.innerHTML.indexOf('id="sLine"') < el.innerHTML.indexOf('class="sb-story"'), 'active Story composer precedes an arbitrarily long manuscript');
      assert.equal(el.querySelectorAll('.sb-line').length, 40, 'all narrative lines remain readable in the manuscript');
      assert(ui.styles.includes('/css/story-builder.css'), 'Story declares its writer layout stylesheet for readiness');
      assert(el.querySelector('.story-writer'), 'compact layout scope exists only on the active writer');
      const input = el.querySelector('#sLine'), send = el.querySelector('#sSend').onclick;
      input.value = 'My next sentence'; input.focus(); input.setSelectionRange(3, 7);
      ui.render(el, { ...S, preparing:true, lines:[...S.lines, { pid:S.me, text:'The manuscript was corrected.' }] }, { send(a) { sent.push(a); } });
      assert.equal(el.querySelector('#sLine'), input, 'Story correction keeps the composer node');
      assert.equal(input.value, 'My next sentence'); assert.equal(doc.activeElement, input);
      assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 7);
      assert.equal(el.querySelectorAll('.sb-line').length, 41, 'same-window narrative corrections update without resetting the draft');
      send(); assert.equal(sent.length, 0, 'long-story readiness keeps the private draft unsent');
      const next = S.players.find(p => p.id !== S.me).id;
      ui.render(el, { ...S, turn:next }, { send(a) { sent.push(a); } });
      assert.equal(el.querySelector('#sLine'), null, 'waiting author sees the full narrative without a sendable field');
      send(); assert.equal(sent.length, 0, 'former Story author control cannot send');
      ui.render(el, { ...S, endsAt:(S.endsAt || 0) + 1 }, { send(a) { sent.push(a); } });
      assert.equal(el.querySelector('#sLine').value, '', 'new author turn starts with a fresh draft');
      ui.render(el, { ...S, spectator:true }, { send(a) { sent.push(a); } });
      assert.equal(el.querySelector('.story-writer'), null, 'watcher cannot acquire writer layout or private composer');
      assert.equal(el.querySelector('#sLine'), null);
      send(); assert.equal(sent.length, 0, 'retired writer handler cannot send for watcher');
      ui.dispose();
      send(); assert.equal(sent.length, 0, 'disposed writer handler cannot send');
    }
    {
      const ui = await load('twenty-questions'), el = surface(doc);
      const S = { ...copy(fixtures['twenty-questions'].find(f => f.label === 'Ask').state), instanceId:'quality-questions' };
      S.questions = ['yes','no','sometimes'].map((answer, i) => ({ pid:S.players[0].id, text:'Question ' + (i + 1), answer }));
      S.answered = 3;
      ui.render(el, S, { send() {} });
      const input = el.querySelector('#tQ'), filters = el.querySelector('.tq-filters');
      input.value = 'A private draft'; input.focus(); input.setSelectionRange(2, 5);
      assert.equal(el.querySelectorAll('.tq-row')[0].textContent.includes('Question 3'), true, 'history is newest first');
      filters.onclick({ target:filters.querySelector('[data-filter="no"]') });
      assert.equal(el.querySelectorAll('.tq-row').length, 1, 'No filter shows only No answers');
      assert.equal(el.querySelectorAll('.tq-row')[0].textContent.includes('Question 2'), true);
      ui.render(el, { ...S, questions:[...S.questions, { pid:S.players[0].id, text:'Question 4', answer:'no' }], answered:4 }, { send() {} });
      assert.equal(el.querySelector('#tQ'), input, 'history update preserves input node');
      assert.equal(input.value, 'A private draft'); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5);
      assert.equal(doc.activeElement, input); assert.equal(el.querySelector('.tq-filters'), filters);
      assert.equal(el.querySelectorAll('.tq-row')[0].textContent.includes('Question 4'), true);
      assert.equal(filters.querySelector('[data-filter="no"]').textContent, 'No 2');
      ui.dispose();
    }
    // A correct cue follows an actual change in authoritative result data;
    // mounting, reconnect baseline and repeated snapshots stay silent.
    for (const [id, prePhase, correct] of [
      ['trivia','answer', s => s.last?.results?.[s.me]?.ok],
      ['two-truths','vote', s => s.last?.votes?.[s.me] != null && s.last.votes[s.me] === s.last.lie],
      ['bluff','pick', s => s.last?.picks?.[s.me] === s.last?.truthOid],
    ]) {
      const f = FIXTURES.find(f => f.id === id), views = f.frames.flatMap(f => f.views);
      let result = views.find(s => s.phase === 'reveal' && s.me !== 'watch' && correct(s));
      let before = result && views.find(s => s.phase === prePhase && s.round === result.round && s.me === result.me);
      if (id === 'bluff') {
        // The broad fixture deliberately chooses arbitrary legal answers.
        // Drive a confirmed truth pick through the engine for this cue check.
        const { ctx, game, s } = create(id);
        const project = () => ({ ...copy(game.view(s, 'a')), me:'a', players:ctx.roster, hostId:'a' });
        for (const p of ctx.roster) game.onAction(s, ctx, p.id, { fake:'A convincing invention from ' + p.name });
        before = project();
        const truth = s.options.find(o => o.pid === null).oid;
        for (const p of ctx.roster) game.onAction(s, ctx, p.id, { pick:truth });
        result = project();
      }
      assert(result, id + ' fixture has a real correct result');
      assert.equal(correct(result), true, id + ' engine confirms correctness');
      const ui = await load(id), el = surface(doc), cues = [];
      const api = { send() {}, cue(name, options) { cues.push({ name, options }); } };
      const stamp = s => ({ ...copy(s), instanceId:'quality-cue-' + id });
      ui.dispose?.(); ui.render(el, stamp(result), api); assert.equal(cues.length, 0, id + ' initial result is silent');
      ui.dispose?.(); ui.render(el, stamp(before), api); ui.render(el, stamp(result), api); ui.render(el, stamp(result), api);
      assert.equal(cues.length, 1, id + ' confirmed correctness sounds once');
      assert.equal(cues[0].name, 'correct'); assert(cues[0].options.id.startsWith('quality-cue-' + id + ':'));
      ui.dispose?.(); ui.render(el, stamp(before), api); ui.render(el, { ...stamp(result), audioBaseline:true }, api); ui.render(el, stamp(result), api);
      assert.equal(cues.length, 1, id + ' reconnect baseline remains silent');
      ui.dispose?.(); cueChecks++;
    }
    for (const id of ['emoji-story','memory-tray','twenty-questions']) {
      let before, result;
      if (id === 'emoji-story') {
        const views = FIXTURES.find(f => f.id === id).frames.flatMap(f => f.views);
        result = views.find(s => s.phase === 'guess' && s.mySolved);
        before = views.find(s => s.phase === 'guess' && s.round === result.round && s.me === result.me && !s.mySolved);
      } else {
        before = fixtures[id].find(f => f.label === (id === 'memory-tray' ? 'Recall' : 'Ask')).state;
        result = { ...fixtures[id].find(f => f.label === 'Reveal').state, me:before.me };
      }
      const ui = await load(id), el = surface(doc), cues = [];
      const api = { send() {}, cue(name, options) { cues.push({ name, options }); } };
      const stamp = s => ({ ...copy(s), instanceId:'quality-cue-' + id });
      ui.dispose?.(); ui.render(el, stamp(result), api); assert.equal(cues.length, 0, id + ' initial solved result is silent');
      ui.dispose?.(); ui.render(el, stamp(before), api); ui.render(el, stamp(result), api); ui.render(el, stamp(result), api);
      assert.equal(cues.length, 1, id + ' confirmed correctness sounds once');
      assert.equal(cues[0].name, 'correct'); assert(cues[0].options.id.startsWith('quality-cue-' + id + ':'));
      ui.dispose?.(); ui.render(el, stamp(before), api); ui.render(el, { ...stamp(result), audioBaseline:true }, api); ui.render(el, stamp(result), api);
      assert.equal(cues.length, 1, id + ' reconnect baseline stays silent');
      ui.dispose?.(); ui.render(el, stamp(before), api); ui.render(el, { ...stamp(result), spectator:true }, api);
      assert.equal(cues.length, 1, id + ' watcher correctness stays silent');
      ui.dispose?.(); cueChecks++;
    }
    const css = fs.readFileSync(path.join(root, 'public/css/twenty-questions.css'), 'utf8');
    assert(!css.includes('overflow-y:auto'), 'question notebook has no nested vertical scroll');
    console.log(`PARTY_QUALITY_VIEW_PASS: ${retained} stable ballot/focus/current-API/retired-control paths with preparation, spectator, membership and role guards; private rank ladder and 40-line Story composer/focus/role checks; newest-first filtered history and private draft preserved; ${cueChecks} correct-cue initial/repeat/reconnect checks`);
  } finally {
    if (oldDoc === undefined) delete global.document; else global.document = oldDoc;
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
  }
})().catch(error => { console.error(error.message); process.exit(1); });
