'use strict';
// Production finale rendering on the shared DOM stub. The public match scores
// select every positive leader; room totals cannot crown or rank a player.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument, surface } = require('./party-mobile');
const { FIXTURES } = require('./party-scenes-browser');
const { fixtures } = require('./skill-scenes-hud-fixtures');
const root = path.resolve(__dirname, '..');
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const util = data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));

(async () => {
  const previous = global.document;
  const doc = global.document = makeDocument();
  try {
    for (const id of ['never-ever', 'most-likely', 'warm-words']) {
      const source = fs.readFileSync(path.join(root, 'public/js/games', id + '.js'), 'utf8');
      const ui = (await import(data(source.replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
      const done = id === 'warm-words' ? fixtures[id].find(f => f.label === 'Done').state
        : FIXTURES.find(f => f.id === id).frames.at(-1).views[0];
      const players = done.players.slice(0, 3), [a, b, c] = players.map(p => p.id);
      const el = surface(doc);
      const leaders = () => el.querySelectorAll('.gk-rank-row.is-top').length;
      for (const [scores, count] of [[{ [a]: 100, [b]: 100, [c]: 30 }, 2], [{ [b]: 80, [c]: 30 }, 1], [{}, 0]]) {
        ui.render(el, { ...structuredClone(done), players, scores, totals: { [c]: 9999 } }, { now: () => done.serverNow, send() {} });
        assert.equal(leaders(), count, id + ' marks only the real positive leaders, including ties');
        assert(!el.textContent.includes('9999'), id + ' does not use room totals as match scores');
      }
      if (id !== 'warm-words') {
        const namedPlayers = [{id:a,name:'Ada <script>'},{id:b,name:'Ben & Co'},{id:c,name:'Cy'}];
        for (const [scores, ranks, order, points, count] of [
          [{[a]:100,[b]:100,[c]:100}, ['1','1','1'], [0,1,2], ['100','100','100'], 3],
          [{[a]:100,[b]:100,[c]:30}, ['1','1','3'], [0,1,2], ['100','100','30'], 2],
          [{[b]:80,[c]:30}, ['1','2','3'], [1,2,0], ['80','30','0'], 1],
          [{[b]:80}, ['1','2','2'], [1,0,2], ['80','0','0'], 1],
          [{}, ['1','1','1'], [0,1,2], ['0','0','0'], 0],
        ]) {
          ui.render(el, {...structuredClone(done),players:namedPlayers,scores,totals:{[c]:9999},spectator:true,me:'watch'}, {now:()=>done.serverNow,send(){}});
          const rows=el.querySelectorAll('.gk-rank-row');
          assert.deepEqual(rows.map(row=>row.querySelector('.gk-rank').textContent),ranks,id+' uses competition ranks for equal match scores');
          assert.deepEqual(rows.map(row=>row.querySelector('.gk-name').textContent),order.map(i=>namedPlayers[i].name),id+' keeps escaped names paired with their ranks');
          assert.deepEqual(rows.map(row=>row.querySelector('.gk-pts').textContent),points.map(n=>n+' pts'),id+' displays actual match scores with the pts unit');
          assert.equal(leaders(),count,id+' highlights all positive leaders and keeps scoreless rows neutral');
          assert.equal(el.querySelectorAll('script').length,0,id+' treats names as text');
          assert(!el.textContent.includes('9999'),id+' excludes night totals from final ranks');
        }
      }
      ui.dispose?.(el);
    }
    const triviaSource = fs.readFileSync(path.join(root, 'public/js/games/trivia.js'), 'utf8');
    const trivia = (await import(data(triviaSource.replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
    const players = [{ id: 'a', name: 'Ada <script>' }, { id: 'b', name: 'Ben & Co' }, { id: 'c', name: 'Cy' }];
    const el = surface(doc);
    const render = scores => trivia.render(el, { phase: 'done', instanceId: 'quiz', me: 'watch', spectator: true,
      rounds: 8, players, scores, totals: { c: 9999 } }, { send() {} });
    render({ a: 100, b: 100, c: 30 });
    // Kit Final scores: "It's a tie" names everyone tied; ties share rank 1.
    assert(el.textContent.includes("It's a tie: Ada <script> and Ben & Co"));
    assert.deepEqual(el.querySelectorAll('.gk-rank').map((n) => n.textContent), ['1', '1', '3'], 'tied leaders share rank 1');
    assert.equal(el.querySelectorAll('script').length, 0, 'player names are text, not executable markup');
    assert(!el.textContent.includes('9999'), 'Trivia final ranks match scores rather than cumulative room totals');
    render({ b: 80 });
    assert(el.textContent.includes('Ben & Co wins'));
    render({});
    assert(el.textContent.includes('No one scored'));
    assert.equal(el.querySelectorAll('.gk-pts').filter((n) => parseInt(n.textContent, 10) === 0).length, 3);
    trivia.dispose();
    const pickSource = fs.readFileSync(path.join(root, 'public/js/games/pick-one.js'), 'utf8');
    const pick = (await import(data(pickSource.replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
    for (const [scores, ranks, points] of [[{a:100,b:100,c:30}, ['1','1','3'], ['100','100','30']], [{b:80}, ['1','2','2'], ['80','0','0']], [{}, ['1','1','1'], ['0','0','0']]]) {
      pick.render(el, {phase:'done',instanceId:'pick-ties',me:'a',round:1,rounds:1,players,scores,totals:{c:9999}}, {send(){}});
      assert.deepEqual(el.querySelectorAll('.gk-rank').map(n=>n.textContent),ranks,'Pick One uses competition ranks for tied match scores');
      assert.deepEqual(el.querySelectorAll('.gk-rank-row').map(n=>n.querySelector('.gk-pts').textContent),points.map(n=>n+' pts'));
      assert.equal(el.querySelectorAll('script').length,0,'Pick One escapes names');
      assert(!el.textContent.includes('9999'),'Pick One excludes cumulative totals');
    }
    pick.dispose();
    const pollSource = fs.readFileSync(path.join(root, 'public/js/games/rapid-polls.js'), 'utf8');
    const poll = (await import(data(pollSource.replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))))).default;
    poll.render(el, {phase:'done',instanceId:'poll-ties',me:'a',round:1,rounds:1,players,totals:{c:9999},last:{poll:{q:'A safe question?',options:['Garden <script>','Beach & cafe']},votes:{a:0,b:1}}}, {send(){}});
    // The last poll was already revealed; the finale is the shared kit Final scores.
    assert(el.textContent.includes('Final scores')&&el.textContent.includes('No one scored'),'Rapid Polls ends on the kit Final scores');
    assert.deepEqual(el.querySelectorAll('.gk-rank').map(n=>n.textContent),['1','1','1'],'Scoreless players share a rank instead of invented standings');
    assert.equal(el.querySelectorAll('.party-rank-item').length,0);
    assert.equal(el.querySelectorAll('script').length,0,'Rapid Polls escapes player names');
    assert(!el.textContent.includes('9999'),'Rapid Polls does not fabricate cumulative standings');
    poll.dispose();
    console.log('PARTY_FINAL_TIES_PASS: 6 finales; tied positive leaders, single leader, scoreless match, room-total isolation');
  } finally {
    if (previous === undefined) delete global.document; else global.document = previous;
  }
})().catch(error => { console.error(error); process.exit(1); });
