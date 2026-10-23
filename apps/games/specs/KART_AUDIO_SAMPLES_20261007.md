# Pocket Karts audio — current pack 3, 2026-10-07

Production uses separate recorded petrol-kart idle and acceleration/load samples. The 22-file local bank totals 1,594,212 bytes. Four persistent loops serve engine idle/load, tire skid and reverse; 19 cue names use 17 unique one-shot files plus a soft-collision variant. Seeker shares the rocket launch sample; Bomb shares the restrained grenade throw, with distinct detonation files.

## Sources

| Use | Author/source | License |
| --- | --- | --- |
| Petrol kart idle/load | Hanbaal, [start](https://freesound.org/people/Hanbaal/sounds/178666/) and [drive](https://freesound.org/people/Hanbaal/sounds/178662/) | CC0 |
| Tire skid | audible-edge (Tom Haigh), loop edit qubodup, [car tire squeal](https://opengameart.org/content/car-tire-squeal-skid-loop) | CC-BY 3.0 loop edit; original recording CC0 |
| Pulse, Scatter, Rail, Grenade | Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney, [Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) | CC0 |
| Rocket launch | dklon, [Rocket Launch Pack](https://opengameart.org/content/rocket-launch-pack) | CC-BY 3.0 |
| EMP | Hansjörg Malthaner (varkalandar), [Tesla effect](https://opengameart.org/content/tesla-coil-powered-death-ray-sound) | CC-BY 3.0 selected alternative |
| Impacts, landings, powers, explosions, UI | Kenney, [Impact Sounds](https://kenney.nl/assets/impact-sounds) and [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | CC0 |

The Hanbaal acquisition uses official HQ MP3 previews; original lossless WAVs require login. Tire and firearm excerpts are recordings. Rocket, EMP, Kenney powers and explosions are produced effects. Grenade throw uses a filtered firearm thud, not an actual grenade-launcher recording. No author endorsement is implied. The old qubodup engine loop was replaced.

Per-file attribution, processing, source/output hashes and original license notices ship in `public/assets/karts/audio/`. Retained acquisition evidence and an editable build script are in `assets-source/karts/audio-recorded-20261007/`.

## Mix and game integration

Idle/load crossfade over 160 ms with modest pitch variation; engine timbre comes from the two recordings. Collision strength selects soft or metal contact and scales gain. Landing has a lower gain. Nearby effects use distance attenuation and stereo panning, with a fallback for browsers without StereoPanner. The voice cap is 16, with master gain 0.8 and gentle compression.

Elevated-map collision and landing cues come from actual Rapier contacts. Contact cooldowns prevent sustained wall contact from repeatedly firing effects. Tire skid requires grounded lateral movement and sufficient speed. The renderer deduplicates authoritative events, drops historical events at first mount and silences continuous engine audio for inactive, hidden, disconnected, KO and menu states. Mute and disposal stop active voices. No engine oscillator or runtime remote audio request is used.

## Verification and limits

- `test/kart-audio.mjs`: 411 runtime lifecycle/mix assertions passed.
- `test/kart-audio-samples.mjs`: 502 format, integrity, attribution and budget assertions passed for 22 files.
- Full `npm test` and `npm run build` passed on Node 24.19. Relevant renderer/world/art checks were rerun after the final visual fixes and passed.
- The real-browser fixture `test/fixtures/kart-audio/` decoded all 22 current WAV files, scheduled all 19 cues and soft collision, refused muted/inactive cues and confirmed native context disposal. This passed with no captured warning/error in that fixture.

The bank audition is `assets-source/karts/audio-recorded-20261007/recorded-kart-audition.wav`, with timestamps in `audition-timeline.json`. Its montage demonstrates the actual samples, not the gameplay mix. Subjective listening, headphones, physical iOS/Android and WAN performance remain unverified. This is a local 0.1.9 candidate; this pass did not deploy it.
