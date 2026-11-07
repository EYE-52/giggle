# Same room · one device

Open `/same-room/`, or choose **Play on one device** beside **Create room**
on home, a game's setup dialog, or its game guide. Add names (commas and
Enter work), choose settings, and start. There is no account or room code.
This mode still needs a connection to the game server.

## Games

21 games opt in through `manifest.sameRoom`:

- Truth or Dare: 2–20 people, with Classic, Funny, and Wild decks. Choose
  Random card, Room pool vote, Ask your own, or Mixed in setup. The target
  uses the normal Truth, Dare, and Spin for me cards. Other players write,
  pick the prompt, and judge through private hand-offs; the target never
  writes or votes. With two people, the other player decides.
- Would You Rather, Never Have I Ever, Most Likely To, Hot Takes, Pick One,
  Rank It, Two Truths, Trivia, Story Builder, and Rapid Polls.
- Charades: the actor privately reads the word, hides it, and gives the
  phone back. Acting time begins after that. Choose the guesser's name
  before recording a guess. Camera and microphone are not used.
- Doodle Guess: the artist privately picks the word; the shared canvas
  then hides the word. Use the normal drawing tools. Choose a guesser's
  name to record a guess. The word is revealed by the game's normal rules.
- 5 Second Rule: say the three answers aloud. The timer and the group's
  pass/fail votes use the game's normal scoring. There is no transcript.
- Dare Roulette.
- Chess, Checkers, Four in a Row, Reversi, Kalah, and Ludo use hot-seat turns.
  Chess and other two-seat boards accept exactly two names; Ludo accepts
  two to four. Party games accept up to their own cap, with a ceiling of 20.

Camera games, simultaneous arcade games, private fleets, Draw Phone, and
other unreviewed games opt out. Their one-device entry does not appear.

## Runtime and privacy

`server/same-room.js` extends the existing `Room`. It uses the original
`create`, `onAction`, `view`, `onTick`, settings validation, content packs,
and score awards. It does not register a public room, open twenty sockets,
or run game rules in the client. Ordinary practice remains unchanged.

The server chooses the active seat. During **Pass the phone** and **Done,
pass it back**, the payload has no game projection. The page disposes the
old view and removes its DOM. After **I'm name**, only that seat's normal
projection is mounted. Private drafts survive readiness updates, and
switching away from a private page covers it again.

The shared turn banner follows the active seat on every update, including
the target while choosing or performing and each private writer or voter.
Game choice uses an art-card shelf, and enum settings use the host dialog's
segmented pickers and tiles. Prompt style is picked in setup.

One-device votes are private and taken in seat order. Each voter or trivia
answerer gets a fresh, equal timer; the game's own scoring uses their
actual answer time. Passing, loading, returning, disconnection, and reading
the Charades word do not consume time. A timed-out seat sends no invented
vote: after everyone has answered or timed out, the original game deadline
settles the missing answers. Performance and board clocks run normally.

Each input carries the current step, so double taps and retired controls
cannot operate the next seat. A tab-only capability resumes a paused game
for two minutes after disconnection. There is only one live controller.
Game state is in memory and ends on server restart. Names use a separate
tab draft and do not overwrite the online player's identity.

## Checks

`npm run test:same-room` runs runtime, DOM entry-flow, and real HTTP/WebSocket
tests. These also run in `npm test`.

`npm run test:same-room:browser` requires Playwright. It exercises the real
flow, checks private DOM removal, mounts all 21 views, checks phone
overflow, and captures 390×844, 800×600, and 1280×800 in Day and Night. Set
`CHROMIUM_EXECUTABLE` to a cached Chromium path if needed. Set
`SAME_ROOM_ARTIFACT_DIR` to choose the screenshot folder (default:
the system temp folder's `giggle-same-room-shots`).

The current sandbox blocks Chromium's macOS Mach-port registration. The
in-app browser host is also unavailable. Screenshots and visual acceptance
remain unverified here; the browser test is ready for an environment that
can launch Chromium.
