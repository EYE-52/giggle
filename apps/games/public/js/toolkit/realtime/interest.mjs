/* Interest management shared by server channels and tests. Each recipient
 * gets every entity, but distant ones less often: the period says how many
 * ticks pass between updates. Ranks keep crowded arenas readable: the
 * nearest few are always full rate, however spread out the map is. */
export const DEFAULT_TIERS = Object.freeze([
  Object.freeze({ rank: 10, radius: 28, period: 1 }),
  Object.freeze({ rank: 18, radius: 60, period: 2 }),
  Object.freeze({ rank: Infinity, radius: Infinity, period: 4 }),
]);

/* focus: {x, z} or null (spectators without a kart get everything at the
 * second tier's rate, the cheapest view that still reads as live).
 * points: [{x, z}] in entity order. Returns one period per entity. */
export function interestPeriods(focus, points, tiers = DEFAULT_TIERS) {
  if (!focus) return points.map(() => Math.min(2, tiers.at(-1).period));
  const order = points.map((p, i) => ({ i, d: Math.hypot(p.x - focus.x, p.z - focus.z) })).sort((a, b) => a.d - b.d);
  const out = new Array(points.length);
  order.forEach(({ i, d }, rank) => {
    const tier = tiers.find(t => rank < t.rank || d <= t.radius) || tiers.at(-1);
    out[i] = tier.period;
  });
  return out;
}

/* Staggered schedule: entity i with period p is due on ticks where
 * (tick + i) % p === 0, so far updates spread evenly over ticks. */
export const due = (tick, index, period) => period <= 1 || (tick + index) % period === 0;
