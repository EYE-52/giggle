'use strict';
const own = (o, k) => o != null && Object.hasOwn(o, k);
const safeKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(key)
  && key !== 'prototype' && !Object.hasOwn(Object.prototype, key);
const quality = value => typeof value === 'boolean' || typeof value === 'string'
  || typeof value === 'number' && Number.isFinite(value)
  || Array.isArray(value) && value.every(x => typeof x === 'string');
const clone = value => JSON.parse(JSON.stringify(value));
const pairKey = (a, b) => JSON.stringify([a, b].sort());
const SCOPES = ['player', 'partner', 'pair', 'table', 'session'];
const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'includes', 'exists'];
function entity(world, scope, binding, write = false) {
  if (scope === 'table' || scope === 'session') return world[scope];
  const a = binding.actor, b = binding.partner;
  if (scope === 'player' || scope === 'partner') {
    const id = scope === 'player' ? a : b;
    return own(world.players, id) ? world.players[id].qualities : undefined;
  }
  if (scope === 'pair' && a && b && a !== b && own(world.players, a) && own(world.players, b)) {
    const key = pairKey(a, b);
    if (write && !own(world.pairs, key)) world.pairs[key] = {};
    return world.pairs[key];
  }
}
function specificity(condition, world, binding = {}) {
  if (!condition) return 0;
  if (condition.all) {
    const scores = condition.all.map(c => specificity(c, world, binding));
    return scores.some(n => n < 0) ? -1 : scores.reduce((a, b) => a + b, 0);
  }
  if (condition.any) return Math.max(-1, ...condition.any.map(c => specificity(c, world, binding)));
  if (condition.not) return specificity(condition.not, world, binding) < 0 ? 1 : -1;
  const record = entity(world, condition.scope, binding), exists = own(record, condition.key);
  if (condition.op === 'exists') return exists === (condition.value ?? true) ? 1 : -1;
  if (!exists) return -1;
  const a = record[condition.key], b = condition.value;
  let ok = false;
  switch (condition.op) {
    case 'eq': ok = JSON.stringify(a) === JSON.stringify(b); break;
    case 'neq': ok = JSON.stringify(a) !== JSON.stringify(b); break;
    case 'gt': ok = typeof a === 'number' && typeof b === 'number' && a > b; break;
    case 'gte': ok = typeof a === 'number' && typeof b === 'number' && a >= b; break;
    case 'lt': ok = typeof a === 'number' && typeof b === 'number' && a < b; break;
    case 'lte': ok = typeof a === 'number' && typeof b === 'number' && a <= b; break;
    case 'includes': ok = Array.isArray(a) && a.includes(b); break;
    default: throw new Error('Unknown condition operator');
  }
  return ok ? 1 : -1;
}
function resolveRules(rules, world, binding) {
  const groups = new Map();
  for (const rule of rules) {
    const score = specificity(rule.when, world, binding), old = groups.get(rule.group);
    if (score >= 0 && (!old || score > old.score || score === old.score && (rule.priority || 0) > (old.rule.priority || 0))) {
      groups.set(rule.group, { rule, score });
    }
  }
  return [...groups.values()].map(x => x.rule);
}
function applyEffects(world, effects, binding) {
  for (const effect of effects) {
    const record = entity(world, effect.scope, binding, true);
    if (!record) throw new Error(`Missing ${effect.scope} effect binding`);
    const { key, value, op } = effect;
    if (op === 'set') record[key] = clone(value);
    else if (op === 'add') {
      if (own(record, key) && typeof record[key] !== 'number') throw new Error('add requires numeric quality');
      const next = (record[key] ?? 0) + value;
      if (!Number.isFinite(next)) throw new Error('Quality overflow');
      record[key] = next;
    } else if (op === 'append') {
      if (own(record, key) && !Array.isArray(record[key])) throw new Error('append requires array quality');
      record[key] = [...new Set([...(record[key] || []), value])];
    }
  }
}
module.exports = { own, safeKey, quality, clone, pairKey, SCOPES, OPS, entity, specificity, resolveRules, applyEffects };
