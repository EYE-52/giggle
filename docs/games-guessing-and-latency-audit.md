# Guessing games and lag

Local playtests and a read-only hosting check for the normal Games app, 11 November 2026.

## What players can do after a correct guess

| Game | Who sees later guesses? | When does the round end? |
| --- | --- | --- |
| Doodle Guess | Other players see ordinary guesses. Only the solver sees the success message. | Everyone has solved, time runs out, or the turn is ended. |
| Emoji Story | Other players see ordinary guesses. The phrase and its accepted aliases stay hidden. | Everyone has solved, time runs out, or the game is ended. |
| Charades | The actor and the sender see the sender’s guesses. The input stays open after a solve. | Everyone has solved, time runs out, or the turn is ended. |
| Number Hunt | Other players see new wrong numbers and their clues. The first solve starts a short overtime. | Everyone has solved or the clock expires. The first finder wins. |

The server owns the award. A second correct guess cannot earn more points or extend the clock. In the public word games, typing the answer inside a longer message also keeps it out of the feed. The score, chat history and public message IDs must not identify a solver before reveal. Number Hunt shows the room how many people have found it.

We checked the rules for 37 games involving typing, guessing or clues. A game such as 20 Questions ends the round when the answer is found. Games with secret votes or one locked submission have different rules from a live guessing feed.

## Where Doodle lagged

The server was sending all retained ink to each connected player after a guess or brush preview. With 80 strokes of 64 points each, a single update was roughly 100 KB even when the drawing stayed the same. A slow connection queued drawing copies ahead of the next guess.

Doodle now uses the existing game connection to send only changes. A committed stroke has a stable key, so adding or removing one chunk does not send the retained picture again. Joining or reconnecting still gives the player a complete drawing. Older clients can still request complete updates. The server builds each player’s private fields separately from the shared drawing and guess feed.

| Measured with 12 local seats | Before | After |
| --- | ---: | ---: |
| Time for another player to receive a guess during a burst, p95 | 113 ms | 19 ms |
| Data delivered per player per second during that burst | 6.73 MB | 0.089 MB |
| Time for a guess to appear in the browser on a simulated slow link, p95 | 1,331 ms | 97 ms |
| Bytes for a new drawing chunk when 399 chunks were already present | 473,822 | 1,962 |

The first three comparisons used the same game rules, canvas and workload, with full updates and then with change-only updates. The last comparison isolates the extra saving from keyed chunks. The slow-link test added 80 ms round-trip delay and limited browser downloads to 256 KiB/s. A p95 is a time that 95% of the sample finished within. These short runs used local servers and Chromium. End-to-end play on a real mobile network or physical phone remains unmeasured.

Typing Race was also sampled with 3 and 12 seats. Peer updates took 1.5 ms and 5.3 ms at p95 locally. At 12 seats it still delivered about 235 KB/s per player. A loaded-room run on the target hosting would be needed to establish its real capacity.

## Hosting check

The public Games configuration pointed to the Railway room server, and the public health check returned HTTP 200. We read 24 hours of production metrics for the Railway service `giggle-play`, ending 11 November at 18:09 UTC. Across 289 five-minute samples, CPU averaged 0.0073 cores and peaked at 0.043 against an 8-core limit. Memory averaged 0.316 GB and peaked at 0.688 GB against an 8 GB limit. There was no sustained CPU or memory pressure in those samples. A five-minute figure can miss a short stall in a single room. The browser and socket tests above reproduced the slowdown without a busy server.

## Play checks

- Ran automated playthroughs for all 72 game rule sets. Played a three-seat Doodle round and a two-seat Number Hunt round through the browser. After the solve, another player saw the bluff and kept their half-typed guess. Rejoining Doodle restored the correct private view.
- Played selected typing, timing and board games through their controls at desktop and phone sizes. In Hot Potato a wrapping hint moved the pass button and scores by about 22 pixels. The same-turn checks now allow at most one pixel of movement. Also checked a knocked-out player and a late spectator.
- Fixed a separate Emoji Story bug where changing the room host left the guess field visible but silently stopped Send from working. Replayed that state change in Chrome at 390 and 1280 pixels and submitted the same draft with Enter.
- Added tests for guesses after a solve, repeated answers, spectator views, secret leakage, exact awards, focus and drafts. A private success sound plays only for the solver. Revealing a full room’s scores plays one shared reveal sound. The drawing tests compare the old and new wire formats across preview, commit, undo, clear, reconnect and the 400-chunk limit.

All 259 normal Games test commands passed across the main run and reruns. Two checks had expected guesses or sounds to be public. Their replacements now test the private success signal and public reveal for each player role. The browser layout sweep passed 1,224 measurements across the 72 games.

From `apps/games`, `npm test` runs the game regression suite. For a focused run:

```sh
node test/guess-chat.js
node test/guess-chat-view.js
node test/charades-input.js
node test/number-hunt-ties.js
npm run test:doodle
npm run test:realtime
```
