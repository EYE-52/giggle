/* Two Truths and a Lie view: the subject writes 3 statements and marks
 * the lie; everyone else votes for the lie. Built on the game kit
 * (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer, waitCardHtml } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/two-truths.css';

let feedback = null;
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
  return (S.players || []).filter((p) => !p.left && !(S.gone || []).includes(p.id)).length;
}

function phaseName(S) {
  if (S.phase === 'done') return 'Game over';
  if (S.phase === 'reveal') return 'Reveal';
  if (S.phase === 'vote') return 'Spot the lie';
  return 'Writing';
}

function hud(S) {
  const voters = Math.max(0, activeCount(S) - 1);
  const progress = S.phase === 'vote' ? progressText((S.voted || []).length, voters, 'voted') : '';
  const phase = phaseName(S) + (isWatching(S) ? ' · Watching' : '');
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase, progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner, extra = '') {
  return `<section class="gk-col gk-stack tt-scene${extra}" data-scene="two-truths" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  if (S.phase !== 'vote') return '';
  const left = Math.max(0, activeCount(S) - 1 - (S.voted || []).length);
  return waitingHtml(left, { done: !left });
}

function namesList(S, pids) {
  return pids.map((pid) => nameOf(S, pid)).join(', ');
}

function revealHtml(S, watch) {
  const L = S.last;
  const pts = L.points || {};
  const total = Object.keys(L.votes || {}).length;
  const cards = L.statements.map((text, i) => {
    const voters = Object.keys(L.votes || {}).filter((pid) => L.votes[pid] === i);
    const isLie = i === L.lie;
    const mine = !watch && L.votes?.[S.me] === i;
    const cls = ['gk-choice', 'tt-card', isLie && 'is-correct', mine && !isLie && 'is-wrong'].filter(Boolean).join(' ');
    const meta = `${isLie ? 'The lie' : 'Truth'} · ${voters.length ? esc(namesList(S, voters)) : 'no votes'}`;
    return `<li class="${cls}"><span class="gk-mark" aria-hidden="true">${i + 1}</span>`
      + `<div class="gk-choice-text"><div>${esc(text)}</div><div class="gk-meta">${meta}</div>${shareBar(voters.length, total)}</div></li>`;
  }).join('');
  const subject = nameOf(S, L.subject);
  const writer = L.fooled ? `${subject} fooled ${L.fooled} (+${pts[L.subject] || 0})` : `${subject} fooled no one`;
  const spotters = Object.keys(pts).filter((pid) => pid !== L.subject);
  const sub = `${writer} · ${spotters.length ? `Spotted it: ${namesList(S, spotters)} (+100)` : 'Nobody spotted it'}`;
  const canNext = !watch && (S.me === L.subject || S.me === S.hostId);
  return scene(S, 'Lie revealed', `<h2 class="gk-prompt">Statement ${L.lie + 1} was the lie</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-actions is-center tt-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="tNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
    + `</div>`
    + `<ol class="gk-choices tt-list" style="--gk-cols:1;--gk-cols-phone:1">${cards}</ol>`);
}

function voteHtml(S, watch) {
  const mine = S.me === S.subject;
  const voted = S.myVote !== null && S.myVote !== undefined;
  const locked = voted || mine || watch;
  const cards = (S.statements || []).map((text, i) => {
    const picked = S.myVote === i;
    return `<button type="button" class="gk-choice${picked ? ' is-selected' : ''}" data-v="${i}" aria-pressed="${picked}"${locked ? ' disabled' : ''}>`
      + `<span class="gk-mark" aria-hidden="true">${i + 1}</span><span class="gk-choice-text">${esc(text)}</span></button>`;
  }).join('');
  const sub = watch ? `${nameOf(S, S.subject)} wrote these. The others are voting.`
    : mine ? 'Your statements are in. Who will you fool?'
      : voted ? `Locked in: statement ${S.myVote + 1}`
        : `${nameOf(S, S.subject)} wrote these. Pick the one that is a lie.`;
  return scene(S, 'Spot the lie', `<h2 class="gk-prompt">Which one is the lie?</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-choices${voted ? ' is-locked' : ''}" role="group" aria-label="Which statement is the lie" style="--gk-cols:1;--gk-cols-phone:1">${cards}</div>`
    + `<div class="tt-foot" data-live="wait">${voted || mine || watch ? waitLine(S) : ''}</div>`);
}

function writerHtml(S) {
  const rows = [0, 1, 2].map((i) => `<div class="tt-row">`
    + `<span class="gk-mark" aria-hidden="true">${i + 1}</span>`
    + `<input id="tS${i}" class="gk-input" type="text" aria-label="Statement ${i + 1}" maxlength="140" placeholder="Statement ${i + 1}" autocomplete="off" enterkeyhint="${i < 2 ? 'next' : 'send'}">`
    + `<label class="tt-lie"><input type="radio" name="tLie" value="${i}"${i === 2 ? ' checked' : ''} aria-label="Statement ${i + 1} is the lie"><span>Lie</span></label>`
    + `</div>`).join('');
  return scene(S, 'Write your statements', `<h2 class="gk-prompt">Two truths and a lie</h2>`
    + `<p class="gk-sub">Write three things about you. Mark the one that is a lie.</p>`
    + `<div class="tt-editor">${rows}</div>`
    + `<div class="gk-actions tt-foot"><button type="button" class="gk-btn gk-primary" id="tSend">Lock in</button>`
    + `<details class="tt-idea truths-idea"><summary>Need an idea?</summary><p class="gk-meta">${esc(S.idea || '')}</p></details></div>`, ' truths-writer');
}

export default {
  styles: [CSS],
  ownsTimer: true,
  dispose() { stopHudTimer(liveTimerEl); liveTimerEl = null; feedback = null; screenKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

function paint(el, S, api) {
    ensureStylesheet('two-truths-css', CSS);
    const feedbackKey = `${S.instanceId || ''}:${S.me}:${S.round}`;
    if (S.instanceId && !S.audioBaseline && !S.preparing && !S.spectator && feedback?.key === feedbackKey && feedback?.phase === 'vote' && S.phase === 'reveal' && S.last?.votes?.[S.me] != null && S.last.votes[S.me] === S.last.lie) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:lie-spotted:${S.me}`, gain: 0.8 });
    }
    feedback = { key: feedbackKey, phase: S.phase };

    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.subject, S.hostId, !!S.spectator, S.myVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatching(S);
    const role = watch ? 'watch' : S.me === S.subject ? 'subject' : 'guesser';

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, role, S.round, S.hostId, S.last])
        : JSON.stringify([S.phase, S.instanceId, S.me, role, S.round, S.endsAt, S.myVote, S.phase === 'vote' ? S.statements : null]);
    if (key === screenKey && el.querySelector?.('[data-scene="two-truths"]')) {
      // Same screen: refresh only the live parts so drafts and focus stay.
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'two-truths', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector?.('#tNext');
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
    if (role === 'subject') {
      el.innerHTML = writerHtml(S);
      const send = () => {
        if (!canAct()) return;
        const ss = [0, 1, 2].map((i) => (el.querySelector(`#tS${i}`) || {}).value || '');
        const lieEl = el.querySelector('input[name="tLie"]:checked');
        if (ss.some((s) => !s.trim())) {
          const empty = ss.findIndex((s) => !s.trim());
          el.querySelector(`#tS${empty}`)?.focus();
          return;
        }
        sendAction({ statements: ss.map((s) => s.trim()), lie: lieEl ? Number(lieEl.value) : 2 });
      };
      el.querySelector('#tSend').onclick = send;
      [0, 1, 2].forEach((i) => {
        el.querySelector(`#tS${i}`).onkeydown = (e) => {
          if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
          e.preventDefault?.();
          if (i < 2) el.querySelector(`#tS${i + 1}`).focus();
          else send();
        };
      });
      el.querySelector('#tS0')?.focus();
      return;
    }
    const who = nameOf(S, S.subject);
    el.innerHTML = scene(S, 'Waiting for statements', waitCardHtml({
      kicker: watch ? 'You are watching' : '',
      title: `${who} is writing`,
      text: 'Two truths and a lie are on the way. Then you spot the lie.',
      waiting: `Waiting for ${who}`,
    }));
}
