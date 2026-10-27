/* Game Night customizer: a dedicated accessible dialog for host settings
 * and custom word/prompt lists. Lives in #dlg-root (outside #app) so lobby
 * re-renders never eat drafts. Guests see the same panel read-only with
 * safe summaries (pack contents never leave the server). */
import { esc, store } from './util.js';
import { kartSetupHtml, wireKartSetup, syncKartSetup } from './kart-setup.js';

let saveSequence = 0;
let dlg = null; // {game, opener, onSave, onReset, onClearPack, host}

function packLines(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function savedPackKey(gid, key) {
  return `pb_pack_${gid}_${key}`;
}

function presetsKey(gid) {
  return `pb_presets_${gid}`;
}

function loadPresets(gid) {
  try {
    const v = JSON.parse(store.get(presetsKey(gid)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function savePresets(gid, list) {
  store.set(presetsKey(gid), JSON.stringify(list.slice(0, 24)));
}

export function isCustomizerOpen() {
  return !!dlg;
}

export function customizerGame() {
  return dlg ? dlg.game.id : null;
}

export function closeCustomizer(opts = {}) {
  if (!dlg) return;
  clearTimeout(dlg.pending?.timer);
  const { opener, game } = dlg;
  dlg = null;
  document.getElementById('dlg-root').innerHTML = '';
  document.removeEventListener('keydown', escCloser);
  const target = opener && document.contains(opener) ? opener
    : document.querySelector(`[data-how="${game.id}"]`);
  if (opts.returnFocus !== false && target) {
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }
}

export function customizerError(gameId, msg) {
  if (!dlg || dlg.game.id !== gameId) return;
  clearTimeout(dlg.pending?.timer);
  dlg.pending = null;
  clearError();
  const save = document.getElementById('dlgSave');
  if (save) save.textContent = 'Save settings';
  const err = document.getElementById('dlgErr');
  if (err) {
    err.textContent = msg;
    err.hidden = false;
  }
  syncHostControls();
  if (!document.getElementById('dlg-root').contains(document.activeElement)) {
    const target = dlg.host ? save : document.getElementById('dlgClose');
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  }
}

function clearError() {
  const err = document.getElementById('dlgErr');
  if (err) {
    err.textContent = '';
    err.hidden = true;
  }
  const status = document.getElementById('dlgStatus');
  if (status) { status.textContent = ''; status.hidden = true; }
}

function syncHostControls() {
  document.querySelectorAll('#dlg-root [data-hostonly]').forEach(el => {
    el.disabled = !dlg.host || !!dlg.pending;
  });
  syncKartSetup(dlg.game);
}

/* Update counts + host state without touching typed drafts. */
export function refreshCustomizer(config, host) {
  if (!dlg) return;
  dlg.host = host;
  const g = dlg.game;
  const meta = (config && config[g.id]) || { settings: {}, packs: {} };
  for (const p of (g.schema.packs || [])) {
    const n = meta.packs ? (meta.packs[p.key] || 0) : 0;
    const line = document.getElementById(`dpm-${g.id}-${p.key}`);
    if (line) {
      line.textContent = packCountText(p, n);
      updatePackCount(g, p);
    }
  }
  const note = document.getElementById('dlgNote');
  if (note) note.textContent = g.id === 'pocket-karts'
    ? host ? 'Choose the arena and rules for your next match.' : 'The host chooses the arena and rules.'
    : hostNote(host);
  const tag = document.getElementById('dlgTag');
  if (tag) tag.textContent = hostTag(host);
  if (!host) {
    // Host drafts are private editing state. Read-only views follow the
    // confirmed room settings, including defaults after a reset/migration.
    for (const s of g.schema.settings || []) {
      const el = document.getElementById(`df-${g.id}-${s.key}`);
      const value = meta.settings?.[s.key] ?? s.def;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value ?? '';
    }
    if (dlg.pending) customizerError(g.id, 'Only the host can save settings.');
  }
  syncHostControls();
}

export function customizerResult({ game, requestId, msg }) {
  if (!dlg || !dlg.pending || dlg.game.id !== game || dlg.pending.requestId !== requestId) return;
  if (msg) { customizerError(game, msg); return; }
  const kind = dlg.pending.kind;
  clearTimeout(dlg.pending.timer); dlg.pending = null;
  if (kind === 'save') {
    const toast = dlg.toast;
    closeCustomizer();
    toast?.('Settings saved');
    return;
  }
  const save = document.getElementById('dlgSave');
  save.textContent = 'Save settings';
  syncHostControls();
  const status = document.getElementById('dlgStatus');
  status.textContent = 'Reset to defaults'; status.hidden = false;
  dlg.toast?.('Reset to defaults');
}

function pendingConfig(kind) {
  clearTimeout(dlg.pending?.timer);
  const gameId = dlg.game.id;
  const requestId = `setup-${Date.now()}-${++saveSequence}`;
  dlg.pending = { kind, requestId, timer: setTimeout(() => {
    customizerError(gameId, 'Saving was not confirmed. Reconnect and try again.');
  }, 8000) };
  const save = document.getElementById('dlgSave');
  save.textContent = 'Saving…';
  syncHostControls();
  return requestId;
}

function hostNote(host) {
  return host
    ? 'Changes apply to the next game and rematches. Custom lists stay private.'
    : 'Only the host can change settings. You see the same setup everyone plays with — list contents stay secret.';
}

function hostTag(host) {
  return host ? 'Host setup' : 'Read-only';
}

function packCountText(p, active) {
  return active ? `${active} custom lines active` : 'Built-in list active';
}

function updatePackCount(g, p) {
  const el = document.getElementById(`dp-${g.id}-${p.key}`);
  const typed = document.getElementById(`dpt-${g.id}-${p.key}`);
  if (!el || !typed) return;
  const n = packLines(el.value).length;
  const range = p.minItems ? ` · needs ${p.minItems}–${p.maxItems || '∞'}` : '';
  typed.textContent = n ? `${n} lines typed${range}` : `Nothing typed yet${range}`;
}

function settingField(g, s, current, host) {
  const id = `df-${g.id}-${s.key}`;
  const val = current[s.key] !== undefined ? current[s.key] : s.def;
  const dis = host ? '' : 'disabled';
  if (s.type === 'bool') {
    return `<div class="dlg-field dlg-toggle"><label class="conflabel" for="${id}">
      <input id="${id}" data-hostonly type="checkbox" ${val ? 'checked' : ''} ${dis}>
      <span>${esc(s.label || s.key)}</span></label></div>`;
  }
  if (s.type === 'enum') {
    const opts = (s.options || []).map((o) =>
      `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="dlg-field"><label class="conflabel" for="${id}">${esc(s.label || s.key)}</label>
      <select id="${id}" data-hostonly ${dis}>${opts}</select></div>`;
  }
  const auto = s.def === null || s.def === undefined;
  return `<div class="dlg-field"><label class="conflabel" for="${id}">${esc(s.label || s.key)}
      <span class="muted small">(${s.min}–${s.max}${auto ? ', blank = ' + esc(s.autoLabel || 'auto') : ''})</span></label>
    <input id="${id}" data-hostonly type="number" min="${s.min}" max="${s.max}"
      value="${val === null || val === undefined ? '' : val}"
      placeholder="${auto ? esc(s.autoLabel || 'Auto') : ''}" ${dis}></div>`;
}

function packField(g, p, meta, host) {
  const id = `dp-${g.id}-${p.key}`;
  const n = meta && meta.packs ? (meta.packs[p.key] || 0) : 0;
  const dis = host ? '' : 'disabled';
  return `<div class="dlg-field"><label class="conflabel" for="${id}">${esc(p.label || p.key)}
      <span class="muted small">(one per line${p.minItems ? `, ${p.minItems}–${p.maxItems || '∞'}` : ''})</span></label>
    <textarea id="${id}" data-hostonly rows="4" placeholder="One per line — leave blank to keep the built-in list." ${dis}></textarea>
    <div class="dlg-packmeta"><span class="muted small" id="dpm-${g.id}-${p.key}">${esc(packCountText(p, n))}</span>
      <span class="muted small" id="dpt-${g.id}-${p.key}"></span></div>
    <div class="row dlg-packrow">
      <button class="howto-btn" data-dpacksave="${g.id}:${p.key}" data-hostonly ${dis}>Save list</button>
      <button class="howto-btn" data-dpackload="${g.id}:${p.key}" data-hostonly ${dis}>Load saved</button>
      <button class="howto-btn" data-dpackclear="${g.id}:${p.key}" data-hostonly ${dis}>Use built-in</button>
      <button class="howto-btn" data-dpackexport="${g.id}:${p.key}" data-hostonly ${dis}>Export</button>
      <label class="howto-btn" ${dis ? 'aria-disabled="true"' : ''}>Import
        <input type="file" data-dpackimport="${g.id}:${p.key}" accept=".json,.txt" hidden ${dis}></label>
    </div></div>`;
}

function presetListHtml(g, host) {
  const presets = loadPresets(g.id);
  if (!presets.length) return '<p class="muted small">Save these settings as a preset to use them again.</p>';
  return `<ul class="preset-list">` + presets.map((p, i) => {
    const nSet = Object.keys(p.settings || {}).length;
    const nPack = Object.values(p.pack || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    return `<li><span class="preset-name">${esc(p.name)}</span>
      <span class="muted small">${nSet} settings${nPack ? ` · ${nPack} list lines` : ''}</span>
      <span class="preset-btns">
        <button class="howto-btn" data-dpresetload="${i}" data-hostonly ${host ? '' : 'disabled'}>Load</button>
        <button class="howto-btn" data-dpresetdel="${i}" data-hostonly ${host ? '' : 'disabled'}>Delete</button>
      </span></li>`;
  }).join('') + '</ul>';
}

export function collectDialogSettings(g) {
  const out = {};
  for (const s of (g.schema.settings || [])) {
    const el = document.getElementById(`df-${g.id}-${s.key}`);
    if (!el) continue;
    if (s.type === 'bool') out[s.key] = el.checked;
    else if (s.type === 'enum') out[s.key] = el.value;
    else {
      const raw = el.value.trim();
      if (raw === '') out[s.key] = (s.def === null || s.def === undefined) ? null : s.def;
      else out[s.key] = Number(raw);
    }
  }
  return out;
}

export function collectDialogPacks(g) {
  const out = {};
  for (const p of (g.schema.packs || [])) {
    const el = document.getElementById(`dp-${g.id}-${p.key}`);
    if (!el) continue;
    const lines = packLines(el.value);
    if (lines.length) out[p.key] = lines; // blank box = leave unchanged
  }
  return out;
}

function fillDialog(g, settings, pack) {
  for (const s of (g.schema.settings || [])) {
    const el = document.getElementById(`df-${g.id}-${s.key}`);
    if (!el || !settings || settings[s.key] === undefined) continue;
    if (s.type === 'bool') el.checked = !!settings[s.key];
    else if (s.type === 'enum') el.value = settings[s.key];
    else el.value = settings[s.key] === null ? '' : settings[s.key];
  }
  for (const p of (g.schema.packs || [])) {
    const el = document.getElementById(`dp-${g.id}-${p.key}`);
    if (!el || !pack || !pack[p.key]) continue;
    el.value = pack[p.key].join('\n');
    updatePackCount(g, p);
  }
  syncKartSetup(g, { repair: dlg.host, announce: true });
}

export function openCustomizer({ game, config, host, opener, initialField, onSave, onReset, onClearPack, toast }) {
  closeCustomizer({ returnFocus: false });
  dlg = { game: game, opener: opener || null, onSave, onReset, onClearPack, host, toast };
  const g = game;
  const meta = (config && config[g.id]) || { settings: {}, packs: {} };
  const current = meta.settings || {};
  const schema = g.schema || { settings: [], packs: [] };
  const kart = g.id === 'pocket-karts';
  const root = document.getElementById('dlg-root');
  root.innerHTML = `
  <div class="dlg-overlay" id="dlgOverlay">
    <div class="dlg ${kart ? 'kart-setup' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
      <div class="dlg-head">
        <div><div class="ticket-head"><h2 id="dlgTitle">${kart ? 'Pocket Karts setup' : `Customize ${esc(g.name)}`}</h2><span class="ticket-stub" id="dlgTag">${esc(hostTag(host))}</span></div>
        <p class="muted small" id="dlgNote">${esc(kart ? host ? 'Choose the arena and rules for your next match.' : 'The host chooses the arena and rules.' : hostNote(host))}</p></div>
        <button class="btn ghost dlg-x" id="dlgClose">Close</button>
      </div>
      <div class="conf-err" id="dlgErr" role="alert" hidden></div>
      ${kart ? kartSetupHtml(g, current, host) : schema.settings.length ? `<h3 class="dlg-sec">Rounds &amp; timing</h3>
        <div class="dlg-grid">${schema.settings.map((s) => settingField(g, s, current, host)).join('')}</div>` : ''}
      ${schema.packs.length ? `<h3 class="dlg-sec">Word &amp; prompt lists</h3>
        ${schema.packs.map((p) => packField(g, p, meta, host)).join('')}` : ''}
      ${kart ? '<details class="ks-extra"><summary>Saved presets</summary><div class="ks-extra-content">' : '<h3 class="dlg-sec">Presets <span class="muted small">· Saved on this device</span></h3>'}
      <div id="dlgPresets">${presetListHtml(g, host)}</div>
      <div class="row dlg-presetrow">
        <input id="dlgPresetName" type="text" maxlength="40" placeholder="Preset name — e.g. Quick rounds"
          style="flex:1" data-hostonly ${host ? '' : 'disabled'}>
        <button class="btn ghost" id="dlgPresetSave" data-hostonly ${host ? '' : 'disabled'}>Save preset</button>
      </div>
      ${kart ? '</div></details>' : ''}
      <p class="muted small" id="dlgStatus" role="status" hidden></p>
      <div class="row mt dlg-foot">
        <button class="btn" id="dlgSave" data-hostonly ${host ? '' : 'disabled'}>Save settings</button>
        <button class="btn ghost" id="dlgReset" data-hostonly ${host ? '' : 'disabled'}>Reset to defaults</button>
      </div>
    </div>
  </div>`;
  const say = (m) => { if (toast) toast(m); };

  document.getElementById('dlgClose').onclick = () => { closeCustomizer(); };
  document.getElementById('dlgOverlay').addEventListener('mousedown', (e) => {
    if (e.target.id === 'dlgOverlay') closeCustomizer();
  });
  document.addEventListener('keydown', escCloser);
  document.getElementById('dlg-root').addEventListener('keydown', tabTrap);

  for (const p of (schema.packs || [])) {
    const ta = document.getElementById(`dp-${g.id}-${p.key}`);
    if (ta) ta.addEventListener('input', () => updatePackCount(g, p));
    updatePackCount(g, p);
  }

  document.getElementById('dlgSave').onclick = () => {
    if (!dlg || !dlg.host) return;
    clearError();
    for (const input of root.querySelectorAll('input[type="number"]')) {
      if (!input.checkValidity()) { input.reportValidity(); return; }
    }
    const settings = collectDialogSettings(g), packs = collectDialogPacks(g);
    const requestId = pendingConfig('save');
    if (onSave(g.id, settings, packs, requestId) === false) customizerError(g.id, 'Reconnect before saving settings.');
  };
  document.getElementById('dlgReset').onclick = () => {
    if (!dlg || !dlg.host) return;
    clearError();
    // Clear typed drafts so defaults show through on next open.
    for (const s of (schema.settings || [])) {
      const el = document.getElementById(`df-${g.id}-${s.key}`);
      if (el) {
        if (el.type === 'checkbox') el.checked = !!s.def;
        else el.value = s.def === null || s.def === undefined ? '' : s.def;
      }
    }
    for (const p of (schema.packs || [])) {
      const el = document.getElementById(`dp-${g.id}-${p.key}`);
      if (el) {
        el.value = '';
        updatePackCount(g, p);
      }
    }
    syncKartSetup(g);
    const requestId = pendingConfig('reset');
    if (onReset(g.id, requestId) === false) customizerError(g.id, 'Reconnect before saving settings.');
  };

  root.querySelectorAll('[data-dpacksave]').forEach((b) => {
    b.onclick = () => {
      const [gid, key] = b.dataset.dpacksave.split(':');
      const el = document.getElementById(`dp-${gid}-${key}`);
      store.set(savedPackKey(gid, key), JSON.stringify(packLines(el ? el.value : '')));
      say('List saved on this device');
    };
  });
  root.querySelectorAll('[data-dpackload]').forEach((b) => {
    b.onclick = () => {
      const [gid, key] = b.dataset.dpackload.split(':');
      let lines = [];
      try { lines = JSON.parse(store.get(savedPackKey(gid, key)) || '[]'); } catch {}
      const el = document.getElementById(`dp-${gid}-${key}`);
      if (el) {
        el.value = lines.join('\n');
        const p = (schema.packs || []).find((x) => x.key === key);
        if (p) updatePackCount(g, p);
      }
      say(lines.length ? 'Saved list loaded (press Save settings to use it)' : 'No saved list on this device');
    };
  });
  root.querySelectorAll('[data-dpackclear]').forEach((b) => {
    b.onclick = () => {
      const [gid, key] = b.dataset.dpackclear.split(':');
      const el = document.getElementById(`dp-${gid}-${key}`);
      if (el) {
        el.value = '';
        const p = (schema.packs || []).find((x) => x.key === key);
        if (p) updatePackCount(g, p);
      }
      onClearPack(gid, key);
    };
  });
  root.querySelectorAll('[data-dpackexport]').forEach((b) => {
    b.onclick = () => {
      const [gid, key] = b.dataset.dpackexport.split(':');
      const el = document.getElementById(`dp-${gid}-${key}`);
      const blob = new Blob([JSON.stringify({ game: gid, [key]: packLines(el ? el.value : '') }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${gid}-${key}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    };
  });
  root.querySelectorAll('[data-dpackimport]').forEach((inp) => {
    inp.onchange = () => {
      const [gid, key] = inp.dataset.dpackimport.split(':');
      const f = inp.files && inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let lines = [];
        const text = String(rd.result || '');
        try {
          const j = JSON.parse(text);
          if (Array.isArray(j)) lines = j.map(String);
          else if (j && Array.isArray(j[key])) lines = j[key].map(String);
          else { say('JSON has no "' + key + '" array'); return; }
        } catch {
          lines = packLines(text);
        }
        const el = document.getElementById(`dp-${gid}-${key}`);
        if (el) {
          el.value = lines.join('\n');
          const p = (schema.packs || []).find((x) => x.key === key);
          if (p) updatePackCount(g, p);
        }
        say(lines.length ? `${lines.length} items imported (press Save settings to use them)` : 'Nothing to import');
      };
      rd.readAsText(f);
      inp.value = '';
    };
  });

  const refreshPresets = () => {
    document.getElementById('dlgPresets').innerHTML = presetListHtml(g, dlg.host);
    wirePresetBtns();
  };
  const wirePresetBtns = () => {
    root.querySelectorAll('[data-dpresetload]').forEach((b) => {
      b.onclick = () => {
        const list = loadPresets(g.id);
        const p = list[Number(b.dataset.dpresetload)];
        if (!p) return;
        fillDialog(g, p.settings, p.pack);
        say(`Preset “${p.name}” loaded (press Save settings to use it)`);
      };
    });
    root.querySelectorAll('[data-dpresetdel]').forEach((b) => {
      b.onclick = () => {
        const list = loadPresets(g.id);
        list.splice(Number(b.dataset.dpresetdel), 1);
        savePresets(g.id, list);
        refreshPresets();
        say('Preset deleted');
      };
    });
  };
  wirePresetBtns();
  wireKartSetup(g);
  syncKartSetup(g, { repair: host, announce: true });
  document.getElementById('dlgPresetSave').onclick = () => {
    const nm = document.getElementById('dlgPresetName');
    const name = (nm.value || '').trim();
    if (!name) { say('Name the preset first'); return; }
    const list = loadPresets(g.id).filter((p) => p.name !== name);
    list.unshift({ name, settings: collectDialogSettings(g), pack: collectDialogPacks(g) });
    savePresets(g.id, list);
    nm.value = '';
    refreshPresets();
    say(`Preset “${name}” saved on this device`);
  };

  // A map shortcut reveals the arena choice before focusing it.
  const requested = kart ? root.querySelector('.ks-map[aria-checked="true"]')
    : initialField && document.getElementById(`df-${g.id}-${initialField}`);
  const first = (requested && !requested.disabled ? requested : null)
    || root.querySelector('.dlg input:not([disabled]):not([type=file]), .dlg select:not([disabled]), .dlg textarea:not([disabled])')
    || document.getElementById('dlgClose');
  if (first === requested && !kart) first.scrollIntoView({ block: 'nearest' });
  if (first && first.focus) {
    try { first.focus({ preventScroll: true }); } catch { first.focus(); }
  }
}

function escCloser(e) {
  if (e.key === 'Escape' && dlg) {
    e.stopPropagation();
    closeCustomizer();
    document.removeEventListener('keydown', escCloser);
  } else if (!dlg) {
    document.removeEventListener('keydown', escCloser);
  }
}

/* Minimal focus trap: keep Tab cycling inside the dialog. */
function tabTrap(e) {
  if (!dlg || e.key !== 'Tab') return;
  const root = document.getElementById('dlg-root');
  const items = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), label.howto-btn, summary')]
    .filter((el) => el.tabIndex !== -1 && (el.offsetParent !== null || el === document.activeElement));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
