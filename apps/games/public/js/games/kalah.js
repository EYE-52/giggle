import { esc, nameOf } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelHTML, bkPaint, bkClick, bkDispose, bkDrawState, bkTimer, bkMeta, bkRank, bkHeadline, bkReason, bkHost } from './board-kit.js';

let root, art, api, state, baseline, instance = '', revision = -1, flipped = false, cursor = 0, portrait = false;
let pending = null, pendingTimer = 0, frame = 0, moving = null, armed = false, resultReady = '', bound = [];
const storeOf = side => side ? 13 : 6;
const owner = i => i > 6 ? 1 : 0;
const text = key => state?.strings?.[key] || key;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function listen(node, type, fn) { node.addEventListener(type, fn); bound.push([node, type, fn]); }
function point(pit) {
  let p = portrait
    ? pit === 6 ? {x:200,y:440} : pit === 13 ? {x:200,y:36}
      : pit < 6 ? {x:110,y:92 + pit * 58} : {x:290,y:92 + (12 - pit) * 58}
    : pit === 6 ? {x:770,y:180} : pit === 13 ? {x:70,y:180}
      : pit < 6 ? {x:170 + pit * 100,y:255} : {x:170 + (12 - pit) * 100,y:105};
  if (flipped) p = {x:(portrait ? 400 : 840) - p.x,y:(portrait ? 480 : 360) - p.y};
  return p;
}
const SEED = { 0: ['#27a99b', '#16766c'], 1: ['#f0b23a', '#b47d16'] };
function seed(x, y, size, side) {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size * .8}" fill="${SEED[side][0]}" stroke="${SEED[side][1]}" stroke-width="1.5"/>`;
}
function chip(side) { return `<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" fill="${SEED[side][0]}" stroke="${SEED[side][1]}" stroke-width="2"/></svg>`; }
function stones(i, count) {
  const p = point(i), store = i === 6 || i === 13, total = Math.min(count, store ? 25 : 14);
  let html = '';
  for (let n = 0; n < total; n++) {
    const a = n * 2.39996 + i * .73, radius = Math.sqrt((n + .6) / total);
    const dx = Math.cos(a) * radius * (store ? (portrait ? 104 : 26) : 32);
    const dy = Math.sin(a) * radius * (store ? (portrait ? 10 : 84) : portrait ? 12 : 21);
    html += seed(p.x + dx, p.y + dy, store ? 13 : 12, (n + i) % 3 === 0 ? 1 : 0);
  }
  return html;
}
function boardSvg(pits) {
  const width = portrait ? 400 : 840, height = portrait ? 480 : 360;
  const from = !moving && state.lastMove ? state.lastMove.pit : null, landed = !moving && state.lastMove ? state.lastMove.steps.at(-1) : null;
  let html = `<rect class="kl-frame" x="4" y="4" width="${width - 8}" height="${height - 8}" rx="40"/>`;
  for (let i = 0; i < 14; i++) {
    const p = point(i), store = i === 6 || i === 13, own = owner(i), active = myTurn() && !moving && pending === null && state.legal.includes(i);
    const rx = store ? (portrait ? 138 : 45) : portrait ? 54 : 43, ry = store ? (portrait ? 24 : 111) : portrait ? 24 : 53;
    const label = text(own ? 'amber' : 'jade') + ' ' + (store ? text('store') : text('bowl') + ' ' + (i < 6 ? i + 1 : i - 6)) + ', ' + pits[i] + ' ' + text(pits[i] === 1 ? 'seed' : 'seeds');
    const mark = i === from ? ' is-from' : i === landed ? ' is-landed' : '';
    html += `<g ${store ? `aria-label="${esc(label)}"` : `data-pit="${i}" data-watchok role="button" tabindex="${cursor === i ? 0 : -1}"${cursor === i ? ' data-game-focus' : ''} aria-disabled="${!active}" aria-label="${esc(label)}"`} class="kl-bowl ${active ? 'is-legal' : ''}${mark}">
      <ellipse class="kl-pit" cx="${p.x}" cy="${p.y}" rx="${rx}" ry="${ry}"/>
      ${stones(i, pits[i])}
      <text class="kl-num" x="${portrait && !store ? p.x+(p.x<200?-73:73) : p.x}" y="${p.y + (portrait && !store ? 10 : store ? 12 : 83)}" text-anchor="middle" font-size="${store ? 34 : 28}" font-weight="800">${pits[i]}</text>
      ${store ? '' : `<rect class="kl-hit" x="${p.x - (portrait ? 75 : 49)}" y="${p.y - (portrait ? 29 : 68)}" width="${portrait ? 150 : 98}" height="${portrait ? 58 : 136}" rx="30" fill="transparent"/><ellipse class="kl-focus" cx="${p.x}" cy="${p.y}" rx="${rx + 6}" ry="${ry + 6}" fill="none"/>`}
    </g>`;
  }
  for (const p of moving?.floating || []) html += seed(p.x, p.y, 11, moving.side);
  return html;
}
function myTurn() { return !state?.preparing && state?.phase === 'play' && state.youAre !== null && !state.spectator && state.turn === state.youAre; }
function send(action) {
  if (!state || moving || pending !== null || state.preparing || state.spectator || state.youAre === null || state.phase !== 'play') return;
  pending = state.revision;
  const retryTimer = pendingTimer = setTimeout(() => { if (pendingTimer !== retryTimer) return; pendingTimer = 0; pending = null; paint(); api?.toast?.(text('retry')); }, 4000);
  api.send({ ...action, revision: state.revision }); paint();
}
function reasonText(r) {
  if (r.reason === 'collected') return `${text('collectedReason')}: ${state.pits[6]} to ${state.pits[13]}.`;
  return bkReason(r.reason, r.winner === null ? '' : nameOf(state, state.seats[1 - r.winner])) || text(r.reason + 'Reason');
}
function resultLabel() { const r = state.result; return r.winner === null ? 'It’s a tie.' : nameOf(state, r.winnerPid) + ' ' + text('win') + '.'; }
function finalModel(done) {
  if (!done) return null;
  const me = state.youAre === null || state.spectator ? null : state.seats[state.youAre];
  const rows = bkRank(state.seats.map((pid, i) => ({ name: nameOf(state, pid), points: state.scores?.[pid] ?? 0, you: pid === me, order: i, note: `${state.pits[storeOf(i)]} ${text('seeds')}` })));
  const winners = state.result.winnerPid ? [nameOf(state, state.result.winnerPid)] : state.seats.map(pid => nameOf(state, pid));
  return { headline: bkHeadline(winners), detail: reasonText(state.result), rows, ...bkHost(api) };
}
function paint() {
  if (!state || !root) return;
  const focus = root.contains(document.activeElement) ? document.activeElement?.dataset?.pit : undefined;
  const pits = moving?.pits || state.pits, done = state.phase === 'done' && !moving;
  root.classList.toggle('kl-portrait', portrait); art.setAttribute('viewBox', portrait ? '0 0 400 480' : '0 0 840 360');
  art.innerHTML = boardSvg(pits);
  if (focus !== undefined) art.querySelector(`[data-pit="${focus}"]`)?.focus({ preventScroll: true });
  const helpBody = root.querySelector('.bk-help-body');
  if (helpBody.textContent !== text('instructions')) helpBody.textContent = text('instructions');
  const me = state.youAre === null || state.spectator ? null : state.seats[state.youAre];
  const extraHint = state.lastMove?.extra === true || state.lastMove?.captures?.length;
  bkPaint(root, {
    meta: bkMeta(state, text('variant')),
    players: [0, 1].map(side => ({ name: nameOf(state, state.seats[side]), side: text(side ? 'amber' : 'jade'), chip: chip(side), stat: pits[storeOf(side)], statLabel: text('store').toLowerCase(), turn: !done && !moving && !state.preparing && state.phase === 'play' && state.turn === side, you: state.youAre === side && !state.spectator })),
    status: moving ? text('sowing') : done ? resultLabel() : state.preparing ? '' : state.youAre === null ? text('watching') + ' · ' + nameOf(state, state.seats[state.turn]) : myTurn() ? text('yourTurn') : text('waiting'),
    hint: done ? reasonText(state.result) : moving || state.preparing || !extraHint ? '' : state.youAre === null ? text('spectatorHelp') : state.lastMove?.extra && myTurn() ? text('extra') : state.lastMove?.captures?.length && state.lastMove.side === state.youAre ? text('capture') : myTurn() ? text('choose') : text('waitingHint'),
    timer: bkTimer(state, api), done: state.phase === 'done', player: !!me, busy: !!moving || pending !== null || state.preparing === true,
    armed, drawOffer: bkDrawState(state, me), drawBlocked: state.drawBlocked === me, flipBusy: !!moving,
    final: finalModel(done),
  });
  if (done && resultReady === 'pending') { resultReady = state.instanceId; api.resultsReady?.(state.instanceId); }
}
function animate(move) {
  const started = performance.now(), duration = Math.min(100, 1400 / Math.max(1, move.steps.length));
  const pits = move.before.slice(); pits[move.pit] = 0;
  // Transfers follow the same public capture/sweep order as the authority.
  const settled = pits.slice(), transfers = [];
  move.steps.forEach(pit => settled[pit]++);
  for (const from of [...move.captures, ...move.swept]) {
    const to = move.captures.includes(from) ? storeOf(move.side) : storeOf(owner(from)), count = settled[from];
    if (count) { transfers.push({ from, to, count }); settled[from] = 0; settled[to] += count; }
  }
  const sowTime = move.steps.length * duration, transferTime = Math.min(220, 900 / Math.max(1, transfers.length)), total = sowTime + transfers.length * transferTime + 100;
  const animation = moving = { pits, side: move.side, floating: [], landed: false, captured: false };
  let applied = 0, collected = 0;
  function arc(from, to, t, n = 0, count = 1) {
    const a = point(from), b = point(to), spread = (n - (count - 1) / 2) * 10;
    return { x: a.x + (b.x - a.x) * t + spread * Math.sin(t * Math.PI), y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * (40 + n * 4) };
  }
  function step(now) {
    if (!root || moving !== animation) return;
    const elapsed = now - started, count = Math.min(move.steps.length, Math.floor(elapsed / duration));
    while (applied < count) { moving.pits[move.steps[applied]]++; applied++; }
    moving.floating = [];
    if (count < move.steps.length) {
      const t = Math.min(1, (elapsed - count * duration) / duration);
      moving.floating = [arc(move.pit, move.steps[count], t)];
    } else {
      const finished = Math.min(transfers.length, Math.floor((elapsed - sowTime) / transferTime));
      while (collected < finished) { const transfer = transfers[collected++]; moving.pits[transfer.from] = 0; moving.pits[transfer.to] += transfer.count; }
      if (collected < transfers.length) {
        const transfer = transfers[collected], t = Math.min(1, (elapsed - sowTime - collected * transferTime) / transferTime), visible = Math.min(6, transfer.count);
        moving.pits[transfer.from] = 0;
        moving.floating = Array.from({ length: visible }, (_, n) => arc(transfer.from, transfer.to, t, n, visible));
      }
    }
    paint();
    if (applied === move.steps.length && !moving.landed) { moving.landed = true; if (!moving.silent) api.cue?.('piece', { id: `${instance}:${move.revision}:sow`, gain: .6 }); }
    if (move.captures.length && collected === transfers.length && !moving.captured) { moving.captured = true; if (!moving.silent) api.cue?.('capture', { id: `${instance}:${move.revision}:capture`, gain: .8 }); }
    if (elapsed < total) frame = requestAnimationFrame(step);
    else { frame = 0; moving = null; paint(); }
  }
  frame = requestAnimationFrame(step);
}

