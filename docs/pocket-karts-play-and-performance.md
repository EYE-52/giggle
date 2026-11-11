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

Weld duplicate vertices, simplify the invisible or tiny detail, then compress the shipping GLB with Meshopt. Preserve the named rocket nodes so they can disappear independently. Load once and clone shared geometry for each kart. Check the decoded geometry, its mounts and the individual rounds again after compression. The first shipped mine stack and decoy exceeded the 3,000-triangle allowance. The final decoded mine stack has 2,306 triangles and the decoy has 2,310, each in one draw. The budget test loads the same compressed file as the browser. The final gear file is about 102 KB. All declared model preloads and their decoder use 956,216 bytes against the existing 1 MB budget. The art sources, task IDs and exact build commands are in the asset notes. [Pocket Karts asset notes](../apps/games/public/assets/karts/ASSETS.md) · [Meshoptimizer documentation](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md)

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
