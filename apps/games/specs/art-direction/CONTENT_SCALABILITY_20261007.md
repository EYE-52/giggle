# Scalable game content and art

Status: approved implementation direction; the gallery remains a set of visual targets. Individual playable builds still require independent review.

## The contract

The game must remain attractive and fully playable with an unseen custom prompt, no content illustration, the maximum supported room size and a long player name. Artwork must never determine the rules, answer count, player count or layout.

Use three separate kinds of visual content:

1. **Reusable world and materials.** A book, theatre, desk, station, poolside scene or door frame belongs to the game and works across all rounds. Keep its composition open for real text and controls.
2. **Live game objects.** Doors, ballots, train, board, tray, notebook, counters, labels and interaction states are scalable DOM/SVG/canvas/WebGL elements. Their geometry and layout respond to content and viewport. Image generation does not supply their text or hit targets.
3. **Optional authored illustrations.** A curated content pack may explicitly associate an approved local asset ID with public content. Missing, failed or unavailable art uses the same polished unillustrated object. Do not generate images during a timed round, derive art from hidden answers, guess a picture from arbitrary text, or require every prompt to have an illustration.

Illustrations are prepared before publication, reviewed for semantic accuracy, compressed, versioned and served with the pack. The future optional illustration field must resolve through an approved asset manifest; arbitrary URLs and raw HTML are not a runtime image contract. Keep the existing text content schemas unchanged until a particular game actually uses this optional field.

## Decisions by game

| Game | Reusable/live construction | Variable-content behavior |
|---|---|---|
| Would You Rather | Two sculpted live door frames with equal visual weight, changing text and selection/reveal animation | Two alternatives per round remain the actual rule. Fly/teleport pictures are examples. Default to rich unillustrated doors; exact authored pack art is optional. Custom text never triggers generation. More rounds/prompts require no new scenery. |
| Doodle Guess | Shared live canvas, reusable easel and compact tools | Maximize canvas width. Offer reversible Focus canvas, useful landscape composition and a later separately verified Zoom/Pan mode. Preserve the shared 880×520 coordinate space and stroke privacy/nonce contract. Keep Exit, the current word/mask and clock reachable; compact tools/roster rather than reducing touch targets. |
| Truth or Dare / Never Have I Ever / Hot Takes | Reusable stage or hangout, live prompt props and actions | Any validated custom text fits. Do not reproduce invented image mechanics, such as five-finger lives in the Never Ever concept. |
| Most Likely To | Reusable award stage and live nominee portraits/name plaques | Stable vector mascots or actual permitted avatars; no per-player generation. Full names and all legal nominees remain reachable up to 20 players. Self-vote restrictions and private ballots remain authoritative. |
| Rank It / Two Truths / Punchline | Live statements, ordered items or answer ballot in each game's material language | Grow by actual option/player count. Long content wraps at readable sizes; a compact, visible scrolling list is allowed when needed. Never shrink 20 answers into tiny badges or hard-code three displayed people. |
| Bluff | Reusable mystery/case scene, equal live answer props | No semantic illustrations per answer: they could reveal or privilege the true answer. Arbitrary player-written bluffs and the real answer receive identical styling until the authoritative reveal. |
| Story Builder | Reusable book/desk, live seed and accumulated pages | Stories are unbounded player content. They do not need an image per sentence or stored story. Optional generic chapter ambience must not misrepresent the story. Preserve editable input and the whole readable narrative as it grows. |
| Emoji Story | Live emoji/text narrative in a reusable playful scene | Emoji and text are content; no raster screenshot of a story. Keep long chains and full author names readable. |
| Trivia | Live question, choices and progress in a reusable bridge/world | Text-only questions remain first-class. Explicit question media can be optional later; no answer-related art fetched before reveal. |
| Scattergories | Live letter and five real category inputs on a notebook | Category icons are optional curated local vectors with a neutral labeled fallback. Custom categories require no generated images and do not change the number of actual input fields. |
| Word Chain | Reusable station, live word signs, SVG locomotive and route/history | Move the train once on an accepted new link, keyed by instance and accepted history—not on every snapshot, rejection or timeout. Reduced motion arrives immediately. Association words remain arbitrary real text; no animation delays turn input. Full older history is reachable. |
| Countdown Word / Lyric Fill / Five Second Rule | Live tiles, lyric gap or question against game-specific scenery | Scenery never contains the answer, word, artist, letters or countdown. Content and interactive objects remain real and scalable. |
| Charades | Reusable theatre; the existing Giggle Meet actor stream is the live stage | Feature the current actor, keep others in an optional filmstrip, preserve a private actor-only word. Reuse the current call and account; do not reconnect everyone to a separate call. Gracefully explain unavailable video and allow play on an external call. Verify real call switching separately from local metadata tests. |
| 20 Questions | Live active question, response controls, guess composer and notebook history | Full-width phone question and composer, quiet header, collapsed optional hints/standings, latest-first readable history and Yes/No/Sometimes filters. Do not squeeze history into a narrow desktop side column on phones. Respect 10–50 configured questions and 40-character custom secret words. |
| Memory Tray | Reusable tray and separately placed live object assets | Default eight-item tray draws from a reviewed matching set of vector/3D/transparent sprites. Custom items without art use attractive labeled keepsake tags, already supported by the text rules; do not substitute a misleading object. Conceal all item text and objects during recall. An optional visual-only pack must validate complete asset coverage before a match, and is not the default custom mode. |
| Pick One | Two live paddles/choices in reusable scenery | Default to text, with optional exact authored art only when both alternatives have equal treatment. Missing art is a normal polished state. |
| Rapid Polls | Live 2–4 answer controls and bars/results | Player-authored polls need no images. Option count is determined by the actual poll; grow controls/bars from data and keep labels legible. Counts and private vote projection follow the current authority. |
| Dare Roulette and other social games | Live spinner, participant names, prompt and outcome | Decorative stage does not limit participants or prompts; stable local avatars, visible full-name lists and authoritative turns. |
| Board and 3D games | Live boards, pieces, maps, physics and HUD; reusable model/material libraries | Concept screenshots cannot substitute for real geometry, valid moves, object interactions, camera control or game animation. |

