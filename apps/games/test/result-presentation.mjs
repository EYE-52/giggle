import assert from 'node:assert/strict';
import { createResultPresentation } from '../public/js/toolkit/result-presentation.mjs';
const calls = [], gate = createResultPresentation(s => calls.push(s.instanceId));
const live = { game:'chain-reaction', instanceId:'first', phase:'play' }, done = { ...live, phase:'done' };
gate.observe(null, done, true);
assert.equal(gate.ready('first'), false, 'a reconnect to finished play never celebrates');
gate.observe(live, done, true);
assert.equal(calls.length, 0, 'authoritative done waits for animation');
gate.observe(done, done, true);
assert.equal(gate.ready('stale'), false);
assert.equal(gate.ready('first'), true);
assert.equal(gate.ready('first'), false, 'repeated completion cannot replay celebration');
gate.observe(done, done, true); assert.deepEqual(calls, ['first']);
const second = { ...live, instanceId:'second' };
gate.observe(second, { ...second, phase:'done' }, true);
gate.observe(null, { ...live, game:'chess', instanceId:'third' });
assert.equal(gate.ready('second'), false, 'switching games retires pending animation');
gate.observe(second, { ...second, phase:'done' }, true); gate.reset();
assert.equal(gate.ready('second'), false, 'leaving a room retires pending animation');
const fourth = { ...live, instanceId:'fourth' };
gate.observe(fourth, { ...fourth, phase:'done' });
assert.deepEqual(calls, ['first','fourth'], 'games without delayed effects still celebrate once');
const offline = {...live,instanceId:'offline'}, offlineDone = {...offline,phase:'done',audioBaseline:true};
gate.observe(offline,offlineDone,true);
assert.equal(gate.ready('offline'),false,'old live snapshot plus a finished reconnect baseline cannot celebrate');
gate.observe(offlineDone,{...offlineDone,audioBaseline:false},true);
assert.equal(gate.ready('offline'),false,'heartbeat after a reconnect cannot revive the finale');
gate.observe(offline,{...offline,phase:'done'},true);
gate.observe({...offline,phase:'done'},offlineDone,true);
assert.equal(gate.ready('offline'),false,'reconnect consumes an already pending finale too');
assert.deepEqual(calls,['first','fourth']);
console.log('RESULT PRESENTATION PASS: cascade completion, reconnect, duplicate, switch and disposal gates');

// Exercise the actual shell callback, including announcements, not a mirrored policy.
const { readFileSync } = await import('node:fs');
const { default: vm } = await import('node:vm');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const callback = app.slice(app.indexOf('const resultPresentation ='), app.indexOf('// Polite live region'));
const effects = { wins: 0, confetti: 0, announcements: 0 };
const context = { createResultPresentation,
  sound: { win: () => effects.wins++ }, confetti: () => effects.confetti++,
  announce: () => effects.announcements++ };
vm.createContext(context); vm.runInContext(callback + '\nglobalThis.gate=resultPresentation;', context);
for (const game of ['pose-party', 'show-and-go', 'doodle-guess', 'never-ever', 'most-likely', 'charades', 'memory-tray', 'typing-race']) {
  for (const scores of [undefined, {}, { a: 0, b: 0 }]) {
    context.gate.reset();
    const live = { game, instanceId: game, phase: 'reveal' };
    context.gate.observe(live, { ...live, phase: 'done', scores }, true);
    const before = { ...effects };
    assert.equal(context.gate.ready(game), true, 'zero result still completes presentation readiness');
    assert.equal(effects.wins, before.wins); assert.equal(effects.confetti, before.confetti);
    assert.equal(effects.announcements, before.announcements + 1, 'zero result remains announced');
    context.gate.observe(null, { ...live, phase: 'done', scores });
    assert.equal(effects.announcements, before.announcements + 1, 'reconnect does not replay result');
  }
  context.gate.reset();
  const live = { game, instanceId: game, phase: 'reveal' };
  const before = { ...effects };
  context.gate.observe(live, { ...live, phase: 'done', scores: { a: 100, b: 100 } });
  assert.equal(effects.wins, before.wins + 1); assert.equal(effects.confetti, before.confetti + 1);
}
context.gate.reset();
const other = { game: 'bluff', instanceId: 'bluff', phase: 'reveal' };
const before = effects.wins;
context.gate.observe(other, { ...other, phase: 'done', scores: {} });
assert.equal(effects.wins, before + 1, 'other games preserve existing presentation');
console.log('SCORED SHELL RESULTS PASS: zero effects skipped, announcements/readiness retained, positive effects and reconnect guards');

// A live positive Doodle result still waits for readiness and celebrates once.
context.gate.reset();
const doodleLive = { game: 'doodle-guess', instanceId: 'doodle-positive-delayed', phase: 'reveal' };
const doodleDone = { ...doodleLive, phase: 'done', scores: { a: 100 } };
const doodleBefore = { ...effects };
context.gate.observe(doodleLive, doodleDone, true);
assert.deepEqual(effects, doodleBefore, 'positive Doodle waits for result readiness');
assert.equal(context.gate.ready(doodleLive.instanceId), true);
assert.equal(effects.wins, doodleBefore.wins + 1);
assert.equal(effects.confetti, doodleBefore.confetti + 1);
assert.equal(effects.announcements, doodleBefore.announcements + 1);
assert.equal(context.gate.ready(doodleLive.instanceId), false);
context.gate.observe(doodleDone, doodleDone, true);
assert.equal(effects.wins, doodleBefore.wins + 1, 'duplicate positive finale stays quiet');
context.gate.reset();
context.gate.observe(null, doodleDone);
assert.equal(effects.wins, doodleBefore.wins + 1, 'finished Doodle reload stays quiet');
console.log('DOODLE SHELL RESULTS PASS: positive delayed readiness, deduplication and quiet reload');

for (const game of ['never-ever', 'most-likely', 'charades', 'memory-tray', 'typing-race']) {
  context.gate.reset();
  const live = { game, instanceId: game + '-positive-delayed', phase: 'reveal' };
  const done = { ...live, phase: 'done', scores: { a: 100, b: 100, c: 100 } };
  const before = { ...effects };
  context.gate.observe(live, done, true);
  assert.deepEqual(effects, before, 'positive tied result waits for readiness');
  assert.equal(context.gate.ready(live.instanceId), true);
  assert.equal(effects.wins, before.wins + 1);
  assert.equal(effects.confetti, before.confetti + 1);
  assert.equal(effects.announcements, before.announcements + 1);
  assert.equal(context.gate.ready(live.instanceId), false);
  context.gate.observe(done, done, true);
  assert.equal(effects.wins, before.wins + 1, 'duplicate tied result remains quiet');
  context.gate.reset();
  context.gate.observe(null, done);
  assert.equal(effects.wins, before.wins + 1, 'finished reload stays quiet');
}
console.log('FIVE SCORED RESULTS PASS: zero/positive ties, delayed readiness, deduplication and quiet reload');
