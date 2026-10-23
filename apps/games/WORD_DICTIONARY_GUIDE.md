# Offline English word validation

Word Countdown and Word Chain use the same server-side `games/engines/english-dictionary.js` helper. It loads the checked-in **80,277-word** dictionary once, validates exact supported spellings, and can add a room's explicit host-approved words. It never calls a dictionary API, paid service, or inference model during play.

The list is a modified **SCOWL 2020.12.07, size 60** build. SCOWL's normal-word files are combined for common English, American, British, British -ize, and first-level American/British spelling variants. US and UK spellings such as *color/colour* and *theater/theatre* both work. Entries are sorted, deduplicated, lower-case ASCII letters, and 1–24 letters long. Proper-name, uppercase, abbreviation, contraction, roman-numeral, and special jargon categories are excluded. The list contains supported inflected forms; the helper never invents forms by stripping endings or fixing punctuation.

This is a supported spelling list, not an exhaustive claim about every English word. A real compound or a newer slang word may be absent. Word Countdown's authored `lightbulb` tray uses the explicit bundled extra-word list because size60 omits that spelling. Hosts can add extra accepted spellings for a themed room. Extra words **extend** the full dictionary, and never narrow it.

## Source and attribution

- [SCOWL project's official site](https://wordlist.aspell.net/)
- [Pinned official SCOWL release](https://sourceforge.net/projects/wordlist/files/SCOWL/2020.12.07/)
- [Original source at release commit](https://github.com/en-wl/wordlist/tree/5ef55f9c42730ebe4394a78b77855468a6f15dd2)
- [Original copyright and permissions](https://github.com/en-wl/wordlist/blob/5ef55f9c42730ebe4394a78b77855468a6f15dd2/scowl/Copyright)

The collective work is Copyright 2000–2018 Kevin Atkinson, with the original source copyrights and notices retained. Alan Beale's contributions to 12Dicts, ENABLE, and SCOWL's supplementary lists are credited in that notice. The **complete original copyright/permission text is included verbatim in `games/engines/SCOWL_COPYRIGHT.txt`**, including the original constituent notices. This distribution is clearly marked as modified by the filters above. The list is freely redistributable under SCOWL's MIT-like collective terms and its constituent notices; it is separate from the game's original code.

`games/engines/english-words-info.json` records the release, size, categories, modification, source archive/commit, per-source file hashes, output count/hash, and original copyright hash. Dictionary output SHA-256:

`c88b8c8dff54fdf96b53e6b3f5e7709d9f4cef3b45301a7c508308a9d8d11faa`

## Reproduce the build

The build uses Node's standard library and the extracted official release. No dependency is added to the game package.

```sh
curl -L https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz -o /tmp/scowl-2020.12.07.tar.gz
shasum -a 256 /tmp/scowl-2020.12.07.tar.gz
mkdir -p /tmp/scowl-2020.12.07
tar -xzf /tmp/scowl-2020.12.07.tar.gz -C /tmp/scowl-2020.12.07 --strip-components=1
node scripts/build-english-dictionary.mjs /tmp/scowl-2020.12.07
```

The official archive's SHA-256 must be:

`5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc`

The script checks the pinned copyright digest, validates word-list sanity, copies the complete copyright text, and regenerates the dictionary and provenance files. Compare the output digest with the committed metadata. A missing dictionary is a load error; it does not silently turn off validation.

## Reusing the helper

```js
const { createWordValidator, isSubset } = require('../engines/english-dictionary');
const validator = createWordValidator(hostExtraWords);
const result = validator.validate(rawWord, { minLength: 3, maxLength: 9, letters });
// result is {ok:true,word} or {ok:false,code,message}.
// letters is optional; when present, it checks multiplicity as well as membership.
```

Inputs are trimmed and case-normalized. Digits, punctuation, whitespace inside a word, and overlong strings are rejected rather than removed or truncated. A caller gets a meaningful error for format, minimum length, unsupported dictionary spelling, or unavailable tray letters. Custom words are trusted **only from the server-resolved room pack**. An action cannot declare its own accepted words.

## Word Countdown behavior

- Saved and locked words must have 3–9 letters, be supported dictionary/extra words, and fit the exact counts on the tray.
- An unsupported attempt receives private visible feedback and leaves the current answer unlocked. An invalid replacement cannot silently lock an older saved answer. Retries do not extend the clock.
- Save keeps editing available. Lock submits the valid saved word. Pass submits no word for zero points. All connected players locking or passing reveals the round; host Finish Now and the 30-second deadline also reveal it.
- Valid words earn 10 points per letter. Every player tied for the longest receives the 50-point bonus. The reveal rechecks validity before scoring.
- Authored trays are checked for a supported fitting solution. Invalid trays are skipped with a visible notice. If none remain, trays are generated from supported seed words, padded to nine letters and shuffled. Each generated tray has at least a valid three-letter solution; the revealed example is not necessarily the longest possible word.
- Best/other answers stay private during play. A late guess at or after the deadline cannot score. Reveal/next callbacks use both phase and round guards, and disposal cancels the current timer.

The `words` customization field is an additive list of extra accepted words. If no authored tray is available, these words can also seed solvable generated trays. The default locale contains `cat` and `lightbulb`; it does not replace the 80,277-word dictionary.

## Word Chain behavior

- A supported spelling advances the chain. The dictionary checks spelling; players continue to judge whether a word is related to its predecessor.
- An unsupported spelling receives private visible feedback and can be retried before the same deadline. The turn, chain, and clock stay unchanged.
- Blank or repeated accepted words still eliminate their author. A submission after the deadline produces a timeout, not an extra turn.
- Host custom starter words and extra accepted words are supported. Malformed custom entries get a visible skipped-entry notice.
- Every living non-author, **including the current player**, can vote to challenge the previous word. The required majority remains more than half of the living players. Eliminating a previous author preserves the current player's deadline; it cannot buy them extra time.
- Turn callbacks guard the monotonic `turnNo` as well as the player, so an old timer cannot fire when the same player returns later. Final awards occur once and disposal cancels the current timer.

Client views update same-window error feedback and challenge counts without replacing an active input. A challenge that removes the previous author preserves the current player's draft on the same turn. The shared Room instance/window and spectator/socket protections remain intact.

## Checks

```sh
node test/word-dictionary.js
node scripts/check-game.js countdown-word
node scripts/check-game.js word-chain
node test/race.js
```

The focused test uses the real licensed list, dictionary/copyright hashes, US/UK spellings, invalid anagrams/`zzz`/digit/punctuation inputs, multiplicity, extra packs, saved-answer replacement, ties/pass, all authored trays, eight generated rounds, deadlines, stale callbacks, actual Room custom-pack/window/instance guards, and client callback/error/input/challenge behavior. Browser layout is separately checked by the integration task.
