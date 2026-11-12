import { esc, uiIcon } from './util.js';

// Menu previews are small views of the shipped worlds, keyed by profile
// as well as map ID: the classic and elevated gardens are different arenas.
export const KART_ARENAS = [
  { label: 'Rookie Ribbons', key: 'arena-rookie-ribbons', elevated: true, launch: true, players: '2–8', levels: 2, description: 'Two toy lobes, a real arch bridge and two gentle climbs. A smaller duel arena for two.' },
  { label: 'Garden Crown', key: 'arena-garden-crown', elevated: true, launch: true, players: '4–16', levels: 2, description: 'A crown walk around the fountain. Two garden climbs, shelter below and a marked drop.' },
  { label: 'Frostbite Crescent', key: 'arena-frostbite-crescent', elevated: true, launch: true, players: '6–16', levels: 2, description: 'Dry shore or slippery ice. Climb the quarry shelf, or jump the inlet beside its shore bypass.' },
  { label: 'Neon Switchyard', key: 'arena-neon-switchyard', elevated: true, launch: true, players: '6–24', levels: 2, description: 'Offset market streets under two sign bridges. Cyan A and pink B mark the crossings.' },
  { label: 'Harbor Fork', key: 'arena-harbor-fork', elevated: true, complex: true, launch: true, players: '8–32', levels: 3, description: 'Three cargo fingers, two cross-dock bridges and a high harbor lookout.' },
  { label: 'Skyport Split', key: 'arena-skyport-split', elevated: true, complex: true, launch: true, players: '8–32', levels: 3, description: 'Twin parking towers, a two-turn helix and a roof gap with a safe bridge around it.' },
  { label: 'Foundry Wheel', key: 'arena-foundry-wheel', elevated: true, complex: true, launch: true, players: '8–32', levels: 3, description: 'Three furnace rings, opposing belt lanes, service tunnels and a high sorter.' },
  { label: 'Skyport', players: '8–32', key: 'elevated-skyport', elevated: true, complex: true, description: 'Three floors, a spiral car park, roof jumps and sky bridges.' },
  { label: 'Foundry', players: '8–32', key: 'elevated-foundry', elevated: true, complex: true, description: 'Three floors, furnace tunnels, moving belts and a high gantry.' },
  { label: 'Alpine Courtyard', players: '2–8', key: 'elevated-garden', elevated: true, description: 'Two climbs, a raised courtyard and an underpass.' },
  { label: 'Frost Quarry', players: '2–8', key: 'elevated-frost', elevated: true, description: 'Ice shortcuts, a high bridge and a marked quarry shaft.' },
  { label: 'Neon Harbor', players: '2–8', key: 'elevated-neon', elevated: true, description: 'Cargo cover, two climbs and a marked dock basin.' },
  { label: 'Harbor Heights', players: '4–12', key: 'elevated-harbor', elevated: true, description: 'A larger arena with bridges, balconies and four climbs.' },
  { label: 'Rookie Ring', players: '2–8', key: 'legacy-ring', description: 'A small, open arena for close battles.' },
  { label: 'Bumper Blocks', players: '2–8', key: 'legacy-blocks', description: 'A small arena with four solid cover blocks.' },
  { label: 'Garden Circuit', players: '4–16', key: 'legacy-garden', description: 'Rolling roads, hedge cover and boost strips.' },
  { label: 'Frosty Pass', players: '4–16', key: 'legacy-frost', description: 'Snowy ridges and slippery ice shortcuts.' },
  { label: 'Neon Yard', players: '6–24', key: 'legacy-neon', description: 'Raised cargo lanes, cover and boost strips.' },
];
const MODES = {
  'Zap Battle': ['Battle', 'Collect weapons and score knockouts.'],
  'Garage Battle': ['Garage', 'Earn coins in battles and upgrade your kart between rounds.'],
  'Star Rush': ['Star Rush', 'Collect stars around the arena.'],
};
const elevated = map => KART_ARENAS.some(a => a.label === map && a.elevated);
// Round length is offered in whole minutes (1 to 5, default 3) and stored
// in seconds under the existing roundSeconds key.
export const ROUND_MINUTES = [1, 2, 3, 5, 10, 15];
// Snap any length (legacy or custom) to the nearest offered option;
// ties round up, as Math.round did for whole minutes.
export function roundMinutes(seconds) {
  const n = Number(seconds), m = Number.isFinite(n) ? n / 60 : 3;
  return ROUND_MINUTES.reduce((best, v) => Math.abs(v - m) <= Math.abs(best - m) ? v : best, ROUND_MINUTES[0]);
}

