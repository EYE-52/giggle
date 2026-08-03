const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("socket presence is Redis-backed for multi-instance deployments", () => {
  const service = read("src/services/socketService.js");

  assert.equal(service.includes('const PRESENCE_USER_PREFIX = "presence:user:";'), true);
  assert.equal(service.includes('const PRESENCE_SOCKET_PREFIX = "presence:socket:";'), true);
  assert.equal(service.includes("async function markUserOnline"), true);
  assert.equal(service.includes("async function markUserOffline"), true);
  assert.equal(service.includes("async function isUserOnline"), true);
  assert.equal(service.includes("async function getOnlineUserIds"), true);
  assert.equal(service.includes("redis.sadd(userKey, socketId);"), true);
  assert.equal(service.includes("redis.set(socketKey, userId, \"EX\", PRESENCE_TTL_SECONDS);"), true);
  assert.equal(service.includes("onlineCounts = new Map"), false);
});

test("presence call sites await distributed online checks", () => {
  const friends = read("src/controllers/friendsController.js");
  const squad = read("src/controllers/squadController.js");
  const matchmaking = read("src/services/matchmakingService.js");
  const socketService = read("src/services/socketService.js");

  assert.equal(friends.includes("const onlineSet = await getOnlineUserIds"), true);
  assert.equal(squad.includes("const onlineMemberIds = await socketService.getOnlineUserIds(memberUserIds);"), true);
  assert.equal(squad.includes("online: onlineMemberIds.has(member.userId),"), true);
  assert.equal(matchmaking.includes("socketService.getOnlineUserIds(freshSquad.members.map((m) => m.userId))"), true);
  assert.equal(matchmaking.includes("socketService.getOnlineUserIds(freshCandidate.members.map((m) => m.userId))"), true);
  assert.equal(matchmaking.includes("if (!hasMinimumOnlineMembers(freshSquad, seekerOnlineMembers))"), true);
  assert.equal(socketService.includes("if (await isUserOnline(userId)) return;"), true);
  assert.equal(socketService.includes("const onlineMemberIds = await getOnlineUserIds"), true);
});
