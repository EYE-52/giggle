'use strict';

const GARAGE_CATS = ['engine', 'handling', 'reload'];
const GARAGE_MAX = 3;
const GARAGE_PRICES = [20, 35, 55]; // cost to reach level 1/2/3
const GARAGE_NONCE_CAP = 200; // bounded exact-once purchase nonces per game
const GARAGE_WALLET_CAP = 32; // room seats max; departing ghosts pruned past this
const COIN_PARTICIPATION = 5;
const COIN_WIN = 15;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* Garage store: room-scoped per-seat wallet + upgrades + purchase
 * nonces. Preferred: ctx.session() (room.js, scoped automatically to the
 * running game id, survives rematches and away/back, dies with the room).
 * Fixtures without ctx.session fall back to a per-match object on the
 * state (functional single-match economy, no persistence). Shape:
 * { coins:{pid:n}, upgrades:{pid:{engine,handling,reload}},
 *   seen:{nonce:1}, seenOrder:[nonce...] }. Trusted server-only; clients
 * never address it (no pids or keys from the wire reach the store
 * except the sender's own validated pid and nonce). */
function ensureGarageShape(store) {
  if (!store || typeof store !== 'object') return { coins: {}, upgrades: {}, seen: {}, seenOrder: [] };
  if (!store.coins || typeof store.coins !== 'object') store.coins = {};
  if (!store.upgrades || typeof store.upgrades !== 'object') store.upgrades = {};
  if (!store.seen || typeof store.seen !== 'object') store.seen = {};
  if (!Array.isArray(store.seenOrder)) store.seenOrder = [];
  return store;
}

function garageStore(ctx, state) {
  let store = null;
  if (ctx && typeof ctx.session === 'function') {
    try { store = ctx.session(); } catch { store = null; }
  }
  if (!store || typeof store !== 'object') {
    if (!state._garageLocal || typeof state._garageLocal !== 'object') state._garageLocal = {};
    store = state._garageLocal;
  }
  return ensureGarageShape(store);
}

function garageCoins(store, pid) {
  if (!store || !store.coins) return 0;
  return Math.max(0, Math.floor(Number(store.coins[pid]) || 0));
}

function garageLevels(store, pid) {
  const out = { engine: 0, handling: 0, reload: 0 };
  const up = store && store.upgrades ? store.upgrades[pid] : null;
  if (up && typeof up === 'object') {
    for (const c of GARAGE_CATS) out[c] = clamp(Math.floor(Number(up[c]) || 0), 0, GARAGE_MAX);
  }
  return out;
}

/* Award coins exactly once (server-side only). Prunes departing ghosts
 * past the 32-seat cap (non-drivers first), so the wallet never grows
 * without bound. keepPids is the current driver set (may be null). */
function awardGarageCoins(store, pid, amount, keepPids) {
  ensureGarageShape(store);
  if (!pid || typeof pid !== 'string') return 0;
  const amt = Math.floor(Number(amount) || 0);
  if (amt <= 0) return garageCoins(store, pid);
  if (!Object.prototype.hasOwnProperty.call(store.coins, pid) &&
      Object.keys(store.coins).length >= GARAGE_WALLET_CAP) {
    const keys = Object.keys(store.coins);
    let evicted = false;
    for (const k of keys) {
      if (!keepPids || !keepPids.has(k)) {
        delete store.coins[k];
        delete store.upgrades[k];
        evicted = true;
        break;
      }
    }
    if (!evicted && keys.length) {
      delete store.coins[keys[0]];
      delete store.upgrades[keys[0]];
    }
  }
  store.coins[pid] = garageCoins(store, pid) + amt;
  return store.coins[pid];
}

/* Claim a purchase nonce exactly once. False for missing/malformed or
 * replayed nonces (no-op, never double-charges). Bounded to the last
 * GARAGE_NONCE_CAP entries. */
function claimGarageNonce(store, nonce) {
  ensureGarageShape(store);
  if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 64) return false;
  if (store.seen[nonce]) return false;
  store.seen[nonce] = 1;
  store.seenOrder.push(nonce);
  while (store.seenOrder.length > GARAGE_NONCE_CAP) {
    const drop = store.seenOrder.shift();
    delete store.seen[drop];
  }
  return true;
}

function hasGarageNonce(store, nonce) {
  return !!store && !!store.seen && typeof nonce === 'string' && !!store.seen[nonce];
}

/* Copy the persistent wallet/upgrades into the match state for views
 * (views never receive ctx, so the state carries a projection). Small:
 * at most 32 seats. */
function syncGarageState(state, store) {
  ensureGarageShape(store);
  const coins = {};
  for (const pid of Object.keys(store.coins)) coins[pid] = garageCoins(store, pid);
  state.coins = coins;
  const ups = {};
  for (const pid of Object.keys(store.upgrades)) ups[pid] = garageLevels(store, pid);
  for (const pid of Object.keys(coins)) {
    if (!ups[pid]) ups[pid] = { engine: 0, handling: 0, reload: 0 };
  }
  state.garageUpgrades = ups;
  if (!state.garageResults || typeof state.garageResults !== 'object') state.garageResults = {};
}

