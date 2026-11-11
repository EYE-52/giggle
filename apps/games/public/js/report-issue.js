import { esc, uiIcon } from './util.js';
import { segPickerHtml, wirePickers, syncPickers } from './pickers.js';

const drafts = new Map();
const categoryLabels = { controls: 'Controls', rules: 'Rules or scoring', layout: 'Layout or buttons', loading: 'Loading', performance: 'Lag or stuttering', sound: 'Sound', other: 'Something else' };
/* Tile art is decorative; the hidden select keeps plain option labels. */
const categoryIcon = { controls: 'game-controller', rules: 'book-open-text', layout: 'grid-four', loading: 'hourglass-medium', performance: 'gauge', sound: 'speaker-high', other: 'chat-circle-dots' };
const suggestPhrases = ["Button didn't respond", 'Timer ended too early', 'Score looks wrong', 'Screen froze'];
let active = null;

export function isReportOpen() { return !!active?.dialog.open; }

export function reportDeviceContext({ phase = '', theme = '', embedded = false } = {}) {
  return {
    browser: navigator.userAgent.slice(0, 500), language: (navigator.language || '').slice(0, 40),
    width: Math.round(window.innerWidth), height: Math.round(window.innerHeight),
    input: window.matchMedia?.('(pointer: coarse)')?.matches ? 'touch' : 'pointer',
    phase, theme, embedded,
  };
}

