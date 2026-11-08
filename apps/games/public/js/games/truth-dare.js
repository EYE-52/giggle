/* Truth or Dare view: the spinner lands on a target, the target picks
 * a deck + truth/dare, and the room judges. The spin always lands on the
 * server-chosen target — never a fake pick. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer, waitCardHtml, paintLiveStrip } from '../kit.js';

let visualKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }
/* "Ann" -> "A", "Player 2" -> "P2": the same initials as the strip. */
function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length ? (words[0].charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase() : '?';
}

function hud(S) {
  const n = (S.players || []).length;
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const round = Math.max(1, Math.min(S.round || 1, S.rounds || 1));
  const phase = { done: 'Final scores', reveal: 'Results', spin: 'Spin', choose: 'Choose', compose: 'Write', 'prompt-vote': 'Pick a card', perform: 'Perform', vote: 'Vote' }[S.phase] || '';
  const acted = S.phase === 'compose' ? S.submitted : S.phase === 'prompt-vote' ? S.promptVoted : S.voted;
  const progress = ['compose', 'prompt-vote', 'vote'].includes(S.phase) ? `${(acted || []).length} of ${Math.max(0, n - 1)} locked in` : '';
  return `<header class="gk-hud party-hud" data-phase="${esc(S.phase)}" aria-label="Round and play status">`
    + `<span class="gk-hud-round party-round">Round ${round} of ${S.rounds || 1}</span>`
    + `<span class="gk-hud-phase party-phase">${esc(phase)}</span>`
    + (watch ? '<span class="party-spectator">Watching</span>' : '')
    + `<span class="gk-hud-progress party-progress">${esc(progress)}</span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span>`
    + `</header>`;
}


let lastKey = '';
let spinTimer = 0;
let pendingDeck = 'classic';

function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
  ensureStylesheet('truth-dare-css', '/css/truth-dare.css');
}

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function labels(S) {
  const L = S.labels || {};
  return {
    decks: L.decks || { classic: 'Classic', funny: 'Funny', wild: 'Wild' },
    truth: L.truth || 'Truth',
    dare: L.dare || 'Dare',
    juicy: L.juicy || 'Juicy',
    dull: L.dull || 'Not juicy',
    done: L.done || 'Done',
    failed: L.failed || 'Failed',
  };
}

/* Mirror the server gate: the host or the round's target advances, or
 * anyone when the host's seat is empty, so a departed host never strands
 * the room. */
function canAdvance(S) {
  if (S.me === S.hostId || (S.last && S.me === S.last.target)) return true;
  return !(S.players || []).some((p) => p.id === S.hostId);
}

function keyOf(S) {
  return `${S.instanceId || ''}:${S.me}:${isWatching(S) ? 'watch' : 'player'}:${S.phase}:${S.round}:${S.target || ''}`;
}

