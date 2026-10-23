/* Rapid Polls: anyone poses, everyone votes, live bars. Just for fun:
 * everyone who takes part in a poll gets 25 points. Built on the game kit
 * (public/css/game-ui.css): HUD row, prompt, choices, waiting line, Next,
 * final scores. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

function hud(S) {
  const n = (S.players || []).length;
  const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
  const total = S.rounds || 1;
  const round = Math.max(1, Math.min(S.phase === 'pose' ? (S.round || 0) + 1 : S.round || 1, total));
  const phase = S.phase === 'done' ? 'Final scores' : S.phase === 'reveal' ? 'Results' : S.phase === 'vote' ? 'Vote' : 'Ask';
  const progress = S.phase === 'vote' ? `${(S.voted || []).length} of ${n} locked in` : S.phase === 'pose' ? 'Anyone can ask' : '';
  return `<header class="gk-hud party-hud" data-phase="${esc(S.phase)}" aria-label="Poll and play status">`
    + `<span class="gk-hud-round party-round">Round ${round} of ${total}</span>`
    + `<span class="gk-hud-phase party-phase">${esc(phase)}</span>`
    + (watch ? '<span class="party-spectator">Watching</span>' : '')
    + `<span class="gk-hud-progress party-progress">${esc(progress)}</span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span>`
    + `</header>`;
}


let voteKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';
let poseKey = null; // stable composer key for the current pose window

function ensureCss() {
  ensureStylesheet('party-scenes-css', '/css/party-scenes.css');
}

function isWatch(S) {
  if (S && S.spectator) return true;
  const ids = (S.players || []).map((p) => p.id);
  return !!S.me && ids.length > 0 && !ids.includes(S.me);
}

/* Reveal bars with true voter names. */
function bars(poll, votes, S) {
  return poll.options.map((opt, i) => {
    const voters = Object.keys(votes).filter((pid) => votes[pid] === i);
    const ballots = Object.keys(votes).length;
    const pct = ballots ? Math.round(voters.length / ballots * 100) : 0;
    return `<div class="party-result">`
      + `<div class="party-result-body"><span class="gk-mark" aria-hidden="true">${'ABCD'[i]}</span><span>${esc(opt)}</span></div>`
      + `<div class="party-meter" role="img" aria-label="${voters.length} votes"><span style="width:${pct}%"></span></div>`
      + `<p class="party-meta">${plural(voters.length, 'vote')}${voters.length ? ' · ' + voters.map((pid) => esc(nameOf(S, pid))).join(', ') : ''}</p></div>`;
  }).join('');
}