## Content and layout acceptance

For each game, test a normal pack and an unseen custom pack. Include missing art, failed image load, maximum players, maximum validated text lengths, wide and narrow laptops, 390×844 portrait and 568×320 landscape. Touch capability and keyboard availability determine input affordances independently of width.

The primary action stays visible and at least 44×44 CSS pixels; content is not clipped or reduced to tiny type to satisfy an attractive screenshot. Small rooms can show a quiet roster; large rooms use a discoverable full-name list with stable player identity. All ballots and results must still represent every player and legal option.

For drawing focus/zoom, test the same canvas node and stroke endpoints before/after toggling, pointer cancellation, orientation changes, Escape/Exit, spectator permissions, round change and disposal. Zoom or panning must never create an accidental drawing gesture. A browser viewport check is not a physical-phone test.

For animated scenery, test repeated state delivery, reconnect, corrections, rejected input and reduced motion. Animation conveys a real accepted action and never supplies an invented rule or advances the authority clock.

For Charades, local tests can prove the actor metadata and private projection. They cannot establish a working live camera call. Review the actual Giggle parent integration with actor switching, call participants leaving/rejoining, video off, camera permission failure and return to the call before claiming end-to-end video support.

Root reviews actual gameplay screenshots for coherent light/materials, sharp text, tactile feedback and natural composition. Regenerate any backdrop that restricts these layouts. A successful load, no overflow or an impressive concept image does not establish visual approval.

## Implementation order

1. Apply this content contract to the active word, drawing and board revamps.
2. Rebuild Would You Rather, Never Ever and Most Likely To using blank reusable scenery and live props; prove arbitrary prompts and 20-player density.
3. Add and verify Doodle canvas focus and the wider phone reading/composer layout for 20 Questions.
4. Review the remaining social games with their maximum data counts, then replace their presentation individually without changing private projections.
5. Upgrade the reviewed Memory Tray object pool and verify the custom-item fallback.
6. Verify Charades against the real existing Giggle Meet call. Release only independently checked playable builds; retain concept/runtime status separately.

## Practical generation gate — 7 October

If a generated target cannot be built into the actual game, replace it with a practical asset brief and regenerate it. This requirement applies across the catalog. Do not lower gameplay quality to fit an attractive image.

Before generation specify the asset's exact role, supported aspect ratios, open content region, transparency or tileability, physical/model scale where applicable, repeated reuse, palette and image-load fallback. An interface image may not bake in variable words, scores, player names, die values, board state, health, timers, card counts or input hit targets. A world concept must map to actual runtime geometry, reusable materials, camera and legal gameplay surfaces.

Review the result inside the real game at desktop and phone sizes, with long custom text and maximum supported participants. Reject: decorated fake controls, fixed participant portraits, content-specific answers disguised as neutral scenery, ambiguous transparent edges, seams on tiling surfaces, distorted perspective that prevents reusable construction, and imagery that only works at one camera crop. Regenerate from the failed constraint; keep the rejected image out of runtime manifests.

For 3D the current target is beautiful stylized authored shapes and painted surfaces, not photographic realism. A source kit or generated concept is not visual approval. Imported assets must work together under the actual camera and lighting and retain clear gameplay silhouettes.
