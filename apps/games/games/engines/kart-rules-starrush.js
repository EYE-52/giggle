'use strict';
/* Kart rule module: Star Rush. Drive into stars, first to the goal (or the
 * most when time expires) wins. Ties share the win. */

const PICKUP_R2 = 2.4 * 2.4;
const STAR_COUNT = 6;

function nextSpot(state, spots) {
  for (let n = 0; n < spots.length; n++) {
    const idx = (state.spawnIdx + n) % spots.length;
    const [x, z] = spots[idx];
    const taken = state.stars.some((s) => Math.abs(s.x - x) < 0.01 && Math.abs(s.z - z) < 0.01);
    if (!taken) {
      state.spawnIdx = (idx + 1) % spots.length;
      return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

module.exports = {
  key: 'starrush',
  label: 'Star Rush',
  scoreNoun: 'stars',

  blankKart() {
    return { stars: 0 };
  },

  createExtra(state, spots) {
    state.stars = [];
    for (let i = 0; i < Math.min(STAR_COUNT, spots.length); i++) {
      state.stars.push({ id: 's' + i, x: spots[i][0], z: spots[i][1] });
    }
    state.spawnIdx = STAR_COUNT % spots.length;
    state.starSeq = STAR_COUNT;
  },

  /* Returns true when the mode's instant-win goal is met. */
  tick(state, connected) {
    for (const kart of state.karts) {
      if (!connected.has(kart.pid)) continue;
      for (const star of state.stars) {
        const dx = kart.x - star.x;
        const dz = kart.z - star.z;
        if (dx * dx + dz * dz < PICKUP_R2) {
          kart.stars += 1;
          state.scores[kart.pid] = kart.stars;
          const spot = nextSpot(state, state.spots);
          star.id = 's' + (state.starSeq += 1);
          star.x = spot.x;
          star.z = spot.z;
        }
      }
    }
    return state.karts.some((k) => k.stars >= state.targetStars);
  },

  scoreOf(kart) {
    return kart.stars;
  },

  viewExtra(state) {
    return { stars: state.stars.map((s) => ({ id: s.id, x: s.x, z: s.z })) };
  },

  kartViewExtra(kart) {
    return { stars: kart.stars };
  },
};
