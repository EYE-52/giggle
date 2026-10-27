# Evidence gates for new 3D games

Status of this document: proposed acceptance contract. None of these new-game tests has run. Every case starts PLANNED; an unavailable physical device/browser/call is UNVERIFIED. A release cannot earn full acceptance by substituting screenshots, headless runs or resized desktop for those checks.

## Independent ownership

Muse/implementer supplies code, test cases and failure reproductions. Root owns UI/asset/input/audio/playfeel decisions. Another agent or reviewer checks authority/lifecycle regressions and evidence binding. Two first-time people provide human play feedback; bots do not substitute for that. Browser/physical-device/audio/Meet capability must be established before assigning a corresponding QA task. If Muse has no browser tool, root owns that pass and records the gap.

## Required gate outputs

| Gate | Evidence needed | What fails it |
|---|---|---|
|G0 design|Exact player verbs, first minute, supported roster table, win/tie/recovery rules, one level, camera/control layouts, primary references and asset shortlist; root/user review|Ambiguous rules, inflated scope, unusable assets, decorative scene as interactive UI, missing phone/embedded design|
|G1 mechanic|An actual two-person end-to-end slice and human feedback: understood action, fair result, recoverable mistakes, waiting and voluntary rematch|Designer coaching required, unrecoverable state, visibly unfair input, weak core action, unacceptable waiting|
|G2 polished slice|Actual asset render, camera, normal and peak animation, HUD, menus/results/reconnect; listened gameplay audio and input feel|Placeholder spheres posing as everything, washed-out scene, obscured action, intrusive text, camera shaking, delayed first FX, uncomfortable/disconnected audio|
|G3 quality|Behavioural tests, native-browser inspection, actual phone/tablet touch/keyboard, network/performance traces, live Meet/embed cases, truthful separate statuses|Early timers, race conditions, missing settlement, wrong collision, scroll stealing, unsupported input, state leak, crashes, unresolved high-impact defects or required checks unverified|
|G4 release|Exact source/assets bound to those results, clean platform+game checks, matching frontend/backend deployment, ordinary public lifecycle and post-deploy health/asset checks|Ungated code overlay, changed asset after review, stale deployment, original failure silently replaced with success, dirty/private runtime payload|

No blanket promise of bug-free play is derived from a passing suite. A known important failure needs a reproduction/fix/regression check and independent replay. Pure presentation revisions need visual verification; do not add tests that only mirror CSS or implementation strings.

## Meaningful behavioural cases

Shared:2 and maximum active seats complete join → setup → ready → play → natural result → rematch → change → end/leave. Include late watcher, token reconnect, elected host, host kick, rejected action, duplicate/stale instance/window, old timer, background/offscreen client, delayed CSS/fonts/model/WASM, asset error, context loss, blur/modal/input cancellation, missing participants and exact-once cleanup.

Golf: all players aim/roll at once; same-tick cup entries; duplicate shot and shot while rolling; high-speed cup/edge/bumper collision; stable authoritative rest; slope/visual collider alignment; rolling disconnect; out-of-bounds reset/penalty; stroke cap/deadline; equal totals; camera freeze during drag; pointer capture cancellation; early-finisher follow without input or score authority.

Bombs: contested placement; tile departure/re-entry; at-fuse-boundary move versus detonation; blocked ray and cover destruction; multiple causal chains; same-tick deaths/draw; all supported spawn counts/seeds; disconnected occupancy; rejected optimistic placement; last visible explosion before victory/results; eliminated spectator cannot affect survival.

Rocket: every roster size2–6 has meaningful actions; right/wrong simultaneous command; shared resource depletion; command at deadline; exact-once repair; progressive hints; disconnected responsibility reassignment; private clue/control projections including spectators/reports; role rotation; text/ping completion equivalent to voice; phone keyboard retains current task and send control.

Await exact expected ACK, instance, phase or projection. Do not infer action success from an arbitrary number of broadcasts or a fixed sleep. Keep original failing logs and unchanged assertions; never raise a timeout merely to turn red green. A separate causal diagnostic is not retrospective proof of an uninstrumented failure.

## Native and physical matrix

- Desktop Safari and Chrome: keyboard/mouse, small non-touch laptop window, high-DPI, resize while active, menu open, browser blur and full match.
- Physical iPhone Safari and midrange Android Chrome: portrait/landscape, multi-touch, cancellation, actual safe areas, keyboard-open, resume/background, cold load and heat. Record exact model/OS/browser; device model is currently to be selected, not silently assumed.
- Physical tablet: touch with optional keyboard/mouse, supported orientations and split/compact window. A desktop viewport at tablet dimensions is additional layout evidence only.
- Standalone and Giggle Meet embed: compact game frame, floating/docked participant tiles, sidebars/chat/keyboard, focus return, report/end/leave, two actual participants with live media/communication. Do not request a second microphone stream or record media.
- Representative visuals: loading, first actionable frame, aiming/placement/repair, maximum roster, largest supported effect, failure/recovery, results and reconnect. Inspect actual renders, not just DOM bounds/text. Reduced motion must preserve hazard/shot/repair information.

## Proposed measurable budgets

These are starting acceptance targets, not observed results. Name hardware and repeatable workload before measurement; revise a target only with a documented product/engineering decision.

- Critical compressed first-play payload≤4 MB, including required vendor/WASM/fonts/models/audio. Target usable cold scene≤5 seconds at declared10Mbps/100 ms with visible loading throughout; do not ship every asset in a kit.
- Desktop60FPS target: p95 presented frame interval≤20 ms; physical midrange phone30FPS target: p95≤36 ms. Capture normal and busiest intended scene, first effect and10minute thermal play; report stalls, not just average FPS. Headless software GPU timings do not approve native performance.
- Local input feedback≤50 ms; log server confirmation separately. Observe correction distances/rejected optimism and whether outcomes are understandable at nominal,150and300msRTT plus jitter, interrupted snapshots and3second disconnect. WebSocket TCP interruption is not arbitrary packet reordering.
- Measure maximum-roster snapshot bytes/traffic, simulation step CPU, bounded entity/FX growth and a declared concurrent-room workload before setting service capacity. No speculative infra purchase substitutes for profiling code.
- After10rematches/game switches: count active listeners/timers/loops/audio nodes/physics worlds; inspect heap/GPU resources for accumulation. Render and physics teardown must be verified together.

## Release evidence record

Every case stores: id, game, purpose, exact source and asset-manifest hash, actor/roster, browser/device, clock/network mode, steps, expected result, actual result, pass/fail/unverified, artifact path/hash and independent reviewer. Controlled clocks, synthetic inputs, scripted peers, stationary targets and debug overrides are labelled. Never publish credentials/private reports/raw media. Full-match fun, physical touch and heard audio cannot be approved by unit-test counters.

Only tested supported modes/maps are offered in a release. Zero high-impact known defects is required; lower-impact known defects are disclosed, assigned and assessed before root's release decision. Original failed attempts remain recorded alongside the repaired candidate.
