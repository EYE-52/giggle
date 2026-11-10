'use strict';

const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { validateEvent, TYPES } = require('../public/js/toolkit/telemetry-schema.mjs');
const MINUTE = 60000, RETENTION = 30 * 86400000;

function period(value = '24h') {
  const match = /^(\d+)(m|h|d)$/.exec(value);
  const ms = match && Number(match[1]) * { m: MINUTE, h: 3600000, d: 86400000 }[match[2]];
  if (!ms || ms > RETENTION / 2) throw new Error('Since must be between 1m and 15d.');
  return ms;
}

// IPs are held only in memory, never stored in SQLite or returned to operators.
function createLimiter({ now = Date.now, trustRailwayProxy = false, max = 60, cap = 10000 } = {}) {
  const buckets = new Map();
  return req => {
    const time = now();
    for (const [key, item] of buckets) if (item.until <= time) buckets.delete(key);
    const edge = String(req.headers['x-real-ip'] || '');
    const address = trustRailwayProxy && isIP(edge) ? edge : req.socket.remoteAddress || '';
    let bucket = buckets.get(address);
    if (!bucket) {
      if (buckets.size >= cap) return false;
      buckets.set(address, bucket = { count: 0, until: time + MINUTE });
    }
    return ++bucket.count <= max;
  };
}

