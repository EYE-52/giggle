"use strict";
/* One shared trie from the licensed offline dictionary, never sent to clients. */
const fs = require("node:fs");
const path = require("node:path");
let trie;
// SCOWL also contains adult terms and slurs. Keep this game's word pool suitable
// for family play without changing the shared dictionary used by other games.
const adultWord =
  /^(?:porn(?:o|os|s|ography|ographic|ographically|ographer|ographers)?|fuck(?:s|ed|er|ers|ing)?|motherfuck(?:er|ers|ing)?|shit(?:s|ty|ting|ted|head|heads)?|bullshit(?:s|ted|ting)?|bitch(?:es|y|ier|iest|ing|ed)?|cunt(?:s)?|cock(?:s|sucker|suckers)?|dick(?:s|head|heads)?|pussy|pussies|asshole(?:s)?|arsehole(?:s)?|wank(?:s|ed|er|ers|ing)?|masturbat(?:e|es|ed|ing|ion|ions|or|ors)|orgasm(?:s|ic)?|blowjob(?:s)?|handjob(?:s)?|dildo(?:s|es)?|penis(?:es)?|vagina(?:s|l)?|semen|sperm(?:s)?|sex(?:es|ual|ually)?|nigg(?:a|as|er|ers)|faggot(?:s)?|fag(?:s)?|kike(?:s)?|spic(?:s)?|chink(?:s)?)$/;
function dictionaryTrie() {
  if (trie) return trie;
  trie = Object.create(null);
  const words = fs
    .readFileSync(path.join(__dirname, "english-words.txt"), "utf8")
    .split("\n");
  for (const word of words) {
    if (word.length < 3 || word.length > 24 || adultWord.test(word)) continue;
    let node = trie;
    for (const c of word) node = node[c] ||= Object.create(null);
    node.word = word;
  }
  return trie;
}
const adjacent = Array.from({ length: 16 }, (_, at) =>
  Array.from({ length: 16 }, (_, i) => i).filter(
    (i) =>
      i !== at &&
      Math.abs((i % 4) - (at % 4)) <= 1 &&
      Math.abs(Math.floor(i / 4) - Math.floor(at / 4)) <= 1,
  ),
);
function solve(grid) {
  const root = dictionaryTrie(),
    found = new Map();
  function walk(at, node, mask, route) {
    for (const char of grid[at].toLowerCase()) {
      node = node[char];
      if (!node) return;
    }
    const next = [...route, at],
      used = mask | (1 << at);
    if (node.word && !found.has(node.word)) found.set(node.word, next);
    for (const near of adjacent[at])
      if (!(used & (1 << near))) walk(near, node, used, next);
  }
  for (let i = 0; i < 16; i++) walk(i, root, 0, []);
  return Object.fromEntries(found);
}
function validPath(grid, word, route) {
  return (
    Array.isArray(route) &&
    route.length >= 2 &&
    route.length <= 16 &&
    route.every((i) => Number.isInteger(i) && i >= 0 && i < 16) &&
    new Set(route).size === route.length &&
    route.every((at, i) => i === 0 || adjacent[route[i - 1]].includes(at)) &&
    route
      .map((at) => grid[at])
      .join("")
      .toLowerCase() === word
  );
}
module.exports = { solve, validPath };
