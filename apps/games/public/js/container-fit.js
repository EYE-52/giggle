/* The playfield is a size container. Measure its available height once per
 * animation frame; CSS handles all child layout without rebuilding a view.
 * Ancestors with scroll/clip bounds (e.g. a Meet panel) limit the viewport. */
export function observeGameContainer(root, {win = window, Observer = ResizeObserver} = {}) {
  let disposed = false, previous = '';
  const ancestors = [];
  for (let node = root.parentElement; node && node !== root.ownerDocument.body; node = node.parentElement) ancestors.push(node);
  function fit() {
    if (disposed || !root.isConnected) return;
    const rect = root.getBoundingClientRect();
    let ancestorScroll = 0;
    let height = Infinity;
    for (const node of ancestors) {
      ancestorScroll += node.scrollTop || 0;
      const style = win.getComputedStyle(node);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        const bounds = node.getBoundingClientRect();
        height = Math.min(height, bounds.bottom - rect.top - ancestorScroll - parseFloat(style.paddingBottom || 0));
      }
    }
    // Restore document coordinates, including nested scrollports. A focused
    // field scrolling its panel must never grow the playfield on resize.
    height = Math.min(height, win.innerHeight - rect.top - (win.scrollY || 0) - ancestorScroll);
    const zoom = rect.width / (root.offsetWidth || rect.width) || 1;
    const value = Math.max(1, Math.round(height / zoom)) + 'px';
    if (value !== previous) { previous = value; root.style.setProperty('--game-viewport-height', value); }
  }
  const schedule = frameResize(fit, win);
  const observer = new Observer(schedule);
  for (const node of [root, ...ancestors]) observer.observe(node);
  win.addEventListener('resize', schedule);
  root.ownerDocument.addEventListener('game-screenchange', schedule);
  fit();
  return () => {
    disposed = true;
    schedule.cancel();
    observer.disconnect();
    win.removeEventListener('resize', schedule);
    root.ownerDocument.removeEventListener('game-screenchange', schedule);
  };
}

/* ResizeObserver and window resize often fire together. Keep one pending
 * job, and cancel it when a view leaves. The callback never remounts a game. */
export function frameResize(callback, win = window) {
  let frame = 0;
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; callback(); }); };
  schedule.cancel = () => { if (frame) win.cancelAnimationFrame(frame); frame = 0; };
  return schedule;
}
