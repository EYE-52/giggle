# Write a game with the flow engine

The CommonJS module is in `apps/games/games/engines/flow/`. It has no third-party
runtime dependencies. Its [type declarations](../../apps/games/games/engines/flow/index.d.ts)
describe the full API. The [research plan](PLAN-FLOW-ENGINE.md) explains the choices
and the later adult-edition adapter. Nothing here requires that edition.

## Start with content

Copy [the runnable party example](examples/party.json), or start with this small
JSON definition. Each card has a stable ID and exactly one `text` (literal) or
`template` (expanded) field. Do not change IDs when fixing a spelling mistake;
bump `version` whenever the definition changes.

```json
{
  "schemaVersion": 1,
  "id": "introductions",
  "version": "1",
  "start": "hello",
  "phases": [
    { "id": "hello", "dwell": [1, 1], "next": [{ "to": "story" }] },
    { "id": "story", "dwell": [1, 1], "prerequisites": ["hello"], "next": [{ "to": "done" }] },
    { "id": "done", "dwell": [1, 1], "terminal": true }
  ],
  "grammar": { "topic": ["a small win", "a favourite meal"] },
  "cards": [
    {
      "id": "hello-one",
      "template": "{actor}, tell us about #topic#.",
      "roles": 1,
      "phases": ["hello"],
      "tags": ["introduction"],
      "effects": [{ "scope": "table", "key": "introduced", "op": "set", "value": true }]
    },
    {
      "id": "story-one",
      "text": "Share a funny story from a trip.",
      "phases": ["story"],
      "tags": ["travel"],
      "when": { "scope": "table", "key": "introduced", "op": "eq", "value": true }
    }
  ]
}
```

Load it on the server:

```js
const { createEngine } = require('./games/engines/flow');
const content = require('./introductions.json');
const flow = createEngine(content, {
  players: [{ id: 'asha', name: 'Asha' }, { id: 'bo', name: 'Bo' }],
  // Omit seed for a fresh random session. Save the snapshot for replay.
  seed: 'a-test-session'
});
const offer = flow.draw();
if (offer.status === 'offered') {
  // Send only display fields to the client. Keep the token on the server.
  // After the game's own action checks accept completion:
  flow.complete(offer.token);
  // Or flow.skip(offer.token) to consume it without applying effects.
}
```

One offer may be pending. Further draws fail until it is completed or skipped.
An old token returns `false`; it cannot apply effects twice. A skipped card stays
used but grants no quality or dwell progress. Effects are atomic: a type error
leaves the world and pending offer intact. A failed template expansion restores
the world, graph and random stream.

`draw()` returns `offered`, `done`, or `dead-end` with a reason. Handle dead ends
explicitly: show a safe authored fallback, ask to change settings, or finish the
game. Do not remove requirements and retry automatically. A terminal phase ends
immediately and does not deal a card. A phase with no outgoing edges is an open
phase, useful for plain decks; the game decides when its rounds end.

## Describe facts and requirements

Qualities are finite numbers, booleans, strings or string arrays. There are five
lookup scopes: `player` (the actor), `partner`, `pair` (unordered), `table`, and
`session`. Player names are separate from qualities. IDs and quality names use
letters, digits, `_` and `-`; prototype keys are forbidden. Names can contain
Unicode and punctuation. Pair keys use a sorted JSON array, avoiding delimiter
collisions. The initial player roster is fixed for this engine instance. Graph progress is
one cursor per engine; pair qualities are scoped, but independent per-pair graph
cursors are future work for the adult adapter.

Use `roles: 0` or omit it for a table card, `1` for a player card, and `2` for an
actor/partner card. The engine considers all valid bindings, or you can constrain
them with `draw({actor, partner})`. Players cannot partner with themselves. A game
that has a separate turn rotation should pass its chosen actor. For group answers,
keep `roles: 0`; the game handles collecting everyone's votes.

