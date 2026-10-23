// Screenshot recorded moments. Usage:
// node shoot.js <outDir> <parentPort> <game[,game]> [pids=p1] [sizes=desk,phone]
// Writes <outDir>/<game>/<idx>-<phase>-<tag>-<pid>-<size>.png and a contact sheet <outDir>/<game>.png
const [OUT, PP = '8151', GAMES, PIDS = 'p1', SIZES = 'desk,phone', MODE = 'embed'] = process.argv.slice(2);
// MODE=solo opens the standalone site (day theme) on the game port (PP-1).
const fs = require('fs'), path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright'); } })();
const SN = process.env.SNAPS || __dirname + '/snaps';
const SZ = { desk: { width: 980, height: 820 }, phone: { width: 390, height: 780 } };
(async () => {
  const b = await chromium.launch({ ...(require('fs').existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const game of GAMES.split(',')) {
    const snaps = JSON.parse(fs.readFileSync(path.join(SN, game + '.json'), 'utf8'));
    const dir = path.join(OUT, game); fs.mkdirSync(dir, { recursive: true });
    const report = [];
    for (const size of SIZES.split(',')) {
      const ctx = await b.newContext({ viewport: SZ[size], isMobile: size === 'phone', hasTouch: size === 'phone' });
      for (let i = 0; i < snaps.length; i++) {
        for (const pid of PIDS.split(',')) {
          const pg = await ctx.newPage();
          const errs = [];
          pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
          pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
          if (MODE === 'solo') {
            const GPORT = String(+PP - 1);
            await ctx.addCookies([{ name: 'gal', value: encodeURIComponent(`${game}:${i}:${pid}`), url: `http://127.0.0.1:${GPORT}` }]);
            await pg.addInitScript(() => { try { localStorage.setItem('pb_name', 'Ann'); localStorage.setItem('pb_room', 'GALY'); } catch {} });
            await pg.goto(`http://127.0.0.1:${GPORT}/r/GALY`);
          } else {
            await pg.goto(`http://127.0.0.1:${PP}/?m=${encodeURIComponent(`${game}:${i}:${pid}`)}`);
          }
          await pg.waitForTimeout(2600);
          // Overflow check inside the game frame(s).
          let overflow = null;
          for (const f of pg.frames().slice(1)) {
            const o = await f.evaluate(() => { const d = document.documentElement; return d.scrollWidth > d.clientWidth + 1 ? `hscroll ${d.scrollWidth}>${d.clientWidth}` : null; }).catch(() => null);
            if (o) overflow = o;
          }
          const name = `${String(i).padStart(2, '0')}-${snaps[i].phase}-${snaps[i].tag}-${pid}${MODE === 'solo' ? '-solo' : ''}-${size}.png`;
          await pg.screenshot({ path: path.join(dir, name) });
          report.push(`${name}${overflow ? '  ' + overflow : ''}${errs.length ? '  ' + errs.join(' | ') : ''}`);
          await pg.close();
        }
      }
      await ctx.close();
    }
    fs.writeFileSync(path.join(dir, 'report.txt'), report.join('\n') + '\n');
    console.log(game, report.filter((r) => /hscroll|error/.test(r)).length ? 'ISSUES:\n  ' + report.filter((r) => /hscroll|error/.test(r)).join('\n  ') : 'ok');
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
