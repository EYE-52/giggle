#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createTelemetry, period } = require('../server/telemetry');
const usage = 'Usage: node scripts/telemetry-digest.js [--since 24h] [--json] [--game ID] [--type TYPE] [--release VERSION] [--status new|triaged|resolved|all]';

async function main() {
  const args = process.argv.slice(2), filters = { since: '24h' };
  let json = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--json') json = true;
    else if (['--since', '--game', '--type', '--release', '--status'].includes(arg) && args.length) filters[arg.slice(2)] = args.shift();
    else throw new Error(usage);
  }
  period(filters.since);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(process.env.GAME_REPORT_ACCESS_FILE || path.join(os.homedir(), '.codex/secrets/giggle-games-reports.json'), 'utf8')); } catch { /* Optional existing inbox access file. */ }
  const remote = process.env.GAME_REPORT_URL || (!process.env.GAME_REPORT_DB && saved.url);
  let result;
  if (remote) {
    const url = new URL('/api/telemetry', remote);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for remote inbox access.');
    const token = process.env.GAME_REPORT_ADMIN_TOKEN || saved.token;
    if (!token || token.length < 32) throw new Error('Set GAME_REPORT_ADMIN_TOKEN or the existing private GAME_REPORT_ACCESS_FILE.');
    url.search = new URLSearchParams(filters);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Problem inbox returned ${response.status}.`);
    result = await response.json();
  } else {
    const file = process.env.GAME_REPORT_DB || path.join(__dirname, '../.data/reports.sqlite');
    if (!fs.existsSync(file)) throw new Error('No report database. Set GAME_REPORT_DB, or GAME_REPORT_URL and inbox access.');
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout=3000;');
      const catalog = require('../games/registry').list();
      result = createTelemetry({ database: () => db, gameIds: new Set(catalog.map(g => g.id)) }).digest(filters);
    } finally { db.close(); }
  }
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`Problems in ${result.since} (sampled observations; previous equal period in brackets)`);
  if (!result.items.length) console.log('No problems recorded.');
  for (const item of result.items) {
    console.log(`${item.spike ? 'SPIKE ' : ''}${item.count} (${item.previousCount}) ${item.game} / ${item.type} / ${item.release} [${item.status}]`);
    console.log(`  ${item.message}${item.selector ? ' · ' + item.selector : ''}`);
    console.log(`  ${item.fingerprint} · first ${new Date(item.firstSeen).toISOString()} · last ${new Date(item.lastSeen).toISOString()}`);
    if (item.context.map || item.context.p95) console.log(`  ${JSON.stringify(item.context)}`);
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
