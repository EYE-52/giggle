# Pocket Karts play and performance plan

A first-time player should be able to drive to a box, recognise the item, use it while steering, see what happened and choose where to drive next. The chase view is the main design surface. Approve a change from that camera on a moving kart before judging it in an asset viewer.

## What the Smash Karts comparison tells us

Tall Team’s screenshots show a readable side-mounted rocket cluster and a clear view of the driver and road. Its public browser page loads Unity WebGL. The public material does not establish its server tick rate, prediction settings, device frame times or reasons it felt smoother in Discord. Pocket Karts already has a Three.js renderer, Rapier physics, local driving prediction and server-confirmed hits. Changing engines would still leave input, camera and network delays to diagnose. [Tall Team](https://tall.team/games) · [Publisher screenshots](https://play.google.com/store/apps/details?id=com.tallteam.citychase) · [Public game](https://smashkarts.io/)

## Build and check in this order

| Step | Work | Failure to look for | Decision |
| --- | --- | --- | --- |
| 1. Capture a baseline | Use the same map, kart, camera, screen size, peer count and inputs for parked, driving, turning and firing runs. Record frame intervals, work per frame, browser UI changes and camera corrections. | A fast average can hide a long frame, a delayed input or a camera jump. A phone-size window still runs on the desktop GPU. | Reproduce the symptom and identify which measurement moves before changing the engine. |
| 2. Prove one complete pickup | Start with Triple Rockets. Drive to a natural pickup, see the name and three physical rounds, shoot on flat ground and a ramp, score a knockout and inspect remaining ammunition. | A rig can look good in isolation, disappear behind the spoiler or point somewhere different from the projectile. | Use a cropped chase screenshot and a firing sequence at desktop and touch sizes before making more models. |
| 3. Make the rest distinct | Use a different silhouette, action and response for an aimed shot, tracking burst, dropped trap and timed contact item. Generate a portrait from the fitted model. Use the same weapon definition for both arena types. | The icon depicts a different object, two items behave identically, or knockouts consume an attacker's remaining charges. | Exercise every item with a real authority and inspect all twelve side by side in the chase camera. |
| 4. Keep the round moving | Keep reachable pickup sockets free. Replace collected items away from the last pad and waiting karts where possible. Preserve a useful fallback in crowded rooms. | Camping earns another box, a replacement lies outside the playable floor, or the last mine disappears on an incline. | Drive through a box, camp the old pad and drive the mine route on a slope. Check movement, arming and pickups on both arena types. |
| 5. Tighten the whole frame | Only repaint UI when values change. Pool effects, share model buffers, skip hidden scene updates and redundant camera rays. Keep item prefetch and runtime URLs identical. | First fire compiles a shader or downloads art, every network packet rebuilds the HUD, or reducing camera checks puts the camera inside a wall. | Repeat the same baseline and drive against walls, under bridges and through a busy firing sequence. |
| 6. Check feel with people | Give a new player one short round with no coaching. Ask what they picked up, how to aim it, how they knew they hit, and where they went for the next box. | Test code can pass even when a person cannot read the power-up or finds the round dull. | Revise the first misunderstood cue. Repeat on a physical phone with a friend on another connection before claiming mobile or internet performance. |

## Asset pipeline

Generate the smallest useful piece in Meshy and keep the source GLB. Fit parts to the kart in game units. The generated rocket prop had five rockets. The shipped rack uses three copies of one cleaned round, with a separate visible count. Mount the spinner at wheel height and stow traps outside the rear spoiler. Keep the center above the driver's head open. One portrait and both viewing angles must agree about the item.

Weld duplicate vertices, simplify the invisible or tiny detail, then compress the shipping GLB with Meshopt. Preserve the named rocket nodes so they can disappear independently. Load once and clone shared geometry for each kart. Check the decoded geometry, its mounts and the individual rounds again after compression. The equipped mine stack uses 2,694 triangles across its three visible rounds. The decoy uses 1,933. Both fit the 3,000-triangle allowance. The 327-triangle version of the pickup lets the raised arenas draw up to 48 crates together. The budget test loads the same compressed file as the browser. The final gear file is 103,132 bytes. All declared model preloads and their decoder use 976,932 bytes against the existing 1 MB budget. The art sources, task IDs and exact build commands are in the asset notes. [Pocket Karts asset notes](../apps/games/public/assets/karts/ASSETS.md) · [Meshoptimizer documentation](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md)

## Weapon design

| Item | Player decision and feedback |
| --- | --- |
| Triple Rockets | Line up a run and steer between three straight shots. Each follows the kart's pitch when fired. One direct hit removes half of full health. Two can score the knockout. |
| Burst Blaster and Tracking Blaster | Aim the burst gun yourself. Six hits knock out a healthy rival. The tracking gun finds a nearby visible rival in any direction. Stay close to land enough of its 30 light shots. The turret and muzzle flash turn with the shot. |
| Homing Missile | Face the rival to acquire a lock. Its single missile can turn after launch. |
| Trail Mines, Proximity Trap and Fake Crate | Lay three mines along the driven path, drop one proximity charge, or bait a rival with a decoy box. Each has its own stowed and deployed appearance. |
| Spinning Bumper, Turbo Ram and Supernova | Use a contact power-up when a rival is near. The bumper shows the contact perimeter, the ram adds a forward charge and the rare Supernova also protects the driver. A visible timer shows when the effect ends. |
| Nuke and Frost Bomb | Aim for the group. The nuke bursts on contact or fuse expiry and damage falls toward the edge. Frost slows the rivals it catches. |

## Diagnose lag by its symptom

- **The whole screen stalls.** Record Chrome Performance and Three.js renderer counters. Separate main-thread work from GPU work by changing render resolution on the same route. Inspect the worst frames and the first pickup or shot. [Chrome Performance](https://developer.chrome.com/docs/devtools/performance) · [Three.js renderer statistics](https://threejs.org/docs/pages/WebGLRenderer.html)
- **The road moves smoothly but the kart or camera jumps.** Align input, local prediction, the server confirmation and the drawn camera on one timeline. Inspect the rendered pose at ramps, corners and under cover. Keep camera smoothing separate from the feel of steering. Check remote snapshots for jitter and avoid replaying several old corrections in one drawn frame. Extra interpolation smooths remote motion at a cost in delay. [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- **Space or touch feels late.** Measure input to the first locally visible response separately from input to the authoritative hit. Verify a thumb can steer and fire at the same time, release resets the input, and the first tracking shot points at the accepted target. Reserve hit and knockout feedback for the server result.
- **The horizon looks like a picture.** Inspect a high bridge side view and drive toward the edge. A small repeating ground texture, world-space slopes and tree groups give nearby scenery visible motion against distant peaks. Reject a terrain change if the ground seam comes back or draw cost jumps.

## This build and the next playtest

Matched tests found thousands of redundant browser changes over 3.2 seconds in the previous build. On Rookie Ring desktop they fell from 3,025 to 118 parked and from 2,634 to 33 driving in the isolated comparison. Camera checks on the tested clear Skyport route fell from six rays to four per frame. The test Mac was already near 60 fps before these changes. These measurements explain wasted work. They do not establish which delay the user saw on another machine.

The integrated driving benchmark, taken before the last two model reductions and phone text-layout fixes, delivered 59.5–60.3 fps across 16 Chrome samples on an Apple M5. Its 95th-percentile frame interval was 16.7–16.8 ms. These runs used one rendered driver plus three WebSocket peers and desktop or emulated touch input. Chrome verified rear and side tracking from the very first visible shot. WebKit drove a four-seat room. Extended physical-phone play, real internet latency and first-time human comprehension remain open.

A second Chrome test ran the same drive three times over local delivery and three times through a WebSocket proxy with delay and jitter. Median measured round-trip delay rose from 0.5 to 103.7 ms. The first server update showing the turn arrived after 68.3 ms locally and 157.6 ms with the proxy. The visible local turn began within overlapping ranges of 61–80 ms in the two conditions, and the 95th-percentile frame interval stayed at 16.7–16.8 ms. This is evidence that local steering prediction works on this route. The test did not measure packet loss, the frequency of prediction corrections, or a real mobile network.

For the next playtest, record two full matches on the affected phone or desktop and connection. Start with a cold load. Mark the first pickup, first shot, ramp, knockout and respawn. Compare the ten slowest frames and input-to-picture timings against the local build. If local frames are steady while an online kart jumps, investigate network delivery and correction before spending time on art. If frame time rises when scenery or several effects enter view, reduce that scene's graphics cost and rerun the same route.

## Local playtest, 12 November 2026

A two-driver Rookie Ribbons battle ran its full 60-second clock in a visible Chrome window at 1440 × 900 on an Apple M5. The keyboard driver travelled about 331 metres, reversed, turned beside walls and drove under the bridge. The game showed a 0–0 tie and awarded both drivers 150 points. The rival used ordinary game inputs. Neither kart was moved by the test.

The browser presented about 118 frames per second. The 95th-percentile frame interval was 9.2 ms. Six frames took more than 50 ms. Five coincided with screenshots and one with starting the profiler. Outside those capture windows, the longest interval was 25.2 ms. The two-seat run showed no sustained driving or camera stall.

A second two-driver battle ran for 90 seconds at a 390 × 844 touch viewport on a separate M4 Mac. Two simultaneous browser touch points operated the stick and Fire. The driver travelled 138 metres, picked up Trail Mines, Triple Rockets, Spinning Bumper and Proximity Trap from ordinary random boxes, and used all four. The results screen showed the tie. Frame intervals were 16.8 ms at the 95th percentile, with two intervals above 50 ms including screenshot collection. This checks the touch controls on a Mac GPU. It does not measure an iPhone.

### Pickup and parking checks

Each of the 12 battle items was collected and used through the desktop controls and through Chrome’s touch input at 390 pixels. For these 24 trials, the test placed the two karts and an actual crate on the course and selected its next reward. The driver started empty, drove into the crate, read the equipped item and pressed Fire. The game handled collisions, ammunition, shots, traps, contact effects and knockouts. The test observed the effect on the target and the inventory retiring for all 12 items. Releasing the Fire contact kept the other contact on the stick.

| Item type | Items exercised |
| --- | --- |
| Tracking and aimed shots | Tracking Blaster, Burst Blaster, Homing Missile, Triple Rockets |
| Placed traps | Trail Mines, Proximity Trap, Fake Crate |
| Contact and area effects | Spinning Bumper, Turbo Ram, Supernova, Frost Bomb, Nuke |

Parking at the pickup’s original coordinates after spending the item produced one pickup total over 8.4 seconds in each browser test. That covered four ordinary refill intervals on this Rookie Ribbons pad. An additional 14-second test of the game rules covered Classic, Garden and Rookie Ribbons. These cases now run in `apps/games/test/kart-classic-payloads.mjs` and `apps/games/test/kart-arena-policy.mjs`.

### Chase camera and room size

A controlled Rookie Ribbons circuit started at a known pose, climbed from 0.64 m to 6.65 m, crossed the bridge and came back down. The renderer replayed the recorded physics run with eight visible karts on an M4 Mac. The chase camera followed the recorded kart as a spectator so local driver prediction could not move it off the recorded path. Across 2,063 frames the kart stayed in view, the camera stayed outside the static scenery, and its largest step was 0.155 m. Frame p95 was 16.7 ms. Separately, one Chrome driver and seven ordinary WebSocket drivers shared a live room. In a 20-second sample it rendered at 60 fps, with a frame p95 of 16.8 ms. That driver used normal prediction on the lower floor. Driver prediction on the ramp and real internet delivery remain unmeasured in these runs.

The USB iPhone was detected. Safari reported that Web Inspector was off. As of the evening recheck, USB discovery listed no device and the saved results contained only Mac browser runs. The touch results above came from a Mac. A phone on the same Wi-Fi can open the regular Practice route on the local Games server and tap Play.

## Handling and all 18 battle arenas

Every arena accepts 2–32 drivers in Zap Battle. The picker shows the suggested group size and the host can open it again from the results screen. Small groups get the smallest layout of a large arena. A room that exceeds a map's suggested size gets the full layout. Extra drivers use spare start points first, then clear bays beside the original grid. The server checks the chassis, wheel support and space between drivers. Garage Battle and Star Rush still use their five compatible arenas.

All 558 combinations of arena and room size started in the real room engine. Run `node apps/games/test/kart-complex-rooms.js --all-counts` to repeat the check. A second check connected 32 local WebSockets to each of the 13 raised arenas. Everyone received a driving seat. On desktop and at 390 px with touch input, all 18 previews could be selected. Two practice seats drove Skyport Split, finished the round and the host saved Harbor Fork for the rematch. Mid-round joiners watched, then took driving seats at the next start.

Both older and newer raised worlds can use the same compact network updates. In a controlled 32-driver run, Alpine Courtyard sent about 46 KiB per second to a browser using compact updates, compared with 724 KiB for full JSON updates. Reconnect, item positions, health, driver positions and private input acknowledgements were checked. This measures a local simulation and wire format.

### Driving on Rookie Ring

| Browser input | Before | After |
| --- | ---: | ---: |
| Keyboard, rest to 54 km/h | 0.77 s | 0.67 s |
| Touch stick, rest to 54 km/h | 0.89 s | 0.78 s |
| Keyboard, high-speed turn radius | 13.82 m | 10.32 m |
| Touch stick, high-speed turn radius | 14.51 m | 10.57 m |
| Keyboard, moving forward to 14.4 km/h in reverse | 0.88 s | 0.77 s |
| Maximum reverse speed, both inputs | 17.76 km/h | 28.39 km/h |

The turn samples used the same part of a continuous turn in open space, at roughly 61–63 km/h. More grip helps the front wheels carry the kart through the turn. The extra pull tapers away at cruising speed. Partial stick movement gets a gentler launch. The browser and server both use these rules.

On one downhill sample in Neon Yard the physical chassis touched the ground by 6.2 mm for one simulation step. The terrain check limits moving contact to 1 cm for at most two consecutive steps and checks positive clearance again afterward. Wall and kart collision checks run separately.


### Frame timing

Two separate one-minute practice matches finished on an Apple M5 in Chrome. The visible kart canvas submitted roughly 60 frames per second during a 46-second moving sample on Rookie Ring at 1280 × 800 and Rookie Ribbons at 390 × 844 with touch input. With the final Meshy assets and arena crates, 95% of frame intervals were under 18.6 ms on keyboard and 18.8 ms with touch. Neither sample contained a gap above 50 ms. The measurements used the Mac GPU with the other test browsers stopped.

On Alpine Courtyard, one browser driver and 31 WebSocket drivers stayed connected. With hardware graphics, Chrome measured 60.1 fps during 21 seconds of driving and received 20.2 network updates per second. With SwiftShader software graphics, the same test averaged 13.8 fps. Software-only rendering of a crowded room remains slow.
