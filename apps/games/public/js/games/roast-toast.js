/* Roast Toast view: friendly roasts for the round's target, an anonymous
 * ballot for the room favorite, the target's crown, then the reveal. Built on the game kit
 * (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/roast-toast.css';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let screenKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

/* Flat vote-share bar for reveal cards (share of all votes, 0–100%). */
function shareBar(n, total) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<span class="pb-share" role="img" aria-label="${n} of ${total} votes"><span style="width:${pct}%"></span></span>`;
}

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function activeCount(S) {
  return (S.players || []).filter((p) => !p.left).length;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function voterCount(S) {
  return S.eligibleVoters ?? Math.max(0, activeCount(S) - 1);
}

function hud(S) {
  const progress = S.phase === 'write' ? progressText((S.submitted || []).length, Math.max(0, activeCount(S) - 1), 'written')
    : S.phase === 'vote' ? progressText((S.voted || []).length, voterCount(S), 'voted') : '';
  const phase = { write: 'Write', vote: 'Vote', reveal: 'Reveal', done: 'Game over' }[S.phase] || '';
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner) {
  return `<section class="gk-col gk-stack rt-scene" data-scene="roast-toast" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  const left = S.phase === 'write'
    ? Math.max(0, activeCount(S) - 1 - (S.submitted || []).length)
    : Math.max(0, voterCount(S) - (S.voted || []).length);
  if (S.phase === 'vote' && S.picked === false) {
    const who = nameOf(S, S.target);
    return waitingHtml(left ? `Waiting for ${left} ${left === 1 ? 'vote' : 'votes'} and ${who}'s crown` : `Waiting for ${who}'s crown`);
  }
  return waitingHtml(left, { done: !left });
}

function inputRow({ id, label, placeholder, max, btnId, button }) {
  return `<form class="gk-input-row" data-gk-input autocomplete="off">`
    + `<input class="gk-input" id="${id}" type="text" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" enterkeyhint="send">`
    + `<button class="gk-btn gk-primary" type="submit" id="${btnId}">${esc(button)}</button></form>`;
}

function revealHtml(S, watch) {
  const L = S.last;
  const pts = L.points || {};
  const counts = {};
  for (const pid of Object.keys(L.votes || {})) counts[L.votes[pid]] = (counts[L.votes[pid]] || 0) + 1;
  const faves = L.roomFave || [];
  const names = faves.map((pid) => nameOf(S, pid));
  const target = nameOf(S, L.target);
  const line = (!faves.length ? 'No room votes' : names.length > 1 ? `Room favorite: it's a tie: ${joinNames(names)}` : `Room favorite: ${names[0]}`)
    + (L.pick ? ` · ${target}'s crown: ${nameOf(S, L.pick)}` : '');
  const authors = Object.keys(L.entries || {}).sort((a, b) => (pts[b] || 0) - (pts[a] || 0) || (counts[b] || 0) - (counts[a] || 0));
  const total = Object.keys(L.votes || {}).length;
  const cards = authors.map((author, i) => {
    const n = counts[author] || 0;
    const tags = [faves.includes(author) && 'room favorite', L.pick === author && `${target}'s crown`].filter(Boolean);
    const meta = `${esc(nameOf(S, author))}${!watch && author === S.me ? ' (you)' : ''} · ${n} vote${n === 1 ? '' : 's'}`
      + (tags.length ? ` · ${esc(tags.join(' + '))}` : '') + (pts[author] ? ` · +${pts[author]}` : '');
    return `<li class="gk-choice${tags.length ? ' is-correct' : ''}"><span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span>`
      + `<div class="gk-choice-text"><div>${esc(L.entries[author])}</div><div class="gk-meta">${meta}</div>${shareBar(n, total)}</div></li>`;
  }).join('');
  const canNext = !watch && (S.me === S.hostId || S.me === L.target);
  return scene(S, 'Roast reveal', `<h2 class="gk-prompt">Roasts for ${esc(target)}</h2>`
    + `<p class="gk-sub rt-winner">${esc(line)}</p>`
    + `<div class="gk-actions is-center rt-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="rtNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
    + `</div>`
    + `<ol class="gk-choices rt-list" style="--gk-cols:1;--gk-cols-phone:1">${cards}</ol>`);
}

function voteHtml(S, watch) {
  const isTarget = !watch && S.me === S.target;
  const done = isTarget ? S.myPick !== null && S.myPick !== undefined : S.myVote !== null && S.myVote !== undefined;
  const cards = (S.ballot || []).map((b, i) => {
    const mine = !watch && !isTarget && S.myEntry === b.i;
    const picked = !watch && (isTarget ? S.myPick === b.i : !mine && S.myVote === b.i);
    const off = watch || mine || done;
    return `<button type="button" class="gk-choice${picked ? ' is-selected' : ''}${mine ? ' is-dim' : ''}" ${isTarget ? 'data-p' : 'data-v'}="${b.i}" aria-pressed="${picked}"${off ? ' disabled' : ''}>`
      + `<span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span><span class="gk-choice-text">${esc(b.text)}${mine ? ' <small class="gk-meta">(yours)</small>' : ''}</span></button>`;
  }).join('');
  const onlyMine = !watch && !isTarget && (S.ballot || []).every((b) => b.i === S.myEntry);
  const who = nameOf(S, S.target);
  const sub = watch ? `You are watching. The players vote and ${who} crowns a favorite.`
    : isTarget ? (done ? 'Crowned. Its writer earns 100.' : 'Crown your favorite roast. Its writer earns 100.')
      : done ? 'Locked in. Your vote is secret.'
        : onlyMine ? 'Yours is the only roast. The others are voting.'
          : 'Vote for the funniest roast. Not your own. The room favorite earns 100.';
  return scene(S, 'Vote the roast', `<h2 class="gk-prompt">${isTarget ? 'Which roast wins your crown?' : `The best roast of ${esc(who)}`}</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-choices${done ? ' is-locked' : ''}" role="group" aria-label="${isTarget ? 'Crown a roast' : 'Anonymous roasts'}" style="--gk-cols:1;--gk-cols-phone:1">${cards}</div>`
    + `<div class="rt-foot" data-live="wait">${done || watch || onlyMine ? waitLine(S) : ''}</div>`);
}

