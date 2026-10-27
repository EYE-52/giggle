# Question limits and word hints

20 Questions keeps its classic name. In Customize, the host can choose **10–50 questions per round**; the default is 20. The live badge and the question-limit reveal use the chosen number, including 30. A guesser can queue one unanswered question at a time. Any correct guess ends the round immediately; otherwise the chosen answered-question limit or the round timer ends it.

**Shared letter hints** are optional and off by default in 20 Questions. When enabled, everyone sees the same word mask. An active guesser can reveal a letter immediately, up to two times per round. Each successful hint lowers the eventual correct-guess reward by 50 points; existing scores stay intact. The answerer and spectators cannot request hints. Very short words can offer fewer hints because the final character remains hidden.

The correct-guess reward is `max(0, 200 + round(500 × (maxQuestions − answered) / maxQuestions) − 50 × hintsUsed)`. It keeps a 700-point starting maximum across 10, 20, 30, and 50 questions. At the default 20 questions it matches the original 25-points-per-question formula. The answerer earns `round(200 × answered / maxQuestions)` on a solve, or the existing 200-point stumper bonus on a timeout/question limit. Hints and the public mask reset every round.

Doodle Guess keeps its classic **automatic halfway letter hint** on by default. Turn it off in Customize to keep the mask completely concealed until the reveal. These automatic hints keep their existing free scoring behavior. Candidate words remain private to the artist, and the final reveal is visible to guessers.

`games/engines/word-hints.js` supplies the shared Unicode-safe mask and letter reveal used by 20 Questions, Doodle Guess, and Charades. Spaces are retained, other characters are hidden, and a hint never reveals the last concealed character. Charades and Doodle accept custom secrets up to the advertised 60-character limit end to end.

20 Questions history is newest first. **All / 👍 Yes / 👎 No / 🤷 Sometimes** filters work during play and reveal, including for spectators. Filters and inputs remain mounted while snapshots update the history’s own scroll box. Reveal/results explicitly say **Word guessed**, **Question limit reached**, or **Time’s up**.

Run the focused checks with Node 24: `node test/word-hints.js`. They cover 20/30-question thresholds, 10–50 validation, hint permissions/cap/cost/reset, public projection privacy, legitimate early solves, stale timers/actions, latest-first stable filters, 40/41/60-character secrets, full Memory Tray recall, and non-color typing feedback.
