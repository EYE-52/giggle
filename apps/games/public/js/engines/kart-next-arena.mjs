import { KART_ARENAS } from './kart-arena-catalog.mjs';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arenaFor = map => {
  const label = typeof map === 'string' ? map : map?.label;
  const named = KART_ARENAS.find(a => a.label === label || a.key === label);
  // Classic snapshots can omit the label. Never match their reused ID to
  // an elevated garden/frost/neon with a different layout.
  return named || KART_ARENAS.find(a => a.key === `legacy-${map?.id || label}`);
};

// Both results views use the same catalog and acknowledged next-match route.
// The current snapshot remains untouched until the host starts a rematch.
export function createKartArenaPicker({ now = () => performance.now() } = {}) {
  let pending = null, notice = '';
  const context = api => api?.context?.() || {};
  function sync(state, api) {
    if (state?.phase !== 'done') { pending = null; notice = ''; return ''; }
    const ctx = context(api), settings = ctx.settings || {};
    if (ctx.isHost !== true) { pending = null; notice = ''; }
    if (pending) {
      if (settings.map === pending.label && (!pending.mode || settings.mode === pending.mode)) {
        api.announce?.(`Next arena: ${pending.label}. Applies on rematch.`);
        pending = null; notice = '';
      } else if (now() - pending.at > 5000) { pending = null; notice = 'Arena was not saved. Try again.'; }
    }
    return JSON.stringify([settings.map, settings.mode, ctx.isHost, typeof api?.configure, pending?.label, notice]);
  }
  function html(state, api) {
    const ctx = context(api), settings = ctx.settings || {}, active = arenaFor(state.map) || KART_ARENAS[0];
    const next = arenaFor(settings.map) || active, host = ctx.isHost === true;
    const canPick = host && state.phase === 'done' && typeof api?.configure === 'function';
    const battle = !settings.mode || settings.mode === 'Zap Battle';
    const note = pending ? `Saving ${pending.label}…` : notice || (typeof api?.configure !== 'function'
      ? 'Arena preview — host rematch settings unavailable here.'
      : host ? `Next: ${next.label} — applies on rematch.` : `Host picks next arena — showing ${next.label} next.`);
    return `<section class="pk-arenas" aria-label="Next arena"><header><h4>Next arena · ${KART_ARENAS.length} maps</h4><span class="pk-arena-note" role="status">${esc(note)}</span></header>${!battle ? '<p class="pk-arena-compat">Raised arenas play Battle. Choose a “Battle” map to switch the next match to Battle; classic maps keep your mode.</p>' : ''}<div class="pk-arenagrid">${KART_ARENAS.map(a => {
      const current = a.key === active.key, selected = a.key === next.key, switchesMode = a.elevated && !battle;
      const tag = pending?.label === a.label ? 'Saving…' : current && selected ? 'Now + Next' : selected ? 'Next' : current ? 'Now' : '';
      return `<button type="button" class="pk-arena" data-arena="${a.key}" ${canPick ? '' : 'disabled'} aria-disabled="${Boolean(pending) || !canPick}" aria-pressed="${selected}" aria-label="${esc(`${a.label}. ${a.description}${switchesMode ? ' Switch next match to Battle.' : ''}${current ? ' Current arena.' : ''}${selected ? ' Next arena.' : ''}${host ? '' : ' Host picks.'}`)}"><img class="pk-arena-preview" src="/assets/karts/previews/${a.key}.webp" width="480" height="270" alt="" decoding="async"><span class="pk-arenalabel">${esc(a.label)}</span>${switchesMode ? '<small class="pk-arena-mode">Battle</small>' : ''}${tag ? `<span class="pk-tag${selected && !current ? ' pk-next' : ''}">${tag}</span>` : ''}</button>`;
    }).join('')}</div></section>`;
  }
  function choose(event, state, api) {
    const button = event.target?.closest?.('[data-arena]'), ctx = context(api);
    if (!button || button.disabled || pending || state?.phase !== 'done' || ctx.isHost !== true || typeof api?.configure !== 'function') return false;
    const arena = KART_ARENAS.find(a => a.key === button.getAttribute('data-arena'));
    if (!arena || ctx.settings?.map === arena.label) return false;
    const mode = arena.elevated ? 'Zap Battle' : null;
    let queued = false;
    try { queued = api.configure({ map: arena.label, ...(mode ? { mode } : {}) }) === true; } catch { /* retry below */ }
    pending = queued ? { label: arena.label, mode, at: now() } : null;
    notice = queued ? '' : 'Arena was not saved. Try again.';
    return true;
  }
  return { sync, html, choose, reset() { pending = null; notice = ''; } };
}
