'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { makeDocument, surface } = require('./party-mobile');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const util = data(fs.readFileSync(path.join(__dirname, '../public/js/util.js'), 'utf8'));
(async () => {
 const previous = global.document, doc = global.document = makeDocument();
 try {
  for (const id of ['compliment-battle', 'roast-toast']) {
   const source = fs.readFileSync(path.join(__dirname, '../public/js/games', id + '.js'), 'utf8');
   const ui = (await import(data(source.replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
   const el = surface(doc), players = [{id:'a',name:'Ada <script>'},{id:'b',name:'Ben & Co'},{id:'c',name:'長い名前'.repeat(20)}];
   for (const [scores, ranks, headline, leaders, tiedLabels] of [[{a:200,b:200,c:100},['1','1','3'],"It's a tie: Ada <script> and Ben & Co",2,['Rank 1, tied','Rank 1, tied','Rank 3']],[{b:100},['1','2','2'],'Ben & Co wins',1,['Rank 1','Rank 2, tied','Rank 2, tied']],[{},['1','1','1'],'No one scored',0,['Rank 1, tied','Rank 1, tied','Rank 1, tied']]]) {
    ui.render(el,{phase:'done',instanceId:id,me:'watch',spectator:true,round:3,rounds:3,players,scores,totals:{c:9999},last:{target:'c',entries:{a:'Note <script>'},winners:['a'],roomFave:['a'],pick:'a'}},{send(){}});
    assert(el.querySelector('.gk-results-title').textContent === 'Final scores');
    assert(el.querySelector('.gk-winner').textContent === headline, headline);
    assert.equal(el.querySelectorAll('.gk-winner.is-tie').length, leaders > 1 ? 1 : 0, 'a tie is named as a tie');
    assert.deepEqual(el.querySelectorAll('.gk-rank').map(n=>n.textContent),ranks);
    assert.equal(el.querySelectorAll('.gk-rank-row.is-top').length,leaders);
    assert.equal(el.querySelector('ol').querySelectorAll('li').length, 3);
    assert.deepEqual(el.querySelectorAll('.gk-rank').map(n=>n.getAttribute('aria-label')), tiedLabels);
    assert.equal(el.querySelectorAll('.is-you').length, 0, 'a watcher has no highlighted row');
    assert.equal(el.querySelectorAll('script').length,0);
    assert(!el.textContent.includes('9999'));
    assert(el.textContent.includes(players[2].name));
    assert(el.textContent.includes('You watched this game.'));
   }
   ui.render(el,{phase:'done',instanceId:id,me:'b',round:3,rounds:3,players,scores:{a:200,b:200,c:100}},{send(){}});
   assert.equal(el.querySelectorAll('.gk-rank-row.is-you').length, 1, 'the viewer row is highlighted');
   assert(el.querySelector('.gk-rank-row.is-you').textContent.includes('Ben & Co'));
   ui.dispose();
  }
  console.log('COMPLIMENT_ROAST_FINALS_PASS');
 } finally { global.document = previous; }
})().catch(e=>{console.error(e);process.exit(1);});
