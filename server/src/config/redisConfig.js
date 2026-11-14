const Redis = require('ioredis');
const { default: Redlock } = require('redlock');
const { getRedisOptions } = require('./redisOptions');

/**
 * Production-Grade Redis Configuration
 * Optimized for Render + Upstash / Managed Redis
 */
// 1. Primary command client. Bounded retries so API requests fail fast
//    (instead of hanging forever) while Redis is unavailable.
const redis = new Redis(...getRedisOptions());

// 2. Socket.io adapter pub/sub clients keep unlimited per-request retries so
//    cross-replica broadcasts queue through a Redis blip. Pub is lazy: it only
//    connects once the adapter publishes (i.e. when sockets are initialised).
// Adapter subscriptions can start as soon as the socket connects. INFO-based
// ready checks would then run in subscriber mode and reject adapter startup.
const subClient = new Redis(...getRedisOptions({ maxRetriesPerRequest: null, enableReadyCheck: false }));
const pubClient = new Redis(...getRedisOptions({ maxRetriesPerRequest: null, lazyConnect: true }));

const clients = [
  { name: 'Primary', client: redis },
  { name: 'Pub', client: pubClient },
  { name: 'Sub', client: subClient }
];

clients.forEach(({ name, client }) => {
  client.on('connect', () => {
    console.log(`Redis ${name} TCP connection established...`);
  });

  client.on('ready', () => {
    console.log(`Redis ${name} ready and authenticated ✅`);
  });

  client.on('error', (err) => {
    console.error(`Redis ${name} error: ${err.message}`);
    if (err.message.includes('WRONGPASS')) {
      console.error('CRITICAL: Redis password incorrect. Please check your REDIS_URL.');
    }
  });

  client.on('reconnecting', (ms) => {
    console.log(`Redis ${name} reconnecting in ${ms}ms...`);
  });
});

const redlock = new Redlock(
  [redis],
  {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500,
  }
);

const MATCHMAKING_LOCK_STRIPES = 256;
const MATCHMAKING_LOCK_DURATION_MS = 5000;
const matchmakingStripeResource = (squadId) => {
  let hash = 2166136261;
  for (const char of String(squadId)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  // One hash tag also permits atomic multi-key leases on Redis Cluster.
  return `lock:{matchmaking}:stripe:${hash % MATCHMAKING_LOCK_STRIPES}`;
};
const matchmakingLockResources = (squadIds) => {
  if (squadIds === undefined) {
    return Array.from({ length: MATCHMAKING_LOCK_STRIPES }, (_, index) => `lock:{matchmaking}:stripe:${index}`).sort();
  }
  if (!Array.isArray(squadIds) || !squadIds.length || squadIds.some(id => typeof id !== 'string' || !id)) {
    throw new TypeError('Matchmaking scope requires nonempty squad IDs');
  }
  return [...new Set(squadIds.map(matchmakingStripeResource))].sort();
};
const matchmakingLeaseResources = (squadIds, env = process.env) => {
  if (env.MEET_SCOPED_MATCHMAKING_LOCKS === 'true') return matchmakingLockResources(squadIds);
  // First rollout overlaps legacy global-only replicas safely. This mixed-key
  // compatibility barrier requires standalone Redis; Cluster supports scoped mode.
  return ['lock:matchmaking', ...matchmakingLockResources()];
};
const assertMatchmakingLease = (signal) => {
  if (signal?.aborted) throw signal.error || new Error("Matchmaking lock was lost");
};

const withMatchmakingLock = (routine, { squadIds, retryCount } = {}) => {
  const resources = matchmakingLeaseResources(squadIds);
  const guarded = async (signal) => {
    assertMatchmakingLease(signal);
    const result = await routine(signal);
    assertMatchmakingLease(signal);
    return result;
  };
  return redlock.using(
    resources,
    MATCHMAKING_LOCK_DURATION_MS,
    ...(retryCount === undefined ? [guarded] : [{ retryCount }, guarded])
  );
};

// Multi-replica guard for periodic background jobs: each tick, only the replica
// that wins a short SET NX PX lease runs the routine. The lease is not released
// early, so replicas whose timers fire a little later in the same tick skip it.
// Returns undefined (without running) when another replica holds the lease.
const runAsSingleReplica = async (jobName, leaseMs, routine) => {
  const acquired = await redis.set(
    `lock:job:${jobName}`,
    `${process.pid}:${Date.now()}`,
    'PX',
    leaseMs,
    'NX'
  );
  if (acquired !== 'OK') return undefined;
  return routine();
};

module.exports = {
  redis,
  pubClient,
  subClient,
  redlock,
  withMatchmakingLock,
  MATCHMAKING_LOCK_STRIPES,
  matchmakingStripeResource,
  matchmakingLockResources,
  matchmakingLeaseResources,
  assertMatchmakingLease,
  runAsSingleReplica,
};
