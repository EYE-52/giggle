const crypto = require('node:crypto');

const CHAT_DEDUP_TTL_SECONDS = 10 * 60;
const CHAT_DEDUP_PREFIX = 'chat:dedupe:';

const hashKeyPart = (value) => crypto
  .createHash('sha256')
  .update(String(value), 'utf8')
  .digest('hex');

const buildChatDedupKey = ({ senderId, room, clientMessageId } = {}) => {
  if (!senderId || !room || !clientMessageId) return null;
  return `${CHAT_DEDUP_PREFIX}${hashKeyPart(`${senderId}\u0000${room}\u0000${clientMessageId}`)}`;
};

const markUnavailable = (error) => {
  error.code = 'CHAT_DEDUP_UNAVAILABLE';
  return error;
};

/**
 * Atomically claims a retry id and stores the canonical ephemeral message.
 * Redis errors are allowed to reach the caller: silently falling back to a
 * local cache would reintroduce duplicate sends on another replica.
 */
const claimOrGetChatMessage = async ({
  senderId,
  room,
  clientMessageId,
  message,
  redis,
  ttlSeconds = CHAT_DEDUP_TTL_SECONDS,
} = {}) => {
  const key = buildChatDedupKey({ senderId, room, clientMessageId });
  if (!key) return { claimed: true, message };

  const serialized = JSON.stringify(message);
  let claimed;
  try {
    claimed = await redis.set(key, serialized, 'EX', ttlSeconds, 'NX');
  } catch (error) {
    throw markUnavailable(error);
  }
  if (claimed === 'OK' || claimed === true) return { claimed: true, message };

  let existing;
  try {
    existing = await redis.get(key);
  } catch (error) {
    throw markUnavailable(error);
  }
  if (!existing) {
    const error = new Error('Chat retry claim disappeared before it could be read');
    throw markUnavailable(error);
  }

  try {
    return { claimed: false, message: JSON.parse(existing) };
  } catch (error) {
    error.code = 'CHAT_DEDUP_UNAVAILABLE';
    throw error;
  }
};

module.exports = {
  CHAT_DEDUP_PREFIX,
  CHAT_DEDUP_TTL_SECONDS,
  buildChatDedupKey,
  claimOrGetChatMessage,
};
