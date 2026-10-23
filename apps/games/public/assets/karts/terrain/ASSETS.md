# Kart terrain assets

All source assets are CC0-1.0. Provider pages and license declarations were checked on 2026-10-07. Attribution is retained for provenance.

| Runtime family | Official source | Author/provider | Physical repeat |
| --- | --- | --- | --- |
| grass | [Grass001](https://ambientcg.com/view?id=Grass001) | ambientCG | 1.4 × 1.4 m |
| earth | [Brown Mud Dry](https://polyhaven.com/a/brown_mud_dry) | Rob Tuytel / Poly Haven | 1.3 × 1.3 m |
| limestone | [Cobblestone Floor08](https://polyhaven.com/a/cobblestone_floor_08) | Rob Tuytel / Poly Haven | 2 × 2 m |
| wall | [White Sandstone Blocks02](https://polyhaven.com/a/white_sandstone_blocks_02) | Rob Tuytel / Poly Haven | 2 × 2 m |
| grass-clump | [Grass Medium01](https://polyhaven.com/a/grass_medium_01) | Rico Cilliers (modeling), Rob Tuytel (photography) | Source metre scale; 0.185 × 0.140 × 0.162 m tuft |

Licenses: [ambientCG](https://docs.ambientcg.com/license/), [Poly Haven](https://polyhaven.com/license), [CC0 legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

`limestone` is a path-material role name; the cobblestone provider does not specify geological stone type. The `wall` family is a separate masonry material, never a pavement alias.

Color maps are 1024² WebP q88 in sRGB. OpenGL +Y tangent normals are 512²; source vectors are box-averaged then renormalized. Scalar roughness is 256², with 16-bit originals normalized before reduction. Both data-map roles use lossless WebP and linear/no-color-space interpretation. No green-channel flip, AO, displacement, or physical-terrain change is included.

The four terrain sets total **3,749,814 bytes**. If all 12 maps use RGBA GPU storage with full mipmaps, they require approximately **28 MiB**, regardless of WebP transfer compression. Active-map loading is preferable to loading every family in every world.

The near grass tuft preserves official `grass_medium_01_small_a_LOD0` topology (833 triangles, 888 vertices), normals and UVs. Its only geometry change translates the horizontal bounding center to the origin and the bottom to y=0. It has one 512² native PNG color/alpha atlas, one double-sided `MASK` material with cutoff 0.42, roughness 0.9, and no decoder extensions. Source normal/ARM textures are retained in authoring but omitted from this small runtime tuft. This atlas uses the actual separately provided official alpha; the original provider glTF's JPEG reference alone would not preserve transparency.

The distant template is a reviewed **299-triangle derivative** made with glTF Transform 4.5.1 weld/simplify (ratio 0.36, error 0.02, unlocked borders). It retains the same PNG atlas and material. Both actual models were rendered with the same camera and light; overall blade layout remains recognizable while fine tips become straighter. A 349-triangle alternative was also inspected and not selected. Near patches retain the 833-triangle authored model. Source and derived GLBs validate without glTF errors or warnings.

The sole runtime grass bundle is **`grass-clumps.glb`**, made by glTF Transform merge/dedup: **389,476 bytes**, one default scene named `GrassClumpsLibrary`, exact nodes `GrassClump` and `GrassClumpLOD`, one shared material, and one shared atlas. The scene name is distinct from either template so Three.js name lookup returns the intended node. Decoded position/normal/UV/index arrays are identical to the separate source GLBs. Select either named template rather than adding the overlapping two-node scene directly. Terrain maps plus this single bundle total **4,139,290 bytes**; textures plus the shared atlas have an approximately **29.33 MiB** conservative RGBA+mip footprint. Separate GLBs and their individual manifests are archived in `assets-source/karts/terrain-20261007/grass-runtime-inputs/` and are not shipped. Bundle metadata and hashes are in `grass-clumps-manifest.json`.

See `manifest.json` for every terrain file's dimensions, size, hash, source and color space, and `grass-clumps-manifest.json` for both template bounds and source/derivative hashes. Full original source PNGs, source glTF, provider API records, legal code, individual model manifests, and reproducible build scripts are retained in `assets-source/karts/terrain-20261007/`. Rejected Grass004 is retained only in authoring history.
