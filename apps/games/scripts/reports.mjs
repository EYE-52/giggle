#!/usr/bin/env node
// Private operator tool. Secrets never belong in the repository or frontend.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const action = args.shift() || 'list';
const usage = 'Usage: npm run reports -- [list --status new|triaged|resolved|all --game GAME_ID] | [triage|resolve|reopen REPORT_ID]';
if (!['list', 'triage', 'resolve', 'reopen'].includes(action)) { console.error(usage); process.exit(1); }
let saved = {};
try { saved = JSON.parse(fs.readFileSync(process.env.GAME_REPORT_ACCESS_FILE || path.join(os.homedir(), '.codex/secrets/giggle-games-reports.json'), 'utf8')); } catch {}
const token = process.env.GAME_REPORT_ADMIN_TOKEN || saved.token;
const base = process.env.GAME_REPORT_URL || saved.url || 'https://play.gigglemeet.com';
if (!token || token.length < 32) { console.error('Inbox access is not configured. Set GAME_REPORT_ADMIN_TOKEN or a private GAME_REPORT_ACCESS_FILE.'); process.exit(1); }
try {
  let url = new URL('/api/reports', base), options = {};
  if (action === 'list') {
    const filters = { status: 'new', limit: '100' };
    while (args.length) { const name = args.shift(); if (!['--status', '--game', '--before'].includes(name) || !args.length) throw new Error(usage); filters[name.slice(2)] = args.shift(); }
    url.search = new URLSearchParams(filters);
  } else {
    const id = args.shift(); if (!/^[0-9a-f-]{36}$/i.test(id || '') || args.length) throw new Error(usage);
    url.pathname += `/${id}`;
    options = { method: 'PATCH', body: JSON.stringify({ status: { triage: 'triaged', resolve: 'resolved', reopen: 'new' }[action] }) };
  }
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Inbox returned ${response.status}.`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
