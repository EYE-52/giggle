/* Rank It: a private ladder draft, then the room's ranking and round
 * points. Built on the game kit (public/css/game-ui.css): HUD row, prompt,
 * ladder rows, waiting line, round results, Next, final scores. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function hud(S) {
  const n = (S.players || []).length;
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const round = Math.max(1, Math.min(S.round || 1, S.rounds || 1));
  const phase = S.phase === 'done' ? 'Final scores' : S.phase === 'reveal' ? 'Results' : 'Rank';
  const progress = S.phase === 'rank' ? `${(S.ranked || []).length} of ${n} locked in` : '';
  return `<header class="gk-hud party-hud" data-phase="${esc(S.phase)}" aria-label="Round and play status">`
    + `<span class="gk-hud-round party-round">Round ${round} of ${S.rounds || 1}</span>`
    + `<span class="gk-hud-phase party-phase">${esc(phase)}</span>`
    + (watch ? '<span class="party-spectator">Watching</span>' : '')
    + `<span class="gk-hud-progress party-progress">${esc(progress)}</span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span>`
    + `</header>`;
}

/* Round points rows (the match's Final scores come from the kit). */
function rankRows(scores, players, you) {
  const rows = (players || []).map((p) => ({ id: p.id, name: p.name || '?', points: Number(scores?.[p.id]) || 0, you: p.id === you, left: !!p.left }));
  rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i && r.points === rows[i - 1].points ? rows[i - 1].rank : i + 1; });
  return rows;
}
function rowsHtml(rows, { prefix = '', note = () => '' } = {}) {
  return `<ol class="gk-ranks party-scoreboard" aria-label="Match standings">${rows.map((r) => {
    const isTop = r.rank === 1 && r.points > 0;
    return `<li class="gk-rank-row party-score${isTop ? ' is-top party-score--top' : ''}${r.you ? ' is-you' : ''}${r.left ? ' is-left' : ''}">`
      + `<span class="gk-rank party-rank-num" aria-label="Rank ${r.rank}">${r.rank}</span>`
      + `<span class="gk-name">${esc(r.name)}${r.you ? ' <small>(you)</small>' : ''}${note(r)}</span><b class="gk-pts">${prefix}${r.points}</b></li>`;
  }).join('')}</ol>`;
}

let rankKey = '', rankApi = null;
let rankState = null;
let rankOrder = [0, 1, 2, 3, 4];

function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
}

function watching(S) {
  if (S.spectator) return true;
  return !(S.players || []).some((p) => p.id === S.me);
}

