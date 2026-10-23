# Kart environments and asset provenance

## Elevated Alpine Courtyard — stylized authored kit

The player renderer selects a curated `stylized-alpine.glb`, with shaped models from the matching Quaternius [Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit) and [Medieval Village MegaKit](https://quaternius.itch.io/medieval-village-megakit) free Standard sets. Both included licenses are CC0. Sources, dependency/UV audits and hashes live under `assets-source/karts/stylized-alpine-20261007/`; curated cottage assembly, texture preparation, model bounds and runtime freeze live under `assets-source/karts/stylized-alpine-build-20261007/`.

Trees, shaped rocks, grass, flowers, shrubs and complete timber/stone cottages share painted authored materials. Clean ground coloring and separate sculpted valley/peak meshes replace the photographic trial. Live authoritative driving surfaces, spawns, pickups and collision descriptors remain unchanged. The imported source library owns geometry, textures and decoded images; world-owned instance buffers/material clones are released separately.

Frozen shipping library: 2,813,936 bytes, SHA256 `9426a0eda6c18038c9d33caeb8e2011fda03134224cad4d0ed9273d9b20ecd7c`; nine identity ground roots, 28,508 template triangles, 14 shared materials and 24 embedded PNG/JPEG textures. Opaque painted maps use JPEG; foliage cutouts retain PNG alpha. Estimated decoded RGBA8 plus mipmaps: 9.87 MiB for the library, 12,201,980 bytes for the assembled world including the route mask and cloned masonry maps. These estimates exclude renderer targets, karts and combat models. Khronos reports zero errors, one runtime-tangent warning and one NPOT atlas information item. Exact model bounds and 106 source-file hashes are in the source freeze.

This is a local art candidate, not a production release or full-map approval. Native camera composition, device budgets, route/gameplay and remaining architecture still require review. See the candidate evidence for measured draw calls, payload and decoded-texture estimates rather than inferring performance from source archive size.

## Archived photographic trial — not selected by the player renderer

The user rejected the photographic appearance. These files and their isolated regressions are retained for provenance and pipeline comparison; the player renderer no longer requests this material/grass/fir library. Their validation does not approve their appearance or the current stylized world.

- Ground: ambientCG [Grass001](https://ambientcg.com/view?id=Grass001), Poly Haven [brown_mud_dry](https://polyhaven.com/a/brown_mud_dry) and [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08). Paving, earth verges and grass blend on the existing authoritative floor. The internal `limestone` floor slot contains cobblestone, not a geological classification.
- Masonry: Poly Haven [white_sandstone_blocks_02](https://polyhaven.com/a/white_sandstone_blocks_02), independently tiled on wall and structure surfaces.
- Grass: Poly Haven [grass_medium_01](https://polyhaven.com/a/grass_medium_01), photographed alpha/UVs retained, 833-triangle near and 299-triangle distant nodes. Both share one 512px RGBA atlas in `../terrain/grass-clumps.glb`.
- Trees: Poly Haven [fir_sapling_medium](https://polyhaven.com/a/fir_sapling_medium), two authored variants with real needle cutouts and bark, plus distant variants. `SpruceA`/`SpruceB` are stable runtime slot names; the source models are firs.
- Outcrop: Poly Haven [coast_rocks_05](https://polyhaven.com/a/coast_rocks_05) and [rock_moss_set_02](https://polyhaven.com/a/rock_moss_set_02), scanned stone/moss geometry and materials combined into one reusable model.

These sources are CC0. Original download hashes, authors, licenses, preparation scripts, geometry bounds, texture channel treatment and runtime hashes are retained in `assets-source/karts/terrain-20261007/` and `assets-source/karts/alpine-nature-20261007/`. The raw source files are authoring inputs, not browser payloads. glTF validation and imported-runtime previews are recorded there. Nature validation retains ten runtime-tangent warnings, with no errors.

The preferred terrain/grass transfer is 4,139,290 bytes. The nature library adds about 2.76 MB; its exact metadata-corrected size and hash are in its freeze record. Maps use 1024px color, 512px normals, 256px roughness; normals are linear OpenGL channels. The combined conservative RGBA/mipmap estimate is about 57.3 MiB before the floor mask, renderer targets, karts or weapons. This is an estimate, not measured device GPU use or a claim of physical-phone acceptance.

The archived trial borrows geometry/textures from hidden scene-owned libraries, owns its material clones and instance buffers, limits grass by distance, and swaps detailed/distant firs. It removes the old cone crowns and dodecahedron rocks from the real Alpine path. Tree/outcrop geometry stays outside the authoritative field plus its safety setback; grass remains soft and clear of solid footprints, spawns and pickup sockets. Textures do not change collision or surface height. Retiring a renderer releases GPU assets and closes its shared decoded ImageBitmaps once.

The mountains, structures, hedges, scene composition and remaining vehicle/combat art still require separate refinement. The renderer uses geometry and source materials; concept images are references, not runtime backgrounds.

## Classic maps — original runtime art

The classic environment is authored in `public/js/engines/kart-world.mjs`. Original geometry and canvas-painted surfaces are generated once per world mount. This older path does not use the new downloaded terrain/tree/rock assets above. The adopted `assets-source/art-direction/kart-castle-concept-v2.png` and `assets-source/art-direction/game-targets/pocket-karts-v1.png` guide composition and detail; they are direction references, not rendered-game claims.

- Garden Circuit: limestone alpine valley, three snowy ridgelines, clustered six-tier firs, timing tower and four timber chalets around a shared square, connected asphalt routes with red/white curbs, low grass and daisy patches between lanes.
- Rookie Ring: compact village ring, race perimeter, woodland shelves and a timing/watch tower.
- Bumper Blocks: limestone quarry, rocky shelves, ochre loading crane, sparse firs and original exact bumper footprints.
- Frosty Pass: snow-coated firs, snowy ridges, blue ice/grip markings and red gondolas beside an alpine lift station.
- Neon Yard: port crane and container setting with a bounded teal/magenta city skyline.

Repeated fir crowns, trunks and limestone outcrops are instanced in three draws. Soft meadow grass and daisies use two more bounded instance draws. Landmark parts share an instanced unit-box geometry by material. Asphalt uses original painted grain and a small procedural bump texture. All whole-map atlases remain 1024px. Garden’s centre dashes share one flat geometry batch of 564 triangles, driven by the same paths as the road atlas, so foreground paint does not magnify texture pixels. The 512px grain repeats separately with linear bump data, and grazing-angle sampling requests at most 16× anisotropy (the renderer applies the device limit). Original roof, clock-face and stone surfaces are also generated locally. No new asset downloads, decoder, render dependency or collision geometry is introduced. Existing Kenney CC0 stands, pit structures and barrier assets retain the provenance documented in the parent ASSETS.md.

New solid decoration remains outside the authoritative field plus the 2-unit scenery setback; triangle clipping checks diagonal faces too. The soft meadow patches inside the field are noncolliding, shorter than 0.75 units, and kept clear of cover by the kart hull radius. Road paint and grass do not change drivable space or grip. Obstacles, turbo strips and grip zones still follow exact server rectangles. Lighting, camera, HUD, karts, simulation and map IDs remain owned by their existing modules.

Validation: `node test/kart-alpine-world.mjs`, `npm run test:kart-art`. Native chase screenshots and mobile frame distribution are recorded separately in the local review evidence. This note does not imply visual approval or production deployment.
