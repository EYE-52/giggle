/* Compliment Battle view: secret compliments for the round's target, an
 * anonymous ballot, then the reveal. Built on the game kit
 * (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/compliment-battle.css';

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
  return S.eligibleVoters ?? activeCount(S);
}

function hud(S) {
  const progress = S.phase === 'write' ? progressText((S.submitted || []).length, Math.max(0, activeCount(S) - 1), 'written')
    : S.phase === 'vote' ? progressText((S.voted || []).length, voterCount(S), 'voted') : '';
  const phase = { write: 'Write', vote: 'Vote', reveal: 'Reveal', done: 'Game over' }[S.phase] || '';
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner) {
  return `<section class="gk-col gk-stack cb-scene" data-scene="compliment-battle" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  const left = S.phase === 'write'
    ? Math.max(0, activeCount(S) - 1 - (S.submitted || []).length)
    : Math.max(0, voterCount(S) - (S.voted || []).length);
  return waitingHtml(left, { done: !left });
}

function inputRow({ id, label, placeholder, max, btnId, button }) {
  return `<form class="gk-input-row" data-gk-input autocomplete="off">`
    + `<input class="gk-input" id="${id}" type="text" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" enterkeyhint="send">`
    + `<button class="gk-btn gk-primary" type="submit" id="${btnId}">${esc(button)}</button></form>`;
}

function revealHtml(S, watch) {
  const L = S.last;
  const counts = {};
  for (const pid of Object.keys(L.votes || {})) counts[L.votes[pid]] = (counts[L.votes[pid]] || 0) + 1;
  const winners = L.winners || [];
  const names = winners.map((pid) => nameOf(S, pid));
  const line = !winners.length ? 'No votes this round' : names.length > 1 ? `It's a tie: ${joinNames(names)}` : `Kindest note: ${names[0]}`;
  const authors = Object.keys(L.entries || {}).sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const total = Object.keys(L.votes || {}).length;
  const cards = authors.map((author, i) => {
    const n = counts[author] || 0;
    const win = winners.includes(author);
    const meta = `${esc(nameOf(S, author))}${!watch && author === S.me ? ' (you)' : ''} · ${n} vote${n === 1 ? '' : 's'}${win ? ' · +100' : ''}`;
    return `<li class="gk-choice${win ? ' is-correct' : ''}"><span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span>`
      + `<div class="gk-choice-text"><div>${esc(L.entries[author])}</div><div class="gk-meta">${meta}</div>${shareBar(n, total)}</div></li>`;
  }).join('');
  const canNext = !watch && (S.me === S.hostId || S.me === L.target);
  return scene(S, 'Compliment reveal', `<h2 class="gk-prompt">Notes for ${esc(nameOf(S, L.target))}</h2>`
    + `<p class="gk-sub cb-winner">${esc(line)}</p>`
    + `<div class="gk-actions is-center cb-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="cbNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
    + `</div>`
    + `<ol class="gk-choices cb-list" style="--gk-cols:1;--gk-cols-phone:1">${cards}</ol>`);
}

function voteHtml(S, watch) {
  const voted = S.myVote !== null && S.myVote !== undefined;
  const cards = (S.ballot || []).map((b, i) => {
    const mine = !watch && S.myEntry === b.i;
    const picked = !watch && !mine && S.myVote === b.i;
    const off = watch || mine || voted;
    return `<button type="button" class="gk-choice${picked ? ' is-selected' : ''}${mine ? ' is-dim' : ''}" data-v="${b.i}" aria-pressed="${picked}"${off ? ' disabled' : ''}>`
      + `<span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span><span class="gk-choice-text">${esc(b.text)}${mine ? ' <small class="gk-meta">(yours)</small>' : ''}</span></button>`;
  }).join('');
  const onlyMine = !watch && (S.ballot || []).every((b) => b.i === S.myEntry);
  const who = nameOf(S, S.target);
  const sub = watch ? 'You are watching. The players are voting.'
    : voted ? 'Locked in. Your vote is secret.'
      : onlyMine ? 'Yours is the only note. The others are voting.'
        : S.me === S.target ? 'Which note made your day? Vote for one.' : 'Vote for the kindest note. Not your own.';
  return scene(S, 'Vote the kindest', `<h2 class="gk-prompt">The kindest note for ${esc(who)}</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-choices${voted ? ' is-locked' : ''}" role="group" aria-label="Anonymous notes" style="--gk-cols:1;--gk-cols-phone:1">${cards}</div>`
    + `<div class="cb-foot" data-live="wait">${voted || watch || onlyMine ? waitLine(S) : ''}</div>`);
}

function writeHtml(S, watch) {
  const who = nameOf(S, S.target);
  let body;
  if (watch) {
    body = `<p class="gk-sub">You are watching. The players are writing secret compliments for ${esc(who)}.</p>`
      + `<div class="cb-foot" data-live="wait">${waitLine(S)}</div>`;
  } else if (S.me === S.target) {
    body = `<p class="gk-sub">This round is about you. The others are writing you secret compliments.</p>`
      + `<div class="cb-foot" data-live="wait">${waitLine(S)}</div>`;
  } else if (S.myEntry) {
    body = `<div class="gk-card cb-mine"><span class="gk-meta">Locked in</span><p>${esc(S.myEntry)}</p></div>`
      + `<div class="cb-foot" data-live="wait">${waitLine(S)}</div>`;
  } else {
    body = `<p class="gk-sub">Write a secret compliment for ${esc(who)}. Names stay hidden until the reveal.</p>`
      + inputRow({ id: 'cbEntry', label: `Your compliment for ${who}`, placeholder: 'Write something kind…', max: 280, btnId: 'cbSend', button: 'Send' })
      + `<div class="cb-foot" data-live="wait"></div>`;
  }
  return scene(S, 'Write a compliment', `<p class="gk-meta cb-target">For ${esc(who)}</p><h2 class="gk-prompt">${esc(S.prompt || '')}</h2>${body}`);
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
    ensureStylesheet('compliment-battle-css', CSS);
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.target, S.hostId, !!S.spectator, S.myEntry, S.myVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatching(S);

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, watch, S.round, S.hostId, S.last])
        : JSON.stringify([S.phase, S.instanceId, S.me, watch, S.round, S.endsAt, S.target, S.prompt, S.myEntry ? 1 : 0, S.myVote, S.phase === 'vote' ? [S.ballot, S.myEntry] : null]);
    if (key === screenKey && el.querySelector?.('[data-scene="compliment-battle"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'compliment-battle', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector('#cbNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }
    if (S.phase === 'vote' && S.ballot) {
      el.innerHTML = voteHtml(S, watch);
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction({ vote: Number(b.dataset.v) }); };
      });
      return;
    }
    el.innerHTML = writeHtml(S, watch);
    const inp = el.querySelector('#cbEntry');
    if (!inp) return;
    const send = () => {
      if (!canAct()) return;
      if (inp.value && inp.value.trim().length >= 2) sendAction({ entry: inp.value });
    };
    const form = el.querySelector('[data-gk-input]');
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    el.querySelector('#cbSend').onclick = (e) => { e?.preventDefault?.(); send(); };
    inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault?.();
      send();
    };
}
