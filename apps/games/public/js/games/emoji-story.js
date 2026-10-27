/* Emoji Story view: the storyteller retells a secret phrase in emoji only,
 * everyone else races to guess it. Built on the game kit
 * (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer, waitCardHtml } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/emoji-story.css';

let feedback = null;
let screenKey = '', liveState = null, liveApi = null, liveEl = null, liveActionKey = '';

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function activeCount(S) {
  return (S.players || []).filter((p) => !p.left).length;
}

function hud(S) {
  const progress = S.phase === 'guess' ? progressText((S.solvers || []).length, Math.max(0, activeCount(S) - 1), 'solved') : '';
  const phase = { emoji: 'Storytelling', guess: 'Guess', reveal: 'Reveal', done: 'Game over' }[S.phase] || '';
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner) {
  return `<section class="gk-col gk-stack es-scene" data-scene="emoji-story" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function solversLine(S) {
  const pids = S.solvers || [];
  const left = Math.max(0, activeCount(S) - 1 - pids.length);
  return (pids.length ? `<p class="gk-meta es-center">Solved: ${esc(pids.map((pid) => nameOf(S, pid)).join(', '))}</p>` : '')
    + waitingHtml(left ? `Waiting for ${left} ${left === 1 ? 'player' : 'players'} to solve it` : 'Everyone solved it', { done: !left });
}

function inputRow({ id, label, placeholder, max, btnId, button, describedBy }) {
  return `<form class="gk-input-row" data-gk-input autocomplete="off">`
    + `<input class="gk-input" id="${id}" type="text" aria-label="${esc(label)}" aria-describedby="${describedBy}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" enterkeyhint="send">`
    + `<button class="gk-btn gk-primary" type="submit" id="${btnId}">${esc(button)}</button></form>`;
}

function revealHtml(S, watch) {
  const L = S.last;
  const pts = L.points || {};
  const canNext = !watch && (S.me === L.director || S.me === S.hostId);
  const teller = nameOf(S, L.director);
  let body;
  if (L.skipped) {
    body = `<h2 class="gk-prompt">The phrase was ${esc(L.phrase)}</h2>`
      + `<p class="gk-sub">${esc(teller)} ran out of time. No points this round.</p><!--foot-->`;
  } else {
    const rows = (L.solvers || []).map((s) => `<li class="gk-rank-row${s.pid === S.me ? ' is-you' : ''}"><span class="gk-rank">✓</span>`
      + `<span class="gk-name">${esc(nameOf(S, s.pid))}</span><span class="gk-pts">+${s.pts}</span></li>`).join('');
    body = `<h2 class="gk-prompt">The phrase was ${esc(L.phrase)}</h2>`
      + `<p class="es-emoji" role="img" aria-label="Emoji story">${esc(L.emoji)}</p>`
      + `<p class="gk-sub">${esc(teller)} told it${pts[L.director] ? ` (+${pts[L.director]})` : ''}. ${L.solvers?.length ? `${L.solvers.length} solved it.` : 'Nobody solved it.'}</p><!--foot-->`
      + (rows ? `<ol class="gk-ranks">${rows}</ol>` : '');
  }
  const foot = `<div class="gk-actions is-center es-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="eNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
    + `</div>`;
  return scene(S, 'Emoji Story reveal', body.replace('<!--foot-->', foot));
}

export default {
  styles: [CSS],
  ownsTimer: true,
  dispose() { stopHudTimer(liveTimerEl); liveTimerEl = null; feedback = null; screenKey = ''; liveState = null; liveApi = null; liveEl = null; liveActionKey = ''; },
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

function paint(el, S, api) {
    ensureStylesheet('emoji-story-css', CSS);
    liveState = S; liveApi = api; liveEl = el;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.director, !!S.mySolved, !!S.spectator, S.hostId]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const feedbackKey = `${S.instanceId || ''}:${S.me}:${S.round}`;
    if (S.instanceId && !S.audioBaseline && !S.preparing && !S.spectator && feedback?.key === feedbackKey && S.phase === 'guess' && !feedback?.solved && !!S.mySolved) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:phrase-solved:${S.me}`, gain: 0.8 });
    }
    feedback = { key: feedbackKey, phase: S.phase, solved: !!S.mySolved };
    const watch = isWatching(S);
    const role = watch ? 'watch' : S.me === S.director ? 'director' : 'guesser';

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, role, S.round, S.hostId, S.last])
        : JSON.stringify([S.phase, S.instanceId, S.me, role, S.round, S.endsAt, S.emoji, S.mySolved ? 1 : 0]);
    if (key === screenKey && el.querySelector?.('[data-scene="emoji-story"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && S.phase === 'guess') w.innerHTML = solversLine(S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'emoji-story', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }

    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector?.('#eNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    const teller = nameOf(S, S.director);
    if (S.phase === 'guess') {
      let action;
      if (watch) action = `<p class="gk-sub es-center">You are watching. The players are racing to guess.</p>`;
      else if (role === 'director') action = `<p class="gk-sub es-center">Your phrase: <b>${esc(S.phrase)}</b>. The others are guessing.</p>`;
      else if (S.mySolved) action = `<div class="gk-card es-solved"><b>Locked in.</b> You solved it. Points show at the reveal.</div>`;
      else {
        action = inputRow({ id: 'eGuess', label: 'Guess the secret phrase', placeholder: 'Your guess…', max: 80, btnId: 'eSend', button: 'Guess', describedBy: 'eGuessStatus' })
          + `<p id="eGuessStatus" class="gk-meta" role="status" hidden></p>`;
      }
      el.innerHTML = scene(S, 'Guess the phrase', `<h2 class="gk-prompt">What phrase is this?</h2>`
        + `<p class="es-emoji" role="img" aria-label="Emoji story">${esc(S.emoji)}</p>`
        + `<p class="gk-meta es-center">Story by ${esc(teller)}</p>`
        + action
        + `<div class="es-foot" data-live="wait">${solversLine(S)}</div>`);
      const inp = el.querySelector('#eGuess');
      if (inp) {
        const status = el.querySelector('#eGuessStatus');
        const send = () => {
          if (!canAct() || !inp.value.trim()) return;
          if (liveState.endsAt > 0 && typeof liveApi?.now === 'function' && liveApi.now() >= liveState.endsAt) {
            status.hidden = false;
            status.textContent = 'Time’s up. Your guess was not sent.';
            return;
          }
          if (sendAction({ guess: inp.value.trim() }) === false) {
            status.hidden = false;
            status.textContent = 'Could not send. Your guess is kept. Try again when connected.';
            return;
          }
          status.hidden = false;
          status.textContent = `Sent “${inp.value.trim()}”. A right guess locks in; keep guessing until it does.`;
          inp.value = '';
        };
        const form = el.querySelector('[data-gk-input]');
        if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
        el.querySelector('#eSend').onclick = (e) => { e?.preventDefault?.(); send(); };
        inp.onkeydown = (e) => {
          if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
          e.preventDefault?.();
          send();
        };
        inp.focus();
      }
      return;
    }

    // emoji phase
    if (role === 'director') {
      el.innerHTML = scene(S, 'Tell the story in emoji', `<h2 class="gk-prompt">Your phrase: ${esc(S.phrase)}</h2>`
        + `<p class="gk-sub">Tell it with emoji only. No letters.</p>`
        + inputRow({ id: 'eEmoji', label: 'Tell the secret phrase in emoji', placeholder: '🌊🐠🍕…', max: 200, btnId: 'eSend2', button: 'Send', describedBy: 'eEmojiError' })
        + `<p id="eEmojiError" class="gk-meta es-error" role="status"></p>`);
      const inp = el.querySelector('#eEmoji');
      const error = el.querySelector('#eEmojiError');
      const send = () => {
        if (!canAct()) return;
        const text = inp.value.trim();
        if (!text || /\p{L}/u.test(text)) {
          error.textContent = text ? 'Use emoji only. Please remove the letters before sending.' : 'Add emoji to tell your story.';
          inp.setAttribute('aria-invalid', 'true');
          return;
        }
        error.textContent = '';
        inp.removeAttribute('aria-invalid');
        if (sendAction({ emoji: text }) === false) {
          error.textContent = 'Could not send. Your emoji are kept. Try again when connected.';
        }
      };
      const form = el.querySelector('[data-gk-input]');
      if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
      el.querySelector('#eSend2').onclick = (e) => { e?.preventDefault?.(); send(); };
      inp.onkeydown = (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault?.();
        send();
      };
      inp.focus();
      return;
    }
    el.innerHTML = scene(S, 'Waiting for the story', waitCardHtml({
      kicker: watch ? 'You are watching' : '',
      title: `${teller} is the storyteller`,
      text: `${teller} is turning a secret phrase into emoji. Then everyone guesses it.`,
      waiting: `Waiting for ${teller}`,
    }));
}
