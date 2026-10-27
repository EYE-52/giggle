# Pocket Karts assets

Original Giggle kart, helmet racer, star and mystery crate are authored in Blender for this project. The kart uses a sculpted nose, rounded sidepods, rubber wheel shoulders, satin metal hubs, exposed cooling fins and twin exhausts. Its marigold helmet has an ivory stripe wrapping front to back, rear vent grooves, visor hinges and a dark visor; the suit and kart paint share the driver's chosen color. The sapphire blue mystery box has beveled yellow corners and raised question marks on all four sides. Every model is original, with no copied game characters or meshes. The question-crate source is `assets-source/karts/giggle-karts-question-source.blend`; regenerate with `scripts/build-kart-assets.py`.

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
