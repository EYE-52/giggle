'use strict';
const { own, safeKey } = require('./state');
const TOKEN = /#([A-Za-z0-9_-]+)(?:\.([A-Za-z]+))?#|\{([A-Za-z0-9_-]+)\}/g;
const modifiers = {
  upper: s => s.toUpperCase(), lower: s => s.toLowerCase(),
  capitalize: s => s ? s[0].toUpperCase() + s.slice(1) : s,
};
function tokens(text) {
  const out = [...text.matchAll(TOKEN)];
  if (/[#{}]/.test(text.replace(TOKEN, ''))) throw new Error('Malformed template token');
  return out;
}
function validateGrammar(grammar = {}, templates = [], slots = []) {
  let checks = 100000;
  const visit = (text, stack = []) => {
    if (--checks < 0) throw new Error('Grammar validation work limit');
    if (stack.length > 12) throw new Error('Grammar depth exceeds 12');
    for (const [, symbol, modifier, slot] of tokens(text)) {
      if (slot) { if (!slots.includes(slot)) throw new Error(`Unknown slot: ${slot}`); continue; }
      if (!safeKey(symbol) || !own(grammar, symbol)) throw new Error(`Unknown symbol: ${symbol}`);
      if (modifier && !own(modifiers, modifier)) throw new Error(`Unknown modifier: ${modifier}`);
      if (stack.includes(symbol)) throw new Error(`Grammar cycle: ${symbol}`);
      for (const row of grammar[symbol]) visit(row, [...stack, symbol]);
    }
  };
  for (const [key, rows] of Object.entries(grammar)) {
    if (!safeKey(key) || !Array.isArray(rows) || !rows.length || rows.some(s => typeof s !== 'string' || s.length > 4096)) throw new Error('Invalid grammar bank');
  }
  for (const rows of Object.values(grammar)) for (const row of rows) visit(row);
  for (const template of templates) visit(template);
}
function requiredSlots(template, grammar, visited = new Set()) {
  const slots = new Set();
  for (const [, symbol, , slot] of tokens(template)) {
    if (slot) slots.add(slot);
    else if (!visited.has(symbol)) {
      visited.add(symbol);
      for (const row of grammar[symbol] || []) for (const name of requiredSlots(row, grammar, visited)) slots.add(name);
    }
  }
  return slots;
}
function expand(template, grammar, slots, random) {
  let budget = 256;
  function render(text, depth = 0) {
    if (depth > 12 || --budget < 0) throw new Error('Template expansion limit');
    const output = text.replace(TOKEN, (_, symbol, modifier, slot) => {
      if (slot) {
        if (!own(slots, slot) || typeof slots[slot] !== 'string') throw new Error(`Missing slot: ${slot}`);
        // Slot values are literal; never parse a person's name as grammar.
        if (slots[slot].length > 200) throw new Error('Slot length exceeds 200');
        return slots[slot];
      }
      const rows = grammar[symbol];
      if (!rows || !rows.length) throw new Error(`Unknown symbol: ${symbol}`);
      const result = render(rows[Math.floor(random() * rows.length)], depth + 1);
      return modifier ? modifiers[modifier](result) : result;
    });
    if (output.length > 4096) throw new Error('Expanded text exceeds 4096');
    return output;
  }
  return render(template);
}
module.exports = { tokens, validateGrammar, requiredSlots, expand };