function createTelemetry({ database, gameIds, maps = new Set(), now = Date.now, maxIssues = 5000, maxBuckets = 100000 }) {
  let db, lastPrune = -Infinity;
  function storage() {
    if (!db) {
      const opened = database();
      opened.exec(`CREATE TABLE IF NOT EXISTS telemetry_issues (
        fingerprint TEXT NOT NULL, release TEXT NOT NULL, type TEXT NOT NULL, game TEXT NOT NULL,
        message TEXT NOT NULL, selector TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', context TEXT NOT NULL,
        PRIMARY KEY(fingerprint, release));
        CREATE TABLE IF NOT EXISTS telemetry_counts (
          fingerprint TEXT NOT NULL, release TEXT NOT NULL, minute INTEGER NOT NULL, count INTEGER NOT NULL,
          PRIMARY KEY(fingerprint, release, minute));
        CREATE INDEX IF NOT EXISTS telemetry_expiry ON telemetry_issues(last_seen);
        CREATE INDEX IF NOT EXISTS telemetry_minutes ON telemetry_counts(minute);`);
      db = opened;
    }
    prune();
    return db;
  }
  function prune(force = false) {
    if (!force && now() - lastPrune < MINUTE) return;
    const cutoff = now() - RETENTION;
    db.prepare('DELETE FROM telemetry_counts WHERE minute < ?').run(cutoff);
    db.prepare('DELETE FROM telemetry_issues WHERE last_seen < ?').run(cutoff);
    // Drop stale context too, even for a fingerprint that keeps recurring.
    db.prepare(`UPDATE telemetry_issues SET first_seen=max(first_seen,?), count=coalesce(
      (SELECT sum(c.count) FROM telemetry_counts c WHERE c.fingerprint=telemetry_issues.fingerprint AND c.release=telemetry_issues.release),0)`).run(cutoff);
    lastPrune = now();
  }
  function ingest(events) {
    const values = events.map(event => validateEvent(event, gameIds, maps));
    const store = storage(), time = now(), minute = Math.floor(time / MINUTE) * MINUTE;
    store.exec('BEGIN IMMEDIATE');
    try {
      for (const event of values) {
        const { type, game, message, selector, release, ...context } = event;
        const dimensions = ['low-fps', 'frame-summary'].includes(type) ? [context.map, context.tier, context.device] : [];
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify([type, game, message, selector, ...dimensions])).digest('hex').slice(0, 32);
        store.prepare(`INSERT INTO telemetry_issues VALUES (?,?,?,?,?,?,?,?,1,'new',?)
          ON CONFLICT(fingerprint,release) DO UPDATE SET last_seen=excluded.last_seen,
          count=count+1, context=excluded.context,
          status=CASE WHEN status='resolved' THEN 'new' ELSE status END`).run(fingerprint, release, type, game, message, selector, time, time, JSON.stringify(context));
        store.prepare(`INSERT INTO telemetry_counts VALUES (?,?,?,1)
          ON CONFLICT(fingerprint,release,minute) DO UPDATE SET count=count+1`).run(fingerprint, release, minute);
      }
      store.prepare(`DELETE FROM telemetry_issues WHERE rowid IN
        (SELECT rowid FROM telemetry_issues ORDER BY last_seen DESC, rowid DESC LIMIT -1 OFFSET ?)`).run(maxIssues);
      store.exec(`DELETE FROM telemetry_counts WHERE NOT EXISTS (SELECT 1 FROM telemetry_issues i
        WHERE i.fingerprint=telemetry_counts.fingerprint AND i.release=telemetry_counts.release)`);
      store.prepare(`DELETE FROM telemetry_counts WHERE rowid IN
        (SELECT rowid FROM telemetry_counts ORDER BY minute DESC, rowid DESC LIMIT -1 OFFSET ?)`).run(maxBuckets);
      store.exec('COMMIT');
    } catch (error) { store.exec('ROLLBACK'); throw error; }
    return values.length;
  }
  function digest(filters = {}) {
    const span = period(filters.since || '24h');
    const game = filters.game || 'all', type = filters.type || 'all', release = filters.release || 'all', status = filters.status || 'all';
    if ((game !== 'all' && game !== 'platform' && !gameIds.has(game)) ||
      (type !== 'all' && !TYPES.includes(type)) || !['all', 'new', 'triaged', 'resolved'].includes(status) ||
      !/^(all|unknown|[0-9a-f]{40}|\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)$/.test(release)) throw new Error('Invalid problem filters.');
    const store = storage(), start = (Math.floor(now() / MINUTE) + 1) * MINUTE - span;
    const rows = store.prepare(`SELECT i.*, sum(CASE WHEN c.minute>=? THEN c.count ELSE 0 END) AS current_count,
      sum(CASE WHEN c.minute<? THEN c.count ELSE 0 END) AS previous_count
      FROM telemetry_issues i JOIN telemetry_counts c USING(fingerprint,release)
      WHERE c.minute>=? AND (?='all' OR i.game=?) AND (?='all' OR i.type=?)
      AND (i.type!='frame-summary' OR ?='frame-summary')
      AND (?='all' OR i.release=?) AND (?='all' OR i.status=?)
      GROUP BY i.fingerprint,i.release HAVING current_count>0
      ORDER BY current_count DESC,i.last_seen DESC LIMIT 100`).all(start, start, start - span, game, game, type, type, type, release, release, status, status);
    const items = rows.map(({ context, current_count, previous_count, first_seen, last_seen, ...rest }) => ({
      ...rest, count: current_count, previousCount: previous_count, firstSeen: first_seen, lastSeen: last_seen,
      spike: current_count >= 10 && current_count >= Math.max(1, previous_count) * 2,
      context: JSON.parse(context),
    }));
    return { since: filters.since || '24h', windowStart: start, previousStart: start - span, windowEnd: now(), items };
  }
  function setStatus(fingerprint, release, status) {
    if (!/^[0-9a-f]{32}$/.test(fingerprint) || !['new', 'triaged', 'resolved'].includes(status) || typeof release !== 'string' || release.length > 80) throw new Error('Invalid problem status.');
    return storage().prepare('UPDATE telemetry_issues SET status=? WHERE fingerprint=? AND release=?').run(status, fingerprint, release).changes > 0;
  }
  function counts() {
    const store = storage();
    return { available: true, ...store.prepare(`SELECT count(*) AS fingerprints,
      coalesce(sum(status='new'),0) AS new, coalesce(sum(status='triaged'),0) AS triaged,
      coalesce(sum(status='resolved'),0) AS resolved FROM telemetry_issues`).get(),
      events24h: store.prepare('SELECT coalesce(sum(count),0) AS n FROM telemetry_counts WHERE minute>=?').get(now() - 86400000).n };
  }
  return { ingest, digest, setStatus, counts };
}
module.exports = { createTelemetry, createLimiter, period, RETENTION };