export default {
  styles: ['/css/board-duels.css', '/css/kalah.css'],
  ownsTimer: true, ownsInputs: true, ownsRematch: true, waitForResult: true,
  // Flat board: no bitmap materials to decode.
  ready() { return Promise.resolve(); },
  mount(el, suppliedApi) {
    this.dispose(); api = suppliedApi;
    bkEnsureCss();
    if (!document.getElementById('kalah-css')) { const css = document.createElement('link'); css.id = 'kalah-css'; css.rel = 'stylesheet'; css.href = '/css/kalah.css'; document.head.appendChild(css); }
    portrait = window.matchMedia('(orientation: portrait)').matches;
    el.innerHTML = `<section class="bk-game kl" aria-label="Kalah"><div class="bk-stage kl-board"><svg class="kl-art" viewBox="0 0 840 360" role="group" aria-label="Kalah board"></svg></div>${bkPanelHTML({ title: 'Kalah', flip: true, help: [] })}</section>`;
    root = el.querySelector('.kl'); art = root.querySelector('.kl-art');
    const sendFlag = action => { if (state?.youAre !== null && !state?.spectator) send(action); };
    const finalAction = name => { if (state?.phase === 'done' && !moving && api.context?.().isHost === true && !api.context?.().roomActionPending) api[name]?.(); };
    listen(root, 'click', e => {
      if (bkClick(e, {
        arm: () => { armed = !armed; paint(); },
        keep: () => { armed = false; paint(); },
        resign: () => { if (armed) sendFlag({ resign: true }); },
        offerDraw: () => sendFlag({ offerDraw: true }),
        acceptDraw: () => sendFlag({ acceptDraw: true }),
        declineDraw: () => sendFlag({ declineDraw: true }),
        flip: () => { if (moving) return; flipped = !flipped; paint(); },
        rematch: () => finalAction('rematch'), lobby: () => finalAction('lobby'),
      })) return;
      const pit = e.target.closest('[data-pit]');
      if (pit) { cursor = Number(pit.dataset.pit); if (myTurn() && state.legal.includes(cursor)) send({ pit: cursor }); }
    });
    listen(art, 'keydown', e => {
      const target = e.target.closest('[data-pit]'); if (!target) return;
      const i = Number(target.dataset.pit);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (myTurn() && state.legal.includes(i)) send({ pit: i }); return; }
      if (!e.key.startsWith('Arrow')) return; e.preventDefault();
      const p = point(i), candidates = Array.from({ length: 14 }, (_, n) => n).filter(n => n !== 6 && n !== 13 && n !== i);
      const rowStep = portrait ? 58 : 100;
      const targetPoint = e.key === 'ArrowRight' ? { x: p.x + 150, y: p.y } : e.key === 'ArrowLeft' ? { x: p.x - 150, y: p.y } : e.key === 'ArrowDown' ? { x: p.x, y: p.y + rowStep } : { x: p.x, y: p.y - rowStep };
      const directional = candidates.filter(n => { const q = point(n); return e.key === 'ArrowRight' ? q.x > p.x + 1 : e.key === 'ArrowLeft' ? q.x < p.x - 1 : e.key === 'ArrowDown' ? q.y > p.y + 1 : q.y < p.y - 1; });
      if (!directional.length) return;
      directional.sort((a, b) => { const x = point(a), y = point(b); return Math.hypot(x.x - targetPoint.x, x.y - targetPoint.y) - Math.hypot(y.x - targetPoint.x, y.y - targetPoint.y); });
      cursor = directional[0]; paint(); art.querySelector(`[data-pit="${cursor}"]`)?.focus({ preventScroll: true });
    });
    listen(window, 'resize', () => { portrait = window.matchMedia('(orientation: portrait)').matches; paint(); });
  },
  update(el, snapshot, suppliedApi) {
    api = suppliedApi;
    if (instance === snapshot.instanceId && snapshot.revision < revision) return;
    const fresh = instance !== snapshot.instanceId, prior = state;
    if (fresh) { if (frame) cancelAnimationFrame(frame); frame = 0; moving = null; instance = snapshot.instanceId; revision = -1; pending = null; armed = false; resultReady = ''; flipped = snapshot.youAre === 1; cursor = snapshot.youAre === 1 ? 7 : 0; }
    const roleChanged = prior?.youAre !== snapshot.youAre || prior?.spectator !== snapshot.spectator;
    // A prepared turn is current authority, but not yet a presented move.
    const confirmed = !fresh && !roleChanged && !snapshot.preparing && !snapshot.audioBaseline && baseline?.phase === 'play' && snapshot.lastMove?.revision === snapshot.revision && snapshot.revision === baseline.revision + 1;
    const changed = confirmed || revision !== snapshot.revision || roleChanged;
    if (changed) { if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = 0; pending = null; armed = false; }
    state = snapshot;
    if (snapshot.audioBaseline) { if (moving) moving.silent = true; resultReady = ''; }
    if (!fresh && !snapshot.audioBaseline && prior?.phase === 'play' && snapshot.phase === 'done') resultReady = 'pending';
    if (confirmed && !reduced()) {
      if (frame) cancelAnimationFrame(frame); moving = null; animate(snapshot.lastMove);
    } else if (changed) { if (frame) cancelAnimationFrame(frame); frame = 0; moving = null; }
    revision = snapshot.revision; paint();
    if (fresh || !snapshot.preparing || snapshot.audioBaseline || roleChanged) baseline = snapshot;
    if (confirmed && reduced()) api.cue?.(snapshot.lastMove.captures.length ? 'capture' : 'piece', { id: `${instance}:${revision}:land`, gain: .8 });
    if (!snapshot.preparing && snapshot.phase === 'play' && (prior?.preparing === true || prior?.turn !== snapshot.turn || prior?.youAre !== snapshot.youAre || prior?.spectator !== snapshot.spectator)) api.announce?.(myTurn() ? text('yourTurn') : nameOf(snapshot, snapshot.seats[snapshot.turn]) + ' · ' + text('waiting'));
  },
  dispose() {
    if (frame) cancelAnimationFrame(frame);
    if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = 0;
    bound.forEach(([node, type, fn]) => node.removeEventListener(type, fn)); bound = [];
    if (root) bkDispose(root);
    root = art = api = state = baseline = moving = null; frame = 0; instance = ''; revision = -1; pending = null; armed = false; resultReady = '';
    bkRemoveCss();
    document.getElementById('kalah-css')?.remove();
  },
};
