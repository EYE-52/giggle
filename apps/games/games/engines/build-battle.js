'use strict';
/* Build-battle rule engine: shared server-authoritative rules for
 * team build-then-siege party games (castle-clash is the reference).
 *
 * One exported factory, no per-game rule forks:
 *   const game = createBuildBattle(config);
 *   module.exports = { id, minPlayers, maxPlayers, manifest,
 *     create: game.create, onAction: game.onAction, view: game.view,
 *     dispose: game.dispose };
 *
 * Config shape (all plain JSON-able data):
 *   arena:   { cols, rows, zones: { red: {x0,y0,x1,y1}, blue: {...} } }
 *   pieces:  { [pieceId]: { cost, hp, unlockAt=0, maxLevel=2,
 *                           ward=0, boost=0, coverWeight=1 } }
 *   weapons: { [weaponId]: { damage, cooldownMs, unlockAt=0 } }
 *   economy: { startResources, maxResources, refundRate=0.5,
 *              destroyBonus=10, resourceName, pointsName }
 *   objective (optional): { piece='core', hp=100, destroyBonus=50,
 *              surviveRate=0.5, positions: { red:{x,y}, blue:{x,y} } }
 *   defense (optional): { coverPerAdjacent=0.08, maxCover=0.5,
 *              maxWard=0.3, maxBoost=0.3 }
 *   phases:  { buildMs=45000, siegeMs=45000 }          // defaults only
 *   rounds:  3                                        // default count
 *   bounds:  { buildSeconds:{min,max}, siegeSeconds:{min,max},
 *              rounds:{min,max} }                     // settings clamps
 *   teamNames: ['Red','Blue']                         // locale may override
 *   contentId: '<game-id>'                            // ctx.content lookup
 *   winBonus: 50
 *   supplies (optional): { cadenceMs=8000, ttlMs=8000, bricks, points,
 *     spots (auto: front-row cells), orders: [
 *       { id, kind: 'cells'|'piece'|'upgrades', piece?, count,
 *         bricks=0, points=0 } ] }                    // build pacing
 *
 * Objective (when configured): each team is seeded one indestructible-by-
 * teardown base at round start. It is never buildable, removable,
 * refundable, or upgradeable. It is always attackable in siege, so an
 * empty fort cannot hide. Destroying the foe objective pays destroyBonus
 * and ends the round immediately; surviving core HP pays floor(hp *
 * surviveRate) to its owner at round end. Without `objective` the engine
 * keeps the legacy empty-siege-skip behavior (generic variants).
 *
 * Defense (deterministic, server-resolved, shown in view):
 *   cover: each friendly non-objective structure adjacent (8-neighborhood)
 *     to your objective cuts damage TO the objective by coverPerAdjacent
 *     times its coverWeight, capped at maxCover.
 *   ward:  each surviving structure contributes its piece `ward` to reduce
 *     ALL incoming damage to its team, capped at maxWard.
 *   boost: each surviving structure contributes its piece `boost` to raise
 *     its team's outgoing siege damage, capped at maxBoost.
 * Effective damage = floor(base * (1+boost) * (1-ward) * (1-cover-if-core)),
 * minimum 1. No redirection: shots always hit the tapped cell.
 *
 * Rules owned here: stable team assignment, phased timers (build then
 * siege per round), shared bounded team resources, atomic validated
 * build/upgrade/teardown inside the actor's own zone, unlockable
 * pieces/weapons via team authority points, server-resolved siege
 * shots with per-player cooldowns, exactly-once round transitions,
 * replay-safe mutating actions (client nonces), spectator-safe views.
 * Earned unlocks are logged once each (`unlock` entries); starting
 * unlocks stay silent. Clients never report hits, points, or timestamps.
 *
 * Supplies/orders (optional, castle-style build pacing): when `supplies`
 * is configured, each build round spawns timed supply chests (one live
 * chest per team) on a predictable cadence, plus per-round build orders
 * (e.g. place N structures, build N of a piece, perform N upgrades).
 * Chests are PURELY clock-derived from buildStartAt + cadence — no extra
 * timers, so the single phase-timer contract (and its exact-once tests)
 * is untouched; claims ride the normal action broadcast. A chest is
 * claimed once via {claimSupply:{id,nonce}} before it expires and pays
 * bounded bricks + authority; late/stale/replayed/wrong-team claims
 * drop. Orders pay bounded bricks/authority ONCE per round per team from
 * persistent unique-cell/upgrade counters, so place-teardown loops never
 * re-trigger. Without `supplies` the engine behaves exactly as before.
 *
 * Event sequencing for scene clients (3D projectiles): every log entry
 * carries a server-assigned monotonic numeric `id` (per instance,
 * `_eventSeq`, never reset across rounds) and a server-clock `when`
 * (ctx.now, never wall time). Clients baseline the max seen id and play
 * each accepted shot exactly once — replays, cooldowns, and reconnects
 * never mint a new id, so effects never double. `victimTeam` on shot
 * entries names the hit side explicitly; the shooter's pid is deliberately
 * absent (with public cooldowns it would leak per-player readyAt).
 */

