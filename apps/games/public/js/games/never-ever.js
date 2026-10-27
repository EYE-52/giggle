/* Never Ever: a "never have I ever" card, private Have / Never answers, the
 * room's split and match scores. Built on the game kit
 * (public/css/game-ui.css): HUD row, prompt, two choice cards that keep
 * their place from voting to reveal, waiting line, Next, final scores. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

let mountKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

const CSS = [
  ['party-scenes-css', '/css/party-scenes.css'],
  ['never-ever-css', '/css/never-ever.css'],
];

function ensureCss() {
  for (const [id, href] of CSS) ensureStylesheet(id, href);
}

function isWatch(S) {
  if (S && S.spectator) return true;
  const ids = (S.players || []).map((p) => p.id);
  return !!S.me && ids.length > 0 && !ids.includes(S.me);
}


function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { mountKey = ''; paintFinal(el, { scene: 'never-ever', scores: S.scores || {}, players: S.players || [], you: isWatch(S) ? null : S.me, watching: isWatch(S) }); return; }
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.target, S.hostId, !!S.spectator, S.myVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator
      && (liveState.players || []).some(p => p.id === liveState.me);
    const sendAction = action => canAct() ? liveApi?.send(action) : false;
    const watch = isWatch(S);
    const haveLabel = (S.labels && S.labels.have) || 'Have';
    const notLabel = (S.labels && S.labels.haveNot) || 'Never';
    const done = S.phase === 'done';
    const reveal = S.phase === 'reveal' && !!S.last;
    const statement = reveal ? S.last.statement : S.statement;

    const key = `${S.instanceId || ''}|${S.me}|${S.round}`;
    if (key !== mountKey || !el.querySelector('.never-world')) {
      mountKey = key;
      el.innerHTML = `<section class="party-scene gk-col gk-stack never-world" aria-label="Never Ever">`
        + `<div class="gk-hud party-hud"><span class="gk-hud-round party-round" id="nRound"></span><span class="gk-hud-phase party-phase" id="nPhase"></span><span class="party-spectator" id="nWatch" hidden>Watching</span><span class="gk-hud-progress party-progress" id="nProgress"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>`
        + `<div class="never-card"><p class="gk-meta never-lead" id="nLead">Never have I ever…</p><h3 class="gk-prompt party-prompt" id="nPrompt"></h3></div>`
        + `<div class="gk-choices never-choices" role="group" aria-label="Your answer" style="--gk-cols:2;--gk-cols-phone:2">`
        + ['have', 'not'].map((v) => `<button type="button" class="gk-choice never-choice" data-v="${v}" aria-pressed="false">`
          + `<span class="never-choice-top"><span class="gk-mark" aria-hidden="true">${v === 'have' ? 'H' : 'N'}</span><span class="never-choice-label"></span></span>`
          + `<span class="never-result"><span class="never-bar"><span class="never-fill"></span></span><span class="never-count gk-meta"></span><span class="never-voters gk-meta"></span></span>`
          + `</button>`).join('')
        + `</div>`
        + `<p class="gk-wait never-status" id="nStatus" role="status"></p>`
        + `<div class="gk-actions is-center never-actions"><button type="button" class="gk-btn gk-primary" id="nNext" hidden>Next</button></div>`
        + `<details class="party-more"><summary>Scoring</summary><p class="party-meta">Answering "${esc(notLabel)}" earns 100 points. Each "${esc(notLabel)}" in a row adds 25 more (up to +100).</p></details>`
        + `</section>`;
    }
    const scene = el.querySelector('.never-world');
    scene.setAttribute('data-state', done ? 'done' : reveal ? 'reveal' : watch ? 'watch' : S.myVote ? 'locked' : 'open');
    const total = (S.players || []).length;
    const inCount = (S.voted || []).length;
    const hud = el.querySelector('.party-hud');
    hud.setAttribute('data-phase', S.phase);
    el.querySelector('#nRound').textContent = `Round ${Math.min(S.round, S.rounds) || 1} of ${S.rounds}`;
    el.querySelector('#nPhase').textContent = done ? 'Final scores' : reveal ? 'Results' : 'Vote';
    el.querySelector('#nWatch').hidden = !watch;
    el.querySelector('#nProgress').textContent = done ? '' : reveal
      ? `${S.last.have || 0} have · ${S.last.pure || 0} never` : `${inCount} of ${total} locked in`;
    el.querySelector('#nLead').hidden = done;
    el.querySelector('#nPrompt').textContent = done ? 'Final scores' : (typeof statement === 'string' && statement) ? statement : 'Shuffling…';

    const choices = el.querySelector('.never-choices');
    choices.hidden = done;
    const picked = S.myVote;
    choices.classList.toggle('is-locked', !!picked && !reveal);
    choices.classList.toggle('is-reveal', reveal);
    const ballots = reveal ? S.last.votes || {} : {};
    const n = Object.keys(ballots).length;
    for (const b of el.querySelectorAll('[data-v]')) {
      const v = b.dataset.v;
      const voters = Object.keys(ballots).filter((pid) => ballots[pid] === v);
      const pct = n ? Math.round(voters.length / n * 100) : 0;
      b.querySelector('.never-choice-label').textContent = v === 'have' ? haveLabel : notLabel;
      b.disabled = watch || !!picked || S.phase !== 'vote' || !S.statement || !!S.preparing;
      b.setAttribute('aria-pressed', String(picked === v));
      b.classList.toggle('is-selected', picked === v);
      b.classList.toggle('is-picked', picked === v);
      b.querySelector('.never-fill').style.width = `${reveal ? pct : 0}%`;
      b.querySelector('.never-count').textContent = reveal ? `${pct}% · ${plural(voters.length, 'vote')}` : '';
      b.querySelector('.never-voters').textContent = reveal ? (voters.map((pid) => nameOf(S, pid)).join(', ') || 'Nobody') : '';
      b.onclick = () => sendAction({ vote: v });
    }

    const status = el.querySelector('#nStatus');
    const waiting = Math.max(0, total - inCount);
    const myPts = reveal && S.last.pts ? S.last.pts[S.me] : 0;
    status.hidden = done;
    status.classList.toggle('is-done', reveal);
    status.textContent = !S.statement && !reveal ? 'Dealing the next card…'
      : reveal ? (watch ? 'Here is how the room answered.' : picked ? `You said ${picked === 'have' ? haveLabel : notLabel}${myPts ? ` · +${myPts} points` : ''}.` : 'You sat this one out.')
      : watch ? `Watching · waiting for ${plural(waiting, 'player')}`
      : picked ? `Locked in: ${picked === 'have' ? haveLabel : notLabel} · waiting for ${plural(waiting, 'player')}`
      : 'Have you ever? Answer honestly.';

    const next = el.querySelector('#nNext');
    next.hidden = !reveal || watch || S.me !== S.hostId;
    next.disabled = next.hidden || !!S.preparing;
    next.onclick = () => sendAction({ next: true });
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css', '/css/never-ever.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null;
    mountKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = '';
    if (typeof document !== 'undefined') document.getElementById('never-ever-css')?.remove();
  },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};
