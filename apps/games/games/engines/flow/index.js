'use strict';
const { createRandom, weighted } = require('./random');
const { own, safeKey, quality, clone, pairKey, entity, specificity, resolveRules, applyEffects } = require('./state');
const { expand } = require('./template');
const { validateDefinition } = require('./validate');
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
function targetHeat(curve, turn) {
  if (turn <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x, y] = curve[i], [px, py] = curve[i - 1];
    if (turn <= x) return py + (y - py) * (turn - px) / (x - px);
  }
  return curve.at(-1)[1];
}
function qualities(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.entries(record).some(([k, v]) => !safeKey(k) || !quality(v))) throw new Error('Invalid qualities');
  return clone(record);
}
function createEngine(definition, options = {}) {
  const errors = validateDefinition(definition, options.validators);
  if (errors.length) throw new Error(`Invalid flow content:\n${errors.join('\n')}`);
  const def = clone(definition), signature = JSON.stringify(def);
  const director = { curve: [[0, 0]], maxHeat: 100, breatherEvery: 0, breatherHeat: 20,
    recencyWindow: 3, noveltyBonus: 0.5, fairness: 2, heatTolerance: 20, ...def.director };
  const seed = String(options.seed ?? require('node:crypto').randomBytes(16).toString('hex'));
  const random = createRandom(seed);
  const players = {};
  for (const player of options.players || []) {
    if (!safeKey(player.id) || own(players, player.id) || typeof player.name !== 'string' || player.name.length > 200) throw new Error('Invalid/duplicate player');
    players[player.id] = { name: player.name, qualities: qualities(player.qualities || {}) };
  }
  let state = {
    seed, world: { players, pairs: {}, table: qualities(options.table || {}), session: qualities(options.session || {}) },
    phase: def.start, dwell: 0, completed: 0, completedPhases: [], turn: 0, sinceBreather: 0,
    seen: [], seenText: [], history: [], exposure: {}, pairExposure: {}, pending: null,
  };
  const phase = () => def.phases.find(p => p.id === state.phase);
  const sampleDwell = () => { const [min, max] = phase().dwell; return min + Math.floor(random.next() * (max - min + 1)); };
  state.dwell = sampleDwell();
  const matches = (when, binding) => specificity(when, state.world, binding) >= 0;
  function enterable(p, binding) {
    return matches(p.when, binding) && (p.prerequisites || []).every(id => state.completedPhases.includes(id));
  }
  function progress(binding = {}) {
    const p = phase();
    if (state.completed < state.dwell || !p.next?.length) return true;
    const edges = p.next.filter(e => matches(e.when, binding) && enterable(def.phases.find(x => x.id === e.to), binding));
    const edge = weighted(edges, e => e.weight ?? 1, () => random.next());
    if (!edge) return false;
    state.phase = edge.to; state.completed = 0; state.dwell = sampleDwell();
    return true;
  }
  function bindings(card, request) {
    const ids = Object.keys(state.world.players), roles = card.roles || 0;
    if (!roles) return [{}];
    const actors = request.actor ? ids.filter(id => id === request.actor) : ids;
    if (roles === 1) return actors.map(actor => ({ actor }));
    return actors.flatMap(actor => ids.filter(partner => partner !== actor && (!request.partner || request.partner === partner)).map(partner => ({ actor, partner })));
  }
  function drawNext(request = {}) {
    if (state.pending) throw new Error('Complete or skip the pending offer first');
    const p = phase();
    if (p.terminal) return { status: 'done' };
    if (!progress(request)) return { status: 'dead-end', reason: 'blocked-transition' };
    if (phase().terminal) return { status: 'done' };
    if (!enterable(phase(), request)) return { status: 'dead-end', reason: 'phase-prerequisite' };
    const breather = !!phase().breather || director.breatherEvery > 0 && state.sinceBreather >= director.breatherEvery;
    const target = breather ? Math.min(director.breatherHeat, director.maxHeat) : Math.min(director.maxHeat, targetHeat(director.curve, state.turn));
    const recent = state.history.slice(-director.recencyWindow || state.history.length);
    const counts = new Map();
    for (const row of state.history) for (const tag of row.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    let candidates = [];
    for (const card of def.cards) {
      const tags = card.tags || [];
      if (card.phases && !card.phases.includes(state.phase) || (card.heat || 0) > director.maxHeat
        || breather && (!card.breather || (card.heat || 0) > director.breatherHeat)
        || request.tagsAll?.some(t => !tags.includes(t))
        || request.tagsAny?.length && !request.tagsAny.some(t => tags.includes(t))
        || request.excludeIds?.includes(card.id)) continue;
      for (const binding of bindings(card, request)) {
        if (!matches(card.when, binding)) continue;
        const rules = resolveRules(def.rules || [], state.world, binding);
        if (rules.some(r => (card.heat || 0) > (r.maxHeat ?? 100))) continue;
        let utility = card.weight ?? 1;
        for (const rule of rules) for (const tag of tags) utility *= rule.tagWeights && own(rule.tagWeights, tag) ? rule.tagWeights[tag] : 1;
        utility *= 1 / (1 + Math.abs((card.heat || 0) - target) / director.heatTolerance);
        const recency = director.recencyWindow ? recent.reduce((n, h) => n + h.tags.filter(t => tags.includes(t)).length, 0) : 0;
        utility *= 1 / (1 + recency);
        utility *= 1 + director.noveltyBonus * tags.filter(t => !counts.has(t)).length;
        const ids = Object.values(binding);
        const exposure = ids.reduce((n, id) => n + (state.exposure[id] || 0), 0) / (ids.length || 1);
        const pairCount = binding.partner ? state.pairExposure[pairKey(binding.actor, binding.partner)] || 0 : 0;
        utility *= 1 / (1 + director.fairness * (exposure + pairCount));
        // Fairness is a hard least-exposed tier below; this still weights pair history.
        if (!Number.isFinite(utility)) throw new Error('Utility overflow: reduce authored weights');
        if (utility > 0) candidates.push({ card, binding, utility, rules: rules.map(r => r.id), exposure });
      }
    }
    if (!candidates.length) return { status: 'dead-end', reason: breather ? 'breather-required' : 'no-eligible-cards' };
    let pool = candidates.filter(c => !state.seen.includes(c.card.id)
      && (c.card.text === undefined || !state.seenText.includes(normalize(c.card.text))));
    let cycling = false;
    if (!pool.length && def.repeat === 'cycle') { pool = candidates; cycling = true; }
    if (!pool.length) return { status: 'dead-end', reason: 'exhausted' };
    const last = state.history.at(-1);
    function preparePool(rows) {
      // Fairness is a hard least-exposed tier within each role count.
      const minExposure = new Map();
      for (const c of rows) { const n = c.card.roles || 0; minExposure.set(n, Math.min(minExposure.get(n) ?? Infinity, c.exposure)); }
      if (director.fairness) rows = rows.filter(c => c.exposure === minExposure.get(c.card.roles || 0));
      const alternatives = rows.filter(c => c.card.id !== last?.id && (c.card.text === undefined || normalize(c.card.text) !== last?.text));
      return alternatives.length ? alternatives : rows;
    }
    pool = preparePool(pool);
    while (pool.length) {
      const chosen = weighted(pool, c => c.utility, () => random.next());
      if (!chosen) break;
      const { card, binding } = chosen;
      const slots = { ...(request.slots || {}) };
      if (binding.actor) slots.actor = state.world.players[binding.actor].name;
      if (binding.partner) slots.partner = state.world.players[binding.partner].name;
      const text = card.text ?? expand(card.template, def.grammar || {}, slots, () => random.next());
      const normalized = normalize(text);
      if ((!cycling && state.seenText.includes(normalized)) || cycling && last?.text === normalized && candidates.some(c => c.card.text && normalize(c.card.text) !== normalized)) {
        pool = pool.filter(c => c.card.id !== card.id);
        // Template outputs can collide even when source IDs differ. A cycling
        // deck may restart once, with the same hard filters and fairness tier.
        if (!pool.length && !cycling && def.repeat === 'cycle') { cycling = true; pool = preparePool(candidates); }
        continue;
      }
      if (cycling) {
        const ids = new Set(candidates.map(c => c.card.id));
        state.seen = state.seen.filter(id => !ids.has(id));
        const texts = new Set(state.history.filter(h => ids.has(h.id)).map(h => h.text));
        state.seenText = state.seenText.filter(t => !texts.has(t));
      }
      state.turn++;
      const offer = { status: 'offered', token: `${state.turn}:${card.id}`, id: card.id, text,
        phase: state.phase, binding, tags: card.tags || [], heat: card.heat || 0, targetHeat: target, breather: !!card.breather, rules: chosen.rules };
      state.pending = clone(offer);
      state.seen.push(card.id); state.seenText.push(normalized);
      state.history.push({ id: card.id, text: normalized, phase: state.phase, tags: card.tags || [], heat: card.heat || 0, targetHeat: target, binding: clone(binding), outcome: 'pending' });
      for (const pid of Object.values(binding)) state.exposure[pid] = (state.exposure[pid] || 0) + 1;
      if (binding.partner) { const key = pairKey(binding.actor, binding.partner); state.pairExposure[key] = (state.pairExposure[key] || 0) + 1; }
      state.sinceBreather = card.breather ? 0 : state.sinceBreather + 1;
      return clone(offer);
    }
    return { status: 'dead-end', reason: 'text-exhausted' };
  }
  function draw(request = {}) {
    const before = clone(state), rng = random.state();
    try { return drawNext(request); }
    catch (error) {
      state = before;
      const restored = createRandom(before.seed, rng);
      random.next = restored.next; random.state = restored.state;
      throw error;
    }
  }
  function settle(token, outcome) {
    if (!state.pending || state.pending.token !== token) return false;
    const offer = state.pending;
    if (outcome === 'complete') {
      // Transactional effects: a bad runtime type cannot partially change the world.
      const next = clone(state.world), card = def.cards.find(c => c.id === offer.id);
      applyEffects(next, card.effects || [], offer.binding);
      state.world = next; state.completed++;
      if (state.completed >= state.dwell && !state.completedPhases.includes(state.phase)) state.completedPhases.push(state.phase);
    }
    state.history.at(-1).outcome = outcome; state.pending = null;
    // Transition at the next draw, where the caller supplies current bindings.
    return true;
  }
  function setQuality(scope, key, value, binding = {}) {
    if (state.pending) throw new Error('Cannot change qualities during an offer');
    if (!safeKey(key) || !quality(value)) throw new Error('Invalid quality');
    const record = entity(state.world, scope, binding, true);
    if (!record) throw new Error('Invalid quality scope/binding');
    record[key] = clone(value);
  }
  function snapshot() { return { schemaVersion: 1, definition: signature, rng: random.state(), state: clone(state) }; }
  function restore(saved) {
    if (!saved || saved.schemaVersion !== 1 || saved.definition !== signature) throw new Error('Snapshot content/version mismatch');
    // Snapshots are trusted server data, but reject malformed/tampered shapes.
    const s = saved.state;
    if (!s || typeof s.seed !== 'string' || !def.phases.some(p => p.id === s.phase)
      || !Number.isInteger(s.turn) || s.turn < 0 || !Number.isInteger(s.dwell) || s.dwell < 1
      || !Number.isInteger(s.completed) || s.completed < 0 || !Number.isInteger(s.sinceBreather) || s.sinceBreather < 0
      || !Array.isArray(s.history) || s.history.length !== s.turn
      || !Array.isArray(s.seen) || !Array.isArray(s.seenText) || !Array.isArray(s.completedPhases)
      || !s.world?.players || !s.world.pairs) throw new Error('Invalid snapshot');
    qualities(s.world.table); qualities(s.world.session);
    for (const [id, p] of Object.entries(s.world.players)) {
      if (!safeKey(id) || typeof p.name !== 'string') throw new Error('Invalid snapshot player');
      qualities(p.qualities);
    }
    for (const [key, q] of Object.entries(s.world.pairs)) {
      let ids; try { ids = JSON.parse(key); } catch { throw new Error('Invalid snapshot pair'); }
      if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1] || !ids.every(id => own(s.world.players, id)) || pairKey(...ids) !== key) throw new Error('Invalid snapshot pair');
      qualities(q);
    }
    if (s.pending && (s.pending.token !== `${s.turn}:${s.pending.id}` || !def.cards.some(c => c.id === s.pending.id))) throw new Error('Invalid pending snapshot');
    const restored = createRandom(s.seed, saved.rng);
    random.next = restored.next; random.state = restored.state;
    state = clone(s);
  }
  if (options.snapshot) restore(options.snapshot);
  return { draw, complete: token => settle(token, 'complete'), skip: token => settle(token, 'skip'), setQuality,
    snapshot, inspect: () => clone(state) };
}
module.exports = { createEngine, validateDefinition, targetHeat, normalize, pairKey };
