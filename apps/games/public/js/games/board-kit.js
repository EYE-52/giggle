/* Board kit: the one side panel every Game Night board game uses.
 *
 * Players (colour, whose turn, clock, captures/score), the status line,
 * the move timer, the game's own extras, then Resign / Offer draw (with
 * Accept draw / Decline and a resign confirmation in the same space), help
 * and the final screen (winner or "It's a tie", ranked list, Rematch /
 * Change game). Stateless apart from the move-timer tick: each game keeps
 * its own flags and repaints the panel from a plain model.
 *
 * No imports and only bk-prefixed top-level names, so view tests can inline
 * this file next to a game module. DOM use stays basic (innerHTML,
 * querySelector, textContent, attributes, classList.toggle). */

const BK_CSS_ID = 'board-kit-css';
const BK_CSS_HREF = '/css/board-duels.css';

function bkEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* Load the shared board stylesheet (kept across board games). */
export function bkEnsureCss() {
  if (typeof document === 'undefined' || !document.head || document.getElementById(BK_CSS_ID)) return;
  const link = document.createElement('link');
  link.id = BK_CSS_ID; link.rel = 'stylesheet'; link.href = BK_CSS_HREF;
  document.head.appendChild(link);
}

export function bkRemoveCss() {
  if (typeof document === 'undefined') return;
  document.getElementById(BK_CSS_ID)?.remove();
}

const BK_FLIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8A8 8 0 1 0 20 16M20 3v5h-5"/></svg>';

/* Panel markup. `extra` is the game's own block (die, captures, harbour
 * switch…); `help` is plain text paragraphs; `flip` adds a Flip board
 * button; `draw` adds Offer draw (2-player games except Fleet Duel). */
export function bkPanelHTML({ title, help = [], extra = '', flip = false, draw = true, resign = true, resignLabel = 'Resign' }) {
  const helpText = (Array.isArray(help) ? help : [help]).map((p) => `<p>${bkEsc(p)}</p>`).join('');
  return `<aside class="bk-panel" aria-label="${bkEsc(title)} players and actions">
    <header class="bk-head"><h1 class="bk-title">${bkEsc(title)}</h1><p class="bk-meta"></p></header>
    <ol class="bk-players" aria-label="Players"></ol>
    <div class="bk-status" role="status" aria-live="polite"><span class="bk-status-text"></span><small class="bk-hint"></small></div>
    <div class="bk-timer" hidden><span class="bk-timer-label">Move timer</span><b class="bk-timer-value">0:00</b><span class="bk-timer-track" aria-hidden="true"><i class="bk-timer-fill"></i></span></div>
    ${extra ? `<div class="bk-extra">${extra}</div>` : ''}
    <div class="bk-actions"${resign || draw ? '' : ' hidden'}>
      <div class="bk-row bk-row-play">${resign ? `<button type="button" class="bk-btn" data-resign>${bkEsc(resignLabel)}</button>` : ''}${draw ? '<button type="button" class="bk-btn" data-offer-draw>Offer draw</button>' : ''}</div>
      <div class="bk-row bk-row-confirm" hidden><span class="bk-ask">Resign this game?</span><button type="button" class="bk-btn bk-danger" data-confirm-resign>Resign</button><button type="button" class="bk-btn" data-keep>Cancel</button></div>
      <div class="bk-row bk-row-offer" hidden><span class="bk-ask">Draw offered.</span><button type="button" class="bk-btn bk-primary" data-accept-draw>Accept draw</button><button type="button" class="bk-btn" data-decline-draw>Decline</button></div>
      <p class="bk-row bk-row-note" hidden></p>
    </div>
    <div class="bk-tools">${flip ? `<button type="button" class="bk-btn bk-quiet" data-flip data-watchok>${BK_FLIP_ICON}<span>Flip board</span></button>` : ''}<details class="bk-help" data-watchok><summary data-watchok>How to play</summary><div class="bk-help-body">${helpText}</div></details></div>
    <section class="bk-final" hidden aria-label="Final scores">
      <h2 class="bk-final-title">Final scores</h2>
      <p class="bk-winner"></p><p class="bk-reason"></p>
      <ol class="bk-ranks"></ol>
      <div class="bk-final-actions"><button type="button" class="bk-btn bk-primary" data-rematch id="bRematch">Rematch</button><button type="button" class="bk-btn" data-lobby id="bChange">Change game</button></div>
      <p class="bk-hostwait">Waiting for the host to start a rematch or pick another game</p>
    </section>
  </aside>`;
}

export function bkClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* Remaining move time in ms against the game clock (paused while the
 * room prepares a turn). */
