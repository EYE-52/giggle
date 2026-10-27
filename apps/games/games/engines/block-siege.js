'use strict';
/* Server-owned deterministic support and swept projectile authority.
 * Pieces use local x/z and bottom y, in world units. No rigid-body claim. */
const EPS = 1e-6;
const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const half = value => finite(value) && Math.abs(value * 2 - Math.round(value * 2)) < EPS;
function boundsOf(p, offset = { x: 0, z: 0 }) {
  return { x0: p.x + offset.x - p.w / 2, x1: p.x + offset.x + p.w / 2,
    y0: p.y, y1: p.y + p.h, z0: p.z + offset.z - p.d / 2, z1: p.z + offset.z + p.d / 2 };
}
function overlap(a, b) {
  return a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.y0 < b.y1 - EPS && a.y1 > b.y0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;
}
function rectangleUnionArea(rects) {
  const xs = [...new Set(rects.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = (xs[i - 1] + xs[i]) / 2;
    const zs = rects.filter(r => r.x0 <= x && r.x1 >= x).map(r => [r.z0, r.z1]).sort((a, b) => a[0] - b[0]);
    let length = 0, end = -Infinity;
    for (const [lo, hi] of zs) { length += Math.max(0, hi - Math.max(lo, end)); end = Math.max(end, hi); }
    area += (xs[i] - xs[i - 1]) * length;
  }
  return area;
}
function supported(p, supports, minimum = .3) {
  if (Math.abs(p.y) < EPS) return true;
  const b = boundsOf(p), rects = [];
  for (const q of supports) {
    if (Math.abs(q.y + q.h - p.y) > EPS) continue;
    const a = boundsOf(q), r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) };
    if (r.x1 > r.x0 + EPS && r.z1 > r.z0 + EPS) rects.push(r);
  }
  return rects.some(r => p.x >= r.x0 - EPS && p.x <= r.x1 + EPS && p.z >= r.z0 - EPS && p.z <= r.z1 + EPS)
    && rectangleUnionArea(rects) + EPS >= p.w * p.d * minimum;
}
function standingPieces(pieces, minimum = .3) {
  const standing = [];
  for (const p of pieces.filter(p => p.hp > 0).slice().sort((a, b) => a.y - b.y || String(a.id).localeCompare(String(b.id))))
    if (supported(p, standing, minimum)) standing.push(p);
  return standing;
}
function segmentBox(a, b, box) {
  let low = 0, high = 1;
  for (const axis of ['x', 'y', 'z']) {
    const delta = b[axis] - a[axis], lo = box[axis + '0'], hi = box[axis + '1'];
    if (Math.abs(delta) < EPS) { if (a[axis] < lo || a[axis] > hi) return null; continue; }
    let t0 = (lo - a[axis]) / delta, t1 = (hi - a[axis]) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    low = Math.max(low, t0); high = Math.min(high, t1);
    if (low > high + EPS) return null;
  }
  return low;
}
function trajectoryPoint(shot, t) {
  return { x: shot.start.x + (shot.target.x - shot.start.x) * t,
    y: shot.start.y + (shot.target.y - shot.start.y) * t + 4 * shot.arc * t * (1 - t),
    z: shot.start.z + (shot.target.z - shot.start.z) * t };
}
function solids(state, except) {
  const list = [];
  for (const castle of state.castles) {
    if (castle.pid === except) continue;
    for (const p of castle.pieces) if (p.hp > 0) list.push({ castle, piece: p, box: boundsOf(p, castle.position) });
    if (castle.crown.hp > 0) list.push({ castle, piece: castle.crown, box: boundsOf(castle.crown, castle.position) });
  }
  return list;
}
function firstHit(state, shot, from = 0, to = 1) {
  const list = solids(state, shot.by), distance = Math.hypot(shot.target.x - shot.start.x, shot.target.y - shot.start.y, shot.target.z - shot.start.z);
  const steps = Math.max(32, Math.ceil((distance + shot.arc * 4) * (to - from) / .35));
  let a = trajectoryPoint(shot, from);
  for (let n = 1; n <= steps; n++) {
    const b = trajectoryPoint(shot, from + (to - from) * n / steps); let best = null;
    for (const solid of list) {
      const u = segmentBox(a, b, solid.box);
      if (u !== null && (!best || u < best.u - EPS || (Math.abs(u - best.u) < EPS && solid.piece.id < best.solid.piece.id))) best = { solid, u };
    }
    if (best) {
      const t = from + (to - from) * (n - 1 + best.u) / steps;
      return { pid: best.solid.castle.pid, piece: best.solid.piece.id, crown: !!best.solid.piece.crown, t, point: trajectoryPoint(shot, t) };
    }
    a = b;
  }
  return null;
}
function castlePositions(n) {
  if (n === 2) return [{ x: 0, z: 14 }, { x: 0, z: -14 }];
  if (n === 3) return [0, 1, 2].map(i => ({ x: Math.sin(i * Math.PI * 2 / 3) * 18, z: Math.cos(i * Math.PI * 2 / 3) * 18 }));
  return [{ x: -14, z: 14 }, { x: 14, z: 14 }, { x: 14, z: -14 }, { x: -14, z: -14 }];
}
function launcherOf(castle) {
  const length = Math.hypot(castle.position.x, castle.position.z) || 1;
  return { x: castle.position.x - castle.position.x / length * 3.5, y: 1.4, z: castle.position.z - castle.position.z / length * 3.5 };
}
function createBlockSiege(config) {
  const cfg = { size: 12, height: 12, maxPieces: 64, support: .3, crownHp: 120, rounds: 3, buildMs: 60000, siegeMs: 90000, effectMs: 1000, roundResultMs: 3500, ...config };
  const cards = cfg.cards, weapons = cfg.weapons;
  const heightOf = c => c.pieces.reduce((h, p) => Math.max(h, p.y + p.h), 0);
  function event(s, ctx, type, data = {}) {
    const e = { id: ++s.eventSeq, round: s.round, when: ctx.now(), type, ...data };
    s.events.push(e); if (s.events.length > 160) s.events.shift(); return e;
  }
  function cancel(s) { if (s.cancelTimer) s.cancelTimer(); s.cancelTimer = null; }
  function schedule(s, ctx) {
    cancel(s); if (s.disposed || s.phase === 'done') return;
    const dates = [];
    if (s.phase === 'build') dates.push(Math.min(s.endsAt, ctx.now() + 500));
    if (s.phase === 'siege') { dates.push(Math.min(s.endsAt, ctx.now() + 500)); for (const c of s.castles) if (c.refillAt > ctx.now() && c.ammo.ballista < weapons.ballista.ammo) dates.push(c.refillAt); }
    if (s.phase === 'round-result') dates.push(s.endsAt);
    for (const shot of s.pending) { const predicted = firstHit(s, shot, shot.progress, 1); shot.predictedHit = predicted; shot.impactAt = predicted ? shot.startAt + Math.ceil(shot.duration * predicted.t) : shot.endAt; dates.push(shot.impactAt); }
    if (s.phase === 'resolving' && !s.pending.length) dates.push(s.finishAt);
    if (!dates.length) return;
    const token = ++s.timerToken;
    s.cancelTimer = ctx.later(Math.max(1, Math.min(...dates) - ctx.now()), () => {
      if (s.disposed || token !== s.timerToken) return;
      s.cancelTimer = null; advance(s, ctx); ctx.broadcast(); schedule(s, ctx);
    });
  }
  function startRound(s, ctx) {
    s.phase = 'build'; s.endsAt = ctx.now() + s.buildMs; s.finishAt = 0; s.pending = []; s.roundResult = null;
    for (const c of s.castles) {
      c.ready = false; c.damage = 0; c.alive = true; c.hand = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, card.quantity]));
      c.ammo = {}; c.cooldowns = {}; c.refillAt = 0; c.history = [];
      c.crown = { id: c.pid + '-crown', crown: true, x: 0, y: 0, z: 0, w: 1.2, d: 1.2, h: 1.8, hp: cfg.crownHp, maxHp: cfg.crownHp };
      c.pieces = [[-2, 0], [2, 0], [0, -2], [0, 2]].map(([x, z], i) => ({ id: c.pid + '-foundation-' + s.round + '-' + i, card: 'slab', material: 'stone', x, y: 0, z, w: 2, d: 2, h: .5, hp: 65, maxHp: 65, foundation: true }));
    }
    event(s, ctx, 'phase', { phase: 'build' });
  }
  function startSiege(s, ctx) {
    if (s.phase !== 'build') return;
    s.phase = 'siege'; s.endsAt = ctx.now() + s.siegeMs;
    for (const c of s.castles) { c.ammo = Object.fromEntries(Object.entries(weapons).map(([id, weapon]) => [id, weapon.ammo])); c.cooldowns = {}; c.refillAt = ctx.now() + 5000; }
    event(s, ctx, 'phase', { phase: 'siege' });
  }
  function ranking(s, cumulative = false) {
    return s.castles.slice().sort((a, b) => cumulative ? b.wins - a.wins || b.totalHealth - a.totalHealth || b.totalDamage - a.totalDamage
      : b.crown.hp - a.crown.hp || heightOf(b) - heightOf(a) || b.damage - a.damage);
  }
  function finishRound(s, ctx) {
    if (s.phase !== 'resolving') return;
    const alive = s.castles.filter(c => c.alive), ranked = ranking(s), best = ranked[0];
    let winners = alive.length === 1 ? [alive[0].pid] : alive.length === 0 ? [] : ranked.filter(c => c.crown.hp === best.crown.hp && Math.abs(heightOf(c) - heightOf(best)) < EPS && c.damage === best.damage).map(c => c.pid);
    const reason = alive.length === 1 ? 'Last Crown standing' : alive.length === 0 ? 'All Crowns fell — draw' : winners.length > 1 ? 'Equal health, height and damage — draw' : ranked[0].crown.hp !== ranked[1]?.crown.hp ? 'Health decision' : Math.abs(heightOf(ranked[0]) - heightOf(ranked[1])) > EPS ? 'Standing height decision' : 'Damage decision';
    if (winners.length !== 1) winners = [];
    for (const c of s.castles) { if (winners.includes(c.pid)) c.wins++; c.totalHealth += c.crown.hp; c.totalDamage += c.damage; }
    s.roundResult = { round: s.round, winners, reason, standings: ranked.map(c => ({ pid: c.pid, hp: c.crown.hp, height: heightOf(c), damage: c.damage, wins: c.wins })) };
    event(s, ctx, 'round-result', s.roundResult);
    if (s.round >= s.rounds) {
      const final = ranking(s, true), lead = final[0];
      const matchWinners = final.filter(c => c.wins === lead.wins && c.totalHealth === lead.totalHealth && c.totalDamage === lead.totalDamage).map(c => c.pid);
      s.result = { winners: matchWinners, reason: matchWinners.length > 1 ? 'Shared win' : 'Most round wins, then surviving Crown health and damage', lastRoundReason: reason, standings: final.map(c => ({ pid: c.pid, wins: c.wins, health: c.totalHealth, damage: c.totalDamage })) };
      s.phase = 'done'; s.endsAt = 0;
      if (!s.awarded) { s.awarded = true; for (const c of s.castles) ctx.award(c.pid, c.wins * 2 + (matchWinners.includes(c.pid) ? 10 : 1)); }
    } else { s.phase = 'round-result'; s.endsAt = ctx.now() + cfg.roundResultMs; }
  }
  function refill(c, now) {
    const weapon = weapons.ballista;
    if (!weapon || !c.refillAt || now < c.refillAt) return;
    const count = Math.floor((now - c.refillAt) / 5000) + 1;
    c.ammo.ballista = Math.min(weapon.ammo, c.ammo.ballista + count); c.refillAt += count * 5000;
  }
  function collapse(s, ctx, c) {
    const standing = standingPieces(c.pieces, cfg.support), keep = new Set(standing.map(p => p.id));
    const fallen = c.pieces.filter(p => !keep.has(p.id)); c.pieces = standing;
    if (fallen.length) event(s, ctx, 'collapse', { pid: c.pid, pieces: clone(fallen) }); return fallen;
  }
  function damage(s, shot, c, p, amount, hits) {
    if (!p || p.hp <= 0) return;
    const dealt = Math.min(p.hp, amount); p.hp -= dealt;
    const owner = s.castles.find(castle => castle.pid === shot.by); if (owner) owner.damage += dealt;
    hits.push({ pid: c.pid, piece: p.id, crown: !!p.crown, dealt, hp: p.hp });
    if (p.hp <= 0 && p.crown) c.alive = false;
  }
  function resolveShot(s, ctx, shot) {
    const weapon = weapons[shot.weapon], hit = shot.hit, hits = [];
    const target = hit && s.castles.find(c => c.pid === hit.pid);
    const direct = target && (hit.crown ? target.crown : target.pieces.find(p => p.id === hit.piece));
    if (direct && direct.hp > 0) {
      damage(s, shot, target, direct, weapon.damage, hits);
      if (weapon.splash > 0) {
        const obstacleList = solids(s, shot.by), point = hit.point;
        for (const candidate of obstacleList) {
          if (candidate.piece.id === direct.id) continue;
          const box = candidate.box, near = { x: clamp(point.x, box.x0, box.x1), y: clamp(point.y, box.y0, box.y1), z: clamp(point.z, box.z0, box.z1) };
          if (Math.hypot(near.x - point.x, near.y - point.y, near.z - point.z) > weapon.radius) continue;
          const center = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, z: (box.z0 + box.z1) / 2 };
          const start = { x: point.x + (center.x - point.x) * .01, y: point.y + (center.y - point.y) * .01, z: point.z + (center.z - point.z) * .01 };
          const shielded = obstacleList.some(q => q.piece.id !== direct.id && q.piece.id !== candidate.piece.id && segmentBox(start, center, q.box) !== null);
          if (!shielded) damage(s, shot, candidate.castle, candidate.piece, weapon.splash, hits);
        }
      }
      for (const h of hits) if (h.crown && h.hp <= 0) event(s, ctx, 'crown-fall', { pid: h.pid, shot: shot.id });
      for (const c of s.castles) { c.pieces = c.pieces.filter(p => p.hp > 0); collapse(s, ctx, c); }
    }
    event(s, ctx, 'impact', { shot: shot.id, by: shot.by, weapon: shot.weapon, point: hit?.point || shot.target, hit: hits.length > 0, hits });
  }
  function advance(s, ctx) {
    if (s.disposed || s.phase === 'done') return;
    const now = ctx.now();
    if (s.phase === 'build') {
      const connected = new Set(ctx.players().map(p => p.id)), living = s.castles.filter(c => c.alive && connected.has(c.pid));
      if (now >= s.endsAt || (living.length > 0 && living.every(c => c.ready))) startSiege(s, ctx);
    }
    if (s.phase === 'siege' || s.phase === 'resolving') {
      for (const c of s.castles) refill(c, now);
      // Resolve the earliest intersection first, then sweep remaining shots
      // against the changed solids. Fixed trajectories never home or retarget.
      while (s.pending.length) {
        let next = null;
        for (const shot of s.pending) {
          const to = clamp((now - shot.startAt) / shot.duration, 0, 1);
          if (to <= shot.progress + EPS) continue;
          const hit = firstHit(s, shot, shot.progress, to);
          const at = hit ? shot.startAt + Math.ceil(shot.duration * hit.t) : to >= 1 ? shot.endAt : Infinity;
          if (at <= now && (!next || at < next.at || (at === next.at && shot.sequence < next.shot.sequence))) next = { shot, hit, at };
        }
        if (!next) break;
        next.shot.hit = next.hit; next.shot.impactAt = next.at;
        s.pending = s.pending.filter(shot => shot !== next.shot);
        resolveShot(s, { ...ctx, now: () => next.at }, next.shot);
        s.finishAt = Math.max(s.finishAt, next.at + cfg.effectMs);
      }
      for (const shot of s.pending) shot.progress = clamp((now - shot.startAt) / shot.duration, 0, 1);
      if (s.phase === 'siege' && (now >= s.endsAt || s.castles.filter(c => c.alive).length <= 1)) {
        s.phase = 'resolving'; s.endsAt = 0; s.finishAt = Math.max(s.finishAt, now + cfg.effectMs); event(s, ctx, 'phase', { phase: 'resolving' });
      }
      if (s.phase === 'resolving' && !s.pending.length && now >= s.finishAt) finishRound(s, ctx);
    }
    if (s.phase === 'round-result' && now >= s.endsAt) { s.round++; startRound(s, ctx); }
  }
  function rejection(s, pid, reason) { s.feedback[pid] = { id: ++s.feedbackSeq, reason }; return undefined; }
  function placement(s, c, data) {
    const card = cards[data.card];
    if (!card) return { reason: 'Choose a block card.' };
    if (![data.x, data.y, data.z].every(half) || ![0, 1, 2, 3].includes(data.rotation)) return { reason: 'Blocks snap to half-unit positions.' };
    const rotated = data.rotation % 2, p = { id: c.pid + '-p' + (s.pieceSeq + 1), card: data.card, material: card.material, x: data.x, y: data.y, z: data.z, rotation: data.rotation, w: rotated ? card.d : card.w, h: card.h, d: rotated ? card.w : card.d, hp: card.hp, maxHp: card.hp };
    const b = boundsOf(p), edge = cfg.size / 2;
    if (b.x0 < -edge - EPS || b.x1 > edge + EPS || b.z0 < -edge - EPS || b.z1 > edge + EPS || b.y0 < 0 || b.y1 > cfg.height + EPS) return { reason: 'Keep the whole block inside your island and below 12 units.' };
    if (overlap(b, boundsOf(c.crown)) || c.pieces.some(q => overlap(b, boundsOf(q)))) return { reason: 'That space is occupied.' };
    if (!supported(p, c.pieces, cfg.support)) return { reason: 'Needs 30% support below its center.' };
    if (c.pieces.length >= cfg.maxPieces) return { reason: 'Castle is at its 64-block limit.' };
    if (!(c.hand[data.card] > 0)) return { reason: 'That card is empty.' };
    return { piece: p };
  }
  function create(ctx) {
    const settings = ctx.settings?.() || {}, roster = ctx.allPlayers().slice(0, 4), positions = castlePositions(roster.length);
    const s = { phase: 'build', round: 1, rounds: clamp(Number.isInteger(settings.rounds) ? settings.rounds : cfg.rounds, 1, 5),
      buildMs: clamp(Number.isInteger(settings.buildSeconds) ? settings.buildSeconds * 1000 : cfg.buildMs, 15000, 120000), siegeMs: clamp(Number.isInteger(settings.siegeSeconds) ? settings.siegeSeconds * 1000 : cfg.siegeMs, 15000, 120000),
      castles: roster.map((p, i) => ({ pid: p.id, name: p.name, seat: i, position: positions[i], wins: 0, totalHealth: 0, totalDamage: 0 })),
      events: [], eventSeq: 0, pieceSeq: 0, shotSeq: 0, timerToken: 0, feedbackSeq: 0, feedback: {}, nonces: {}, pending: [], result: null, awarded: false, disposed: false };
    startRound(s, ctx); schedule(s, ctx); return s;
  }
  function onAction(s, ctx, pid, action) {
    if (s.disposed || !action || typeof action !== 'object' || Array.isArray(action)) return false;
    const c = s.castles.find(castle => castle.pid === pid); if (!c) return false;
    const type = ['place', 'remove', 'undo', 'ready', 'fire'].find(key => action[key] && typeof action[key] === 'object' && !Array.isArray(action[key]));
    if (!type) return false; // Unknown input never changes rules or timer tokens.
    advance(s, ctx); schedule(s, ctx);
    const data = action[type];
    if (typeof data.nonce !== 'string' || !data.nonce.length || data.nonce.length > 64) return rejection(s, pid, 'Action needs a fresh nonce.');
    const seen = s.nonces[pid] || (s.nonces[pid] = new Set());
    if (seen.has(data.nonce)) return false;
    if (seen.size >= 4096) return rejection(s, pid, 'Action limit reached for this match.');
    seen.add(data.nonce);
    if (!c.alive) return rejection(s, pid, 'Your Crown fell. Watch this siege, then rebuild next round.');
    if (type !== 'fire' && s.phase !== 'build') return rejection(s, pid, 'Construction has ended.');
    if (type === 'fire' && s.phase !== 'siege') return rejection(s, pid, 'Wait for the siege.');
    let reason = '';
    if (type === 'place') {
      const proposed = placement(s, c, data); reason = proposed.reason || '';
      if (proposed.piece) { s.pieceSeq++; c.pieces.push(proposed.piece); c.hand[data.card]--; c.history.push(proposed.piece.id); c.ready = false; event(s, ctx, 'place', { pid, piece: clone(proposed.piece) }); }
    } else if (type === 'remove' || type === 'undo') {
      const id = type === 'undo' ? c.history[c.history.length - 1] : data.piece;
      const piece = c.pieces.find(p => p.id === id && !p.foundation);
      if (!piece) reason = 'Choose one of your placed blocks.';
      else { c.pieces = c.pieces.filter(p => p.id !== id); c.history = c.history.filter(p => p !== id); c.hand[piece.card]++; const fallen = collapse(s, ctx, c); for (const p of fallen) if (!p.foundation) { c.hand[p.card]++; c.history = c.history.filter(id => id !== p.id); } c.ready = false; event(s, ctx, 'remove', { pid, piece: clone(piece) }); }
    } else if (type === 'ready') c.ready = data.value !== false;
    else {
      const weapon = weapons[data.weapon], target = s.castles.find(castle => castle.pid === data.target);
      if (!weapon) reason = 'Choose a weapon.';
      else if (!target || target.pid === pid || !target.alive) reason = 'Choose a rival with a standing Crown.';
      else if (![data.x, data.y, data.z].every(finite) || Math.abs(data.x) > cfg.size / 2 || Math.abs(data.z) > cfg.size / 2 || data.y < 0 || data.y > cfg.height) reason = 'Aim at a point on the rival island.';
      else if ((c.cooldowns[data.weapon] || 0) > ctx.now()) reason = 'Weapon is reloading.';
      else if (!(c.ammo[data.weapon] > 0)) reason = 'No ammunition left.';
      else {
        const start = launcherOf(c), point = { x: target.position.x + data.x, y: data.y, z: target.position.z + data.z }, distance = Math.hypot(point.x - start.x, point.y - start.y, point.z - start.z);
        const duration = clamp(distance / weapon.speed * 1000, weapon.minFlight, weapon.maxFlight);
        const shot = { id: 'shot-' + (++s.shotSeq), sequence: s.shotSeq, by: pid, weapon: data.weapon, start, target: point, arc: weapon.arc, startAt: ctx.now(), duration };
        shot.progress = 0; shot.hit = null; shot.endAt = shot.startAt + duration; shot.predictedHit = firstHit(s, shot); shot.impactAt = shot.predictedHit ? shot.startAt + Math.ceil(duration * shot.predictedHit.t) : shot.endAt;
        c.ammo[data.weapon]--; c.cooldowns[data.weapon] = ctx.now() + weapon.cooldownMs; s.pending.push(shot); event(s, ctx, 'shot', { shot: clone(shot) });
      }
    }
    if (reason) rejection(s, pid, reason);
    advance(s, ctx); schedule(s, ctx); return undefined;
  }
  function view(s, pid) {
    const c = s.castles.find(castle => castle.pid === pid);
    return { phase: s.phase, round: s.round, rounds: s.rounds, endsAt: s.endsAt, buildMs: s.buildMs, siegeMs: s.siegeMs,
      arena: { size: cfg.size, height: cfg.height, support: cfg.support, maxPieces: cfg.maxPieces }, cards: clone(cards), weapons: clone(weapons),
      castles: s.castles.map(castle => ({ pid: castle.pid, name: castle.name, seat: castle.seat, position: { ...castle.position }, ready: castle.ready, alive: castle.alive, crown: clone(castle.crown), pieces: clone(castle.pieces), launcher: launcherOf(castle), wins: castle.wins, damage: castle.damage, height: heightOf(castle) })),
      mine: c ? { pid: c.pid, hand: { ...c.hand }, ammo: { ...c.ammo }, cooldowns: { ...c.cooldowns }, refillAt: c.refillAt } : null,
      events: clone(s.events), shots: clone(s.pending), feedback: c ? s.feedback[pid] || null : null, roundResult: s.roundResult ? clone(s.roundResult) : null, result: s.result ? clone(s.result) : null };
  }
  function dispose(s) { if (!s || s.disposed) return; s.disposed = true; s.timerToken++; cancel(s); s.pending = []; }
  return { create, onAction, view, dispose, placement, advance: (s, ctx) => { advance(s, ctx); schedule(s, ctx); } };
}
module.exports = { createBlockSiege, boundsOf, overlap, rectangleUnionArea, supported, standingPieces, segmentBox, trajectoryPoint, firstHit, castlePositions, launcherOf };
