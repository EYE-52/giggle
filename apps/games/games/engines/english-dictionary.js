'use strict';
/* Modified SCOWL2020.12.07 size60. Copyright Kevin Atkinson and contributors.
 * See SCOWL_COPYRIGHT.txt and WORD_DICTIONARY_GUIDE.md for full notices. */
const fs = require('fs');
const path = require('path');
const words = new Set(fs.readFileSync(path.join(__dirname, 'english-words.txt'), 'utf8').trim().split('\n'));

function normalizeWord(value, maxLength = 24) {
  if (typeof value !== 'string' || value.length > maxLength + 20) return null;
  const word = value.trim().toLowerCase();
  return word.length <= maxLength && /^[a-z]+$/.test(word) ? word : null;
}

function isSubset(word, letters) {
  if (typeof word !== 'string' || !Array.isArray(letters)) return false;
  const counts = Object.create(null);
  for (const letter of letters) {
    const key = String(letter).toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const letter of word) {
    if (!counts[letter]) return false;
    counts[letter] -= 1;
  }
  return true;
}

function createWordValidator(customWords = []) {
  const custom = new Set(customWords.map(word => normalizeWord(word)).filter(Boolean));
  return {
    has(word) { return words.has(word) || custom.has(word); },
    validate(raw, { minLength = 1, maxLength = 24, letters } = {}) {
      const word = normalizeWord(raw, maxLength);
      if (!word) return { ok: false, code: 'format', message: `Use one word with letters A–Z only (at most ${maxLength} letters).` };
      if (word.length < minLength) return { ok: false, code: 'short', message: `Use at least ${minLength} letters.` };
      if (!this.has(word)) return { ok: false, code: 'dictionary', message: 'That word is not in our offline English dictionary or the host’s extra words. Try another word.' };
      if (letters && !isSubset(word, letters)) return { ok: false, code: 'letters', message: 'Use only the letters on the tray, no more times than each appears.' };
      return { ok: true, word };
    },
  };
}

module.exports = { createWordValidator, normalizeWord, isSubset, wordCount: words.size };
