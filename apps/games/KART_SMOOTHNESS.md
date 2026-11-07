# Pocket Karts smoothness

2026-11-08, India. Saved reviewer measurements: Garden Circuit, five bots + Chromium driver, 25 s requested, about 120 Hz. No new browser run succeeded here.

## Symptom and changes

“Smooth, then freezes, skips, then moves.” Late packets froze prediction despite held controls and smooth rendering.

| Root cause | Current classic behavior |
|---|---|
| Own kart froze after 250 ms without a snapshot | Predict for 1500 ms, then hold; keep recent history. |
| Late arrival wiped history, then snapped to an old pose | Keep 1500 ms of merged intent intervals; replay after `simAt`. |
| Thirty history entries covered only 250 ms at 120 Hz | Retention follows time, not frame count. |
| A slow frame simulated only 50 ms | Simulate up to 250 ms in ≤50 ms steps; history matches simulated time. |
| Small fixed blend; larger corrections snapped | Decay accumulated visual error with a speed cap. Position threshold is **8 m**; life/control/teleport changes and >60° yaw still reset. Drop unsafe geometry offsets. |
| Remote delay capped at 250 ms, then short extrapolation held | P90 age window (3 s / 128 entries), slewed delay, 300 ms damped extrapolation and recovery smoothing. **Classic keeps `maxDelay:250`** after A/B; generic default is 400 ms. |
| Every packet restored and replayed Rapier | Observe every packet; restore/replay newest once per frame. |
| Physical projectiles hid at 250 ms; records reset across a gap | Remote playback clock; ≤150 ms unconfirmed lead, then hide until newer data. Keep TTL and 1000 ms record-age cutoff; no gap reset. |

## Local before / after

Sources: `/tmp/kprobe/{before,before-prod}` = two `origin/main` runs, port 8301; `/tmp/kprobe/after` = branch, port 8302. Cells show **main range → branch**. Jerk means second position difference in metres, without time normalization.

