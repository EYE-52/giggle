/* Tiny shared helpers: escaping + isolated browser storage. */

export function practiceContext(search) {
  try {
    const params = new URLSearchParams(search || '');
    if (params.get('embed') === '1') return null;
    const session = params.get('practice') || '';
    const rawSeat = params.get('seat') || '';
    const seat = Number(rawSeat);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(session) || !/^[1-8]$/.test(rawSeat)) return null;
    return { session, seat, prefix: `practice:${session}:seat${seat}:` };
  } catch { return null; }
}
export function ensureStylesheet(id, href) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.head) return null;
  const existing = document.getElementById?.(id)
    || [...(document.querySelectorAll?.('link[rel="stylesheet"]') || [])].find(link => link.getAttribute('href') === href);
  if (existing) return existing;
  const link = document.createElement('link');
  Object.assign(link, { id, rel: 'stylesheet', href });
  document.head.appendChild(link);
  return link;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* Test-table seats (?seat=1..8, see /test/) keep their own name, room and
 * seat token, so several players can share one browser without taking
 * over each other's seat. Normal visits use the plain keys. */
const SEAT_PREFIX = (() => {
  try {
    const n = new URLSearchParams(location.search).get('seat');
    return /^[1-8]$/.test(n || '') ? `seat${n}:` : '';
  } catch { return ''; }
})();

const PRACTICE_STORAGE = (() => {
  try { return practiceContext(location.search); } catch { return null; }
})();
const storagePrefix = PRACTICE_STORAGE?.prefix || SEAT_PREFIX;
const storage = () => PRACTICE_STORAGE ? sessionStorage : localStorage;
let practiceClosed = false;

export const store = {
  get(k) {
    try { return storage().getItem(storagePrefix + k) || ''; } catch { return ''; }
  },
  set(k, v) {
    if (PRACTICE_STORAGE && practiceClosed) return;
    try { storage().setItem(storagePrefix + k, v); } catch { /* private mode */ }
  },
  closePractice() { if (PRACTICE_STORAGE) practiceClosed = true; },
  remove(k) {
    try { storage().removeItem(storagePrefix + k); } catch { /* private mode */ }
  },
};

export function nameOf(S, pid) {
  const p = (S.players || []).find((p) => p.id === pid);
  return p ? p.name : '???';
}

/* Seconds until a server absolute deadline. Pass the calibrated server
 * time (api.now() or its value) so skewed wall clocks still agree; the
 * default Date.now() keeps standalone/legacy callers working. */
export function countdown(endsAt, now) {
  let t = Date.now();
  if (typeof now === 'function') {
    try {
      const v = now();
      if (Number.isFinite(v)) t = v;
    } catch { /* fall back to wall clock */ }
  } else if (Number.isFinite(now)) {
    t = now;
  }
  return Math.max(0, Math.ceil((endsAt - t) / 1000));
}

/* Deterministic art fallback for manifest-bearing games without an image.
 * Same id always yields the same raspberry/pink/sun/melon/teal/sky gradient
 * + initial. No cobalt, no purple, no muddy green. */
const ART_HUES = [335, 350, 45, 5, 175, 205, 315, 20];
export function artGradient(id) {
  let h = 0;
  const s = String(id || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const a = ART_HUES[h % ART_HUES.length];
  const b = ART_HUES[(h >> 3) % ART_HUES.length];
  return `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 75% 45%))`;
}

export function artInitial(name) {
  return (String(name || '?').trim().charAt(0) || '?').toUpperCase();
}
