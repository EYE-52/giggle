// Emptiness report: per screen/device, % of device height below the last content, and each card's empty-interior %.
const { chromium } = require('/Users/divyansh/KaltStart/Giggle/node_modules/playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--mute-audio'] });
  const p = await b.newPage({ viewport: { width: 1780, height: 1100 } });
  await p.goto('file://' + process.cwd() + '/studio-local.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const report = {};
  for (const skin of ['soft', 'play', 'paper', 'clay', 'scrap']) {
    const lines = [];
    for (const screen of ['home', 'lobby', 'friends']) {
      await p.evaluate(o => { const f = document.getElementById('frame'); Object.assign(f.dataset, o); f.dataset.palette = SKINS[o.skin].palette; sync(); }, { skin, screen, mode: 'light', view: 'both' });
      await p.waitForTimeout(80);
      const r = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('.device').forEach(d => {
          const tag = d.classList.contains('phone') ? 'phone' : 'desktop';
          const scr = [...d.querySelectorAll('.screen')].find(s => s.offsetParent); if (!scr) return;
          const dr = d.getBoundingClientRect(); const bar = d.querySelector('.tabbar'); const floor = bar && bar.offsetParent ? bar.getBoundingClientRect().top : dr.bottom;
          const leaves = [...scr.querySelectorAll('h1,h2,p,button,input,img,li,.seat,.code-box,.search')].filter(e => e.offsetParent && e.getBoundingClientRect().height);
          const lastBottom = Math.max(...leaves.map(e => e.getBoundingClientRect().bottom));
          const below = Math.max(0, Math.round(100 * (floor - lastBottom) / (floor - dr.top)));
          const cards = [...scr.querySelectorAll('.card, .friend, .preview')].filter(c => c.offsetParent).map(c => {
            const cr = c.getBoundingClientRect(); const kids = [...c.querySelectorAll('h1,h2,p,button,input,img,.seat,.code-box,small,b,a,.search,.stack')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect());
            if (!kids.length || cr.height < 40) return null;
            const top = Math.min(...kids.map(k => k.top)), bot = Math.max(...kids.map(k => k.bottom));
            const used = kids.reduce((s, k) => s + k.height, 0);
            const gapV = Math.max(0, cr.height - (bot - top) - 48); // unused beyond padding
            const emptyPct = Math.round(100 * Math.max(gapV, cr.height - Math.min(cr.height, used * 1.6)) / cr.height);
            return (c.className.split(' ').slice(0, 2).join('.')) + ' ' + emptyPct + '%';
          }).filter(Boolean);
          out.push(tag + ': empty below content ' + below + '%; card interiors empty: ' + (cards.join(', ') || 'n/a'));
        });
        return out;
      });
      lines.push(screen + ' -> ' + r.join(' | '));
    }
    report[skin] = lines;
    console.log('== ' + skin + '\n' + lines.join('\n'));
  }
  fs.writeFileSync('empty.json', JSON.stringify(report, null, 1));
  await b.close();
})();
