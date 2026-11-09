# Pocket Karts first-visit loading

Local Chrome measurement on 2026-11-09. No push or deployment.

## Measurement

Run `PORT=8280 HOST=127.0.0.1 npm start` in `apps/games`, then:

```sh
KART_LOAD_OUT=/tmp/giggle-kart-load node test/kart-loading-browser.cjs
```

The script opens a fresh Chrome profile at `/practice/?game=pocket-karts`, creates two seats, and presses Play immediately when both seats connect. It uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and `/private/tmp/codex-driving-browser/node_modules/playwright`.

CDP settings: 150 ms latency, `1600*1024/8` bytes/s download, `750*1024/8` upload, and 4x CPU throttling. Both practice seats share that one throttled link. These are browser measurements, not physical-phone measurements.

| Stage | Host ready after Play | Both seats ready | Total transferred |
| --- | ---: | ---: | ---: |
| Original | No ACK within 90 s; server retired match | Failed | 11.96 MB |
| Extracted Wasm, local Brotli, safe server wait | 54.6 s | Not measured separately | 12.84 MB |
| Match-only drivers and scenery | 51.2 s | Not measured separately | 12.10 MB |
| Early warming and shared initialization | 29.7 s | Not measured separately | 9.14 MB |
| Shared practice bytes, unchanged packed thumbnails, optional audio after quorum | 11.0 s | 19.8 s | 5.29 MB |
| Bundled engine, original 6 s optional graphics budget | 10.7 s | 19.2 s | 5.10 MB |
| Same build repeated | 16.0 s | 24.0 s | 5.10 MB |
| Bound optional graphics to 2 s; keep the real first-frame barrier | 6.8 s | 10.8 s | 5.08 MB |
| Final build repeated, fresh profile | 6.6 s | 10.5 s | 5.08 MB |

The final two runs made the host usable at 11.4 s and 11.0 s. The first ready ACK alone is not treated as the full match starting. Navigation to both seats ready took 34.7 s and 34.2 s, including practice setup and early downloads before Play; warming moves work into that period. Only 1.34–1.36 MB of response-body bytes arrived after Play. Final decoded response bodies totalled 14.09–14.12 MB. The failed baseline downloaded only 11.87 MB decoded, because it retired before the full engine/art could load. Baseline and final transfer totals therefore describe a failed partial load and a successful complete load, respectively.

The original local Node host did not compress static files. Live Vercel already compresses JavaScript, so the local baseline's transfer reduction should not be presented as a measured live-site result.

Uncommitted raw measurement JSON and the final screenshot are in `evidence/kart-loading/`. The test script writes its own JSON and PNG for every run.

## Changes

- Extract the exact pinned Rapier 0.21.0 binary into `public/vendor/rapier/rapier.wasm`. Its 4,340,292-byte embedded JavaScript becomes 230,924 bytes of JavaScript plus 3,082,103 unchanged binary bytes. Wasm-bindgen receives a real Response and uses `instantiateStreaming`; its array-buffer fallback remains intact. Node physics continues using the pinned compatibility package.
- Preserve the server's existing `application/wasm` MIME mapping; add the explicit Vercel header. Stream Brotli on the Node host without changing the on-disk release bytes or cache lifetimes.
- Warm only a picked Pocket Karts game, at idle with low fetch priority. The host's pick is sent to the room so other seats warm too. Preload Three, Rapier, the engine bundle, loaders, match drivers, and the chosen map's shared GLBs. Practice starts byte downloads in its chooser and supplies its selected game to every seat.
- Share raw bytes within a practice tab. Every seat still gets its own Response stream, ArrayBuffer, parsed models, physics world and GPU objects. Normal rooms retain their own cache. Failed prefetches can retry.
- Keep driver hashing over all four driver IDs so selecting a smaller loaded subset never changes anyone's animal. The garage still fetches other choices when opened. Remove unused scenery from the selected map's initial requests; retain all weapons that can appear in that match.
- Pack the exact thirteen thumbnail image files into one generated module and bundle the engine source modules. Keep vendor loading and the physics-init/raw-byte-cache singletons external. `npm run vendor` regenerates all artifacts; a regression check compares the shipped bundle to a fresh build.
- Bound optional GPU submissions to two seconds per scene. The six-second budget caused repeated cold-load results to miss the target. Required lighting, art, physics and a real rendered frame still gate readiness; skipped warm-up jobs remain cancelled during play. No rendering quality, simulation or asset bytes are reduced.
- Keep optional sound downloads out of the readiness gate and start them after the server releases all seats. Files, gesture/mute rules and decoding remain the same; recordings can become available after the countdown on a slow link.
- At the existing preparation deadline, keep the kart match and its clock paused, show download progress, and await real readiness. The host's End/Leave controls remain available. The 24 s client soft deadline can still skip optional GPU work, but cannot ACK unfinished required resources or retire the view.

## Caching and release identity

The release pipeline pins packages and hashes all shipped bytes, but its asset URLs are not content fingerprints. Existing asset query strings are manually named versions, not a complete fingerprinting system. Long-lived cache headers were therefore left unchanged. `release-identity.js` is unchanged; both extracted Wasm and generated engine/image modules are included in its normal byte hash. No `public/release.json` is retained.

## Validation

The automated regression tests cover exact Wasm binary identity, streaming and fallback compilation with a real physics step, shared initialization/bytes, cross-frame Response/ArrayBuffer ownership, selected driver identity, map selection, prefetch retry, bundle freshness, required-download gating after the soft deadline, and a server wait beyond its old deadline.

Passed:

- All 112 non-browser kart test files, including the new Wasm/loading/bundle checks. Affected graphics/readiness tests were rerun after the final optional-budget change.
- All game-host, game/view/Three/shell readiness, canonical release, release gate and deployment-session tests. Build and bundle regeneration/freshness checks passed.
- All nine-map production transport rounds: 72 bot seats, real server clocks, legal controls, no state/clock injection.
- 32-driver browser checks on Rookie Ring and Garden Circuit using Chrome/Metal. Final Garden run: 29.8 fps, 30.7 binary frames/s, 51.9 m keyboard movement, no browser/server errors.
- Chess practice: two seats opened with zero kart vendor/asset requests. Mobile Pocket Karts at 390 x 844: real WebGL, no horizontal overflow; screenshot inspected.
- HTTP Wasm: correct MIME, Brotli negotiation (including `br;q=0`), and exact decoded bytes.

The 32-driver harness initially held forward against a nearby Garden barrier. It now backs away with real keyboard input before continuing; the >5 m movement requirement remains, and positive forward speed is also required. A Metal option allows native-GPU evidence on this Mac; the original software-rendering option remains the default. The initial software-rendered run was CPU-bound at 2.2 fps, so it is not presented as hardware performance.
