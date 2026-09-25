const { chromium } = require('/Users/divyansh/KaltStart/Giggle/node_modules/playwright');
const SKINS = ['soft', 'play', 'paper', 'clay', 'scrap'], SCREENS = ['home', 'lobby', 'call', 'friends', 'board'], PEOPLE = ['1v1', '2v2', '3v3', '4v2', '4v4'];
const shots = process.argv.includes('--shots');
(async () => {
  const b = await chromium.launch({ args: ['--mute-audio'] });
  const p = await b.newPage({ viewport: { width: 1780, height: 1100 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/studio-local.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: '.controls{position:static!important}' });
  const set = (o) => p.evaluate(o => { const f = document.getElementById('frame'); Object.assign(f.dataset, o); sync(); }, o);
  const geo = {}; let geoFail = 0;
  for (const skin of SKINS) {
    const pal = await p.evaluate(k => SKINS[k].palette, skin);
    await set({ skin, mode: 'light', palette: pal, view: 'both' });
    for (const people of PEOPLE) {
      await set({ screen: 'call', people }); await p.waitForTimeout(700);
      // 1) Faithfulness: rendered boxes must equal the engine's inline boxes.
      const drift = await p.evaluate(() => {
        const bad = [];
        document.querySelectorAll('.vtile[style]').forEach(t => {
          const f = t.parentElement.getBoundingClientRect(), r = t.getBoundingClientRect();
          const want = [parseFloat(t.style.left), parseFloat(t.style.top), parseFloat(t.style.width), parseFloat(t.style.height)];
          const got = [r.left - f.left, r.top - f.top, r.width, r.height];
          if (got.some((v, i) => Math.abs(v - want[i]) > 0.5)) bad.push(want.map(Math.round).join(',') + ' -> ' + got.map(Math.round).join(','));
        });
        document.querySelectorAll('.vgroup').forEach(g => { const r = g.getBoundingClientRect(); if (Math.abs(r.width - parseFloat(g.style.width)) > 0.5 || Math.abs(r.height - parseFloat(g.style.height)) > 0.5) bad.push('group resized'); });
        document.querySelectorAll('.vstage').forEach(st => { const s = st.getBoundingClientRect(); st.querySelectorAll('.vtile').forEach(t => { const r = t.getBoundingClientRect(); if (r.left < s.left - 0.5 || r.top < s.top - 0.5 || r.right > s.right + 0.5 || r.bottom > s.bottom + 0.5) bad.push('tile outside stage'); }); });
        return bad;
      });
      if (drift.length) { geoFail++; console.log('DRIFT', skin, people, drift.slice(0, 3)); }
      // 2) Same room, same layout: force identical stage sizes, re-run the engine, compare across skins.
      const rects = await p.evaluate(() => {
        document.querySelectorAll('.vstage').forEach(st => { st.style.flex = 'none'; st.style.width = (st.dataset.stage === 'phone' ? 358 : 1216) + 'px'; st.style.height = (st.dataset.stage === 'phone' ? 560 : 600) + 'px'; });
        renderCalls();
        const out = [...document.querySelectorAll('.vstage')].map(st => { const s = st.getBoundingClientRect(); return [...st.querySelectorAll('.vtile')].map(t => { const r = t.getBoundingClientRect(); return [r.left - s.left, r.top - s.top, r.width, r.height].map(v => Math.round(v * 100) / 100).join(','); }).join(' | '); });
        document.querySelectorAll('.vstage').forEach(st => { st.style.flex = ''; st.style.width = ''; st.style.height = ''; });
        renderCalls();
        return out;
      });
      if (!geo[people]) geo[people] = { skin, rects };
      else if (JSON.stringify(geo[people].rects) !== JSON.stringify(rects)) { geoFail++; console.log('GEOMETRY MISMATCH (same stage size)', skin, 'vs', geo[people].skin, people); }
    }
    const issues = [];
    for (const screen of SCREENS) {
      for (const mode of ['light', 'dark']) {
        await set({ screen, mode, people: '3v3' }); await p.waitForTimeout(1200);
        if (shots) await p.locator('#viewport').screenshot({ path: `v-${skin}-${screen}-${mode}.png` });
        const found = await p.evaluate(() => {
          const out = [];
          document.querySelectorAll('.device, .board').forEach(d => {
            if (!d.offsetParent) return; const dr = d.getBoundingClientRect(); const tag = d.classList.contains('phone') ? 'phone' : d.classList.contains('board') ? 'board' : 'desk';
            d.querySelectorAll('h1,h2,h3,p,b,small,button,a,input,li,.card,.vname,.code-val').forEach(el => {
              if (!el.offsetParent) return; const r = el.getBoundingClientRect(); if (!r.width) return;
              const name = tag + ' ' + el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.');
              if (el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(el).overflowX)) out.push('clip ' + name);
              if (r.right > dr.right + 1 || r.bottom > dr.bottom + 1) out.push('outside ' + name);
              const box = el.closest('.card, .friend, .modal, .code-box');
              if (box && box !== el && !el.closest('.seat, .pa')) { const br = box.getBoundingClientRect(); if (r.left < br.left - 2 || r.right > br.right + 2 || r.top < br.top - 2 || r.bottom > br.bottom + 2) out.push('spills-out-of-card ' + name); }
            });
          });
          const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return 1; const [r,g,b] = m.slice(0,3).map(v => { v = v/255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }); return .2126*r + .7152*g + .0722*b; };
          const scr = document.getElementById('frame').dataset.screen;
          document.querySelectorAll('.device').forEach(d => { if (!d.offsetParent) return; const tag = d.classList.contains('phone') ? 'phone' : 'desk';
            for (const sel of ['.tab', '.tb']) { const tabs = [...d.querySelectorAll(sel)].filter(t => t.offsetParent); if (tabs.length < 2) continue;
              const sig = t => { const c = getComputedStyle(t); return [c.backgroundColor, c.color, c.fontWeight, c.boxShadow, c.getPropertyValue('--sketch').trim(), c.getPropertyValue('--sketch-fill').trim()].join('|'); };
              const inactive = tabs.filter(t => !t.classList.contains('is-active')), active = tabs.filter(t => t.classList.contains('is-active'));
              if (new Set(inactive.map(sig)).size > 1) out.push('inactive-tab-looks-active ' + tag);
              if (active.length && inactive.length && sig(active[0]) === sig(inactive[0])) out.push('active-tab-not-distinct ' + tag); }
            d.querySelectorAll('.vtile.cam .vname').forEach(n => { if (!n.offsetParent) return; const c = getComputedStyle(n); let bg = c.backgroundColor; const alpha = (bg.match(/[\d.]+/g) || [0,0,0,0])[3]; const L1 = lum(c.color); const L2 = (alpha === undefined || parseFloat(alpha) > .6) ? lum(bg) : 0.02; const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); if (ratio < 4.5 || parseFloat(c.opacity) < .8) out.push('video-name-label-unreadable ' + tag); });
          });
          document.querySelectorAll('.device').forEach(d => { if (!d.offsetParent) return; const want = d.classList.contains('phone') ? [390, 844] : [1280, 820]; if (Math.abs(d.offsetWidth - want[0]) > 1 || Math.abs(d.offsetHeight - want[1]) > 1) out.push('device-resized ' + (d.classList.contains('phone') ? 'phone' : 'desk')); });
          document.querySelectorAll('.device, .board').forEach(d => {
            if (!d.offsetParent) return; const tag = d.classList.contains('phone') ? 'phone' : d.classList.contains('board') ? 'board' : 'desk';
            d.querySelectorAll('.search').forEach(sr => { if (!sr.offsetParent) return; const ic = sr.querySelector('.ic'), inp = sr.querySelector('.input'); if (!ic || !inp) return;
              const textStart = inp.getBoundingClientRect().left + parseFloat(getComputedStyle(inp).paddingLeft);
              if (ic.getBoundingClientRect().right > textStart - 4) out.push('search-icon-overlaps-text ' + tag); });
            d.querySelectorAll('.seat-row').forEach(row => { if (!row.offsetParent) return; const rs = [...row.querySelectorAll('.seat')].filter(x => x.offsetParent).map(x => x.getBoundingClientRect()); if (rs.length && Math.max(...rs.map(r => r.top)) - Math.min(...rs.map(r => r.top)) > rs[0].height / 2) out.push('seats-wrap ' + tag); });
            d.querySelectorAll('.friend').forEach(f => { if (!f.offsetParent) return; const fr = f.getBoundingClientRect(); const kids = [...f.querySelectorAll('img.av, b, small, button')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()); if (!kids.length || fr.height < 200) return;
              const sorted = kids.map(k => [k.top, k.bottom]).sort((x, y) => x[0] - y[0]); let maxGap = 0; for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i][0] - Math.max(...sorted.slice(0, i).map(z => z[1])));
              if (maxGap > fr.height * 0.25) out.push('hollow-gap-inside-friend-card ' + tag); });
          });
          return [...new Set(out)];
        });
        if (found.length) issues.push(screen + '/' + mode + ': ' + found.slice(0, 4).join('; '));
      }
    }
    console.log(skin, issues.length ? issues.join(' || ') : 'OK');
  }
  console.log('geometry:', geoFail ? geoFail + ' problems' : 'PASS: tiles render exactly where the engine puts them, and are pixel-identical across all skins for the same stage size (' + PEOPLE.join(', ') + ')');
  console.log('page errors', errs);
  await b.close();
})();
