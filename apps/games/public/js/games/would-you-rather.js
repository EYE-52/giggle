/* Would You Rather: two choice cards stay in place from voting to reveal.
 * Built on the game kit (public/css/game-ui.css): HUD row, prompt, choice
 * cards, waiting line, Next, final scores. The kit HUD shows the clock; the
 * authority owns ballots and scoring. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

const CSS = [['party-scenes-css', '/css/party-scenes.css'], ['would-you-rather-css', '/css/would-you-rather.css']];
let mountedKey = '';
let pendingVote = null;
let current = null;

function ensureCss() {
  for (const [id, href] of CSS) ensureStylesheet(id, href);
}
function watching(S) {
  return !!S.spectator || (!!S.me && !(S.players || []).some(p => p.id === S.me));
}
function update(el, S, api) {
  paint(el, S, api);
  syncHudTimer(el, S, api);
}
function paint(el, S, api) {
  current = { el, S, api };
  ensureCss();
  if (S.phase === 'done') {
    mountedKey = '';
    paintFinal(el, { scene: 'would-you-rather', scores: S.scores || {}, players: S.players || [], you: watching(S) ? null : S.me, watching: watching(S) });
    return;
  }
  const key = `${S.instanceId || ''}:${S.me}:${Math.min(S.round, S.rounds)}:${S.prompt?.a}:${S.prompt?.b}`;
  if (key !== mountedKey || !el.querySelector('.wyr-world')) {
    mountedKey = key;
    pendingVote = null;
    el.innerHTML = `<section class="party-scene gk-col gk-stack wyr-world" aria-label="Would You Rather">
      <div class="gk-hud party-hud"><span class="gk-hud-round party-round" id="wyrRound"></span><span class="gk-hud-phase party-phase" id="wyrPhase"></span><span class="party-spectator" id="wyrWatch" hidden>Watching</span><span class="gk-hud-progress party-progress" id="wyrProgress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>
      <h3 class="gk-prompt party-prompt" id="wyrTitle">Would you rather…</h3>
      <div class="gk-choices wyr-choices" role="group" aria-label="Choices" style="--gk-cols:2;--gk-cols-phone:1">${['a', 'b'].map(side => `<button type="button" class="gk-choice wyr-choice" data-v="${side}">
        <span class="gk-mark" aria-hidden="true">${side.toUpperCase()}</span>
        <span class="wyr-body"><span class="wyr-text"></span>
        <span class="wyr-result"><span class="wyr-bar"><span class="wyr-fill"></span></span><span class="wyr-count gk-meta"></span><span class="wyr-voters gk-meta"></span></span></span>
      </button>`).join('')}</div>
      <p class="gk-wait wyr-status" id="wyrStatus" role="status"></p>
      <div class="gk-actions is-center wyr-actions"><button type="button" class="gk-btn gk-primary" id="wNext" hidden>Next</button></div>
      <details class="party-more"><summary>Scoring</summary><p class="party-meta">Pick the side most of the room picks: 100 points. Picking with the room again in a row adds 25 more each time (up to +100). A tie rewards both sides.</p></details>
    </section>`;
    el.querySelectorAll('[data-v]').forEach(button => {
      button.onclick = () => {
        const live = current;
        if (!live || live.el !== el || el.querySelector(`[data-v="${button.dataset.v}"]`) !== button
          || button.disabled || live.S.phase !== 'vote' || live.S.preparing || watching(live.S)) return;
        if (live.api.send({ vote: button.dataset.v }) === false) return;
        pendingVote = button.dataset.v;
        update(el, current.S, current.api);
      };
    });
  }
  const watch = watching(S);
  const done = S.phase === 'done';
  const reveal = (S.phase === 'reveal' || done) && !!S.last;
  const picked = S.myVote || (S.phase === 'vote' ? pendingVote : null);
  const ballots = reveal ? S.last.votes || {} : {};
  const votes = Object.values(ballots).length;
  const total = (S.players || []).length;
  const voted = (S.voted || []).length;
  const scene = el.querySelector('.wyr-world');
  scene.setAttribute('data-state', reveal ? S.phase : watch ? 'watch' : picked ? 'locked' : 'open');
  el.querySelector('.party-hud').setAttribute('data-phase', S.phase);
  el.querySelector('#wyrRound').textContent = `Round ${Math.min(S.round, S.rounds) || 1} of ${S.rounds}`;
  el.querySelector('#wyrPhase').textContent = done ? 'Final scores' : reveal ? 'Results' : 'Vote';
  el.querySelector('#wyrWatch').hidden = !watch;
  el.querySelector('#wyrTitle').textContent = done ? 'Final scores' : 'Would you rather…';
  el.querySelector('#wyrProgress').textContent = done ? '' : reveal ? `${votes} vote${votes === 1 ? '' : 's'}` : `${voted} of ${total} locked in`;
  const status = el.querySelector('#wyrStatus');
  const waitingFor = Math.max(0, total - voted);
  status.textContent = !S.prompt ? 'Shuffling choices…'
    : reveal && !votes ? 'Nobody voted in this round.'
    : reveal ? (watch ? 'Here is how the room voted.' : picked ? 'Your choice is marked.' : 'You sat this one out.')
    : watch ? `Watching · waiting for ${waitingFor} player${waitingFor === 1 ? '' : 's'}`
    : picked ? (S.myVote ? `Choice locked in · waiting for ${waitingFor} player${waitingFor === 1 ? '' : 's'}` : 'Sending your choice…')
    : 'Pick the one you would rather do.';
  status.classList.toggle('is-done', reveal);
  status.hidden = done;
  const choices = el.querySelector('.wyr-choices');
  choices.hidden = done;
  choices.classList.toggle('is-locked', !!picked && !reveal);
  choices.classList.toggle('is-reveal', reveal);
  el.querySelectorAll('[data-v]').forEach(button => {
    const side = button.dataset.v;
    const label = S.prompt?.[side] || '';
    const voters = Object.keys(ballots).filter(pid => ballots[pid] === side);
    const share = votes ? Math.round(voters.length / votes * 100) : 0;
    const majority = reveal && votes > 0 && !!S.last?.winners?.includes(side);
    button.disabled = !S.prompt || S.phase !== 'vote' || S.preparing || watch || !!picked;
    button.setAttribute('aria-pressed', String(picked === side));
    button.classList.toggle('is-selected', picked === side);
    button.classList.toggle('is-picked', picked === side);
    button.classList.toggle('is-majority', majority);
    button.classList.toggle('is-long', label.length > 70);
    button.querySelector('.wyr-text').textContent = label;
    button.querySelector('.wyr-fill').style.width = `${reveal ? share : 0}%`;
    button.querySelector('.wyr-count').textContent = reveal ? `${share}% · ${voters.length} vote${voters.length === 1 ? '' : 's'}${majority ? ' · Majority' : ''}` : '';
    button.querySelector('.wyr-voters').textContent = reveal ? voters.map(pid => nameOf(S, pid)).join(', ') : '';
  });
  const next = el.querySelector('#wNext');
  next.hidden = S.phase !== 'reveal' || S.me !== S.hostId || watch;
  next.disabled = next.hidden || !!S.preparing;
  next.onclick = () => {
    const live = current;
    if (!live || live.el !== el || el.querySelector('#wNext') !== next || live.S.phase !== 'reveal' || live.S.preparing || watching(live.S) || live.S.me !== live.S.hostId) return;
    live.api.send({ next: true });
  };
}
export default {
  styles: ['/css/party-scenes.css', '/css/would-you-rather.css'],
  ownsTimer: true,
  render: update,
  update,
  dispose() {
    stopHudTimer(current?.el);
    mountedKey = '';
    pendingVote = null;
    current = null;
    if (typeof document !== 'undefined') document.getElementById('would-you-rather-css')?.remove();
  },
};
