'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/toolkit/camera-party.js'), 'utf8');
const code = source.slice(source.indexOf('function scoreEntries('), source.indexOf('\nexport function renderCameraParty('));
const util = fs.readFileSync(require.resolve('../public/js/util.js'), 'utf8').replace(/^export /gm, '');
function node() {
  // Text of an element is its children's text once it has children (as in a DOM).
  return { _text: '', className: '', children: [],
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; } };
}
const context = { document: { createElement: node } };
vm.createContext(context);
vm.runInContext(util + '\n' + code + '\nglobalThis.paint=patchFinal;globalThis.score=patchScores;', context);
const players = [{ id: 'a', name: 'Ada<script>' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cam' }];
function paint(scores, extra = {}) {
  const refs = { finalTitle: node(), winner: node(), standings: node(), scoreList: node() };
  const d = { state: { scores, players, me: 'a', you: 'a', hostId: 'b', ...extra }, refs };
  context.paint(d); context.score(d);
  assert.equal(refs.standings.children.length, 3, 'every current player score remains visible');
  return refs;
}
for (const extra of [{}, { spectator: true }, { me: 'b', you: 'b', hostId: 'b' }]) {
  for (const [scores, ranks, leaders, winner] of [
    [{ a: 100, b: 100, c: 0 }, ['1', '1', '3'], [true, true, false], "It's a tie: Ada<script> and Bo"],
    [{ a: 100, b: 0, c: 0 }, ['1', '2', '2'], [true, false, false], 'Ada<script> wins'],
    [{ a: 0, b: 0, c: 0 }, ['1', '1', '1'], [false, false, false], 'No one scored'],
    [undefined, ['1', '1', '1'], [false, false, false], 'No one scored'],
  ]) {
    const refs = paint(scores, extra);
    assert.equal(refs.finalTitle.textContent, 'Final scores', 'one wording for the final screen');
    assert.equal(refs.winner.textContent, winner, 'tie named as a tie, never by list order');
    assert.equal(refs.winner.className.includes('is-tie'), winner.startsWith("It's a tie"));
    assert.deepEqual(refs.standings.children.map(row => row.children[0].textContent), ranks, 'equal points share a rank');
    assert.deepEqual(refs.standings.children.map(row => row.className.includes('is-top')), leaders);
    assert.deepEqual(refs.scoreList.children.map(row => row.children[0].textContent), ranks);
    assert.deepEqual(refs.scoreList.children.map(row => row.className.includes('leader')), leaders);
    const me = extra.you || 'a';
    assert.deepEqual(refs.standings.children.map(row => row.className.includes('is-you')),
      refs.standings.children.map(row => row.children[1].textContent.startsWith(players.find(p => p.id === me).name)), 'viewer row highlighted');
    const ada = refs.standings.children.find(row => row.children[1].textContent.startsWith('Ada'));
    assert.equal(ada.children[1].textContent, me === 'a' ? 'Ada<script> (you)' : 'Ada<script>', 'name is literal text, never HTML');
    assert.equal(ada.children[2].textContent, String(scores?.a || 0) + ' pts', 'final points carry the pts unit');
  }
}
const order = paint({ a: 60, b: 70, c: 0 });
assert.equal(order.winner.textContent, 'Bo wins');
// Within a tie the order is by name, not by seat.
const tie = paint({ a: 0, b: 50, c: 50 });
assert.deepEqual(tie.standings.children.map(row => row.children[1].textContent), ['Bo', 'Cam', 'Ada<script> (you)']);
console.log('CAMERA_RESULTS_PASS: positive ties, zero neutrality, literal names and role-independent match standings');