export function kartSetupSummary(g, current) {
  const settings = Object.fromEntries(g.schema.settings.map(s => [s.key, current[s.key] ?? s.def]));
  const timed = settings.winRule !== 'Score target';
  const duration = `${roundMinutes(settings.roundSeconds)} min`;
  const bits = [MODES[settings.mode]?.[0] || settings.mode, settings.map];
  if (!timed) bits.push(settings.mode === 'Star Rush'
    ? `First to ${settings.targetStars} stars` : `First to ${settings.targetHits} KOs`);
  bits.push(duration + (timed ? '' : ' max'));
  bits.push(settings.lightCycle === 'Live sunset' ? 'Live sunset'
    : ({ Daybreak: 'Day', Sunset: 'Sunset', Starlight: 'Night' }[settings.palette] || settings.palette));
  return bits.join(' · ');
}

// Keep all settings, including inactive targets. Configure replaces the
// settings object, and switching modes must not discard a host's draft.
const snapRound = v => typeof v === 'string' ? String(roundMinutes(v) * 60) : roundMinutes(v) * 60;

// Elevated arenas play Zap Battle only; either win rule works everywhere.
export function resolveKartSetup(settings, changedKey) {
  const next = { ...settings };
  if (next.roundSeconds !== undefined) next.roundSeconds = snapRound(next.roundSeconds);
  if (elevated(next.map) && next.mode !== 'Zap Battle') {
    if (changedKey === 'mode') next.map = 'Garden Circuit';
    else next.mode = 'Zap Battle';
  }
  return next;
}

const MODE_ICONS = { 'Zap Battle': 'lightning', 'Garage Battle': 'wrench', 'Star Rush': 'star' };
function choices(g, key, values, selected, host, labels = {}, cards = false) {
  return `<input type="hidden" id="df-${g.id}-${key}" value="${esc(selected)}" data-hostonly ${host ? '' : 'disabled'}>
    <div class="ks-choices${cards ? ' ks-cards' : ''}" role="radiogroup" aria-label="${esc({ winRule: 'Win rule', mode: 'Mode', palette: 'Lighting', roundSeconds: 'Round length' }[key] || 'Light cycle')}">
    ${values.map(value => `<button type="button" class="ks-choice" role="radio" aria-checked="${value === selected}" tabindex="${value === selected ? 0 : -1}" data-kart-key="${key}" data-kart-value="${esc(value)}" data-hostonly ${host ? '' : 'disabled'}>${cards
      ? `<span class="ks-card-ico" aria-hidden="true">${uiIcon(MODE_ICONS[value] || 'flag-checkered', 30)}</span><b>${esc(labels[value] || value)}</b><span class="ks-card-note">${esc(MODES[value]?.[1] || '')}</span>`
      : esc(labels[value] || value)}</button>`).join('')}</div>`;
}

