'use strict';
// node tools/realtime/kart-practice-report.cjs /tmp/kart-practice-perf rookie-ring
// Match browser long tasks to sampled JS self time. Read after measurements:
// parsing a full Chrome trace uses enough memory to disturb a running test.
const fs = require('node:fs'), path = require('node:path');
const folder = process.argv[2], slug = process.argv[3] || 'rookie-ring';
const read = name => JSON.parse(fs.readFileSync(path.join(folder, name)));
const result = read('results.json').find(r => r.map.toLowerCase().replaceAll(' ', '-') === slug);
const trace = read(slug + '.trace.json').traceEvents;
const profile = read(slug + '.cpuprofile');
const ready = trace.filter(e => e.name === 'kart:ready').sort((a, b) => a.ts - b.ts)[0]?.ts;
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
let time = profile.startTime;
const samples = profile.samples.map((id, i) => {
  const dt = profile.timeDeltas[i]; time += dt;
  return { time, dt, id };
});
function name(id) {
  const frame = nodes.get(id)?.callFrame;
  return { function: frame?.functionName || '(anonymous)', url: frame?.url, line: frame?.lineNumber + 1 };
}
const tasks = trace.filter(e => e.ph === 'X' && e.name === 'RunTask' && e.dur > 50000 && e.ts > ready);
console.log(JSON.stringify({
  map: result.map, gaps: result.gaps, weaponsFired: result.weaponsFired,
  marks: result.marks.filter(m => /ready|drive|live|pickup|grant|fire/.test(m.name))
    .map(m => ({ name: m.name, ms: Math.round(m.at - result.ready) })),
  tasks: tasks.map(task => {
    const self = new Map();
    for (const sample of samples) if (sample.time >= task.ts && sample.time <= task.ts + task.dur) {
      self.set(sample.id, (self.get(sample.id) || 0) + sample.dt);
    }
    return {
      atMs: Math.round((task.ts - ready) / 1000), ms: +(task.dur / 1000).toFixed(1),
      self: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([id, us]) => ({ ...name(id), ms: +(us / 1000).toFixed(1) })),
      events: trace.filter(e => e.pid === task.pid && e.tid === task.tid && e.ph === 'X' &&
        e.ts >= task.ts && e.ts < task.ts + task.dur && e.dur > 5000 && e.name !== 'RunTask')
        .sort((a, b) => b.dur - a.dur).slice(0, 12)
        .map(e => ({ name: e.name, ms: +(e.dur / 1000).toFixed(1), data: e.args?.data })),
    };
  }),
}, null, 2));