function writeHtml(S, watch) {
  const who = nameOf(S, S.target);
  let body;
  if (watch) {
    body = `<p class="gk-sub">You are watching. The players are writing friendly roasts for ${esc(who)}.</p>`
      + `<div class="rt-foot" data-live="wait">${waitLine(S)}</div>`;
  } else if (S.me === S.target) {
    body = `<p class="gk-sub">This round is about you. The others are writing friendly roasts. You crown a favorite.</p>`
      + `<div class="rt-foot" data-live="wait">${waitLine(S)}</div>`;
  } else if (S.myEntry) {
    body = `<div class="gk-card rt-mine"><span class="gk-meta">Locked in</span><p>${esc(S.myEntry)}</p></div>`
      + `<div class="rt-foot" data-live="wait">${waitLine(S)}</div>`;
  } else {
    body = `<p class="gk-sub">${esc(S.tagline || 'Roast the habit, love the human.')} One line about ${esc(who)}, finishing the starter.</p>`
      + inputRow({ id: 'rtEntry', label: `Your roast of ${who}`, placeholder: 'Keep it friendly…', max: 140, btnId: 'rtSend', button: 'Send' })
      + `<div class="rt-foot" data-live="wait"></div>`;
  }
  return scene(S, 'Write a roast', `<p class="gk-meta rt-target">Roasting ${esc(who)}</p><h2 class="gk-prompt">${esc(S.starter || '')}</h2>${body}`);
}

export default {
  styles: [CSS],
  ownsTimer: true,
  dispose() { stopHudTimer(liveTimerEl); liveTimerEl = null; screenKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

function paint(el, S, api) {
    ensureStylesheet('roast-toast-css', CSS);
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.target, S.hostId, !!S.spectator, S.myEntry, S.myVote, S.myPick]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatching(S);

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, watch, S.round, S.hostId, S.last])
        : JSON.stringify([S.phase, S.instanceId, S.me, watch, S.round, S.endsAt, S.target, S.starter, S.myEntry ? 1 : 0, S.myVote, S.myPick, S.phase === 'vote' ? [S.ballot, S.myEntry] : null]);
    if (key === screenKey && el.querySelector?.('[data-scene="roast-toast"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'roast-toast', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector('#rtNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }
    if (S.phase === 'vote' && S.ballot) {
      el.innerHTML = voteHtml(S, watch);
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction({ vote: Number(b.dataset.v) }); };
      });
      el.querySelectorAll('[data-p]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction({ pick: Number(b.dataset.p) }); };
      });
      return;
    }
    el.innerHTML = writeHtml(S, watch);
    const inp = el.querySelector('#rtEntry');
    if (!inp) return;
    const send = () => {
      if (!canAct()) return;
      if (inp.value && inp.value.trim().length >= 2) sendAction({ entry: inp.value });
    };
    const form = el.querySelector('[data-gk-input]');
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    el.querySelector('#rtSend').onclick = (e) => { e?.preventDefault?.(); send(); };
    inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault?.();
      send();
    };
}
