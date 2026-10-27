/* Castle Clash view: paper-fort build palette + siege weapon rack on the
 * shared build-battle geometry helpers. Mount builds once; update patches
 * cells in place (no grid rebuild on focus/selection changes); dispose
 * removes every listener and timer. A per-phase action bar names the
 * primary tap; locked/cooling picks disable their targets with reasons;
 * earned unlocks flash + announce once. Core objective + cover/ward/boost
 * are rendered from the server snapshot (no hardcoded rules). */
import { esc, nameOf, countdown } from '../util.js';
import {
  zoneCells, gridMap, hpBand, hpPct, cooldownLeft, fmtSeconds,
  pieceGlyph, weaponGlyph,
} from '../engines/build-battle-view.js';

const NSTYLE = 'cc-style';
let nonceSeq = 0;
let selPiece = 'wall';
let selWeapon = 'catapult';
let buildMode = 'build'; // build|upgrade|teardown
let lastInstance = '';
let lastPhase = '';
let lastRound = 0;
let bound = [];
let tickTimer = 0;
let lastGridKey = '';
let lastPalKey = '';
let lastModesKey = '';
let lastCoreKey = '';
let repEl = null;
let repApi = null;
let repS = null;
let prevUnlocks = null; // own-team unlock baseline for fresh-unlock feedback

function repaint() {
  if (repEl && repApi && repS && repEl.isConnected) {
    exportDefault.update(repEl, repS, repApi);
  }
}

/* Calibrated server time when the shell provides api.now, else wall. */
function serverNow(api) {
  const a = api || repApi;
  if (a && typeof a.now === 'function') {
    try {
      const v = a.now();
      if (Number.isFinite(v)) return v;
    } catch { /* wall clock below */ }
  }
  return Date.now();
}

function nonce() {
  nonceSeq += 1;
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  } catch { /* fallback below */ }
  return 'n' + Date.now().toString(36) + '-' + nonceSeq + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

function paintSupplies(el, S, api) {
  const strip=el.querySelector('#cc-supplies'),button=el.querySelector('#cc-claim'),orders=el.querySelector('#cc-orders');
  if(!strip||!button||!orders)return;
  const team=S.myTeam||teamOf(S,S.you),sup=S.supplies,now=serverNow(api);
  strip.hidden=!sup||S.phase!=='build'||S.spectator||!team;
  if(strip.hidden)return;
  orders.textContent=(sup.orders?.[team]||[]).map(o=>`${o.id==='foundations'?'Build':o.id==='watchtowers'?'Towers':'Upgrades'} ${o.have}/${o.need}${o.done?' ✓':''}`).join(' · ');
  const k=Math.floor((now-sup.buildStartAt)/sup.cadenceMs),at=sup.buildStartAt+k*sup.cadenceMs;
  const id=`r${sup.round}c${k}`;
  const active=k>=1 && at<sup.buildStartAt+S.buildMs && now<=at+sup.ttlMs && !(sup.claimed?.[team]||[]).includes(id);
  button.hidden=!active;button.dataset.chest=active?id:'';
  button.textContent=active?`Claim +${sup.bricks} bricks · ${Math.max(1,Math.ceil((at+sup.ttlMs-now)/1000))}s`:'';
}

function on(t, type, fn, opts) {
  if (!t || !t.addEventListener) return;
  t.addEventListener(type, fn, opts);
  bound.push([t, type, fn, opts]);
}

function pct(v) {
  return Math.round((Number(v) || 0) * 100);
}

