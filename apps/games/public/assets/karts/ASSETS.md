# Pocket Karts assets

The original Giggle kart, helmet racer and star are authored in Blender. The mystery crate uses the Meshy prize shell from task `01a1cff6-7798-71f8-b9b4-2721ac0e56af`. Its editable model is `scripts/sources/kart-powerups/mystery-crate.glb`. The Blender build preserves the moulded shell and lid, gives the face panels a contrasting finish, and applies the Giggle question mark to all four sides. The kart uses a sculpted nose, rounded sidepods, rubber wheel shoulders, satin metal hubs, exposed cooling fins and twin exhausts. Its marigold helmet has an ivory stripe wrapping front to back, rear vent grooves, visor hinges and a dark visor; the suit and kart paint share the driver's chosen color. The sapphire blue mystery box has beveled yellow corners and raised question marks on all four sides. Every model is original, with no copied game characters or meshes. The question-crate source is `assets-source/karts/giggle-karts-question-source.blend`; regenerate with `scripts/build-kart-assets.py`.

Reproduce the shipping models from the repository root (Blender 5.2.2, Node/npx):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/build-kart-assets.py -- --optimize \
  --stats-out /tmp/giggle-kart-assets/vehicle-stats.json
```

Source lives in `assets-source/karts/giggle-karts.blend`. The script rebuilds that source and exports all three models, then runs glTF Transform 4.5.0 deduplication and pruning with named leaf nodes retained. It does not simplify the silhouette, quantize geometry, or add a runtime compression decoder. Without `--optimize`, it exports the same authored geometry directly from Blender.

The kart faces Three.js +Z at yaw zero, with its origin under the kart and wheels resting on y=0. `KartRoot`, `KartBody`, `FrontSteer_L/R`, `WheelSpin_FL/FR/RL/RR`, and `WheelMesh_FL/FR/RL/RR` are runtime contracts. Rolling radii remain 0.385 front and 0.465 rear; `KartPaint` is the only per-player cloned material. All materials are opaque, shared geometry is reused, and every animated vertex fits the authoritative 2.05-radius hull. Runtime batching merges the static body by material while retaining the wheel pivots.

The asset build checks the +Z orientation, ground origin, identity rotations, material/triangle/file budgets and pickup bounds. `npm run test:kart-art` loads the shipping GLBs through the real Three.js loader, checks recoloring, wheel animation, static batching and hull fit. The source is texture-free, so it remains crisp without texture requests.

Measured on the 2026-10-07 export: kart 160,928 bytes / 10,076 triangles / 9 shared materials; crate 41,352 bytes / 1,916 triangles; star 17,380 bytes / 440 triangles. Runtime static batching reduces the kart from 47 rendered meshes to 15. The complete local kart/environment/combat asset table remains about 688 KiB, below its 1 MB test budget. All three original GLBs pass the Khronos glTF validator without errors or warnings; the kart's two intentionally empty orientation markers are informational only.

Selected environment models by Kenney:
- Racing Kit: https://kenney.nl/assets/racing-kit
- Nature Kit: https://kenney.nl/assets/nature-kit

Both packs are Creative Commons Zero (CC0). Original license files are retained here. Models ship locally as GLB; gameplay does not request assets from an external CDN. The Smash Karts reference was inspected for composition and readability; none of its models, textures, characters, UI or code are shipped.

Backdrops: `backdrops/mountains-day.webp` (garden/grove), `frost.webp`, `neon.webp` and `harbor.webp` are original GPT Image paintings made for this project. `kart-backdrop.mjs` wraps each panorama four times on an inward cylinder in classic and elevated arenas, then hides the procedural mountains. Bumper Blocks keeps its dry quarry horizon. Missing images and headless builds keep the procedural art. Image height/width ratios live in `BACKDROP_THEMES`; frost/neon/harbor use `324/2172` placeholders until the final images arrive.

Foundry uses `backdrops/quarry.webp`, shared from the arena art work. The quarry theme loads this painting directly; if it fails to load, the procedural scenery stays visible.

Clouds: `clouds/cloud-1.webp`, `cloud-2.webp` and `cloud-3.webp` are original GPT Image paintings made for this project, supplied as transparent WebP. Eight distant sprites share three materials and drift slowly. All three images must load before replacing the sphere clouds; missing images and headless builds keep the spheres.

Drivers: `drivers/fox.glb`, `bunny.glb`, `panda.glb` and `raccoon.glb` are original animal racers generated for this project with Meshy text-to-3D (2026-11-07). Each was cut at the seat in Blender to remove the small kart Meshy added, cleaned of loose fragments, normalised to 1 m tall with feet at y=0, decimated to about 2,300 triangles and saved with a 512 px WebP texture and unquantized positions (159–208 KB) so it can join the kart's static batching. `seatKartDriver` replaces the helmet racer's arms, torso, helmet, visor and steering wheel; each driver gets its own batched kart variant and players get a stable driver from their id. If none load, the original helmet racer stays.

## Equipped items and HUD portraits

All eleven unique pickup silhouettes use original Meshy artwork. The three earlier sources (Triple Rockets pod, Tracking Blaster housing, Spinning Bumper ring) keep task IDs `01a1cb50-3ce2-7597-b979-609cb35f69e5`, `01a1cb50-4d6a-726b-88ec-c8249837b0f8` and `01a1cb50-2f48-7787-9520-ac38b753ea53`. The eight additional smart-topology generations, their prompts and task IDs are recorded in `scripts/sources/kart-powerups/source-tasks.json`; the original, texture-free GLBs sit alongside it. The fake crate uses the shared real loot crate, including its question marks.

The builder paints the source components with the common toy palette and fits them to the existing mount positions. The ram keeps the generated bumper, horns and braces; its accidental cockpit and wheels are excluded. The mine rim alone is reduced to keep all three visible tokens below 3,000 triangles. Each rocket and each mine token shares one geometry and disappears separately as the accepted ammo count falls. Other new smart-topology silhouettes are retained without a blanket simplification pass. The portrait manifest records source hashes, task IDs and equipped triangle counts.
Rebuild from `apps/games` with Python via uv and glTF Transform 4.5.0. Supply a temporary working directory for the intermediate GLBs.

```sh
gear_build=$(mktemp -d)
uv run --script scripts/build-kart-pickup-art.py "$gear_build/gear.glb"
npx --yes @gltf-transform/cli@4.5.0 meshopt "$gear_build/gear.glb" public/assets/karts/combat/pickup-gear.glb --level high
npm run vendor
```

The same library includes `PickupCrateLOD`: a reduced version of the real Meshy shell, nested face pads and lid, with flattened source question marks and a rare star. Raised arenas combine its three surfaces once and draw all 48 crates in one instanced batch, plus the existing home-outline batch. The 327-triangle crate costs 15,696 triangles at full capacity, with no new asset request or runtime texture. Full equipped fake crates and classic pickup art retain their own detail.

The Python step also renders the twelve transparent HUD images. The browser preloads them before the round. The compressed gear library shares materials and buffers across karts, including the small mesh used for a rocket in flight.