/* Live anonymous tally bars during the vote. */
function liveBars(poll, counts, total) {
  return poll.options.map((opt, i) => {
    const n = (counts && counts[i]) || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="party-result" data-count="${i}">`
      + `<div class="party-result-body"><span class="gk-mark" aria-hidden="true">${'ABCD'[i]}</span><span>${esc(opt)}</span></div>`
      + `<div class="party-meter" role="img" aria-label="${n} votes so far"><span style="width:${pct}%"></span></div>`
      + `<p class="party-meta">${n} so far</p></div>`;
  }).join('');
}

function paint(el, S, api) {
    ensureCss();
    if (S.phase === 'done') { voteKey = ''; poseKey = null; paintFinal(el, { scene: 'rapid-polls', scores: S.scores || {}, players: S.players || [], you: isWatch(S) ? null : S.me, watching: isWatch(S) }); return; }
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.index, S.endsAt, S.target, S.subject, S.victim, S.turn, S.hostId, !!S.spectator, !!S.current?.mine, S.myEntry, S.myOption, S.myLines, S.myVote, S.myPick]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator && (liveState.players || []).some(p => p.id === liveState.me);
    const sendAction = action => canAct() ? liveApi?.send(action) : false;
    const liveHud = el.querySelector ? el.querySelector('.party-hud') : null;
    if (liveHud) liveHud.outerHTML = hud(S);
    const watch = isWatch(S);
    if (S.phase !== 'vote') voteKey = '';
    const clearPose = () => {
      poseKey = null;
    };


    if (S.phase === 'reveal' && S.last) {
      clearPose();
      const by = S.last.poll.by ? `Asked by ${nameOf(S, S.last.poll.by)}` : 'A starter poll';
      const mine = S.last.pts?.[S.me];
      const line = watch ? 'Here is how the room answered.' : mine ? `${by} · +${mine} points for taking part.` : `${by} · you sat this one out.`;
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--poll" aria-label="Rapid poll reveal">`
        + `${hud(S)}`
        + `<h3 class="gk-prompt party-prompt">${esc(S.last.poll.q)}</h3>`
        + `<p class="gk-wait is-done" role="status">${esc(line)}</p>`
        + `<div class="party-reveals">${bars(S.last.poll, S.last.votes, S)}</div>`
        + `<div class="gk-actions is-center rp-actions">${!isWatch(S) && S.me === S.hostId ? `<button type="button" class="gk-btn gk-primary" id="rpNext">Next</button>` : ''}</div>`
        + `</section>`;
      const nx = el.querySelector('#rpNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }

    if (S.phase === 'vote' && S.poll) {
      clearPose();
      /* Numeric 0 is a real selection: only null/undefined means unpicked. */
      const picked = S.myVote;
      const locked = picked !== null && picked !== undefined;
      const total = S.voted ? S.voted.length : 0;
      const key = `${S.instanceId || ''}:${S.me}:${S.round}:${watch}:${S.preparing || false}:${picked}:${JSON.stringify(S.poll)}`;
      const patchTallies = () => {
        el.querySelectorAll('[data-v]').forEach(b => {
          const i = Number(b.dataset.v), n = S.counts?.[i] || 0;
          b.querySelector('.party-choice-tally').innerHTML = `${n}<small>votes</small>`;
          b.querySelector('.party-poll-fill').style.width = `${total ? n / total * 100 : 0}%`;
        });
        const st = el.querySelector('#rpStatus');
        if (st && locked && !watch) st.textContent = `Locked in: ${S.poll.options[picked]} · waiting for ${plural(Math.max(0, (S.players || []).length - total), 'player')}`;
        if (watch) el.querySelectorAll('[data-count]').forEach(row => {
          const n = S.counts?.[Number(row.dataset.count)] || 0;
          row.querySelector('.party-meter').querySelector('span').style.width = `${total ? n / total * 100 : 0}%`;
          row.querySelector('.party-meta').textContent = `${n} so far`;
          row.querySelector('.party-meter').setAttribute('aria-label', `${n} votes so far`);
        });
      };
      if (voteKey === key && el.querySelector('.party-scene--poll')) { patchTallies(); return; }
      voteKey = key;
      const btns = S.poll.options.map((opt, i) =>
        `<button class="party-choice${picked === i ? ' is-picked' : ''}" data-v="${i}" aria-pressed="${picked === i}" ${(locked || watch) ? 'disabled' : ''}>`
        + `<span class="party-poll-fill" aria-hidden="true" style="width:${total ? (S.counts?.[i] || 0) / total * 100 : 0}%"></span><span class="gk-mark" aria-hidden="true">${'ABCD'[i]}</span><span>${esc(opt)}</span><span class="party-choice-tally">${S.counts?.[i] || 0}<small>votes</small></span></button>`
      ).join('');
      const waiting = Math.max(0, (S.players || []).length - total);
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--poll" aria-label="Rapid poll vote">`
        + `${hud(S)}`
        + `<h3 class="gk-prompt party-prompt">${esc(S.poll.q)}</h3>`
        + `<p class="gk-wait" role="status" id="rpStatus">${esc(watch ? 'Watching · the room is voting live below.'
          : locked ? `Locked in: ${S.poll.options[picked]} · waiting for ${plural(waiting, 'player')}` : 'Choose an answer. Everyone who votes gets 25 points.')}</p>`
        + (watch ? '' : `<div class="party-choices">${btns}</div>`)
        + (watch ? `<div class="party-reveals" aria-label="Live tally">${liveBars(S.poll, S.counts, total)}</div>` : '')
        + `</section>`;
      if (!watch) {
        el.querySelectorAll('[data-v]').forEach((b) => {
          b.onclick = () => sendAction({ vote: Number(b.dataset.v) });
        });
      }
      return;
    }

    /* Pose phase: the composer DOM survives every snapshot inside one
     * pose window, so the focused field node, its selection, any phone
     * IME composition, the answers disclosure and error feedback are
     * never disturbed. A new round/player/role rebuilds it empty. */
    const last = S.last
      ? `<p class="party-label">Last poll</p>`
        + `<p class="party-status"><b>${esc(S.last.poll.q)}</b></p>`
        + `<div class="party-reveals">${bars(S.last.poll, S.last.votes, S)}</div>`
      : '';
    if (watch) {
      clearPose();
      el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--poll" aria-label="Rapid poll question">`
        + `${hud(S)}`
        + `<h3 class="gk-prompt party-prompt">Someone is writing a question…</h3>`
        + `<p class="gk-wait" role="status">Watching · anyone in the room can ask next.</p>`
        + last
        + `</section>`;
      return;
    }
    const bindPose = () => {
      el.querySelector('#rpAsk').onclick = () => {
        if (!canAct()) return;
        const q = el.querySelector('#rpQ').value;
        const options = [0, 1, 2, 3].map((i) => el.querySelector('#rpO' + i).value);
        if (q.trim().length < 2 || options.filter((o) => o.trim()).length < 2) {
          el.querySelector('#rpError').textContent = 'Add a question and at least two answers.';
          return;
        }
        sendAction({ pose: { q, options } });
      };
      el.querySelector('#rpStarter').onclick = () => sendAction({ starter: true });
      const ids = ['rpQ', 'rpO0', 'rpO1', 'rpO2', 'rpO3'];
      ids.forEach((id, i) => {
        const input = el.querySelector('#' + id);
        input.onkeydown = (e) => {
          if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          if (i === 2 || i === 4) el.querySelector('#rpAsk').click();
          else el.querySelector('#' + ids[i + 1]).focus();
        };
      });
    };
    const key = `rp-pose:${S.instanceId || ''}:${S.round}:${S.me || ''}`;
    const liveQ = el.querySelector ? el.querySelector('#rpQ') : null;
    const liveAsk = el.querySelector ? el.querySelector('#rpAsk') : null;
    const liveExtra = el.querySelector ? el.querySelector('#rpExtra') : null;
    if (poseKey === key && liveQ && liveAsk && liveExtra) {
      /* Same pose window: touch nothing but the kicker label and the
       * button wiring (api is fresh per snapshot). Inputs, disclosure
       * openness, focus, selection and error text stay exactly as-is. */
      bindPose();
      return;
    }
    poseKey = key;
    el.innerHTML = `<section class="party-scene gk-col gk-stack party-scene--poll" aria-label="Rapid poll question">`
      + `${hud(S)}`
      + `<h3 class="gk-prompt party-prompt">Ask the room anything</h3>`
      + `<p class="gk-sub">Anyone can ask: a question plus 2 to 4 answers, or a starter poll.</p>`
      + `<div class="party-compose"><div class="party-field"><label for="rpQ">Question</label>`
      + `<input type="text" id="rpQ" maxlength="140" placeholder="Ask anything..." autocomplete="off" enterkeyhint="next"></div>`
      + `<div class="party-poll-options">` + [0, 1].map((i) =>
        `<div class="party-field"><label for="rpO${i}">Answer ${'ABCD'[i]}${i > 1 ? ' (optional)' : ''}</label>`
        + `<input type="text" id="rpO${i}" maxlength="60" placeholder="Option ${'ABCD'[i]}" autocomplete="off" enterkeyhint="${i === 1 ? 'send' : 'next'}"></div>`).join('')
      + `</div><details id="rpExtra"><summary>More answers (optional)</summary><div class="party-poll-options">`
      + [2, 3].map((i) => `<div class="party-field"><label for="rpO${i}">Answer ${'ABCD'[i]}</label>`
        + `<input type="text" id="rpO${i}" maxlength="60" placeholder="Option ${'ABCD'[i]}" autocomplete="off" enterkeyhint="${i === 3 ? 'send' : 'next'}"></div>`).join('')
      + `</div></details><p class="party-meta" id="rpError" role="status"></p>`
      + `<div class="gk-actions"><button type="button" class="gk-btn gk-primary" id="rpAsk">Ask the room</button>`
      + `<button type="button" class="gk-btn" id="rpStarter">Use a starter</button></div></div>`
      + last
      + `</section>`;
    bindPose();
}

let liveTimerEl = null;

export default {
  styles: ['/css/party-scenes.css'],
  dispose() {
    stopHudTimer(liveTimerEl); liveTimerEl = null; poseKey = null; voteKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  ownsTimer: true,
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};
