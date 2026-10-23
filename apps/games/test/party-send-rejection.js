'use strict';
// Production clients mounted on the shared minimal DOM. These regressions
// model the host's explicit false return for offline/preparing/stale sends;
// they are not native-browser or network acceptance evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument, surface } = require('./party-mobile');
const { FIXTURES } = require('./party-scenes-browser');
const { fixtures } = require('./skill-scenes-hud-fixtures');
const root = path.resolve(__dirname, '..');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const util = data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));
const clone = value => structuredClone(value);
async function load(id) {
  const source = fs.readFileSync(path.join(root, 'public/js/games', id + '.js'), 'utf8');
  return (await import(data(source.replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
}
function partyState(id, phase, role = () => true) {
  const views = FIXTURES.find(f => f.id === id).frames.flatMap(f => f.views);
  return clone(views.find(s => s.phase === phase && s.me !== 'watch' && role(s)));
}
function skillState(id, label) { return clone(fixtures[id].find(f => f.label === label).state); }
function gate() {
  return {
    window: 'one', rejected: true, sent: [],
    api(window = this.window) {
      return { now: () => 1700000000000, send: action => {
        if (this.rejected || window !== this.window) return false;
        this.sent.push(action);
        return true;
      } };
    },
  };
}

(async () => {
  const previous = global.document;
  const doc = global.document = makeDocument();
  try {
    for (const [id, base, inputSel, sendSel, field] of [
      ['twenty-questions', skillState('twenty-questions', 'Ask'), '#tQ', '#tQSend', 'question'],
      ['twenty-questions', skillState('twenty-questions', 'Ask'), '#tG', '#tGSend', 'guess'],
      ['emoji-story', partyState('emoji-story', 'guess', s => s.me !== s.director && !s.mySolved), '#eGuess', '#eSend', 'guess'],
    ]) {
      const ui = await load(id), el = surface(doc), host = gate();
      ui.dispose?.();
      ui.render(el, { ...base, preparing: true }, host.api());
      const input = el.querySelector(inputSel), send = el.querySelector(sendSel).onclick;
      assert(input && send, id + ' has a playable composer');
      input.value = 'My unsent & editable draft';
      send();
      assert.equal(input.value, 'My unsent & editable draft', id + ' preserves a rejected draft');
      assert.equal(host.sent.length, 0);
      host.rejected = false;
      ui.render(el, { ...base, qaSnapshot: 1 }, host.api());
      assert.equal(el.querySelector(inputSel), input, id + ' retains its composer across preparation release and same-window updates');
      send();
      assert.equal(input.value, '', id + ' clears only after an accepted local send');
      assert.deepEqual(host.sent, [{ [field]: 'My unsent & editable draft' }]);
      host.window = 'two';
      ui.render(el, { ...base, round: base.round + 1 }, host.api());
      const nextInput = el.querySelector(inputSel);
      nextInput.value = 'Next round private draft';
      send(); // A retired handler must not clear the new round's input.
      assert.equal(nextInput.value, 'Next round private draft', id + ' preserves a draft after stale-window rejection');
      assert.equal(host.sent.length, 1);
      ui.dispose?.(el);
    }

    {
      const ui = await load('number-hunt'), el = surface(doc), host = gate();
      const hunt = skillState('number-hunt', 'Hunt');
      ui.render(el, hunt, host.api());
      const input = el.querySelector('#nGuess'), send = el.querySelector('#nSend').onclick;
      input.value = '42';
      send();
      assert.equal(input.value, '42', 'Number Hunt preserves an offline draft');
      host.window = 'overtime';
      const overtime = skillState('number-hunt', 'Overtime');
      ui.render(el, overtime, host.api());
      assert.equal(el.querySelector('#nGuess'), input, 'overtime retains the current native input');
      ui.render(el, { ...overtime, preparing: true }, host.api());
      host.rejected = false;
      send();
      assert.equal(input.value, '42', 'preparation preserves the number draft');
      assert.equal(host.sent.length, 0);
      ui.render(el, overtime, host.api());
      send();
      assert.deepEqual(host.sent, [{ guess: 42 }], 'the retained input uses the released overtime API');
      assert.equal(input.value, '');
      ui.render(el, { ...hunt, round: hunt.round + 1 }, host.api());
      const fresh = el.querySelector('#nGuess');
      fresh.value = '51'; input.value = '52';
      send();
      assert.equal(host.sent.length, 1, 'retired number input cannot submit into a fresh round');
      assert.equal(fresh.value, '51');
      ui.dispose(el);
      send();
      assert.equal(host.sent.length, 1, 'disposed number input cannot submit');
    }

    {
      const ui = await load('warm-words'), el = surface(doc), host = gate();
      const state = skillState('warm-words', 'Search');
      ui.render(el, state, host.api());
      const input = el.querySelector('[data-ww-input]');
      const submit = el.querySelector('[data-ww-form]').onsubmit;
      const event = { preventDefault() {} };
      input.value = 'kitchen'; submit(event);
      assert.equal(input.value, 'kitchen', 'Warm Words preserves rejected drafts');
      host.rejected = false;
      ui.render(el, { ...state, preparing: true }, host.api());
      submit(event);
      assert.equal(host.sent.length, 0);
      ui.render(el, state, host.api());
      submit(event);
      assert.equal(input.value, '');
      assert.deepEqual(host.sent, [{ guess: 'kitchen' }]);
      ui.render(el, { ...state, round: state.round + 1 }, host.api());
      const fresh = el.querySelector('[data-ww-input]');
      fresh.value = 'forest'; input.value = 'kitchen'; submit(event);
      assert.equal(host.sent.length, 1, 'retired form cannot send into a new round');
      assert.equal(fresh.value, 'forest');
      ui.dispose(); submit(event);
      assert.equal(host.sent.length, 1, 'disposed Warm Words form is inert');
    }

    {
      const ui = await load('reaction-tap'), el = surface(doc), host = gate();
      const go = skillState('reaction-tap', 'Go');
      ui.render(el, go, host.api());
      const pad = el.querySelector('#rPad');
      pad.click();
      assert.equal(host.sent.length, 0);
      host.rejected = false;
      pad.click(); pad.click();
      assert.deepEqual(host.sent, [{ tap: true }], 'rejected Reaction contact does not consume the one-tap guard');
      ui.dispose();
    }

    {
      const ui = await load('would-you-rather'), el = surface(doc), host = gate();
      const state = partyState('would-you-rather', 'vote', s => !s.myVote);
      ui.dispose(); ui.render(el, state, host.api());
      const choice = el.querySelector('[data-v="a"]'), send = choice.onclick;
      send();
      assert(!choice.disabled, 'a rejected vote leaves both choices available');
      assert.equal(choice.getAttribute('aria-pressed'), 'false');
      assert(!el.querySelector('#wyrStatus').textContent.includes('Sending'));
      host.rejected = false;
      ui.render(el, { ...state, preparing: true }, host.api()); send();
      assert.equal(host.sent.length, 0, 'preparing does not consume an optimistic vote');
      ui.render(el, state, host.api()); send();
      assert.deepEqual(host.sent, [{ vote: 'a' }]);
      assert(choice.disabled && choice.classList.contains('is-picked'), 'accepted local send locks the live choice');
      ui.render(el, { ...state, phase: 'reveal', myVote: null, last: { votes: {}, winners: [] } }, host.api());
      assert(!choice.classList.contains('is-picked'), 'reveal displays only authoritative ballots');
      ui.render(el, { ...state, round: state.round + 1 }, host.api()); send();
      assert.equal(host.sent.length, 1, 'retired choice cannot repaint or vote in a new round');
      assert.equal(el.querySelector('.wyr-world').getAttribute('data-state'), 'open');
      ui.dispose(); send();
      assert.equal(host.sent.length, 1);
    }
    for (const [id, phase, role, selectors, button, value, expected] of [
      ['emoji-story','emoji',s=>s.me===s.director,['#eEmoji'],'#eSend2','🐈🎩',{emoji:'🐈🎩'}],
      ['compliment-battle','write',s=>s.me!==s.target&&!s.myEntry,['#cbEntry'],'#cbSend','A kind note',{entry:'A kind note'}],
      ['roast-toast','write',s=>s.me!==s.target&&!s.myEntry,['#rtEntry'],'#rtSend','A friendly roast',{entry:'A friendly roast'}],
      ['hot-takes','submit',()=>true,['#hTake'],'#hSend','A spicy opinion',{take:'A spicy opinion'}],
      ['two-truths','write',s=>s.me===s.subject,['#tS0','#tS1','#tS2'],'#tSend','My statement',{statements:['My statement','My statement','My statement'],lie:2}],
    ]) {
      const isolated = global.document = makeDocument(), ui = await load(id), el = surface(isolated), host = gate();
      const state = partyState(id,phase,role);
      ui.dispose?.(); ui.render(el,state,host.api());
      const inputs = selectors.map(selector=>el.querySelector(selector)), send = el.querySelector(button).onclick;
      assert(inputs.every(Boolean),id+' has its eligible composer');
      for (const input of inputs) {input.value=value;input.setSelectionRange(1,3);}
      send();
      assert.equal(host.sent.length,0,id+' rejected send is not accepted');
      if (id==='emoji-story') assert(el.querySelector('#eEmojiError').textContent.includes('Could not send.'),
        'director sees rejected send feedback');
      for (const input of inputs) {
        assert.equal(input.value,value,id+' offline draft stays');
        assert.deepEqual([input.selectionStart,input.selectionEnd],[1,3],id+' offline selection stays');
      }
      host.rejected=false;
      ui.render(el,{...state,preparing:true},host.api()); send();
      assert.equal(host.sent.length,0,id+' preparation cannot send retained draft');
      ui.render(el,state,host.api());
      selectors.forEach((selector,i)=>assert.equal(el.querySelector(selector),inputs[i],id+' release retains native input'));
      assert.equal(host.sent.length,0,id+' release does not auto-send');
      send(); assert.deepEqual(host.sent,[expected],id+' explicit connected retry sends once');
      ui.dispose?.(); global.document=doc;
    }
    {
      const isolated=global.document=makeDocument(),ui=await load('dare-roulette'),el=surface(isolated),host=gate();
      const state=partyState('dare-roulette','spin');
      ui.dispose();ui.render(el,state,host.api());
      const spin=el.querySelector('#drSpin'),send=spin.onclick;
      send(); assert(!spin.disabled,'rejected spin remains available'); assert.equal(host.sent.length,0);
      host.rejected=false; ui.render(el,{...state,preparing:true},host.api()); send();
      assert.equal(host.sent.length,0,'preparation cannot spin');
      ui.render(el,state,host.api());el.querySelector('#drSpin').onclick();
      assert.deepEqual(host.sent,[{spin:true}],'explicit connected retry spins once');
      assert(el.querySelector('#drSpin').disabled,'accepted spin locks until authority responds');
      ui.dispose();global.document=doc;
    }
    {
      const isolated=global.document=makeDocument(),ui=await load('emoji-story'),el=surface(isolated),host=gate();
      const state=partyState('emoji-story','guess',s=>s.me!==s.director&&!s.mySolved);
      const api=host.api();let now=state.endsAt-1;api.now=()=>now;
      ui.dispose();ui.render(el,state,api);
      const input=el.querySelector('#eGuess');input.value='Last moment draft';input.setSelectionRange(2,7);
      el.querySelector('#eSend').onclick();
      assert.equal(host.sent.length,0,'offline Emoji guess is not accepted');
      assert.equal(input.value,'Last moment draft','offline Emoji guess preserves draft');
      assert(el.querySelector('#eGuessStatus').textContent.includes('Could not send.'),'offline Emoji guess explains retry');
      host.rejected=false;now=state.endsAt;
      el.querySelector('#eSend').onclick();
      assert.equal(host.sent.length,0,'expired Emoji guess never reaches transport');
      assert.equal(input.value,'Last moment draft','expired Emoji guess preserves draft');
      assert.deepEqual([input.selectionStart,input.selectionEnd],[2,7],'expired Emoji guess preserves selection');
      assert.equal(el.querySelector('#eGuessStatus').textContent,'Time’s up. Your guess was not sent.');
      ui.render(el,{...state,heartbeat:true},api);
      assert.equal(el.querySelector('#eGuess'),input,'expired heartbeat retains composer and feedback');
      ui.dispose();global.document=doc;
    }
    console.log('PARTY_SEND_REJECTION_PASS: offline/preparing/stale drafts, composer and spin retry, Emoji deadline feedback, authoritative vote reveal and rejected contact retry');
  } finally {
    if (previous === undefined) delete global.document; else global.document = previous;
  }
})().catch(error => { console.error(error); process.exit(1); });
