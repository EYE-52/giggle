/* Story Builder view: timed turn-added sentences build a story, then the
 * room votes the funniest line (never their own). Built on the game kit
 * (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/story-builder.css';

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

function hud(S) {
  const progress = S.phase === 'build' ? `Line ${(S.lines || []).length + 1} of ${S.totalTurns || (S.lines || []).length + 1}`
    : S.phase === 'vote' ? progressText((S.voted || []).length, activeCount(S), 'voted') : '';
  const phase = S.phase === 'build' ? (S.me === S.turn && !isWatching(S) ? 'Your line' : 'Writing')
    : ({ vote: 'Vote', reveal: 'Reveal', done: 'Game over' }[S.phase] || '');
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner, extra = '') {
  return `<section class="gk-col gk-stack sb-scene${extra}" data-scene="story-builder" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  const left = Math.max(0, activeCount(S) - (S.voted || []).length);
  return waitingHtml(left, { done: !left });
}

/* The story so far: the opener, then one numbered line per turn. */
function storyHtml(S, lines, withAuthors) {
  const rows = lines.map((l, i) => `<li class="sb-line"><span class="gk-mark" aria-hidden="true">${i + 1}</span>`
    + `<span class="sb-text">${esc(l.text)}${withAuthors && l.pid ? ` <small class="gk-meta">${esc(nameOf(S, l.pid))}</small>` : ''}</span></li>`).join('');
  return `<ol class="sb-story" aria-label="Story so far">${rows || '<li class="sb-line sb-empty"><span class="gk-meta">No lines yet. The first one is being written.</span></li>'}</ol>`;
}

function revealHtml(S, watch) {
  const L = S.last;
  const pts = L.points || {};
  const winners = (L.winners || []).map((i) => L.lines[i]).filter(Boolean);
  const names = [...new Set(winners.map((l) => nameOf(S, l.pid)))];
  const line = !winners.length ? 'No votes this story' : names.length > 1 ? `It's a tie: ${joinNames(names)}` : `Funniest line: ${names[0]}`;
  const total = L.lines.reduce((n, l) => n + l.n, 0);
  const cards = L.lines.map((l, i) => {
    const win = (L.winners || []).includes(i);
    const mine = !watch && l.pid === S.me;
    const meta = `${esc(nameOf(S, l.pid))}${mine ? ' (you)' : ''} · ${l.n} vote${l.n === 1 ? '' : 's'}`;
    return `<li class="gk-choice${win ? ' is-correct' : ''}"><span class="gk-mark" aria-hidden="true">${i + 1}</span>`
      + `<div class="gk-choice-text"><div>${esc(l.text)}</div><div class="gk-meta">${meta}</div>${shareBar(l.n, total)}</div></li>`;
  }).join('');
  const earned = Object.keys(pts).map((pid) => `${nameOf(S, pid)} +${pts[pid]}`).join(' · ');
  const canNext = !watch && S.me === S.hostId;
  return scene(S, 'Story reveal', `<h2 class="gk-prompt">${esc(L.seed)}</h2>`
    + `<p class="gk-sub sb-winner">${esc(line)}${earned ? ` <span class="gk-meta">${esc(earned)}</span>` : ''}</p>`
    + `<div class="gk-actions is-center sb-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="sNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next story starts soon', { done: true }))
    + `</div>`
    + `<ol class="gk-choices sb-list" style="--gk-cols:1;--gk-cols-phone:1">${cards}</ol>`);
}

function voteHtml(S, watch) {
  const voted = S.myVote !== null && S.myVote !== undefined;
  const mineIdx = watch ? [] : (S.myLines || []);
  const cards = (S.lines || []).map((l, i) => {
    const mine = mineIdx.includes(i);
    const picked = S.myVote === i;
    const off = watch || voted || mine;
    return `<button type="button" class="gk-choice${picked ? ' is-selected' : ''}${mine ? ' is-dim' : ''}" data-v="${i}" aria-pressed="${picked}"${off ? ' disabled' : ''}>`
      + `<span class="gk-mark" aria-hidden="true">${i + 1}</span><span class="gk-choice-text">${esc(l.text)}${mine ? ' <small class="gk-meta">(yours)</small>' : ''}</span></button>`;
  }).join('');
  const onlyMine = !watch && (S.lines || []).every((_, i) => mineIdx.includes(i));
  const sub = watch ? 'You are watching. The players are voting.'
    : voted ? `Locked in: line ${S.myVote + 1}`
      : onlyMine ? 'Every line is yours. The others are voting.'
        : 'Vote for the funniest line. Not your own.';
  return scene(S, 'Vote the funniest line', `<h2 class="gk-prompt">${esc(S.seed)}</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-choices${voted ? ' is-locked' : ''}" role="group" aria-label="Funniest line ballot" style="--gk-cols:1;--gk-cols-phone:1">${cards}</div>`
    + `<div class="sb-foot" data-live="wait">${voted || watch || onlyMine ? waitLine(S) : ''}</div>`);
}

