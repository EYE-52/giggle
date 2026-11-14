// One ephemeral outgoing video source per account. The socket and call generation
// own it together, so an old tab's stop/disconnect cannot clear a newer call.
const crypto = require('crypto');
const SHARE_LEASE_MS = 30_000;
const keyFor = userId => `member_media:${userId}`;
const client = () => require('../config/redisConfig').redis;
const replaceIfOwned = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local old = cjson.decode(raw)
if old.socketId ~= ARGV[1] or old.generation ~= ARGV[2] then return 0 end
if ARGV[3] == '' then redis.call('DEL', KEYS[1])
else redis.call('SET', KEYS[1], ARGV[3], 'PX', 7200000) end
return 1`;
async function begin(userId, socketId, scope, redis = client()) {
  const state = {socketId, generation: crypto.randomBytes(16).toString('hex'), scope, screenSharing: false, expiresAt: 0};
  await redis.set(keyFor(userId), JSON.stringify(state), 'PX', 7200000);
  return state.generation;
}
async function update(userId, socketId, generation, scope, sharing, redis = client(), now = Date.now()) {
  const state = {socketId, generation, scope, screenSharing: sharing, expiresAt: sharing ? now + SHARE_LEASE_MS : 0};
  return Boolean(await redis.eval(replaceIfOwned, 1, keyFor(userId), socketId, generation, JSON.stringify(state)));
}
async function end(userId, socketId, generation, redis = client()) {
  return Boolean(await redis.eval(replaceIfOwned, 1, keyFor(userId), socketId, generation, ''));
}
async function publicState(userId, scope, redis = client(), now = Date.now()) {
  const raw = await redis.get(keyFor(userId));
  const state = raw ? JSON.parse(raw) : null;
  const sharing = state?.scope === scope && state.screenSharing === true && state.expiresAt > now;
  return {screenSharing: sharing, screenSharingExpiresAt: sharing ? state.expiresAt : 0};
}
async function clearMember(userId, memberId, redis = client()) {
  const raw = await redis.get(keyFor(userId));
  const state = raw ? JSON.parse(raw) : null;
  if (!state?.scope.endsWith(`:${memberId}`)) return false;
  return end(userId, state.socketId, state.generation, redis);
}
module.exports = {begin, update, end, publicState, clearMember, SHARE_LEASE_MS};
