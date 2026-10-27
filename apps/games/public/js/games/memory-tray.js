/* Memory Tray view: a tray of recognizable objects. Memorize the tray,
 * then type what you recall. Built on the game kit; the object drawings are
 * real game art. Contracts: {recall}, {next:true} (host, reveal). Tray
 * items stay hidden during recall (server-enforced). */
import { esc, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, progressText, waitingHtml, resultsHtml } from '../kit.js';

let feedback = null;
let lastKey = '', current = null, clock = null;

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['memory-tray-css', '/css/memory-tray.css']];
function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('memory-tray-css')?.remove();
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase !== 'done' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5 && S.phase !== 'reveal');
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

/* Small original SVG object art keyed by word. Unknown words get a
 * deterministic medallion with their initial — never a bare text grid. */
const ICONS = {
  apple: '<circle cx="22" cy="26" r="13" fill="#d9486f"/><path d="M22 13c1-4 4-6 8-7" stroke="#1d7a3a" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="28" cy="9" rx="5" ry="3" fill="#1d7a3a"/>',
  key: '<circle cx="15" cy="22" r="8" fill="none" stroke="#c98f1b" stroke-width="5"/><path d="M21 26l14 12M30 30l-3 5M35 34l-3 5" stroke="#c98f1b" stroke-width="4" stroke-linecap="round"/>',
  balloon: '<ellipse cx="22" cy="18" rx="12" ry="14" fill="#e4572e"/><path d="M22 32l-3 6 6 0-3 6" stroke="#2b2620" stroke-width="2" fill="none"/>',
  book: '<path d="M8 8h12a6 6 0 016 6v22H14a6 6 0 01-6-6V8z" fill="#1d4ed8"/><path d="M8 8h12a6 6 0 016 6v22" fill="none" stroke="#fff" stroke-width="2"/><path d="M14 16h8M14 22h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  spoon: '<ellipse cx="17" cy="15" rx="8" ry="10" fill="#9aa7b0"/><rect x="21" y="22" width="5" height="18" rx="2" fill="#9aa7b0" transform="rotate(-18 23 30)"/>',
  hat: '<ellipse cx="22" cy="32" rx="16" ry="5" fill="#2b2620"/><path d="M12 32V20a10 8 0 0110-8v20" fill="#2b2620"/><path d="M12 32V20a10 8 0 0110-8" fill="#3a3547"/><rect x="12" y="27" width="20" height="4" fill="#d9486f"/>',
  clock: '<circle cx="22" cy="22" r="16" fill="#fff" stroke="#2b2620" stroke-width="3"/><path d="M22 22V11M22 22l8 5" stroke="#2b2620" stroke-width="3" stroke-linecap="round"/>',
  fish: '<ellipse cx="20" cy="22" rx="12" ry="8" fill="#1d9db8"/><path d="M30 22l9-7v14z" fill="#1d9db8"/><circle cx="14" cy="20" r="2" fill="#fff"/>',
  ball: '<circle cx="22" cy="22" r="15" fill="#fff" stroke="#2b2620" stroke-width="3"/><path d="M22 7v30M7 22h30" stroke="#d9486f" stroke-width="2"/><circle cx="22" cy="22" r="4" fill="#d9486f"/>',
  candle: '<rect x="17" y="18" width="10" height="18" rx="2" fill="#f2b134"/><ellipse cx="22" cy="10" rx="5" ry="7" fill="#f27b1d"/><ellipse cx="22" cy="12" rx="2" ry="3" fill="#ffe9a8"/>',
  cup: '<path d="M10 12h20v12a8 8 0 01-8 8h-4a8 8 0 01-8-8V12z" fill="#0f766e"/><path d="M30 14h4a5 5 0 010 10h-4" fill="none" stroke="#0f766e" stroke-width="3"/>',
  star: '<path d="M22 6l4.5 9.5L37 17l-7.5 7 2 10.5-9.5-5-9.5 5 2-10.5L7 17l10.5-1.5z" fill="#f2b134" stroke="#8a5a00" stroke-width="2" stroke-linejoin="round"/>',
  moon: '<path d="M28 6a16 16 0 000 32 12 12 0 010-32z" fill="#f4e9c8" stroke="#8a7a3a" stroke-width="2"/>',
  sun: '<circle cx="22" cy="22" r="9" fill="#f2b134"/><g stroke="#e4572e" stroke-width="3" stroke-linecap="round"><path d="M22 4v5M22 35v5M4 22h5M35 22h5M9 9l4 4M31 31l4 4M35 9l-4 4M13 31l-4 4"/></g>',
  heart: '<path d="M22 37S7 27 7 17a8 8 0 0115-3 8 8 0 0115 3c0 10-15 20-15 20z" fill="#d9486f"/>',
  tree: '<path d="M22 4l11 16h-6l8 12H9l8-12H11z" fill="#1d7a3a"/><rect x="19" y="30" width="6" height="8" fill="#8a5a2b"/>',
  car: '<path d="M6 28l4-10h16l6 6v8H6v-4z" fill="#e4572e"/><circle cx="14" cy="32" r="4" fill="#2b2620"/><circle cx="30" cy="32" r="4" fill="#2b2620"/><rect x="14" y="20" width="12" height="5" fill="#cfe8ef"/>',
  house: '<path d="M6 22L22 8l16 14v14H6V22z" fill="#f2b134"/><rect x="18" y="24" width="8" height="12" fill="#8a5a2b"/><rect x="11" y="24" width="5" height="5" fill="#cfe8ef"/>',
  dog: '<ellipse cx="22" cy="26" rx="12" ry="9" fill="#c98f5b"/><circle cx="22" cy="13" r="8" fill="#c98f5b"/><ellipse cx="15" cy="12" rx="3" ry="6" fill="#8a5a2b"/><ellipse cx="29" cy="12" rx="3" ry="6" fill="#8a5a2b"/><circle cx="19" cy="12" r="1.6" fill="#2b2620"/><circle cx="25" cy="12" r="1.6" fill="#2b2620"/><ellipse cx="22" cy="17" rx="2.5" ry="2" fill="#2b2620"/>',
  cat: '<circle cx="22" cy="25" r="11" fill="#6b6f76"/><path d="M13 18L11 8l8 5M31 18l2-10-8 5" fill="#6b6f76"/><circle cx="18" cy="24" r="1.6" fill="#fff"/><circle cx="26" cy="24" r="1.6" fill="#fff"/><path d="M18 31l4-2 4 2" stroke="#2b2620" stroke-width="2" fill="none" stroke-linecap="round"/>',
  bird: '<ellipse cx="22" cy="24" rx="10" ry="8" fill="#1d4ed8"/><circle cx="28" cy="14" r="6" fill="#1d4ed8"/><path d="M33 14l5 2-5 2z" fill="#f2b134"/><circle cx="29" cy="13" r="1.4" fill="#fff"/><path d="M12 22l-6-4M12 26l-6 0" stroke="#0d2f6b" stroke-width="2"/>',
  flower: '<g fill="#d9486f"><circle cx="22" cy="10" r="6"/><circle cx="22" cy="30" r="6"/><circle cx="12" cy="20" r="6"/><circle cx="32" cy="20" r="6"/></g><circle cx="22" cy="20" r="6" fill="#f2b134"/><rect x="20" y="30" width="4" height="10" fill="#1d7a3a"/>',
  guitar: '<circle cx="16" cy="28" r="9" fill="#c98f5b"/><circle cx="16" cy="28" r="3.5" fill="#2b2620"/><rect x="21" y="6" width="5" height="20" rx="2" fill="#8a5a2b" transform="rotate(24 23 16)"/>',
  phone: '<rect x="13" y="6" width="18" height="32" rx="4" fill="#2b2620"/><rect x="16" y="10" width="12" height="22" fill="#9fd8e8"/>',
  shoe: '<path d="M10 14h10v10l14 4v6H10V14z" fill="#b3352b"/><path d="M10 30h24v4H10z" fill="#2b2620"/><path d="M13 17h5M13 21h5" stroke="#fff" stroke-width="2"/>',
  pen: '<path d="M28 6l8 8-16 20-8-8z" fill="#1d4ed8"/><path d="M12 26l-4 8 8-4z" fill="#2b2620"/>',
  pencil: '<path d="M10 34l3-12L30 5l5 5-17 17-8 7z" fill="#f2b134"/><path d="M10 34l3-12 5 5-3 8z" fill="#e8d3ac"/><path d="M10 34l1.5-4 4 1.5z" fill="#2b2620"/><rect x="30" y="5" width="5" height="5" fill="#d9486f" transform="rotate(45 32 7)"/>',
  scissors: '<circle cx="13" cy="13" r="5" fill="none" stroke="#1d7a3a" stroke-width="3"/><circle cx="13" cy="31" r="5" fill="none" stroke="#1d7a3a" stroke-width="3"/><path d="M17 16l18 14M17 28L35 14" stroke="#9aa7b0" stroke-width="3" stroke-linecap="round"/>',
  umbrella: '<path d="M6 24a16 12 0 0116-12 16 12 0 0116 12z" fill="#d9486f"/><path d="M22 12v20a4 4 0 008 0" stroke="#2b2620" stroke-width="3" fill="none" stroke-linecap="round"/>',
  bell: '<path d="M10 30a12 12 0 0124 0z" fill="#f2b134"/><circle cx="22" cy="33" r="3" fill="#2b2620"/><rect x="20" y="4" width="4" height="6" fill="#2b2620"/>',
  ring: '<circle cx="22" cy="26" r="10" fill="none" stroke="#c98f1b" stroke-width="5"/><path d="M16 14l6-8 6 8z" fill="#9fd8e8" stroke="#2b2620" stroke-width="2"/>',
  dice: '<rect x="8" y="8" width="28" height="28" rx="6" fill="#fff" stroke="#2b2620" stroke-width="3"/><g fill="#2b2620"><circle cx="16" cy="16" r="2.4"/><circle cx="28" cy="16" r="2.4"/><circle cx="22" cy="22" r="2.4"/><circle cx="16" cy="28" r="2.4"/><circle cx="28" cy="28" r="2.4"/></g>',
  kite: '<path d="M22 5l12 12-12 12L10 17z" fill="#1d9db8"/><path d="M22 5v24M10 17h24" stroke="#fff" stroke-width="2"/><path d="M22 29l-4 8" stroke="#2b2620" stroke-width="2"/>',
  drum: '<ellipse cx="22" cy="13" rx="14" ry="6" fill="#f4e9c8" stroke="#2b2620" stroke-width="2"/><path d="M8 13v14a14 6 0 0014 6 14 6 0 0014-6V13" fill="#b3352b"/><path d="M14 6l4 5M30 6l-4 5" stroke="#2b2620" stroke-width="3" stroke-linecap="round"/>',
  hammer: '<rect x="8" y="8" width="16" height="8" rx="2" fill="#9aa7b0"/><rect x="20" y="13" width="5" height="24" rx="2" fill="#8a5a2b" transform="rotate(-18 22 24)"/>',
  crown: '<path d="M8 30l-2-18 8 6 8-12 8 12 8-6-2 18z" fill="#f2b134" stroke="#8a5a00" stroke-width="2" stroke-linejoin="round"/><circle cx="22" cy="24" r="2.5" fill="#d9486f"/>',
  pizza: '<path d="M8 12h28L22 36z" fill="#f2b134"/><path d="M8 12h28v4H8z" fill="#c98f5b"/><g fill="#b3352b"><circle cx="20" cy="20" r="2.4"/><circle cx="26" cy="24" r="2.4"/><circle cx="22" cy="28" r="2.4"/></g>',
  cake: '<rect x="8" y="22" width="28" height="12" rx="2" fill="#d9486f"/><rect x="8" y="18" width="28" height="6" fill="#f4e9c8"/><path d="M22 18v-8" stroke="#2b2620" stroke-width="3"/><ellipse cx="22" cy="7" rx="2.5" ry="3.5" fill="#f27b1d"/>',
  sock: '<path d="M16 6h10v14l8 8v6H22l-6-6V6z" fill="#1d4ed8"/><rect x="16" y="6" width="10" height="5" fill="#fff"/>',
  leaf: '<path d="M10 34C10 18 20 8 36 8c0 16-10 26-26 26z" fill="#1d7a3a"/><path d="M10 34C18 26 26 18 36 8" stroke="#0d4d24" stroke-width="2" fill="none"/>',
  lamp: '<path d="M15 6h14l7 17H8z" fill="#f2b134"/><path d="M22 23v12M13 37h18" stroke="#2b2620" stroke-width="3" stroke-linecap="round"/>',
  chair: '<path d="M12 6h20v20H12z" fill="#c98f5b"/><path d="M10 26h24M13 26v13M31 26v13" stroke="#8a5a2b" stroke-width="4" stroke-linecap="round"/>',
  coin: '<circle cx="22" cy="22" r="16" fill="#f2b134" stroke="#8a5a00" stroke-width="2"/><circle cx="22" cy="22" r="11" fill="none" stroke="#8a5a00" stroke-width="1.5"/><path d="M22 14v16M18 18l4-4" stroke="#8a5a00" stroke-width="3"/>',
  flag: '<path d="M10 6v33" stroke="#2b2620" stroke-width="3"/><path d="M12 7h22l-5 7 5 7H12z" fill="#b3352b"/>',
  glove: '<path d="M13 37V20l-5-5q-3-4 1-5l8 8V7q0-5 4-2v14V5q3-4 5 0v15V8q4-4 4 1v13V14q4-3 4 2v15l-5 6z" fill="#1d4ed8"/>',
  jar: '<rect x="12" y="11" width="20" height="27" rx="6" fill="#9fd8e8" stroke="#277083" stroke-width="2"/><rect x="11" y="6" width="22" height="7" rx="2" fill="#9aa7b0"/><path d="M17 18v12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
  magnet: '<path d="M11 7v19a11 11 0 0022 0V7" stroke="#b3352b" stroke-width="8" fill="none"/><path d="M11 7v7M33 7v7" stroke="#9aa7b0" stroke-width="8"/>',
  orange: '<circle cx="22" cy="25" r="14" fill="#f27b1d"/><path d="M22 12l3-6q8 0 10 5-7 4-13 1" fill="#1d7a3a"/><g fill="#e4572e"><circle cx="16" cy="23" r="1"/><circle cx="25" cy="31" r="1"/><circle cx="29" cy="20" r="1"/></g>',
  pillow: '<path d="M7 9q15 4 30 0-4 13 0 26-15-4-30 0 4-13 0-26z" fill="#d9486f" stroke="#a02c50" stroke-width="2"/><path d="M12 14l20 16" stroke="#f5b9cc" stroke-width="2"/>',
  rope: '<path d="M5 33q10-16 21-16t10 12q-5 14-17 5t-2-15q14-7 22-11" fill="none" stroke="#c98f5b" stroke-width="5" stroke-linecap="round"/><path d="M7 31l2 3M18 18l2 4M29 18l-1 4M34 29l4 1M20 31l-2 4" stroke="#8a5a2b" stroke-width="1"/>',
  tent: '<path d="M22 6L3 36h38z" fill="#1d7a3a"/><path d="M22 14L13 36h18z" fill="#23202b"/><path d="M22 14v22" stroke="#d9bd8a" stroke-width="2"/>',
  box: '<path d="M6 15l16-8 16 8v21H6z" fill="#c98f5b"/><path d="M6 15l16 7 16-7M22 22v14M14 11l16 7" fill="none" stroke="#8a5a2b" stroke-width="2"/>',
  button: '<circle cx="22" cy="22" r="16" fill="#1d4ed8" stroke="#0d2f6b" stroke-width="2"/><circle cx="22" cy="22" r="12" fill="none" stroke="#9fd8e8"/><g fill="#fff"><circle cx="18" cy="18" r="2"/><circle cx="26" cy="18" r="2"/><circle cx="18" cy="26" r="2"/><circle cx="26" cy="26" r="2"/></g>',
  camera: '<rect x="5" y="13" width="34" height="24" rx="4" fill="#3a3547"/><path d="M13 13l3-6h12l3 6" fill="#3a3547"/><circle cx="23" cy="25" r="8" fill="#9fd8e8" stroke="#fff" stroke-width="2"/><circle cx="23" cy="25" r="4" fill="#277083"/><rect x="8" y="17" width="5" height="3" fill="#f2b134"/>',
  fork: '<path d="M14 5v11q0 6 8 6t8-6V5M22 5v34" stroke="#9aa7b0" stroke-width="4" fill="none" stroke-linecap="round"/>',
  grape: '<g fill="#7e398a"><circle cx="15" cy="16" r="6"/><circle cx="26" cy="16" r="6"/><circle cx="11" cy="26" r="6"/><circle cx="22" cy="26" r="6"/><circle cx="33" cy="26" r="6"/><circle cx="22" cy="36" r="6"/></g><path d="M21 11V5q8-3 12 1-4 6-12 5" fill="#1d7a3a"/>',
  ladder: '<path d="M12 4v36M32 4v36M12 10h20M12 18h20M12 26h20M12 34h20" stroke="#c98f5b" stroke-width="4" stroke-linecap="round"/>',
  nest: '<path d="M5 24q17 5 34 0-3 15-17 15T5 24z" fill="#8a5a2b"/><g stroke="#d9bd8a" stroke-width="2"><path d="M8 28l28 5M10 35l23-7M15 24l19 12"/></g><ellipse cx="18" cy="21" rx="5" ry="8" fill="#fff"/><ellipse cx="28" cy="22" rx="5" ry="7" fill="#cfe8ef"/>',
  pear: '<path d="M22 9q-7 0-7 9C-1 36 13 40 22 40s23-4 7-22q0-9-7-9" fill="#9dbb36"/><path d="M22 10V4" stroke="#8a5a2b" stroke-width="3"/><path d="M23 7q7-6 12 0-7 4-12 0" fill="#1d7a3a"/>',
  radio: '<rect x="5" y="16" width="34" height="23" rx="4" fill="#b3352b"/><path d="M31 16l6-12" stroke="#9aa7b0" stroke-width="2"/><circle cx="15" cy="28" r="7" fill="#23202b"/><path d="M12 23v10M16 22v12" stroke="#9aa7b0"/><rect x="25" y="21" width="10" height="5" fill="#f4e9c8"/><circle cx="30" cy="32" r="3" fill="#f2b134"/>',
  shell: '<path d="M22 36L6 21Q3 6 14 8q8-7 16 0 11-2 8 13z" fill="#eab9a2" stroke="#c98f5b" stroke-width="2"/><path d="M22 36L12 12M22 36l-1-27M22 36l11-23" stroke="#c98f5b" stroke-width="2"/>',
  violin: '<path d="M14 18q-9-6-10 4l6 6q-7 10 3 12 8 1 10-8l-2-6q9-2 6-8z" fill="#c98f5b"/><path d="M18 27L31 5M32 8l4-5" stroke="#8a5a2b" stroke-width="4"/><path d="M12 34L30 8M6 30l30 6" stroke="#2b2620" stroke-width="1.5"/>',
  wheel: '<circle cx="22" cy="22" r="16" fill="none" stroke="#2b2620" stroke-width="5"/><circle cx="22" cy="22" r="4" fill="#9aa7b0"/><path d="M22 7v30M7 22h30M11 11l22 22M11 33l22-22" stroke="#9aa7b0" stroke-width="2"/>',
  yarn: '<circle cx="21" cy="22" r="14" fill="#d9486f"/><path d="M9 15q19 1 23 13M8 21q17 0 23 12M13 9q8 16 17 20M19 8q2 11 14 17M25 35q-1 7 14 3" stroke="#f5b9cc" stroke-width="2" fill="none"/>',
  zipper: '<path d="M14 5v35M30 5v35" stroke="#1d4ed8" stroke-width="5"/><path d="M17 8h10M17 15h10M17 22h10M17 29h10M17 36h10" stroke="#9aa7b0" stroke-width="4"/><rect x="18" y="11" width="8" height="13" rx="2" fill="#9aa7b0" stroke="#2b2620"/><path d="M22 15v5" stroke="#2b2620" stroke-width="2"/>',
  anchor: '<circle cx="22" cy="8" r="4" fill="none" stroke="#277083" stroke-width="3"/><path d="M22 12v26M14 18h16M6 26q0 12 16 12t16-12M6 26l-2 7M6 26l7 2M38 26l2 7M38 26l-7 2" stroke="#277083" stroke-width="3" fill="none" stroke-linecap="round"/>',
  bridge: '<path d="M3 24h38M9 8v28M35 8v28M9 10q13 17 26 0M16 19v5M28 19v5" stroke="#8a5a2b" stroke-width="3" fill="none"/><path d="M3 39q5-4 10 0t10 0 10 0 8 0" stroke="#1d9db8" stroke-width="2" fill="none"/>',
  lantern: '<path d="M14 10q0-12 16 0M11 12h22l-3 25H14z" fill="none" stroke="#2b2620" stroke-width="3"/><path d="M16 14h12v20H16z" fill="#ffd972"/><path d="M22 14v20M11 12h22M12 38h20" stroke="#2b2620" stroke-width="3"/>',
  mirror: '<ellipse cx="22" cy="17" rx="12" ry="14" fill="#9fd8e8" stroke="#c98f1b" stroke-width="3"/><path d="M22 31v9M17 40h10" stroke="#c98f1b" stroke-width="4"/><path d="M15 16l10-9M17 22l12-10" stroke="#fff" stroke-width="2"/>',
  compass: '<circle cx="22" cy="22" r="17" fill="#f4e9c8" stroke="#2b2620" stroke-width="3"/><path d="M22 8l-6 14h12z" fill="#b3352b"/><path d="M22 36l-6-14h12z" fill="#1d4ed8"/><path d="M8 22h3M33 22h3" stroke="#2b2620" stroke-width="2"/>',
  pumpkin: '<path d="M22 9V4" stroke="#1d7a3a" stroke-width="4"/><ellipse cx="22" cy="25" rx="17" ry="14" fill="#f27b1d"/><ellipse cx="22" cy="25" rx="8" ry="14" fill="none" stroke="#c95314" stroke-width="2"/><path d="M12 22l4-5 4 5M24 22l4-5 4 5M14 29q8 9 16 0" fill="#2b2620"/>',
  piano: '<rect x="4" y="11" width="36" height="22" rx="3" fill="#23202b"/><path d="M6 19h32v12H6z" fill="#fff"/><path d="M11 19v12M17 19v12M23 19v12M29 19v12M35 19v12" stroke="#23202b"/><path d="M14 19v6M20 19v6M32 19v6" stroke="#23202b" stroke-width="3"/>',
  cactus: '<path d="M22 32V9M22 22H12V14M22 27h10V18" fill="none" stroke="#1d7a3a" stroke-width="9" stroke-linecap="round"/><path d="M13 31h18l-3 10H16z" fill="#c98f5b"/>',
  owl: '<path d="M10 10l6 3 6-3 6 3 6-3v17a12 12 0 01-24 0z" fill="#8a5a2b"/><g fill="#f4e9c8"><circle cx="16" cy="21" r="6"/><circle cx="28" cy="21" r="6"/></g><g fill="#2b2620"><circle cx="16" cy="21" r="2"/><circle cx="28" cy="21" r="2"/></g><path d="M19 28h6l-3 5z" fill="#f2b134"/>',
  mitten: '<path d="M13 35V22l-5-5q-3-6 2-7l7 6V10q0-8 10-8t10 8v18l-7 7z" fill="#d9486f"/><path d="M13 34h17v7H13z" fill="#f5b9cc"/>',
  telescope: '<path d="M7 15l24-9 5 11-24 9z" fill="#f2b134" stroke="#8a5a00" stroke-width="2"/><path d="M30 5l6 13" stroke="#23202b" stroke-width="4"/><path d="M22 23v5M22 28l-10 13M22 28l11 13" stroke="#2b2620" stroke-width="3"/>',
  quilt: '<rect x="6" y="5" width="32" height="34" rx="2" fill="#d9486f"/><path d="M6 5h11v11H6M27 5h11v11H27M17 16h10v11H17M6 27h11v12H6M27 27h11v12H27" fill="#f2b134"/><path d="M6 16h32M6 27h32M17 5v34M27 5v34" stroke="#fff" stroke-width="1" stroke-dasharray="2 2"/>',
  napkin: '<path d="M6 7h30v31H6z" fill="#fff" stroke="#9aa7b0" stroke-width="2"/><path d="M6 7l30 31H6z" fill="#cfe8ef"/><path d="M10 32h12" stroke="#fff" stroke-width="2"/>',
  easel: '<path d="M22 3L9 40M22 3l13 37M12 31h20" stroke="#8a5a2b" stroke-width="3"/><rect x="9" y="8" width="26" height="21" fill="#fff" stroke="#c98f5b" stroke-width="2"/><circle cx="28" cy="14" r="3" fill="#f2b134"/><path d="M11 27l8-12 10 12z" fill="#1d7a3a"/>',
};

