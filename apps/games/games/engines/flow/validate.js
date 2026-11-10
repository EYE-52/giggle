'use strict';
const { safeKey, quality, SCOPES, OPS } = require('./state');
const { validateGrammar, requiredSlots } = require('./template');
function validateDefinition(def, validators = []) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); return ok; };
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const keys = (x, allowed, at) => {
    if (!check(object(x), `${at}: expected object`)) return false;
    for (const k of Object.keys(x)) check(allowed.includes(k), `${at}: unknown field ${k}`);
    return true;
  };
  const finite = (x, min = 0, max = Infinity) => Number.isFinite(x) && x >= min && x <= max;
  const strings = x => Array.isArray(x) && x.every(s => typeof s === 'string' && s.length > 0);
  function condition(c, at, depth = 0) {
    if (c === undefined && depth === 0) return;
    if (!check(depth < 16 && object(c), `${at}: invalid condition/depth`)) return;
    const groups = ['all', 'any', 'not'].filter(k => Object.hasOwn(c, k));
    if (groups.length) {
      if (!check(groups.length === 1 && Object.keys(c).length === 1, `${at}: mixed condition`)) return;
      const k = groups[0];
      if (k === 'not') { if (check(object(c.not), `${at}: invalid not`)) condition(c.not, at + '.not', depth + 1); }
      else if (check(Array.isArray(c[k]) && c[k].length > 0, `${at}: empty ${k}`)) c[k].forEach((v, i) => condition(v, `${at}.${k}[${i}]`, depth + 1));
    } else {
      keys(c, ['scope', 'key', 'op', 'value'], at);
      check(SCOPES.includes(c.scope) && safeKey(c.key) && OPS.includes(c.op), `${at}: invalid predicate`);
      if (c.op === 'exists') check(c.value === undefined || typeof c.value === 'boolean', `${at}: exists requires boolean`);
      else check(quality(c.value), `${at}: invalid comparison value`);
      if (['gt', 'gte', 'lt', 'lte'].includes(c.op)) check(typeof c.value === 'number' && finite(c.value, -Infinity), `${at}: comparison requires number`);
      if (c.op === 'includes') check(typeof c.value === 'string', `${at}: includes requires string`);
    }
  }
  function effects(rows, at, roles) {
    if (rows === undefined) return;
    if (!check(Array.isArray(rows), `${at}: expected effects array`)) return;
    rows.forEach((e, i) => {
      const p = `${at}[${i}]`;
      if (!keys(e, ['scope', 'key', 'op', 'value'], p)) return;
      check(SCOPES.includes(e.scope) && safeKey(e.key) && ['set', 'add', 'append'].includes(e.op) && quality(e.value), `${p}: invalid effect`);
      check(!['partner', 'pair'].includes(e.scope) || roles === 2, `${p}: two roles required`);
      check(e.scope !== 'player' || roles > 0, `${p}: player role required`);
      if (e.op === 'add') check(typeof e.value === 'number' && finite(e.value, -Infinity), `${p}: add requires finite number`);
      if (e.op === 'append') check(typeof e.value === 'string', `${p}: append requires string`);
    });
  }
  if (!keys(def, ['schemaVersion', 'id', 'version', 'cards', 'phases', 'start', 'rules', 'grammar', 'slots', 'director', 'repeat'], 'definition')) return errors;
  check(def.schemaVersion === 1 && safeKey(def.id) && typeof def.version === 'string' && def.version.length > 0, 'definition: schemaVersion/id/version required');
  check(def.repeat === undefined || ['never', 'cycle'].includes(def.repeat), 'definition: invalid repeat policy');
  check(def.slots === undefined || strings(def.slots) && def.slots.every(safeKey), 'definition: invalid slots');
  const phases = Array.isArray(def.phases) ? def.phases : [];
  const phaseIds = new Set(phases.map(p => p?.id));
  check(phases.length > 0 && phaseIds.size === phases.length && phaseIds.has(def.start), 'phases: unique IDs and valid start required');
  phases.forEach((p, i) => {
    const at = `phases[${i}]`;
    if (!keys(p, ['id', 'dwell', 'next', 'when', 'prerequisites', 'terminal', 'breather'], at)) return;
    check(safeKey(p.id), `${at}: invalid id`);
    check(Array.isArray(p.dwell) && p.dwell.length === 2 && p.dwell.every(n => Number.isInteger(n) && n >= 1) && p.dwell[1] >= p.dwell[0], `${at}: invalid dwell`);
    condition(p.when, at + '.when');
    check(p.prerequisites === undefined || strings(p.prerequisites) && p.prerequisites.every(id => phaseIds.has(id)), `${at}: invalid prerequisites`);
    for (const k of ['terminal', 'breather']) check(p[k] === undefined || typeof p[k] === 'boolean', `${at}: invalid ${k}`);
    if (check(p.next === undefined || Array.isArray(p.next), `${at}: invalid edges`)) for (const edge of p.next || []) {
      if (!keys(edge, ['to', 'when', 'weight'], at + '.next')) continue;
      check(phaseIds.has(edge.to) && (edge.weight === undefined || finite(edge.weight, Number.MIN_VALUE)), `${at}: invalid edge target/weight`);
      condition(edge.when, at + '.next.when');
    }
    check(!p.terminal || !p.next?.length, `${at}: terminal phase has edges`);
  });
  // Structural reachability catches misspelled/disconnected phases, not SAT of predicates.
  const reachable = new Set();
  function walk(id) { if (reachable.has(id)) return; reachable.add(id); const edges = phases.find(p => p?.id === id)?.next; if (Array.isArray(edges)) for (const e of edges) if (object(e)) walk(e.to); }
  if (phaseIds.has(def.start)) walk(def.start);
  for (const id of phaseIds) check(reachable.has(id), `phases: unreachable ${id}`);
  const cards = Array.isArray(def.cards) ? def.cards : [];
  check(cards.length > 0 && new Set(cards.map(c => c?.id)).size === cards.length, 'cards: nonempty array with unique IDs required');
  cards.forEach((c, i) => {
    const at = `cards[${i}]`;
    if (!keys(c, ['id', 'text', 'template', 'tags', 'effects', 'when', 'weight', 'heat', 'phases', 'roles', 'breather'], at)) return;
    check(safeKey(c.id), `${at}: invalid id`);
    check((typeof c.text === 'string') !== (typeof c.template === 'string'), `${at}: exactly one text or template required`);
    const text = c.text ?? c.template;
    check(typeof text === 'string' && text.trim().length > 0 && text.length <= 4096, `${at}: invalid text`);
    check(c.tags === undefined || strings(c.tags), `${at}: invalid tags`);
    check(c.phases === undefined || strings(c.phases) && c.phases.every(id => phaseIds.has(id)), `${at}: invalid phases`);
    check(c.roles === undefined || [0, 1, 2].includes(c.roles), `${at}: invalid roles`);
    check(c.weight === undefined || finite(c.weight, Number.MIN_VALUE, 1e6), `${at}: invalid weight`);
    check(c.heat === undefined || finite(c.heat, 0, 100), `${at}: invalid heat`);
    check(c.breather === undefined || typeof c.breather === 'boolean', `${at}: invalid breather`);
    condition(c.when, at + '.when'); effects(c.effects, at + '.effects', c.roles || 0);
  });
  if (check(def.rules === undefined || Array.isArray(def.rules), 'rules: expected array')) {
    const ids = new Set();
    for (const r of def.rules || []) {
      if (!keys(r, ['id', 'group', 'when', 'priority', 'tagWeights', 'maxHeat'], 'rule')) continue;
      check(safeKey(r.id) && safeKey(r.group) && !ids.has(r.id), 'rule: invalid/duplicate id or group'); ids.add(r.id);
      condition(r.when, 'rule.when');
      check(r.priority === undefined || Number.isInteger(r.priority), 'rule: invalid priority');
      check(r.maxHeat === undefined || finite(r.maxHeat, 0, 100), 'rule: invalid maxHeat');
      if (r.tagWeights !== undefined && check(object(r.tagWeights), 'rule: invalid tagWeights')) for (const [k, v] of Object.entries(r.tagWeights)) check(safeKey(k) && finite(v, 0, 100), 'rule: invalid tag weight');
    }
  }
  const d = def.director;
  if (d !== undefined && keys(d, ['curve', 'maxHeat', 'breatherEvery', 'breatherHeat', 'recencyWindow', 'noveltyBonus', 'fairness', 'heatTolerance'], 'director')) {
    check(Array.isArray(d.curve) && d.curve.length > 0 && d.curve.every((p, i) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && p[0] >= 0 && finite(p[1], 0, 100) && (!i || p[0] > d.curve[i - 1][0])), 'director: invalid curve');
    for (const k of ['maxHeat', 'breatherHeat']) check(d[k] === undefined || finite(d[k], 0, 100), `director: invalid ${k}`);
    for (const k of ['breatherEvery', 'recencyWindow']) check(d[k] === undefined || Number.isInteger(d[k]) && d[k] >= 0, `director: invalid ${k}`);
    for (const k of ['noveltyBonus', 'fairness']) check(d[k] === undefined || finite(d[k], 0, 100), `director: invalid ${k}`);
    check(d.heatTolerance === undefined || finite(d.heatTolerance, 1, 100), 'director: invalid heatTolerance');
  }
  try {
    validateGrammar(def.grammar || {}, cards.filter(c => typeof c?.template === 'string').map(c => c.template), ['actor', 'partner', ...(Array.isArray(def.slots) ? def.slots : [])]);
    for (const c of cards.filter(c => typeof c?.template === 'string')) {
      const slots = requiredSlots(c.template, def.grammar || {});
      check(!slots.has('actor') || c.roles >= 1, `${c.id}: actor slot requires player role`);
      check(!slots.has('partner') || c.roles === 2, `${c.id}: partner slot requires two roles`);
    }
  }
  catch (error) { errors.push(error.message); }
  for (const validator of validators) {
    try {
      const result = validator(def);
      if (!Array.isArray(result) || result.some(x => typeof x !== 'string')) errors.push('Validator must return string[]');
      else errors.push(...result);
    } catch (error) { errors.push(`Validator failed: ${error.message}`); }
  }
  return errors;
}
module.exports = { validateDefinition };
