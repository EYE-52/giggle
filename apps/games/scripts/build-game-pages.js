'use strict';
/* Static game detail pages: one script, every registered game.
 *
 * Reads games/registry.js (the same metadata the lobby serves), writes
 * public/games/<id>/index.html plus public/sitemap.xml. New manifest
 * games (e.g. castle-*) are picked up automatically — no page edits.
 *
 * Run: node scripts/build-game-pages.js
 * Root wires this into the build (see GAME_PAGES_GUIDE.md).
 *
 * Pages are standalone static HTML: no account, no auto-create, no
 * room side effects. The CTA is a plain GET form to / (?game=&name=
 * [&wantsetup=1]); the main app owns room creation, query handling,
 * and the Giggle bridge — not this page.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { LIMITS } = require('../games/_validate');

/* Same id rule as the registry: traversal-safe by construction. */
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function safeId(id) {
  if (typeof id !== 'string' || id.length < 2 || id.length > LIMITS.MAX_ID_LEN) return null;
  return ID_RE.test(id) ? id : null;
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Canonical howto split, mirroring public/js/howto.js splitHowto: the
 * catalog line (1–3 sentences) becomes short readable paragraphs.
 * Keep the regex identical; the dialog and the detail page must agree. */
function splitHowto(text) {
  const parts = String(text || '').match(/[^.!?]+[.!?]+["”)'\]]*|.+$/g);
  if (!parts) return [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/* Local art only. Manifest art must already match the validated shape
 * (img/games/<id>.svg|png); otherwise fall back to the per-id png/svg
 * the catalog dialog uses. Missing art renders a CSS initial tile —
 * never a broken <img>, never a remote URL. */
const ART_RE = /^img\/games\/[a-z0-9-]+\.(svg|png|webp)$/;
function artSrc(game, publicDir) {
  const cands = [];
  if (game.art && ART_RE.test(game.art)) cands.push(game.art);
  cands.push(`img/games/${game.id}.png`, `img/games/${game.id}.svg`);
  for (const c of cands) {
    try {
      if (fs.statSync(path.join(publicDir, c)).isFile()) return '/' + c;
    } catch { /* try next */ }
  }
  return null;
}

function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.5 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

function playersLine(g) {
  if (g.minPlayers === g.maxPlayers) return `${g.minPlayers} players`;
  return `${g.minPlayers}–${g.maxPlayers} players`;
}

/* Short factual pills: derived from registry data only, no invention. */
function pills(g) {
  const out = [playersLine(g)];
  if (Number.isInteger(g.seats)) out.push(`${g.seats} play · rest watch`);
  else out.push('Everyone plays');
  if (g.communication === 'video') out.push('Best on video');
  else if (g.communication === 'voice') out.push('Best with voice');
  if (g.renderer === '3d') out.push('3D arena');
  else if (g.renderer === 'canvas') out.push('Live drawing');
  else if (g.realtime) out.push('Live');
  out.push(g.customizable ? 'Customizable' : 'Plays as-is');
  return out;
}

function settingDetail(s) {
  if (s.type === 'int') {
    const range = (s.min !== undefined && s.max !== undefined) ? `${s.min}–${s.max}` : '';
    const d = s.def === null ? `default ${s.autoLabel || 'auto'}` : `default ${s.def}`;
    return [range, d].filter(Boolean).join(', ');
  }
  if (s.type === 'enum') {
    const opts = Array.isArray(s.options) ? s.options.join(' · ') : '';
    return `Options: ${opts}. Default: ${s.def}`;
  }
  return `Default: ${s.def ? 'on' : 'off'}`;
}

function packDetail(p) {
  const bits = [];
  if (Number.isInteger(p.minItems)) bits.push(`at least ${p.minItems}`);
  if (Number.isInteger(p.maxItems)) bits.push(`up to ${p.maxItems}`);
  if (Number.isInteger(p.maxLen)) bits.push(`each ≤ ${p.maxLen} chars`);
  return bits.length ? `Bring your own (${bits.join(', ')})` : 'Bring your own';
}

function renderPage(g, publicDir) {
  const id = safeId(g.id);
  if (!id) throw new Error(`refusing to render unsafe id ${JSON.stringify(g.id)}`);
  const canonical = `https://play.gigglemeet.com/games/${id}/`;
  const desc = truncate(`${g.tagline}. ${g.howto}`, 155);
  const src = artSrc(g, publicDir);
  const art = src
    ? `<img class="gp-art" src="${esc(src)}" alt="" width="480" height="270" loading="eager">`
    : `<span class="gp-art gp-art-fallback" aria-hidden="true">${esc((g.name || id)[0].toUpperCase())}</span>`;

  const howtoParas = splitHowto(g.howto)
    .map((p) => `      <p>${esc(p)}</p>`).join('\n');

  let customSection;
  if (g.customizable) {
    const settings = (g.schema.settings || [])
      .map((s) => `          <li><strong>${esc(s.label || s.key)}</strong> <span>${esc(settingDetail(s))}</span></li>`)
      .join('\n');
    const packs = (g.schema.packs || [])
      .map((p) => `          <li><strong>${esc(p.label || p.key)}</strong> <span>${esc(packDetail(p))}</span></li>`)
      .join('\n');
    const lists = [
      settings ? `        <h3>Room settings</h3>\n        <ul class="gp-list">\n${settings}\n        </ul>` : '',
      packs ? `        <h3>Custom content</h3>\n        <ul class="gp-list">\n${packs}\n        </ul>` : '',
    ].filter(Boolean).join('\n');
    customSection =
      `      <section class="gp-custom" aria-labelledby="gpCustom">\n` +
      `        <h2 id="gpCustom">Make it yours</h2>\n` +
      `        <p>The host can adjust these before the game starts.</p>\n` +
      `${lists}\n` +
      `      </section>`;
  } else {
    customSection =
      `      <section class="gp-custom" aria-labelledby="gpCustom">\n` +
      `        <h2 id="gpCustom">Setup</h2>\n` +
      `        <p>This one plays as-is — no setup options, just start a room and go.</p>\n` +
      `      </section>`;
  }

  /* Two native submits, zero JS: plain create, and (customizable games
   * only) create-with-setup via wantsetup=1. The main app reads the
   * query and owns the room; this page creates nothing by itself. */
  const customizeBtn = g.customizable
    ? `\n          <button class="gp-btn gp-btn-soft" type="submit" name="wantsetup" value="1">Customize + Create</button>`
    : '';

  const seatsNote = Number.isInteger(g.seats)
    ? ` Only ${g.seats} play at once — the rest of the room watches (rooms hold up to ${LIMITS.ROOM_CAP}).`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFF6F8">
<title>${esc(g.name)} — Game Night by Giggle</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(g.name)} — Game Night by Giggle">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<link rel="preload" href="/fonts/baloo2-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/nunito-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/game-page.css">
<script>try{var t=localStorage.getItem('pb_theme');if(t==='night'||t==='dark'||t==='arcade')document.documentElement.dataset.theme='night';}catch(e){}</script>
</head>
<body>
<div class="gp-wrap">
  <nav class="gp-crumb" aria-label="Breadcrumb">
    <a href="/">All games</a>
    <span aria-hidden="true">›</span>
    <span aria-current="page">${esc(g.name)}</span>
  </nav>

  <header class="gp-hero">
    ${art}
    <div class="gp-hero-text">
      <h1>${esc(g.name)}</h1>
      <p class="gp-tag">${esc(g.tagline)}</p>
      <ul class="gp-pills" aria-label="Game facts">
${pills(g).map((p) => `        <li>${esc(p)}</li>`).join('\n')}
      </ul>
    </div>
  </header>

  <main>
    <section class="gp-how" aria-labelledby="gpHow">
      <h2 id="gpHow">How to play</h2>
${howtoParas}
      <p class="gp-fact">${esc(playersLine(g))} per room.${esc(seatsNote)}</p>
    </section>

${customSection}

    <section class="gp-start" aria-labelledby="gpGo">
      <h2 id="gpGo">Start a room</h2>
      <form class="gp-cta" method="GET" action="/">
        <input type="hidden" name="game" value="${esc(id)}">
        <label class="gp-field">
          <span>Your party name</span>
          <input type="text" name="name" required maxlength="16" autocomplete="nickname"
            placeholder="e.g. Pippa" aria-describedby="gpCtaNote">
        </label>
        <div class="gp-actions">
          <button class="gp-btn gp-btn-hot" type="submit">Create room</button>${customizeBtn}
        </div>
      </form>
      <p class="gp-note" id="gpCtaNote">Pick a name, create a room, and invite your friends. No account needed.</p>
    </section>
  </main>

  <footer class="gp-foot">
    <a href="/">← Back to all games</a>
    <span>Game Night by Giggle</span>
  </footer>
</div>
</body>
</html>
`;
}

function renderSitemap(games) {
  const urls = ['https://play.gigglemeet.com/', ...games.map((g) => `https://play.gigglemeet.com/games/${g.id}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + `\n</urlset>\n`;
}

/* Copy trusted game-owned browser exports byte-for-byte. Refuse links and
 * hidden/dependency trees so a mistaken source folder cannot publish .env,
 * repository metadata or files outside the game. Rendering is unrestricted. */
function assetFiles(source, relative = '') {
  const rootStat = fs.lstatSync(source);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Refusing non-directory or linked asset root: ${source}`);
  const out = [];
  for (const name of fs.readdirSync(source)) {
    if (name.startsWith('.') || name === 'node_modules') throw new Error(`Refusing private asset path: ${name}`);
    const file = path.join(source, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Refusing asset symlink: ${file}`);
    const rel = path.join(relative, name);
    if (stat.isDirectory()) out.push(...assetFiles(file, rel));
    else if (stat.isFile()) out.push({ file, rel });
    else throw new Error(`Unsupported asset: ${file}`);
  }
  return out;
}

/* Build pages for `games` (registry list shape) into publicDir/games/.
 * Prunes stale safe-id dirs so removed games leave no ghosts. Unknown
 * slugs are never generated — they stay real 404s. */
function build({ publicDir, games, gamesDir = path.join(ROOT, 'games') }) {
  const outRoot = path.join(publicDir, 'games');
  const assetsRoot = path.join(publicDir, 'game-assets');
  // Validate ALL opted-in exports before touching the previous build.
  const exports = new Map();
  for (const g of games) {
    if (!safeId(g.id)) continue;
    const owned = {};
    for (const [kind, entry] of [['home', g.homepage ? 'index.html' : null], ['browser', g.runtime?.entry]]) {
      if (!entry) continue;
      if (!entry.split('/').every(p => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p) && p !== '.' && p !== '..') || !entry.endsWith('.html')) {
        throw new Error(`Invalid ${g.id} ${kind} entry`);
      }
      const source = path.join(gamesDir, g.id, kind);
      const files = assetFiles(source);
      if (!files.some(f => f.rel === entry)) throw new Error(`${g.id}: missing ${kind}/${entry}`);
      owned[kind] = files;
    }
    exports.set(g.id, owned);
  }
  fs.mkdirSync(outRoot, { recursive: true });
  const wanted = new Set();
  const framed = new Set();
  const copy = (files, dest) => {
    fs.rmSync(dest, { recursive: true, force: true });
    for (const { file, rel } of files) {
      const target = path.join(dest, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
  };
  for (const g of games) {
    const id = safeId(g.id);
    if (!id) {
      console.error(`game-pages: skipping unsafe id ${JSON.stringify(g.id)}`);
      continue;
    }
    wanted.add(id);
    const dir = path.join(outRoot, id);
    const owned = exports.get(id);
    if (owned?.home) copy(owned.home, dir);
    else {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderPage({ ...g, id }, publicDir));
    }
    if (owned?.browser) { framed.add(id); copy(owned.browser, path.join(assetsRoot, id)); }
  }
  if (fs.existsSync(assetsRoot)) for (const entry of fs.readdirSync(assetsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && safeId(entry.name) && !framed.has(entry.name)) fs.rmSync(path.join(assetsRoot, entry.name), { recursive: true, force: true });
  }
  for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && safeId(entry.name) && !wanted.has(entry.name)) {
      fs.rmSync(path.join(outRoot, entry.name), { recursive: true, force: true });
      console.log(`game-pages: pruned stale ${entry.name}/`);
    }
  }
  const listed = games.filter((g) => wanted.has(g.id));
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), renderSitemap(listed));
  return { count: wanted.size };
}

if (require.main === module) {
  const registry = require('../games/registry');
  const { count } = build({ publicDir: path.join(ROOT, 'public'), games: registry.list() });
  console.log(`game-pages: wrote ${count} pages + sitemap.xml`);
}

module.exports = { build, renderPage, renderSitemap, safeId, esc, splitHowto, pills, assetFiles };
