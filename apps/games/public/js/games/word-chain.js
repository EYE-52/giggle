/* Word Chain view: the word to link to, your field on your turn, the room's
 * challenge, the recent chain and who is still in. Built on the game kit.
 * Contracts: {word}, {challenge:true}. */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, resultsHtml } from '../kit.js';

let current = null, clock = null;

function sendAction(el, origin, phase, action) {
  const live = current;
  if (!live || live.el !== el || live.S.instanceId !== origin.instanceId || live.S.round !== origin.round ||
      live.S.me !== origin.me || live.S.phase !== phase || live.S.spectator || live.S.preparing ||
      (phase !== 'reveal' && live.S.endsAt > 0 && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt)) return false;
  if (action.word !== undefined && (live.S.turnNo !== origin.turnNo || live.S.turnPid !== live.S.me || !live.S.alive?.includes(live.S.me))) return false;
  if (action.challenge && (live.S.current !== origin.current || !live.S.alive?.includes(live.S.me) || !live.S.author || live.S.author === live.S.me || live.S.challenged)) return false;
  return live.api.send(action);
}

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['word-chain-world-css', '/css/word-chain-world.css']];
function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('word-chain-world-css')?.remove();
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase === 'play' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 3);
}
function runClock(el, S, api) {
  if (clock !== null) clearInterval(clock);
  clock = null;
  paintClock(el, S, api);
  if (S.endsAt > 0 && S.phase === 'play' && typeof setInterval === 'function') {
    clock = setInterval(() => paintClock(el, S, api), 250);
    clock?.unref?.();
  }
}

function turnName(S) { return S.turnPid === S.me ? 'Your turn' : `${nameOf(S, S.turnPid)}’s turn`; }
function stillIn(S) { return `${(S.alive || []).length} of ${(S.players || []).length} still in`; }

