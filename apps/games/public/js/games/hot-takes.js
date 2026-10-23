/* Hot Takes: write a take, vote agree/disagree with the author hidden;
 * each round the most divisive take scores. Built on the game kit
 * (public/css/game-ui.css): HUD row, prompt, choices, waiting line, round
 * results, Next, final scores. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

let visualKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function hud(S) {
  const n = (S.players || []).length;
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const rounds = S.rounds || 1;
  const round = Math.max(1, Math.min(S.round || 1, rounds));
  const take = Math.min((S.index || 0) + 1, S.total || 1);
  const phase = S.phase === 'done' ? 'Final scores' : S.phase === 'standings' ? 'Round results'
    : S.phase === 'submit' ? 'Write' : S.phase === 'reveal' ? `Take ${take} of ${S.total || 1} · Results` : `Take ${take} of ${S.total || 1}`;
  const votes = (S.voted || []).length;
  const voters = Math.max(0, n - 1);
  const progress = S.phase === 'submit' ? `${(S.submitted || []).length} of ${n} takes in` : S.phase === 'vote' ? `${votes} of ${voters} locked in` : '';
  return `<header class="gk-hud party-hud" data-phase="${esc(S.phase)}" aria-label="Take and play status">`
    + `<span class="gk-hud-round party-round">Round ${round} of ${rounds}</span>`
    + `<span class="gk-hud-phase party-phase">${esc(phase)}</span>`
    + (watch ? '<span class="party-spectator">Watching</span>' : '')
    + `<span class="gk-hud-progress party-progress">${esc(progress)}</span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span>`
    + `</header>`;
}

/* Round points (the match's Final scores come from the kit). */
function rankRows(scores, players, you) {
  const rows = (players || []).map((p) => ({ id: p.id, name: p.name || '?', points: Number(scores?.[p.id]) || 0, you: p.id === you, left: !!p.left }));
  rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i && r.points === rows[i - 1].points ? rows[i - 1].rank : i + 1; });
  return rows;
}
function roundPointsHtml(S, you, { title, prefix = '', scores }) {
  const rows = rankRows(scores, S.players, you);
  return `<section class="gk-results" aria-label="${esc(title)}">`
    + `<h2 class="gk-results-title">${esc(title)}</h2>`
    + `<ol class="gk-ranks party-scoreboard" aria-label="Round points">${rows.map((r) => {
      const isTop = r.rank === 1 && r.points > 0;
      return `<li class="gk-rank-row party-score${isTop ? ' is-top party-score--top' : ''}${r.you ? ' is-you' : ''}${r.left ? ' is-left' : ''}">`
        + `<span class="gk-rank party-rank-num" aria-label="Rank ${r.rank}">${r.rank}</span>`
        + `<span class="gk-name">${esc(r.name)}${r.you ? ' <small>(you)</small>' : ''}</span><b class="gk-pts">${prefix}${r.points}</b></li>`;
    }).join('')}</ol></section>`;
}

/* "Most divisive take: Ann" / a tie names everyone tied. */
function divisiveLine(S) {
  const winners = (S.results || []).filter((r) => (S.winners || []).includes(r.tid));
  const names = winners.map((r) => r.author ? nameOf(S, r.author) : 'the house').join(', ').replace(/, ([^,]*)$/, ' and $1');
  return !winners.length ? 'No take split the room this round.'
    : winners.length > 1 ? `It's a tie for the most divisive take: ${names}` : `Most divisive take: ${names}`;
}

/* This round's takes, most divisive first; tied takes share the place. */
function takeRows(S) {
  const winners = new Set(S.winners || []);
  const runners = new Set(S.runnersUp || []);
  const sorted = [...(S.results || [])].sort((a, b) =>
    (Math.min(b.agree.length, b.disagree.length) - Math.min(a.agree.length, a.disagree.length))
    || ((b.agree.length + b.disagree.length) - (a.agree.length + a.disagree.length)));
  return sorted.map((r) => {
    const div = Math.min(r.agree.length, r.disagree.length);
    const win = winners.has(r.tid);
    const total = r.agree.length + r.disagree.length;
    const pct = total ? r.agree.length / total * 100 : 0;
    const tag = win ? (winners.size > 1 ? 'Tied most divisive' : 'Most divisive') : runners.has(r.tid) ? 'Runner-up' : '';
    return `<div class="party-result hot-take-row${win ? ' party-result--winner' : ''}">`
      + (tag ? `<div class="gk-meta hot-tag">${esc(tag)}</div>` : '')
      + `<div class="party-result-body">${esc(r.text)}</div>`
      + `<div class="hot-split-track" role="img" aria-label="${r.agree.length} agree, ${r.disagree.length} disagree"><span style="width:${pct}%"></span><span style="width:${total ? 100 - pct : 0}%"></span></div>`
      + `<p class="party-meta">by ${r.author ? esc(nameOf(S, r.author)) : 'the house'} · ${r.agree.length} agree, ${r.disagree.length} disagree · ${div} on the smaller side</p></div>`;
  }).join('');
}

