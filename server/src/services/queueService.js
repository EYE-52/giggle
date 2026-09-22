const { redis } = require('../config/redisConfig');

const QUEUE_PREFIX = 'matchmaking_queue:';
const METADATA_PREFIX = 'squad_meta:';

// Non-blocking replacement for KEYS: iterate the keyspace with SCAN so a large
// Redis never stalls on a single O(N) command. Returns unique region queue keys.
const scanQueueKeys = async () => {
  const found = new Set();
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${QUEUE_PREFIX}*`, 'COUNT', 250);
    keys.forEach((key) => found.add(key));
    cursor = nextCursor;
  } while (cursor !== '0');
  return [...found];
};

/**
 * Adds a squad to the matchmaking queue for a specific region.
 * @param {string} squadId 
 * @param {number} size 
 * @param {string} region 
 */
const addToQueue = async (squadId, size, region = 'global', tags = [], reputationScore = 100) => {
  const now = Date.now();
  const queueKey = `${QUEUE_PREFIX}${region}`;
  const metadataKey = `${METADATA_PREFIX}${squadId}`;

  try {
    // Store metadata and queue membership in one Redis round trip.
    const results = await redis.pipeline()
      .hset(metadataKey, {
        squadId,
        size,
        region,
        tags: tags.join(','),
        reputationScore,
        queuedAt: now,
      })
      .zadd(queueKey, now, squadId)
      .exec();
    const commandError = results?.find(([error]) => error)?.[0];
    if (commandError) throw commandError;
  } catch (error) {
    // Redis pipelines are not atomic: remove either half of a partial admission.
    await Promise.allSettled([
      redis.zrem(queueKey, squadId),
      redis.del(metadataKey),
    ]);
    throw error;
  }
};

/**
 * Removes a squad from the matchmaking queue.
 */
const removeFromQueue = async (squadId) => {
  const meta = await redis.hgetall(`${METADATA_PREFIX}${squadId}`);
  if (!meta || !meta.region) {
    // Fallback search across common regions if meta is lost
    const regions = await scanQueueKeys();
    const pipe = redis.pipeline();
    regions.forEach(key => pipe.zrem(key, squadId));
    pipe.del(`${METADATA_PREFIX}${squadId}`);
    await pipe.exec();
    return;
  }

  const queueKey = `${QUEUE_PREFIX}${meta.region}`;
  await Promise.all([
    redis.zrem(queueKey, squadId),
    redis.del(`${METADATA_PREFIX}${squadId}`),
  ]);
};

/**
 * Gets squads from a specific region.
 */
const getQueuedSquadsByRegion = async (region) => {
  const queueKey = `${QUEUE_PREFIX}${region}`;
  const squadIds = await redis.zrange(queueKey, 0, -1);
  if (!squadIds.length) return [];

  const pipe = redis.pipeline();
  squadIds.forEach(id => pipe.hgetall(`${METADATA_PREFIX}${id}`));
  const results = await pipe.exec();

  return results.map(([err, data]) => {
    if (!data) return null;
    return {
      ...data,
      tags: data.tags ? data.tags.split(',') : [],
    };
  }).filter(Boolean);
};

/**
 * Gets all squads from all regions.
 */
const getAllQueuedSquads = async () => {
  const regionKeys = await scanQueueKeys();
  if (!regionKeys.length) return [];

  const allSquads = [];
  for (const key of regionKeys) {
    const region = key.replace(QUEUE_PREFIX, '');
    const squads = await getQueuedSquadsByRegion(region);
    allSquads.push(...squads);
  }
  return allSquads;
};

module.exports = {
  addToQueue,
  removeFromQueue,
  getQueuedSquadsByRegion,
  getAllQueuedSquads,
};
