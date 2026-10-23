// Old vs new screenshots of the same game moments, for side-by-side review.
// Run serve.js twice first (old checkout + its snaps, new checkout + its
// snaps), then:
// node compare.js <outDir> <oldSnaps> <oldParentPort> <newSnaps> <newParentPort> [game,game...]
// Writes <outDir>/<game>/<n>-<phase>-<old|new>-<desk|phone>.png and
// <outDir>/manifest.json = [{ game, moments: [{ label, phase, old, new }] }].
const [OUT, OLD_SN, OLD_PP, NEW_SN, NEW_PP, ONLY] = process.argv.slice(2);
const fs = require('fs'), path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
const SZ = { desk: { width: 980, height: 820 }, phone: { width: 390, height: 780 } };
const RESULTISH = /reveal|result|roundEnd|round-end|score|vote|judge|outcome|summary/i;

const load = (dir, g) => { try { return JSON.parse(fs.readFileSync(path.join(dir, g + '.json'), 'utf8')); } catch { return []; } };
// Three moments per game: main play, a vote/reveal step, and the final screen.
function pick(snaps) {
  if (!snaps.length) return [];
  const out = [];
  const first = snaps[0].phase;
  const play = snaps.findIndex((s) => s.phase === first && s.tag === 'mid');
  out.push({ label: 'Playing', i: play >= 0 ? play : 0 });
  const lastIdx = snaps.length - 1;
  const mid = snaps.findIndex((s, i) => i !== lastIdx && s.phase !== first && !/^(done|over|final|gameover|end)$/i.test(s.phase) && s.phase !== snaps[lastIdx].phase && s.tag === 'first' && RESULTISH.test(s.phase));
  const alt = mid >= 0 ? mid : snaps.findIndex((s, i) => i !== lastIdx && s.phase !== first && !/^(done|over|final|gameover|end)$/i.test(s.phase) && s.phase !== snaps[lastIdx].phase && s.tag === 'first');
  if (alt >= 0) out.push({ label: 'Mid-game', i: alt });
  // The final screen is the game-over phase when there is one ('last'
  // snaps are refreshed in place, so the array is not in time order).
  const over = snaps.findIndex((s) => /^(done|over|final|gameover|end)$/i.test(s.phase));
  out.push({ label: 'Final screen', i: over >= 0 ? over : lastIdx });
  return out.filter((m, k, a) => a.findIndex((x) => x.i === m.i) === k);
}
function match(oldSnaps, s) {
  let i = oldSnaps.findIndex((o) => o.phase === s.phase && o.tag === s.tag);
  if (i < 0) i = oldSnaps.findIndex((o) => o.phase === s.phase);
  return i;
}

(async () => {
  const launch = () => chromium.launch({ ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  let b = await launch();
  const games = (ONLY ? ONLY.split(',') : fs.readdirSync(NEW_SN).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))).sort();
  // Re-running for some games keeps the other games' entries.
  let manifest = [];
  try { manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')).filter((e) => !games.includes(e.game)); } catch {}
  async function shot(...args) {
    // A crashed browser is relaunched once; a second failure is real.
    try { return await shotOnce(...args); } catch (e) {
      console.error('retry', args[1], e.message.split('\n')[0]);
      try { await b.close(); } catch {}
      b = await launch();
      return shotOnce(...args);
    }
  }
  async function shotOnce(pp, game, i, size, file) {
    const ctx = await b.newContext({ viewport: SZ[size], isMobile: size === 'phone', hasTouch: size === 'phone' });
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${pp}/?m=${encodeURIComponent(`${game}:${i}:p1`)}`);
    await pg.waitForTimeout(2600);
    await pg.screenshot({ path: file });
    await ctx.close();
  }
  for (const game of games) {
    const nw = load(NEW_SN, game), od = load(OLD_SN, game);
    const dir = path.join(OUT, game); fs.mkdirSync(dir, { recursive: true });
    const moments = [];
    for (const [n, m] of pick(nw).entries()) {
      const s = nw[m.i];
      const oi = match(od, s);
      const rec = { label: m.label, phase: s.phase, old: {}, new: {} };
      for (const size of ['desk', 'phone']) {
        const nf = path.join(dir, `${n}-${s.phase}-new-${size}.png`);
        await shot(NEW_PP, game, m.i, size, nf); rec.new[size] = path.relative(OUT, nf);
        if (oi >= 0) { const of = path.join(dir, `${n}-${s.phase}-old-${size}.png`); await shot(OLD_PP, game, oi, size, of); rec.old[size] = path.relative(OUT, of); }
      }
      moments.push(rec);
    }
    manifest.push({ game, moments });
    manifest.sort((x, y) => x.game.localeCompare(y.game));
    console.log(game.padEnd(18), moments.map((m) => `${m.label}:${m.phase}${Object.keys(m.old).length ? '' : '(new only)'}`).join('  '));
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
