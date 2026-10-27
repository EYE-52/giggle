# Games that use the call as gameplay

## Product direction

Video should carry information needed to win: a pose, a prop, an expression, or a gesture. Avoid making every game a video game. Boards, drawings and racing keep their own UI and can use a compact/floating call; camera games get the larger call stage with game controls beside it. The same call and account continue into games, with no invitation to a second media room.

| Game | What friends see and do | Stage | Status |
| --- | --- | --- | --- |
| Pose Party | A rotating performer interprets a public prompt; peers confirm the performance | Actor spotlight | Implemented |
| Show & Go | Find and show a safe everyday object; claim ready, then peers confirm each candidate | Gallery | Implemented |
| Charades | Watch gestures and type guesses; actor alone sees the word | Actor spotlight | Existing game integrated |
| Mirror Match | A leader invents a pose; everyone copies, peers vote for the closest mirror | Spotlight then gallery | Next candidate |
| Freeze Frame | Hold the prompted expression while friends try to distract you; humans judge who stayed still | Gallery | Next candidate |
| Mime Memory | Repeat a growing sequence of gestures, then add your own; peers confirm the sequence | Rotating spotlight | Next candidate |

## Shared framework

Separate authoritative gameplay (rounds, deadlines, roles, ballots, scores) from camera layout (gallery/spotlight) and the actual call (Giggle RTC owner). A game supplies public camera intent and private player views. The framework maps verified identities and lays out existing tiles; each game still chooses its own controls and renderer. 2D/3D games can use the same bridge without adopting these camera controls.

Ship peer judging first: no camera analysis, recordings, hidden capture or model bill. Treat Ready as the participant's deliberate claim, preserve the first claim/ballot, freeze candidates at the deadline and require a strict majority. Camera-off players can still watch/judge or use another call; never turn their camera on automatically. Larger media, clear names, full prompts in the controls, 44px actions and bounded logs matter more than decoration.

## Castle idea

Castle Clash is already a playable first version: two teams of2–4 share a build budget, place walls/towers/cannons/keeps, then siege the opposing fort. Points unlock weapons in later rounds. Its reusable build-battle engine owns those rules. Keep that game board/arena-led with an optional floating call; develop richer castle visuals and strategic pieces after the core placement, damage, shared resources and synchronization are proven. A full3D castle arena is a separate evolution from the shipped grid version.
