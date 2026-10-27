# Reference packet — 14 October 2026

These are source references and asset candidates, not permission to copy proprietary game content. Statements about how they inspire our game are design inferences. Browser references have been opened/read during planning; no hands-on play of these games is claimed in this packet yet.

| Our game | Reference | Inspect/learn | Deliberate difference |
|---|---|---|---|
| Cloud Links | [Golf Party](https://golfparty.io/) | Browser golf presentation, aim gesture and waiting/score flow; actual play still needed | Our simultaneous independent balls, three original holes and explicit mobile controls |
| Cloud Links | [Golf With Your Friends — publisher](https://store.steampowered.com/app/431240/Golf_With_Your_Friends/) | Playful course silhouettes, obstacle timing and social near misses | Reference for principles, not copying levels/models, and not evidence its desktop technology suits our browser |
| Bomb Garden | [Bombergrounds — official](https://www.bombergrounds.com/) | Bright3D readability, obvious character/bomb silhouettes, blast anticipation | Small browser arena, bounded rounds, original map/rules; no claim this reference itself is a browser implementation |
| Rocket Room | [Spaceteam — developer](https://spaceteam.ca/) | Asymmetric cooperation and communication pressure | One calm teaching module, tangible3D consequences, useful2–6 player role scaling and text/ping alternative |
| Shared3D | [Smash Karts — official](https://smashkarts.io/) | Saturated material palette, protected playfield, camera/HUD/feedback hierarchy | Study the principles without copying its arena/weapon models; new games need their own genre direction |
| Shared browser QA | [Marble Blast Web — developer repository](https://github.com/Vanilagy/MarbleBlast) | Inspect documented fixed-step collision, lazy resource loading, HTML/CSS menus and mobile input; custom renderer does not mean we must rewrite ours | Inspiration for measured timing/load/input work, not an invitation to reuse commercial game's models/audio |

## Concrete asset candidates

- [Kenney Minigolf Kit](https://kenney.nl/assets/minigolf-kit): primary page identifies3D andCC0. Start by selecting course pieces/flags/obstacles, inspect dimensions and materials, and ship only the chosen files.
- [Kenney Platformer Kit](https://kenney.nl/assets/platformer-kit): primary page identifies3D, animation andCC0. Candidate coherent characters/props for Bomb Garden; exact files/rigs remain to be inspected.
- [Kenney Space Kit](https://kenney.nl/assets/space-kit): primary page identifies3D andCC0. Candidate spacecraft/environment props for Rocket Room; repair interfaces need original actionable components.

Model availability, per-file licence/format, quality under our camera/lighting, collision fit and compressed byte costs are still to be validated. No asset is marked production-ready by this reference list.

## Engineering sources

- [Three.js official documentation](https://threejs.org/docs/) for scene, renderer, loading and context lifecycle. Existing pinned renderer stays the starting point.
- [Rapier determinism](https://rapier.rs/docs/user_guides/javascript/determinism/): its guarantees require identical initial state/version/construction order and deterministic inputs. This is not a network protocol, rollback or camera-smoothing solution.
- Local guidance/skills contains the actual game-studio foundations, Three.js, asset, UI and playtest guidance; referenced supporting documents are copied under guidance/references.
