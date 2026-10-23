'use strict';
/* Game registry: id -> entry. Display metadata comes from def.manifest
 * when present; the LEGACY table keeps all existing games working
 * untouched. New manifest-bearing games in games/<id>/server.js are
 * auto-discovered — no registry edit needed. See GAME_GUIDE.md. */

const fs = require('fs');
const path = require('path');
const { manifestPlayers, clientSchema, validateManifest, isValidId } = require('./_validate');

// Legacy display metadata for the 30 shipped games (fallback only).
const LEGACY = [
  ['would-you-rather', 'Would You Rather', 'Impossible choices, majority wins', 'vote', 'Vote A or B in secret. Match the majority to score — streaks earn bonus.'],
  ['doodle-guess', 'Doodle Guess', 'Draw it, friends guess it', 'draw', 'One player draws, everyone else guesses. Fast correct guesses score big; the artist earns too.', true],
  ['truth-dare', 'Truth or Dare', 'Spin, confess or perform', 'social', 'The spinner picks a player: answer the Truth or perform the Dare. The room votes.'],
  ['never-ever', 'Never Have I Ever', 'Have you ever…? Be honest', 'social', 'Read the card aloud. Everyone taps Have or Never — honest answers only.'],
  ['most-likely', 'Most Likely To', 'Vote who fits the bill', 'vote', 'Read the prompt, everyone votes a player. Majority voters score.'],
  ['hot-takes', 'Hot Takes', 'Defend your spiciest opinion', 'vote', 'Submit a spicy take, then vote agree or disagree on each. Most divisive wins.'],
  ['rank-it', 'Rank It', 'Rank five, match the crowd', 'vote', "Rank all five items privately. Closest to the group's consensus scores."],
  ['two-truths', 'Two Truths & a Lie', 'Spot the lie', 'bluff', 'Write two truths and one lie. Others vote the lie — fool them or spot it.'],
  ['funny-answer', 'Punchline', 'Funniest answer takes the round', 'bluff', 'Answer the prompt secretly. Funniest answer, voted anonymously, wins.'],
  ['bluff', 'Bluff', 'Fake answers, find the truth', 'bluff', 'Write a fake answer, then pick the truth from the mix. Score for truth-finds and fooled votes.'],
  ['story-builder', 'Story Builder', 'One sentence each, comic results', 'social', 'Add one sentence on your turn before time runs out. Read the masterpiece together.'],
  ['emoji-story', 'Emoji Story', 'Tell it in emoji, guess it', 'word', 'Describe your secret phrase in emoji only. Others race to guess it.'],
  ['trivia', 'Trivia Blitz', 'Fast questions, faster fingers', 'word', 'Faster correct answers earn more points. Consecutive correct answers add streak bonuses.'],
  ['scattergories', 'Scattergories', 'Letter, lists, unique wins', 'word', 'Fill every category with the given letter before time. Unique answers score.'],
  ['word-chain', 'Word Chain', 'Stay linked, never repeat', 'word', 'Say a word linked to the last one in 10 seconds. Repeats or blanks knock you out.'],
  ['countdown-word', 'Word Countdown', 'Longest word from 9 letters', 'word', 'Build the longest word from 9 letters in 30 seconds. Longest valid wins.'],
  ['lyric-fill', 'Lyric Fill', 'Complete the famous line', 'word', 'Fill the missing words within 20 seconds. Exact answers earn 150 points; close answers earn 75.'],
  ['five-second', '5 Second Rule', 'Name 3 in 5 seconds', 'speed', 'Name 3 things in the category within 5 seconds. The room judges pass or fail.'],
  ['charades', 'Charades', 'Act it out, guess fast', 'speed', 'Act out your word on camera — no talking. Guessers race to name it.'],
  ['twenty-questions', '20 Questions', 'Yes/no your way to it', 'social', 'Ask yes-or-no questions to find the secret. Fewest questions wins.'],
  ['pick-one', 'Pick One', 'Match the majority, rapid fire', 'speed', 'Pick A or B in 5 seconds. Match the majority, build streaks.'],
  ['memory-tray', 'Memory Tray', 'Memorize, recall, win', 'speed', 'Memorize the items, then type all you remember. Most correct wins.'],
  ['rapid-polls', 'Rapid Polls', 'Ask anything, live results', 'social', 'Pose any question with options. Watch live results roll in.'],
  ['dare-roulette', 'Dare Roulette', 'Spin the wheel, do the dare', 'social', 'Spin to choose a player and a dare. The other players vote Done or Chicken. Completed dares earn points, with streak bonuses.'],
  ['compliment-battle', 'Compliment Battle', 'Sweetest words win', 'social', 'Write a private compliment for the target. Vote on anonymous notes except your own. Winning writers earn 100 points.'],
  ['roast-toast', 'Roast Toast', 'Friendly burns only', 'bluff', 'Write a friendly roast for the target. Vote on anonymous entries except your own. The room favorite earns 100 points; the target’s favorite earns 150.'],
  ['draw-phone', 'Draw Phone', 'Telephone meets drawing', 'draw', 'Write, draw, guess in rotation. Watch masterpieces melt down the chain.', true],
  ['reaction-tap', 'Reaction Tap', 'Tap on green. Not before', 'speed', 'Wait for green, then tap! Early taps foul. Fastest of 5 rounds wins.', true],
  ['typing-race', 'Typing Race', 'Same sentence, fastest fingers', 'speed', 'Type the sentence perfectly. Fastest finisher wins.', true],
  ['number-hunt', 'Number Hunt', 'Hot or cold to 1–100', 'word', 'Guess 1–100 using hotter/colder hints. Fewest tries wins.', true],
];

