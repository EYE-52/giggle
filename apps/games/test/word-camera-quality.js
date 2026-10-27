'use strict';
// Production-client regressions in the existing DOM fixture. This is state,
// input and cue evidence; it does not claim real browser geometry or audio QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeDocument, surface } = require('./party-mobile');
const { fixtures } = require('./skill-scenes-hud-fixtures');
const { FIXTURES } = require('./party-scenes-browser');
const data = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const util = data(fs.readFileSync(require.resolve('../public/js/util.js'), 'utf8'));
const clone = s => structuredClone(s);
async function load(id) {
  let source = fs.readFileSync(require.resolve('../public/js/games/' + id), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
  source = source.replace("'../toolkit/input-capabilities.mjs'", JSON.stringify(data(fs.readFileSync(require.resolve('../public/js/toolkit/input-capabilities.mjs'), 'utf8'))));
  return (await import(data(source))).default;
}
const skill = (id, label) => clone(fixtures[id].find(f => f.label === label).state);
const party = (id, phase, role = () => true) => clone(FIXTURES.find(f => f.id === id).frames.flatMap(f => f.views).find(s => s.phase === phase && !s.spectator && s.me !== 'watch' && role(s)));

(async () => {
  const previous = global.document;
  const doc = global.document = makeDocument();
  let checks = 0;
  try {
    const scatterDone = await load('scattergories');
    const doneEl = surface(doc, 'scatter-final');
    const finalState = { phase:'done',instanceId:'final',rounds:2,players:[{id:'a',name:'<Long name & friends>'},{id:'b',name:'B'}],scores:{a:200,b:100},totals:{a:9999,b:8888},spectator:true };
    scatterDone.render(doneEl,finalState,{send(){}});
    assert(doneEl.innerHTML.includes('Final scores') && doneEl.innerHTML.includes('200') && doneEl.innerHTML.includes('100'));
    assert(!doneEl.innerHTML.includes('9999'), 'final never substitutes cumulative night totals');
    scatterDone.render(doneEl,{...finalState,scores:{a:300,b:100}},{send(){}});
    assert(doneEl.innerHTML.includes('300'),'final score changes invalidate cache');
    scatterDone.dispose(doneEl);
    for (const id of ['countdown-word', 'scattergories']) {
      const view = await load(id), el = surface(doc, 'ranked-final-' + id);
      const players = [{id:'c',name:'Third'}, {id:'a',name:'<Long name & friends>'}, {id:'b',name:'Tied'}];
      const state = {...finalState, players, scores:{a:200,b:200,c:0}};
      view.render(el,state,{send(){}});
      assert.equal((el.innerHTML.match(/aria-label="Rank 1, tied"/g) || []).length,2, id+' tied leaders share first rank');
      assert(el.innerHTML.includes('aria-label="Rank 3"'), id+' next rank follows the tie');
      assert.equal((el.innerHTML.match(/gk-rank-row is-top/g) || []).length,2);
      assert(el.innerHTML.includes("It's a tie") || el.innerHTML.includes('It&#39;s a tie'), id+' tied win is named a tie');
      const name=el.querySelectorAll('.gk-name')[0];
      assert.equal(name.textContent,'<Long name & friends>',id+' name is rendered as text');
      assert(name.children.every(n=>n.nodeType===3),id+' name cannot create markup');
      const list=el.querySelector('.gk-ranks');
      view.render(el,{...state,heartbeat:true},{send(){}});
      assert.equal(el.querySelector('.gk-ranks'),list,id+' heartbeat keeps final reading node');
      view.render(el,{...state,scores:{}},{send(){}});
      assert(!el.innerHTML.includes('is-top'),id+' scoreless final does not invent a winner');
      assert.equal((el.innerHTML.match(/aria-label="Rank 1/g) || []).length,3);
      checks += 8;
      view.dispose(el);
    }
    const transitions = [
      ['word-chain', skill('word-chain', 'Your turn'), s => ({...s, used:[...s.used, 'tree'], current:'tree', turnNo:s.turnNo + 1})],
      ['countdown-word', skill('countdown-word', 'Build'), s => ({...s, mine:'cat', myFeedback:{ok:true,message:'Saved cat'}})],
      ['warm-words', skill('warm-words', 'Search'), s => ({...skill('warm-words', 'Reveal'), me:s.me, last:{...skill('warm-words', 'Reveal').last,winner:s.me}})],
      ['scattergories', skill('scattergories', 'Write'), s => {const next=skill('scattergories','Reveal'); return {...next,me:s.me,last:{...next.last,points:{[s.me]:100}}};}],
      ['reaction-tap', skill('reaction-tap', 'Go'), s => ({...s,taps:{[s.me]:123}})],
      ['number-hunt', skill('number-hunt', 'Hunt'), s => ({...s,phase:'overtime',finished:[{pid:s.me,tries:1}],history:[{pid:s.me,guess:42,result:'correct'}]})],
      ['typing-race', skill('typing-race', 'Race'), s => ({...s,finished:[{pid:s.me,ms:1234,pts:150}]})],
      ['charades', skill('charades', 'Guess'), s => ({...s,guessed:{[s.me]:300}})],
      ['lyric-fill', party('lyric-fill','fill'), s => {const next=party('lyric-fill','reveal');return {...next,me:s.me,last:{...next.last,verdicts:{[s.me]:{text:'word',verdict:'exact',pts:150}}}};}],
      ['five-second', party('five-second','vote',s=>s.me===s.performer), s => ({...s,phase:'reveal',last:{passed:true,votes:{}}})],
    ];
    for (const [id, origin, success] of transitions) {
      const view=await load(id), el=surface(doc), cues=[];
      const base={...origin,instanceId:'quality-'+id,round:1,preparing:false,audioBaseline:false};
      const next={...success(base),instanceId:base.instanceId,round:base.round,preparing:false,audioBaseline:false};
      const api={now:()=>1000,send:()=>true,cue:(name,opts)=>cues.push({name,...opts})};
      view.render(el,base,api); assert.equal(cues.length,0,id+' initial snapshot is quiet'); checks++;
      view.render(el,next,api); assert.equal(cues.length,1,id+' accepted state produces one gameplay cue'); checks++;
      assert(cues[0].id.startsWith(base.instanceId+':')); checks++;
      view.render(el,{...next,heartbeat:true},api); assert.equal(cues.length,1,id+' heartbeat cannot replay cue'); checks++;
      view.dispose?.(el); view.render(el,next,api); assert.equal(cues.length,1,id+' remount seeds success silently'); checks++;
      view.render(el,base,api); view.render(el,{...next,audioBaseline:true},api);
      view.render(el,next,api); assert.equal(cues.length,1,id+' reconnect baseline consumes rather than replays success'); checks++;
      view.dispose?.(el);
    }
    for (const [id,label,selector] of [
      ['countdown-word','Reveal','.wg-rows'],['scattergories','Reveal','.wg-rows'],
      ['warm-words','Reveal','.ww-feed'],['number-hunt','Reveal','.wg-rows'],
      ['typing-race','Podium','.wg-rows'],['reaction-tap','Result','.wg-rows'],
    ]) {
      const view=await load(id),el=surface(doc),S=skill(id,label),api={now:()=>1000,send:()=>true};
      view.render(el,S,api);const reading=el.querySelector(selector);assert(reading,id+' result reading surface exists');checks++;
      reading.scrollTop=130;view.render(el,{...S,heartbeat:true},api);
      assert.equal(el.querySelector(selector),reading,id+' result heartbeat keeps the reading node');assert.equal(reading.scrollTop,130);checks+=2;
      view.dispose?.(el);
    }
    for (const [id, base, selector, buttonSelector, field] of [
      ['lyric-fill',party('lyric-fill','fill'), '#lfText','#lfGo','text'],
      ['five-second',party('five-second','answer',s=>s.me===s.performer), '#fAns','#fSend','answers'],
    ]) {
      const view=await load(id),el=surface(doc),sent=[];
      const state={...base,instanceId:'input-'+id,endsAt:10000,preparing:false};
      const api=stamp=>({now:()=>1000,send:action=>{sent.push({stamp,...action});return stamp!=='offline';}});
      view.render(el,state,api('offline'));
      const input=el.querySelector(selector),button=el.querySelector(buttonSelector),retired=button.onclick;
      input.value='One, two, three';input.setSelectionRange(4,7);button.click();
      assert.equal(input.value,'One, two, three',id+' offline draft survives');checks++;
      view.render(el,{...state,preparing:true},api('preparing'));
      assert.equal(el.querySelector(selector),input);assert(input.disabled);retired();assert.equal(sent.length,1);checks+=3;
      view.render(el,state,api('fresh'));assert(!input.disabled);assert.equal(input.selectionStart,4);checks+=2;
      input.onkeydown({key:'Enter',repeat:true});input.onkeydown({key:'Enter',isComposing:true});input.onkeydown({key:'Enter',keyCode:229});
      assert.equal(sent.length,1,id+' held Enter and IME do not submit');checks++;
      retired();assert.equal(sent.at(-1).stamp,'fresh');assert.equal(sent.at(-1)[field],'One, two, three');checks+=2;
      view.render(el,{...state,round:state.round+1},api('later'));retired();assert.equal(sent.length,2,id+' retired round action ignored');checks++;
      const latest=el.querySelector(buttonSelector).onclick;view.dispose(el);latest();assert.equal(sent.length,2,id+' disposed action ignored');checks++;
    }
    {
      const view=await load('warm-words'),el=surface(doc),sent=[],state=skill('warm-words','Search');
      view.render(el,{...state,endsAt:10000},{now:()=>1000,send:a=>sent.push(a)});
      const input=el.querySelector('[data-ww-input]'),form=el.querySelector('[data-ww-form]');
      input.value='forest';input.oncompositionstart();form.onsubmit({preventDefault(){}});
      assert.equal(sent.length,0,'Warm Words native form never submits the IME candidate');checks++;
      input.oncompositionend();form.onsubmit({preventDefault(){}});assert.equal(sent.length,1);checks++;view.dispose(el);
    }
    {
      const view=await load('typing-race'),el=surface(doc),target='Hi 👩🏽‍🚀, cafe\u0301.';
      const S={...skill('typing-race','Race'),instanceId:'glyphs',target,endsAt:10000};
      const sent=[],api={now:()=>1000,send:a=>sent.push(a)};
      view.render(el,S,api);const input=el.querySelector('#tInput');
      input.value='Hi ';input.oninput();
      assert(el.querySelector('#tTarget').innerHTML.includes('<span class="typing-next">👩🏽‍🚀</span>'),'custom emoji remains one intact glyph');checks++;
      input.value=target;input.oninput();
      assert(el.querySelector('#tTarget').innerHTML.includes('<span class="typing-correct">e\u0301</span>'),'custom combining letter remains one intact glyph');checks++;
      assert.equal(sent.at(-1).typed,target,'server still receives the exact original sentence');checks++;view.dispose(el);
    }
    console.log('WORD_CAMERA_QUALITY_PASS: '+checks+' assertions for confirmed cues, baseline/remount silence, live Five/Lyric handlers, readiness and IME');
  } finally { if (previous===undefined)delete global.document;else global.document=previous; }
})().catch(error=>{console.error(error);process.exitCode=1;});