function isInt(n) {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function key(x, y) {
  return x + ',' + y;
}

function inZone(zone, x, y) {
  return zone && isInt(x) && isInt(y) &&
    x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1;
}

function validNonce(n) {
  return typeof n === 'string' && n.length >= 1 && n.length <= 64;
}

function nextUnlockFor(teamPoints, catalog, unlocked) {
  // Earliest still-locked entry across pieces + weapons, or null.
  const have = new Set(unlocked);
  let best = null;
  for (const kind of ['piece', 'weapon']) {
    const table = kind === 'piece' ? catalog.pieces : catalog.weapons;
    for (const id of Object.keys(table)) {
      const at = table[id].unlockAt || 0;
      if (at <= 0 || have.has(kind + ':' + id)) continue;
      if (!best || at < best.at) best = { kind, id, at };
    }
  }
  return best;
}

function applyUnlocks(team, catalog) {
  // Unlock everything the team's lifetime points afford. Idempotent.
  // Returns the newly granted entries ([{kind,id,at}]) so callers can log
  // earned progression exactly once; starting (unlockAt 0) grants are
  // included here and filtered at the log call site.
  const have = new Set(team.unlocks);
  const newly = [];
  for (const kind of ['piece', 'weapon']) {
    const table = kind === 'piece' ? catalog.pieces : catalog.weapons;
    for (const id of Object.keys(table)) {
      const k = kind + ':' + id;
      if (!have.has(k) && team.points >= (table[id].unlockAt || 0)) {
        have.add(k);
        team.unlocks.push(k);
        newly.push({ kind, id, at: table[id].unlockAt || 0 });
      }
    }
  }
  return newly;
}

function createBuildBattle(config) {
  const cfg = config || {};
  const arena = cfg.arena || { cols: 8, rows: 8, zones: {} };
  const pieces = cfg.pieces || {};
  const weapons = cfg.weapons || {};
  const economy = Object.assign({
    startResources: 100, maxResources: 200, refundRate: 0.5,
    destroyBonus: 10, resourceName: 'bricks', pointsName: 'authority',
  }, cfg.economy || {});
  const bounds = cfg.bounds || {};
  const bBuild = bounds.buildSeconds || { min: 15, max: 120 };
  const bSiege = bounds.siegeSeconds || { min: 15, max: 120 };
  const bRounds = bounds.rounds || { min: 1, max: 5 };
  const winBonus = isInt(cfg.winBonus) ? cfg.winBonus : 50;

  // Optional objective/base. Null keeps legacy no-objective behavior.
  const objectiveCfg = (cfg.objective && typeof cfg.objective === 'object') ? {
    piece: (typeof cfg.objective.piece === 'string' && cfg.objective.piece)
      ? String(cfg.objective.piece).slice(0, 24) : 'core',
    hp: (isInt(cfg.objective.hp) && cfg.objective.hp > 0)
      ? Math.min(1000, cfg.objective.hp) : 100,
    destroyBonus: (isInt(cfg.objective.destroyBonus) && cfg.objective.destroyBonus >= 0)
      ? Math.min(1000, cfg.objective.destroyBonus) : 50,
    surviveRate: (isNum(cfg.objective.surviveRate) && cfg.objective.surviveRate >= 0)
      ? Math.min(2, cfg.objective.surviveRate) : 0.5,
    positions: (cfg.objective.positions && typeof cfg.objective.positions === 'object')
      ? cfg.objective.positions : null,
  } : null;

  const defenseCfg = {
    coverPerAdjacent: (cfg.defense && isNum(cfg.defense.coverPerAdjacent))
      ? clamp(cfg.defense.coverPerAdjacent, 0, 1) : 0.08,
    maxCover: (cfg.defense && isNum(cfg.defense.maxCover))
      ? clamp(cfg.defense.maxCover, 0, 0.9) : 0.5,
    maxWard: (cfg.defense && isNum(cfg.defense.maxWard))
      ? clamp(cfg.defense.maxWard, 0, 0.9) : 0.3,
    maxBoost: (cfg.defense && isNum(cfg.defense.maxBoost))
      ? clamp(cfg.defense.maxBoost, 0, 2) : 0.3,
  };

  // Optional supplies/orders (castle build pacing). Null keeps the legacy
  // behavior exactly: no chests, no orders, no new timers, no new log kinds.
  const suppliesCfg = (cfg.supplies && typeof cfg.supplies === 'object') ? (() => {
    const s = cfg.supplies;
    const cadenceMs = isInt(s.cadenceMs) ? clamp(s.cadenceMs, 2000, 60000) : 8000;
    const ttlMs = isInt(s.ttlMs) ? clamp(s.ttlMs, 2000, 60000) : cadenceMs;
    const orders = [];
    if (Array.isArray(s.orders)) {
      const seenIds = new Set();
      for (const o of s.orders.slice(0, 4)) {
        if (!o || typeof o !== 'object') continue;
        const id = typeof o.id === 'string' ? o.id.slice(0, 24) : '';
        if (!id || seenIds.has(id)) continue;
        const kind = o.kind;
        if (kind !== 'cells' && kind !== 'piece' && kind !== 'upgrades') continue;
        const piece = kind === 'piece' && typeof o.piece === 'string'
          ? o.piece.slice(0, 24) : null;
        if (kind === 'piece' && !pieces[piece]) continue; // unknown catalog piece
        const count = isInt(o.count) ? clamp(o.count, 1, 24) : 0;
        if (count < 1) continue;
        seenIds.add(id);
        orders.push({
          id,
          kind,
          piece,
          count,
          bricks: isInt(o.bricks) ? clamp(o.bricks, 0, 100) : 0,
          points: isInt(o.points) ? clamp(o.points, 0, 50) : 0,
        });
      }
    }
    return {
      cadenceMs,
      ttlMs,
      bricks: isInt(s.bricks) ? clamp(s.bricks, 0, 100) : 0,
      points: isInt(s.points) ? clamp(s.points, 0, 50) : 0,
      orders,
    };
  })() : null;

  function wardOf(pieceId) {
    const p = pieces[pieceId];
    const w = p && isNum(p.ward) ? p.ward : 0;
    return w > 0 ? Math.min(1, w) : 0;
  }

  function boostOf(pieceId) {
    const p = pieces[pieceId];
    const b = p && isNum(p.boost) ? p.boost : 0;
    return b > 0 ? Math.min(1, b) : 0;
  }

  function coverWeightOf(pieceId) {
    const p = pieces[pieceId];
    if (p && isNum(p.coverWeight)) return clamp(p.coverWeight, 0, 5);
    return 1;
  }

  function teamAura(grid) {
    let ward = 0;
    let boost = 0;
    for (const k of Object.keys(grid)) {
      const c = grid[k];
      if (!c || c.objective) continue;
      ward += wardOf(c.piece);
      boost += boostOf(c.piece);
    }
    return {
      ward: clamp(ward, 0, defenseCfg.maxWard),
      boost: clamp(boost, 0, defenseCfg.maxBoost),
    };
  }

  function findObjective(grid) {
    for (const k of Object.keys(grid)) {
      if (grid[k] && grid[k].objective) return grid[k];
    }
    return null;
  }

  function objectiveCover(grid) {
    if (!objectiveCfg) return { cover: 0, count: 0, weighted: 0 };
    const obj = findObjective(grid);
    if (!obj) return { cover: 0, count: 0, weighted: 0 };
    let count = 0;
    let weighted = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const c = grid[key(obj.x + dx, obj.y + dy)];
        if (c && !c.objective) {
          count += 1;
          weighted += coverWeightOf(c.piece);
        }
      }
    }
    return {
      cover: clamp(weighted * defenseCfg.coverPerAdjacent, 0, defenseCfg.maxCover),
      count,
      weighted,
    };
  }

  function pickObjectiveCell(teamZone, foeZone) {
    // Valid back-zone cell: farthest own-zone cell from the foe center,
    // tie-broken toward own center then smallest x/y. Deterministic.
    if (!teamZone) return null;
    const foe = foeZone
      ? { x: (foeZone.x0 + foeZone.x1) / 2, y: (foeZone.y0 + foeZone.y1) / 2 }
      : { x: teamZone.x0, y: teamZone.y0 };
    const own = { x: (teamZone.x0 + teamZone.x1) / 2, y: (teamZone.y0 + teamZone.y1) / 2 };
    let best = null;
    let bestD = -1;
    let bestOwn = Infinity;
    for (let y = teamZone.y0; y <= teamZone.y1; y++) {
      for (let x = teamZone.x0; x <= teamZone.x1; x++) {
        const d = (x - foe.x) * (x - foe.x) + (y - foe.y) * (y - foe.y);
        const o = Math.abs(x - own.x) + Math.abs(y - own.y);
        if (!best || d > bestD ||
          (d === bestD && (o < bestOwn ||
            (o === bestOwn && (x < best.x || (x === best.x && y < best.y)))))) {
          best = { x, y };
          bestD = d;
          bestOwn = o;
        }
      }
    }
    return best;
  }

  function objectiveCellFor(team) {
    if (!objectiveCfg) return null;
    const pos = objectiveCfg.positions ? objectiveCfg.positions[team] : null;
    if (pos && isInt(pos.x) && isInt(pos.y) && inZone(arena.zones[team], pos.x, pos.y)) {
      return {
        piece: objectiveCfg.piece, hp: objectiveCfg.hp, maxHp: objectiveCfg.hp,
        level: 1, x: pos.x, y: pos.y, objective: true,
      };
    }
    const auto = pickObjectiveCell(arena.zones[team], arena.zones[other(team)]);
    if (!auto) return null;
    return {
      piece: objectiveCfg.piece, hp: objectiveCfg.hp, maxHp: objectiveCfg.hp,
      level: 1, x: auto.x, y: auto.y, objective: true,
    };
  }

  function settingsOf(ctx) {
    const s = (ctx.settings ? ctx.settings() : {}) || {};
    const buildSeconds = isInt(s.buildSeconds)
      ? clamp(s.buildSeconds, bBuild.min, bBuild.max)
      : Math.round((cfg.phases && cfg.phases.buildMs ? cfg.phases.buildMs : 45000) / 1000);
    const siegeSeconds = isInt(s.siegeSeconds)
      ? clamp(s.siegeSeconds, bSiege.min, bSiege.max)
      : Math.round((cfg.phases && cfg.phases.siegeMs ? cfg.phases.siegeMs : 45000) / 1000);
    const rounds = isInt(s.rounds)
      ? clamp(s.rounds, bRounds.min, bRounds.max)
      : (isInt(cfg.rounds) ? cfg.rounds : 3);
    return { buildMs: buildSeconds * 1000, siegeMs: siegeSeconds * 1000, rounds };
  }

  function teamNamesOf(ctx) {
    let names = null;
    try {
      const c = ctx.content ? ctx.content(cfg.contentId || '') : null;
      if (c && Array.isArray(c.teamNames) && c.teamNames.length >= 2) names = c.teamNames;
    } catch { /* locale is a hint; defaults always work */ }
    if (!names) names = Array.isArray(cfg.teamNames) && cfg.teamNames.length >= 2
      ? cfg.teamNames : ['Red', 'Blue'];
    return [String(names[0]).slice(0, 24), String(names[1]).slice(0, 24)];
  }

  function schedule(state, ctx, ms, token, fn) {
    cancelPending(state);
    state._token = token;
    const mine = token;
    state._cancel = ctx.later(ms, () => {
      // Exactly-once: stale timers (fired after a reset/re-fire) die here.
      if (state._token !== mine || state.phase === 'done') return;
      fn();
    });
  }

  function cancelPending(state) {
    if (typeof state._cancel === 'function') {
      try { state._cancel(); } catch { /* best effort */ }
    }
    state._cancel = null;
  }

  function other(team) {
    return team === 'red' ? 'blue' : 'red';
  }

  function freshOrderProgress() {
    // Persistent per-round counters: unique cells ever built (and per-piece
    // splits) plus performed upgrades. Teardown never shrinks these, so
    // place-teardown loops cannot re-trigger orders.
    return { cells: [], pieces: {}, upgrades: 0, done: {} };
  }

  function supplySpots(team) {
    // Display-only chest anchors: two front-row cells (nearest the foe).
    const z = arena.zones[team];
    if (!z) return [[0, 0], [0, 0]];
    const foe = arena.zones[other(team)];
    let front = z.y0;
    if (foe) {
      const fy = (foe.y0 + foe.y1) / 2;
      front = Math.abs(z.y1 - fy) < Math.abs(z.y0 - fy) ? z.y1 : z.y0;
    }
    return [
      [Math.min(z.x0 + 1, z.x1), front],
      [Math.max(z.x1 - 1, z.x0), front],
    ];
  }

  function chestId(round, k) {
    return 'r' + round + 'c' + k;
  }

  function activeChestFor(state, team, now) {
    // The one live chest for a team, derived purely from the server clock.
    // Chest k spawns at buildStartAt + k*cadence (k>=1, strictly inside the
    // build window) and expires ttlMs later; claimed ids stay claimed.
    if (!suppliesCfg || state.phase !== 'build') return null;
    if (team !== 'red' && team !== 'blue') return null;
    const start = state.buildStartAt;
    if (!isNum(start) || !isNum(now) || now < start) return null;
    const k = Math.floor((now - start) / suppliesCfg.cadenceMs);
    if (k < 1) return null;
    const spawnAt = start + k * suppliesCfg.cadenceMs;
    if (spawnAt >= start + state.buildMs) return null;
    if (now > spawnAt + suppliesCfg.ttlMs) return null;
    const id = chestId(state.round, k);
    if (state.claimed && state.claimed[team] && state.claimed[team][id]) return null;
    const spots = supplySpots(team);
    const at = spots[(k - 1) % spots.length];
    return {
      id, k, team, x: at[0], y: at[1],
      spawnAt, expiresAt: spawnAt + suppliesCfg.ttlMs,
      bricks: suppliesCfg.bricks, points: suppliesCfg.points,
    };
  }

  function orderHave(prog, order) {
    if (!prog || !order) return 0;
    if (order.kind === 'cells') return prog.cells.length;
    if (order.kind === 'upgrades') return prog.upgrades;
    if (order.kind === 'piece') return (prog.pieces[order.piece] || []).length;
    return 0;
  }

  function grantOrders(state, ctx, team) {
    if (!suppliesCfg) return;
    const prog = state.orderProgress[team];
    if (!prog) return;
    const T = state.teams[team];
    for (const o of suppliesCfg.orders) {
      if (prog.done[o.id]) continue;
      if (orderHave(prog, o) < o.count) continue;
      prog.done[o.id] = 1;
      if (o.bricks > 0) T.resources = Math.min(economy.maxResources, T.resources + o.bricks);
      if (o.points > 0) {
        T.points += o.points;
        logUnlocks(state, ctx, team, applyUnlocks(T, { pieces, weapons }));
      }
      log(state, ctx, {
        kind: 'order', by: team, order: o.id,
        have: o.count, need: o.count, bricks: o.bricks, points: o.points,
      });
    }
  }

  function countGrid(grid) {
    return Object.keys(grid).length;
  }

  function log(state, ctx, entry) {
    // Server-owned sequencing: _eventSeq rises once per entry, across all
    // rounds; bounded rollover evicts old entries but never reuses ids.
    if (!isInt(state._eventSeq)) {
      let max = 0; // defensive backfill; create() always seeds 0.
      for (const e of state.log) {
        if (e && isInt(e.id) && e.id > max) max = e.id;
      }
      state._eventSeq = max;
    }
    state._eventSeq += 1;
    const when = ctx && typeof ctx.now === 'function' ? ctx.now() : Date.now();
    const base = entry && typeof entry === 'object' ? entry : {};
    // Server fields last: id/when can never be overridden by entry args
    // (and entry args are server-built anyway — client input is ignored).
    // `at` keeps its legacy meaning: round by default, unlock threshold
    // for unlock entries.
    state.log.push(Object.assign({ at: state.round }, base, { id: state._eventSeq, when }));
    if (state.log.length > 24) state.log.splice(0, state.log.length - 24);
  }

  function logUnlocks(state, ctx, teamId, newly) {
    // Earned progression only: starting (unlockAt 0) grants stay silent so
    // round-1 setup never spams the shared battle log.
    for (const u of newly || []) {
      if (!u || !(u.at > 0)) continue;
      log(state, ctx, { kind: 'unlock', by: teamId, unlockKind: u.kind, unlockId: u.id, at: u.at });
    }
  }

  function startBuild(state, ctx, round) {
    state.phase = 'build';
    state.round = round;
    for (const t of ['red', 'blue']) {
      state.grids[t] = {};
      state.teams[t].resources = Math.min(economy.maxResources, economy.startResources);
      logUnlocks(state, ctx, t, applyUnlocks(state.teams[t], { pieces, weapons }));
    }
    if (objectiveCfg) {
      for (const t of ['red', 'blue']) {
        const cell = objectiveCellFor(t);
        if (cell) state.grids[t][key(cell.x, cell.y)] = cell;
      }
    }
    state.cooldowns = {};
    state.builtThisRound = 0;
    state.siegeStartCounts = null;
    state.buildStartAt = ctx.now();
    state.claimed = { red: {}, blue: {} };
    state.orderProgress = { red: freshOrderProgress(), blue: freshOrderProgress() };
    state.endsAt = ctx.now() + state.buildMs;
    const token = 'build' + round + '#' + state._gen;
    schedule(state, ctx, state.buildMs, token, () => enterSiege(state, ctx));
  }

  function enterSiege(state, ctx) {
    if (state.phase !== 'build') return; // duplicate timer fire: no-op
    state.phase = 'siege';
    state.endsAt = ctx.now() + state.siegeMs;
    state.siegeStartCounts = {
      red: countGrid(state.grids.red),
      blue: countGrid(state.grids.blue),
    };
    log(state, ctx, { kind: 'siege', detail: 'The siege begins!' });
    // Legacy variants without an objective skip dead air. With an
    // objective the cores guarantee targets, so the siege always runs.
    if (!objectiveCfg && state.siegeStartCounts.red + state.siegeStartCounts.blue === 0) {
      endSiege(state, ctx);
      return;
    }
    const token = 'siege' + state.round + '#' + state._gen;
    schedule(state, ctx, state.siegeMs, token, () => endSiege(state, ctx));
    ctx.broadcast();
  }

  function endSiege(state, ctx) {
    if (state.phase !== 'siege') return; // duplicate timer/early-end: no-op
    if (objectiveCfg) {
      for (const t of ['red', 'blue']) {
        const obj = findObjective(state.grids[t]);
        if (obj && obj.hp > 0) {
          const bonus = Math.floor(obj.hp * objectiveCfg.surviveRate);
          if (bonus > 0) {
            state.teams[t].points += bonus;
            log(state, ctx, { kind: 'survive', by: t, hp: obj.hp, bonus });
          }
        }
      }
      logUnlocks(state, ctx, 'red', applyUnlocks(state.teams.red, { pieces, weapons }));
      logUnlocks(state, ctx, 'blue', applyUnlocks(state.teams.blue, { pieces, weapons }));
    }
    const redPts = state.teams.red.points;
    const bluePts = state.teams.blue.points;
    const winner = redPts === bluePts ? null : (redPts > bluePts ? 'red' : 'blue');
    log(state, ctx, {
      kind: 'roundEnd',
      detail: winner ? `${state.teams[winner].name} leads the siege!` : 'Round tied!',
    });
    if (state.round >= state.rounds) {
      finish(state, ctx);
      ctx.broadcast(); // Timer-driven finals have no room action to publish the result.
      return;
    }
    // Between rounds: structures + resources + cooldowns reset, but earned
    // unlocks and lifetime points carry forward.
    startBuild(state, ctx, state.round + 1);
    ctx.broadcast();
  }

  function finish(state, ctx) {
    if (!state || state.phase === 'done') return; // no double finish/reward
    cancelPending(state);
    state.phase = 'done';
    state.endsAt = 0;
    const red = state.teams.red.points;
    const blue = state.teams.blue.points;
    const winners = red === blue ? ['red', 'blue'] : [red > blue ? 'red' : 'blue'];
    const winner = winners.length === 1 ? winners[0] : null;
    state.result = {
      winner,
      winners,
      teams: {
        red: { points: red, name: state.teams.red.name },
        blue: { points: blue, name: state.teams.blue.name },
      },
    };
    for (const t of ['red', 'blue']) {
      const team = state.teams[t];
      for (const pid of team.members) {
        state.scores[pid] = team.points;
        ctx.award(pid, team.points + (winners.includes(t) ? winBonus : 0));
      }
    }
  }

  function maybeEarlyEnd(state, ctx) {
    // A side wiped out mid-siege ends the round early — but only when that
    // side fielded at least one structure, so an empty side never ends it.
    // (With an objective, grids always start non-empty; core kills end the
    // round directly in doFire, wipes remain a safety net.)
    if (state.phase !== 'siege' || !state.siegeStartCounts) return;
    const r0 = countGrid(state.grids.red) === 0 && state.siegeStartCounts.red > 0;
    const b0 = countGrid(state.grids.blue) === 0 && state.siegeStartCounts.blue > 0;
    if (r0 || b0) {
      log(state, ctx, { kind: 'wipe', detail: 'A castle has fallen!' });
      endSiege(state, ctx);
    }
  }

  function create(ctx) {
    const { buildMs, siegeMs, rounds } = settingsOf(ctx);
    // Stable balanced assignment: roster order by seat id, alternating
    // teams, so re-reads and reconnects never reshuffle anyone.
    const roster = ctx.allPlayers().slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const [redName, blueName] = teamNamesOf(ctx);
    const state = {
      phase: 'build',
      round: 1,
      rounds,
      buildMs,
      siegeMs,
      teams: {
        red: { name: redName, members: [], resources: 0, points: 0, unlocks: [] },
        blue: { name: blueName, members: [], resources: 0, points: 0, unlocks: [] },
      },
      memberTeam: {},
      grids: { red: {}, blue: {} },
      cooldowns: {},
      seen: {},
      seenOrder: [],
      log: [],
      _eventSeq: 0,
      endsAt: 0,
      builtThisRound: 0,
      siegeStartCounts: null,
      buildStartAt: 0,
      claimed: { red: {}, blue: {} },
      orderProgress: { red: freshOrderProgress(), blue: freshOrderProgress() },
      result: null,
      scores: {},
      _cancel: null,
      _token: null,
      _gen: 1,
    };
    roster.forEach((p, i) => {
      const t = i % 2 === 0 ? 'red' : 'blue';
      state.teams[t].members.push(p.id);
      state.memberTeam[p.id] = t;
    });
    startBuild(state, ctx, 1);
    return state;
  }

  /* Claim a nonce exactly once. Returns false for replays (no-op). */
  function claimNonce(state, nonce) {
    if (!validNonce(nonce)) return false;
    if (state.seen[nonce]) return false;
    state.seen[nonce] = 1;
    state.seenOrder.push(nonce);
    if (state.seenOrder.length > 1000) {
      const drop = state.seenOrder.splice(0, state.seenOrder.length - 1000);
      for (const n of drop) delete state.seen[n];
    }
    return true;
  }

  function doBuild(state, ctx, pid, b) {
    if (state.phase !== 'build') return;
    const team = state.memberTeam[pid];
    if (!team) return; // spectators / strangers: silent no-op
    if (!b || typeof b !== 'object') return;
    // The actor's team is derived from membership — any teamId the client
    // sends is ignored, so nobody can spend another team's resources.
    const piece = pieces[b.piece];
    if (!piece) return; // unknown piece (objectives are not buildable)
    const T = state.teams[team];
    if ((piece.unlockAt || 0) > 0 && !T.unlocks.includes('piece:' + b.piece)) return;
    if (!isInt(b.x) || !isInt(b.y)) return;
    if (!inZone(arena.zones[team], b.x, b.y)) return; // own zone only
    if (state.grids[team][key(b.x, b.y)]) return; // occupied (incl. objective)
    if (!isInt(piece.cost) || piece.cost < 0 || T.resources < piece.cost) return; // over budget
    if (!claimNonce(state, b.nonce)) return; // replayed purchase
    // Atomic: every check passed, so apply together.
    T.resources -= piece.cost;
    state.grids[team][key(b.x, b.y)] = {
      piece: b.piece, hp: piece.hp, maxHp: piece.hp, level: 1, x: b.x, y: b.y,
    };
    state.builtThisRound += 1;
    if (suppliesCfg) {
      const prog = state.orderProgress[team];
      const ck = key(b.x, b.y);
      if (!prog.cells.includes(ck)) prog.cells.push(ck);
      const split = prog.pieces[b.piece] || (prog.pieces[b.piece] = []);
      if (!split.includes(ck)) split.push(ck);
      grantOrders(state, ctx, team);
    }
  }

  function doUpgrade(state, ctx, pid, u) {
    if (state.phase !== 'build') return;
    const team = state.memberTeam[pid];
    if (!team || !u || typeof u !== 'object') return;
    if (!isInt(u.x) || !isInt(u.y)) return;
    const cell = state.grids[team][key(u.x, u.y)];
    if (!cell || cell.objective) return; // objectives never upgrade into mints
    const piece = pieces[cell.piece];
    if (!piece) return;
    const maxLevel = isInt(piece.maxLevel) ? piece.maxLevel : 2;
    if (cell.level >= maxLevel) return;
    const T = state.teams[team];
    const cost = piece.cost; // each level costs the base price again
    if (T.resources < cost) return;
    if (!claimNonce(state, u.nonce)) return;
    T.resources -= cost;
    cell.level += 1;
    cell.maxHp = piece.hp * cell.level;
    cell.hp = cell.maxHp;
    if (suppliesCfg) {
      state.orderProgress[team].upgrades += 1;
      grantOrders(state, ctx, team);
    }
  }

  function doTeardown(state, ctx, pid, t) {
    if (state.phase !== 'build') return;
    const team = state.memberTeam[pid];
    if (!team || !t || typeof t !== 'object') return;
    if (!isInt(t.x) || !isInt(t.y)) return;
    const k = key(t.x, t.y);
    const cell = state.grids[team][k];
    if (!cell || cell.objective) return; // objectives never removable/refundable
    const piece = pieces[cell.piece];
    if (!piece) return;
    if (!claimNonce(state, t.nonce)) return;
    // Bounded refund of the invested cost only — never points, never mint.
    const invested = piece.cost * (cell.level || 1);
    const refund = Math.floor(invested * (economy.refundRate || 0));
    delete state.grids[team][k];
    state.teams[team].resources = Math.min(economy.maxResources, state.teams[team].resources + refund);
  }

  function doFire(state, ctx, pid, f) {
    if (state.phase !== 'siege') return;
    const team = state.memberTeam[pid];
    if (!team || !f || typeof f !== 'object') return;
    const weapon = weapons[f.weapon];
    if (!weapon) return;
    const T = state.teams[team];
    if ((weapon.unlockAt || 0) > 0 && !T.unlocks.includes('weapon:' + f.weapon)) return;
    if (!isInt(f.x) || !isInt(f.y)) return;
    const foe = other(team);
    if (!inZone(arena.zones[foe], f.x, f.y)) return; // enemy structures only
    const k = key(f.x, f.y);
    const cell = state.grids[foe][k];
    if (!cell) return; // empty tile: no shot, no cooldown, no points
    const now = ctx.now(); // server clock only; client timestamps ignored
    const cd = state.cooldowns[pid] || {};
    if ((cd[f.weapon] || 0) > now) return; // weapon still cooling down
    if (!claimNonce(state, f.nonce)) return; // replayed shot
    // Server-resolved hit: deterministic cover/ward/boost, no overkill mint.
    // No redirection: the tapped cell is always the damaged cell.
    const atk = teamAura(state.grids[team]);
    const def = teamAura(state.grids[foe]);
    let cover = 0;
    let coverCount = 0;
    if (cell.objective) {
      const cov = objectiveCover(state.grids[foe]);
      cover = cov.cover;
      coverCount = cov.count;
    }
    const mult = (1 + atk.boost) * (1 - def.ward) * (1 - cover);
    const effective = Math.max(1, Math.floor(weapon.damage * mult));
    const dealt = Math.min(cell.hp, effective);
    cell.hp -= dealt;
    T.points += dealt;
    cd[f.weapon] = now + (weapon.cooldownMs || 0);
    state.cooldowns[pid] = cd;
    let destroyed = false;
    let coreFall = false;
    if (cell.hp <= 0) {
      delete state.grids[foe][k];
      destroyed = true;
      if (cell.objective && objectiveCfg) {
        T.points += objectiveCfg.destroyBonus;
        coreFall = true;
      } else {
        T.points += economy.destroyBonus;
      }
    }
    logUnlocks(state, ctx, team, applyUnlocks(T, { pieces, weapons }));
    log(state, ctx, {
      kind: coreFall ? 'corefall' : destroyed ? 'destroy' : 'hit',
      by: team,
      victimTeam: foe,
      weapon: f.weapon,
      x: f.x,
      y: f.y,
      base: weapon.damage,
      effective,
      dealt,
      destroyed,
      core: !!cell.objective,
      cover,
      coverCount,
      ward: def.ward,
      boost: atk.boost,
      bonus: coreFall ? objectiveCfg.destroyBonus : destroyed ? economy.destroyBonus : 0,
    });
    if (coreFall) {
      log(state, ctx, { kind: 'wipe', detail: 'A core has fallen!' });
      endSiege(state, ctx); // core kill ends the round immediately, exactly once
      return;
    }
    maybeEarlyEnd(state, ctx);
  }

  function doClaimSupply(state, ctx, pid, c) {
    // Timed build chest: the actor's team only, the live id only, once.
    if (!suppliesCfg || state.phase !== 'build') return;
    const team = state.memberTeam[pid];
    if (!team || !c || typeof c !== 'object') return;
    if (c.team !== undefined && c.team !== team) return; // wrong-team drop
    if (typeof c.id !== 'string' || !c.id) return;
    const chest = activeChestFor(state, team, ctx.now()); // server clock only
    if (!chest || chest.id !== c.id) return; // late/stale/claimed/unknown
    if (!claimNonce(state, c.nonce)) return; // replayed claim
    state.claimed[team][chest.id] = 1;
    const T = state.teams[team];
    if (chest.bricks > 0) T.resources = Math.min(economy.maxResources, T.resources + chest.bricks);
    if (chest.points > 0) {
      T.points += chest.points;
      logUnlocks(state, ctx, team, applyUnlocks(T, { pieces, weapons }));
    }
    log(state, ctx, {
      kind: 'supply', by: team, supplyId: chest.id,
      x: chest.x, y: chest.y, bricks: chest.bricks, points: chest.points,
    });
  }

  function onAction(state, ctx, pid, a) {
    if (!a || typeof a !== 'object') return;
    if (a.build !== undefined) doBuild(state, ctx, pid, a.build);
    else if (a.upgrade !== undefined) doUpgrade(state, ctx, pid, a.upgrade);
    else if (a.teardown !== undefined) doTeardown(state, ctx, pid, a.teardown);
    else if (a.fire !== undefined) doFire(state, ctx, pid, a.fire);
    else if (a.claimSupply !== undefined) doClaimSupply(state, ctx, pid, a.claimSupply);
    // Unknown fields (points, hits, timestamps…) are never trusted.
  }

  function view(state, pid) {
    const myTeam = state.memberTeam[pid] || null;
    const catalog = {
      pieces: Object.fromEntries(Object.keys(pieces).map((id) => [id, {
        cost: pieces[id].cost, hp: pieces[id].hp,
        maxLevel: isInt(pieces[id].maxLevel) ? pieces[id].maxLevel : 2,
        unlockAt: pieces[id].unlockAt || 0,
        ward: isNum(pieces[id].ward) ? pieces[id].ward : 0,
        boost: isNum(pieces[id].boost) ? pieces[id].boost : 0,
        coverWeight: isNum(pieces[id].coverWeight) ? pieces[id].coverWeight : 1,
      }])),
      weapons: Object.fromEntries(Object.keys(weapons).map((id) => [id, {
        damage: weapons[id].damage, cooldownMs: weapons[id].cooldownMs || 0,
        unlockAt: weapons[id].unlockAt || 0,
      }])),
    };
    const teams = {};
    for (const t of ['red', 'blue']) {
      const T = state.teams[t];
      teams[t] = {
        name: T.name,
        members: T.members.slice(),
        resources: T.resources,
        points: T.points,
        unlocks: T.unlocks.slice(),
        nextUnlock: nextUnlockFor(T.points, { pieces, weapons }, T.unlocks),
      };
    }
    // Both castles stay visible to everyone (spectators included): siege
    // strategy needs the enemy layout. Cooldowns are per-viewer only.
    const grids = {
      red: Object.values(state.grids.red),
      blue: Object.values(state.grids.blue),
    };
    const mine = state.cooldowns[pid] || {};
    let objectives = null;
    if (objectiveCfg) {
      objectives = {};
      for (const t of ['red', 'blue']) {
        const obj = findObjective(state.grids[t]);
        const cov = objectiveCover(state.grids[t]);
        objectives[t] = obj
          ? {
            x: obj.x, y: obj.y, hp: obj.hp, maxHp: obj.maxHp, alive: obj.hp > 0,
            cover: cov.cover, coverCount: cov.count, coverWeighted: cov.weighted,
          }
          : {
            x: null, y: null, hp: 0, maxHp: objectiveCfg.hp, alive: false,
            cover: 0, coverCount: 0, coverWeighted: 0,
          };
      }
    }
    return {
      phase: state.phase,
      round: state.round,
      rounds: state.rounds,
      buildMs: state.buildMs,
      siegeMs: state.siegeMs,
      endsAt: state.endsAt,
      myTeam,
      teams,
      grids,
      arena: { cols: arena.cols, rows: arena.rows, zones: arena.zones },
      catalog,
      economy: {
        resourceName: economy.resourceName,
        pointsName: economy.pointsName,
        startResources: economy.startResources,
        maxResources: economy.maxResources,
        refundRate: economy.refundRate,
        destroyBonus: economy.destroyBonus,
      },
      objective: objectiveCfg ? {
        piece: objectiveCfg.piece,
        hp: objectiveCfg.hp,
        destroyBonus: objectiveCfg.destroyBonus,
        surviveRate: objectiveCfg.surviveRate,
        defense: { ...defenseCfg },
      } : null,
      objectives,
      auras: {
        red: teamAura(state.grids.red),
        blue: teamAura(state.grids.blue),
      },
      supplies: suppliesCfg ? {
        cadenceMs: suppliesCfg.cadenceMs,
        ttlMs: suppliesCfg.ttlMs,
        bricks: suppliesCfg.bricks,
        points: suppliesCfg.points,
        buildStartAt: state.buildStartAt,
        round: state.round,
        spots: { red: supplySpots('red'), blue: supplySpots('blue') },
        claimed: {
          red: Object.keys(state.claimed.red),
          blue: Object.keys(state.claimed.blue),
        },
        orders: {
          red: suppliesCfg.orders.map((o) => ({
            id: o.id, kind: o.kind, piece: o.piece,
            have: Math.min(orderHave(state.orderProgress.red, o), o.count),
            need: o.count, done: !!state.orderProgress.red.done[o.id],
            bricks: o.bricks, points: o.points,
          })),
          blue: suppliesCfg.orders.map((o) => ({
            id: o.id, kind: o.kind, piece: o.piece,
            have: Math.min(orderHave(state.orderProgress.blue, o), o.count),
            need: o.count, done: !!state.orderProgress.blue.done[o.id],
            bricks: o.bricks, points: o.points,
          })),
        },
      } : null,
      winBonus,
      cooldowns: { ...mine },
      log: state.log.slice(-12),
      scores: { ...state.scores },
      result: state.result,
    };
  }

  function dispose(state) {
    // Cancel the pending phase timer so a reset/replaced game never fires
    // a stale transition. (Room also clears timers on game change.)
    if (state) {
      state._token = null;
      cancelPending(state);
    }
  }

  return { create, onAction, view, dispose };
}

module.exports = { createBuildBattle };
