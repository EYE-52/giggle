const { redis } = require('../config/redisConfig');

const SESSION_PREFIX = 'squad_session:';
const FIELD_SEPARATOR = ':';

/**
 * Sets a session field (e.g. member ready state) in Redis.
 */
const setSessionField = async (squadId, memberId, field, value) => {
  const key = `${SESSION_PREFIX}${squadId}`;
  // One Redis hash entry per field makes concurrent ready/video updates atomic.
  await redis.hset(key, `${memberId}${FIELD_SEPARATOR}${field}`, JSON.stringify(value));
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
  // Read old JSON-per-member entries until their two-hour TTL naturally clears.
  for (const [entry, data] of Object.entries(rawData)) {
    if (!entry.includes(FIELD_SEPARATOR)) session[entry] = JSON.parse(data);
  }
  for (const [entry, data] of Object.entries(rawData)) {
    const separator = entry.lastIndexOf(FIELD_SEPARATOR);
    if (separator < 0) continue;
    const memberId = entry.slice(0, separator);
    const field = entry.slice(separator + 1);
    session[memberId] = session[memberId] || {};
    session[memberId][field] = JSON.parse(data);
  }
  return session;
};

/**
 * Clears session data for a squad.
 */
const clearSquadSession = async (squadId) => {
  await redis.del(`${SESSION_PREFIX}${squadId}`);
};

/** Clears every Redis field owned by one member, including the legacy entry. */
const clearMemberSession = async (squadId, memberId) => {
  const key = `${SESSION_PREFIX}${squadId}`;
  const memberKey = String(memberId || '');
  if (!memberKey) return;
  const fields = (await redis.hkeys(key)).filter(
    (field) => field === memberKey || field.startsWith(`${memberKey}${FIELD_SEPARATOR}`)
  );
  if (fields.length) await redis.hdel(key, ...fields);
};

module.exports = {
  setSessionField,
  getSquadSession,
  clearSquadSession,
  clearMemberSession,
};