A condition is a predicate, `{all: [...]}`, `{any: [...]}`, or `{not: ...}`.
Supported operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `includes` and
`exists`. Missing facts fail comparisons, including `neq`; use `exists: false`
explicitly. `includes` tests a string in a string array. Numeric comparisons do
not coerce strings. No scripts, property paths or external calls run from JSON.

Effects use `set`, numeric `add`, or unique string `append`. An absent counter
starts at zero and an absent list starts empty. Player and pair effects need the
matching role count. Use `setQuality(scope, key, value, binding)` for external game
events between offers. With a pending offer, settle it first. Server code must
validate player actions and permissions before calling the engine.

## Rules, flow and pacing

Rules belong to named groups. Only one matching rule per group is used. More
matched atomic predicates win; an `all` adds specificity, an `any` uses the best
matching branch, and `not` counts as one. Equal specificity uses higher `priority`,
then the first rule declared. A rule without `when` is a zero-specificity fallback.
Rules can cap heat and multiply weights of matching tags. A zero tag weight blocks
that tag under that rule. Fallback rules apply when their more specific rules do
not match; they do not override a matched rule that blocks content.

```json
[
  { "id": "default", "group": "tone", "tagWeights": { "acting": 1 } },
  {
    "id": "quiet-room", "group": "tone",
    "when": { "scope": "table", "key": "quiet", "op": "eq", "value": true },
    "maxHeat": 30, "tagWeights": { "acting": 0.2, "stories": 2 }
  }
]
```

Phase edges have `to`, optional `when` and optional positive `weight`. Each phase
may also have `when` and a list of completed-phase `prerequisites`. Conditions on
phases and edges use the bindings supplied to `draw`; prefer table/session facts
for global phases. A phase samples an inclusive `dwell: [min,max]` on entry. Only
completed offers count. On the next draw after dwell, a legal outgoing edge is
sampled by weight. No legal edge returns `blocked-transition`; it does not skip
prerequisites. Phase prerequisites record that its dwell was completed, not that
it was merely visited. Breathers count toward dwell only if completed.

The director's `curve` contains `[turn,heat]` points, with turns increasing and
heat in 0–100. Linear interpolation gives the target at the number of offers
already shown. A skip still advances the pacing clock but not phase progress.
`maxHeat` is a hard cap. `breatherEvery` requests a breather after that many
non-breather offers. It then requires `breather: true` cards at or below
`breatherHeat`; it never fills that gap with a hotter card. A phase can also set
`breather: true`. Always provide enough eligible breather cards for the session.

Within hard constraints, sampling multiplies authored weight, closeness to target
heat, recent-tag penalties, unseen-tag bonuses and exposure weights. Defaults
are `recencyWindow: 3`, `noveltyBonus: 0.5`, `fairness: 2`, and `heatTolerance: 20`.
With fairness enabled, the engine first keeps the least-exposed eligible bindings
for each role count. Pair history further reduces the weight of often-used pairs.
This balances opportunities, not player scores. Unequal eligibility can limit
fairness; the engine never breaks prerequisites to compensate.

`repeat: "never"` is the default: each card ID and normalized rendered line can
appear only once in the session. Text normalization uses NFKC, lower case and
collapsed spaces. With `repeat: "cycle"`, eligible content can restart after it is
exhausted. Prefer a different adjacent card/line whenever one is eligible. A
one-card legacy pack may necessarily repeat. `tagsAll`, `tagsAny` and `excludeIds`
are additional hard filters on a draw.

## Templates and safety

`text` stays literal, including braces and hashes. Only `template` is parsed.
Grammar symbols use `#symbol#`, slots use `{actor}` and `{partner}`. Declare extra
slot names in top-level `slots` and pass their literal values in `draw({slots})`.
Slots are never parsed again as grammar. Known modifiers are `.upper`, `.lower`
and `.capitalize`, for example `#topic.capitalize#`.