| Scenario | Own freeze frames | Snaps | Own jerk p99 (m) | Own jerk max (m) | Remote delay p50 (ms) | Raw remote jerk p99 (m) | rAF p99 (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| sg-good | 0 → 0 | 0* → 0 | 0.02–0.04 → 0.02 | 0.09 → 0.08 | 95.64–96.88 → 94.4 | 0.07 → 0.03 | 9.3–10.2 → 9.3 |
| sg-mobile | 42–44 → 0 | 20–25 → 0 | 0.03–0.04 → 0.02 | 3.2–5.56 → 0.08 | 231.43–234.58 → 242.72 | 0.17–0.33 → 0.57 | 9.3–10.3 → 9.3 |
| sg-mobile-cpu4 | 36–38 → 0 | 22–32 → 0 | 0.08–0.1 → 0.07 | 2.86–9.27 → 0.81 | 173.13–196.98 → 220.29 | 0.32–0.6 → 0.48 | 25.1–25.7 → 17.4 |
| mumbai-good | 0 → 0 | 0 → 0 | 0.02–0.03 → 0.02 | 0.06–0.13 → 0.09 | 79.55–80.55 → 76.2 | 0.05–0.07 → 0.04 | 9.3–10.3 → 9.3 |
| mumbai-mobile | 39–41 → 0 | 16–17 → 0 | 0.02–0.03 → 0.02 | 3–3.64 → 0.27 | 168.74–171.08 → 161.91 | 0.25–0.31 → 0.2 | 9.3–10.3 → 9.3 |

`*` First `sg-good` has `snaps:null`; zero is known only from the repeat. Snaps include resets. `staleFrames` counts frames >250 ms since receipt; it does not mean frozen. Branch SG-mobile: **462 stale / 0 freeze frames**. Freeze means near-zero movement while speed >3.

Good: added RTT 90/45 ms, exponential jitter mean 8 ms per direction. Mobile: jitter 25 ms, loss 1%, 250–700 ms downlink stalls averaging every 4 s. `cpu4` adds 4× CPU throttling. Only the browser is impaired; bots connect directly. Saved runs have no page errors.

## Remote recovery verdict

**Working verdict: likely run-to-run variance, not a demonstrated recovery-smoothing regression. Keep smoothing and the 250 ms cap.** Two branch samples cannot settle final rendered smoothness.

| SG mobile source | Raw jerk p99 (m) | Jerk events 0.5–15 m | Delay p50 (ms) | Snapshot gaps >250 ms | Underrun p99 (ms) |
|---|---:|---:|---:|---:|---:|
| main, first | 0.17 | n/a | 234.58 | 14 | 550.78 |
| main, repeat | 0.33 | n/a | 231.43 | 13 | 500.9 |
| branch, after (cap 250) | 0.57 | 37 | 242.72 | 13 | 664.95 |
| branch, A/B cap 250 | 0.28 | 20 | 202.79 | 9 | 616.63 |
| branch, A/B cap 400 | 0.26 | 20 | 292.89 | 16 | 981.28 |

Main varies nearly 2×; the same branch/cap also varies about 2×. Mumbai improves (main 0.25–0.31 m, branch 0.12–0.20 m); CPU4 branch 0.48 m is within main's 0.32–0.60 m range. SG A/B saves **90.10 ms** median delay with similar raw jerk (0.26 → 0.28 m). Bot paths/combat are not fixed by the relay seed.

The probe hooks immediately after `remoteSample()`, **before near-field blending and recovery smoothing**. Raw jerk cannot identify a recovery-smoothing regression. Maxima include teleports; 0.5–15 m counts may include short respawns (older baselines lack counts). `frozenOver120` counts underrun age, not rendered freezes. Next: log final returned poses with life tags, then 2–3 runs per side. Recovery code is unchanged.

## Production baseline

`/tmp/kprobe/prod`, release **124553c** (`main`), six drivers, 25 s requested. Mobile adds jitter 15 ms, loss 1%, 250–600 ms stalls averaging every 5 s; no added base RTT.

| Scenario | Browser gaps >250 ms | Browser max gap (ms) | Observed simAt step p99 (ms) | Step max (ms) | Direct bot gaps >250 ms | Bot max gap (ms) |
|---|---:|---:|---:|---:|---:|---:|
| prod-classic | 0 | 207.8 | 37 | 39 | 1 | 263.02 |
| prod-classic-mobile | 7 | 591.5 | 37 | 299 | 15 | 439.71 |
| prod-raised | 2 | 473.3 | 50 | 50 | 30 | 376.46 |
| prod-raised-mobile | 21 | 513.6 | 150 | 400 | 24 | 713.55 |

Clean timestamps show steady cadence: classic **37/39 ms p99/max**, Skyport **50/50 ms**. Impaired or coalesced `simAt` increments can skip samples; they are not tick-duration measurements. The branch hook observes heavy ingests, so its large local steps do not establish server stalls. Use private `KART_TICK_STATS=1` logs for tick+broadcast timing.

Direct bots also see real long gaps without synthetic impairment. A region move alone cannot remove them; these samples do not separate radio stalls from TCP retransmission.

## Infrastructure

Reviewer-measured TCP connect RTT from this Mac in India, **2026-11-08**; not measured game input latency.

| Endpoint | Median RTT (ms) | p90 RTT (ms) |
|---|---:|---:|
| Railway Singapore | 83 | 126 |
| Vultr Mumbai | 47 | 65 |
| AWS Mumbai (`ap-south-1`) | 67 | 99 |
| Vultr Bangalore | 66 | 118 |
| Delhi | 88 | 108 |
| AWS Singapore | 84 | 105 |

The local good-link rows show the propagation benefit separately from burst handling:

| Local model | Added RTT (ms) | Remote delay p50: two main runs → branch (ms) | Input→authority network floor, RTT/2 (ms; estimate) |
|---|---:|---:|---:|
| sg-good | 90 | 95.64 / 96.88 → 94.4 | 45 |
| mumbai-good | 45 | 80.55 / 79.55 → 76.2 | 22.5 |

Branch remote delay improves **18.20 ms**. Halving modeled RTT saves **22.5 ms** one-way input travel, before jitter and next-tick wait (0–~33 ms). The probe stores no send→ACK timestamps: input→authority latency is an estimate, not a measurement.

**Mumbai: yes**, per `apps/games/MUMBAI_MOVE.md` on [PR #50](https://github.com/EYE-52/giggle/pull/50), subject to owner approval (plan absent here). Lower RTT does not remove 250–700 ms last-mile/radio stalls or TCP head-of-line blocking. **Edge relay: no**, an extra hop with upstream/last-mile risks remaining.

**WebTransport: later**, if measured loss-driven stalls remain. QUIC datagrams remove loss head-of-line blocking, not radio outages. Add an HTTP/3 endpoint alongside Node; retain fallback. TCP fallback/reliable ordering can reintroduce waiting. [W3C explainer](https://github.com/w3c/webtransport/blob/main/explainer.md).

[WebKit confirms Safari 26.4 shipped WebTransport](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/#webtransport) on March 24, 2026. Still test actual supported iPhones, datagrams, reconnects and UDP-blocked paths; keep WebSocket fallback for older Safari. Hosting changes require owner approval.

## Re-run

Run sequentially from `apps/games`; use existing servers on 8301 (main) and 8302 (branch). If 8302 is absent, start it in a separate terminal:

```sh
PORT=8302 HOST=127.0.0.1 node server/server.js
```

Local matrix, writing new output directories:

```sh
export NODE_PATH=/Users/divyansh/Projects/Kaltstart/giggle/node_modules
run_probe() {
  node tools/realtime/prod-probe.cjs --url "$probe_url" --map "Garden Circuit" \
    --bots 5 --seconds 25 --seed 7 --out "$probe_out" "$@"
}
for probe_port in 8301 8302; do
  probe_url="http://127.0.0.1:$probe_port"
  probe_out="/tmp/kprobe/review-$probe_port"
  mkdir -p "$probe_out"
  run_probe --rtt 90 --jitter 8 --label sg-good
  run_probe --rtt 90 --jitter 25 --loss 0.01 --stall 4,250,700 --label sg-mobile
  run_probe --rtt 90 --jitter 25 --loss 0.01 --stall 4,250,700 --cpu 4 --label sg-mobile-cpu4
  run_probe --rtt 45 --jitter 8 --label mumbai-good
  run_probe --rtt 45 --jitter 25 --loss 0.01 --stall 4,250,700 --label mumbai-mobile
done
```

For production baseline capture, use the same `run_probe` function:

```sh
probe_url=https://play.gigglemeet.com
probe_out=/tmp/kprobe/review-production
mkdir -p "$probe_out"
run_probe --label prod-classic
run_probe --jitter 15 --loss 0.01 --stall 5,250,600 --label prod-classic-mobile
node tools/realtime/prod-probe.cjs --url "$probe_url" --map Skyport --bots 5 \
  --seconds 25 --seed 7 --out "$probe_out" --label prod-raised
node tools/realtime/prod-probe.cjs --url "$probe_url" --map Skyport --bots 5 \
  --seconds 25 --seed 7 --out "$probe_out" --jitter 15 --loss 0.01 \
  --stall 5,250,600 --label prod-raised-mobile
```

The relay seed is repeatable; gameplay and realized timing are not identical. For a new cap or recovery comparison, keep separate labeled output directories and collect 2–3 runs per side. The current remote hook still reports pre-smoothing samples.

## Limits and checks

- Raised arenas' own-kart prediction lives on **`claude/maps-polish`**. Skyport rows are a baseline only; this classic change does not fix raised-arena playback.
- Local cosmetic flying projectiles and authoritative handoff are not implemented. Only immediate muzzle flash/sound on press for machine gun/tri-shot (plus existing recoil) are covered.
- Remote-kart numbers are raw buffer samples, taken before the recovery smoothing (see the verdict above). Own-kart numbers are the final rendered pose.
- Tests: all 203 commands in `npm test` pass. A few were retried after another worktree's test server held ports 18234/18235.
