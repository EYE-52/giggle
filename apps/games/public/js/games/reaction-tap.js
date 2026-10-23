/* Reaction Tap view: one large pad. Its colour follows ONLY the server phase
 * (wait = neutral, go = green) — this client never predicts the green
 * moment, so there is no false-green timing. Built on the game kit.
 * Contracts: {tap}, {next:true} (host, results). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, waitingHtml, resultsHtml } from '../kit.js';

const CSS = [['word-games-css', '/css/compact-answer-games.css']];
let lastKey = '', lastEl = null, currentApi = null, currentState = null, clock = null;

function ensureCss() { ensureStylesheet(CSS[0][0], CSS[0][1]); }

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase === 'roundEnd' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
}
function runClock(el, S, api) {
  if (clock !== null) clearInterval(clock);
  clock = null;
  paintClock(el, S, api);
  if (S.endsAt > 0 && S.phase === 'roundEnd' && typeof setInterval === 'function') {
    clock = setInterval(() => paintClock(el, S, api), 250);
    clock?.unref?.();
  }
}

export default {
  styles: ['/css/compact-answer-games.css'],
  ownsTimer: true,
  dispose() {
    if (clock !== null) clearInterval(clock);
    clock = null; lastKey = ''; lastEl = null; currentApi = null; currentState = null;
  },
  render(el, S, api) {
    const previous = currentState;
    const sameRound = lastEl === el && previous?.instanceId === S.instanceId && previous.round === S.round;
    const tapMs = S.taps?.[S.me] ?? S.last?.order?.find((t) => t.pid === S.me)?.ms;
    const priorMs = previous?.taps?.[S.me] ?? previous?.last?.order?.find((t) => t.pid === S.me)?.ms;
    if (!S.audioBaseline && sameRound && tapMs !== undefined && priorMs === undefined) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:reaction-locked`, gain: 0.7 });
    }
    currentApi = api; currentState = S;
    ensureCss();
    const t = S.strings || {};
    if (S.phase === 'done' || S.phase === 'roundEnd') {
      const resultKey = JSON.stringify([S.instanceId, S.phase, S.round, S.last, S.players, S.wins, S.scores, S.hostId, S.me]);
      if (lastKey === resultKey && lastEl === el) {
        const nx = el.querySelector('#rNext'); if (nx) nx.disabled = !!S.preparing;
        runClock(el, S, api); return;
      }
      lastKey = resultKey; lastEl = el;
      if (S.phase === 'done') renderDone(el, S);
      else renderResults(el, S, t);
      runClock(el, S, api);
      return;
    }
    runClock(el, S, api);
    const key = `${S.instanceId || ''}:${S.round}:${S.me}:${S.spectator ? 'w' : 'p'}`;
    if (key !== lastKey || lastEl !== el || !el.querySelector('#rPad')) {
      lastKey = key;
      lastEl = el;
      el.innerHTML = `<section class="wg rt gk-col gk-stack" data-game="reaction-tap" data-phase="play" aria-label="Reaction Tap">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'Wait', progress: '\u00a0', timer: '' })
        + `<p class="wg-status" id="rInstruction" role="status"></p>`
        + `<button id="rPad" class="rt-pad is-wait" type="button"></button>`
        + `<p class="wg-status" id="rStatus" role="status"></p>`
        + `<p class="gk-meta" id="rTip"></p>`
        + `</section>`;
      if (!S.spectator) wireTap(el.querySelector('#rPad'));
    }
    const fouled = (S.fouled || []).includes(S.me);
    const tapped = S.taps && S.taps[S.me] !== undefined;
    const go = S.phase === 'go' && !S.preparing;
    const label = tapped ? `${S.taps[S.me]} ms`
      : fouled ? (t.fouled || 'Too soon — fouled out')
        : S.spectator ? go ? 'Watching the players' : 'Watching — wait for green'
          : S.preparing ? 'Getting ready…' : go ? (t.go_pad || 'TAP NOW!') : (t.wait_pad || 'Wait for green…');
    const phase = S.preparing ? 'Getting ready' : tapped ? 'Locked in' : fouled ? 'Fouled out' : S.spectator ? 'Watching' : go ? 'Go!' : 'Wait';
    const pad = el.querySelector('#rPad');
    pad.className = `rt-pad ${go ? 'is-go' : 'is-wait'}${tapped ? ' is-tapped' : ''}${fouled ? ' is-fouled' : ''}`;
    pad.textContent = label;
    pad.setAttribute('aria-label', tapped ? `Locked in at ${S.taps[S.me]} milliseconds` : label);
    pad.disabled = !!(tapped || fouled || S.spectator || S.preparing);
    const hudPhase = el.querySelector('.gk-hud-phase');
    if (hudPhase) hudPhase.textContent = phase;
    const hudProgress = el.querySelector('.gk-hud-progress');
    const tappedN = S.taps ? Object.keys(S.taps).length : 0;
    if (hudProgress) hudProgress.textContent = go ? `${tappedN} tapped` : '\u00a0';
    const instruction = el.querySelector('#rInstruction');
    instruction.textContent = go ? 'Tap the pad now!' : (t.wait_sub || 'Tap too early and you foul out of the round.');
    const tip = el.querySelector('#rTip');
    tip.textContent = S.tip ? `${t.tip_label || 'Tip'}: ${S.tip}` : '';
    el.querySelector('#rStatus').innerHTML = [go && tappedN ? `${tappedN} tapped in` : '', fouledLine(S, t)].filter(Boolean).join(' · ');
  },
};

function wireTap(pad) {
  let sent = false;
  const tap = () => {
    const S = currentState;
    if (sent || pad.disabled || !currentApi || !S || lastEl?.querySelector('#rPad') !== pad ||
        !['wait', 'go'].includes(S.phase) || S.preparing || S.spectator || S.taps?.[S.me] !== undefined ||
        S.fouled?.includes(S.me) || (S.phase === 'go' && S.endsAt > 0 && typeof currentApi.now === 'function' && currentApi.now() >= S.endsAt)) return;
    sent = currentApi.send({ tap: true }) !== false;
  };
  // A reaction is measured on contact, without waiting for a finger lift.
  const press = (e) => {
    if (e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    tap();
  };
  if (typeof window !== 'undefined' && typeof window.PointerEvent === 'function') pad.onpointerdown = press;
  else {
    pad.onmousedown = press;
    pad.ontouchstart = (e) => { if (e.touches.length === 1) press(e); };
  }
  // Keyboard and assistive activation still use the native button click.
  pad.onclick = (e) => { if (!e || e.detail === 0) tap(); };
}

function fouledLine(S, t) {
  if (!(S.fouled || []).length) return '';
  return `${esc(t.fouled_list || 'Fouled')}: ${(S.fouled || []).map((pid) => esc(nameOf(S, pid))).join(', ')}`;
}

function renderResults(el, S, t) {
  const order = (S.last && S.last.order) || [];
  const fouled = (S.last && S.last.fouled) || [];
  const rows = order.map((r) =>
    `<li class="wg-row${r.pid === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(nameOf(S, r.pid))}${r.pid === S.me ? ' <small>(you)</small>' : ''}</span>`
    + `<span class="wg-ans">${r.ms} ms${(r.rank || 0) === 1 ? ' <span class="wg-tag is-good">Fastest</span>' : ''}</span>`
    + `<span class="wg-pts">+${r.pts ?? 0}</span></li>`).join('')
    + fouled.map((pid) => `<li class="wg-row${pid === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(nameOf(S, pid))}</span><span class="wg-ans"><span class="wg-tag is-bad">${esc(t.fouled_list || 'Fouled')}</span></span><span class="wg-pts is-zero">+0</span></li>`).join('');
  const top = order.filter((r) => (r.rank || 0) === 1);
  const headline = top.length > 1 ? `It's a tie: ${top.map((r) => nameOf(S, r.pid)).join(' and ')} · ${top[0].ms} ms`
    : top.length ? `Fastest: ${nameOf(S, top[0].pid)} · ${top[0].ms} ms` : (t.no_taps || 'Nobody tapped in time.');
  const mine = order.find((r) => r.pid === S.me);
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const isHost = S.me === S.hostId && !watch;
  el.innerHTML = `<section class="wg rt gk-col gk-stack" data-game="reaction-tap" data-phase="roundEnd" aria-label="Reaction Tap results">`
    + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'Results', progress: `${order.length} tapped`, timer: '' })
    + `<h2 class="gk-prompt">${esc(headline)}</h2>`
    + `<p class="wg-status${mine ? ' is-good' : ''}" role="status">${watch ? 'You are watching.' : mine ? `Your time: ${mine.ms} ms · +${mine.pts ?? 0}` : (S.last?.fouled || []).includes(S.me) ? 'You tapped too soon.' : 'You did not tap in time.'}</p>`
    + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="rNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : (t.next_round || 'Next round soon'))}</div>`
    + (rows ? `<ol class="wg-rows" aria-label="Round times">${rows}</ol>` : '')
    + `</section>`;
  const nx = el.querySelector('#rNext');
  if (nx) {
    nx.disabled = !!S.preparing;
    nx.onclick = () => {
      const live = currentState;
      if (lastEl === el && live?.phase === 'roundEnd' && live.me === live.hostId && !live.preparing && !live.spectator) currentApi?.send({ next: true });
    };
  }
}

function renderDone(el, S) {
  el.innerHTML = `<section class="gk-final wg wg-final rt gk-col gk-stack" data-game="reaction-tap" data-phase="done" aria-label="Reaction Tap final scores">`
    + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
    + `</section>`;
}
