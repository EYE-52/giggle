// Bot driver for Pocket Karts load fixtures. Pure function of the public
// snapshot: wander between random targets inside the arena, back out when
// stuck, fire whenever armed. Used by the profiler and the 32-driver test.
export function createKartBot(pid, rand = Math.random) {
  let target = null, retargetAt = 0, stuckSince = 0, reverseUntil = 0;
  return function intent(view, now) {
    const me = view?.karts?.find(k => k.pid === pid);
    if (!me || view.phase !== 'drive' || me.respawn > 0) return { steer: 0, throttle: 0, boost: false };
    const half = (view.map?.bound || 40) * 0.8;
    if (!target || now > retargetAt || Math.hypot(target.x - me.x, target.z - me.z) < 6) {
      target = { x: (rand() * 2 - 1) * half, z: (rand() * 2 - 1) * half }; retargetAt = now + 2500 + rand() * 2500;
    }
    if (Math.abs(me.speed) < 1.5) { if (!stuckSince) stuckSince = now; } else stuckSince = 0;
    if (stuckSince && now - stuckSince > 900) { reverseUntil = now + 700; stuckSince = 0; retargetAt = 0; }
    const want = Math.atan2(target.x - me.x, target.z - me.z);
    let d = want - me.angle; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const reversing = now < reverseUntil;
    const steer = Math.max(-1, Math.min(1, (reversing ? -d : d) * 1.6));
    return { steer: +steer.toFixed(2), throttle: reversing ? -1 : 1, boost: !!me.weapon && rand() < 0.25 };
  };
}
