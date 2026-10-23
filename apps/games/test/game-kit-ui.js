'use strict';
/* Game kit helpers (public/js/kit.js) and the kit stylesheet contract
 * (public/css/game-ui.css): shared ranks for ties, "It's a tie", viewer
 * highlight, HUD timer slot always present, escaping, and every documented
 * class actually styled. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const data = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (a, m) => { assert(a, m); checks++; };

(async () => {
  const util = data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));
  const kit = await import(data(fs.readFileSync(path.join(root, 'public/js/kit.js'), 'utf8').replace("'./util.js'", JSON.stringify(util))));
  const players = [{ id: 'a', name: 'Cy' }, { id: 'b', name: 'Ann' }, { id: 'c', name: 'Bo' }, { id: 'd', name: 'Dee' }];

  const rows = kit.rankRows({ a: 300, b: 300, c: 100, d: 100 }, players, { you: 'c' });
  eq(rows.map((r) => [r.name, r.rank]), [['Ann', 1], ['Cy', 1], ['Bo', 3], ['Dee', 3]], 'equal points share a rank (1, 1, 3, 3), ties ordered by name');
  ok(rows.find((r) => r.id === 'c').you, 'viewer flagged');
  eq(kit.winnerLine(rows), "It's a tie: Ann and Cy", 'tie names everyone tied');
  eq(kit.winnerLine(kit.rankRows({ a: 5, b: 3 }, players.slice(0, 2))), 'Cy wins', 'single winner');
  eq(kit.winnerLine(kit.rankRows({}, players.slice(0, 3))), 'No one scored', 'nobody scored');
  eq(kit.winnerLine(kit.rankRows({ a: 1, b: 1, c: 1 }, players.slice(0, 3))), "It's a tie: Ann, Bo and Cy", 'three-way tie');
  eq(kit.rankRows({ a: '7' }, [{ id: 'a', name: 'X' }, { id: 'z', name: 'Y' }]).map((r) => r.points), [7, 0], 'missing scores count as 0');

  const html = kit.resultsHtml({ scores: { a: 300, b: 300, c: 100 }, players: players.slice(0, 3), you: 'c' });
  ok(html.includes('<h2 class="gk-results-title">Final scores</h2>'), 'Final scores title');
  ok(html.includes('gk-winner is-tie') && html.includes("It&#39;s a tie: Ann and Cy"), 'tie line');
  eq((html.match(/class="gk-rank-row is-top/g) || []).length, 2, 'both tied leaders marked top');
  ok(/gk-rank-row is-you"><span class="gk-rank" aria-label="Rank 3">3<\/span><span class="gk-name">Bo <small>\(you\)<\/small>/.test(html), 'viewer row highlighted with shared rank');
  ok(!kit.resultsHtml({ players: [{ id: 'x', name: '<b>' }] }).includes('<b>'), 'names escaped');

  const hud = kit.hudHtml({ round: kit.roundLabel(2, 5), phase: 'Vote', progress: kit.progressText(2, 4) });
  ok(hud.includes('Round 2 of 5') && hud.includes('2 of 4 locked in'), 'HUD wording');
  ok(hud.includes('<span class="gk-hud-timer" aria-live="off"></span>'), 'empty timer slot is still printed');
  ok(kit.hudHtml({ timer: 4.2 }).includes('gk-hud-timer is-urgent" aria-live="off">5s'), 'urgent timer under 5s');

  // One Final scores block for every standard game.
  const fin = kit.finalHtml({ scene: 'demo', scores: { a: 300, b: 300 }, players: players.slice(0, 2), you: 'b', note: 'Last round: <done>', watching: true });
  ok(fin.startsWith('<div class="gk-final gk-col" role="status" data-scene="demo" data-phase="done">'), 'final block marks its scene');
  ok(fin.includes('gk-results-title">Final scores') && fin.includes('300 <small class="gk-meta">pts</small>'), 'final block: title and pts unit');
  ok(fin.includes('<p class="gk-final-note">Last round: &lt;done&gt;</p>') && fin.includes('You watched this game.'), 'escaped note and spectator line');
  ok(!fin.includes('gk-hud'), 'no HUD row on the final screen');
  const host = { innerHTML: '', querySelector(sel) { return sel === '.gk-final' && this.innerHTML.includes('gk-final') ? {} : null; } };
  const finOpts = { scene: 'demo', scores: { a: 1 }, players: players.slice(0, 2), you: 'a' };
  ok(kit.paintFinal(host, finOpts) === true && host.innerHTML.includes('gk-final'), 'paintFinal writes the block');
  ok(kit.paintFinal(host, { ...finOpts }) === false, 'an unchanged result keeps the existing markup (and the Rematch row)');
  ok(kit.paintFinal(host, { ...finOpts, scores: { a: 2 } }) === true, 'a changed score repaints');

  // Shared ticking HUD timer on the calibrated clock.
  const realSet = global.setInterval, realClear = global.clearInterval;
  const ticks = new Map(); let seq = 0;
  global.setInterval = (fn) => { ticks.set(++seq, fn); return seq; };
  global.clearInterval = (id) => { ticks.delete(id); };
  try {
    const slot = { textContent: '', cls: new Set(), classList: { toggle(c, on) { if (on) slot.cls.add(c); else slot.cls.delete(c); } } };
    const root2 = { querySelector: (sel) => (sel === '.gk-hud-timer' ? slot : null) };
    let now = 1000;
    const api = { now: () => now };
    kit.syncHudTimer(root2, { phase: 'vote', endsAt: 13000 }, api);
    eq(slot.textContent, '12s', 'timer paints seconds left on api.now()');
    ok(!slot.cls.has('is-urgent'), 'not urgent above 5s');
    eq(ticks.size, 1, 'one ticker per root');
    kit.syncHudTimer(root2, { phase: 'vote', endsAt: 13000 }, api);
    eq(ticks.size, 1, 'a new snapshot replaces the ticker');
    now = 9000; [...ticks.values()][0]();
    eq(slot.textContent, '4s', 'ticks down'); ok(slot.cls.has('is-urgent'), 'urgent at 5s and under');
    kit.syncHudTimer(root2, { phase: 'reveal', endsAt: 13000 }, api);
    eq(slot.textContent, '', 'result phases empty the slot'); eq(ticks.size, 0, 'and stop ticking');
    kit.syncHudTimer(root2, { phase: 'vote', endsAt: 13000, preparing: true }, api);
    eq(slot.textContent, '', 'no timer while the room prepares');
    kit.syncHudTimer(root2, { phase: 'vote', endsAt: 13000 }, api);
    kit.stopHudTimer(root2); eq(ticks.size, 0, 'stopHudTimer clears the ticker');
  } finally { global.setInterval = realSet; global.clearInterval = realClear; }

  const ch = kit.choicesHtml([{ value: 'x', label: '1969', selected: true }, { value: 'y', label: '1972' }], { locked: true });
  ok(ch.includes('gk-choices is-locked') && ch.includes('aria-pressed="true"') && ch.includes('<span class="gk-mark" aria-hidden="true">B</span>'), 'choices with marks and lock state');
  eq((ch.match(/ disabled/g) || []).length, 2, 'locked choices are disabled');
  ok(kit.inputRowHtml({ button: 'Guess' }).includes('class="gk-btn gk-primary" type="submit"'), 'input row button');
  eq(kit.waitingText(2), 'Waiting for 2 players', 'waiting count');
  eq(kit.waitingText(['Ann']), 'Waiting for Ann', 'waiting single name');
  eq(kit.waitingText(0), 'Everyone is in', 'nobody to wait for');

  // Every class the kit documents is styled, in both the header and rules.
  const css = fs.readFileSync(path.join(root, 'public/css/game-ui.css'), 'utf8');
  const header = css.slice(0, css.indexOf('========================================================================== */'));
  for (const cls of ['gk-col', 'gk-stack', 'gk-card', 'gk-reserve', 'gk-hud', 'gk-hud-round', 'gk-hud-phase', 'gk-hud-progress', 'gk-hud-timer',
    'gk-prompt', 'gk-sub', 'gk-meta', 'gk-btn', 'gk-primary', 'gk-quiet', 'gk-actions', 'gk-choices', 'gk-choice', 'gk-mark',
    'gk-choice-text', 'gk-input-row', 'gk-input', 'gk-wait', 'gk-results', 'gk-results-title', 'gk-winner', 'gk-ranks',
    'gk-rank-row', 'gk-rank', 'gk-name', 'gk-pts']) {
    ok(header.includes(cls), `${cls} documented`);
    ok(new RegExp(`\\.${cls}(?![\\w-])[^{]*\\{`).test(css.slice(header.length)), `${cls} styled`);
  }
  // Flat look: no offset sticker shadows, no tilts in the kit.
  ok(!/box-shadow:\s*\d+px\s+\d+px\s+0\s+var\(--hard\)/.test(css), 'no hard offset shadows left in game-ui.css');
  ok(!/rotate\(/.test(css.replace(/rotate\(45deg\)|rotate\(-135deg\)/g, '')), 'no tilted labels in game-ui.css');
  ok(/#gbody\s*\{[^}]*--hard:\s*transparent/.test(css), 'game surfaces turn the sticker shadow token off');
  console.log(`GAME_KIT_UI_PASS: ${checks} checks`);
})().catch((e) => { console.error(e); process.exit(1); });