/* Garage purchase (results-only). Validates mode, stage, seat, id,
 * balance, cap, and nonce; deducts and levels up exactly once. Returns
 * undefined so the room broadcasts the updated wallet/result. Errors
 * are recorded privately per seat (view.garageResult) with clear text —
 * never silent, never a throw, never a cross-seat spend. */
function garagePurchase(state, ctx, pid, req) {
  const fail = (error) => {
    if (!state.garageResults || typeof state.garageResults !== 'object') state.garageResults = {};
    state.garageResults[pid] = {
      ok: false, error,
      nonce: req && typeof req.nonce === 'string' ? req.nonce.slice(0, 64) : null,
      category: req && typeof req.category === 'string' ? req.category.slice(0, 16) : null,
    };
    return undefined; // broadcast the error to the buyer
  };
  if (state.rulesKey !== 'battle') return fail('Garage is available in Zap Battle results only.');
  if (state.phase !== 'done') return fail('Garage opens on the results screen.');
  let roster = [];
  let online = [];
  try {
    roster = ctx.allPlayers().map((p) => p.id);
    online = ctx.players().map((p) => p.id);
  } catch { roster = state.karts.map((k) => k.pid); online = roster.slice(); }
  if (!roster.includes(pid) || !state.karts.some(k=>k.pid===pid)) return fail('Only drivers in this match can use the garage.');
  if (!online.includes(pid)) return fail('Reconnect to use the garage.');
  const r = req && typeof req === 'object' ? req : {};
  if (r.pid !== undefined && r.pid !== pid) return fail('You can only upgrade your own kart.');
  if (r.target !== undefined && r.target !== pid) return fail('You can only upgrade your own kart.');
  if (r.seat !== undefined && r.seat !== pid) return fail('You can only upgrade your own kart.');
  const cat = r.category;
  if (typeof cat !== 'string' || !GARAGE_CATS.includes(cat)) {
    return fail(`Unknown upgrade "${String(cat).slice(0, 16)}" (want engine, handling, or reload).`);
  }
  if (typeof r.nonce !== 'string' || r.nonce.length < 1 || r.nonce.length > 64) {
    return fail('Purchase needs a nonce (1..64 chars).');
  }
  let store;
  try { store = garageStore(ctx, state); } catch { return fail('Garage unavailable. Try again.'); }
  if (hasGarageNonce(store, r.nonce)) return fail('Duplicate purchase (already applied).');
  const levels = garageLevels(store, pid);
  if (levels[cat] >= GARAGE_MAX) return fail(`${cat} is already at max level ${GARAGE_MAX}.`);
  const cost = GARAGE_PRICES[levels[cat]];
  const have = garageCoins(store, pid);
  if (have < cost) return fail(`Need ${cost} coins for ${cat} ${levels[cat] + 1} (have ${have}).`);
  if (!claimGarageNonce(store, r.nonce)) return fail('Duplicate purchase (already applied).');
  store.coins[pid] = have - cost;
  if (!store.upgrades[pid] || typeof store.upgrades[pid] !== 'object') {
    store.upgrades[pid] = { engine: 0, handling: 0, reload: 0 };
  }
  store.upgrades[pid][cat] = levels[cat] + 1;
  syncGarageState(state, store);
  const kart = state.karts.find((k) => k.pid === pid);
  if (kart) kart.upgrades = garageLevels(store, pid);
  state.garageResults[pid] = {
    ok: true, category: cat, level: levels[cat] + 1,
    coins: store.coins[pid], nonce: r.nonce,
  };
  return undefined; // broadcast the new wallet/levels
}

function awardFinishCoins(state, ctx, standings, winners) {
  try {
    const store = garageStore(ctx, state);
    const keep = new Set(state.karts.map((k) => k.pid));
    // Coin bonus keeps its old meaning: a scoreless draw wins no coins.
    const winSet = new Set(standings.some((s) => !s.out && s.score > 0) ? winners : []);
    for (const k of state.karts) {
      awardGarageCoins(store, k.pid, COIN_PARTICIPATION, keep);
      if (winSet.has(k.pid)) awardGarageCoins(store, k.pid, COIN_WIN, keep);
    }
    syncGarageState(state, store);
  } catch { /* economy never breaks the finish */ }
}

module.exports = {
  GARAGE_CATS, GARAGE_MAX, GARAGE_PRICES, GARAGE_NONCE_CAP, GARAGE_WALLET_CAP,
  COIN_PARTICIPATION, COIN_WIN, garageStore, garageLevels, syncGarageState,
  awardGarageCoins, garagePurchase, awardFinishCoins,
};