export function kartSetupHtml(g, current, host) {
  const settings = Object.fromEntries(g.schema.settings.map(s => [s.key, current[s.key] ?? s.def]));
  const field = key => g.schema.settings.find(s => s.key === key);
  const arenas = KART_ARENAS.filter(a => field('map').options.includes(a.label));
  const arena = KART_ARENAS.find(a => a.label === settings.map) || arenas.find(a => a.launch);
  const dis = host ? '' : 'disabled';
  const number = (key, label, step) => {
    const s = field(key);
    return `<div class="ks-rule" data-kart-rule="${key}"><label for="df-${g.id}-${key}">${label}</label><div class="ks-stepper">
      <button type="button" data-kart-step="${key}" data-delta="-${step}" aria-label="Decrease ${label.toLowerCase()}" data-hostonly ${dis}>−</button>
      <input id="df-${g.id}-${key}" class="picker-value" type="number" min="${s.min}" max="${s.max}" value="${settings[key]}" data-hostonly ${dis}>
      <button type="button" data-kart-step="${key}" data-delta="${step}" aria-label="Increase ${label.toLowerCase()}" data-hostonly ${dis}>+</button></div></div>`;
  };
  return `<section class="ks-mode"><h3>How are we playing?</h3>
    ${choices(g, 'mode', field('mode').options, settings.mode, host, Object.fromEntries(Object.entries(MODES).map(([k,v]) => [k,v[0]])), true)}
    <p class="ks-mode-note" id="kartModeNote">${esc(MODES[settings.mode]?.[1] || '')}</p></section>
    <section class="ks-arena"><div class="ks-section-head"><h3>Choose your arena</h3><span class="ks-arena-name" id="kartArenaName">${esc(arena.label)}</span></div>
      <figure class="ks-preview"><img id="kartArenaPreview" src="/assets/karts/previews/${arena.key}.webp" width="480" height="270" alt="${esc(arena.label)} arena overview"><figcaption id="kartArenaDescription">${esc(arena.description)}</figcaption></figure>
      <input type="hidden" id="df-${g.id}-map" value="${esc(settings.map)}">
      <p class="ks-capacity">Every arena supports 2–32 drivers.</p>
      <div class="ks-map-nav"><button type="button" class="ks-map-arrow" data-kart-scroll="-1" aria-label="Previous arenas">‹</button>
        <div class="ks-map-list" role="radiogroup" aria-label="Arena">${arenas.map(a => `<button type="button" class="ks-map" data-kart-elevated="${Boolean(a.elevated)}" ${a.elevated && settings.mode !== 'Zap Battle' ? 'hidden' : ''} role="radio" aria-label="${esc(a.label + (a.complex ? ", three levels" : a.elevated ? ", elevated" : ", classic") + ", suggested for " + a.players + " drivers. " + a.description)}" aria-checked="${a.label === settings.map}" tabindex="${a.label === settings.map ? 0 : -1}" data-kart-key="map" data-kart-value="${esc(a.label)}" data-hostonly ${dis}>
          <img src="/assets/karts/previews/${a.key}.webp" width="480" height="270" alt=""><span>${esc(a.label)}</span><small>Best with ${a.players} drivers</small></button>`).join('')}</div>
        <button type="button" class="ks-map-arrow" data-kart-scroll="1" aria-label="More arenas">›</button></div>
      <p class="ks-change-note" id="kartSetupNotice" role="status"></p></section>
    <section class="ks-rules"><h3>Match rules</h3><div class="ks-rule-row">
      <div class="ks-rule ks-rule-wide"><span class="ks-rule-label">Round length</span>${choices(g, 'roundSeconds', ROUND_MINUTES.map(m => String(m * 60)), String(roundMinutes(settings.roundSeconds) * 60), host, Object.fromEntries(ROUND_MINUTES.map(m => [String(m * 60), `${m} min`])))}</div>
      <div class="ks-rule"><span class="ks-rule-label">Finish at</span>${choices(g, 'winRule', field('winRule').options, settings.winRule, host, { 'Time limit': 'Time limit', 'Score target': 'Score target' })}</div>
      <div class="ks-rule-slot">${number('targetHits', 'Knockouts to win', 1)}${number('targetStars', 'Stars to win', 1)}</div></div>
      <p class="ks-rule-note" id="kartRuleNote"></p>
</section>
    <details class="ks-extra"><summary>Lighting</summary><div class="ks-extra-content">
      <span class="ks-rule-label">Arena lighting</span>${choices(g, 'palette', field('palette').options, settings.palette, host, { Daybreak: 'Day', Sunset: 'Sunset', Starlight: 'Night' })}
      <span class="ks-rule-label">Light cycle</span>${choices(g, 'lightCycle', field('lightCycle').options, settings.lightCycle, host)}</div></details>`;
}

