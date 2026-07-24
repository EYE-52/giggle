const { redis } = require('../config/redisConfig');

const SESSION_PREFIX = 'squad_session:';

/**
 * Sets a session field (e.g. member ready state) in Redis.
 */
const setSessionField = async (squadId, memberId, field, value) => {
  const key = `${SESSION_PREFIX}${squadId}`;
  const data = await redis.hget(key, memberId) || '{}';
  const session = JSON.parse(data);
  session[field] = value;
  await redis.hset(key, memberId, JSON.stringify(session));
  // Expire session after 2 hours of inactivity
  await redis.expire(key, 7200);
};

/**
 * Gets the entire session state for a squad.
 */
const getSquadSession = async (squadId) => {
  const key = `${SESSION_PREFIX}${squadId}`;
  const rawData = await redis.hgetall(key);
  const session = {};
  for (const [memberId, data] of Object.entries(rawData)) {
    session[memberId] = JSON.parse(data);
  }
  return session;
};

/**
 * Clears session data for a squad.
 */
const clearSquadSession = async (squadId) => {
  await redis.del(`${SESSION_PREFIX}${squadId}`);
};

module.exports = {
  setSessionField,
  getSquadSession,
  clearSquadSession,
};
