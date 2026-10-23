'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeDocument, surface } = require('./party-mobile');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
(async () => {
  const util = data(fs.readFileSync(require.resolve('../public/js/util.js'), 'utf8'));
  const source = fs.readFileSync(require.resolve('../public/js/games/charades.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
  const view = (await import(data(source))).default;
  const old = global.document;
  const doc = global.document = makeDocument();
  const el = surface(doc);
  const state = { phase:'act', instanceId:'match', w:'turn1', round:1, rounds:3, actor:'b', me:'a', masked:'____', scores:{}, guessed:{}, players:[{id:'a',name:'Ada'},{id:'b',name:'Bo'}], endsAt:10000 };
  const sent = [];
  const api = label => ({ now:()=>1000, send:a=>{sent.push({label,...a}); return label !== 'offline';} });
  try {
    view.render(el,state,api('offline'));
    const input = el.querySelector('#cGuess'), button = el.querySelector('#cSend');
    input.value = 'kite'; button.click();
    assert.equal(input.value,'kite','a rejected send preserves the guess draft');
    view.render(el,state,api('connected'));
    button.click();
    assert.equal(sent.at(-1).label,'connected','retained controls use the latest API after reconnect');
    assert.equal(input.value,'','an accepted send clears the submitted draft');
    input.value = 'next try';
    view.render(el,{...state,preparing:true},api('preparing'));
    button.click(); assert.equal(sent.length,2,'preparation does not send');
    assert.equal(input.value,'next try');
    view.render(el,{...state,guessed:{a:300}},api('locked'));
    input.disabled = false; button.disabled = false; button.click();
    assert.equal(sent.length,2,'queued controls cannot send after an authoritative correct guess');
    view.render(el,{...state,round:2,w:'turn2'},api('new-turn'));
    const retired = button.onclick;
    retired(); assert.equal(sent.length,2,'old turn handler cannot submit into a new turn');
    const nextInput = el.querySelector('#cGuess'); nextInput.value='kite';
    view.render(el,{...state,round:2,w:'turn2'},api('fresh-paint'));
    assert.equal(el.querySelector('#cGuess'),nextInput,'same-turn updates preserve the compact composer node');
    assert.equal(nextInput.value,'kite','same-turn updates preserve a native typing draft');
    const nextSend = el.querySelector('#cSend').onclick;
    view.dispose(); nextSend(); assert.equal(sent.length,2,'disposed handlers cannot send');
    view.render(el,{...state,me:'b',wordShown:'a long actor word',instanceId:'actor'},api('actor'));
    assert(el.innerHTML.includes('a long actor word'),'actor word remains complete');
    view.render(el,{...state,phase:'reveal',instanceId:'reveal',word:'kite'},api('reveal'));
    // Final standings use authoritative match points, not room-night totals.
    for (const game of ['charades', 'memory-tray', 'typing-race']) {
      let src = fs.readFileSync(require.resolve('../public/js/games/' + game + '.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      src = src.replace("'../toolkit/input-capabilities.mjs'", JSON.stringify(data(fs.readFileSync(require.resolve('../public/js/toolkit/input-capabilities.mjs'), 'utf8'))));
      const finalView = (await import(data(src))).default;
      for (const spectator of [false, true]) for (const [scores, ranks] of [
        [{ a:100, b:100, c:50 }, ['1','1','3']],
        [{ a:100, b:50, c:0 }, ['1','2','3']],
        [{ a:100 }, ['1','2','2']], [{}, ['1','1','1']]]) {
        finalView.dispose?.();
        finalView.render(el, { ...state, phase:'done', instanceId:game, spectator, audioBaseline:true,
          players:[{id:'a',name:'<img onerror="bad">'},{id:'b',name:'Same'},{id:'c',name:'Zero'}],
          scores, totals:{a:9999,b:9999,c:9999} }, api('final'));
        // Kit final scores (public/js/kit.js resultsHtml): shared competition ranks.
        assert.deepEqual(el.querySelectorAll('.gk-rank').map(n=>n.textContent), ranks, game+' competition ranks');
        assert.deepEqual(el.querySelectorAll('.gk-pts').map(n=>parseInt(n.textContent, 10)), Object.values({a:0,b:0,c:0,...scores}).sort((a,b)=>b-a), game+' authoritative match score ordering');
        const best = Math.max(0, ...Object.values(scores));
        assert.equal(el.querySelectorAll('.is-top').length, best > 0 ? Object.values(scores).filter(n=>n===best).length : 0, game+' positive leaders highlighted');
        if (scores.a === 100 && scores.b === 100) assert(el.innerHTML.includes("It&#39;s a tie") || el.innerHTML.includes("It's a tie"), game+' names a tie as a tie');
        assert.equal(el.querySelectorAll('img').length, 0, game+' names cannot create markup');
        assert(!el.innerHTML.includes('9999'), game+' does not substitute night totals');
        assert(el.querySelectorAll('.gk-name').some(n=>n.textContent.includes('<img onerror="bad">')), game+' retains escaped literal name');
      }
      finalView.dispose?.();
    }
    console.log('CHARADES_INPUT_PASS: rejected draft, fresh API, preparation, correct-guess lock, retired turn and disposal');
  } finally { view.dispose(); if(old===undefined)delete global.document;else global.document=old; }
})().catch(e=>{console.error(e);process.exitCode=1;});
