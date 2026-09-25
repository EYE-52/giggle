/* Giggle sketch renderer: real hand-drawn strokes and fills via rough.js, driven entirely by CSS.
   A skin opts an element in with non-inherited custom properties, e.g.
     .frame[data-skin="paper"] .btn-primary { --sketch: rect; --sketch-fill: var(--brand); --sketch-fill-style: hachure; }
   Properties (all optional except --sketch):
     --sketch               rect | ellipse | circle | underline | highlight | none
     --sketch-stroke        color (any CSS color, var()/color-mix ok)           default: currentColor
     --sketch-stroke-width  number (px)                                         default: 1.6
     --sketch-fill          color or none                                       default: none
     --sketch-fill-style    hachure | solid | zigzag | cross-hatch | dots | dashed | zigzag-line   default: hachure
     --sketch-fill-weight   number (hachure line width)                         default: 1.2
     --sketch-hachure-gap   number                                              default: 6
     --sketch-hachure-angle number (deg)                                        default: -41
     --sketch-roughness     number                                              default: 1.2
     --sketch-bowing        number                                              default: 1
     --sketch-radius        number (px, rect corners)                           default: 10
     --sketch-inset         number (px; negative draws outside the box)         default: -2
     --sketch-dash          "a b" dash pattern for the stroke, or none          default: none
     --sketch-layer         under | over  (over = above content, for frames on video tiles)  default: under
   The overlay is an absolutely positioned SVG (pointer-events:none). It never changes the element's size or position. */
(function () {
  const PROPS = ['--sketch', '--sketch-stroke', '--sketch-stroke-width', '--sketch-fill', '--sketch-fill-style', '--sketch-fill-weight',
    '--sketch-hachure-gap', '--sketch-hachure-angle', '--sketch-roughness', '--sketch-bowing', '--sketch-radius', '--sketch-inset', '--sketch-dash', '--sketch-layer'];
  if (window.CSS && CSS.registerProperty) for (const name of PROPS) { try { CSS.registerProperty({ name, syntax: '*', inherits: false }); } catch (e) {} }
  const CANDIDATES = '.btn, .card, .input, .search, .tab, .tb, .chip, .badge, .pill, .seat, .pa, .friend, .cbtn, .code-box, .modal, .toast, .preview, .icon-btn, .vtile, .tip-idea, .nav, .tabbar, .switch, .more, .kicker, .card-title, .title, .tip-title, .fab';
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const str = (v, d) => { v = (v || '').trim(); return v ? v : d; };
  let seedBase = 7;
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) % 100000 + 1; }
  function clear(root) { root.querySelectorAll(':scope .gg-sketch').forEach(n => n.remove()); }
  function paint(svg, color, isFill) {
    svg.querySelectorAll('path').forEach(p => {
      const s = p.getAttribute('stroke'), f = p.getAttribute('fill');
      if (s && s !== 'none') { p.style.stroke = s === '__F__' ? color.fill : color.stroke; p.removeAttribute('stroke'); }
      if (f && f !== 'none') { p.style.fill = f === '__F__' ? color.fill : color.stroke; p.removeAttribute('fill'); }
    });
  }
  function draw(root) {
    if (!window.rough) return;
    clear(root);
    const els = [...root.querySelectorAll(CANDIDATES)];
    els.forEach((el, i) => {
      if (!el.offsetParent || el.closest('.gg-sketch')) return;
      const cs = getComputedStyle(el);
      const kind = str(cs.getPropertyValue('--sketch'), 'none');
      if (kind === 'none') return;
      const w = el.offsetWidth, h = el.offsetHeight; if (w < 4 || h < 4) return;
      const inset = num(cs.getPropertyValue('--sketch-inset'), -2);
      const pad = Math.max(8, -inset + 6);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'gg-sketch'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('width', w + pad * 2); svg.setAttribute('height', h + pad * 2);
      const over = str(cs.getPropertyValue('--sketch-layer'), 'under') === 'over';
      svg.style.cssText = `position:absolute;left:${-pad - (parseFloat(cs.borderLeftWidth) || 0)}px;top:${-pad - (parseFloat(cs.borderTopWidth) || 0)}px;pointer-events:none;overflow:visible;z-index:${over ? 3 : -1}`;
      const rc = rough.svg(svg);
      const fill = str(cs.getPropertyValue('--sketch-fill'), 'none');
      const dash = str(cs.getPropertyValue('--sketch-dash'), 'none');
      const opts = {
        seed: hash((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ':' + i) + seedBase,
        stroke: '__S__', strokeWidth: num(cs.getPropertyValue('--sketch-stroke-width'), 1.6),
        roughness: num(cs.getPropertyValue('--sketch-roughness'), 1.2), bowing: num(cs.getPropertyValue('--sketch-bowing'), 1),
        fill: fill === 'none' ? undefined : '__F__', fillStyle: str(cs.getPropertyValue('--sketch-fill-style'), 'hachure'),
        fillWeight: num(cs.getPropertyValue('--sketch-fill-weight'), 1.2), hachureGap: num(cs.getPropertyValue('--sketch-hachure-gap'), 6),
        hachureAngle: num(cs.getPropertyValue('--sketch-hachure-angle'), -41),
        strokeLineDash: dash === 'none' ? undefined : dash.split(/[\s,]+/).map(Number).filter(Number.isFinite),
        disableMultiStroke: false, preserveVertices: false,
      };
      const x = pad + inset, y = pad + inset, W = w - inset * 2, H = h - inset * 2;
      let node;
      if (kind === 'rect') {
        const r = Math.min(num(cs.getPropertyValue('--sketch-radius'), 10), W / 2, H / 2);
        const d = `M${x + r},${y} L${x + W - r},${y} Q${x + W},${y} ${x + W},${y + r} L${x + W},${y + H - r} Q${x + W},${y + H} ${x + W - r},${y + H} L${x + r},${y + H} Q${x},${y + H} ${x},${y + H - r} L${x},${y + r} Q${x},${y} ${x + r},${y} Z`;
        node = rc.path(d, opts);
      } else if (kind === 'ellipse') node = rc.ellipse(x + W / 2, y + H / 2, W, H, opts);
      else if (kind === 'circle') node = rc.circle(x + W / 2, y + H / 2, Math.min(W, H), opts);
      else if (kind === 'underline') node = rc.line(x, y + H + 2, x + W, y + H + 1, { ...opts, fill: undefined });
      else if (kind === 'highlight') node = rc.rectangle(x - 2, y + H * 0.35, W + 4, H * 0.62, { ...opts, stroke: 'none', fill: '__F__', fillStyle: opts.fillStyle || 'zigzag', hachureGap: 3, fillWeight: Math.max(3, H * 0.18) });
      if (!node) return;
      svg.appendChild(node);
      paint(svg, { stroke: str(cs.getPropertyValue('--sketch-stroke'), cs.color), fill: fill === 'none' ? 'none' : fill });
      if (cs.position === 'static') el.style.position = 'relative';
      if (!over && cs.isolation !== 'isolate') el.style.isolation = 'isolate';
      el.appendChild(svg);
    });
  }
  let raf = 0;
  window.GiggleSketch = { draw, schedule(root) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => requestAnimationFrame(() => draw(root))); } };
})();
