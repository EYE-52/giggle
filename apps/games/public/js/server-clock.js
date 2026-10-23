/* Server deadlines use a monotonic client clock. Sample the round trip,
 * then anchor to the server's timestamp plus half the measured latency.
 * Neither a wrong wall clock nor a later system-clock adjustment affects it. */
export function createServerClock({ monotonic = () => performance.now(), wallTime = () => Date.now() } = {}) {
  let anchor = { local: monotonic(), server: wallTime() };
  let calibrated = false;
  let sequence = 0;
  let pending = null;
  let samples = [];
  const now = () => anchor.server + monotonic() - anchor.local;
  return {
    now,
    request() {
      pending = { id: String(++sequence), sent: monotonic() };
      return { t: 'clock', id: pending.id };
    },
    accept(message) {
      if (!pending || !message || message.id !== pending.id || !Number.isFinite(message.serverNow)) return false;
      const received = monotonic();
      const elapsed = received - pending.sent;
      pending = null;
      if (elapsed < 0 || elapsed > 10000 || message.serverNow <= 0) return false;
      samples = samples.filter(s => received - s.local < 90000);
      samples.push({ local: received, server: message.serverNow + elapsed / 2, elapsed });
      samples = samples.slice(-8);
      const best = samples.reduce((a, b) => a.elapsed < b.elapsed ? a : b);
      anchor = best;
      calibrated = true;
      return true;
    },
    observe(serverNow) {
      if (calibrated || !Number.isFinite(serverNow) || serverNow <= 0) return;
      anchor = { local: monotonic(), server: serverNow };
    },
    reset() { calibrated = false; samples = []; pending = null; },
    isCalibrated: () => calibrated,
  };
}