function bkRemaining(t) {
  if (!t || !(t.endsAt > 0)) return 0;
  let now = Date.now();
  if (t.paused && Number.isFinite(t.gameNow)) now = t.gameNow;
  else {
    try { const v = typeof t.now === 'function' ? t.now() : NaN; if (Number.isFinite(v)) now = v; } catch { /* wall clock */ }
    now -= t.offset || 0;
  }
  return Math.max(0, t.endsAt - now);
}

function bkPaintTimer(panel) {
  const t = panel._bkTimer, box = panel.querySelector('.bk-timer');
  if (!box) return;
  const left = bkRemaining(t), total = t?.total || 1;
  box.querySelector('.bk-timer-value').textContent = t?.running ? bkClock(left) : bkClock(total);
  box.querySelector('.bk-timer-fill').setAttribute('style', `width:${t?.running ? Math.max(0, Math.min(100, left / total * 100)).toFixed(1) : 100}%`);
  box.classList.toggle('is-low', !!t?.running && left <= 10000);
  box.classList.toggle('is-idle', !t?.running);
}

function bkTick(panel, on) {
  if (on && !panel._bkTick && typeof setInterval === 'function') panel._bkTick = setInterval(() => bkPaintTimer(panel), 250);
  if (!on && panel._bkTick) { clearInterval(panel._bkTick); panel._bkTick = 0; }
}

export function bkDispose(root) {
  const panel = root?.querySelector?.('.bk-panel');
  if (panel) bkTick(panel, false);
}

/* Players row markup once per seat count; values are painted after. */
function bkPlayers(panel, players) {
  const list = panel.querySelector('.bk-players');
  if (list.getAttribute('data-count') !== String(players.length)) {
    list.setAttribute('data-count', String(players.length));
    list.innerHTML = players.map((_, i) => `<li class="bk-player" data-seat="${i}"><span class="bk-chip" aria-hidden="true"></span><span class="bk-who"><b class="bk-name"></b><small class="bk-side"><span class="bk-side-text"></span><span class="bk-turn-text"> · To move</span></small></span><span class="bk-stat"><b class="bk-stat-value"></b><small class="bk-stat-label"></small></span></li>`).join('');
  }
  players.forEach((p, i) => {
    const row = list.querySelector(`[data-seat="${i}"]`);
    row.classList.toggle('is-turn', !!p.turn);
    row.classList.toggle('is-you', !!p.you);
    row.classList.toggle('is-out', !!p.out);
    row.classList.toggle('has-clock', p.clock != null);
    row.classList.toggle('is-low', !!p.low);
    const chip = row.querySelector('.bk-chip');
    if (chip.getAttribute('data-chip') !== (p.chip || '')) { chip.setAttribute('data-chip', p.chip || ''); chip.innerHTML = p.chip || ''; }
    row.querySelector('.bk-name').textContent = p.name;
    row.querySelector('.bk-side-text').textContent = [p.side, p.you ? 'You' : '', p.out ? p.outLabel || 'Out' : ''].filter(Boolean).join(' · ');
    row.querySelector('.bk-turn-text').hidden = !p.turn;
    row.querySelector('.bk-stat-value').textContent = p.clock != null ? p.clock : p.stat ?? '';
    row.querySelector('.bk-stat-label').textContent = p.clock != null ? 'Clock' : p.statLabel || '';
    row.setAttribute('aria-label', `${p.name}${p.side ? ', ' + p.side : ''}${p.you ? ', you' : ''}${p.turn ? ', to move' : ''}${p.out ? ', out' : ''}${p.clock != null ? ', clock ' + p.clock : p.stat != null && p.stat !== '' ? ', ' + p.stat + ' ' + (p.statLabel || '') : ''}`);
  });
}

/* Final ranking: competition ranks (1, 1, 3) by points, best first. */
export function bkRank(entries) {
  const sorted = entries.slice().sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (a.order ?? 0) - (b.order ?? 0));
  let rank = 0;
  return sorted.map((e, i) => {
    if (!i || sorted[i - 1].points !== e.points) rank = i + 1;
    return { ...e, rank };
  });
}

