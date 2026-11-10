const telemetry = window.GiggleTelemetry;
// A short structural selector stays useful if classes contain player data.
function selector(node) {
  const path = [];
  while (node?.tagName && path.length < 4) {
    const tag = node.tagName.toLowerCase();
    let n = 1, sibling = node;
    while ((sibling = sibling.previousElementSibling)) if (sibling.tagName === node.tagName) n++;
    path.unshift(`${tag}:nth-of-type(${n})`); node = node.parentElement;
  }
  return path.join('>');
}
function observe(type, callback) {
  try { new PerformanceObserver(list => { if (telemetry.active()) for (const entry of list.getEntries()) callback(entry); }).observe({ type, buffered: false }); } catch { /* Unsupported in this browser. */ }
}
const shifts = new Map();
observe('layout-shift', entry => {
  // Input-triggered movement is also worth recording when it is large:
  // shaking score/board panels often happen directly after a move.
  for (const source of (entry.sources || []).slice(0, 3)) {
    const key = selector(source.node), time = performance.now();
    if (!key) continue;
    const previous = shifts.get(key);
    const value = entry.value + (previous && time - previous.at < 2000 ? previous.value : 0);
    if (shifts.size >= 32) shifts.delete(shifts.keys().next().value);
    shifts.set(key, { at: time, value: value >= .02 ? 0 : value });
    if (value >= .02) telemetry.capture('layout-shift', 'unstable', { selector: key, value });
  }
});
observe('longtask', entry => { if (entry.duration >= 50) telemetry.capture('long-task', 'blocked', { value: entry.duration }); });
