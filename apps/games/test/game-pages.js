'use strict';
/* Game detail pages: generated files match the live registry.
 * Run: node test/game-pages.js (no server, no network, no deps). */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const registry = require('../games/registry');
const bp = require('../scripts/build-game-pages');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

/* A hostile + castle-shaped fixture: must be picked up automatically
 * and every field must arrive escaped. */
function evilGame() {
  return {
    id: 'castle-clash',
    name: 'Castle <Clash> "Deluxe"',
    tagline: 'Build & bash \'forts\'',
    howto: 'Spend bricks. Then <smash> & win "big".',
    cat: 'board',
    realtime: false,
    renderer: 'dom',
    minPlayers: 4,
    maxPlayers: 8,
    players: '4–8',
    seats: null,
    communication: 'voice',
    art: null,
    customizable: true,
    schema: {
      settings: [
        { key: 'rounds', label: 'Rounds <b>', type: 'int', min: 1, max: 5, def: 3 },
        { key: 'mode', label: 'Mode', type: 'enum', options: ['Day&Night', 'A"B'], def: 'Day&Night' },
        { key: 'sudden', label: 'Sudden death', type: 'bool', def: true },
      ],
      packs: [{ key: 'banners', label: 'Custom <banners>', minItems: 2, maxItems: 9, maxLen: 20 }],
    },
  };
}