/* Paint the whole panel from a model (see top of file). */
export function bkPaint(root, m) {
  const panel = root.querySelector('.bk-panel');
  if (!panel) return;
  panel.querySelector('.bk-meta').textContent = m.meta || '';
  panel.querySelector('.bk-meta').hidden = !m.meta;
  bkPlayers(panel, m.players || []);
  panel.querySelector('.bk-status-text').textContent = m.status || '';
  panel.querySelector('.bk-hint').textContent = m.hint || '';
  panel.querySelector('.bk-hint').hidden = !m.hint;

  const done = !!m.done;
  // Move timer: present for the whole game when on (no layout jumps).
  const timer = panel.querySelector('.bk-timer');
  timer.hidden = !m.timer || done;
  panel._bkTimer = m.timer && !done ? { ...m.timer } : null;
  if (panel._bkTimer) bkPaintTimer(panel);
  bkTick(panel, !!panel._bkTimer?.running);

  const actions = panel.querySelector('.bk-actions');
  const player = !!m.player && !done;
  actions.classList.toggle('is-done', done);
  const play = actions.querySelector('.bk-row-play'), confirm = actions.querySelector('.bk-row-confirm');
  const offer = actions.querySelector('.bk-row-offer'), note = actions.querySelector('.bk-row-note');
  const incoming = player && m.drawOffer === 'theirs' && !m.armed;
  confirm.hidden = !(player && m.armed);
  offer.hidden = !incoming;
  note.hidden = player || done;
  note.textContent = done ? '' : m.watchNote || 'You are watching.';
  play.hidden = !player || m.armed || incoming;
  actions.hidden = done || m.actions === false;
  const resign = play.querySelector('[data-resign]');
  if (resign) { resign.disabled = !!m.busy; resign.hidden = !player; }
  const draw = play.querySelector('[data-offer-draw]');
  if (draw) {
    draw.disabled = !!m.busy || m.drawOffer === 'mine' || !!m.drawBlocked;
    draw.textContent = m.drawOffer === 'mine' ? 'Draw offered' : 'Offer draw';
    draw.hidden = m.draw === false || !player;
  }
  for (const b of actions.querySelectorAll('[data-confirm-resign],[data-accept-draw],[data-decline-draw]')) b.disabled = !!m.busy;
  const flip = panel.querySelector('[data-flip]');
  if (flip) flip.disabled = !!m.flipBusy;

  const final = panel.querySelector('.bk-final');
  final.hidden = !m.final;
  panel.classList.toggle('is-final', !!m.final);
  if (m.final) {
    const f = m.final;
    final.querySelector('.bk-winner').textContent = f.headline || '';
    final.querySelector('.bk-reason').textContent = f.detail || '';
    final.querySelector('.bk-reason').hidden = !f.detail;
    const rows = f.rows || [];
    const html = rows.map((r) => `<li class="bk-rank-row${r.you ? ' is-you' : ''}${r.rank === 1 ? ' is-first' : ''}"><span class="bk-rank">${r.rank}</span><span class="bk-rank-name">${bkEsc(r.name)}${r.you ? ' <small>(you)</small>' : ''}</span>${r.note ? `<small class="bk-rank-note">${bkEsc(r.note)}</small>` : ''}<b class="bk-points">${r.points > 0 ? '+' : ''}${r.points ?? 0}</b></li>`).join('');
    const list = final.querySelector('.bk-ranks');
    if (list.getAttribute('data-html') !== html) { list.setAttribute('data-html', html); list.innerHTML = html; }
    // Like the shell's Rematch row: guests see only the waiting line.
    for (const b of final.querySelectorAll('[data-rematch],[data-lobby]')) { b.disabled = !f.isHost || !!f.roomPending; b.hidden = !f.isHost; }
    final.querySelector('.bk-hostwait').hidden = !!f.isHost;
  }
}

function bkHas(node, name) { return node.getAttribute(name) !== null; }

/* Delegated clicks for the panel. handlers: arm, keep, resign, offerDraw,
 * acceptDraw, declineDraw, flip, rematch, lobby. Returns true when the
 * click belonged to the panel. */
export function bkClick(e, handlers) {
  const b = e.target?.closest?.('[data-resign],[data-keep],[data-confirm-resign],[data-offer-draw],[data-accept-draw],[data-decline-draw],[data-flip],[data-rematch],[data-lobby]');
  if (!b || !b.closest('.bk-panel')) return false;
  if (b.disabled) return true;
  const call = (name) => { if (typeof handlers[name] === 'function') handlers[name](); };
  if (bkHas(b, 'data-resign')) call('arm');
  else if (bkHas(b, 'data-keep')) call('keep');
  else if (bkHas(b, 'data-confirm-resign')) call('resign');
  else if (bkHas(b, 'data-offer-draw')) call('offerDraw');
  else if (bkHas(b, 'data-accept-draw')) call('acceptDraw');
  else if (bkHas(b, 'data-decline-draw')) call('declineDraw');
  else if (bkHas(b, 'data-flip')) call('flip');
  else if (bkHas(b, 'data-rematch')) call('rematch');
  else if (bkHas(b, 'data-lobby')) call('lobby');
  return true;
}

