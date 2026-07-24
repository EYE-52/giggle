const crypto = require("crypto");

function randomBase36(bytes = 8) {
  return crypto.randomBytes(bytes).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, bytes);
}

function randomChoice(items) {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items[crypto.randomInt(0, items.length)];
}

function shuffle(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

module.exports = { randomBase36, randomChoice, shuffle };
