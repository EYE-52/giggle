'use strict';

// Public masks contain only spaces and explicitly revealed characters.
function maskWord(word) {
  return Array.from(String(word)).map((c) => /\s/u.test(c) ? c : '_').join('');
}

function hiddenLetters(word, masked) {
  const chars = Array.from(String(word));
  const mask = Array.from(masked);
  return chars.reduce((n, c, i) => n + (mask[i] === '_' && !/\s/u.test(c) ? 1 : 0), 0);
}

function revealLetter(word, masked, random = Math.random) {
  const chars = Array.from(String(word));
  const mask = Array.from(masked);
  const hidden = chars.map((c, i) => mask[i] === '_' && !/\s/u.test(c) ? i : -1).filter((i) => i >= 0);
  // Keep the final character concealed, even for very short custom words.
  if (hidden.length <= 1) return masked;
  const i = hidden[Math.min(hidden.length - 1, Math.floor(Math.max(0, random()) * hidden.length))];
  mask[i] = chars[i];
  return mask.join('');
}

module.exports = { maskWord, hiddenLetters, revealLetter };
