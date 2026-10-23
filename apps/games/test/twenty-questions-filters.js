'use strict';
// Mounted production-view regression; DOM double establishes no geometry verdict.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {makeDocument,surface} = require('./party-mobile');
(async()=>{
  const oldDoc=global.document;
  global.document=makeDocument();
  try {
    const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
    const util=data(fs.readFileSync(path.join(__dirname,'../public/js/util.js'),'utf8'));
    const src=fs.readFileSync(path.join(__dirname,'../public/js/games/twenty-questions.js'),'utf8');
    const ui=(await import(data(src.replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
    const el=surface(global.document);
    const state={instanceId:'filter-stability',me:'a',phase:'play',round:1,rounds:2,answerer:'b',players:[{id:'a',name:'Ada'},{id:'b',name:'Ben'}],questions:[{pid:'a',text:'Alive?',answer:'yes'},{pid:'a',text:'Metal?',answer:'no'},{pid:'a',text:'At home?',answer:'sometimes'}],wrong:[],maxQ:40,answered:3,scores:{}};
    ui.render(el,state,{send(){}});
    const keys=['all','yes','no','sometimes'];
    const buttons=keys.map(k=>el.querySelector('[data-filter="'+k+'"]'));
    const icons=buttons.map(b=>b.querySelector('svg'));
    const labels=buttons.map(b=>b.querySelector('.tq-filter-label'));
    const counts=buttons.map(b=>b.querySelector('.tq-filter-count'));
    assert(icons.every(Boolean));assert(labels.every(Boolean));assert(counts.every(Boolean));
    assert.deepEqual(counts.map(n=>n.textContent),['3','1','1','1']);
    const next={...state,questions:[...state.questions,{pid:'a',text:'Portable?',answer:'yes'}],answered:4};
    el.querySelector('#tqHist').scrollTop=137;
    ui.render(el,next,{send(){}});
    assert.equal(el.querySelector('#tqHist').scrollTop,137,'ordinary history paint preserves read position');
    for(let i=0;i<keys.length;i++) {
      assert.equal(el.querySelector('[data-filter="'+keys[i]+'"]'),buttons[i]);
      assert.equal(buttons[i].querySelector('svg'),icons[i]);
      assert.equal(buttons[i].querySelector('.tq-filter-label'),labels[i]);
      assert.equal(buttons[i].querySelector('.tq-filter-count'),counts[i]);
    }
    assert.deepEqual(counts.map(n=>n.textContent),['4','2','1','1']);
    const filters=el.querySelector('.tq-filters');
    filters.onclick({target:buttons[1]});
    assert.equal(el.querySelector('#tqHist').scrollTop,0,'changed filter starts at newest answer');
    el.querySelector('#tqHist').scrollTop=53;
    filters.onclick({target:buttons[1]});
    assert.equal(el.querySelector('#tqHist').scrollTop,53,'same filter retains read position');
    assert.equal(buttons[1].getAttribute('aria-pressed'),'true');
    assert.equal(buttons[0].getAttribute('aria-pressed'),'false');
    assert.equal(buttons[1].getAttribute('aria-label'),'Yes answers: 2');
    assert.equal(el.querySelector('#tqHist').querySelectorAll('.tq-row').length,2);
    filters.onclick({target:buttons[2]});
    assert.equal(el.querySelector('#tqHist').scrollTop,0,'next explicit filter change resets scroll');
    assert.equal(buttons[2].getAttribute('aria-label'),'No answers: 1');
    assert.equal(buttons[2].querySelector('svg'),icons[2]);
    assert.equal(el.querySelector('#tqHist').querySelectorAll('.tq-row').length,1);
    ui.render(el,{...next,phase:'reveal',word:'robot',last:{reason:'guessed',winner:'a',answered:4}},{send(){}});
    assert.equal(el.querySelector('[data-filter="all"]').querySelector('.tq-filter-count').textContent,'4');
    ui.dispose();
    console.log('TWENTY_QUESTIONS_FILTERS_PASS: mounted updates retain icons/labels/count nodes, live counts, accessible selection, change-only scroll reset, filtering and reveal');
  } finally {if(oldDoc===undefined)delete global.document;else global.document=oldDoc;}
})().catch(e=>{console.error(e);process.exitCode=1;});