function main() {
  // 1. Fresh build from the live registry; every game gets a page.
  const games = registry.list();
  assert.ok(games.length >= 32, `want 32+ games, saw ${games.length}`);
  const { count } = bp.build({ publicDir: PUBLIC, games });
  assert.strictEqual(count, games.length, 'build count must equal registry count');
  const dirs = fs.readdirSync(path.join(PUBLIC, 'games'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepStrictEqual(dirs, games.map((g) => g.id).sort(), 'one dir per registered game');

  // 2. Every real page: SEO, CTA, canonical howto, honest customize.
  const titles = new Set();
  for (const g of games) {
    const html = read(path.join(PUBLIC, 'games', g.id, 'index.html'));
    // Game-owned pages have their own topology, copy and scripts. Only
    // the optional generated fallback promises gp-* template structure.
    if (g.homepage) {
      assert.equal(html, read(path.join(ROOT, 'games', g.id, 'home/index.html')), `${g.id}: authored document preserved byte-for-byte`);
      assert(!html.includes('/css/style.css') && !html.includes('/css/game-page.css'), `${g.id}: independent style graph`);
      assert(html.includes(`name="game" value="${g.id}"`) && html.includes('action="/"'), `${g.id}: shared room entry`);
      continue;
    }
    const title = `<title>${bp.esc(g.name)} — Game Night by Giggle</title>`;
    assert.ok(html.includes(title), `${g.id}: unique escaped title`);
    assert.ok(!titles.has(title), `${g.id}: title must be unique`);
    titles.add(title);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://play.gigglemeet.com/games/${g.id}/">`),
      `${g.id}: canonical`);
    assert.ok(html.includes('<meta name="description" content="'), `${g.id}: meta description`);
    assert.ok(!html.includes('?&') && !html.includes('?game='), `${g.id}: no named-query dupes`);
    // CTA form: GET to /, hidden game, named ticket field, no auto-submit.
    assert.ok(html.includes('<form class="gp-cta" method="GET" action="/">'), `${g.id}: CTA form`);
    assert.ok(html.includes(`<input type="hidden" name="game" value="${g.id}">`), `${g.id}: hidden game`);
    assert.ok(html.includes('name="name" required maxlength="16"'), `${g.id}: name field`);
    assert.ok(html.includes('>Create room</button>'), `${g.id}: create button`);
    // Only the theme one-liner may run; nothing fetches, sockets, or creates.
    assert.strictEqual(html.split('<script').length - 1, 1, `${g.id}: theme script only`);
    for (const auto of ['fetch(', 'WebSocket', 'XMLHttpRequest', '.submit(']) {
      assert.ok(!html.includes(auto), `${g.id}: nothing auto-runs (${auto})`);
    }
    // Breadcrumb back to the catalog.
    assert.ok(html.includes('<a href="/">All games</a>'), `${g.id}: breadcrumb`);
    // Canonical howto: same sentence split as the lobby dialog.
    for (const para of bp.splitHowto(g.howto)) {
      assert.ok(html.includes(`<p>${bp.esc(para)}</p>`), `${g.id}: howto paragraph kept`);
    }
    // Players/seats facts, never invented.
    const wantPlayers = g.minPlayers === g.maxPlayers
      ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;
    assert.ok(html.includes(bp.esc(wantPlayers)), `${g.id}: players range`);
    if (Number.isInteger(g.seats)) {
      assert.ok(html.includes(`${g.seats} play · rest watch`), `${g.id}: seats pill`);
    }
    // Customize honesty: button + schema only when the game has schema.
    if (g.customizable) {
      assert.ok(html.includes('name="wantsetup" value="1"'), `${g.id}: customize intent button`);
      assert.ok(g.schema.settings.length + g.schema.packs.length > 0, `${g.id}: schema non-empty`);
      for (const s of g.schema.settings) {
        assert.ok(html.includes(bp.esc(s.label || s.key)), `${g.id}: setting ${s.key} listed`);
      }
    } else {
      assert.ok(!html.includes('wantsetup'), `${g.id}: no fake customize button`);
      assert.ok(html.includes('plays as-is'), `${g.id}: honest as-is note`);
    }
  }

  // 3. Spot checks on real schema rendering.
  assert.ok(read(path.join(PUBLIC, 'games/chess/index.html')).includes('Time control'),
    'chess setting label rendered');
  assert.ok(read(path.join(PUBLIC, 'games/pocket-karts/index.html')).includes('Round length'),
    'karts setting label rendered');
  // Every game page offers the customize path exactly when the game has a
  // settings/pack schema (Trivia gained Rounds/Pace, so it now does).
  for (const g of registry.list()) {
    const page = path.join(PUBLIC, 'games', g.id, 'index.html');
    if (!fs.existsSync(page)) continue;
    assert.equal(read(page).includes('wantsetup'), !!g.customizable, `${g.id} customize path matches its schema`);
  }

  // 4. Sitemap covers home + every game.
  const sm = read(path.join(PUBLIC, 'sitemap.xml'));
  assert.ok(sm.includes('<loc>https://play.gigglemeet.com/</loc>'), 'sitemap home');
  for (const g of games) {
    assert.ok(sm.includes(`<loc>https://play.gigglemeet.com/games/${g.id}/</loc>`),
      `sitemap has ${g.id}`);
  }

  // 5. Unknown slugs are real 404s: nothing generated for them.
  assert.ok(!fs.existsSync(path.join(PUBLIC, 'games/does-not-exist-xyz')),
    'unknown slug has no page');

  // 6. Traversal safety: unsafe ids never become paths.
  for (const bad of ['../x', '..', '/abs', 'A B', 'a"b', 'x', 'a'.repeat(41), '', null, 42]) {
    assert.strictEqual(bp.safeId(bad), null, `safeId rejects ${JSON.stringify(bad)}`);
  }
  assert.strictEqual(bp.safeId('castle-clash'), 'castle-clash', 'safeId keeps good ids');

  // 7. Fixture build in a temp dir: auto-pickup + escaping + no escape.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  const evil = evilGame();
  const res = bp.build({ publicDir: tmp, games: [evil, { ...evil, id: '../evil' }] });
  assert.strictEqual(res.count, 1, 'evil id skipped, fixture kept');
  assert.ok(!fs.existsSync(path.join(tmp, 'evil')), 'no traversal write');
  assert.deepStrictEqual(fs.readdirSync(tmp).sort(), ['games', 'sitemap.xml'], 'no stray writes');
  const fh = read(path.join(tmp, 'games/castle-clash/index.html'));
  for (const raw of ['Castle <Clash>', 'Build & bash', '<smash>', 'Rounds <b>', 'Day&Night', 'A"B',
    'Custom <banners>']) {
    assert.ok(!fh.includes(raw), `escaped: ${raw} must not appear raw`);
  }
  for (const want of ['Castle &lt;Clash&gt; &quot;Deluxe&quot;', 'Build &amp; bash &#39;forts&#39;',
    'Rounds &lt;b&gt;', 'Day&amp;Night', 'A&quot;B', 'Default: on', 'Bring your own (at least 2']) {
    assert.ok(fh.includes(want), `escaped entity present: ${want}`);
  }
  assert.ok(fh.includes('gp-art-fallback'), 'missing art falls back to a tile, not a 404 img');
  assert.ok(fh.includes('name="wantsetup" value="1"'), 'fixture customize button');
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`GAME-PAGES ok: ${games.length} pages, sitemap, CTA, escaping, traversal-safe`);
}

main();