function iconFor(word) {
  const key = String(word || '').trim().toLowerCase();
  if (ICONS[key]) {
    return `<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false">${ICONS[key]}</svg>`;
  }
  // Deterministic medallion for custom words: stable hue + initial.
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const initial = (key.charAt(0) || '?').toUpperCase();
  return `<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false">` +
    `<circle cx="22" cy="22" r="19" fill="hsl(${hue} 55% 82%)" stroke="#2b2620" stroke-width="2"/>` +
    `<text x="22" y="30" text-anchor="middle" font-size="20" font-weight="800" fill="#2b2620" font-family="inherit">${esc(initial)}</text></svg>`;
}

function trayHtml(items, hits) {
  const got = new Set((hits || []).map((w) => String(w).toLowerCase()));
  return `<ul class="mt-tray" aria-label="Items on the tray">` +
    items.map((w) => `<li class="mt-obj${hits && got.has(String(w).toLowerCase()) ? ' is-hit' : ''}">${iconFor(w)}<span class="mt-name">${esc(w)}</span></li>`).join('') +
    `</ul>`;
}

function activeCount(S) { return (S.players || []).filter((p) => !p.left).length; }
function isPlayer(S) { return (S.players || []).some((p) => p.id === S.me); }

export default {
  styles: ['/css/compact-answer-games.css', '/css/memory-tray.css'],
  ownsTimer: true,
  dispose() {
    if (clock !== null) clearInterval(clock);
    clock = null; feedback = null; lastKey = ''; current = null; removeCss();
  },
  render(el, S, api) {
    current = { el, S, api };
    ensureCss();
    const feedbackKey = `${S.instanceId || ''}:${S.me}:${S.round}`;
    if (S.instanceId && !S.audioBaseline && !S.preparing && !S.spectator && feedback?.key === feedbackKey && feedback?.phase === 'recall' && S.phase === 'reveal' && S.last?.results?.[S.me]?.count > 0) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:recall-correct:${S.me}`, gain: 0.8 });
    }
    feedback = { key: feedbackKey, phase: S.phase };
    runClock(el, S, api);

    if (S.phase === 'done') {
      lastKey = `done:${S.instanceId || ''}`;
      el.innerHTML = `<section class="gk-final wg wg-final mt gk-col gk-stack" data-game="memory-tray" data-phase="done" aria-label="Memory Tray final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `</section>`;
      return;
    }
    const key = `${S.instanceId || ''}:${S.me || ''}:${S.phase}:${S.round}:${S.hostId || ''}:${S.spectator ? 'w' : 'p'}`;
    const round = roundLabel(S.round, S.rounds);

    if (key !== lastKey) {
      lastKey = key;
      if (S.phase === 'memorize') {
        el.innerHTML = `<section class="wg mt gk-col gk-stack" data-game="memory-tray" data-phase="memorize" aria-label="Memory Tray">`
          + hudHtml({ round, phase: S.spectator ? 'Watching' : 'Study', progress: `${(S.items || []).length} items`, timer: '' })
          + `<h2 class="gk-prompt">Remember everything on the tray</h2>`
          + trayHtml(S.items || [])
          + `<div class="wg-slot">${waitingHtml('The tray hides when the clock runs out')}</div>`
          + `</section>`;
        runClock(el, S, api);
        return;
      }
      if (S.phase === 'recall') {
        const lines = S.recallFormat === 'lines';
        const mine = S.myRecall ? S.myRecall.join(lines ? '\n' : ', ') : '';
        const dis = S.spectator ? 'disabled' : '';
        const field = lines
          ? `<textarea class="gk-input mt-area" id="mAns" rows="3" aria-label="Items you remember, one object per line" placeholder="One object per line…" maxlength="512" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" ${dis}>${esc(mine)}</textarea>`
          : `<input class="gk-input" id="mAns" type="text" aria-label="Items you remember, separated by commas" placeholder="apple, candle, key…" maxlength="512" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" value="${esc(mine)}" ${dis}>`;
        el.innerHTML = `<section class="wg mt gk-col gk-stack" data-game="memory-tray" data-phase="recall" aria-label="Memory Tray recall">`
          + hudHtml({ round, phase: S.spectator ? 'Watching' : 'Recall', progress: progressText((S.submitted || []).length, activeCount(S), 'saved'), timer: '' })
          + `<h2 class="gk-prompt">What was on the tray?</h2>`
          + `<p class="gk-sub wg-prompt-sub">${lines ? 'Write one object per line.' : 'List the objects you remember, separated by commas.'}</p>`
          + `<form class="gk-input-row mt-form${lines ? ' is-lines' : ''}" id="mForm" autocomplete="off">${field}<button class="gk-btn gk-primary" id="mSend" type="submit" ${dis}>Save</button></form>`
          + `<p class="wg-status" id="mState" role="status"></p>`
          + `<div class="wg-slot"><p class="gk-wait" id="mWait" role="status"></p></div>`
          + `</section>`;
        const send = () => {
          const inp = el.querySelector('#mAns');
          const live = current;
          if (live?.el === el && lastKey === key && live.S.phase === 'recall' && !live.S.preparing &&
              !live.S.spectator && isPlayer(live.S) && inp && !inp.disabled && inp.value.trim() &&
              !(live.S.endsAt > 0 && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt)) {
            const accepted = live.api.send({ recall: inp.value.trim(), ...(live.S.recallFormat === 'lines' ? { recallFormat: 'lines' } : {}) });
            const status = el.querySelector('#mState');
            if (status && accepted === false) status.textContent = 'Could not save yet. Your list is kept — try Save again when connected.';
          }
        };
        const form = el.querySelector('#mForm');
        if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
        const btn = el.querySelector('#mSend');
        if (btn) btn.onclick = (e) => { e?.preventDefault?.(); send(); };
        const inp = el.querySelector('#mAns');
        if (inp) {
          inp.onkeydown = (e) => { if (!lines && e.key === 'Enter' && !e.repeat && !e.isComposing && e.keyCode !== 229) { e.preventDefault?.(); send(); } };
        }
        runClock(el, S, api);
      } else if (S.phase === 'reveal' && S.last) {
        const res = S.last.results || {};
        const total = (S.last.items || []).length;
        const rows = [...(S.players || [])]
          .sort((a, b) => ((res[b.id] || {}).count || 0) - ((res[a.id] || {}).count || 0) || a.name.localeCompare(b.name))
          .map((p) => {
            const r = res[p.id] || { correct: [], count: 0, pts: 0 };
            const hits = (r.correct || []).map(esc).join(', ');
            return `<li class="wg-row${p.id === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(p.name)}${p.id === S.me ? ' <small>(you)</small>' : ''}</span>`
              + `<span class="wg-ans${hits ? '' : ' is-empty'}"><span class="wg-tag${r.count === total && total ? ' is-good' : ''}">${r.count} of ${total}</span> ${hits || 'nothing'}</span>`
              + `<span class="wg-pts${r.pts ? '' : ' is-zero'}">+${r.pts}</span></li>`;
          }).join('');
        const mine = res[S.me];
        const isHost = S.me === S.hostId && !S.spectator && isPlayer(S);
        el.innerHTML = `<section class="wg mt gk-col gk-stack" data-game="memory-tray" data-phase="reveal" aria-label="Memory Tray results">`
          + hudHtml({ round, phase: 'The tray', progress: `${total} items`, timer: '' })
          + `<h2 class="gk-prompt">The tray held…</h2>`
          + trayHtml(S.last.items || [], mine ? mine.correct : null)
          + `<p class="wg-status${mine?.pts ? ' is-good' : ''}" role="status">${S.spectator || !isPlayer(S) ? 'You are watching.' : mine ? `You remembered ${mine.count} of ${total}: +${mine.pts}` : 'You did not save a list.'}</p>`
          + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="mNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next tray soon')}</div>`
          + `<ol class="wg-rows" aria-label="What everyone remembered">${rows}</ol>`
          + `</section>`;
        const nx = el.querySelector('#mNext');
        if (nx) nx.onclick = () => {
          const live = current;
          if (live?.el === el && lastKey === key && !live.S.preparing && !live.S.spectator && isPlayer(live.S) && live.S.me === live.S.hostId) live.api.send({ next: true });
        };
        runClock(el, S, api);
      }
    }
    if (S.phase === 'recall') {
      const input = el.querySelector('#mAns');
      const button = el.querySelector('#mSend');
      const expired = S.endsAt > 0 && typeof api.now === 'function' && api.now() >= S.endsAt;
      const disabled = !!(S.spectator || S.preparing || expired);
      if (input) input.disabled = disabled;
      if (button) button.disabled = disabled;
      const n = S.submitted ? S.submitted.length : 0;
      const total = activeCount(S);
      const progress = el.querySelector('.gk-hud-progress');
      if (progress) progress.textContent = progressText(n, total, 'saved');
      const st = el.querySelector('#mState');
      if (st) {
        st.textContent = S.preparing ? 'Getting the tray ready…' : expired ? 'Recall time is over.' : S.spectator ? '' : S.myRecall ? `Saved ${S.myRecall.length} item${S.myRecall.length === 1 ? '' : 's'}. You can update until the reveal.` : '';
        if (button) button.textContent = S.myRecall ? 'Update' : 'Save';
      }
      const wait = el.querySelector('#mWait');
      if (wait) {
        const waiting = Math.max(0, total - n);
        wait.textContent = S.spectator ? `${n} of ${total} saved` : !S.myRecall ? 'Save your list before time runs out'
          : waiting ? `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'}` : 'Everyone is in';
      }
    }
  },
};
