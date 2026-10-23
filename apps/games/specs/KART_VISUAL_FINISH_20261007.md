# Pocket Karts visual finish

Root-approved direction: a vivid outdoor arcade combat game, with asphalt, enamel, rubber and machined metal. Preserve the accepted simulation, collisions, speeds, networking, maps and input ownership. This pass changes presentation only.

## Elevated Alpine stylized world — 7 October

The user rejected the photographic material/vegetation stage. The target is a beautiful stylized browser combat game: expressive authored shapes, clean painted surfaces, vivid natural color and soft light. Photographic detail, desaturated stone, scanned foliage and a realistic simulation aesthetic are not the art target. Retain the asset-loading, transform, ownership and context-recovery fixes from that stage; its functional tests do not approve its appearance.

Build Alpine Courtyard first using a coherent Quaternius Stylized Nature MegaKit / Medieval Village MegaKit family, inspected from the actual driving camera. Match the existing orange kart and blue mystery pickups to this world. Use modelled silhouette, bevel, roof curve and material grouping to carry quality. No photographic surfaces hidden behind saturation filters, primitive placeholder buildings, flat mountain screenshots or fake foliage substitutes.

- Palette: sky blue #55b8f5, meadow #69b544, deep foliage #27835e, warm stone #c5c5b5, slate #788ca5 and roof coral #c95c44. Sunlit surfaces remain colorful; shaded surfaces use cool fill and retain readable volume. Avoid beige washes and olive grey ground.
- Ground: broad clean routes with a restrained surface pattern; green meadow margins have authored tufts and flowers. Grass texture cannot overwhelm the silhouette of pickups or mines. The exact legal floor, ramps, sockets and spawns stay unchanged.
- Vegetation: rounded layered crowns, authored trunks/branches and expressive rock shapes from the same kit. Repeated plants are instanced, with deliberate clusters and gaps. Trees sit outside the legal drive field; soft plants stay clear of controls, spawns, pickups and visibility.
- Architecture: a small curated village of real shaped modules, terracotta roofs, timber accents, arched openings and clear landmarks. Compose finished cottages outside the collision field before tackling the collision-aligned fountain/deck. A building must look finished in the game camera, not just have a high polygon count.
- Horizon: rounded foothills and a few distinct stylized peaks; no uniform ring of jagged triangle walls. Distance layers use atmosphere, silhouette and scale. Sky/clouds and the authoritative sunset cycle support the scene without flattening it.
- Light: soft warm key, cool fill, readable contact shadows and restrained satin highlights. No global wash-out or full-screen color filter. Review daylight, sunset and night from the same gameplay camera.

Each stage ends with native rendered evidence and source/asset hashes. Imported kits retain provenance and licensing records. Review geometry, GPU ownership, failure/Retry behavior and desktop/phone layouts alongside the art. Keep the full-world candidate on hold until gameplay and art meet the intended standard. Internal review controls stay separate from the player interface.

## Legacy arena direction — separate from the elevated Alpine world

- Garden uses graphite asphalt, vivid grass, red/white kerbs, emerald near hills and blue distant mountains. No mint road or beige arena.
- Daylight has a cobalt-to-clear-blue sky, warm directional highlights and neutral soft fill. Lower broad environment fill so rubber/metal and shaded facets retain contrast. Do not add a full-screen saturation filter or postprocessing dependency.
- Existing authoritative day-to-sunset cycle remains. Sunset uses peach horizon and violet zenith; night remains readable. Preserve five-map identities and the measured collision-aligned perimeter.

## HUD and touch controls (implementation agent owns)

- Base graphite #111a29; secondary #25334a; text #f5f8ff; yellow #ffcb24; fire coral #ff3f61; nitro cyan #22d7ef. Panels should be nearly opaque, with a narrow material edge, not pale translucent balloons.
- Clock centered at top, 32–36px high. Room launcher remains usable at upper left. Folded standings shows rank and own short name plus score, no long sentence. Empty item indicator is an icon; no permanent "Find a pickup" sentence.
- Bottom left: 94–104px dark recessed stick with 40–44px thumb, subtle directional marks, no DRIVE caption. Above it a compact speed/charge instrument. Help is a 44px target, preferably integrated with the upper corner or instrument without a giant panel.
- Bottom right: largest 64–68px fire button showing the equipped weapon SVG and remaining ammo. Idle crosshair icon when empty. Nitro is a 48–52px bottle/lightning button with charge arc; drift is a 48–52px tyre/skid icon. Small brake/reverse and accelerator 44px buttons stay available; they use pedal/arrow symbols with aria labels. Arrange these around the fire thumb rather than in a tall 3×2 box. Keep all hit targets >=44px, no stick/action/instrument overlap at 320,390 portrait and 568×320/844×390 landscape.
- Hold and release feedback is immediate: narrow luminous edge and 1–2px press; no constant bouncing. Keep automatic input choice based on capability/preference, keyboard always supported. No hidden held-contact regressions on menus, blur or disposal.
- Remove persistent NITRO/DRIFT/ITEM text from buttons; retain accessible labels, short first-use tutorial and help. No always-on press-space banner.
- Scoped CSS must have one clear touch layout, not an accumulation of override patches. Preserve safe areas, result/garage and spectator controls.

## Weapon assets and projectiles (root reviews and selects)

The current primitive-built combat library is rejected as final artwork. Its black box receivers, rod-like shots and repeated cone mine teeth are diagnostic geometry, not an accepted style. Preserve the functioning mount, projectile, authority and ownership contracts while replacing visible models one at a time. Passing geometry tests never counts as visual acceptance.

First compare a single sourced, authored mounted blaster against the current weapon in the actual Alpine world. Review its complete shape, materials, scale and muzzle alignment from close and driving cameras, then in moving gameplay. The downloaded Kenney Blaster Kit 2.1 is a CC0 comparison candidate only; its GLBs and exact license/provenance are retained under `assets-source/karts/weapon-candidates-20261007/`. The pack's foam ammunition is not a ballistic projectile replacement. A successful source preview does not approve the asset, the remaining weapons or the whole game. No new map, simulation or UI redesign is needed to perform this comparison.

- Author real silhouettes: machine gun with black steel barrel/brass ammunition; triple-barrel scatter gun with three distinct bores; finned rocket/launcher; toothed metal mine with recessed red status lamp; coil railgun; handled fragmentation grenade. No spherical bullets or flame-shaped scatter shots.
- Pulse/scatter projectiles are solid pointed metallic slugs, narrow straight white/amber tracer behind. Tail must not dominate the silhouette or bloom into a fireball. Rocket alone has exhaust flame and smoke; mine has no radius ring. Use original Blender pipeline, shared meshes/materials and bounded draw calls.
- Inspect actual chase-camera moving shots and close-up assets under the game lighting, not green diagnostic asset sheets or isolated thumbnails. Maintain tested +Z muzzle/origin contracts, fallbacks, disposal, budgets and shot speed. Preserve authored bevels, normals, UVs and material variation; normalize the source in the asset pipeline instead of masking a bad shape with effects.

## Acceptance

1. Compare native screenshots at identical Garden spawn on 390×844 and 1280×720, plus five maps at chase view.
2. Native hold/release controls, fire pulse/scatter/rocket/mine and view explosions/respawn. Verify no HTML text overwrites weapon button icons.
3. Geometry, input preference, simultaneous-contact, weapon/art and release tests pass. Label emulated viewport checks honestly; no physical-phone claim.
4. Root reviews screenshots and gameplay evidence before freeze/deploy. Muse may implement explicit instructions and run actual configured browser tools; root owns all design decisions.
