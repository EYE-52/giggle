'use strict';
/* Fixture-only helper: proves the negative fixture loads, so its
 * check-game failure comes from the dependency scan, not the load. */
module.exports = { tag: () => 'greedy' };
