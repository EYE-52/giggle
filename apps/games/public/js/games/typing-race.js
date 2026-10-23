/* Typing Race view: the sentence with per-character feedback, one field,
 * and a flat progress lane per racer. Built on the game kit.
 * Contracts: {typed}, {next:true} (host, results). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, waitingHtml, resultsHtml } from '../kit.js';
import { readInputCapabilities } from '../toolkit/input-capabilities.mjs';

const CSS = [['word-games-css', '/css/compact-answer-games.css']];

let lastKey = '';
let current = null;
let focusedKey = '';
let clock = null;

function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase !== 'done' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5 && S.phase === 'race');
}
function runClock(el, S, api) {
  if (clock !== null) clearInterval(clock);
  clock = null;
  paintClock(el, S, api);
  if (S.endsAt > 0 && S.phase !== 'done' && typeof setInterval === 'function') {
    clock = setInterval(() => paintClock(el, S, api), 250);
    clock?.unref?.();
  }
}

/* Player colours are game art: each racer keeps one lane colour. */
function laneColor(pid) {
  let h = 0;
  for (const ch of String(pid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ['#d82f73', '#26a37e', '#d99a1e', '#8f7bd0'][h % 4];
}

export default {
  styles: ['/css/compact-answer-games.css'],
  ownsTimer: true,
  dispose() {
    if (clock !== null) clearInterval(clock);
    clock = null; lastKey = ''; current = null; focusedKey = '';
  },
  usabilityChanged(el, S, api) {
    if (!current || current.el !== el || current.S.w !== S.w || current.S.instanceId !== S.instanceId ||
        el.isConnected === false) return;
    paintTarget(el, current.S);
    focusNextRace(el, current.S, lastKey);
  },
  render(el, S, api) {
    const prior = current;
    current = { el, S, api };
    const finish = (S.finished || S.last?.finished || []).find((f) => f.pid === S.me);
    if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round && finish &&
        !(prior.S.finished || prior.S.last?.finished || []).some((f) => f.pid === S.me)) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:typing-finished`, gain: 0.8 });
    }
    ensureCss();
    runClock(el, S, api);
    if (S.phase === 'done') {
      const resultKey = JSON.stringify(['done', S.instanceId, S.players, S.scores, S.me]);
      if (lastKey === resultKey && prior?.el === el) return;
      lastKey = resultKey;
      el.innerHTML = `<section class="gk-final wg wg-final tr gk-col gk-stack" data-game="typing-race" data-phase="done" aria-label="Typing Race final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `</section>`;
      return;
    }
    if (S.phase === 'roundEnd' && S.last) {
      const resultKey = JSON.stringify(['end', S.instanceId, S.round, S.last, S.players, S.hostId, S.me, S.spectator]);
      if (lastKey === resultKey && prior?.el === el) { const nx = el.querySelector('#tNext'); if (nx) nx.disabled = !!S.preparing; return; }
      lastKey = resultKey;
      const len = (S.last.target || '').length;
      const finished = S.last.finished || [];
      const rows = [...(S.players || [])]
        .map((p) => {
          const f = finished.find((x) => x.pid === p.id);
          const got = f ? len : (S.last.progress[p.id] || 0);
          return { p, f, got };
        })
        .sort((a, b) => (a.f && b.f ? a.f.ms - b.f.ms : 0) || b.got - a.got || a.p.name.localeCompare(b.p.name))
        .map(({ p, f, got }) => `<li class="wg-row${p.id === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(p.name)}${p.id === S.me ? ' <small>(you)</small>' : ''}</span>`
          + `<span class="wg-ans">${f ? `${(f.ms / 1000).toFixed(2)} s${f.place === 0 ? ' <span class="wg-tag is-good">Fastest</span>' : ''}` : `<span class="wg-tag">${Math.round((got / Math.max(1, len)) * 100)}% typed</span>`}</span>`
          + `<span class="wg-pts">+${f ? f.pts : Math.round((got / Math.max(1, len)) * 50)}</span></li>`).join('');
      const mine = finished.find((f) => f.pid === S.me);
      const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
      const isHost = S.me === S.hostId && !watch;
      el.innerHTML = `<section class="wg tr gk-col gk-stack" data-game="typing-race" data-phase="roundEnd" aria-label="Typing Race results">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'Results', progress: `${finished.length} finished`, timer: '' })
        + `<div class="tr-target wg-well">${esc(S.last.target || '')}</div>`
        + `<p class="wg-status${mine ? ' is-good' : ''}" role="status">${watch ? 'You are watching.' : mine ? `You finished in ${(mine.ms / 1000).toFixed(2)} s: +${mine.pts}` : 'You did not finish this sentence.'}</p>`
        + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="tNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next sentence soon')}</div>`
        + `<ol class="wg-rows" aria-label="Race results">${rows}</ol>`
        + `</section>`;
      const nx = el.querySelector('#tNext');
      if (nx) {
        nx.disabled = !!S.preparing;
        nx.onclick = () => {
          const live = current;
          if (live?.el === el && live.S.phase === 'roundEnd' && live.S.me === live.S.hostId && !live.S.preparing && !live.S.spectator) live.api.send({ next: true });
        };
      }
      return;
    }
    const key = `race:${S.instanceId || ''}:${S.me || ''}:${S.round}:${S.spectator ? 'w' : 'p'}`;
    if (key !== lastKey || prior?.el !== el) {
      lastKey = key;
      el.innerHTML = `<section class="wg tr gk-col gk-stack" data-game="typing-race" data-phase="race" aria-label="Typing Race">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: S.spectator ? 'Watching' : 'Race', progress: '\u00a0', timer: '' })
        + `<div class="tr-target wg-panel" id="tTarget" tabindex="0" aria-label="Sentence to type; scroll for more"></div>`
        + `<input class="gk-input tr-input" id="tInput" type="text" aria-label="Type the target sentence exactly" autocomplete="off" autocapitalize="off" autocorrect="off"`
        + ` spellcheck="false" enterkeyhint="done" inputmode="text" placeholder="${S.spectator ? 'Watching the race…' : 'Start typing here…'}" ${S.spectator ? 'disabled' : ''}>`
        + `<p class="wg-status" id="tTypingStatus" role="status" aria-live="polite"></p>`
        + `<div class="tr-lanes" id="tLanes" aria-label="Racers"></div>`
        + `</section>`;
      const inp = el.querySelector('#tInput');
      if (inp && !S.spectator) {
        inp.oninput = (event) => {
          const live = current;
          if (!live || live.el !== el || el.isConnected === false || el.querySelector('#tInput') !== inp ||
              event?.isComposing || live.S.phase !== 'race' || live.S.preparing || live.S.spectator || inp.disabled || live.api.isUsable?.() === false ||
              (live.S.endsAt > 0 && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt) ||
              live.S.finished?.some((f) => f.pid === live.S.me)) return;
          // Match the authority's useful prefix bound. A large paste must
          // neither flood the socket nor turn extra text into an exact finish.
          live.api.send({ typed: inp.value.slice(0, (live.S.target || '').length + 20) }, { silent: true });
          paintTarget(el, live.S, true);
        };
      }
      runClock(el, S, api);
    }
    paintTarget(el, S);
    paintLanes(el, S);
    focusNextRace(el, S, key);
  },
};

function focusNextRace(el, S, key) {
  // The shell focuses the first race. Later races replace that input, so a
  // keyboard player can continue when preparation releases the next one.
  if (S.round <= 1 || S.preparing || S.spectator || key === focusedKey || !el.ownerDocument?.body) return;
  queueMicrotask(() => {
    const live = current, input = el.querySelector('#tInput'), doc = el.ownerDocument;
    if (!live || live.el !== el || lastKey !== key || key === focusedKey || live.S.preparing ||
        live.S.phase !== 'race' || live.S.spectator || !input || input.disabled ||
        el.isConnected === false || input.closest('[inert]')) return;
    focusedKey = key;
    if (!readInputCapabilities().preferred.keyboard || doc.querySelector('dialog[open]') ||
        (doc.activeElement !== doc.body && doc.activeElement !== input)) return;
    live.api.focus?.(input);
  });
}

function paintTarget(el, S, follow = false) {
  const box = el.querySelector('#tTarget');
  const inp = el.querySelector('#tInput');
  if (!box) return;
  const target = S.target || '';
  let mine = (S.progress && S.progress[S.me]) || 0;
  if (inp && !S.spectator) {
    mine = 0;
    while (mine < target.length && inp.value[mine] === target[mine]) mine += 1;
  }
  const typedLen = inp && !S.spectator ? inp.value.length : mine;
  let html = '';
  // Score remains the server's exact UTF-16 prefix; display whole glyphs so
  // custom emoji and combining letters never become broken surrogate spans.
  const glyphs = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(target)].map(g => g.segment)
    : Array.from(target);
  let offset = 0, expected = '';
  for (const glyph of glyphs) {
    const i = offset, end = i + glyph.length, ch = esc(glyph);
    offset = end;
    if (i <= mine && mine < end) expected = glyph;
    if (end <= mine) html += `<span class="typing-correct">${ch}</span>`;
    else if (typedLen > mine && i < typedLen) html += `<span class="typing-wrong">${ch}</span>`;
    else if (i <= mine && mine < end) html += `<span class="typing-next">${ch}</span>`;
    else html += `<span>${ch}</span>`;
  }
  box.innerHTML = html;
  const cursor = follow && box.querySelector?.('.typing-next');
  if (cursor && box.clientHeight > 0) {
    const bottom = cursor.offsetTop + cursor.offsetHeight;
    if (bottom > box.scrollTop + box.clientHeight - 12) box.scrollTop = bottom - box.clientHeight + 12;
    else if (cursor.offsetTop < box.scrollTop) box.scrollTop = Math.max(0, cursor.offsetTop - 12);
  }
  const fin = (S.finished || []).some((f) => f.pid === S.me);
  const grid = el.querySelector('.gk-hud-progress');
  if (grid) {
    grid.textContent = S.spectator ? `${(S.finished || []).length} finished`
      : fin ? 'Finished' : `${mine} of ${target.length} typed`;
  }
  const status = el.querySelector('#tTypingStatus');
  if (status) {
    const wrong = !S.spectator && !fin && typedLen > mine;
    status.textContent = wrong
      ? `Fix character ${mine + 1}: ` +
        (mine < target.length ? `expected “${expected === ' ' ? 'space' : expected}”` : 'remove the extra text')
      : fin ? 'Finished — your time is locked in.' : '';
    status.classList?.toggle('is-error', wrong);
    status.classList?.toggle('is-good', !!fin);
  }
  if (inp) { inp.disabled = !!(fin || S.preparing || S.spectator || current?.api.isUsable?.() === false); if (fin) inp.placeholder = 'Finished!'; }
}

function paintLanes(el, S) {
  const box = el.querySelector('#tLanes');
  if (!box) return;
  const players = S.players || [];
  const roster = players.map((p) => p.id).join(',');
  // Stable lanes let the same racer's bar grow between snapshots.
  if (box.dataset?.roster !== roster) {
    if (box.dataset) box.dataset.roster = roster;
    box.innerHTML = players.map((p) => `<div class="tr-lane" data-racer="${esc(p.id)}">`
      + `<span class="tr-name">${esc(p.name)}${p.id === S.me ? ' (you)' : ''}</span>`
      + `<div class="tr-track" role="img"><span class="tr-fill" style="background:${laneColor(p.id)}"></span></div>`
      + `<span class="tr-meta"></span></div>`).join('');
  }
  const len = Math.max(1, (S.target || '').length);
  for (const lane of el.querySelectorAll?.('[data-racer]') || []) {
    const pid = lane.dataset.racer;
    const finish = (S.finished || []).find((f) => f.pid === pid);
    lane.classList.toggle('is-finished', !!finish);
    lane.classList.toggle('is-you', pid === S.me);
    const got = finish ? len : Math.max(0, Math.min(len, S.progress?.[pid] || 0));
    const pct = got / len;
    const track = lane.querySelector('.tr-track');
    const fill = lane.querySelector('.tr-fill');
    const meta = lane.querySelector('.tr-meta');
    const player = players.find((p) => p.id === pid);
    if (track) track.setAttribute('aria-label', `${player?.name || nameOf(S, pid)} at ${Math.round(pct * 100)} percent${finish ? ', finished' : ''}`);
    if (fill) {
      fill.style.transition = S.audioBaseline ? 'none' : '';
      fill.dataset.pct = pct.toFixed(4);
      fill.style.width = `${(pct * 100).toFixed(2)}%`;
    }
    if (meta) meta.textContent = finish ? `${(finish.ms / 1000).toFixed(2)}s` : `${Math.round(pct * 100)}%`;
  }
}
