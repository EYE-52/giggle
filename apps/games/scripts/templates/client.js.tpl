/* {{NAME}} view (Game Kit starter): mount/update/dispose lifecycle.
 * update() patches per snapshot; dispose() releases everything. */
import { esc, nameOf } from '../util.js';

let bound = [];

function on(t, type, fn, opts) {
  if (!t || !t.addEventListener) return;
  t.addEventListener(type, fn, opts);
  bound.push([t, type, fn, opts]);
}

export default {
  mount(el) {
    el.innerHTML = '<div class="starter"></div>';
  },

  update(el, S, api) {
    const root = el.querySelector('.starter') || el;
    if (S.phase === 'done') {
      const rows = [...S.players]
        .sort((a, b) => (S.scores[b.id] || 0) - (S.scores[a.id] || 0))
        .map((p) => `<div class="bar"><div class="n">${esc(p.name)}</div>
          <div class="fill" style="width:${Math.min(100, (S.scores[p.id] || 0) / 8)}%"></div>
          <span>${S.scores[p.id] || 0}</span></div>`).join('');
      root.innerHTML = `<h3>Final scores</h3>${rows}`;
      return;
    }
    if (S.phase === 'answer') {
      const done = (S.submitted || []).includes(S.me);
      root.innerHTML = `<h3>Round ${S.round} of ${S.rounds}</h3>
        <p class="display">${esc(S.prompt)}</p>
        ${done ? '<p class="muted">Locked in! Waiting for the room…</p>' : `
        <div class="row">
          <input id="st-answer" type="text" maxlength="120" placeholder="Your answer…" autocomplete="off" style="flex:1">
          <button class="btn" id="st-send">Send</button>
        </div>`}`;
      const sendIt = () => {
        const inp = root.querySelector('#st-answer');
        if (inp && inp.value.trim()) api.send({ answer: inp.value.trim() });
      };
      const btn = root.querySelector('#st-send');
      if (btn) on(btn, 'click', sendIt);
      const inp = root.querySelector('#st-answer');
      if (inp) on(inp, 'keydown', (e) => { if (e.key === 'Enter') sendIt(); });
      return;
    }
    if (S.phase === 'vote') {
      const mine = (S.options || []).some((o) => o.aid === S.myVote);
      root.innerHTML = `<h3>Vote the best answer</h3>
        <p class="muted">${esc(S.prompt)}</p>
        <div class="votebtns">${(S.options || []).map((o) =>
          `<button class="voteopt" data-a="${esc(o.aid)}" ${S.myVote ? 'disabled' : ''}>${esc(o.text)}</button>`).join('')}</div>
        ${mine ? '<p class="muted">Locked in!</p>' : ''}`;
      root.querySelectorAll('[data-a]').forEach((b) => {
        on(b, 'click', () => api.send({ vote: b.dataset.a }));
      });
      return;
    }
    // reveal
    const last = S.last || {};
    root.innerHTML = `<h3>${esc(last.prompt || '')}</h3>
      ${(last.options || []).map((o) =>
        `<div class="bar"><div class="n">${esc(o.text)} <span class="muted">— ${esc(nameOf(S, o.pid))}</span></div>
        <div class="fill" style="width:${Math.min(100, (o.n || 0) * 20)}%"></div>
        <span>${o.n || 0}</span></div>`).join('')}`;
  },

  dispose() {
    for (const [t, type, fn, opts] of bound) {
      try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
    }
    bound = [];
  },
};