const CSS = `
.castle-clash{font:inherit;color:inherit;max-width:100%;display:flex;flex-direction:column}
.cc-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}
.cc-brief{display:none}
.cc-intel>summary{display:none}
.cc-phase{font-weight:800;font-size:18px}
.cc-timer{font-variant-numeric:tabular-nums;font-weight:800;background:var(--sun,#f7d774);color:var(--sun-ink,#1f2a33);border:2px solid var(--edge,#1f2a33);border-radius:999px;padding:6px 14px;box-shadow:2px 2px 0 var(--edge,#1f2a33)}
.cc-teams{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.cc-team{border:2px solid var(--edge,#1f2a33);border-radius:14px;padding:8px;box-shadow:3px 3px 0 var(--edge,#1f2a33);background:var(--card,#fff);color:var(--ink,#1f2a33)}
.cc-team.red{background:color-mix(in srgb,var(--melon,#ff8f9e) 22%,var(--card,#fff))}
.cc-team.blue{background:color-mix(in srgb,var(--teal,#7fd4c1) 25%,var(--card,#fff))}
.cc-team.mine{outline:3px solid var(--accent,#e8446e);outline-offset:1px}
.cc-tname{font-weight:800}
.cc-tmeta{font-size:16px}
.cc-members{font-size:14px;opacity:.9;overflow-wrap:anywhere}
.cc-rules{border:2px dashed var(--edge,#1f2a33);border-radius:12px;background:var(--card,#fff);padding:0 10px;font-size:16px;margin-top:12px}
.cc-rules summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:800}
.cc-rules summary::before{content:'+';margin-right:8px}.cc-rules[open] summary::before{content:'−'}
.cc-rules summary:focus-visible{outline:3px solid var(--accent,#e8446e);outline-offset:2px}
.cc-rules p{margin:0 0 10px;line-height:1.5}
.cc-core{display:grid;gap:6px;margin-bottom:8px}
@media(min-width:560px){.cc-core{grid-template-columns:1fr 1fr}}
.cc-corebar{border:2px solid var(--edge,#1f2a33);border-radius:12px;background:var(--card,#fff);padding:6px 10px;font-size:16px;box-shadow:2px 2px 0 var(--edge,#1f2a33)}
.cc-corebar b{font-weight:800}
.cc-corebar .hp{display:block;width:100%;height:6px;border-radius:3px;background:#00000022;margin-top:4px}
.cc-corebar .hp i{display:block;height:100%;border-radius:3px;background:var(--teal,#3f7d6b)}
.cc-play{display:grid;gap:14px;align-items:start}
.cc-main{display:grid;gap:12px;min-width:0}
@media(min-width:820px){.cc-play{grid-template-columns:minmax(0,1fr) 260px}}
.cc-castle{min-width:0}
.cc-castle>summary{min-height:32px;margin:0 0 6px;font-size:18px;font-weight:800;cursor:pointer}
.cc-gridwrap{overflow-x:auto;max-width:100%;padding-bottom:4px;-webkit-overflow-scrolling:touch}
.cc-grid{display:grid;gap:3px;width:100%;min-width:min-content}
.cc-cell{position:relative;min-width:44px;min-height:44px;border:2px solid var(--edge,#1f2a33);border-radius:8px;background:var(--well,#f6f1e7);color:var(--ink,#1f2a33);cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.cc-cell .g{font-size:17px;line-height:1}
.cc-cell .hp{display:block;width:80%;height:4px;border-radius:2px;background:#00000022;margin-top:2px}
.cc-cell .hp i{display:block;height:100%;border-radius:2px;background:var(--teal,#3f7d6b)}
.cc-cell.hurt .hp i{background:var(--sun,#d9a414)}
.cc-cell.crit .hp i{background:var(--melon,#d43a52)}
.cc-cell.lvl2{box-shadow:inset 0 0 0 2px var(--accent,#e8446e)}
.cc-cell.core{border-width:3px;background:var(--sun,#f7d774);color:var(--sun-ink,#1f2a33)}
.cc-cell.sel{outline:3px solid var(--accent,#e8446e);outline-offset:-1px}
.cc-cell:focus-visible{outline:3px solid var(--accent,#e8446e);outline-offset:1px}
.cc-cell:disabled{cursor:default;opacity:.85}
.cc-cell.empty{border-style:dashed;opacity:.75}
.cc-cell.nomans{background:repeating-linear-gradient(45deg,#efe9dc,#efe9dc 4px,#e4dccb 4px,#e4dccb 8px);cursor:default}
.cc-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.cc-palette{display:grid;gap:6px}
.cc-pick{display:flex;align-items:center;gap:8px;min-height:44px;border:2px solid var(--edge,#1f2a33);border-radius:12px;background:var(--card,#fff);color:var(--ink,#1f2a33);padding:8px;font:inherit;font-size:16px;line-height:1.3;cursor:pointer;box-shadow:2px 2px 0 var(--edge,#1f2a33);text-align:left;overflow-wrap:anywhere}
.cc-pick .g{font-size:20px}
.cc-pick>span:nth-child(2){min-width:0;flex:1}
.cc-pick.sel{outline:3px solid var(--accent,#e8446e)}
.cc-pick:disabled{opacity:.55;cursor:default}
.cc-pick small{margin-left:auto;text-align:right}
.cc-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.cc-modes .btn{min-height:44px;padding:6px 4px;font-size:15px}
#gbody .castle-clash .cc-modes .btn{font-size:16px}
.cc-after{display:grid;gap:10px;margin-top:12px}
.cc-log{border:2px solid var(--edge,#1f2a33);border-radius:12px;background:var(--card,#fff);padding:6px 10px;max-height:120px;overflow:auto;font-size:16px}
.cc-log div+div{border-top:1px dashed #00000022}
.cc-unlock{font-size:16px;overflow-wrap:anywhere}
.cc-result small{display:block;font-weight:600;font-size:14px;line-height:1.45;margin-top:6px}
.cc-result{border:2px solid var(--edge,#1f2a33);border-radius:14px;padding:10px;background:var(--sun,#f7d774);color:var(--sun-ink,#1f2a33);font-weight:700;box-shadow:3px 3px 0 var(--edge,#1f2a33)}
.cc-actions{display:flex;gap:8px;flex-wrap:wrap}
.cc-actions .btn{min-height:44px}
@media(max-width:819px){
  .cc-head{order:0}.cc-action{order:1}.cc-brief{order:2;display:block;font-size:16px;font-weight:800;margin:0 0 8px;overflow-wrap:anywhere}
  .cc-result{order:3}.cc-play{order:4;gap:8px}.cc-intel{order:5}.cc-rules{order:6}.cc-after{order:7}
  .cc-side{order:-1;gap:6px}.cc-main{gap:8px}
  .cc-palette{display:flex;gap:8px;overflow-x:auto;padding:4px 3px 8px;scroll-snap-type:x proximity}
  .cc-pick{flex:0 0 144px;min-height:76px;scroll-snap-align:start}
  .cc-pick small{font-size:13px}
  .cc-castle>summary,.cc-intel>summary{min-height:44px;display:flex;align-items:center;gap:8px;font-size:17px;line-height:1.3;cursor:pointer}
  .cc-castle>summary::before,.cc-intel>summary::before{content:'+';font-weight:800}
  .cc-castle[open]>summary::before,.cc-intel[open]>summary::before{content:'−'}
  .cc-castle>summary:focus-visible,.cc-intel>summary:focus-visible{outline:3px solid var(--accent,#e8446e);outline-offset:2px}
  .castle-clash[data-phase="siege"] .cc-foe-wrap{order:-1}
  .cc-intel{margin-top:8px;border:2px solid var(--edge,#1f2a33);border-radius:12px;padding:0 8px;background:var(--card,#fff)}
.cc-intel[open]{padding-bottom:8px}
}
@media(min-width:820px) and (max-height:760px){
  .cc-head{order:0}.cc-action{order:1}
  .cc-brief{order:2;display:block;font-size:16px;font-weight:800;margin:0 0 8px}
  .cc-result{order:3}.cc-play{order:4}.cc-intel{order:5}.cc-rules{order:6}.cc-after{order:7}
  .cc-castle>summary,.cc-intel>summary{min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer}
  .cc-intel>summary::before{content:'+'}.cc-intel[open]>summary::before{content:'−'}
  .castle-clash[data-phase="siege"] .cc-foe-wrap{order:-1}
  .cc-intel{margin-top:8px;border:2px solid var(--edge,#1f2a33);border-radius:12px;padding:0 8px;background:var(--card,#fff)}
  .cc-intel[open]{padding-bottom:8px}
}
.cc-action{min-height:44px;box-sizing:border-box;display:block;border:2px solid var(--edge,#1f2a33);border-radius:12px;background:var(--sun,#f7d774);color:var(--sun-ink,#1f2a33);padding:8px 12px;font-size:16px;font-weight:800;margin:0 0 8px;box-shadow:2px 2px 0 var(--edge,#1f2a33);overflow-wrap:anywhere}
.castle-clash[data-phase="siege"] .cc-action{background:var(--melon,#ff8f9e);color:var(--ink,#1f2a33)}
.castle-clash[data-phase="build"] .cc-mine-wrap{outline:3px solid var(--teal,#3f7d6b);outline-offset:2px;border-radius:12px}
.castle-clash[data-phase="build"] .cc-foe-wrap{opacity:.8}
.castle-clash[data-phase="siege"] .cc-foe-wrap{outline:3px solid var(--accent,#e8446e);outline-offset:2px;border-radius:12px}
.castle-clash[data-phase="siege"] .cc-mine-wrap{opacity:.8}
.cc-team.mine .cc-tmeta{font-weight:800}
.cc-hint{border:2px dashed var(--edge,#1f2a33);border-radius:12px;background:var(--card,#fff);color:var(--ink,#1f2a33);padding:10px;font-size:16px;line-height:1.4;overflow-wrap:anywhere}
.cc-pick.fresh{outline:3px solid var(--teal,#3f7d6b);animation:cc-pop .5s ease-out}
@keyframes cc-pop{0%{transform:scale(.94)}100%{transform:scale(1)}}
.cc-result,.cc-log,.cc-unlock,.cc-brief{overflow-wrap:anywhere}
.cc-supplies{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:8px 0 16px;font-size:15px}
.cc-supplies[hidden],.cc-supplies button[hidden]{display:none}
.cc-supplies button{min-height:44px;border-radius:12px;font-size:15px}
@media(max-width:560px){.cc-teams{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.castle-clash *{transition:none!important;animation:none!important}}
`;

