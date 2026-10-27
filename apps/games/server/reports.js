'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { sanitizeRunLog } = require('../public/js/toolkit/run-log-schema.mjs');

const CATEGORIES = ['controls', 'rules', 'layout', 'loading', 'performance', 'sound', 'other'];
const IMPACTS = ['blocked', 'problem', 'appearance'];
const STATUSES = ['new', 'triaged', 'resolved'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid report text.');
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (required && text.length < 10) throw new Error('Tell us what happened in at least 10 characters.');
  return text;
}

function validateReport(body, gameIds) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !UUID.test(body.id || '')) throw new Error('Invalid report.');
  if (body.game !== 'platform' && !gameIds.has(body.game)) throw new Error('Choose a game or the platform.');
  if (!CATEGORIES.includes(body.category) || !IMPACTS.includes(body.impact)) throw new Error('Choose the issue type.');
  const ctx = body.context || {};
  const context = {};
  // Whitelist device facts. Never collect URL parameters, player names,
  // room codes, private words, chat, drawings, call data or credentials.
  for (const [key, max] of [['browser', 500], ['language', 40], ['phase', 40], ['input', 30], ['theme', 20]]) {
    if (typeof ctx[key] === 'string') context[key] = cleanText(ctx[key], max);
  }
  for (const key of ['width', 'height']) {
    if (Number.isInteger(ctx[key]) && ctx[key] > 0 && ctx[key] <= 20000) context[key] = ctx[key];
  }
  if (typeof ctx.embedded === 'boolean') context.embedded = ctx.embedded;
  const run = sanitizeRunLog(ctx.run, gameIds);
  if (run) context.run = run;
  return {
    id: body.id.toLowerCase(), game: body.game, category: body.category, impact: body.impact,
    description: cleanText(body.description, 4000, true),
    steps: cleanText(body.steps || '', 1500), context,
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0, chunks = [], done = false;
    const finish = (error, data) => {
      if (done) return;
      done = true; clearTimeout(timer);
      chunks = [];
      if (error) reject(error); else resolve(data);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('Request timed out.'), { status: 408 })), 10000);
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 24576) finish(Object.assign(new Error('Report is too long.'), { status: 413 }));
      else if (!done) chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(Object.assign(new Error('Invalid report.'), { status: 400 })); }
    });
    req.on('error', error => finish(error));
    req.on('aborted', () => finish(new Error('Request closed.')));
  });
}

