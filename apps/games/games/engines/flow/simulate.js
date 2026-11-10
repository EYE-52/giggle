'use strict';
const { createEngine } = require('./index');
function mean(rows) { return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0; }
function spread(counts) { return counts.length ? Math.max(...counts) - Math.min(...counts) : 0; }
function simulate(definition, { sessions = 100, turns = 40, seed = 'simulation', players = 4, skipRate = 0 } = {}) {
  if (![sessions, turns, players].every(n => Number.isInteger(n) && n > 0) || sessions > 5000 || turns > 1000 || players > 20
    || !Number.isFinite(skipRate) || skipRate < 0 || skipRate > 1) throw new Error('Invalid simulation limits');
  const roster = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}` }));
  const { createRandom } = require('./random');
  const traces = [], deadEnds = {}, allIds = new Set(), phases = new Set();
  let completed = 0, limited = 0, heatErrors = [], exposureSpreads = [], pairSpreads = [], repeatCount = 0, breathers = 0;
  for (let session = 0; session < sessions; session++) {
    const engine = createEngine(definition, { seed: `${seed}:${session}`, players: roster });
    const feedback = createRandom(`${seed}:feedback:${session}`);
    let stopped = false;
    for (let turn = 0; turn < turns; turn++) {
      const result = engine.draw();
      if (result.status !== 'offered') {
        if (result.status === 'done') completed++;
        else deadEnds[result.reason] = (deadEnds[result.reason] || 0) + 1;
        stopped = true; break;
      }
      allIds.add(result.id); phases.add(result.phase);
      heatErrors.push(Math.abs(result.heat - result.targetHeat));
      breathers += Number(result.breather);
      if (feedback.next() < skipRate) engine.skip(result.token); else engine.complete(result.token);
    }
    if (!stopped) limited++;
    const state = engine.inspect();
    const ids = state.history.map(h => h.id);
    repeatCount += ids.length - new Set(ids).size;
    exposureSpreads.push(spread(roster.map(p => state.exposure[p.id] || 0)));
    const counts = [];
    for (let a = 0; a < roster.length; a++) for (let b = a + 1; b < roster.length; b++) {
      const { pairKey } = require('./index');
      counts.push(state.pairExposure[pairKey(roster[a].id, roster[b].id)] || 0);
    }
    pairSpreads.push(spread(counts));
    traces.push(state.history);
  }
  const sets = traces.map(t => new Set(t.map(h => h.id))), similarities = [], positionMatches = [];
  // Bound pairwise work: first 200 sessions, deterministically selected by index.
  for (let i = 0; i < Math.min(200, sessions); i++) for (let j = i + 1; j < Math.min(200, sessions); j++) {
    const intersection = [...sets[i]].filter(id => sets[j].has(id)).length;
    const union = new Set([...sets[i], ...sets[j]]).size;
    similarities.push(union ? intersection / union : 0);
    const length = Math.max(traces[i].length, traces[j].length);
    positionMatches.push(length ? traces[i].filter((h, n) => traces[j][n]?.id === h.id).length / length : 0);
  }
  const path = t => t.map(h => h.phase).filter((p, i, rows) => !i || p !== rows[i - 1]).join('>');
  return {
    definition: `${definition.id}@${definition.version}`, seed, sessions, turns, skipRate,
    completed, turnLimited: limited, deadEnds, totalOffers: heatErrors.length,
    pacing: { meanAbsoluteHeatError: mean(heatErrors), breathers },
    variety: { uniqueCards: allIds.size, cardCoverage: allIds.size / definition.cards.length,
      uniqueOrderedPaths: new Set(traces.map(t => t.map(h => `${h.phase}:${h.id}`).join('>'))).size,
      uniquePhasePaths: new Set(traces.map(path)).size, meanJaccardSimilarity: mean(similarities),
      meanPositionSimilarity: mean(positionMatches), comparedSessionPairs: similarities.length, repeats: repeatCount },
    fairness: { meanPlayerExposureSpread: mean(exposureSpreads), maxPlayerExposureSpread: Math.max(...exposureSpreads),
      meanPairExposureSpread: mean(pairSpreads), maxPairExposureSpread: Math.max(...pairSpreads) },
    phaseCoverage: [...phases].sort(),
  };
}
module.exports = { simulate };
