# Giggle flow engine plan

Research date: 2026-11-10. Work branch: `claude/flow-engine`, based on local main
`3de46bf6`. Local work only; no push or deployment. This plan was written before
implementation. Implementation and validation results are recorded at the end.

## What to reuse and what to build

| Approach and primary source | Useful idea | Giggle decision |
| --- | --- | --- |
| [Failbetter quality-based storylets](https://www.failbettergames.com/news/echo-bazaar-narrative-structures-part-two), [timing qualities](https://www.failbettergames.com/news/new-narrative-structures) | Small content units unlock from state and change qualities; a timing quality can connect them. | Reuse the model: JSON cards with conditions, effects, tags, and stable IDs. Build a small interpreter, with no scripts inside content. |
| [Elan Ruskin, GDC 2012: fuzzy pattern matching](https://www.gdcvault.com/play/1015946/AI-driven-Dynamic-Dialog-through) | Match world facts; cascade from special situations to general ones. | Use most-specific matching rules within a named group; randomize equal matches. Keep hard requirements separate from scores so randomness cannot bypass prerequisites. |
| [Mike Booth: Left 4 Dead AI systems](https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf) | A director shapes intensity through build-up, peak, and recovery. | Use a configurable turn-based heat curve plus mandatory breather intervals. Heat is a preference, with an explicit hard maximum. No claim to infer human emotion from votes. |
| [Mark and Dill: utility theory, GDC 2010](https://media.gdcvault.com/gdc10/slides/MarkDill_ImprovingAIUtilityTheory.pdf) | Score several considerations rather than one brittle branch. | Multiply positive authored weight by heat fit, tag recency, novelty, and player/pair fairness; sample proportionally, never just pick the maximum. |
| [Behavior3JS](https://github.com/behavior3/behavior3js) | Sequences, selectors, conditions, and persistent blackboards. | Do not add a tick loop or behavior-tree runtime for turn-based card selection. Explicit graph edges and conditions are easier to inspect here. |
| [Ink](https://github.com/inkle/ink), [Yarn Spinner](https://github.com/YarnSpinnerTool/YarnSpinner) | Strong tools for authored dialogue and branching stories. | Keep as possible future authoring tools. Their narrative/compiler model does not supply multiplayer fairness, pacing, or deck uniqueness. Do not embed either now. |
| [json-rules-engine](https://github.com/CacheControl/json-rules-engine), [Drools](https://docs.drools.org/latest/drools-docs/drools/rule-engine/index.html) | Declarative conditions, fact lookup, rule priorities. | Build a synchronous, bounded predicate subset. No asynchronous fact providers, forward chaining, RETE network, or arbitrary JavaScript. Specificity is explicit matched atomic facts, with declaration order only as a reproducible final tie-break for rule resolution. |
| [Tracery](https://github.com/galaxykate/tracery) | Grammar symbols produce many phrasings from small banks. | Build a deliberately smaller grammar: `#symbol#`, `{slot}`, and explicit safe modifiers. Reject unknown symbols, cycles, unknown slots, excess depth/length, and unsafe grammar keys. Plain text output; UI must still escape it. |
| [seedrandom](https://github.com/davidbau/seedrandom), [pure-rand](https://github.com/dubzzz/pure-rand) | Deterministic PRNG streams and reproducible bugs. | Zero runtime dependencies: implement the standard [xorshift32 recurrence](https://www.jstatsoft.org/article/view/v008i14) with hashed string seeds and explicit snapshot state. This is variety/replay, not security. Use Node crypto once for an unspecified session seed. |

These are design choices based on the sources, not claims that the systems are
interchangeable. In particular, specificity resolves contextual rules; weights
still choose between eligible cards. A low-specificity fallback never overrides
a failed hard condition. Semantic correctness still needs authored requirements
and game-specific lint rules; the engine cannot understand arbitrary prose.

## npm audit

Checked the npm registry directly on 2026-11-10 (`dist-tags.latest`, that version's
publication time, license, dependencies and unpacked size). Publication recency
is evidence, not proof of ongoing maintenance. Sizes below are unpacked package
sizes, not bundle measurements.

| Package | Latest / published | License | Direct runtime deps | Unpacked bytes | Decision |
| --- | --- | --- | --- | --- | --- |
| pure-rand | 8.4.2 / 2026-07-10 | MIT | 0 | 64,122 | Best maintained small MIT candidate if we later need more RNG algorithms. |
| seedrandom | 3.0.5 / 2019-09-17 | MIT | 0 | 374,034 | Stable but old release; no need for its full algorithm set here. |
| @thi.ng/random | 4.1.54 / 2026-08-25 | Apache-2.0 | 2 | 62,487 | Recent, but outside the requested MIT preference. |
| json-rules-engine | 7.3.1 / 2025-02-20 | ISC | 4 | 100,901 | More machinery and dependency surface than required. It is ISC, not MIT. |
| tracery-grammar | 2.8.4 / 2024-11-18 | ISC | 0 | 29,226 | Small, but broader grammar semantics and ISC license. |
| inkjs | 2.4.0 / 2026-02-17 | MIT | 0 | 6,874,026 | Active release, much larger and solves a different authoring problem. |
| yarn-bound | 0.5.5 / 2024-11-29 | ISC | 1 | 330,508 | JavaScript Yarn option; unnecessary interpreter layer. |
| behavior3js | 0.2.2 / 2017-06-27 | MIT | 0 | not supplied | Old release; avoid adopting its runtime for this task. |

Registry sources: `https://registry.npmjs.org/<package>` (encode the scoped name
as needed). No package code is copied. No new dependency is planned.

## Module and state contract

Use `apps/games/games/engines/flow/`, next to the existing CommonJS server engines.
Games already load server modules directly, so a workspace package would add
resolution/build work without helping either edition. Keep Node built-ins out of
the selection core; only session seed creation uses Node crypto.

- JSON definitions contain cards, grammar, rules, phases and director settings.
- Provide TypeScript declarations for player, pair, table and session qualities
  (finite numbers, booleans, strings, or string arrays), conditions, effects and
  engine APIs. Runtime validation enforces the same boundaries.
- Use explicit actor/partner bindings. Pair keys are unordered and collision safe.
  Missing players/pairs/qualities never silently satisfy a numeric prerequisite.
- Select/reserve a card without applying its effects. `complete` commits effects
  and dwell progress exactly once; `skip` consumes the card but does not grant its
  prerequisites. One outstanding offer per engine prevents stale completion.
- Conditions support all/any/not and finite comparisons. Only whitelisted own
  quality keys can be read or written; no eval or prototype traversal.
- Phase edges have conditions and prerequisites. Sample a dwell in an inclusive
  min/max range at entry. Move only after completion, never from offered/skipped
  cards. A phase with no legal exit holds safely and reports a blocked result.
- Required breathers cannot fall back to hotter content. An explicit dead end is
  better than relaxing prerequisites. Terminal phases return a completed result.
- Strict no repeats is the default. Optional deck cycling supports existing games
  that historically reshuffle when exhausted; even then avoid adjacent duplicates
  when another eligible card exists. Track normalized text as well as IDs.
- Snapshot RNG, pending offer, qualities, graph progress and history together.
  Replays require the same content version, seed, roster and actions.
- Expose pluggable content validators. Simulation reports dead ends, terminal
  completions, heat error, unique content/paths, pairwise session similarity,
  player exposure spread and graph coverage. Report metric definitions.

## Normal edition adoption

Migrate Truth or Dare and Never Have I Ever. Compile existing locale string arrays
into card data at the boundary; keep strings and custom packs compatible. Permit
richer JSON storylets with metadata for future packs. Use JSON flow declarations
for the shared dealer. Normal content has no invented heat labels: it defaults to
neutral heat, and selected Truth/Dare deck and kind remain hard filters.

Keep existing game action phases, deadlines, scores, room-pool sizes, private
ballots, custom writing, player departure handling and projections. The engine
owns dealing, uniqueness, deterministic selection, and content rules, not game
transport. An adapter completes a plain prompt when dealt, matching the old
instant dealer. Future activity games should complete on an explicit result.
Keep engine state out of player views. Existing `Math.random` vote tie behavior
remains compatible; the engine's stream is per session and separate.

## Adult adapter plan (later, not this branch)

Read `claude/adult-preview:apps/games/adult/games/_progression.js`,
`_night-memory.js` and `_deck.js` with `git show`. That branch is not edited.
The current implementation includes a per-pair opening route, sampled dwell,
completed prerequisites, per-player clothing state, pass backoff, a shared night
RNG, normalized-line/family history and reversible reservations.

The first implementation has one graph cursor per engine. The adult edition
needs independent per-pair cursors with shared night state and RNG. Add scoped
graph cursors before replacing its graph; the normal migration does not claim
that feature is already implemented.

1. Map players and pairs to scoped qualities, keeping IDs private. Map clothing
   counts and exposed-area facts to explicit qualities. Preserve every existing
   preference/profile/participant filter as a hard adapter validator.
2. Export opening nodes and later stages as graph data. Translate prior-node,
   worn-layer and exposed-area requirements to predicates. Keep one-item removal
   and finale rules as adult-specific lint plugins, not generic engine code.
3. Map heat ceiling/floor, recent families, openings and form counts to director
   configuration/history. Import the existing seed at night start and retain one
   engine across game changes; do not reseed each deck.
4. Replace `graph.reserve`/rollback with engine offer/complete/skip. Preserve the
   current two-step behavior during the transition: an offered activity must not
   count as completed, and a Pass must not apply a removal effect. Keep feedback,
   missions, ongoing rules and physical hold windows in the adapter until their
   schemas are independently mapped and tested.
5. Keep bridge/opening card generation in the content compiler first. Preserve
   stable references, normalized text dedupe and participant identity. Never relax
   permissions just to avoid a dead end. Snapshot is server-only.
6. Run adult tests, lint and a seeded comparison harness before switching. Check
   pass/reentry, no clothing, layered clothing, unavailable toys, changing players,
   caps, pending rollback, finales, game changes and text/family repeats. Retain
   the old implementation until parity and real play checks pass.

## Acceptance and validation

Unit tests cover rule specificity/fallbacks, scoped typed state, prerequisites,
completion versus skip, dwell bounds, breathers, RNG replay, weighted variety,
recency, no repeats, player/pair fairness, bounded grammar, malformed content,
plugin failures and snapshots. Adapter tests cover real game lifecycles, custom
packs, small decks, privacy and existing round behavior. Run simulator across many
seeds with numeric assertions and a checked-in example report. Run the full
`npm test` in `apps/games`. If it builds pages, commit generated game HTML; remove
`public/release.json` if created and restore the kart launch transport artifact.
Commit with `Co-Authored-By: Codex <noreply@openai.com>`. No push or deployment.


## Implementation and validation results

Implemented locally on `claude/flow-engine`; main implementation commit
`e1923cb2`. The engine lives in `apps/games/games/engines/flow/` with no new runtime
dependencies. It includes the typed API, runtime lint, scoped qualities,
completion-only effects, rule groups, phase graph, dwell, breathers, weighted
sampling, player/pair exposure, literal-safe templates, private snapshots and a
simulator CLI. See [the author guide](README.md) and
[the runnable content example](examples/party.json).

Truth or Dare and Never Have I Ever now use the engine for prompt dealing. Their
existing action phases, timers, votes, scores, custom writing and public views
remain in their game servers. Instant prompt adapters reject activity effects;
unchosen pool options cannot grant prerequisites. The adult branch was only read,
not edited. Its independent per-pair graph cursors remain later adapter work.

Validation completed on Node `v24.21.0`:

- `npm test` in `apps/games`: passed, exit 0. This includes the existing server,
  transport, renderer and browser checks. The final container sweep checked all
  72 games with 1,224 measurements and zero failures; telemetry browser checks
  also passed.
- `npm run test:flow`: 24 test groups passed. Tests cover seeds/replay, scoped
  conditions/effects, graph/dwell/prerequisites, skip behavior, breathers,
  weighted selection, novelty/recency, player/pair assignments, content/grammar
  safety, atomic failure, private state, real game matches and CLI exit codes.
- `npm run build`: passed, generated 72 game pages. No tracked generated HTML
  changed.
- Public declarations and a typed caller were checked with TypeScript 6.0.3
  using strict/no-emit checking, including expected invalid-quality/card/effect
  cases. Passed; TypeScript was used through npm exec, not added as a dependency.
- Simulator: 500 sessions, six players, up to 60 turns, seed `stress`, skip chance
  0.1. All 500 completed; zero dead ends or repeated card IDs; 500 distinct
  ordered paths, both phase branches, all 38 cards reached, maximum player
  exposure spread 1. Full metrics are in
  [simulation-report.json](examples/simulation-report.json).

The initial full run found a deadline fixture that assumed global `Math.random`
controlled every source of randomness. The two comparison rooms now receive the
same explicit `flowSeed`. All assertions remain: 32 expired windows still match
clock-driven timeout results and award points exactly once. The fresh full run
then passed.

The generated `artifacts/kart-arenas/launch-transport.json` was restored and
`apps/games/public/release.json` is absent. No push or deployment was performed.