const LEGACY_BY_ID = {};
for (const [id, name, tagline, cat, howto, realtime] of LEGACY) {
  LEGACY_BY_ID[id] = { name, tagline, cat, howto, realtime: !!realtime };
}

function buildEntry(def) {
  const m = def.manifest || {};
  const legacy = LEGACY_BY_ID[def.id] || {};
  const { min, max } = manifestPlayers(def);
  const schema = clientSchema(def);
  const originalArt = typeof m.art === 'string' ? m.art : `img/games/${def.id}.png`;
  const compactArt = originalArt.replace(/\.png$/, '.webp');
  const art = compactArt !== originalArt && fs.existsSync(path.join(__dirname, '../public', compactArt))
    ? compactArt : (typeof m.art === 'string' ? m.art : null);
  return {
    id: def.id,
    name: m.name || legacy.name || def.id,
    tagline: m.tagline || legacy.tagline || '',
    howto: m.howto || legacy.howto || '',
    cat: m.cat || legacy.cat || 'social',
    realtime: !!(m.realtime !== undefined ? m.realtime : (def.realtime !== undefined ? def.realtime : legacy.realtime)),
    renderer: m.renderer || 'dom',
    layout: m.layout || (m.runtime ? 'immersive' : 'standard'),
    homepage: m.homepage === true,
    runtime: m.runtime ? {
      type: m.runtime.type,
      ...(m.runtime.type === 'frame' ? { entry: m.runtime.entry } : {}),
      ...(m.runtime.waitForResult !== undefined ? { waitForResult: m.runtime.waitForResult } : {}),
    } : null,
    minPlayers: min,
    maxPlayers: max,
    players: `${min}–${max}`, // derived from the definition, never a stale string
    seats: Number.isInteger(m.seats) ? m.seats : null, // active-player cap; null = whole roster plays
    communication: m.communication || 'any', // any|voice|video catalog hint
    art, // safe manifest art, or a local compressed variant of that same cover
    customizable: schema.settings.length > 0 || schema.packs.length > 0,
    schema,
    def,
  };
}

/* Load every game under <root> (a directory containing <id>/server.js).
 * Broken modules are skipped with a console warning, never fatal. */
function discover(root) {
  const entries = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isValidId(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return entries;
  }
  for (const id of dirs) {
    const file = path.join(root, id, 'server.js');
    if (!fs.existsSync(file)) continue;
    let def;
    try {
      def = require(file); // eslint-disable-line global-require, import/no-dynamic-require
    } catch (e) {
      console.error(`registry: skipping ${id} (load failed: ${e.message})`);
      continue;
    }
    if (!def || def.id !== id || typeof def.create !== 'function' ||
        typeof def.onAction !== 'function' || typeof def.view !== 'function') {
      console.error(`registry: skipping ${id} (bad module shape)`);
      continue;
    }
    const mv = validateManifest(def);
    if (!mv.ok) {
      console.error(`registry: skipping ${id} (manifest: ${mv.error})`);
      continue;
    }
    entries.push(buildEntry(def));
  }
  return entries;
}

/* Default registry: this checkout's games directory, legacy order first
 * (stable lobby order), newly discovered games appended alphabetically. */
let registry = [];
function loadDefault() {
  // Retain the old implementation for reference, but do not offer or start it.
  // A future tower-defence game will have its own rules and manifest.
  const found = discover(__dirname).filter((game) => game.id !== 'castle-clash');
  const legacyOrder = new Map(LEGACY.map(([id], i) => [id, i]));
  found.sort((a, b) => {
    const ai = legacyOrder.has(a.id) ? legacyOrder.get(a.id) : 1000 + a.id.charCodeAt(0);
    const bi = legacyOrder.has(b.id) ? legacyOrder.get(b.id) : 1000 + b.id.charCodeAt(0);
    return ai - bi || (a.id < b.id ? -1 : 1);
  });
  registry = found;
}
loadDefault();

const byId = () => {
  const m = {};
  for (const g of registry) m[g.id] = g;
  return m;
};

module.exports = {
  get: (id) => {
    const g = byId()[id];
    return g ? g.def : null;
  },
  meta: (id) => byId()[id] || null,
  list: () => registry.map((g) => ({
    id: g.id, name: g.name, tagline: g.tagline, players: g.players,
    minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    realtime: g.realtime, cat: g.cat, howto: g.howto,
    renderer: g.renderer, layout: g.layout, homepage: g.homepage, runtime: g.runtime, customizable: g.customizable, schema: g.schema,
    seats: g.seats, communication: g.communication, art: g.art,
  })),
  count: () => registry.length,
  discover, // exposed for tests / tooling against other roots
};