function sameOrder(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

function move(order, pos, dir) {
  const next = pos + dir;
  if (next < 0 || next >= order.length) return order;
  const copy = order.slice();
  [copy[pos], copy[next]] = [copy[next], copy[pos]];
  return copy;
}

function buildRank(el, S, api, focusPos) {
  const items = S.set.items;
  const activeKey = rankKey;
  const submitted = !!S.myRank;
  const dirty = submitted && !sameOrder(rankOrder, S.myRank);
  const rows = rankOrder.map((itemIdx, pos) => `
    <li class="party-rank-item${pos === focusPos ? ' is-moved' : ''}" data-pos="${pos}">
      <span class="gk-mark" aria-hidden="true">${pos + 1}</span>
      <span class="party-rank-name">${esc(items[itemIdx])}</span>
      <span class="party-actions">
        <button type="button" class="btn ghost" data-up="${pos}" aria-label="${pos === 0 ? `${esc(items[itemIdx])} is already first` : `Move ${esc(items[itemIdx])} up to rank ${pos}`}" ${pos === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn ghost" data-dn="${pos}" aria-label="${pos === rankOrder.length - 1 ? `${esc(items[itemIdx])} is already last` : `Move ${esc(items[itemIdx])} down to rank ${pos + 2}`}" ${pos === rankOrder.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
    </li>`).join('');
  const feedback = !submitted
    ? 'Put your favourite first, then lock your ranking.'
    : dirty
      ? 'Changes ready. Update your ranking to save them.'
      : 'Locked in. You can still change it until the reveal.';
  el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--rank" aria-label="Rank the items">
    ${hud(S)}
    <p class="gk-prompt party-prompt">${esc(S.set.topic)}</p>
    <p class="gk-wait${submitted && !dirty ? ' is-done' : ''} js-feedback" role="status">${esc(feedback)}</p>
    <ol class="party-rank-list" aria-label="Your ranking, best to worst">${rows}</ol>
    <div class="gk-actions is-center"><button type="button" class="gk-btn gk-primary" id="rLock">${submitted ? 'Update ranking' : 'Lock ranking'}</button></div>
  </section>`;
  const relayout = (pos, dir) => {
    if (activeKey !== rankKey || !rankState || rankState.preparing || watching(rankState) || el.querySelector('.party-rank-list') !== list) return;
    const nextOrder = move(rankOrder, pos, dir);
    // A boundary arrow is a no-op; keep the focused button and ladder intact.
    if (nextOrder === rankOrder) return;
    rankOrder = nextOrder;
    buildRank(el, rankState || S, rankApi, pos + dir);
  };
  el.querySelectorAll('[data-up]').forEach((b) => {
    b.onclick = () => relayout(Number(b.dataset.up), -1);
  });
  el.querySelectorAll('[data-dn]').forEach((b) => {
    b.onclick = () => relayout(Number(b.dataset.dn), 1);
  });
  /* Keyboard reorder: arrows move the item that holds focus, matching tap. */
  const list = el.querySelector('.party-rank-list');
  if (list) {
    list.onkeydown = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const item = e.target && e.target.closest ? e.target.closest('[data-pos]') : null;
      if (!item) return;
      e.preventDefault();
      relayout(Number(item.dataset.pos), e.key === 'ArrowUp' ? -1 : 1);
    };
  }
  const lock = el.querySelector('#rLock');
  lock.onclick = () => { if (activeKey === rankKey && rankState && !rankState.preparing && !watching(rankState) && rankState.phase === 'rank' && el.querySelector('#rLock') === lock) rankApi?.send({ order: rankOrder }); };
  if (focusPos !== null && focusPos !== undefined) {
    const item = el.querySelector(`[data-pos="${focusPos}"]`);
    const btn = item ? (item.querySelector('[data-up]:not([disabled])') || item.querySelector('[data-dn]:not([disabled])')) : null;
    if (btn) {
      try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
    }
  }
}

function watchRank(S) {
  const rows = S.set.items.map((t, i) => `
    <li class="party-rank-item"><span class="gk-mark" aria-hidden="true">${String.fromCharCode(65 + i)}</span><span>${esc(t)}</span></li>`).join('');
  const waiting = Math.max(0, (S.players || []).length - (S.ranked || []).length);
  return `<section class="party-scene gk-col gk-stack party-scene--rank" aria-label="Ranking round">
    ${hud(S)}
    <p class="gk-prompt party-prompt">${esc(S.set.topic)}</p>
    <p class="gk-wait" role="status">Watching · waiting for ${plural(waiting, 'player')}. Every ladder stays secret until the reveal.</p>
    <ol class="party-rank-list" aria-label="Items to rank">${rows}</ol>
  </section>`;
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { rankKey = ''; paintFinal(el, { scene: 'rank-it', scores: S.scores || {}, players: S.players || [], you: watching(S) ? null : S.me, watching: watching(S) }); return; }
    rankApi = api;
    const liveHud = el.querySelector ? el.querySelector('.party-hud') : null;
    if (liveHud) liveHud.outerHTML = hud(S);
    rankState = S;
    if (S.phase === 'reveal' && S.last) {
      rankKey = 'reveal:' + S.round;
      // Items with equal points share a place (4, 4), as the scoring does.
      const place = [];
      S.last.consensus.forEach((itemIdx, pos) => {
        place[pos] = pos && S.last.borda[itemIdx] === S.last.borda[S.last.consensus[pos - 1]] ? place[pos - 1] : pos + 1;
      });
      const con = S.last.consensus.map((itemIdx, pos) =>
        `<li class="party-rank-item"><span class="gk-mark" aria-hidden="true">${place[pos]}</span><span class="party-rank-name">${esc(S.last.items[itemIdx])}</span><span class="gk-meta">${plural(S.last.borda[itemIdx], 'pt')}</span></li>`).join('');
      const rankers = (S.players || []).filter((p) => S.last.pts && S.last.pts[p.id] !== undefined);
      const rows = rankRows(S.last.pts, rankers, watching(S) ? null : S.me);
      const closest = new Set(S.last.closest || []);
      const fmt = (d) => Number.isInteger(d) ? String(d) : d.toFixed(1);
      const board = rows.length
        ? rowsHtml(rows, { prefix: '+', note: (r) => `<small class="rank-note">${closest.has(r.id) ? 'Closest · ' : ''}off by ${fmt(S.last.dist[r.id])}</small>` })
        : '<p class="gk-wait is-done">Nobody ranked this round.</p>';
      const mine = S.last.dist && S.last.dist[S.me] !== undefined
        ? `You were off by ${fmt(S.last.dist[S.me])} · +${S.last.pts[S.me] || 0} points.` : watching(S) ? 'Here is the room\'s ranking.' : 'You sat this one out.';
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--rank" aria-label="Room ranking">
        ${hud(S)}
        <p class="gk-prompt party-prompt">${esc(S.last.topic)}</p>
        <p class="gk-wait is-done" role="status">${esc(mine)}</p>
        <div class="rank-reveal">
          <div><p class="party-label">${esc((S.labels && S.labels.consensus) || 'The room\'s ranking')}</p>
          <ol class="party-rank-list" aria-label="Room ranking">${con}</ol></div>
          <div><p class="party-label">Round points</p>${board}</div>
        </div>
        <div class="gk-actions is-center rank-actions">${!watching(S) && S.me === S.hostId ? `<button type="button" class="gk-btn gk-primary" id="rNext">Next</button>` : ''}</div>
      </section>`;
      const nx = el.querySelector('#rNext');
      if (nx) nx.onclick = () => {
        if (rankState?.phase === 'reveal' && !rankState.preparing && !watching(rankState) && rankState.me === rankState.hostId && el.querySelector('#rNext') === nx) rankApi?.send({ next: true });
      };
      return;
    }
    // Rank phase: local ladder persists across broadcasts; adopts the locked
    // ranking when the round (re)opens.
    if (watching(S)) {
      rankKey = 'rank:watch:' + S.round;
      el.innerHTML = watchRank(S);
      return;
    }
    const k = `rank:${S.instanceId || ''}:${S.me}:${S.round}`;
    if (k !== rankKey) {
      rankKey = k;
      rankOrder = S.myRank ? S.myRank.slice() : [0, 1, 2, 3, 4];
    } else {
      /* Live count tick without touching the ladder mid-drag. */
      const lock = document.getElementById('rLock');
      if (lock) lock.textContent = S.myRank ? 'Update ranking' : 'Lock ranking';
      const fb = el.querySelector('.js-feedback');
      if (fb) {
        const submitted = !!S.myRank;
        const dirty = submitted && !sameOrder(rankOrder, S.myRank);
        fb.textContent = !submitted
          ? 'Put your favourite first, then lock your ranking.'
          : dirty
            ? 'Changes ready. Update your ranking to save them.'
            : 'Locked in. You can still change it until the reveal.';
        fb.classList.toggle('is-done', submitted && !dirty);
      }
      return;
    }
    buildRank(el, S, api, null);
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; rankApi = null; rankKey = ''; rankState = null; rankOrder = [0, 1, 2, 3, 4]; },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};