function inputRow({ id, label, placeholder, max, btnId, button }) {
  return `<form class="gk-input-row" data-gk-input autocomplete="off">`
    + `<input class="gk-input" id="${id}" type="text" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" enterkeyhint="send">`
    + `<button class="gk-btn gk-primary" type="submit" id="${btnId}">${esc(button)}</button></form>`;
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
    ensureStylesheet('story-builder-css', CSS);
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.turn, S.hostId, !!S.spectator, S.myLines, S.myVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatching(S);
    const writer = S.phase === 'build' && !watch && S.me === S.turn;

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, watch, S.round, S.hostId, S.last])
        : S.phase === 'build'
          ? JSON.stringify(['build', S.instanceId, S.me, watch, S.round, S.endsAt, S.turn, writer ? null : S.lines])
          : JSON.stringify(['vote', S.instanceId, S.me, watch, S.round, S.endsAt, S.myVote, S.lines, S.myLines]);
    if (key === screenKey && el.querySelector?.('[data-scene="story-builder"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      const story = el.querySelector('[data-live="story"]');
      if (story) story.innerHTML = storyHtml(S, S.lines || [], true);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'story-builder', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector?.('#sNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }
    if (S.phase === 'vote') {
      el.innerHTML = voteHtml(S, watch);
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction({ vote: Number(b.dataset.v) }); };
      });
      return;
    }
    // build phase
    const who = nameOf(S, S.turn);
    if (!writer) {
      el.innerHTML = scene(S, 'Story in progress', `<h2 class="gk-prompt">${esc(S.seed)}</h2>`
        + `<div data-live="story">${storyHtml(S, S.lines || [], true)}</div>`
        + `<div class="sb-foot">${waitingHtml(watch ? `You are watching. ${who} is writing the next line` : `${who} is writing the next line`)}</div>`);
      return;
    }
    // The composer comes first so it stays in view however long the story gets.
    el.innerHTML = scene(S, 'Write the next line', `<h2 class="gk-prompt">${esc(S.seed)}</h2>`
      + `<p class="gk-sub">Your turn: add one sentence to the story.</p>`
      + inputRow({ id: 'sLine', label: 'One sentence to add to the story', placeholder: 'Add one sentence…', max: 200, btnId: 'sSend', button: 'Add line' })
      + `<div data-live="story">${storyHtml(S, S.lines || [], true)}</div>`, ' story-writer');
    const inp = el.querySelector('#sLine');
    const send = () => {
      if (!canAct()) return;
      if (inp && inp.value.trim()) sendAction({ line: inp.value.trim() });
    };
    const form = el.querySelector('[data-gk-input]');
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    el.querySelector('#sSend').onclick = (e) => { e?.preventDefault?.(); send(); };
    inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault?.();
      send();
    };
    inp.focus();
}