function stopSpin() {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = 0;
  }
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function meter(S, label, voters, total, win) {
  const pct = total ? Math.round((voters.length / total) * 100) : 0;
  return `<div class="party-result${win ? ' party-result--winner' : ''}">`
    + `<span class="party-label">${esc(label)}</span>`
    + `<div class="party-meter" role="img" aria-label="${esc(label)}: ${voters.length} of ${total} votes"><span style="width:${pct}%"></span></div>`
    + `<span class="party-meta">${voters.length} vote${voters.length === 1 ? '' : 's'}`
    + (voters.length ? ` · ${voters.map((pid) => esc(nameOf(S, pid))).join(', ')}` : '') + '</span></div>';
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { visualKey = ''; liveState = null; stopSpin(); lastKey = 'done'; paintFinal(el, { scene: 'truth-dare', scores: S.scores || {}, players: S.players || [], you: isWatching(S) ? null : S.me, watching: isWatching(S), note: lastRound(S) }); return; }
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.index, S.endsAt, S.target, S.subject, S.victim, S.turn, S.hostId, !!S.spectator, !!S.current?.mine, S.myEntry, S.myOption, S.myLines, S.myVote, S.myPick, S.myPromptVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator && (liveState.players || []).some(p => p.id === liveState.me);
    const sendAction = action => canAct() ? liveApi?.send(action) : false;
    const liveHud = el.querySelector ? el.querySelector('.party-hud') : null;
    if (liveHud) liveHud.outerHTML = hud(S);
    if (['vote', 'prompt-vote', 'pick', 'verdict', 'reveal', 'done'].includes(S.phase)) {
      const key = S.phase === 'prompt-vote'
        ? JSON.stringify([keyOf(S), S.endsAt, S.kind, S.deck, S.roundStyle, S.options, S.myPromptVote,
          (S.players || []).map(p => [p.id, p.name])])
        : JSON.stringify({ ...S, audioBaseline: undefined, voted: undefined, answered: undefined, submitted: undefined,
          promptVoted: undefined, picked: Array.isArray(S.picked) ? undefined : S.picked });
      if (visualKey === key && el.querySelector?.('.party-scene')) return;
      visualKey = key;
    } else visualKey = '';

    const L = labels(S);
    const watch = isWatching(S);

    if (S.phase === 'compose') {
      stopSpin();
      const k = `${keyOf(S)}:${!!S.myEntry}`;
      // Keep the native field, focus and draft while other people write.
      if (k === lastKey && el.querySelector('#tCompose')) {
        const error = el.querySelector('#tEntryError');
        if (error) error.textContent = S.myError || '';
        return;
      }
      lastKey = k;
      const writer = !watch && S.me !== S.target;
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" data-family="party" aria-label="Write a prompt">`
        + hud(S)
        + `<p class="gk-meta td-kicker">${esc(S.roundStyle || 'Ask your own')} · ${esc(S.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${writer ? `Write a ${S.kind} for ${esc(nameOf(S, S.target))}` : watch ? `The room is writing for ${esc(nameOf(S, S.target))}` : 'The room is writing for you'}</h2>`
        + (writer && !S.myEntry
          ? `<div class="td-compose" id="tCompose"><label class="t-body" for="tEntry">${S.kind === 'truth' ? 'What should they answer?' : 'What should they do?'}</label>`
            + `<textarea class="gk-input" id="tEntry" rows="3" maxlength="${S.promptLimit || 180}" aria-describedby="tEntryCount tEntryError tEntryHint" placeholder="Keep it kind. Make it fun."></textarea>`
            + `<div class="td-compose-meta"><span class="tb-reason" id="tEntryHint">Write at least 2 characters.</span><span class="t-caption" id="tEntryCount">0 / ${S.promptLimit || 180}</span></div>`
            + `<p class="td-entry-error t-caption" id="tEntryError" role="status">${esc(S.myError || '')}</p>`
            + `<button type="button" class="tb-btn tb-primary" id="tSendEntry" disabled>Send ${S.kind === 'truth' ? 'question' : 'dare'}</button></div>`
          : `<div class="td-prompt-wait" id="tCompose">${waitCardHtml({ title: S.myEntry ? 'Your prompt is locked in' : watch ? `The room is writing for ${nameOf(S, S.target)}` : 'Your prompt is on its way',
            text: S.myEntry ? 'The room will pick from the prompts when writing ends.' : 'The other players write, then pick a prompt. If nobody writes, a random card is dealt.', waiting: 'Waiting for the writers' })}</div>`)
        + '</section>';
      const input = el.querySelector('#tEntry');
      if (input) {
        const button = el.querySelector('#tSendEntry'), hint = el.querySelector('#tEntryHint');
        let sent = false;
        input.oninput = () => {
          const valid = input.value.replace(/\s+/gu, ' ').trim().length >= 2 && input.value.length <= (S.promptLimit || 180);
          button.disabled = sent || !valid;
          hint.textContent = sent ? 'Waiting for your prompt to lock in.' : valid ? 'Tap Send when your prompt is ready.' : 'Write at least 2 characters.';
          el.querySelector('#tEntryCount').textContent = `${input.value.length} / ${S.promptLimit || 180}`;
          el.querySelector('#tEntryError').textContent = '';
        };
        button.onclick = () => {
          if (sent || button.disabled) return;
          if (sendAction({ entry: input.value }) === false) return;
          sent = true;
          button.disabled = true;
          hint.textContent = 'Waiting for your prompt to lock in.';
        };
      }
      return;
    }

    if (S.phase === 'prompt-vote') {
      stopSpin();
      lastKey = keyOf(S);
      const voter = !watch && S.me !== S.target;
      const picked = Number.isInteger(S.myPromptVote);
      const status = !voter ? `${watch ? nameOf(S, S.target) + ' waits' : 'You wait'} while the other players pick.`
        : picked ? 'Your pick is locked in. Waiting for the other picks.'
          : (S.players || []).length === 2 ? 'Tap the card they must do. Your pick decides.' : 'Tap the card they must do. Most votes wins; ties are random.';
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" data-family="party" aria-label="Pick the prompt">`
        + hud(S)
        + `<p class="gk-meta td-kicker">${esc(S.roundStyle || 'Room pool vote')} · ${esc(S.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${voter ? `Pick a ${S.kind} for ${esc(nameOf(S, S.target))}` : `The room picks for ${esc(nameOf(S, S.target))}`}</h2>`
        + `<p class="td-prompt-status t-caption" role="status">${esc(status)}</p>`
        + `<div class="td-prompt-options${picked ? ' is-locked' : ''}" role="group" aria-label="Prompt cards">`
        + (S.options || []).map((text, i) => {
          const selected = S.myPromptVote === i;
          const tag = voter ? 'button' : 'div';
          return `<${tag} ${voter ? `type="button" data-prompt-vote="${i}" aria-pressed="${selected}"${picked ? ' disabled' : ''}` : ''} class="tb-card is-compact td-prompt-option${selected ? ' is-selected' : ''}">`
            + `<span class="td-option-number" aria-hidden="true">${selected ? '✓' : i + 1}</span><span>${esc(text)}</span></${tag}>`;
        }).join('') + '</div></section>';
      let sent = false;
      el.querySelectorAll('[data-prompt-vote]').forEach((button) => {
        button.onclick = () => {
          if (sent || picked) return;
          if (sendAction({ promptVote: Number(button.dataset.promptVote) }) !== false) sent = true;
        };
      });
      return;
    }

    if (S.phase === 'reveal' && S.last) {
      stopSpin();
      lastKey = keyOf(S);
      const yesSide = S.last.kind === 'truth' ? L.juicy : L.done;
      const noSide = S.last.kind === 'truth' ? L.dull : L.failed;
      const yesV = Object.keys(S.last.votes).filter((pid) => S.last.votes[pid] === 'yes');
      const noV = Object.keys(S.last.votes).filter((pid) => S.last.votes[pid] === 'no');
      const total = Math.max(1, yesV.length + noV.length);
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Round verdict">`
        + `${hud(S)}`
        + `<p class="gk-meta td-kicker">${esc(nameOf(S, S.last.target))} · ${esc(L.decks[S.last.deck] || S.last.deck)} ${esc(S.last.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.last.prompt)}</h2>`
        + `<div class="party-reveals">`
        + meter(S, yesSide, yesV, total, S.last.yes > S.last.no)
        + meter(S, noSide, noV, total, S.last.no > S.last.yes)
        + `</div>`
        + `<p class="gk-wait is-done" role="status">${esc(S.last.verdict === 'none' || (!S.last.yes && !S.last.no) ? 'No verdict: nobody voted, so no points.'
          : S.last.verdict === 'split' ? `An even split: half credit, ${nameOf(S, S.last.target)} +${S.last.targetPts} points.`
          : `${nameOf(S, S.last.target)} +${S.last.targetPts} points.`)}</p>`
        + `<div class="gk-actions is-center td-actions">${!watch && canAdvance(S) ? '<button type="button" class="gk-btn gk-primary" id="tNext">Next</button>' : ''}</div>`
        + `</section>`;
      const nx = el.querySelector('#tNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    if (S.phase === 'perform') {
      stopSpin();
      lastKey = keyOf(S);
      const actor = S.me === S.target && !watch;
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Performance before judging">`
        + hud(S)
        + `<p class="gk-meta td-kicker">${esc(nameOf(S, S.target))} · ${esc(L.decks[S.deck] || S.deck)} ${esc(S.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.prompt)}</h2>`
        + (actor
          ? `<div class="td-banner" role="status"><span class="td-banner-icon" aria-hidden="true">${S.kind === 'truth' ? '🎤' : '🎬'}</span>`
            + `<span class="td-banner-text"><b>${S.kind === 'truth' ? 'Answer out loud now' : 'Do the dare now'}</b>`
            + `<span>Tap Ready for votes when you are done.</span></span></div>`
          : `<p class="gk-wait" role="status">${watch ? 'Watching · ' : ''}Give ${esc(nameOf(S, S.target))} time. Judging opens after they finish.</p>`)
        + (actor ? '<div class="gk-actions is-center"><button type="button" class="gk-btn gk-primary" id="tReady">Ready for votes</button></div>' : '')
        + '</section>';
      const ready = el.querySelector('#tReady');
      if (ready) ready.onclick = () => sendAction({ ready: true });
      return;
    }

    if (S.phase === 'vote') {
      stopSpin();
      lastKey = keyOf(S);
      const isTarget = S.me === S.target;
      const yesLabel = S.kind === 'truth' ? L.juicy : L.done;
      const noLabel = S.kind === 'truth' ? L.dull : L.failed;
      const head = `${hud(S)}`
        + `<p class="gk-meta td-kicker">${esc(nameOf(S, S.target))} · ${esc(L.decks[S.deck] || S.deck)} ${esc(S.kind === 'truth' ? L.truth : L.dare)}</p>`
        + `<h2 class="gk-prompt party-prompt">${esc(S.prompt)}</h2>`;
      if (watch || isTarget) {
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Room judging">` + head
          + (watch
            ? `<p class="gk-wait" role="status">You are watching — ${esc(nameOf(S, S.target))} is on the spot.</p>`
            : `<div class="td-banner" role="status"><span class="td-banner-icon" aria-hidden="true">🎤</span>`
              + `<span class="td-banner-text"><b>You are in the spotlight</b>`
              + `<span>The room votes ${esc(yesLabel)} or ${esc(noLabel)}. Stay put until the votes are in.</span></span></div>`)
          + `</section>`;
        return;
      }
      if (S.myVote) {
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Vote locked in">` + head
          + `<p class="gk-wait" role="status">Locked in: ${esc(S.myVote === 'yes' ? yesLabel : noLabel)} · waiting for ${plural(Math.max(0, (S.players || []).length - 1 - (S.voted || []).length), 'player')}</p></section>`;
        return;
      }
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Judge the player">` + head
        + `<div class="gk-choices td-choices" role="group" aria-label="Judge ${esc(nameOf(S, S.target))}" style="--gk-cols:2;--gk-cols-phone:2">`
        + `<button type="button" class="gk-choice" data-v="yes" aria-pressed="false"><span class="gk-mark" aria-hidden="true">✓</span><span class="gk-choice-text">${esc(yesLabel)}</span></button>`
        + `<button type="button" class="gk-choice" data-v="no" aria-pressed="false"><span class="gk-mark" aria-hidden="true">✕</span><span class="gk-choice-text">${esc(noLabel)}</span></button></div></section>`;
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => sendAction({ vote: b.dataset.v });
      });
      return;
    }

    if (S.phase === 'choose') {
      stopSpin();
      // Keyed so the target's deck pick and focus survive snapshots.
      const k = keyOf(S);
      if (k === lastKey && (el.querySelector('[data-kind]') || el.querySelector('[data-waitpick]'))) return;
      pendingDeck = 'classic';
      lastKey = k;
      if (S.me !== S.target || watch) {
        el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Player picking">`
          + `${hud(S)}`
          + waitCardHtml({ kicker: watch ? 'You are watching' : S.roundStyle || 'Random card', title: `${nameOf(S, S.target)} is picking`, text: 'A deck, then Truth or Dare. The prompt style decides what happens next.', waiting: `Waiting for ${nameOf(S, S.target)}`, attrs: 'data-waitpick' })
          + `</section>`;
        return;
      }
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Pick your deck">`
        + `${hud(S)}`
        + `<h2 class="gk-prompt party-prompt">Your pick, ${esc(nameOf(S, S.me))}!</h2>`
        + `<p class="gk-wait" role="status">${esc(S.roundStyle || 'Random card')} · Pick a deck, then Truth or Dare.</p>`
        + `<div class="gk-choices td-choices td-decks" role="group" aria-label="Deck" style="--gk-cols:3;--gk-cols-phone:3">`
        + ['classic', 'funny', 'wild'].map((d, i) =>
          `<button type="button" class="gk-choice${pendingDeck === d ? ' is-selected is-picked' : ''}" data-deck="${d}" aria-pressed="${pendingDeck === d}"><span class="gk-mark" aria-hidden="true">${i + 1}</span><span class="gk-choice-text">${esc(L.decks[d] || d)}</span></button>`).join('')
        + `</div>`
        + `<div class="gk-choices td-choices" role="group" aria-label="Truth or dare" style="--gk-cols:2;--gk-cols-phone:2">`
        + `<button type="button" class="gk-choice" data-kind="truth" aria-pressed="false"><span class="gk-mark" aria-hidden="true">T</span><span class="gk-choice-text">${esc(L.truth)}</span></button>`
        + `<button type="button" class="gk-choice" data-kind="dare" aria-pressed="false"><span class="gk-mark" aria-hidden="true">D</span><span class="gk-choice-text">${esc(L.dare)}</span></button></div>`
        + `<div class="gk-actions is-center"><button type="button" class="tb-btn tb-chip" id="tSpinForMe">Spin for me</button></div></section>`;
      el.querySelectorAll('[data-deck]').forEach((b) => {
        b.onclick = () => {
          pendingDeck = b.dataset.deck;
          el.querySelectorAll('[data-deck]').forEach((x) => {
            const on = x === b;
            x.classList.toggle('is-picked', on);
            x.classList.toggle('is-selected', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
        };
      });
      el.querySelectorAll('[data-kind]').forEach((b) => {
        b.onclick = () => sendAction({ deck: pendingDeck, kind: b.dataset.kind });
      });
      el.querySelector('#tSpinForMe').onclick = () => sendAction({ deck: pendingDeck, kind: 'random' });
      return;
    }

    // spin: animate names, land on the server-chosen target.
    // Keep DOM across snapshots so the animation never replays.
    const k = keyOf(S);
    if (k === lastKey && document.getElementById('tSpin')) return;
    stopSpin();
    lastKey = k;
    pendingDeck = 'classic';
    const players = S.players || [];
    const slice = 360 / Math.max(1, players.length);
    const at = Math.max(0, players.findIndex((p) => p.id === S.target));
    // Each slice wears its player's strip colour (pl-c0..4), so the wheel
    // lands on "their" colour. Four full turns, then the target's slice
    // sits under the pointer: always the server's pick.
    const stops = players.map((p, i) => `var(--td-c${i % 5}) ${(i * slice).toFixed(2)}deg ${((i + 1) * slice).toFixed(2)}deg`).join(', ');
    const faces = players.map((p, i) => `<span class="td-wheel-face" style="--td-a:${((i + 0.5) * slice).toFixed(2)}deg">${esc(initialsOf(nameOf(S, p.id)))}</span>`).join('');
    const spokes = players.length > 1 ? players.map((p, i) => `<i style="--td-a:${(i * slice).toFixed(2)}deg"></i>`).join('') : '';
    const land = -(1440 + (at + 0.5) * slice);
    el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--truth" aria-label="Spinning for a target">`
      + `${hud(S)}`
      + `<div class="gk-card gk-wait-card td-spin" role="status">`
      + `<p class="gk-meta">${watch ? 'You are watching · ' : ''}Who is in the spotlight?</p>`
      + `<div class="td-wheel-box" aria-hidden="true"><span class="td-pointer"></span>`
      + `<div class="td-wheel" style="background:conic-gradient(${stops});--td-land:${land.toFixed(2)}deg;--td-up:${((at + 0.5) * slice).toFixed(2)}deg">${spokes}${faces}</div>`
      + `<span class="td-hub">T<small>or</small>D</span></div>`
      + `<p class="gk-wait-title" id="tSpin">…</p>`
      + `<p class="gk-sub">They pick a deck and truth or dare next.</p></div>`
      + `</section>`;
    const node = document.getElementById('tSpin');
    const wheel = el.querySelector?.('.td-wheel');
    if (!players.length || !node) return;
    if (reducedMotion()) {
      wheel?.classList.add('is-landed');
      node.textContent = nameOf(S, S.target);
      return;
    }
    // Two frames so the wheel paints at 0 first and the turn runs once.
    if (wheel && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => wheel.classList.add('is-landed')));
    else wheel?.classList.add('is-landed');
    node.textContent = 'Spinning…';
    const settle = () => {
      if (lastKey !== k || document.getElementById('tSpin') !== node) return;
      stopSpin();
      node.textContent = nameOf(S, S.target);
      node.classList?.add('is-landed');
    };
    wheel?.addEventListener?.('transitionend', event => {
      if (event.target === wheel && event.propertyName === 'transform') settle();
    }, { once: true });
    let ticks = 0;
    spinTimer = setInterval(() => {
      ticks += 1;
      const n = document.getElementById('tSpin');
      if (!n) {
        stopSpin();
        return;
      }
      // Fallback for hosts without transition events. The 2.8s wheel has
      // finished before this 2.97s deadline; never cycle misleading names.
      if (ticks > 26) settle();
    }, 110);
}

/* One line under Final scores: the last round's prompt. */
function lastRound(S) {
  if (!S.last) return '';
  const L = labels(S);
  return `Last round · ${nameOf(S, S.last.target)} · ${L.decks[S.last.deck] || S.last.deck} ${S.last.kind === 'truth' ? L.truth : L.dare}: ${S.last.prompt}`;
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css', '/css/truth-dare.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; visualKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = '';
    stopSpin();
    lastKey = '';
    pendingDeck = 'classic';
  },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    el.querySelector?.('.party-scene')?.setAttribute('data-family', 'party');
    if (S.phase !== 'done') {
      const target = S.phase === 'reveal' ? S.last?.target : S.target;
      const roles = target && S.phase !== 'spin' ? { [target]: 'Spotlight' } : {};
      const gains = S.phase === 'reveal' && S.last ? { ...(S.last.voterPts || {}), ...(target && S.last.targetPts ? { [target]: S.last.targetPts } : {}) } : {};
      paintLiveStrip(el.querySelector?.('.party-scene'), S, {
        roles, actors: (S.players || []).filter((p) => !p.left && p.id !== target).map((p) => p.id),
        acted: S.phase === 'compose' ? S.submitted || [] : S.phase === 'prompt-vote' ? S.promptVoted || [] : S.phase === 'vote' ? S.voted || [] : [],
        verb: S.phase === 'compose' ? 'Wrote' : S.phase === 'prompt-vote' ? 'Picked' : 'Judged',
        waiting: S.phase === 'compose' ? 'Writing' : S.phase === 'prompt-vote' ? 'Picking' : S.phase === 'vote' ? 'Judging' : false, gains,
      });
    }
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};