export function openIssueReport({ games = [], game = 'platform', phase, theme, embedded, runLog, url = '/api/reports' }, opener) {
  if (active) return;
  if (!games.some(item => item.id === game)) game = 'platform';
  const draft = drafts.get(game) || { game, category: 'other', impact: 'problem', description: '', steps: '', context: reportDeviceContext({ phase, theme, embedded }) };
  drafts.set(game, draft);
  // Refresh diagnostics on a new report; retries keep their original packet.
  if (!draft.packet) draft.context = { ...reportDeviceContext({ phase, theme, embedded }), ...(runLog ? { run: runLog } : {}) };
  const dialog = document.createElement('dialog');
  dialog.className = 'issue-dialog';
  dialog.setAttribute('aria-labelledby', 'issueTitle');
  dialog.innerHTML = `<form class="issue-form">
    <header class="issue-head"><div class="issue-heading"><span class="issue-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3l4 3v-3h9a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"/><path d="M12 8v4m0 3h.01"/></svg></span><h2 id="issueTitle">Report an issue</h2></div><button type="button" class="issue-close tb-btn tb-chip tb-icon" aria-label="Close issue report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <div class="issue-fields">
      <div class="issue-cat"><label id="issueCategory-l" for="issueCategory">What went wrong?</label><select hidden id="issueCategory" name="category" class="picker-native" tabindex="-1" aria-hidden="true">${Object.entries(categoryLabels).map(([id, label]) => `<option value="${id}" ${draft.category === id ? 'selected' : ''}>${label}</option>`).join('')}</select><div class="picker-seg is-chips issue-tiles" role="radiogroup" aria-labelledby="issueCategory-l" data-picker-for="issueCategory">${Object.entries(categoryLabels).map(([id, label]) => `<button type="button" role="radio" aria-checked="${draft.category === id}" data-value="${id}"><span class="issue-tile-art" aria-hidden="true">${uiIcon(categoryIcon[id])}</span><span>${label}</span></button>`).join('')}</div></div>
      <fieldset class="issue-impact"><legend>Impact on play</legend><div class="issue-impact-track">${[['blocked', 'Can’t play'], ['problem', 'Something broke'], ['appearance', 'Looks wrong']].map(([id, label]) => `<label><input type="radio" name="impact" value="${id}" ${draft.impact === id ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
      <div class="issue-where"><label id="issueGame-l" for="issueGame">Where?</label><select hidden id="issueGame" name="game" class="picker-native" tabindex="-1" aria-hidden="true">${[{ id: 'platform', name: 'Platform / rooms' }, ...games].map(item => `<option value="${esc(item.id)}" ${draft.game === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>${segPickerHtml('issueGame', [['platform', 'Platform / rooms'], ...games.map(item => [item.id, item.name])], draft.game, 'issueGame-l')}</div>
      <div class="issue-description"><label for="issueDescription">What happened?</label><textarea id="issueDescription" name="description" rows="4" minlength="10" maxlength="4000" required placeholder="Describe the problem…">${esc(draft.description)}</textarea><div class="issue-suggests">${suggestPhrases.map(phrase => `<button type="button" class="issue-suggest tb-btn tb-chip" data-phrase="${esc(phrase)}">${esc(phrase)}</button>`).join('')}</div></div>
      <details class="issue-steps" ${draft.steps ? 'open' : ''}><summary>Add steps to reproduce <span>Optional</span></summary><label class="sr-only" for="issueSteps">Steps to repeat it</label><textarea id="issueSteps" name="steps" rows="3" maxlength="1500" placeholder="What did you tap or do just before it happened?">${esc(draft.steps)}</textarea></details>
      <p class="issue-privacy">Private report. Device and game details are attached.</p>
      ${draft.context.run ? `<details class="issue-diagnostics"><summary>Run diagnostics</summary><textarea readonly rows="8" aria-label="Run diagnostics JSON" spellcheck="false">${esc(JSON.stringify(draft.context.run, null, 2))}</textarea><button type="button" class="issue-download">Download run log</button></details>` : ''}
      <p class="issue-error" role="alert" hidden></p>
      <div class="issue-success" role="status" hidden></div>
    </div>
    <footer class="issue-actions"><button type="button" class="issue-cancel tb-btn tb-chip">Cancel</button><button type="submit" class="issue-send tb-btn tb-primary">Send report</button></footer>
  </form>`;
  document.body.appendChild(dialog);
  const state = { dialog, draft, key: game, opener, pending: false };
  active = state;
  const form = dialog.querySelector('form');
  const field = name => form.elements.namedItem(name);
  const snapshot = () => ({ ...draft, game: field('game').value, category: field('category').value, impact: field('impact').value, description: field('description').value, steps: field('steps').value });
  const close = () => {
    if (!state.sent) { Object.assign(draft, snapshot()); drafts.set(state.key, draft); }
    dialog.close(); dialog.remove();
    if (active === state) active = null;
    document.dispatchEvent(new Event('game-screenchange'));
    const visibleOpener = opener?.isConnected && opener.getClientRects().length && !opener.closest('details:not([open])');
    const returnTarget = visibleOpener ? opener : document.querySelector('.report-icon[data-report]');
    returnTarget?.focus({ preventScroll: true });
  };
  dialog.querySelector('.issue-close').onclick = close;
  dialog.querySelector('.issue-cancel').onclick = close;
  wirePickers(dialog); // tiles and location chips write the hidden native selects
  for (const chip of dialog.querySelectorAll('.issue-suggest')) chip.onclick = () => {
    const box = field('description');
    if (chip.disabled || box.disabled) return;
    const base = box.value.trimEnd();
    box.value = base ? `${base}${/[.!?…]$/.test(base) ? ' ' : '. '}${chip.dataset.phrase}` : chip.dataset.phrase;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const download = dialog.querySelector('.issue-download');
  if (download) download.onclick = () => {
    const href = URL.createObjectURL(new Blob([JSON.stringify(draft.context.run, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = href; link.download = 'giggle-game-run.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Keep game-wide keyboard listeners out of this modal, including Space
  // on the close/send buttons. Held game input was released on opening.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  form.addEventListener('input', () => {
    if (state.pending) return;
    draft.packet = null;
    dialog.querySelector('.issue-error').hidden = true;
  });
  form.onsubmit = async event => {
    event.preventDefault();
    if (state.pending || state.sent || !form.reportValidity()) return;
    if (field('description').value.trim().length < 10) {
      field('description').setCustomValidity('Tell us what happened in at least 10 characters.');
      field('description').reportValidity();
      field('description').setCustomValidity(''); return;
    }
    const values = snapshot();
    draft.packet ||= { id: crypto.randomUUID(), game: values.game, category: values.category, impact: values.impact, description: values.description, steps: values.steps, context: draft.context };
    const packet = draft.packet;
    state.pending = true;
    const send = dialog.querySelector('.issue-send');
    send.disabled = true; send.textContent = 'Sending…';
    for (const node of form.querySelectorAll('input,select,textarea,.issue-suggest')) node.disabled = true;
    syncPickers(form);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet), signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.ok !== true || result.id !== packet.id) throw new Error(result.error || 'The report was not confirmed. Please try again.');
      state.sent = true;
      dialog.dataset.sent = 'true';
      if (drafts.get(state.key)?.packet === packet && !(active && active !== state && active.key === state.key)) drafts.delete(state.key);
      if (active !== state) return;
      dialog.querySelector('.issue-success').textContent = 'Report sent. Thanks for letting us know.';
      dialog.querySelector('.issue-success').hidden = false;
      dialog.querySelector('.issue-error').hidden = true;
      dialog.querySelector('.issue-cancel').textContent = 'Done';
      send.hidden = true;
      dialog.querySelector('.issue-cancel').focus({ preventScroll: true });
    } catch (error) {
      if (active !== state) return;
      const message = dialog.querySelector('.issue-error');
      message.textContent = error.name === 'AbortError' ? 'The report was not confirmed. Try again; your text is still here.' : error.message === 'Failed to fetch' ? 'Could not connect. Try again; your text is still here.' : error.message;
      message.hidden = false;
    } finally {
      clearTimeout(timer); state.pending = false;
      if (active === state && !state.sent) {
        send.disabled = false; send.textContent = 'Send report';
        for (const node of form.querySelectorAll('input,select,textarea,.issue-suggest')) node.disabled = false;
        syncPickers(form);
      }
    }
  };
  document.dispatchEvent(new Event('game-screenchange'));
  dialog.showModal();
  const locations = dialog.querySelector('.issue-where .picker-seg');
  const location = locations.querySelector('[aria-checked="true"]');
  if (location) {
    locations.scrollTop = location.offsetTop - locations.offsetTop;
    locations.scrollLeft = location.offsetLeft - locations.offsetLeft;
  }
  dialog.querySelector('.issue-close').focus({ preventScroll: true });
}