let submitKey = null; // stable composer key for the current submit window

function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
}

function isWatch(S) {
  if (S && S.spectator) return true;
  const ids = (S.players || []).map((p) => p.id);
  return !!S.me && ids.length > 0 && !ids.includes(S.me);
}

function splitRows(S, r, agreeLabel, disLabel) {
  const all = r.agree.length + r.disagree.length;
  const pct = all ? r.agree.length / all * 100 : 0;
  const side = (label, voters) => `<div class="hot-split-side"><b>${esc(label)} ${voters.length}</b><p class="party-meta">${voters.map(pid => esc(nameOf(S, pid))).join(', ') || 'No votes'}</p></div>`;
  return `<div class="hot-room-split"><div class="hot-split-track" role="img" aria-label="${r.agree.length} agree, ${r.disagree.length} disagree"><span style="width:${pct}%"></span><span style="width:${all ? 100 - pct : 0}%"></span></div><div class="hot-split-labels">${side(agreeLabel, r.agree)}${side(disLabel, r.disagree)}</div><p class="party-meta">${Math.min(r.agree.length, r.disagree.length)} on the smaller side · a closer split makes a hotter take.</p></div>`;
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { visualKey = ''; submitKey = null; paintFinal(el, { scene: 'hot-takes', scores: S.scores || {}, players: S.players || [], you: isWatch(S) ? null : S.me, watching: isWatch(S), note: divisiveLine(S) }); return; }
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.index, S.endsAt, S.target, S.subject, S.victim, S.turn, S.hostId, !!S.spectator, !!S.current?.mine, S.myEntry, S.myOption, S.myLines, S.myVote, S.myPick]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator && (liveState.players || []).some(p => p.id === liveState.me);
    const sendAction = action => canAct() ? liveApi?.send(action) : false;
    const liveHud = el.querySelector ? el.querySelector('.party-hud') : null;
    if (liveHud) liveHud.outerHTML = hud(S);
    if (['vote', 'pick', 'verdict', 'reveal', 'done'].includes(S.phase)) {
      const key = JSON.stringify({ ...S, audioBaseline: undefined, voted: undefined, answered: undefined, submitted: undefined,
        picked: Array.isArray(S.picked) ? undefined : S.picked });
      if (visualKey === key && el.querySelector?.('.party-scene')) return;
      visualKey = key;
    } else visualKey = '';

    const watch = isWatch(S);
    const agreeLabel = (S.labels && S.labels.agree) || 'Agree';
    const disLabel = (S.labels && S.labels.disagree) || 'Disagree';

    if (S.phase === 'standings') {
      submitKey = null;
      const you = watch ? null : S.me;
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--hot" aria-label="Hot takes round results">`
        + `${hud(S)}`
        + `<h3 class="gk-prompt party-prompt">Round ${S.round} results</h3>`
        + `<p class="gk-wait is-done" role="status">${esc(divisiveLine(S))}</p>`
        + roundPointsHtml(S, you, { title: 'Points this round', prefix: '+', scores: S.roundPts || {} })
        + `<div class="party-reveals">${takeRows(S)}</div>`
        + `<div class="gk-actions is-center hot-actions">${!watch && S.me === S.hostId ? '<button type="button" class="gk-btn gk-primary" id="hNext">Next</button>' : ''}</div>`
        + `<details class="party-more"><summary>Scoring</summary><p class="party-meta">Each round the most divisive take (closest to a 50/50 split) scores 100 for its author, the next most divisive 50, and every take gets 5 per vote (up to +100). Equal splits share the place.</p></details>`
        + `</section>`;
      const nx = el.querySelector('#hNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    if (S.phase !== 'submit') {
      submitKey = null;
    }

    if (S.phase === 'submit') {
      const starter = (S.starters && S.starters.length)
        ? S.starters[(S.submitted ? S.submitted.length : 0) % S.starters.length]
        : '';
      const n = S.submitted ? S.submitted.length : 0;
      if (watch) {
        submitKey = null;
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--hot" aria-label="Hot takes submission">`
          + `${hud(S)}`
          + `<h3 class="gk-prompt party-prompt">Takes are being written…</h3>`
          + `<p class="gk-wait" role="status">Watching · ${plural((S.submitted || []).length, 'take')} in so far.</p>`
          + `</section>`;
        return;
      }
      /* Same submit window: keep the live input node so focus, selection
       * and phone IME composition survive every snapshot. Only the
       * counts, acknowledgement and button label update in place. */
      const key = `ht-submit:${S.instanceId || ''}:${S.me || ''}:${S.endsAt || ''}`;
      const live = el.querySelector ? el.querySelector('#hTake') : null;
      const liveBtn = el.querySelector ? el.querySelector('#hSend') : null;
      if (submitKey === key && live && liveBtn) {
        const status = el.querySelector('.hot-sub');
        if (status) status.textContent = S.myTake ? 'Your take is in. You can edit it until voting starts.' : 'Spicy but friendly. Authors stay hidden until the reveal.';
        let lock = el.querySelector('.party-lock');
        if (S.myTake) {
          if (!lock) {
            lock = document.createElement('p');
            lock.className = 'party-lock';
            const compose = el.querySelector('.party-compose');
            if (compose) compose.parentNode.insertBefore(lock, compose);
            else el.querySelector('section').appendChild(lock);
          }
          const want = `“${S.myTake}”`;
          if (lock.textContent !== want) lock.textContent = want;
        } else if (lock) {
          lock.remove();
        }
        liveBtn.textContent = S.myTake ? 'Update' : 'Send';
        if (live.getAttribute('enterkeyhint') !== 'send') live.setAttribute('enterkeyhint', 'send');
        const sendTake = () => {
      if (!canAct()) return;
          const inp = el.querySelector('#hTake');
          if (inp && inp.value.trim()) sendAction({ take: inp.value.trim() });
        };
        liveBtn.onclick = sendTake;
        live.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) sendTake(); };
        return;
      }
      /* New window (player/role/remount): clear any prior draft so a
       * watcher never inherits a sendable composer. */
      submitKey = key;
      const shown = S.myTake || '';
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--hot" aria-label="Hot takes submission">`
        + `${hud(S)}`
        + `<h3 class="gk-prompt party-prompt">Drop your hot take</h3>`
        + `<p class="gk-sub hot-sub">${S.myTake ? 'Your take is in. You can edit it until voting starts.' : 'Spicy but friendly. Authors stay hidden until the reveal.'}</p>`
        + (S.myTake ? `<p class="party-lock">“${esc(S.myTake)}”</p>` : '')
        + `<div class="party-compose"><div class="party-field">`
        + `<label for="hTake">Your take</label>`
        + `<div class="gk-input-row"><input id="hTake" class="gk-input" type="text" placeholder="Your spiciest (friendly) opinion…" maxlength="140" autocomplete="off" enterkeyhint="send" value="${esc(shown)}">`
        + `<button type="button" class="gk-btn gk-primary" id="hSend">${S.myTake ? 'Update' : 'Send'}</button></div></div>`
        + (starter ? `<p class="party-meta hot-starter">Need an idea? ${esc(starter)}</p>` : '')
        + `</div>`
        + `</section>`;
      const sendTake = () => {
      if (!canAct()) return;
        const inp = el.querySelector('#hTake');
        if (inp && inp.value.trim()) sendAction({ take: inp.value.trim() });
      };
      el.querySelector('#hSend').onclick = sendTake;
      el.querySelector('#hTake').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) sendTake(); };
      return;
    }

    const idx = (S.index || 0) + 1;
    const total = S.total || '?';
    if (S.phase === 'reveal' && S.current) {
      const r = (S.results || []).find((x) => x.tid === S.current.tid) || { agree: [], disagree: [] };
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--hot" aria-label="Hot take reveal">`
        + `${hud(S)}`
        + `<h3 class="gk-prompt party-prompt">“${esc(S.current.text)}”</h3>`
        + `<p class="gk-wait is-done" role="status">by ${S.current.author ? esc(nameOf(S, S.current.author)) : 'the house'}</p>`
        + `${splitRows(S, r, agreeLabel, disLabel)}`
        + `<div class="gk-actions is-center hot-actions">${!isWatch(S) && S.me === S.hostId ? '<button type="button" class="gk-btn gk-primary" id="hNext">Next</button>' : ''}</div>`
        + `</section>`;
      const nx = el.querySelector('#hNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    /* Vote: the author stays hidden — only the reveal may show them. */
    const mine = S.current && S.current.mine;
    const picked = S.myVote;
    const inCount = S.voted ? S.voted.length : 0;
    const voters = Math.max(0, (S.players || []).length - 1);
    const waiting = Math.max(0, voters - inCount);
    el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--hot" aria-label="Hot take vote">`
      + `${hud(S)}`
      + `<h3 class="gk-prompt party-prompt">“${esc(S.current ? S.current.text : '')}”</h3>`
      + `<p class="gk-wait" role="status">${esc(watch ? 'Watching · the players are judging this take.'
        : mine ? 'This one is yours, so you sit this vote out.'
        : picked ? `Locked in · waiting for ${plural(waiting, 'player')}` : 'Agree or disagree? The author stays hidden until the reveal.')}</p>`
      + `<div class="gk-choices hot-choices${picked ? ' is-locked' : ''}" role="group" aria-label="Your vote" style="--gk-cols:2;--gk-cols-phone:2">`
      + [['agree', agreeLabel], ['disagree', disLabel]].map(([v, label], i) =>
        `<button type="button" class="gk-choice hot-choice${picked === v ? ' is-selected is-picked' : ''}" data-v="${v}" aria-pressed="${picked === v}"${picked || mine || watch ? ' disabled' : ''}>`
        + `<span class="gk-mark" aria-hidden="true">${i ? 'B' : 'A'}</span><span class="gk-choice-text">${esc(label)}</span></button>`).join('')
      + `</div>`
      + `</section>`;
    if (!watch) {
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => sendAction({ vote: b.dataset.v });
      });
    }
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; visualKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; submitKey = null; },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};
