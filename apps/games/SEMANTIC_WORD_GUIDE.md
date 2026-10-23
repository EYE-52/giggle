# Warm Words

Warm Words is a 2–20 player race to discover the same secret everyday English word. Each guess receives a server-calculated cosine similarity and rank among 1,507 supported vocabulary words. Rank 1 is the exact answer. Guessing a related word helps everyone, but only the exact target ends the round. Three 90-second rounds are the defaults; hosts can choose 1–10 rounds and 30–300 seconds per round.

The first correct guess earns `round(100 + 200 × fraction_of_time_remaining) − 50 × hints_used`, with a minimum of 25 points. Hints are off by default. When enabled, any player may request up to two room hints: the closest unshown word in the actual vector ranking, excluding the target. The button discloses the 50-point reduction before use. A hint costs the eventual solver's round prize, so discuss it with the room.

## Genuine model data

The checked-in numeric vectors come from **Xenova/all-MiniLM-L6-v2**, using Transformers.js **3.8.1**, the quantized **q8** ONNX model, mean pooling, and L2 normalization. Each of the original curated vocabulary words is embedded alone. This is semantic representation from a trained transformer; spelling distance, hand-labeled categories, random vectors, and an external guessing API are never substituted.

- [Model and Apache-2.0 license declaration](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
- [Pinned model revision](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9)
- [Original Sentence Transformers model](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [Official feature-extraction pipeline documentation](https://huggingface.co/docs/transformers.js/en/pipelines)

Model credit: the Sentence Transformers authors and Xenova's ONNX conversion, licensed Apache-2.0. The game ships only derived numeric vectors and metadata. The downloaded weights and the build dependency remain outside the game checkout.

`games/warm-words/model-info.json` records the model revision, dimensions, pooling, precision, library version, word/target counts, generation time, original vocabulary provenance, and SHA-256 digests of the vocabulary, vector artifact, tokenizer, and model weights. Every vector is finite and within 0.001 of unit length before the runtime re-normalizes it. The runtime ranks all vocabulary words against the selected target by the same cosine score; ties have a stable alphabetical order.

Stored-vector examples: **car ↔ automobile = 86.47%** and **car ↔ spoon = 22.97%**. Exact words are 100%. These are cosine percentages, not probabilities or percentages of correctness. Quantized inference can vary slightly with batch composition; the committed vocabulary order and fixed batch size make regeneration deterministic for this build. An independent full offline regeneration produced the same vector SHA-256:

`15f5a29964b01b84db53c3f07bd6a53e7064eecc4b76249ca75fe9cd0415bc9b`

Single words lack sentence context, so the model can make surprising associations and cannot distinguish every sense of a word. Vocabulary rank is often a more useful guide than a fixed similarity threshold. The UI's warmth labels use rank ranges: 2–10 very close, 11–50 warm, 51–200 promising, and larger ranks cold. The visual thermometer clamps to 0–100; the displayed cosine percentage preserves negative scores if they occur.

## Rebuild the vectors

Use Node 20+ and a separate build directory. The normal game package has no transformer dependency, inference API key, paid service, or runtime model download.

```sh
mkdir -p /tmp/warm-words-build
npm install --prefix /tmp/warm-words-build @huggingface/transformers@3.8.1
EMBEDDING_TOOL_ROOT=/tmp/warm-words-build \
EMBEDDING_CACHE_DIR=/tmp/warm-words-model-cache \
node scripts/build-word-embeddings.mjs
```

The first build downloads the pinned public model. For later offline builds add `EMBEDDING_OFFLINE=1` and use the same populated cache directory. A failed download or invalid output fails the build; existing files remain untouched until inference completes. No fallback vectors are manufactured. Rebuild after changing the curated vocabulary, and commit `vocabulary.json`, `embeddings.json`, and `model-info.json` together.

## Game configuration and extension

The manifest in `games/warm-words/server.js` declares `rounds`, `roundSeconds`, and `hints`, plus an optional custom `targets` string array with 2–200 words. Targets must have an existing supported embedding. Unsupported or duplicate custom targets are skipped and a public notice explains that; an entirely unsupported pack uses standard targets. The target choices themselves stay private. To discover supported spellings when authoring a pack, inspect `games/warm-words/vocabulary.json`.

`games/engines/semantic-guess.js` owns the round, scoring, history, validation, hint, and projection rules. The thin game definition supplies its schema, targets, and an embedding provider. Another semantic game can reuse `createSemanticGuess({ contentId, provider, targets, schema })`. A provider supplies `size`, `has(word)`, `neighbors(target)` (ranked actual cosine entries), and `compare(target, word)`; the included `createEmbeddingProvider(data)` validates and normalizes real vector data. Reusing the engine does not require copying the rules.

The server accepts `{ guess: 'word' }`, `{ hint: true }`, and host-only `{ next: true }`. The client supplies neither scores nor vectors. Guesses use letters only and are case-insensitive. Unknown words receive an honest common-word vocabulary message. A 350 ms per-player cooldown, per-player deduplication, and a 200-entry public history bound limit spam. Two players may independently try the same word. The UI preserves the input and cursor on peer updates, offers closest/newest ordering, supports keyboard scrolling, and uses the calibrated `api.now()` for its clock.

Views explicitly project public fields. The current secret, target dealer, individual error map, guessed-word sets, vectors, ranking cache, and timer callbacks never appear on the wire. Completed round targets can be shown after reveal. The shared Room framework rejects spectator actions, stale instance/window tokens, and actions from replaced sockets; both engine and framework guard stale timer transitions. Engine disposal cancels the current timer.

## Verification

```sh
node test/warm-words.js
node scripts/check-game.js warm-words
```

The first command verifies all 1,507 real vectors and provenance digests, a semantic relationship between differently spelled words, cosine identity, rank ordering, malformed vectors, private projections, unknown/invalid/duplicate guesses, cooldowns, forged scores, hints and costs, two complete rounds, timeout, bounded history, disposal, and real Room token/resume/spectator/window/rematch behavior. The shared all-game playability driver uses legal guesses and hints before an explicitly marked server peek that simulates a knowledgeable exact solver.
