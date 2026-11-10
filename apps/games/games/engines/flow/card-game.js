'use strict';
// Locale/custom-pack boundary. Strings remain literal, never grammar source.
const { createEngine } = require('./index');
const NORMAL_FLOW = require('./normal-flow.json');
function cardsFromRows(rows, prefix, tags = []) {
  const unique = new Set();
  return rows.flatMap((row, i) => {
    const card = typeof row === 'string' ? { text: row } : { ...row };
    if (typeof card.text === 'string') {
      const key = card.text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
      if (!key || unique.has(key)) return [];
      unique.add(key);
    }
    return [{ ...card, id: card.id || `${prefix}-${i}`, tags: [...new Set([...tags, ...(card.tags || [])])] }];
  });
}
function createCardGame(id, cards, options = {}) {
  if (cards.some(c => c.effects?.length)) throw new Error('Instant prompt decks cannot apply activity effects; use offer/complete instead');
  return createEngine({ ...NORMAL_FLOW, id, cards }, options);
}
function dealText(engine, request) {
  const result = engine.draw(request);
  if (result.status !== 'offered') return null;
  engine.complete(result.token);
  return result.text;
}
module.exports = { cardsFromRows, createCardGame, dealText };
