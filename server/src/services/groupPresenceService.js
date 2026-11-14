// Only an actively viewed group renews this lease. Saved membership is not presence.
const crypto = require("crypto");
const GROUP_PRESENCE_MS = 90_000;
const client = () => require("../config/redisConfig").redis;
const key = (group, user, socket) =>
  `group_presence:${group}:${user}:${socket}`;
const setKey = (group) => `group_presence_members:${group}`;
const memberKey = (user, socket) => `${user}:${socket}`;
const mutate = `
if ARGV[1] ~= 'begin' and redis.call('GET', KEYS[1]) ~= ARGV[2] then return 0 end
if ARGV[1] == 'end' then
 redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], ARGV[3])
else
 redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[5])
 redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', tonumber(ARGV[4]) - tonumber(ARGV[5]))
 redis.call('ZADD', KEYS[2], ARGV[4], ARGV[3]); redis.call('PEXPIRE', KEYS[2], ARGV[5] * 2)
end
return 1`;
async function begin(group, user, socket, redis = client(), now = Date.now()) {
  const generation = crypto.randomBytes(16).toString("hex");
  await redis.eval(
    mutate,
    2,
    key(group, user, socket),
    setKey(group),
    "begin",
    generation,
    memberKey(user, socket),
    now + GROUP_PRESENCE_MS,
    GROUP_PRESENCE_MS,
  );
  return generation;
}
async function update(
  group,
  user,
  socket,
  generation,
  redis = client(),
  now = Date.now(),
) {
  return Boolean(
    await redis.eval(
      mutate,
      2,
      key(group, user, socket),
      setKey(group),
      "update",
      generation,
      memberKey(user, socket),
      now + GROUP_PRESENCE_MS,
      GROUP_PRESENCE_MS,
    ),
  );
}
async function end(group, user, socket, generation, redis = client()) {
  return Boolean(
    await redis.eval(
      mutate,
      2,
      key(group, user, socket),
      setKey(group),
      "end",
      generation,
      memberKey(user, socket),
      0,
      GROUP_PRESENCE_MS,
    ),
  );
}
async function onlineUserIds(
  group,
  memberIds,
  redis = client(),
  now = Date.now(),
) {
  const current = new Set(memberIds.map(String));
  const rows = await redis.zrangebyscore(setKey(group), now + 1, "+inf");
  return new Set(
    rows.map((row) => row.split(":")[0]).filter((id) => current.has(id)),
  );
}
module.exports = { begin, update, end, onlineUserIds, GROUP_PRESENCE_MS };
