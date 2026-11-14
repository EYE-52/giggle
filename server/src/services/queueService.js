const { redis } = require('../config/redisConfig');

const QUEUE_PREFIX = 'matchmaking_queue:';
const METADATA_PREFIX = 'squad_meta:';
const REGION_INDEX = 'matchmaking_regions';
const CANDIDATE_BATCH_SIZE = 100;
const CURSOR_TTL_SECONDS = 1800;
const cursorKey = (squadId) => `matchmaking_cursor:${squadId}`;
const RETRY_CURSOR_KEY = 'matchmaking_retry_cursor';
const REGION_BOOTSTRAP_KEY = 'matchmaking_regions_bootstrap';

const getRetryCursor = async () => {
  const raw = await redis.get(RETRY_CURSOR_KEY);
  try {
    const cursor = JSON.parse(raw);
    return cursor && typeof cursor.squadId === 'string' &&
      (cursor.queuedAt === null || Number.isFinite(Date.parse(cursor.queuedAt))) ? cursor : null;
  } catch { return null; }
};
const setRetryCursor = (squad) => redis.set(RETRY_CURSOR_KEY, JSON.stringify({
  squadId: squad.squadId,
  queuedAt: squad.searchQueuedAt == null ? null : new Date(squad.searchQueuedAt).toISOString(),
}), 'EX', CURSOR_TTL_SECONDS);

// Older deployments have queue sorted sets but no region index. Discover one
// SCAN page per expansion until the upgrade pass completes; never loop over
// the keyspace while holding the matchmaking lock.
const bootstrapRegionIndex = async () => {
  const cursor = await redis.get(REGION_BOOTSTRAP_KEY) || '0';
  if (cursor === 'done') return;
  const [next, keys] = await redis.scan(cursor, 'MATCH', `${QUEUE_PREFIX}*`, 'COUNT', 250);
  const pipe = redis.pipeline();
  keys.forEach(key => pipe.zadd(REGION_INDEX, 0, key.slice(QUEUE_PREFIX.length)));
  pipe.set(REGION_BOOTSTRAP_KEY, next === '0' ? 'done' : next, 'EX', 86400);
  const results = await pipe.exec();
  const error = results?.find(([error]) => error)?.[0];
  if (error) throw error;
};

// Seek by (queuedAt, squadId), not by an offset: removing earlier squads or
// the last candidate must not skip the next waiting squad. Binary search uses
// O(log N) Redis operations and returns at most one bounded age-ordered page.
const candidatePageScript = `
local count = redis.call('ZCARD', KEYS[1])
local field = 'queue:' .. ARGV[1]
if count == 0 then
  redis.call('HDEL', KEYS[2], field)
  redis.call('ZREM', KEYS[3], ARGV[1])
  return {}
end
redis.call('ZADD', KEYS[3], 0, ARGV[1])
local start = 0
local raw = redis.call('HGET', KEYS[2], field)
if raw then
  local ok, previous = pcall(cjson.decode, raw)
  if ok and type(previous) == 'table' and type(previous[1]) == 'number' and type(previous[2]) == 'string' then
    local low, high = 0, count
    while low < high do
      local mid = math.floor((low + high) / 2)
      local row = redis.call('ZRANGE', KEYS[1], mid, mid, 'WITHSCORES')
      local score = tonumber(row[2])
      if score < previous[1] or (score == previous[1] and row[1] <= previous[2]) then low = mid + 1 else high = mid end
    end
    start = low
  end
end
if start >= count then start = 0 end
local rows = redis.call('ZRANGE', KEYS[1], start, start + tonumber(ARGV[2]) - 1, 'WITHSCORES')
if #rows > 0 then
  redis.call('HSET', KEYS[2], field, cjson.encode({tonumber(rows[#rows]), rows[#rows - 1]}))
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
return rows`;

const nextRegionScript = `
local previous = redis.call('HGET', KEYS[2], '__region')
local rows = redis.call('ZRANGEBYLEX', KEYS[1], previous and '(' .. previous or '-', '+', 'LIMIT', 0, 1)
if #rows == 0 then rows = redis.call('ZRANGEBYLEX', KEYS[1], '-', '+', 'LIMIT', 0, 1) end
if #rows > 0 then
  redis.call('HSET', KEYS[2], '__region', rows[1])
  redis.call('EXPIRE', KEYS[2], ARGV[1])
end
return rows`;

const removeInvalidEntryScript = `
if redis.call('HGET', KEYS[2], 'squadId') ~= ARGV[1] or redis.call('HGET', KEYS[2], 'region') ~= ARGV[2] then
  return redis.call('ZREM', KEYS[1], ARGV[1])
end
return 0`;

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
      .zadd(REGION_INDEX, 0, region)
      .del(cursorKey(squadId))
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
    pipe.del(cursorKey(squadId));
    await pipe.exec();
    return;
  }

  const queueKey = `${QUEUE_PREFIX}${meta.region}`;
  await Promise.all([
    redis.zrem(queueKey, squadId),
    redis.del(`${METADATA_PREFIX}${squadId}`),
    redis.del(cursorKey(squadId)),
  ]);
};

/**
 * Gets squads from a specific region.
 */
const getQueuedSquadsByRegion = async (region, { seekerId, limit = CANDIDATE_BATCH_SIZE } = {}) => {
  const queueKey = `${QUEUE_PREFIX}${region}`;
  const boundedLimit = Math.floor(Math.min(CANDIDATE_BATCH_SIZE, Math.max(1, Number(limit) || CANDIDATE_BATCH_SIZE)));
  const rows = seekerId ? await redis.eval(candidatePageScript, 3, queueKey, cursorKey(seekerId), REGION_INDEX,
    region, boundedLimit, CURSOR_TTL_SECONDS) : null;
  const squadIds = rows ? rows.filter((_, index) => index % 2 === 0) : await redis.zrange(queueKey, 0, -1);
  if (!squadIds.length) return [];

  const pipe = redis.pipeline();
  squadIds.forEach(id => pipe.hgetall(`${METADATA_PREFIX}${id}`));
  const results = await pipe.exec();

  const staleIds = [];
  const squads = results.map(([err, data], index) => {
    if (err) throw err;
    if (!data || data.squadId !== squadIds[index] || data.region !== region) {
      staleIds.push(squadIds[index]);
      return null;
    }
    return {
      ...data,
      tags: data.tags ? data.tags.split(',') : [],
    };
  }).filter(Boolean);
  if (staleIds.length) {
    const cleanup = redis.pipeline();
    staleIds.forEach(id => cleanup.eval(removeInvalidEntryScript, 2, queueKey, `${METADATA_PREFIX}${id}`, id, region));
    const cleaned = await cleanup.exec();
    const error = cleaned?.find(([error]) => error)?.[0];
    if (error) throw error;
  }
  return squads;
};

/**
 * Gets all squads from all regions.
 */
const getAllQueuedSquads = async (options = {}) => {
  if (options.seekerId) {
    // Rotate regions and their independent age cursors. Legacy regions are
    // indexed incrementally even before maintenance visits their seekers.
    await bootstrapRegionIndex();
    const regions = await redis.eval(nextRegionScript, 2, REGION_INDEX, cursorKey(options.seekerId), CURSOR_TTL_SECONDS);
    if (!regions.length) return [];
    return getQueuedSquadsByRegion(regions[0], options);
  }
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
  CANDIDATE_BATCH_SIZE,
  getRetryCursor,
  setRetryCursor,
};
