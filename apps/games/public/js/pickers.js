/* Friendly pickers over native form fields.
 *
 * Each picker sits next to its real <select> or <input type="number">, which
 * stays in the DOM (visually hidden for selects) so forms, presets and tests
 * keep reading .value as before. Clicking a picker writes the native field
 * and fires input/change; syncPickers(root) repaints the pickers after code
 * sets a native value directly (presets, reset, host refresh). */

const CHIP_LIMIT = 5; // more options than this wrap as chips, not one track

/* A segmented track (or wrapping chips) for an enum <select id>. Options
 * are strings, or [value, label] pairs when the chip text differs from
 * the stored value (short chip labels over long option names). */
export function segPickerHtml(id, options, value, labelId, disabled) {
  const pairs = options.map(o => (Array.isArray(o) ? o : [o, o]));
  const chips = pairs.length > CHIP_LIMIT || pairs.some(([, l]) => String(l).length > 14);
  return `<div class="picker-seg ${chips ? 'is-chips' : 'tb-seg'}" role="radiogroup" aria-labelledby="${labelId}" data-picker-for="${id}">${pairs.map(([v, l]) =>
    `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-value="${escAttr(v)}" data-hostonly ${disabled ? 'disabled' : ''}>${escAttr(l)}</button>`).join('')}</div>`;
}

/* Driving preferences are personal, so these cards are never host-only. */
export function controlsPickerHtml(id, value = 'auto', nativeAttributes = '') {
  const choices = [
    ['auto', 'Auto', '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'],
    ['keyboard', 'Keyboard', '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>'],
    ['touch', 'Touch', '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4m-2-10v6m-3-3h6"/>'],
  ];
  return `<div class="picker-controls"><span class="picker-controls-label" id="${id}-label">Controls</span>
    <select hidden class="picker-native" tabindex="-1" aria-hidden="true" id="${id}" aria-label="Controls" ${nativeAttributes}>${choices.map(([v, label]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <div class="picker-seg picker-control-cards" role="radiogroup" aria-labelledby="${id}-label" data-picker-for="${id}">${choices.map(([v, label, art]) => `<button type="button" role="radio" aria-checked="${value === v}" tabindex="${value === v ? '0' : '-1'}" data-value="${v}"><svg viewBox="0 0 24 24" aria-hidden="true">${art}</svg><span>${label}</span></button>`).join('')}</div></div>`;
}

/* − value + stepper around a number <input>, plus a slider for wide ranges. */
export function stepperHtml(id, inputHtml, { min, max, label, disabled }) {
  const dis = disabled ? 'disabled' : '';
  const wide = Number.isFinite(min) && Number.isFinite(max) && max - min > 12;
  return `<div class="picker-step" data-picker-for="${id}">
      <button type="button" class="picker-btn" data-step="-1" aria-label="Decrease ${escAttr(label)}" data-hostonly ${dis}>−</button>
      ${inputHtml}
      <button type="button" class="picker-btn" data-step="1" aria-label="Increase ${escAttr(label)}" data-hostonly ${dis}>+</button>
    </div>${wide ? `<input type="range" class="picker-range" min="${min}" max="${max}" step="1" aria-label="${escAttr(label)}" data-picker-range="${id}" data-hostonly ${dis}>` : ''}`;
}

/* One delegated listener per container: idempotent. */
export function wirePickers(root) {
  if (!root || root._pickersWired) return;
  root._pickersWired = true;
  root.addEventListener('click', (e) => {
    const seg = e.target.closest('.picker-seg button[data-value]');
    if (seg && !seg.disabled) {
      const field = document.getElementById(seg.closest('[data-picker-for]').dataset.pickerFor);
      if (field) set(field, seg.dataset.value);
      return;
    }
    const step = e.target.closest('.picker-step .picker-btn');
    if (step && !step.disabled) {
      const field = document.getElementById(step.closest('[data-picker-for]').dataset.pickerFor);
      if (!field) return;
      const min = num(field.min, -Infinity), max = num(field.max, Infinity), by = num(field.step, 1) * Number(step.dataset.step);
      const cur = field.value === '' ? (by > 0 ? min - by : max - by) : Number(field.value);
      set(field, String(clamp(cur + by, min, max)));
    }
  });
  root.addEventListener('keydown', (e) => {
    const button = e.target.closest?.('.picker-seg button[data-value]');
    if (!button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const buttons = [...button.closest('.picker-seg').querySelectorAll('button[data-value]')].filter(b => !b.disabled);
    if (!buttons.length) return;
    e.preventDefault();
    const i = buttons.indexOf(button), direction = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
    const next = buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + direction + buttons.length) % buttons.length];
    next.click(); next.focus();
  });
  root.addEventListener('input', (e) => {
    const range = e.target.closest?.('input[data-picker-range]');
    if (range) { const field = document.getElementById(range.dataset.pickerRange); if (field) set(field, range.value); return; }
    if (e.target.matches?.('.picker-step input')) syncPickers(root);
  });
  syncPickers(root);
}

/* Repaint every picker from its native field (after a direct .value write). */
export function syncPickers(root) {
  if (!root) return;
  for (const box of root.querySelectorAll('[data-picker-for]')) {
    const field = document.getElementById(box.dataset.pickerFor);
    if (!field) continue;
    if (box.classList.contains('picker-seg')) {
      for (const b of box.querySelectorAll('button[data-value]')) {
        const checked = b.dataset.value === field.value;
        b.setAttribute('aria-checked', String(checked));
        b.tabIndex = checked ? 0 : -1;
        b.disabled = field.disabled;
      }
    } else {
      const min = num(field.min, -Infinity), max = num(field.max, Infinity), v = field.value === '' ? null : Number(field.value);
      const [down, up] = box.querySelectorAll('.picker-btn');
      if (down) down.disabled = field.disabled || (v !== null && v <= min);
      if (up) up.disabled = field.disabled || (v !== null && v >= max);
    }
  }
  for (const range of root.querySelectorAll('input[data-picker-range]')) {
    const field = document.getElementById(range.dataset.pickerRange);
    if (!field) continue;
    range.value = field.value === '' ? range.min : field.value;
    range.disabled = field.disabled;
  }
}

function set(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  syncPickers(field.closest('#dlg-root') || document);
}
function num(v, d) { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? d : n; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function escAttr(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