function createReportApi({ file, token, gameIds, catalog = [], version, originAllowed, trustRailwayProxy = false, now = Date.now }) {
  let db;
  const buckets = new Map();
  const json = (res, status, data, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(JSON.stringify(data));
  };
  function database() {
    if (!file) throw Object.assign(new Error('Reporting is unavailable. Please try again later.'), { status: 503 });
    if (!db) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const opened = new DatabaseSync(file);
      try { opened.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS reports (
          seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, game TEXT NOT NULL, category TEXT NOT NULL,
          impact TEXT NOT NULL, description TEXT NOT NULL, steps TEXT NOT NULL,
          context TEXT NOT NULL, version TEXT NOT NULL, fingerprint TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'new'
        );
        CREATE INDEX IF NOT EXISTS reports_status_seq ON reports(status, seq);
        CREATE INDEX IF NOT EXISTS reports_game_seq ON reports(game, seq);`);
        fs.chmodSync(file, 0o600);
        db = opened;
      } catch (error) { opened.close(); throw error; }
    }
    return db;
  }
  function admin(req) {
    if (typeof token !== 'string' || token.length < 32) return false;
    const header = req.headers.authorization;
    if (typeof header !== 'string' || header.length > 256 || !header.startsWith('Bearer ')) return false;
    const candidate = Buffer.from(header.slice(7)), expected = Buffer.from(token);
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }
  function limit(req) {
    const time = now();
    for (const [key, item] of buckets) if (item.until <= time) buckets.delete(key);
    // IPs live only in this bounded abuse budget, never in a saved report.
    // Local/direct deployments ignore caller-supplied forwarding headers.
    // Railway HTTP ingress supplies X-Real-IP; trust it only when explicitly
    // enabled for that deployment. Never trust a caller's leftmost XFF value.
    const edgeIp = String(req.headers['x-real-ip'] || '');
    const address = (trustRailwayProxy && isIP(edgeIp) ? edgeIp : req.socket.remoteAddress || '').slice(0, 80);
    let bucket = buckets.get(address);
    if (!bucket) {
      if (buckets.size >= 10000) return false;
      bucket = { count: 0, until: time + 600000 }; buckets.set(address, bucket);
    }
    return ++bucket.count <= 30;
  }
  const project = row => {
    const { fingerprint, context, created_at, updated_at, ...rest } = row;
    return { ...rest, createdAt: created_at, updatedAt: updated_at, context: JSON.parse(context) };
  };
  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://reports.local');
      const origin = req.headers.origin;
      if (origin && !originAllowed(origin, req)) return json(res, 403, { error: 'This origin is not allowed.' });
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        if (!origin) return json(res, 403, { error: 'This origin is not allowed.' });
        res.writeHead(204, { 'Cache-Control': 'no-store', 'Access-Control-Allow-Methods': 'POST, GET, PATCH', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' });
        res.end(); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reports') {
        if (!limit(req)) return json(res, 429, { error: 'Too many reports. Please try again in ten minutes.' }, { 'Retry-After': '600' });
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send a JSON report.' });
        let report;
        try { report = validateReport(await readJson(req), gameIds); }
        catch (error) { return json(res, error.status || 400, { error: error.message }); }
        const storage = database();
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
        const old = storage.prepare('SELECT id, created_at, fingerprint FROM reports WHERE id=?').get(report.id);
        if (old) {
          if (old.fingerprint !== fingerprint) return json(res, 409, { error: 'This report changed. Please send it again.' });
          return json(res, 200, { ok: true, id: old.id, createdAt: old.created_at });
        }
        if (storage.prepare('SELECT count(*) AS n FROM reports').get().n >= 100000) return json(res, 503, { error: 'The report inbox is full. Please try again later.' });
        const time = now();
        storage.prepare(`INSERT INTO reports (id,created_at,updated_at,game,category,impact,description,steps,context,version,fingerprint)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(report.id, time, time, report.game, report.category, report.impact, report.description, report.steps, JSON.stringify(report.context), version, fingerprint);
        return json(res, 201, { ok: true, id: report.id, createdAt: time });
      }
      if (!admin(req)) return json(res, 401, { error: 'Inbox access required.' });
      if (req.method === 'GET' && url.pathname === '/api/reports') {
        const status = url.searchParams.get('status') || 'new', game = url.searchParams.get('game') || 'all';
        const limit = Number(url.searchParams.get('limit') || 50), before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        if ((!STATUSES.includes(status) && status !== 'all') || (game !== 'all' && game !== 'platform' && !gameIds.has(game)) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(before) || before < 1) return json(res, 400, { error: 'Invalid inbox filters.' });
        const items = database().prepare(`SELECT * FROM reports WHERE seq < ? AND (?='all' OR status=?) AND (?='all' OR game=?) ORDER BY seq DESC LIMIT ?`).all(before, status, status, game, game, limit).map(project);
        return json(res, 200, { items, games: catalog, before: items.at(-1)?.seq || null });
      }
      const match = url.pathname.match(/^\/api\/reports\/([0-9a-f-]+)$/i);
      if (req.method === 'PATCH' && match && UUID.test(match[1])) {
        const body = await readJson(req);
        if (!body || !STATUSES.includes(body.status)) return json(res, 400, { error: 'Invalid issue status.' });
        const result = database().prepare('UPDATE reports SET status=?, updated_at=? WHERE id=?').run(body.status, now(), match[1].toLowerCase());
        return result.changes ? json(res, 200, { ok: true, status: body.status }) : json(res, 404, { error: 'Report not found.' });
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (error) {
      // Storage errors are operational details, never echo DB paths to players.
      return json(res, error.status || 503, { error: 'Reporting is unavailable. Your text has not been cleared; please try again.' });
    }
  }
  return { handle, enabled: !!file, close() { db?.close(); db = null; } };
}

module.exports = { createReportApi, validateReport, CATEGORIES, IMPACTS, STATUSES };