/* Shared helpers for the model. */
export function bkDrawState(S, pid) {
  if (!S.drawOffer) return null;
  return S.drawOffer === pid ? 'mine' : 'theirs';
}

export function bkTimer(S, api) {
  if (!(S.moveTimerMs > 0)) return null;
  return {
    endsAt: S.endsAt, total: S.moveTimerMs, running: S.phase !== 'done' && S.endsAt > 0,
    now: api && typeof api.now === 'function' ? () => api.now() : null,
    offset: S.clockOffset || 0, paused: !!S.preparing, gameNow: S.gameNow,
  };
}

export function bkMeta(S, extra) {
  const parts = [];
  if (extra) parts.push(extra);
  if (S.moveTimerMs > 0) parts.push(`Move timer ${Math.round(S.moveTimerMs / 1000)} s`);
  return parts.join(' · ');
}

/* "Ann wins" / "It's a tie" plus the reason line. */
export function bkHeadline(names) {
  if (!names.length) return 'Game over';
  return names.length === 1 ? `${names[0]} wins` : 'It’s a tie';
}

export function bkReason(reason, loserName, winnerName) {
  return {
    resign: `${loserName} resigned.`,
    timeout: `${loserName} ran out of time.`,
    forfeit: `${loserName} left the game.`,
    agreement: 'Draw agreed.',
  }[reason] || '';
}

export function bkHost(api) {
  const ctx = (api && typeof api.context === 'function' && api.context()) || {};
  return { isHost: ctx.isHost === true, roomPending: ctx.roomActionPending === true };
}

/* Static panel: the same panel as one HTML string with every value filled
 * in, for views that repaint their whole scene from markup (Chess). Extra
 * hooks: cfg.statusClass, cfg.finalClass, cfg.flipId, player.statId,
 * cfg.timerId. */
