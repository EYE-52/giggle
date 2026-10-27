/* Practice uses ordinary server-enforced seats. There are no computer players
 * and no reduced player minimums. Keep unreviewed additions unavailable rather
 * than inventing solo behavior from a category or renderer. */
const groups = {
  turns: ['chain-reaction', 'checkers', 'chess', 'four-in-a-row', 'kalah', 'ludo', 'reversi'],
  hidden: ['bluff', 'compliment-battle', 'draw-phone', 'emoji-story', 'fleet-duel', 'funny-answer', 'hot-takes', 'most-likely', 'rank-it', 'roast-toast', 'two-truths', 'would-you-rather', 'pick-one', 'rapid-polls', 'never-ever', 'story-builder', 'twenty-questions'],
  timed: ['countdown-word', 'lyric-fill', 'memory-tray', 'number-hunt', 'reaction-tap', 'scattergories', 'trivia', 'typing-race', 'word-chain'],
  drawing: ['doodle-guess'],
  performance: ['charades', 'dare-roulette', 'five-second', 'pose-party', 'show-and-go', 'truth-dare', 'warm-words'],
  driving: ['pocket-karts'],
};

const notes = {
  turns: 'Take each turn yourself by switching seats. This is a rules walkthrough, not a computer opponent.',
  hidden: 'Enter answers and votes in each seat. You can see both sides of hidden information, so this is a walkthrough rather than a fair competition.',
  timed: 'Try a timed attempt, then switch seats to test other inputs. Timers keep running and idle seats do not answer automatically.',
  drawing: 'Switch between artist and guessers to test drawing and answers. Knowing the secret word makes this a controls walkthrough.',
  performance: 'Walk through performer and judging seats using a pretend performance. This does not test real cameras, microphones or a group’s reactions.',
  driving: 'Drive one kart at a time. Other seats stay parked and can time out; there are no bots. Use Maps & settings to choose a 1–5 minute round.',
};

export const PRACTICE_MODES = Object.freeze(Object.fromEntries(
  Object.entries(groups).flatMap(([mode, ids]) => ids.map(id => [id, mode])),
));

export function practiceSupport(game) {
  const mode = game && Object.hasOwn(PRACTICE_MODES, game.id) && PRACTICE_MODES[game.id];
  const min = game?.minPlayers;
  const max = game?.maxPlayers;
  if (!mode || !Number.isInteger(min) || !Number.isInteger(max) || min < 2 || min > 8 || max < min) return null;
  const playingSeats = Number.isInteger(game.seats) && game.seats >= min ? game.seats : max;
  return { mode, note: notes[mode], minSeats: min, maxSeats: Math.min(max, playingSeats, 8) };
}
