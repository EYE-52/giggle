'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const game = require('../games/number-hunt/server');
const { makeDocument, surface } = require('./party-mobile');
const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id === 'b' ? 'Ben <script>' : id }));
let now = 1000;
const awards = {}, timers = [];
const ctx = { content: () => ({}), allPlayers: () => players, players: () => players,
  settings: () => ({ rounds: 1 }), now: () => now, later: (ms, fn) => timers.push(fn),
  award(pid, pts) { awards[pid] = (awards[pid] || 0) + pts; }, broadcast() {} };
const s = game.create(ctx);
s.secret = 42;
const act = (pid, guess) => game.onAction(s, ctx, pid, { guess });
act('c', 10); act('d', 11); act('d', 12);
act('a', 42); act('b', 42); act('c', 42); act('d', 42);
assert.equal(s.phase, 'roundEnd');
assert.deepEqual(s.last.finished.map(f => [f.pid, f.rank, f.pts]), [['a', 1, 100], ['b', 1, 100], ['c', 3, 50], ['d', 4, 30]]);
assert.deepEqual(s.wins, { a: 1, b: 1 });
assert.deepEqual(awards, { a: 100, b: 100, c: 50, d: 30 });
act('b', 42); now = s.endsAt; timers[0]();
assert.deepEqual(awards, { a: 100, b: 100, c: 50, d: 30 }, 'stale timer and duplicate hit cannot reward twice');
// Room routing must project the same tied score to players, reconnects and a watcher.
{
  const { Room } = require('../server/room');
  const room = new Room('NHTI', {'number-hunt': {}});
  const socket = () => ({readyState:1,frames:[],send(text){this.frames.push(JSON.parse(text));},close(){}});
  const sockets = [socket(),socket()];
  const seats = sockets.map((ws,i)=>room.addPlayer('Hunter '+i,ws).player);
  const snapshot = ws => ws.frames.findLast(frame=>frame.t==='state');
  try {
    assert(room.startGame(game,{ready:true,settings:{rounds:1}},seats[0].id).ok);
    for (const ws of sockets) room.onReady(ws,{i:room.game.instanceId,w:room._actionToken()});
    const meta={i:room.game.instanceId,w:room._actionToken()}, secret=room.game.state.secret;
    room.onAction(sockets[0],{guess:secret},meta);
    for (const ws of sockets) room.onReady(ws,{i:room.game.instanceId,w:room._actionToken()});
    room.onAction(sockets[1],{guess:secret},{i:room.game.instanceId,w:room._actionToken()});
    const result=snapshot(sockets[0]);
    assert.equal(result.phase,'roundEnd');
    assert.deepEqual(result.last.finished.map(f=>f.pts),[100,100]);
    assert(seats.every(p=>result.wins[p.id]===1&&result.scores[p.id]===100));
    const watcher=socket();room.addPlayer('Late observer',watcher);room.broadcastState();
    assert.equal(snapshot(watcher).spectator,true);
    assert.deepEqual(snapshot(watcher).scores,result.scores);
    for (const ws of sockets) room.onReady(ws,{i:room.game.instanceId,w:room._actionToken()});
    room.disconnect(sockets[1]);const resumed=socket();
    assert.equal(room.addPlayer(seats[1].name,resumed,seats[1].token).player.id,seats[1].id);
    room.broadcastState();
    assert.deepEqual(snapshot(resumed).scores,result.scores,'reconnected seat retains tied points');
    const totals={...room.totals};room.onAction(sockets[1],{guess:secret},meta);
    assert.deepEqual(room.totals,totals,'duplicate hit cannot change transport totals');
  } finally {room.destroy();}
}
(async () => {
  const previous = global.document;
  global.document = makeDocument();
  const data = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
  try {
    const util = data(fs.readFileSync(require.resolve('../public/js/util.js'), 'utf8'));
    const source = fs.readFileSync(require.resolve('../public/js/games/number-hunt.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
    const view = (await import(data(source))).default, el = surface(global.document);
    view.render(el, { ...game.view(s, 'a'), players, me: 'a' }, {});
    assert.equal(el.querySelectorAll('.wg-tag.is-good').length, 2, 'all equally best hunters marked Fewest');
    assert.equal(el.querySelectorAll('script').length, 0);
    assert(el.textContent.includes('1 try') && el.textContent.includes('+100'), 'single Number Hunt try is singular');
    assert(el.textContent.includes('2 tries') && el.textContent.includes('+50'), 'multiple Number Hunt tries stay plural');
    view.render(el, { ...game.view(s, 'watch'), phase: 'done', players, me: 'watch', spectator: true, totals: { d: 9999 } }, {});
    assert.deepEqual(el.querySelectorAll('.gk-rank').map(n => n.textContent), ['1', '1', '3', '4']);
    assert(!el.textContent.includes('9999'));
    view.dispose(el);
    const reactionSource = fs.readFileSync(require.resolve('../public/js/games/reaction-tap.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
    const reaction = (await import(data(reactionSource))).default;
    reaction.render(el, { phase: 'done', instanceId: 'reaction-tie', players, scores: {a:100,b:100,c:50,d:30}, wins: {a:1,b:1}, spectator:true,me:'watch' }, {});
    assert.deepEqual(el.querySelectorAll('.gk-rank').map(n=>n.textContent), ['1','1','3','4'], 'Reaction final equal points share rank');
    assert(el.textContent.includes("It's a tie") || el.innerHTML.includes('It&#39;s a tie'), 'Reaction tied win is named a tie');
    reaction.render(el, {phase:'done',instanceId:'reaction-plural',players,scores:{a:200},wins:{a:2}}, {});
    assert.equal(el.querySelectorAll('.gk-rank-row.is-top').length, 1, 'a single Reaction winner');
    reaction.dispose(el);
    view.render(el, {phase:'done',instanceId:'number-labels',players,scores:{a:200,b:100},wins:{a:2,b:1}}, {});
    assert.deepEqual(el.querySelectorAll('.gk-pts').map(n=>parseInt(n.textContent,10)), [200,100,0,0], 'Number finale ranks by match points');
    view.dispose(el);
    const chainSource = fs.readFileSync(require.resolve('../public/js/games/word-chain.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
    const chain = (await import(data(chainSource))).default;
    chain.render(el,{phase:'done',instanceId:'single-link',players,used:['apple'],winner:'a'},{});
    assert(el.textContent.includes('The first link') && !el.textContent.includes('All 1 links'), 'single-link chain archive is singular');
    chain.dispose(el);
    const warmSource = fs.readFileSync(require.resolve('../public/js/games/warm-words.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
    const warm = (await import(data(warmSource))).default;
    for (const rounds of [1,2]) {
      warm.render(el,{phase:'done',instanceId:'warm-label'+rounds,players,scores:{},rounds,results:[{winner:'a',target:'apple'}]},{});
      assert(el.textContent.includes('1 of '+rounds+' word'+(rounds===1?'':'s')+' found.'), 'Warm Words round total controls word singular/plural');
    }
    warm.dispose();
    console.log('NUMBER_HUNT_TIES_PASS: equal tries share rank, points, wins and result/finale highlighting; duplicate/deadline callbacks stay settled');
  } finally { if (previous === undefined) delete global.document; else global.document = previous; }
})().catch(error => { console.error(error); process.exitCode = 1; });
