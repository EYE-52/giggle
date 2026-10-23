// Record per-phase player views for every game by running the playability
// drivers with hooks. Output: snaps/<game>.json = [{phase, tag, now, w, players, hostId, totals, views:{pid:view}}]
// Usage: node record.js [repoPath] [game,game...]
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const registry = require(REPO + '/games/registry');
const { actionWindow } = require(REPO + '/games/_sdk');
const pl = require(REPO + '/test/game-playability.js');
const { drivers, FakeCtx } = pl;
// Real English packs (like a live room) instead of the drivers' fallbacks.
const LOC = path.join(REPO, 'locales', 'en');
const PACKS = {};
if (fs.existsSync(LOC)) for (const f of fs.readdirSync(LOC)) if (f.endsWith('.json')) PACKS[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(LOC, f), 'utf8'));
let usePacks = true;
FakeCtx.prototype.content = function (id) { return usePacks ? (PACKS[id] || {}) : {}; };
const SKIP = new Set(['pocket-karts', 'castle-clash']);
const OUT = process.env.SNAPS || path.join(__dirname, 'snaps');
fs.mkdirSync(OUT, { recursive: true });

let cur = null, game = null, snaps = null, steps = 0;
function viewsFor(def, state, ctx) {
  const out = {};
  const ids = ctx._players.map((p) => p.id).slice(0, 3).concat(['ghost']);
  for (const pid of ids) { try { out[pid] = JSON.parse(JSON.stringify(def.view(state, pid))); } catch (e) { out[pid] = { __error: String(e) }; } }
  return out;
}
function record(why) {
  if (!cur || !snaps) return;
  steps += 1;
  if (steps > 4000) return;
  const { def, state, ctx } = cur;
  const phase = String(state && state.phase);
  const snap = () => ({ phase, why, now: ctx._now, w: actionWindow(state), players: ctx._players.slice(), hostId: ctx.hostId(), totals: { ...ctx.awards }, views: viewsFor(def, state, ctx) });
  const seen = snaps.filter((s) => s.phase === phase);
  if (!seen.length) snaps.push({ ...snap(), tag: 'first' });
  else {
    // keep one 'mid' (the 3rd step in the phase) and keep refreshing 'last'
    const n = (cur.count[phase] = (cur.count[phase] || 0) + 1);
    if (n === 3 && !seen.some((s) => s.tag === 'mid')) snaps.push({ ...snap(), tag: 'mid' });
    else if (n % 1 === 0) {
      const i = snaps.findIndex((s) => s.phase === phase && s.tag === 'last');
      const s = { ...snap(), tag: 'last' };
      if (i >= 0) snaps[i] = s; else snaps.push(s);
    }
  }
}
for (const g of registry.list()) {
  const def = registry.get(g.id);
  const oc = def.create, oa = def.onAction, ot = def.onTick;
  def.create = function (ctx) { const s = oc.apply(this, arguments); if (game === g.id) { cur = { def, state: s, ctx, count: {} }; record('create'); } return s; };
  def.onAction = function (state, ctx) { const r = oa.apply(this, arguments); if (game === g.id && cur && cur.state === state) record('action'); return r; };
  if (ot) def.onTick = function (state) { const r = ot.apply(this, arguments); if (game === g.id && cur && cur.state === state) record('tick'); return r; };
}
const ofn = FakeCtx.prototype.fireNext;
FakeCtx.prototype.fireNext = function () { const r = ofn.apply(this, arguments); if (cur && cur.ctx === this) record('timer'); return r; };

for (const g of registry.list()) {
  if (SKIP.has(g.id) || (only && !only.has(g.id))) continue;
  const fn = drivers[g.id];
  if (!fn) { console.log('no driver', g.id); continue; }
  game = g.id; snaps = []; cur = null; steps = 0;
  usePacks = true;
  try { fn(g); } catch (e) {
    // Some drivers assume fallback content; retry without packs.
    snaps = []; cur = null; steps = 0; usePacks = false;
    try { fn(g); } catch (e2) { console.log('driver error', g.id, e2.message.slice(0, 120)); }
  }
  // The rematch invariant in the runner creates fresh instances; we only keep the driver's first instance.
  fs.writeFileSync(path.join(OUT, g.id + '.json'), JSON.stringify(snaps));
  console.log(g.id.padEnd(18), snaps.map((s) => s.phase + ':' + s.tag).join(' '));
  game = null; snaps = null; cur = null;
}
process.exit(0);