function ensureStyle() {
  if (document.getElementById(NSTYLE)) return;
  const st = document.createElement('style');
  st.id = NSTYLE;
  st.textContent = CSS;
  document.head.appendChild(st);
}

function teamOf(S, pid) {
  if (S.teams.red.members.includes(pid)) return 'red';
  if (S.teams.blue.members.includes(pid)) return 'blue';
  return null;
}

function foeOf(mine) {
  return mine === 'red' ? 'blue' : 'red';
}

function unlockName(u) {
  if (!u) return '';
  return `${u.kind === 'piece' ? 'Build' : 'Weapon'}: ${u.id}`;
}

function modsText(e) {
  const parts = [];
  if (e.cover > 0) parts.push(`cover ${pct(e.cover)}%`);
  if (e.ward > 0) parts.push(`ward ${pct(e.ward)}%`);
  if (e.boost > 0) parts.push(`boost ${pct(e.boost)}%`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function logLine(S, e) {
  const who = (t) => (t === S.myTeam ? 'Your team' : (S.teams[t] ? S.teams[t].name : 'Enemy'));
  if (e.kind === 'hit') {
    return `${esc(who(e.by))} ${esc(e.weapon)} hit (${e.x},${e.y}) for ${e.dealt}${modsText(e)}.`;
  }
  if (e.kind === 'destroy') {
    return `${esc(who(e.by))} DESTROYED (${e.x},${e.y}) with ${esc(e.weapon)}!${modsText(e)}`;
  }
  if (e.kind === 'corefall') {
    return `${esc(who(e.by))} DESTROYED the enemy CORE (${e.x},${e.y}) with ${esc(e.weapon)}! +${e.bonus}${modsText(e)}`;
  }
  if (e.kind === 'survive') {
    const nm = S.teams[e.by] ? S.teams[e.by].name : 'Core';
    return `${esc(nm)} Core holds at ${e.hp}hp: +${e.bonus} ${esc(S.economy.pointsName)}.`;
  }
  if (e.kind === 'unlock') {
    return `${esc(who(e.by))} unlocked ${esc(unlockName({ kind: e.unlockKind, id: e.unlockId }))}!`;
  }
  if (e.kind === 'roundEnd' || e.kind === 'siege' || e.kind === 'wipe') return esc(e.detail || e.kind);
  return esc(e.detail || e.kind || '');
}

function gridKey(S) {
  return `${S.instanceId}|${S.round}|${S.phase}|${S.arena.cols}x${S.arena.rows}`;
}

/* Selected-weapon readiness from the snapshot (locks + server cooldowns). */
function weaponState(S, T, id, api) {
  const w = S.catalog.weapons[id];
  if (!w) return { w: null, locked: true, left: 0 };
  const locked = w.unlockAt > 0 && !(T.unlocks || []).includes('weapon:' + id);
  const left = cooldownLeft((S.cooldowns || {})[id] || 0, serverNow(api));
  return { w, locked, left };
}

/* One-line primary action for the current phase/selection, always derived
 * from the snapshot (never hardcoded numbers). */
function actionText(S, T, myTeam, canAct, api) {
  if (S.phase === 'done') return 'Battle over!';
  if (!canAct) {
    return S.phase === 'build'
      ? 'Build phase — watch both forts rise around their Cores.'
      : 'Siege phase — watch the Cores fall!';
  }
  if (S.phase === 'build') {
    if (buildMode === 'upgrade') {
      return `Upgrade! Tap one of YOUR structures — costs its base ${S.economy.resourceName} again, heals to full. Shared pile: ${T.resources}.`;
    }
    if (buildMode === 'teardown') {
      return `Teardown! Tap one of YOUR structures — refunds half its ${S.economy.resourceName} (Core stays). Shared pile: ${T.resources}.`;
    }
    const p = S.catalog.pieces[selPiece];
    if (!p) return 'Build! Pick a fort piece, then tap YOUR castle.';
    if (p.unlockAt > 0 && !(T.unlocks || []).includes('piece:' + selPiece)) {
      return `${selPiece} unlocks at ${p.unlockAt} ${S.economy.pointsName} (have ${T.points}) — pick another piece.`;
    }
    if (T.resources < p.cost) {
      return `Need ${p.cost - T.resources} more shared ${S.economy.resourceName} for ${selPiece} (pile: ${T.resources}) — teardown or build cheaper.`;
    }
    return `Build! Tap YOUR castle to place ${selPiece} (${p.cost} of ${T.resources} shared ${S.economy.resourceName}).`;
  }
  const st = weaponState(S, T, selWeapon, api);
  if (!st.w) return 'Siege! Pick a weapon, then tap the ENEMY castle.';
  if (st.locked) return `${selWeapon} unlocks at ${st.w.unlockAt} ${S.economy.pointsName} (have ${T.points}) — pick a ready weapon.`;
  if (st.left > 0) return `${selWeapon} cools ${fmtSeconds(st.left)}s — pick a ready weapon, then tap the ENEMY castle.`;
  const foe = S.myTeam === 'red' ? 'blue' : 'red';
  const cover = S.objectives && S.objectives[foe] && S.objectives[foe].cover;
  const tip = cover > 0 ? `Break guards beside their Core (${pct(cover)}% cover). ` : '';
  return `${tip}Tap the ENEMY castle to fire ${selWeapon} (${st.w.damage} base dmg).`;
}

/* Build one castle grid's buttons once; update() patches them in place. */
function buildGrid(table, cells, opts, api) {
  table.innerHTML = '';
  const btns = new Map();
  for (const { x, y } of cells) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cc-cell empty';
    b.dataset.x = String(x);
    b.dataset.y = String(y);
    b.innerHTML = '<span class="g"></span><span class="hp"><i></i></span>';
    if (opts && typeof opts.onCell === 'function') on(b, 'click', () => opts.onCell(x, y));
    table.appendChild(b);
    btns.set(x + ',' + y, b);
  }
  return btns;
}

function patchGrid(btns, map, opts) {
  // opts: {enabled, selected({x,y})->bool, label(x,y,cell)->string}
  for (const [k, b] of btns) {
    const [x, y] = k.split(',').map(Number);
    const cell = map.get(k);
    const g = b.querySelector('.g');
    const bar = b.querySelector('.hp i');
    if (cell) {
      g.textContent = pieceGlyph(cell.piece) + (cell.level > 1 ? '⁺' : '');
      bar.style.width = hpPct(cell.hp, cell.maxHp) + '%';
      b.classList.remove('empty');
      b.classList.toggle('hurt', hpBand(cell.hp, cell.maxHp) === 'hurt');
      b.classList.toggle('crit', hpBand(cell.hp, cell.maxHp) === 'crit');
      b.classList.toggle('lvl2', cell.level > 1);
      b.classList.toggle('core', !!cell.objective);
    } else {
      g.textContent = '';
      bar.style.width = '0%';
      b.classList.add('empty');
      b.classList.remove('hurt', 'crit', 'lvl2', 'core');
    }
    b.classList.toggle('sel', !!opts.selected(x, y, cell));
    b.disabled = !opts.enabled(x, y, cell);
    b.setAttribute('aria-label', opts.label(x, y, cell));
  }
}

function rulesText(S) {
  if (!S.objective) return 'No core in this variant: every brick you place is a target.';
  const d = S.objective.defense || {};
  const per = pct(d.coverPerAdjacent);
  const maxC = pct(d.maxCover);
  const maxW = pct(d.maxWard);
  const maxB = pct(d.maxBoost);
  return `Core ${S.objective.hp}hp at the back row: kill the foe Core for +${S.objective.destroyBonus} and an instant round end; survivors earn remaining HP x ${S.objective.surviveRate}. ` +
    `Adjacent structures cut Core damage ${per}% per cover weight (max ${maxC}%). ` +
    Object.entries(S.catalog.pieces).filter(([, p]) => p.coverWeight > 1).map(([id, p]) => `${id} counts x${p.coverWeight}`).join(', ') + '. ' +
    `Ward protects all structures (max ${maxW}%), cannons boost siege (max ${maxB}%). Break nearby guards to expose the Core. Shots always hit the tapped cell.`;
}

function coreBar(S, t, mine) {
  const o = S.objectives && S.objectives[t];
  const a = S.auras && S.auras[t];
  if (!o) return '';
  const nm = S.teams[t] ? S.teams[t].name : t;
  const status = o.alive ? `${o.hp}/${o.maxHp}hp` : 'DESTROYED';
  const cover = `cover ${pct(o.cover)}% (${o.coverCount} adjacent)`;
  const aura = a ? ` · ward ${pct(a.ward)}% · boost ${pct(a.boost)}%` : '';
  return `<div class="cc-corebar"><b>${esc(nm)} Core${t === mine ? ' · yours' : ''}:</b> ${esc(status)} · ${esc(cover)}${esc(aura)}` +
    `<span class="hp"><i style="width:${hpPct(o.hp, o.maxHp)}%"></i></span></div>`;
}

function skeleton(el) {
  el.innerHTML = `
  <div class="castle-clash" id="cc-root">
    <div class="cc-head">
      <div class="cc-phase" id="cc-phase" role="status"></div>
      <div class="cc-timer" id="cc-timer" aria-label="Time left"></div>
    </div>
    <div class="cc-brief" id="cc-brief"></div>
    <div class="cc-action" id="cc-action" role="status"></div>
    <details class="cc-intel" id="cc-intel" open><summary>Teams &amp; Core defenses</summary>
    <div class="cc-teams" id="cc-teams"></div>
    <div class="cc-core" id="cc-core"></div>
    </details>
    <div class="cc-result" id="cc-result" hidden></div>
    <div class="cc-supplies" id="cc-supplies" hidden><span id="cc-orders"></span><button type="button" class="btn" id="cc-claim" hidden>Claim supplies</button></div>
    <div class="cc-play">
    <div class="cc-main">
      <details class="cc-castle cc-mine-wrap" id="cc-mine-wrap" open><summary id="cc-mine-h"></summary><div class="cc-gridwrap"><div class="cc-grid" id="cc-mine" role="group" aria-label="Your castle grid"></div></div></details>
      <details class="cc-castle cc-foe-wrap" id="cc-foe-wrap" open><summary id="cc-foe-h"></summary><div class="cc-gridwrap"><div class="cc-grid" id="cc-foe" role="group" aria-label="Enemy castle"></div></div></details>
    </div>
    <div class="cc-side">
      <div class="cc-modes" id="cc-modes"></div>
      <div class="cc-palette" id="cc-palette" role="group" aria-label="Build palette or weapon rack"></div>
    </div>
    </div>
    <details class="cc-rules"><summary>Core defense &amp; scoring</summary><p id="cc-rules"></p></details>
    <div class="cc-after">
      <div class="cc-unlock muted" id="cc-unlock"></div>
      <div class="cc-log" id="cc-log" aria-label="Battle log" tabindex="0"></div>
      <div class="cc-actions"><button type="button" class="btn ghost" id="cc-lobby">Lobby</button></div>
    </div>
  </div>`;
}

const exportDefault = {
  ownsTimer: true,
  mount(el, api) {
    disposeAll();
    ensureStyle();
    skeleton(el);
    repEl = el;
    repApi = api;
    on(window.matchMedia('(max-width:819px), (max-height:760px)'), 'change', repaint);
    const lobby = el.querySelector('#cc-lobby');
    if (lobby) on(lobby, 'click', () => api.lobby());
    on(el.querySelector('#cc-claim'),'click',()=>{
      const button=el.querySelector('#cc-claim');
      if(!repS||repS.spectator||repS.phase!=='build'||!button?.dataset.chest)return;
      api.send({claimSupply:{id:button.dataset.chest,nonce:nonce()}});
    });
    on(el, 'keydown', (e) => {
      if (e.key === 'Escape') {
        selPiece = 'wall';
        selWeapon = 'catapult';
        buildMode = 'build';
        repaint();
        return;
      }
      // Arrow-key grid navigation: move focus to the adjacent castle cell.
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && e.target && e.target.classList &&
        e.target.classList.contains('cc-cell')) {
        const gridEl = e.target.closest('.cc-grid');
        if (!gridEl) return;
        const dx = arrows[e.key][0];
        const dy = arrows[e.key][1];
        const nx = Number(e.target.dataset.x) + dx;
        const ny = Number(e.target.dataset.y) + dy;
        const next = gridEl.querySelector(`[data-x="${nx}"][data-y="${ny}"]`);
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
    });
    // Timer + cooldown patch only (text/attribute patches, never rebuilds,
    // never announces). As calibrated time passes, expired cooldowns flip
    // weapon buttons, the selected-weapon target grid, and the action bar
    // back to ready with no new snapshot — otherwise targets can stay
    // disabled forever when every weapon was cooling.
    tickTimer = setInterval(() => {
      const now = serverNow();
      const t = el.querySelector('#cc-timer');
      if (t && !t.hidden && t.dataset.endsAt) {
        const left = countdown(Number(t.dataset.endsAt), now);
        t.textContent = left + 's';
      }
      el.querySelectorAll('[data-cd]').forEach((n) => {
        const ms = cooldownLeft(Number(n.dataset.cd), now);
        n.textContent = ms > 0 ? `cooldown ${fmtSeconds(ms)}s` : 'ready';
      });
      if (!repS) return;
      paintSupplies(el,repS,api);
      const myTeamTick = repS.myTeam || teamOf(repS, repS.you);
      const canActTick = !repS.spectator && !!myTeamTick && repS.phase !== 'done';
      const TT = myTeamTick && repS.teams ? repS.teams[myTeamTick] : null;
      // Re-enable weapons whose cooldown elapsed without a fresh snapshot.
      el.querySelectorAll('[data-weapon]').forEach((b) => {
        const small = b.querySelector('[data-cd]');
        if (small && cooldownLeft(Number(small.dataset.cd), now) <= 0 &&
            canActTick && repS.phase === 'siege' && b.dataset.locked !== '1') {
          b.disabled = false;
        }
      });
      // Selected-weapon readiness may have flipped while the snapshot sat
      // still: patch the action bar + enemy targets in place to match.
      // Spectators, teamless viewers, build, and done phases keep the last
      // snapshot's disabled state (never enabled by the clock alone).
      if (canActTick && repS.phase === 'siege' && TT) {
        const wRow = repS.catalog && repS.catalog.weapons ? repS.catalog.weapons[selWeapon] : null;
        const tickLocked = !wRow || (wRow.unlockAt > 0 && !(TT.unlocks || []).includes('weapon:' + selWeapon));
        const tickLeft = cooldownLeft((repS.cooldowns || {})[selWeapon] || 0, now);
        const tickReady = !!wRow && !tickLocked && tickLeft <= 0;
        const act = el.querySelector('#cc-action');
        if (act && !act.hidden) {
          const txt = actionText(repS, TT, myTeamTick, canActTick, { now: () => now });
          if (act.textContent !== txt) act.textContent = txt;
        }
        const foeBtns = exportDefault._foeBtns;
        if (foeBtns && foeBtns.size) {
          const foeTeam = foeOf(myTeamTick);
          const foeMap = gridMap((repS.grids || {})[foeTeam] || []);
          const foeObj = repS.objectives ? repS.objectives[foeTeam] : null;
          patchGrid(foeBtns, foeMap, {
            enabled: (x, y, cell) => !!cell && tickReady,
            selected: () => false,
            label: (x, y, cell) => {
              if (cell && cell.objective) {
                const cov = foeObj ? pct(foeObj.cover) : 0;
                if (tickLocked) return `Enemy Core, ${cell.hp} of ${cell.maxHp} health, cover ${cov} percent — ${selWeapon} is locked`;
                if (tickLeft > 0) return `Enemy Core, ${cell.hp} of ${cell.maxHp} health, cover ${cov} percent — ${selWeapon} cools ${fmtSeconds(tickLeft)} seconds`;
                return `Enemy Core, ${cell.hp} of ${cell.maxHp} health, cover ${cov} percent — tap to fire ${selWeapon}`;
              }
              if (cell && tickLocked) return `Enemy ${cell.piece}, ${cell.hp} of ${cell.maxHp} health — ${selWeapon} is locked`;
              if (cell && tickLeft > 0) return `Enemy ${cell.piece}, ${cell.hp} of ${cell.maxHp} health — ${selWeapon} cools ${fmtSeconds(tickLeft)} seconds`;
              return cell
                ? `Enemy ${cell.piece}, ${cell.hp} of ${cell.maxHp} health — tap to fire ${selWeapon}`
                : `Empty enemy plot at ${x} ${y}`;
            },
          });
        }
      }
    }, 500);
    lastInstance = '';
    lastGridKey = '';
    lastPalKey = '';
    lastModesKey = '';
    lastCoreKey = '';
  },

  update(el, S, api) {
    const root = el.querySelector('#cc-root');
    if (!root) { this.mount(el, api); return this.update(el, S, api); }
    if (S.game !== 'castle-clash') return;
    repS = S;
    paintSupplies(el,S,api);
    const fresh = S.instanceId !== lastInstance;
    if (fresh) {
      lastInstance = S.instanceId;
      selPiece = 'wall';
      selWeapon = 'catapult';
      buildMode = 'build';
      lastGridKey = '';
      lastPalKey = '';
      lastModesKey = '';
      lastCoreKey = '';
      prevUnlocks = null; // re-baseline fresh-unlock feedback below
    }
    if (S.phase !== lastPhase || S.round !== lastRound) {
      lastPhase = S.phase;
      lastRound = S.round;
      if (S.phase === 'build') api.announce(`Round ${S.round}: build your castle! Defend your Core!`);
      else if (S.phase === 'siege') api.announce(`Round ${S.round}: siege! Attack the enemy Core!`);
      else if (S.phase === 'done') api.announce('Battle over!');
    }

    const myTeam = S.myTeam || teamOf(S, S.you);
    const foe = myTeam ? foeOf(myTeam) : 'red';
    const mine = myTeam || 'red';
    const canAct = !S.spectator && !!myTeam && S.phase !== 'done';
    const T = S.teams[mine];
    // Siege flow: when the selected weapon is locked or cooling and a
    // ready unlocked weapon exists, follow it so taps keep landing.
    if (canAct && S.phase === 'siege') {
      const cur = weaponState(S, T, selWeapon, api);
      if (!cur.w || cur.locked || cur.left > 0) {
        const alt = Object.keys(S.catalog.weapons).find((id) => {
          const s = weaponState(S, T, id, api);
          return s.w && !s.locked && s.left <= 0;
        });
        if (alt && alt !== selWeapon) selWeapon = alt;
      }
    }
    // Fresh unlocks: earned (unlockAt>0) entries new since the last
    // snapshot, announced once for the viewer's own team.
    const atOf = (u) => {
      const i = u.indexOf(':');
      const table = u.slice(0, i) === 'piece' ? S.catalog.pieces : S.catalog.weapons;
      const row = table && table[u.slice(i + 1)];
      return (row && row.unlockAt) || 0;
    };
    const freshEarned = [];
    if (prevUnlocks === null) {
      prevUnlocks = (T.unlocks || []).slice(); // baseline, no fanfare
    } else {
      const seen = new Set(prevUnlocks);
      for (const u of (T.unlocks || [])) {
        if (!seen.has(u) && atOf(u) > 0) freshEarned.push(u);
      }
      prevUnlocks = (T.unlocks || []).slice();
      if (freshEarned.length && myTeam) {
        const names = freshEarned.map((u) => {
          const i = u.indexOf(':');
          return unlockName({ kind: u.slice(0, i), id: u.slice(i + 1) });
        }).join(', ');
        try { api.announce(`New unlock: ${names}!`); } catch { /* best-effort */ }
      }
    }
    const freshSet = new Set(freshEarned);
    root.dataset.phase = S.phase;
    const compact = window.matchMedia('(max-width:819px), (max-height:760px)').matches;
    const layoutKey = `${S.instanceId}|${S.phase}|${compact}`;
    if (root.dataset.layout !== layoutKey) {
      root.dataset.layout = layoutKey;
      el.querySelector('#cc-intel').open = !compact;
      el.querySelector('#cc-mine-wrap').open = !compact || S.phase !== 'siege';
      el.querySelector('#cc-foe-wrap').open = !compact || S.phase !== 'build';
    }
    const ownCore = S.objectives && S.objectives[mine];
    const enemyCore = S.objectives && S.objectives[foe];
    el.querySelector('#cc-brief').textContent = S.phase === 'done' ? '' : S.phase === 'build'
      ? `${T.resources} ${S.economy.resourceName}${ownCore ? ` · Your Core ${ownCore.hp}hp` : ''}`
      : `${enemyCore ? `Enemy Core ${enemyCore.hp}hp` : S.teams[foe].name}${ownCore ? ` · Your Core ${ownCore.hp}hp` : ''}`;
    // Primary action bar: hidden at done (the result banner owns it).
    const actEl = el.querySelector('#cc-action');
    actEl.hidden = S.phase === 'done';
    if (!actEl.hidden) actEl.textContent = actionText(S, T, myTeam, canAct, api);

    // Header (patched text).
    const phaseEl = el.querySelector('#cc-phase');
    phaseEl.textContent = S.phase === 'done'
      ? `Battle over · round ${S.round}/${S.rounds}`
      : `Round ${S.round}/${S.rounds} · ${S.phase === 'build' ? 'Build!' : 'Siege!'}`;
    const timerEl = el.querySelector('#cc-timer');
    timerEl.dataset.endsAt = String(S.endsAt || 0);
    timerEl.hidden = S.phase === 'done';
    timerEl.textContent = S.phase === 'done' ? '—' : countdown(S.endsAt || 0, serverNow(api)) + 's';

    // Teams (small patched block).
    const teamsEl = el.querySelector('#cc-teams');
    teamsEl.innerHTML = ['red', 'blue'].map((t) => {
      const tm = S.teams[t];
      const names = tm.members.map((pid) => esc(pid === S.you ? nameOf(S, pid) + ' (you)' : nameOf(S, pid))).join(', ');
      return `<div class="cc-team ${t}${t === myTeam ? ' mine' : ''}">
        <div class="cc-tname">${esc(tm.name)}${t === myTeam ? ' · yours' : ''}</div>
        <div class="cc-tmeta">Shared pile: ${tm.resources} ${esc(S.economy.resourceName)} · ${tm.points} ${esc(S.economy.pointsName)}</div>
        <div class="cc-members">${names || '—'}</div></div>`;
    }).join('');

    // Core rules + live Core health/cover/auras (patched text).
    const rulesEl = el.querySelector('#cc-rules');
    const rules = rulesText(S);
    if (rulesEl._last !== rules) {
      rulesEl._last = rules;
      rulesEl.textContent = rules;
    }
    const coreEl = el.querySelector('#cc-core');
    const coreKey = S.objective
      ? `${S.objectives.red.hp}|${S.objectives.red.cover}|${S.objectives.blue.hp}|${S.objectives.blue.cover}|${S.auras.red.ward}|${S.auras.red.boost}|${S.auras.blue.ward}|${S.auras.blue.boost}`
      : 'none';
    if (coreKey !== lastCoreKey) {
      lastCoreKey = coreKey;
      coreEl.innerHTML = S.objective ? coreBar(S, mine, mine) + coreBar(S, foe, mine) : '';
      coreEl.style.display = S.objective ? '' : 'none';
    }

    // Result banner.
    const resEl = el.querySelector('#cc-result');
    if (S.phase === 'done' && S.result) {
      resEl.hidden = false;
      const w = S.result.winners.map((t) => S.teams[t].name).join(' & ');
      const bonus = S.winBonus ? ` (+${S.winBonus} winner bonus)` : '';
      const tieBonus = S.winBonus ? ` (+${S.winBonus} each)` : '';
      const fallen = ['red', 'blue'].find((t) => S.objectives?.[t]?.hp <= 0);
      const reason = fallen
        ? `${S.teams[fallen].name}'s Core was destroyed, ending the siege early.`
        : 'Siege time is up. Surviving Cores earned authority.';
      const title = S.result.winner
        ? `${S.teams[S.result.winner].name} wins ${S.result.teams.red.points}–${S.result.teams.blue.points}!${bonus}`
        : `Tied ${S.result.teams.red.points}–${S.result.teams.blue.points}! ${w} share the crown${tieBonus}.`;
      resEl.innerHTML = `${esc(title)}<small>${esc(reason)}</small><small>Match authority above. Night totals add up across games.</small>`;
    } else resEl.hidden = true;

    // Grids: rebuild buttons only when the field shape/round/phase changes;
    // every snapshot otherwise patches cells in place (focus-safe).
    const gk = gridKey(S);
    if (gk !== lastGridKey) {
      lastGridKey = gk;
      const mineZone = S.arena.zones[mine];
      const foeZone = S.arena.zones[foe];
      el.querySelector('#cc-mine-h').textContent = `Your castle — ${S.teams[mine].name}`;
      el.querySelector('#cc-foe-h').textContent = `Enemy castle — ${S.teams[foe].name}`;
      const mineTable = el.querySelector('#cc-mine');
      const foeTable = el.querySelector('#cc-foe');
      mineTable.style.gridTemplateColumns = `repeat(${mineZone.x1 - mineZone.x0 + 1},minmax(44px,1fr))`;
      foeTable.style.gridTemplateColumns = `repeat(${foeZone.x1 - foeZone.x0 + 1},minmax(44px,1fr))`;
      this._mineBtns = buildGrid(mineTable, zoneCells(mineZone), {}, api);
      this._foeBtns = buildGrid(foeTable, zoneCells(foeZone), {}, api);
      // Wire clicks once per grid build.
      for (const [k, b] of this._mineBtns) {
        const [x, y] = k.split(',').map(Number);
        on(b, 'click', () => {
          if (!canAct || repS.phase !== 'build') return;
          if (buildMode === 'build') repApi.send({ build: { piece: selPiece, x, y, nonce: nonce() } });
          else if (buildMode === 'upgrade') repApi.send({ upgrade: { x, y, nonce: nonce() } });
          else repApi.send({ teardown: { x, y, nonce: nonce() } });
        });
      }
      for (const [k, b] of this._foeBtns) {
        const [x, y] = k.split(',').map(Number);
        on(b, 'click', () => {
          if (!canAct || repS.phase !== 'siege') return;
          repApi.send({ fire: { weapon: selWeapon, x, y, nonce: nonce() } });
        });
      }
    }

    const mineMap = gridMap(S.grids[mine]);
    const foeMap = gridMap(S.grids[foe]);
    const foeObj = S.objectives ? S.objectives[foe] : null;
    // Build affordances mirror the server's checks (locks, shared pile,
    // max level), so denied taps are disabled with a reason, not silent.
    const piecePick = S.catalog.pieces[selPiece];
    const pieceLocked = !piecePick || (piecePick.unlockAt > 0 && !(T.unlocks || []).includes('piece:' + selPiece));
    const pieceAfford = !!piecePick && T.resources >= piecePick.cost;
    if (this._mineBtns) {
      patchGrid(this._mineBtns, mineMap, {
        enabled: (x, y, cell) => {
          if (!canAct || S.phase !== 'build') return false;
          if (cell && cell.objective) return false; // Core: no upgrade/teardown
          if (buildMode === 'build') {
            return !cell && !pieceLocked && pieceAfford;
          }
          if (buildMode === 'upgrade') {
            if (!cell) return false;
            const p = S.catalog.pieces[cell.piece];
            return !!p && cell.level < p.maxLevel && T.resources >= p.cost;
          }
          return !!cell; // teardown: any own structure
        },
        selected: () => false,
        label: (x, y, cell) => {
          if (cell && cell.objective) return `Your Core, ${cell.hp} of ${cell.maxHp} health at ${x} ${y}: cannot upgrade or remove, defend it`;
          if (buildMode === 'upgrade' && cell && !cell.objective) {
            const p = S.catalog.pieces[cell.piece];
            if (p && cell.level >= p.maxLevel) return `${cell.piece} at ${x} ${y}: already max level ${p.maxLevel}`;
            if (p && T.resources < p.cost) return `${cell.piece} at ${x} ${y}: upgrade needs ${p.cost} shared ${S.economy.resourceName}, pile has ${T.resources}`;
          }
          if (buildMode === 'build' && !cell) {
            if (pieceLocked) return `Empty plot at ${x} ${y}: ${selPiece} is locked`;
            if (!pieceAfford) return `Empty plot at ${x} ${y}: need ${piecePick.cost - T.resources} more shared ${S.economy.resourceName} for ${selPiece}`;
          }
          return cell
            ? `${cell.piece} level ${cell.level}, ${cell.hp} of ${cell.maxHp} health, at ${x} ${y}`
            : `Empty plot at ${x} ${y}, build here`;
        },
      });
    }
    // Siege affordances mirror the server: the tapped cell must hold a
    // structure AND the selected weapon must be unlocked and cooled.
    const siegeW = weaponState(S, T, selWeapon, api);
    const siegeReady = !!siegeW.w && !siegeW.locked && siegeW.left <= 0;
    if (this._foeBtns) {
      patchGrid(this._foeBtns, foeMap, {
        enabled: (x, y, cell) => canAct && S.phase === 'siege' && !!cell && siegeReady,
        selected: () => false,
        label: (x, y, cell) => {
          if (cell && cell.objective) {
            const cov = foeObj ? pct(foeObj.cover) : 0;
            if (siegeW.locked) return `Enemy Core, ${cell.hp} of ${cell.maxHp} health, cover ${cov} percent — ${selWeapon} is locked`;
            if (siegeW.left > 0) return `Enemy Core, ${cell.hp} of ${cell.maxHp} health, cover ${cov} percent — ${selWeapon} cools ${fmtSeconds(siegeW.left)} seconds`;
            return `Enemy Core, ${cell.hp} of ${cell.maxHp} health, cover ${cov} percent — tap to fire ${selWeapon}`;
          }
          if (cell && siegeW.locked) return `Enemy ${cell.piece}, ${cell.hp} of ${cell.maxHp} health — ${selWeapon} is locked`;
          if (cell && siegeW.left > 0) return `Enemy ${cell.piece}, ${cell.hp} of ${cell.maxHp} health — ${selWeapon} cools ${fmtSeconds(siegeW.left)} seconds`;
          return cell
            ? `Enemy ${cell.piece}, ${cell.hp} of ${cell.maxHp} health — tap to fire ${selWeapon}`
            : `Empty enemy plot at ${x} ${y}`;
        },
      });
    }

    // Mode buttons (build phase only): rebuilt only when the key changes,
    // so snapshots never churn listeners while you aim.
    const modesEl = el.querySelector('#cc-modes');
    const modesKey = S.phase === 'build' && canAct ? `m:${buildMode}` : 'm:-';
    if (modesKey !== lastModesKey) {
      lastModesKey = modesKey;
      if (S.phase === 'build' && canAct) {
        modesEl.innerHTML = ['build', 'upgrade', 'teardown'].map((m) =>
          `<button type="button" class="btn${buildMode === m ? '' : ' ghost'}" data-mode="${m}" aria-pressed="${buildMode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('');
        modesEl.querySelectorAll('[data-mode]').forEach((b) => {
          on(b, 'click', () => { buildMode = b.dataset.mode; repaint(); });
        });
      } else modesEl.innerHTML = '';
    }

    // Palette (build) or weapon rack (siege): rebuilt only when economy,
    // unlocks, phase, or selection change. Cooldown countdowns are patched
    // by the interval, not by rebuilds. The fresh suffix flashes newly
    // unlocked picks once, then clears on the next snapshot.
    const palEl = el.querySelector('#cc-palette');
    const cdKey = S.phase === 'siege'
      ? Object.keys(S.catalog.weapons || {}).map((id) => `${id}:${(S.cooldowns || {})[id] || 0}`).join(',')
      : '';
    const palKey = `${S.phase}|${T.resources}|${T.points}|${(T.unlocks || []).join(',')}|${selPiece}|${selWeapon}|${buildMode}|${canAct}|cd:${cdKey}|fresh:${freshEarned.join('+')}`;
    if (palKey !== lastPalKey) {
      lastPalKey = palKey;
      if (S.phase === 'build' && buildMode !== 'build') {
        const hint = buildMode === 'upgrade'
          ? `Tap one of YOUR structures to level it up: costs its base ${S.economy.resourceName} again, heals to full. Switch to Build to place new pieces.`
          : `Tap one of YOUR structures to remove it for a ${pct(S.economy.refundRate)}% refund — the Core can never be removed. Switch to Build to place new pieces.`;
        palEl.innerHTML = `<div class="cc-hint">${esc(hint)}</div>`;
      } else if (S.phase === 'build') {
        const ids = Object.keys(S.catalog.pieces);
        palEl.innerHTML = ids.map((id) => {
          const p = S.catalog.pieces[id];
          const locked = p.unlockAt > 0 && !(T.unlocks || []).includes('piece:' + id);
          const afford = T.resources >= p.cost;
          const dis = !canAct || locked || !afford;
          const mods = [];
          if (p.ward > 0) mods.push(`ward ${pct(p.ward)}%`);
          if (p.boost > 0) mods.push(`boost ${pct(p.boost)}%`);
          if (p.coverWeight > 1) mods.push(`cover x${p.coverWeight}`);
          const modTxt = mods.length ? ` · ${mods.join(' ')}` : '';
          return `<button type="button" class="cc-pick${selPiece === id ? ' sel' : ''}${freshSet.has('piece:' + id) ? ' fresh' : ''}" data-piece="${esc(id)}"
            ${dis ? 'disabled' : ''} aria-pressed="${selPiece === id}">
            <span class="g" aria-hidden="true">${esc(pieceGlyph(id))}</span>
            <span><b>${esc(id)}</b><br><span class="muted">${locked ? `locked · ${p.unlockAt} ${esc(S.economy.pointsName)}` : `${p.cost} ${esc(S.economy.resourceName)} · ${p.hp}hp · lvl ${p.maxLevel}${esc(modTxt)}`}</span></span>
            <small>${afford || locked ? '' : 'too poor'}</small></button>`;
        }).join('');
        palEl.querySelectorAll('[data-piece]').forEach((b) => {
          on(b, 'click', () => { selPiece = b.dataset.piece; buildMode = 'build'; repaint(); });
        });
      } else if (S.phase === 'siege') {
        const ids = Object.keys(S.catalog.weapons);
        palEl.innerHTML = ids.map((id) => {
          const w = S.catalog.weapons[id];
          const locked = w.unlockAt > 0 && !(T.unlocks || []).includes('weapon:' + id);
          const readyAt = (S.cooldowns || {})[id] || 0;
          const left = cooldownLeft(readyAt, serverNow(api));
          const dis = !canAct || locked || left > 0;
          return `<button type="button" class="cc-pick${selWeapon === id ? ' sel' : ''}${freshSet.has('weapon:' + id) ? ' fresh' : ''}" data-weapon="${esc(id)}" data-locked="${locked ? '1' : '0'}"
            ${dis ? 'disabled' : ''} aria-pressed="${selWeapon === id}">
            <span class="g" aria-hidden="true">${esc(weaponGlyph(id))}</span>
            <span><b>${esc(id)}</b><br><span class="muted">${locked ? `locked · ${w.unlockAt} ${esc(S.economy.pointsName)}` : `${w.damage} dmg · ${Math.round(w.cooldownMs / 1000)}s cool`}</span></span>
            <small data-cd="${readyAt}">${left > 0 ? `cooldown ${fmtSeconds(left)}s` : 'ready'}</small></button>`;
        }).join('');
        palEl.querySelectorAll('[data-weapon]').forEach((b) => {
          on(b, 'click', () => { selWeapon = b.dataset.weapon; repaint(); });
        });
      } else palEl.innerHTML = '';
    }

    // Unlock preview.
    const unEl = el.querySelector('#cc-unlock');
    const nu = T.nextUnlock;
    unEl.textContent = S.phase === 'done'
      ? `Final: ${T.points} ${S.economy.pointsName}.`
      : nu ? `Next unlock: ${unlockName(nu)} at ${nu.at} ${S.economy.pointsName} (have ${T.points}).`
        : `All unlocks earned (${T.points} ${S.economy.pointsName})!`;

    // Battle log (small, rebuilt — it never holds focus).
    const logEl = el.querySelector('#cc-log');
    const lines = (S.log || []).slice(-12).map((e) => `<div>${logLine(S, e)}</div>`).join('');
    if (logEl._last !== lines) {
      logEl._last = lines;
      logEl.innerHTML = lines || '<div class="muted">Build phase — defend your Core.</div>';
      logEl.scrollTop = logEl.scrollHeight;
    }
  },

  dispose() {
    disposeAll();
  },
};

export default exportDefault;

function disposeAll() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
  for (const [t, type, fn, opts] of bound) {
    try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
  }
  bound = [];
  selPiece = 'wall';
  selWeapon = 'catapult';
  buildMode = 'build';
  prevUnlocks = null;
  lastInstance = '';
  lastPhase = '';
  lastRound = 0;
  lastGridKey = '';
  lastPalKey = '';
  lastModesKey = '';
  lastCoreKey = '';
  repEl = null;
  repApi = null;
  repS = null;
  const st = document.getElementById(NSTYLE);
  if (st && st.parentNode) st.parentNode.removeChild(st);
}