export function syncKartSetup(g, { repair = false, changedKey, announce = false } = {}) {
  if (g.id !== 'pocket-karts') return;
  const root = document.getElementById('dlg-root');
  const values = Object.fromEntries(g.schema.settings.map(s => [s.key, document.getElementById(`df-${g.id}-${s.key}`)?.value]));
  const next = repair ? resolveKartSetup(values, changedKey) : { ...values, roundSeconds: snapRound(values.roundSeconds) };
  for (const [key, value] of Object.entries(next)) document.getElementById(`df-${g.id}-${key}`).value = value;
  for (const b of root.querySelectorAll('[data-kart-key]')) {
    const selected = next[b.dataset.kartKey] === b.dataset.kartValue;
    b.setAttribute('aria-checked', String(selected));
    b.tabIndex = selected ? 0 : -1;
    if(b.dataset.kartKey === 'map') b.hidden = b.dataset.kartElevated === 'true' && next.mode !== 'Zap Battle';
  }
  const arena = KART_ARENAS.find(a => a.label === next.map);
  if (arena) {
    const image = document.getElementById('kartArenaPreview');
    image.src = `/assets/karts/previews/${arena.key}.webp`;
    image.alt = `${arena.label} arena overview`;
    document.getElementById('kartArenaName').textContent = arena.label;
    document.getElementById('kartArenaDescription').textContent = arena.description;
  }
  const selectedMap = root.querySelector('.ks-map[aria-checked="true"]');
  const mapList = root.querySelector('.ks-map-list');
  if (selectedMap && mapList && (changedKey === 'map' || repair)) {
    mapList.scrollLeft = selectedMap.offsetLeft - mapList.offsetLeft - (mapList.clientWidth - selectedMap.offsetWidth) / 2;
  }
  document.getElementById('kartModeNote').textContent = MODES[next.mode]?.[1] || '';
  const target = next.winRule === 'Score target';
  // The target stepper keeps its slot when hidden, so the dialog never jumps.
  root.querySelector('[data-kart-rule="targetHits"]').hidden = next.mode === 'Star Rush';
  root.querySelector('[data-kart-rule="targetStars"]').hidden = next.mode !== 'Star Rush';
  root.querySelector('.ks-rule-slot')?.classList.toggle('ks-off', !target);
  for (const input of root.querySelectorAll('.ks-rule-slot input, .ks-rule-slot button')) {
    if (!target) input.disabled = true;
    else input.disabled = root.querySelector('#dlgSave')?.disabled ?? false;
  }
  const minutes = roundMinutes(next.roundSeconds);
  document.getElementById('kartRuleNote').textContent = target
    ? `The first to reach the target wins. Otherwise the round ends after ${minutes} min.`
    : `Most ${next.mode === 'Star Rush' ? 'stars' : 'knockouts'} after ${minutes} min wins.`;
  const changed = next.map !== values.map || next.mode !== values.mode;
  document.getElementById('kartSetupNotice').textContent = announce && changed
    ? elevated(next.map) ? `${next.map} plays Zap Battle.` : `${next.mode} uses a classic arena.` : '';
}

export function wireKartSetup(g) {
  if (g.id !== 'pocket-karts') return;
  const root = document.getElementById('dlg-root');
  for (const b of root.querySelectorAll('[data-kart-key]')) {
    b.onclick = () => {
      if (b.disabled) return;
      const key = b.dataset.kartKey;
      document.getElementById(`df-${g.id}-${key}`).value = b.dataset.kartValue;
      syncKartSetup(g, { repair: true, changedKey: key, announce: true });
    };
    b.onkeydown = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const choices = [...b.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')].filter(c => !c.disabled && !c.hidden);
      if (!choices.length) return;
      e.preventDefault();
      const i = choices.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1
        : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
      choices[n].click(); choices[n].focus();
    };
  }
  for (const b of root.querySelectorAll('[data-kart-step]')) b.onclick = () => {
    if (b.disabled) return;
    const input = document.getElementById(`df-${g.id}-${b.dataset.kartStep}`);
    const value = Number(input.value);
    input.value = Math.max(Number(input.min), Math.min(Number(input.max), (Number.isFinite(value) ? value : Number(input.min)) + Number(b.dataset.delta)));
  };
  for (const b of root.querySelectorAll('[data-kart-scroll]')) b.onclick = () => {
    const list = root.querySelector('.ks-map-list');
    list.scrollBy({ left: Number(b.dataset.kartScroll) * list.clientWidth * .8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
}