export default {
  styles: ['/css/compact-answer-games.css', '/css/word-chain-world.css'],
  ownsTimer: true,
  dispose(el) {
    if (clock !== null) clearInterval(clock);
    clock = null; current = null;
    if (el) { delete el._key; delete el._turnNo; delete el._routeInstance; delete el._archivePage; delete el._ribbonKey; }
    removeCss();
  },
  render(el, S, api) {
    const prior = current;
    current = { el, S, api };
    const linked = !S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && S.used?.length > (prior.S.used?.length || 0);
    if (linked) api.cue?.('place', { id: `${S.instanceId}:${S.turnNo}:word-link:${S.current}`, gain: 0.75 });
    ensureCss();
    const used = S.used || [];
    if (el._routeInstance !== (S.instanceId || '')) el._archivePage = 0;
    el._routeInstance = S.instanceId || '';
    runClock(el, S, api);
    if (S.phase === 'done') {
      const resultKey = JSON.stringify(['done', S.instanceId, S.winner, S.used, S.players, S.scores, S.me]);
      if (el._key === resultKey) return;
      const survivors = S.winners && S.winners.length ? S.winners : (S.winner ? [S.winner] : []);
      const note = survivors.length === 1 ? `${nameOf(S, survivors[0])} is the last player standing.`
        : survivors.length > 1 ? `Still in at the end: ${survivors.map((pid) => nameOf(S, pid)).join(', ')}.` : 'No survivors.';
      el.innerHTML = `<section class="gk-final wg wg-final wc gk-col gk-stack" data-game="word-chain" data-phase="done" aria-label="Word Chain final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `<p class="gk-final-note wg-final-note">${esc(note)}</p>`
        + `<ol class="wg-chips wc-ribbon" role="log" aria-label="Final word chain" tabindex="0">${ribbon(S)}</ol>`
        + `<details class="wg-more wc-archive"><summary>${linksLabel(used)}</summary><div id="wcArchive"></div></details>`
        + `</section>`;
      el._key = resultKey;
      paintArchive(el, used);
      return;
    }
    const myTurn = S.turnPid === S.me;
    const alive = (S.alive || []).includes(S.me);
    const canChallenge = alive && S.author && S.author !== S.me && !S.challenged && !S.spectator;
    const paintDynamic = () => {
      const phase = el.querySelector('.gk-hud-phase');
      if (phase) phase.textContent = S.spectator ? 'Watching' : turnName(S);
      const progress = el.querySelector('.gk-hud-progress');
      if (progress) progress.textContent = stillIn(S);
      const feedback = el.querySelector('#wcFeedback');
      if (feedback) {
        const text = S.myFeedback?.message || eventLine(S);
        feedback.textContent = text;
        feedback.classList?.toggle('is-error', S.myFeedback?.ok === false);
      }
      const challenge = el.querySelector('#wcChallenge');
      if (challenge) {
        const votes = Object.keys(S.challenges || {}).length;
        challenge.innerHTML = canChallenge
          ? `<button class="gk-btn" id="wcCh" type="button">Challenge “${esc(S.current)}” · ${votes} vote${votes === 1 ? '' : 's'}</button>`
          : S.challenged ? '<p class="gk-wait is-done" role="status">Challenge vote counted</p>'
            : `<p class="gk-meta">${esc(alive || S.spectator ? challengeHint(S) : 'You are out. Watch the others play on.')}</p>`;
        const button = challenge.querySelector('#wcCh');
        if (button) { button.disabled = !!S.preparing; button.onclick = () => sendAction(el, S, 'play', { challenge: true }); }
      }
      for (const control of [el.querySelector('#wcWord'), el.querySelector('#wcGo')]) if (control) control.disabled = !!S.preparing;
      const word = el.querySelector('.wc-word');
      if (word && word.textContent !== S.current) word.textContent = S.current;
      if (word && linked && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        word.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      }
      const routeKey = JSON.stringify(S.used || []);
      if (el._ribbonKey !== routeKey) {
        const route = el.querySelector('.wc-ribbon');
        if (route) { route.innerHTML = ribbon(S); route.scrollLeft = route.scrollWidth; }
        paintArchive(el, S.used || []);
        el._ribbonKey = routeKey;
      }
      const seats = el.querySelector('.wc-seats');
      if (seats) seats.innerHTML = playerSeats(S);
      const out = el.querySelector('#wcOut');
      if (out) out.textContent = elimination(S);
      const archiveTitle = el.querySelector('.wc-archive>summary');
      if (archiveTitle) archiveTitle.textContent = linksLabel(S.used || []);
    };
    // A challenge rollback changes the visible word on the same turn. Patch
    // that state while retaining the actual input, focus and selection.
    const key = `play:${S.instanceId || ''}:${S.me || ''}:${S.turnNo}:${S.turnPid}:${alive ? 1 : 0}:${S.spectator ? 'w' : 'p'}`;
    if (el._key === key) { paintDynamic(); return; }
    const priorInput = el.querySelector('#wcWord');
    const draft = el._turnNo === S.turnNo && priorInput ? priorInput.value : '';
    const archiveOpen = el.querySelector('.wc-archive')?.open;
    const helpOpen = el.querySelector('.wc-help')?.open;
    el._key = key;
    el._turnNo = S.turnNo;
    const field = myTurn && !S.spectator
      ? `<form class="gk-input-row" id="wcForm" autocomplete="off"><input class="gk-input" type="text" id="wcWord" aria-label="Your next word in the chain" maxlength="24" value="${esc(draft)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text" placeholder="A related word…" />`
        + `<button class="gk-btn gk-primary" id="wcGo" type="submit">Say it</button></form>`
      : `<p class="wc-waiting gk-wait" role="status">${esc(S.spectator ? `${nameOf(S, S.turnPid)} is linking a word` : alive ? `${nameOf(S, S.turnPid)} is linking a word` : 'You are out')}</p>`;
    el.innerHTML = `<section class="wg wc gk-col gk-stack" data-game="word-chain" data-phase="play" aria-label="Word Chain">`
      + hudHtml({ round: `Link ${(S.used || []).length}`, phase: S.spectator ? 'Watching' : turnName(S), progress: stillIn(S), timer: '' })
      + `<div class="wc-target"><p class="gk-meta">Link a word to</p><h2 class="gk-prompt wc-word">${esc(S.current)}</h2></div>`
      + field
      + `<p class="wg-status" id="wcFeedback" role="status" aria-live="polite"></p>`
      + `<div class="wg-slot wc-challenge" id="wcChallenge"></div>`
      + `<ol class="wg-chips wc-ribbon" role="log" aria-label="Recent links" tabindex="0">${ribbon(S)}</ol>`
      + `<ul class="wg-chips wc-seats" aria-label="Players">${playerSeats(S)}</ul>`
      + `<p class="gk-meta" id="wcOut" role="status"></p>`
      + `<details class="wg-more wc-archive" ${archiveOpen ? 'open' : ''}><summary>${linksLabel(S.used || [])}</summary><div id="wcArchive"></div></details>`
      + `<details class="wg-more wc-help" ${helpOpen ? 'open' : ''}><summary>Rules</summary>`
      + `<p>${esc(S.rules)}</p>`
      + `<p>${S.maxLives > 1 ? `Everyone has ${S.maxLives} lives: a repeat, a blank, a successful challenge or running out of time costs one.` : 'A repeat, a blank, a successful challenge or running out of time knocks you out.'} Last player standing earns 300 points; the next places 200 and 100.</p>`
      + (S.contentNote ? `<p>${esc(S.contentNote)}</p>` : '')
      + `</details></section>`;
    const form = el.querySelector('#wcForm');
    const send = () => {
      const inp = el.querySelector('#wcWord');
      sendAction(el, S, 'play', { word: inp ? inp.value : '' });
    };
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    const go = el.querySelector('#wcGo');
    if (go) go.onclick = (e) => { e?.preventDefault?.(); send(); };
    const inp = el.querySelector('#wcWord');
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.repeat && !e.isComposing && e.keyCode !== 229) { e.preventDefault?.(); send(); } };
    // Keep the newest link visible.
    const rib = el.querySelector('.wc-ribbon');
    if (rib) rib.scrollLeft = rib.scrollWidth;
    paintArchive(el, used);
    el._ribbonKey = JSON.stringify(used);
    paintDynamic();
    runClock(el, S, api);
  },
};

function linksLabel(used) {
  return used.length === 1 ? 'The first link' : `All ${used.length} links`;
}

function ribbon(S) {
  const used = S.used || [];
  return used.slice(-12).map((w, i, tail) =>
    `<li class="wg-chip wc-link${i === tail.length - 1 ? ' is-on' : ''}">${esc(w)}</li>`).join('');
}

function paintArchive(el, words) {
  const page = Math.min(el._archivePage || 0, Math.max(0, Math.ceil(words.length / 50) - 1));
  el._archivePage = page;
  const end = words.length - page * 50, start = Math.max(0, end - 50);
  const box = el.querySelector('#wcArchive');
  if (!box) return;
  box.innerHTML = `<ol class="wc-archive-list" start="${start + 1}">${words.slice(start, end).map((word) => `<li>${esc(word)}</li>`).join('')}</ol>
    <div class="gk-actions"><button class="gk-btn" id="wcOlder" type="button" data-watchok ${start ? '' : 'disabled'}>Earlier links</button>
    <button class="gk-btn" id="wcNewer" type="button" data-watchok ${page ? '' : 'disabled'}>Newer links</button></div>`;
  const older = box.querySelector('#wcOlder'), newer = box.querySelector('#wcNewer');
  if (older) older.onclick = () => { el._archivePage++; paintArchive(el, words); };
  if (newer) newer.onclick = () => { el._archivePage--; paintArchive(el, words); };
}

function playerSeats(S) {
  const alive = S.alive || [];
  return (S.players || []).map((p) => {
    const inGame = alive.includes(p.id);
    const lives = S.maxLives > 1 && inGame ? ` <span class="wc-lives" aria-label="${S.lives?.[p.id] ?? 0} lives">${'♥'.repeat(Math.max(0, S.lives?.[p.id] ?? 0))}</span>` : '';
    const cls = p.id === S.turnPid ? ' is-on' : inGame ? '' : ' is-out';
    return `<li class="wg-chip${cls}">${esc(p.name)}${p.id === S.me ? ' (you)' : ''}${lives}</li>`;
  }).join('');
}

function challengeHint(S) {
  if (!S.author) return 'Players may challenge a word that does not fit.';
  const votes = Object.keys(S.challenges || {}).length;
  const need = Math.floor((S.alive || []).length / 2) + 1;
  return `${votes} of ${need} challenge votes on “${S.current}”`;
}

const WHY = { timeout: 'ran out of time', empty: 'blanked', repeat: 'repeated a word', challenged: 'was challenged', left: 'left the game' };

function eventLine(S) {
  if (S.lastLife) {
    const n = S.lastLife.lives;
    return `${nameOf(S, S.lastLife.pid)} ${WHY[S.lastLife.reason] || 'missed'}: ${n} ${n === 1 ? 'life' : 'lives'} left.`;
  }
  return '';
}

function elimination(S) {
  if (!S.lastOut) return '';
  return `${nameOf(S, S.lastOut.pid)} ${WHY[S.lastOut.reason] || 'went out'} and is out.`;
}
