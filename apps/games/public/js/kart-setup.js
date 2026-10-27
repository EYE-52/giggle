import { esc } from './util.js';

// Menu previews are small captures of the shipped worlds, keyed by profile
// as well as map ID: the classic and elevated gardens are different arenas.
export const KART_ARENAS = [
  { label: 'Alpine Courtyard', key: 'elevated-garden', elevated: true, description: 'Two climbs, a raised courtyard and an underpass.' },
  { label: 'Frost Quarry', key: 'elevated-frost', elevated: true, description: 'Ice shortcuts, a high bridge and quarry ramps.' },
  { label: 'Neon Harbor', key: 'elevated-neon', elevated: true, description: 'Cargo cover, a loading deck and two climbs.' },
  { label: 'Harbor Heights', key: 'elevated-harbor', elevated: true, description: 'A larger arena with bridges, balconies and four climbs.' },
  { label: 'Rookie Ring', key: 'legacy-ring', description: 'A small, open arena for close battles.' },
  { label: 'Bumper Blocks', key: 'legacy-blocks', description: 'A small arena with four solid cover blocks.' },
  { label: 'Garden Circuit', key: 'legacy-garden', description: 'Rolling roads, hedge cover and boost strips.' },
  { label: 'Frosty Pass', key: 'legacy-frost', description: 'Snowy ridges and slippery ice shortcuts.' },
  { label: 'Neon Yard', key: 'legacy-neon', description: 'Raised cargo lanes, cover and boost strips.' },
];
const MODES = {
  'Zap Battle': ['Battle', 'Collect weapons and score knockouts.'],
  'Garage Battle': ['Garage', 'Earn coins in battles and upgrade your kart between rounds.'],
  'Star Rush': ['Star Rush', 'Collect stars around the arena.'],
};
const elevated = map => KART_ARENAS.some(a => a.label === map && a.elevated);
// Round length is offered in whole minutes (1 to 5, default 3) and stored
// in seconds under the existing roundSeconds key.
export const ROUND_MINUTES = [1, 2, 3, 4, 5];
export function roundMinutes(seconds) {
  const n = Number(seconds);
  return Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n / 60 : 3)));
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

function choices(g, key, values, selected, host, labels = {}) {
  return `<input type="hidden" id="df-${g.id}-${key}" value="${esc(selected)}" data-hostonly ${host ? '' : 'disabled'}>
    <div class="ks-choices" role="radiogroup" aria-label="${esc({ winRule: 'Win rule', mode: 'Mode', palette: 'Lighting', roundSeconds: 'Round length' }[key] || 'Light cycle')}">
    ${values.map(value => `<button type="button" class="ks-choice" role="radio" aria-checked="${value === selected}" tabindex="${value === selected ? 0 : -1}" data-kart-key="${key}" data-kart-value="${esc(value)}" data-hostonly ${host ? '' : 'disabled'}>${esc(labels[value] || value)}</button>`).join('')}</div>`;
}

export function kartSetupHtml(g, current, host) {
  const settings = Object.fromEntries(g.schema.settings.map(s => [s.key, current[s.key] ?? s.def]));
  const field = key => g.schema.settings.find(s => s.key === key);
  const arenas = KART_ARENAS.filter(a => field('map').options.includes(a.label));
  const arena = arenas.find(a => a.label === settings.map) || arenas[0];
  const dis = host ? '' : 'disabled';
  const number = (key, label, step) => {
    const s = field(key);
    return `<div class="ks-rule" data-kart-rule="${key}"><label for="df-${g.id}-${key}">${label}</label><div class="ks-stepper">
      <button type="button" data-kart-step="${key}" data-delta="-${step}" aria-label="Decrease ${label.toLowerCase()}" data-hostonly ${dis}>−</button>
      <input id="df-${g.id}-${key}" type="number" min="${s.min}" max="${s.max}" value="${settings[key]}" data-hostonly ${dis}>
      <button type="button" data-kart-step="${key}" data-delta="${step}" aria-label="Increase ${label.toLowerCase()}" data-hostonly ${dis}>+</button></div></div>`;
  };
  return `<section class="ks-mode"><h3>How are we playing?</h3>
    ${choices(g, 'mode', field('mode').options, settings.mode, host, Object.fromEntries(Object.entries(MODES).map(([k,v]) => [k,v[0]])))}
    <p class="ks-mode-note" id="kartModeNote">${esc(MODES[settings.mode]?.[1] || '')}</p></section>
    <section class="ks-arena"><div class="ks-section-head"><h3>Choose your arena</h3><span class="ks-arena-name" id="kartArenaName">${esc(arena.label)}</span></div>
      <figure class="ks-preview"><img id="kartArenaPreview" src="/assets/karts/previews/${arena.key}.webp" width="480" height="270" alt="${esc(arena.label)} arena overview"><figcaption id="kartArenaDescription">${esc(arena.description)}</figcaption></figure>
      <input type="hidden" id="df-${g.id}-map" value="${esc(settings.map)}">
      <div class="ks-map-nav"><button type="button" class="ks-map-arrow" data-kart-scroll="-1" aria-label="Previous arenas">‹</button>
        <div class="ks-map-list" role="radiogroup" aria-label="Arena">${arenas.map(a => `<button type="button" class="ks-map" role="radio" aria-label="${esc(a.label)}" aria-checked="${a.label === settings.map}" tabindex="${a.label === settings.map ? 0 : -1}" data-kart-key="map" data-kart-value="${esc(a.label)}" data-hostonly ${dis}>
          <img src="/assets/karts/previews/${a.key}.webp" width="480" height="270" alt=""><span>${esc(a.label)}</span></button>`).join('')}</div>
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
      const choices = [...b.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')].filter(c => !c.disabled);
      if (!choices.length) return;
      e.preventDefault();
      const i = choices.indexOf(b);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1
        : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
      choices[n].click(); choices[n].focus({ preventScroll: true });
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
