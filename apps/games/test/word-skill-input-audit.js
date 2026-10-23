'use strict';
// Production handlers in the existing small DOM fixture. These are controlled
// lifecycle/reconnect checks, not physical keyboard or mobile-device evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeDocument, surface } = require('./party-mobile');
const { fixtures, accepted } = require('./skill-scenes-hud-fixtures');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
(async () => {
  const util = data(fs.readFileSync(require.resolve('../public/js/util.js'), 'utf8'));
  const old = global.document;
  global.document = makeDocument();
  let checks = 0;
  const games = {
    scattergories: ['Write', '#sc0', '#scSave', 'seal'],
    'countdown-word': ['Build', '#cwWord', '#cwSave', 'late'],
    'word-chain': ['Your turn', '#wcWord', '#wcGo', 'fruit'],
    'memory-tray': ['Recall', '#mAns', '#mSend', 'apple, key'],
    'twenty-questions': ['Ask', '#tQ', '#tQSend', 'Is it alive?'],
    'number-hunt': ['Hunt', '#nGuess', '#nSend', '42'],
  };
  try {
    for (const [id, [label, selector, buttonSelector, draft]] of Object.entries(games)) {
      const source = fs.readFileSync(require.resolve('../public/js/games/' + id), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const view = (await import(data(source))).default, el = surface(global.document);
      const S = {...fixtures[id].find(f => f.label === label).state, endsAt: 10000};
      const sent = [];
      const api = (label, now = 1000) => ({now: () => now, send: a => {sent.push({label, ...a}); return label !== 'offline';}});
      const paint = (s, a) => (view.update || view.render).call(view, el, s, a);
      view.mount?.(el, api('offline')); paint(S, api('offline'));
      const input = el.querySelector(selector), button = el.querySelector(buttonSelector), retired = button.onclick;
      input.value = draft; button.click();
      assert.equal(input.value, draft, id + ' rejected send keeps the draft'); checks++;
      if (id === 'memory-tray') {
        assert.match(el.querySelector('#mState').textContent, /Could not save yet/, 'Memory refusal gives explicit retry feedback'); checks++;
      }
      paint({...S, repeated: true}, api('connected')); assert.equal(el.querySelector(selector), input, id + ' retains input across reconnect snapshot'); checks++;
      button.click(); assert.equal(sent.at(-1).label, 'connected', id + ' retained handler uses the latest API'); checks++;
      input.value = draft; const count = sent.length;
      paint({...S, preparing: true}, api('preparing')); retired();
      if (id === 'memory-tray') {
        assert(input.disabled && button.disabled, 'Memory input and Save visibly disabled during preparation');
        assert.match(el.querySelector('#mState').textContent, /ready/, 'Memory explains preparation'); checks += 2;
      }
      assert.equal(sent.length, count, id + ' cannot submit while preparing'); assert.equal(input.value, draft); checks += 2;
      paint(S, api('expired', 10000)); retired(); assert.equal(sent.length, count, id + ' cannot submit at deadline'); checks++;
      if (id === 'memory-tray') {
        assert(input.disabled && button.disabled, 'Memory expired Save and input visibly disabled');
        assert.match(el.querySelector('#mState').textContent, /time is over/, 'Memory expired state explains pending reveal'); checks += 2;
        paint(S, api('ready-again'));
        assert(!input.disabled && !button.disabled, 'Memory current ready snapshot enables preserved controls');
        assert.equal(input.value, draft, 'Memory ready snapshot preserves the draft'); checks += 2;
      }
      paint({...S, round: S.round + 1}, api('next-round')); retired(); assert.equal(sent.length, count, id + ' retired round handler cannot submit'); checks++;
      const latest = el.querySelector(buttonSelector).onclick;
      view.dispose?.(el); latest(); assert.equal(sent.length, count, id + ' disposed handler cannot submit'); checks++;
      if (id === 'twenty-questions') {
        view.mount(el, api('pending')); paint({...S, questions: [{pid:S.me,text:'First question',answer:null}]}, api('pending'));
        const q = el.querySelector('#tQ'); q.value = 'Second question draft';
        assert(q.disabled); q.onkeydown({key:'Enter',isComposing:false});
        assert.equal(sent.length, count, 'disabled pending-question Enter never sends'); assert.equal(q.value, 'Second question draft', 'disabled pending-question Enter preserves draft'); checks += 3;
        view.dispose(el);
      }
    }
    {
      const source = fs.readFileSync(require.resolve('../public/js/games/warm-words'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const view = (await import(data(source))).default, el = surface(global.document), sent = [];
      const S = {...fixtures['warm-words'].find(f => f.label === 'Search').state, hintsEnabled:true, hintsUsed:0, endsAt:10000};
      const api = (label, now=1000) => ({now:()=>now,send:a=>sent.push({label,...a})});
      view.render(el,S,api('initial'));
      const input=el.querySelector('[data-ww-input]'), submit=el.querySelector('[data-ww-form]').onsubmit,
        hint=el.querySelector('[data-ww-hint]').onclick, sort=el.querySelector('[data-ww-sort]'), sortClick=sort.onclick;
      input.value='kitchen'; view.render(el,S,api('expired',10000)); submit({preventDefault(){}}); hint();
      assert.equal(sent.length,0,'expired Warm Words guess/hint do not submit'); assert.equal(input.value,'kitchen'); checks+=2;
      view.render(el,S,api('reconnected')); hint(); assert.equal(sent.at(-1).label,'reconnected','Warm Words hint uses newest API'); checks++;
      view.render(el,{...S,hintsUsed:2},api('used')); hint(); assert.equal(sent.length,1,'authoritative hint cap blocks retired hint callback'); checks++;
      view.dispose(); assert.doesNotThrow(()=>sortClick({currentTarget:sort}),'disposed Warm Words sort callback cannot repaint or throw'); checks++; submit({preventDefault(){}}); hint(); assert.equal(sent.length,1,'disposed Warm Words guess/hint callbacks ignored'); checks++;
    }
    {
      const source = fs.readFileSync(require.resolve('../public/js/games/reaction-tap'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const view = (await import(data(source))).default, el = surface(global.document), sent = [];
      const S={...fixtures['reaction-tap'].find(f=>f.label==='Go').state,endsAt:10000};
      const api={now:()=>1000,send:a=>sent.push(a)};
      view.render(el,S,api); const pad=el.querySelector('#rPad'), retired=pad.onclick;
      view.render(el,{...S,round:S.round+1},api); retired({detail:0}); assert.equal(sent.length,0,'old Reaction pad cannot submit into a fresh round'); checks++;
      const fresh=el.querySelector('#rPad').onclick; view.dispose(); fresh({detail:0}); assert.equal(sent.length,0,'disposed Reaction callback ignored'); checks++;
    }
    {
      const source=fs.readFileSync(require.resolve('../public/js/games/word-chain'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const view=(await import(data(source))).default,el=surface(global.document);
      const S={...fixtures['word-chain'].find(f=>f.label==='Your turn').state,phase:'done',winner:'a',used:Array.from({length:120},(_,i)=>'word'+i)};
      view.render(el,S,{});const archive=el.querySelector('.wc-archive'),older=el.querySelector('#wcOlder'),route=el.querySelector('.wc-ribbon');
      older.click();archive.open=false;route.scrollLeft=27;older.focus();
      view.render(el,{...S,repeated:true},{});
      assert(el.querySelector('.wc-archive')===archive,'unchanged final snapshot retains archive DOM');checks++;
      assert.equal(archive.open,false,'unchanged final preserves archive disclosure');assert.equal(route.scrollLeft,27,'unchanged final preserves route scroll');checks+=2;
      view.render(el,{...S,players:S.players.map(p=>({...p,name:p.name+' updated'}))},{});
      assert(el.textContent.includes('updated'),'changed final roster still renders');checks++;
      view.dispose(el);
    }
    assert(accepted('scattergories',{mine:['Peru','Porridge','','','Palm']},'a',{answers:['Peru','Porridge','','','Palm']}));
    assert(accepted('countdown-word',{mine:'chat',myLocked:true},'a',{word:'CHAT',lock:true}));
    assert(accepted('memory-tray',{myRecall:['key']},'a',{recall:'Key'}));
    assert(accepted('number-hunt',{guesses:{a:[63]}},'a',{guess:63}));
    assert(accepted('warm-words',{history:[{pid:'a',word:'forest'}]},'a',{guess:'Forest'})); checks+=5;
    console.log('WORD_SKILL_INPUT_AUDIT_PASS: ' + checks + ' production-handler assertions for reconnect, rejected drafts, readiness, deadlines, next round, disposal and pending-question Enter');
  } finally { if (old === undefined) delete global.document; else global.document = old; }
})().catch(e => {console.error(e);process.exitCode=1;});
