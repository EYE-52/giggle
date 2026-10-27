'use strict';

// Runs in the browser, against live text and its painted ancestor backgrounds.
// Transparent game stages must inherit the real body background, not a white
// fallback. Gradient cards are checked against every computed color stop.
function auditTextContrast(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const styles = new Map(), backgrounds = new Map(), errors = [];
  let checked = 0, minimum = Infinity;
  const css = n => { if (!styles.has(n)) styles.set(n, win.getComputedStyle(n)); return styles.get(n); };
  const rgba = value => {
    const numbers = value?.match(/[\d.]+/g)?.map(Number);
    return numbers?.length >= 3 ? [...numbers.slice(0, 3), numbers[3] ?? 1] : [0, 0, 0, 0];
  };
  const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
  const painted = n => {
    if (!n) return [[255, 255, 255]];
    if (backgrounds.has(n)) return backgrounds.get(n);
    const c = css(n), below = painted(n.parentElement);
    const solid = below.map(b => over(rgba(c.backgroundColor), b));
    const stops = c.backgroundImage.includes('gradient(') ? [...c.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m => rgba(m[0])) : [];
    const colors = stops.length ? solid.flatMap(b => stops.map(stop => over(stop, b))) : solid;
    backgrounds.set(n, colors);
    return colors;
  };
  const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [.2126, .7152, .0722][i], 0);
  const check = (node, text, style = css(node), extraOpacity = 1) => {
    if (!/[\p{L}\p{N}\p{P}]/u.test(text) || node.closest('svg,canvas,[aria-hidden="true"]')) return;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height || style.visibility !== 'visible' || style.display === 'none') return;
    let opacity = extraOpacity;
    for (let p = node; p; p = p.parentElement) opacity *= Number(css(p).opacity);
    // Dimmed disabled actions have no contrast requirement; disabled reveal
    // cards at full opacity still convey information and are checked.
    if (!opacity || (node.closest(':disabled') && opacity < .9)) return;
    const foreground = rgba(style.color); foreground[3] *= opacity;
    const size = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10);
    const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    let ratio = Infinity, worst = null;
    for (const background of painted(node)) {
      const a = luminance(over(foreground, background)), b = luminance(background);
      const value = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      if (value < ratio) { ratio = value; worst = background; }
    }
    checked++; minimum = Math.min(minimum, ratio);
    if (ratio + .01 < required && errors.length < 16) errors.push({
      text: text.trim().replace(/\s+/g, ' ').slice(0, 80), node: node.id || node.className || node.tagName,
      ratio: Number(ratio.toFixed(2)), required, foreground: style.color,
      background: worst.map(Math.round),
    });
  };
  const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim()) continue;
    const range = doc.createRange(); range.selectNodeContents(text);
    if ([...range.getClientRects()].some(r => r.width && r.height)) check(text.parentElement, text.textContent);
  }
  for (const input of root.querySelectorAll('input:not([type=radio]):not([type=checkbox]),textarea')) {
    if (input.value) check(input, input.value);
    else if (input.placeholder) {
      const placeholder = win.getComputedStyle(input, '::placeholder');
      check(input, input.placeholder, placeholder, Number(placeholder.opacity));
    }
  }
  return { checked, minimum: checked ? Number(minimum.toFixed(2)) : null, bodyBackground: css(doc.body).backgroundColor, rootColor: css(root).color, errors };
}

module.exports = { auditTextContrast };