export function bkPanelStatic(cfg, m) {
  const done = !!m.done, player = !!m.player && !done, final = m.final;
  const players = (m.players || []).map((p, i) => {
    const side = [p.side, p.you ? 'You' : '', p.out ? p.outLabel || 'Out' : ''].filter(Boolean).join(' · ');
    const cls = ['bk-player', p.turn ? 'is-turn' : '', p.you ? 'is-you' : '', p.out ? 'is-out' : '', p.low ? 'is-low' : ''].filter(Boolean).join(' ');
    const value = p.clock != null ? p.clock : p.stat ?? '';
    return `<li class="${cls}" data-seat="${i}"><span class="bk-chip" aria-hidden="true">${p.chip || ''}</span><span class="bk-who"><b class="bk-name">${bkEsc(p.name)}</b><small class="bk-side"><span class="bk-side-text">${bkEsc(side)}</span>${p.turn ? '<span class="bk-turn-text"> · To move</span>' : ''}</small></span><span class="bk-stat"><b class="bk-stat-value"${p.statId ? ` id="${p.statId}"` : ''}>${bkEsc(value)}</b><small class="bk-stat-label">${bkEsc(p.clock != null ? 'Clock' : p.statLabel || '')}</small></span></li>`;
  }).join('');
  const t = m.timer && !done ? m.timer : null;
  const left = t ? (t.running ? bkRemaining(t) : t.total) : 0;
  const timer = t ? `<div class="bk-timer${t.running && left <= 10000 ? ' is-low' : ''}${t.running ? '' : ' is-idle'}"${cfg.timerId ? ` id="${cfg.timerId}"` : ''}><span class="bk-timer-label">Move timer</span><b class="bk-timer-value">${bkClock(left)}</b><span class="bk-timer-track" aria-hidden="true"><i class="bk-timer-fill" style="width:${t.running ? Math.max(0, Math.min(100, left / t.total * 100)).toFixed(1) : 100}%"></i></span></div>` : '';
  const dis = m.busy ? ' disabled' : '';
  const incoming = player && m.drawOffer === 'theirs' && !m.armed;
  let row = '';
  if (!done && cfg.actions !== false) {
    if (!player) row = `<p class="bk-row bk-row-note">${bkEsc(m.watchNote || 'You are watching.')}</p>`;
    else if (m.armed) row = `<div class="bk-row bk-row-confirm"><span class="bk-ask">Resign this game?</span><button type="button" class="bk-btn bk-danger" data-confirm-resign id="bk-confirm-resign"${dis}>Resign</button><button type="button" class="bk-btn" data-keep id="bk-keep"${dis}>Cancel</button></div>`;
    else if (incoming) row = `<div class="bk-row bk-row-offer"><span class="bk-ask">Draw offered.</span><button type="button" class="bk-btn bk-primary" data-accept-draw${dis}>Accept draw</button><button type="button" class="bk-btn" data-decline-draw${dis}>Decline</button></div>`;
    else row = `<div class="bk-row bk-row-play"><button type="button" class="bk-btn" data-resign${cfg.resignId ? ` id="${cfg.resignId}"` : ''}${dis}>Resign</button>${cfg.draw === false ? '' : `<button type="button" class="bk-btn" data-offer-draw${m.busy || m.drawOffer === 'mine' || m.drawBlocked ? ' disabled' : ''}>${m.drawOffer === 'mine' ? 'Draw offered' : 'Offer draw'}</button>`}</div>`;
  }
  const helpText = (Array.isArray(cfg.help) ? cfg.help : [cfg.help || '']).filter(Boolean).map((p) => `<p>${bkEsc(p)}</p>`).join('');
  const ranks = final ? (final.rows || []).map((r) => `<li class="bk-rank-row${r.you ? ' is-you' : ''}${r.rank === 1 ? ' is-first' : ''}"><span class="bk-rank">${r.rank}</span><span class="bk-rank-name">${bkEsc(r.name)}${r.you ? ' <small>(you)</small>' : ''}</span>${r.note ? `<small class="bk-rank-note">${bkEsc(r.note)}</small>` : ''}<b class="bk-points">${r.points > 0 ? '+' : ''}${r.points ?? 0}</b></li>`).join('') : '';
  const fdis = final && (!final.isHost || final.roomPending) ? ' disabled' : '';
  return `<aside class="bk-panel${final ? ' is-final' : ''}" aria-label="${bkEsc(cfg.title)} players and actions">
    <header class="bk-head"><h1 class="bk-title">${bkEsc(cfg.title)}</h1>${m.meta ? `<p class="bk-meta">${bkEsc(m.meta)}</p>` : ''}</header>
    <ol class="bk-players" aria-label="Players">${players}</ol>
    <div class="bk-status ${cfg.statusClass || ''}" role="status"><span class="bk-status-text">${bkEsc(m.status || '')}</span>${m.hint ? `<small class="bk-hint">${bkEsc(m.hint)}</small>` : ''}</div>
    ${timer}
    ${cfg.extra ? `<div class="bk-extra">${cfg.extra}</div>` : ''}
    ${row ? `<div class="bk-actions">${row}</div>` : ''}
    <div class="bk-tools">${cfg.flip ? `<button type="button" class="bk-btn bk-quiet" data-flip data-watchok${cfg.flipId ? ` id="${cfg.flipId}"` : ''}${m.flipBusy ? ' disabled' : ''}>${BK_FLIP_ICON}<span>Flip board</span></button>` : ''}<details class="bk-help" data-watchok${cfg.helpOpen ? ' open' : ''}><summary data-watchok>How to play</summary><div class="bk-help-body">${helpText}</div></details></div>
    <section class="bk-final ${cfg.finalClass || ''}"${final ? '' : ' hidden'} aria-label="Final scores">${final ? `
      <h2 class="bk-final-title">Final scores</h2>
      <p class="bk-winner">${bkEsc(final.headline || '')}</p>${final.detail ? `<p class="bk-reason">${bkEsc(final.detail)}</p>` : ''}
      <ol class="bk-ranks">${ranks}</ol>
      <div class="bk-final-actions"><button type="button" class="bk-btn bk-primary" data-rematch id="bRematch"${fdis}${final.isHost ? '' : ' hidden'}>Rematch</button><button type="button" class="bk-btn" data-lobby id="bChange"${fdis}${final.isHost ? '' : ' hidden'}>Change game</button></div>
      ${final.isHost ? '' : '<p class="bk-hostwait">Waiting for the host to start a rematch or pick another game</p>'}` : ''}</section>
  </aside>`;
}

/* Live tick for a static panel's move timer (the view owns the interval). */
export function bkTickStatic(root, timer) {
  const box = root?.querySelector?.('.bk-timer');
  if (!box || !timer) return;
  const left = timer.running ? bkRemaining(timer) : timer.total;
  box.querySelector('.bk-timer-value').textContent = bkClock(left);
  box.querySelector('.bk-timer-fill')?.setAttribute('style', `width:${timer.running ? Math.max(0, Math.min(100, left / timer.total * 100)).toFixed(1) : 100}%`);
  box.classList.toggle('is-low', !!timer.running && left <= 10000);
}
