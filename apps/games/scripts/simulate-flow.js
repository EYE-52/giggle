#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { simulate } = require('../games/engines/flow/simulate');
const { validateDefinition } = require('../games/engines/flow');
function main(args) {
  const options = {}, allowed = ['content', 'sessions', 'turns', 'players', 'seed', 'skip-rate'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.includes(key) || args[i + 1] === undefined) throw new Error(`Usage: node scripts/simulate-flow.js --content file.json --sessions 100 --turns 40 --players 4 --seed example --skip-rate 0`);
    options[key] = args[i + 1];
  }
  const file = path.resolve(options.content || path.join(__dirname, '../../../docs/engine/examples/party.json'));
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateDefinition(content);
  if (errors.length) throw new Error(errors.join('\n'));
  const report = simulate(content, {
    sessions: options.sessions === undefined ? 100 : Number(options.sessions),
    turns: options.turns === undefined ? 40 : Number(options.turns),
    players: options.players === undefined ? 4 : Number(options.players),
    seed: options.seed || 'simulation', skipRate: Number(options['skip-rate'] || 0),
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return Object.keys(report.deadEnds).length ? 2 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
