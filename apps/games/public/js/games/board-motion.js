/* One interruptible clock per mounted board. Everything it paints is an SVG
 * transform or opacity. Authority always owns the placed (outer) coordinates. */
export const HOP_MS = 130;
export const DICE_MS = 500;
export const motionReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const mixPoint = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export function raceSquares(from, die, limit = 100, bounce = false) {
  const path = [from];
  for (let n = 1; n <= die; n++) {
    const reached = from + n;
    path.push(reached > limit ? (bounce ? 2 * limit - reached : limit) : reached);
    if (reached >= limit && !bounce) break;
  }
  return path;
}
export function hopPose(points, ms) {
  const at = Math.min(points.length - 1, Math.max(0, ms / HOP_MS));
  const i = Math.min(points.length - 2, Math.floor(at)), t = at - i;
  if (i < 0 || ms >= (points.length - 1) * HOP_MS) return { point: points.at(-1), sx: 1, sy: 1 };
  const point = mixPoint(points[i], points[i + 1], t);
  point[1] -= Math.sin(Math.PI * Math.min(1, t / .82)) * 9;
  const squash = t > .82 ? Math.sin((t - .82) / .18 * Math.PI) * .17 : 0;
  return { point, sx: 1 + squash, sy: 1 - squash };
}
export function placePose(node, pose, destination) {
  node?.setAttribute('transform', `translate(${pose.point[0] - destination[0]} ${pose.point[1] - destination[1]}) scale(${pose.sx ?? 1} ${pose.sy ?? 1})`);
}
export function motionClock() {
  let raf = 0, generation = 0, active = null;
  function stop(finish = false) {
    generation++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const old = active; active = null;
    if (old && finish) { old.frame(old.duration); old.done?.(); }
  }
  return {
    stop,
    play(duration, frame, done) {
      stop();
      const id = generation, start = performance.now();
      active = { duration, frame, done };
      frame(0);
      const tick = now => {
        if (id !== generation) return;
        raf = 0;
        const ms = Math.min(duration, Math.max(0, now - start));
        frame(ms);
        if (ms < duration) raf = requestAnimationFrame(tick);
        else { active = null; done?.(); }
      };
      raf = requestAnimationFrame(tick);
    },
  };
}
const DIE_PIPS = { 1: [[0, 0]], 2: [[-9, -9], [9, 9]], 3: [[-9, -9], [0, 0], [9, 9]], 4: [[-9, -9], [9, -9], [-9, 9], [9, 9]], 5: [[-9, -9], [9, -9], [0, 0], [-9, 9], [9, 9]], 6: [[-9, -10], [-9, 0], [-9, 10], [9, -10], [9, 0], [9, 10]] };
export function diceSVG(value = 1, prefix = 'b5') {
  return `<svg class="${prefix}-die" viewBox="-32 -32 64 64" role="img" aria-label="Die: ${value || 'not rolled'}"><g class="bm-die-body"><rect x="-22" y="-20" width="44" height="44" rx="9" class="${prefix}-die-lip"/><rect x="-22" y="-24" width="44" height="44" rx="9" class="${prefix}-die-face"/>${Object.entries(DIE_PIPS).map(([n, dots]) => `<g class="bm-face" data-face="${n}" opacity="${Number(n) === (value || 1) ? 1 : 0}">${dots.map(([x,y]) => `<circle cx="${x}" cy="${y - 2}" r="3.5" class="${prefix}-pip"/>`).join('')}</g>`).join('')}</g></svg>`;
}
export function diceTrack(root, value) {
  const body = root?.querySelector('.bm-die-body'), faces = [...(root?.querySelectorAll('.bm-face') || [])];
  let shown = null;
  return ms => {
    const t = Math.min(1, ms / DICE_MS), face = t === 1 ? (value || 1) : 1 + (Math.floor(ms / 65) + (value || 1)) % 6;
    if (face !== shown) { faces.forEach(n => n.setAttribute('opacity', Number(n.getAttribute('data-face')) === face ? '1' : '0')); shown = face; }
    const decay = 1 - t;
    body?.setAttribute('transform', `translate(${Math.sin(t * Math.PI * 10) * 3 * decay} ${-Math.sin(t * Math.PI) * 5}) rotate(${Math.sin(t * Math.PI * 8) * 22 * decay})`);
  };
}