Lint checks every grammar alternative. Unknown symbols/slots/modifiers, cycles,
malformed tokens and excessive depth fail. Expansion has a 12-level depth bound,
256-node work budget, 200-character slot limit and 4096-character output limit.
Grammar validation also has a work budget. There are no actions, dynamic key
assignment, expressions or arbitrary JavaScript. Output is plain text; render it
with `textContent` or the existing escaping helper, never raw HTML.

## Validation and simulation

`validateDefinition(content, validators)` returns error strings. `createEngine`
runs it before play. A plugin receives the whole definition and returns strings:

```js
const validators = [content => content.cards
  .filter(card => !card.tags?.length)
  .map(card => `${card.id}: add a topic tag`)];
```

Throwing plugins fail closed. Structural lint catches bad graph references and
unreachable phases, but cannot prove arbitrary conditional paths are satisfiable.
Use simulation and game-specific validators for semantic rules. For example, a
card that removes an object should require that object to exist first.

From `apps/games`:

```sh
npm run test:flow
npm run simulate:flow -- --content ../../docs/engine/examples/party.json --sessions 500 --turns 60 --players 6 --seed stress --skip-rate 0.1
```

The CLI prints JSON; exit code 0 means no observed dead ends, 2 means dead ends,
and 1 means invalid arguments/content. `turnLimited` is reported separately from
terminal completions. Sessions are capped at 5000, turns at 1000, players at 20.
The same arguments give the same report. Simulation calls complete or skip with
a separate seeded feedback stream; it does not emulate a game's vote transport.
Content with custom slots or external quality changes needs its own harness.

- Heat error is mean absolute difference between offered heat and target, in 0–100 units.
- Ordered paths contain each phase/card ID. Phase paths collapse consecutive repeated phases.
- Jaccard similarity compares sets of card IDs: intersection divided by union.
- Position similarity is matching card IDs at the same turn divided by the longer session.
- Pairwise similarity uses all pairs among the first 200 sessions, to bound runtime.
- Coverage counts offered cards and nonterminal phases. Repeats count repeated IDs within sessions.
- Exposure spread is maximum minus minimum per session, including zero-exposure players/pairs.
- A table-only game has zero targeted exposure; that metric does not measure votes or scores.

The [checked-in report](examples/simulation-report.json) covers 500 sessions with
six players and a 10% skip chance. It observed 500 completions, zero dead ends,
zero repeated IDs, both phase paths and a maximum player exposure spread of one.
This proves those seeds and this content, not every possible authoring choice.

## Normal games and replay

Truth or Dare and Never Have I Ever use `card-game.js` and `normal-flow.json`.
The adapter compiles existing locale/custom-pack string arrays into cards and
keeps deck/kind as hard tags. Strings are deduplicated by normalized text. Legacy
IDs use array position; use explicit IDs in newly authored content.

These are instant prompt decks: dealing marks a prompt consumed and completed.
Room-pool options count as shown even if not chosen. The adapter rejects activity
effects so an unchosen option cannot unlock later actions. Use the full
`draw`/`complete` API when effects depend on completing an activity. If a normal
prompt deck has no legal card, each game retains its existing safe fallback.
No heat labels are inferred from existing prose, and game timers, scores, target
rotation, custom writing and private votes remain in the game server.

A game context can supply `flowSeed` for repeatable prompt dealing in tests. The
game's other randomness (spinner, mixed mode, vote ties) stays separate. The
engine itself uses one seeded stream for dwell, edges, bindings, weights and
phrasing. A fresh production session seed uses Node crypto; the xorshift32 stream
is for replay and variety, not security.

Save `flow.snapshot()` only in trusted server storage. It includes the seed, RNG
state, full content signature, qualities, history, graph progress and pending
offer. Restore using `createEngine(content, {snapshot})`. Different content or
versions are rejected. It is not a client save protocol or a security boundary.
Never include snapshots, engine objects, world state or seeds in player views.
