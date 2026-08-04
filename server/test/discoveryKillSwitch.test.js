const assert = require("node:assert/strict");
const { after, afterEach, test } = require("node:test");

const appConfig = require("../src/config/appConfig");
const { Squad } = require("../src/models/Squad");
const User = require("../src/models/User");
const { Notification } = require("../src/models/Notification");
const { redlock, redis, subClient } = require("../src/config/redisConfig");
const queueService = require("../src/services/queueService");
const socketService = require("../src/services/socketService");
const {
  createSquadHandler,
  discoverSquadsHandler,
  joinRandomSquadHandler,
  joinSquadHandler,
  startSearchHandler,
} = require("../src/controllers/squadController");
const {
  ackEncounterForSquad,
  endEncounterAndRequeue,
  tryMatchmakeForSquad,
} = require("../src/services/matchmakingService");

const originalDiscoveryEnv = process.env.STRANGER_DISCOVERY_ENABLED;

afterEach(() => {
  if (originalDiscoveryEnv === undefined) delete process.env.STRANGER_DISCOVERY_ENABLED;
  else process.env.STRANGER_DISCOVERY_ENABLED = originalDiscoveryEnv;
});

after(async () => {
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("production discovery is disabled unless explicitly enabled", () => {
  assert.equal(typeof appConfig.isStrangerDiscoveryEnabled, "function");
  assert.equal(appConfig.isStrangerDiscoveryEnabled({ NODE_ENV: "production" }), false);
  assert.equal(appConfig.isStrangerDiscoveryEnabled({ NODE_ENV: "production", STRANGER_DISCOVERY_ENABLED: "true" }), true);
  assert.equal(appConfig.isStrangerDiscoveryEnabled({ NODE_ENV: "development" }), true);
  assert.equal(appConfig.isStrangerDiscoveryEnabled({ STRANGER_DISCOVERY_ENABLED: "false" }), false);
});

test("disabled discovery endpoints refuse before database or lock work", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";
  const originals = {
    acquire: redlock.acquire,
    find: Squad.find,
    error: console.error,
  };
  let work = 0;
  redlock.acquire = async () => { work += 1; throw new Error("unexpected lock work"); };
  Squad.find = () => { work += 1; throw new Error("unexpected database work"); };
  console.error = () => {};

  try {
    for (const [handler, request] of [
      [discoverSquadsHandler, { user: { userId: "507f1f77bcf86cd799439011" } }],
      [joinRandomSquadHandler, { body: {}, user: { userId: "507f1f77bcf86cd799439011" } }],
      [startSearchHandler, { squadAccess: { squad: { squadId: "sq_disabled" }, member: { memberId: "mem_disabled" } } }],
    ]) {
      const res = response();
      await handler(request, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error.code, "DISCOVERY_DISABLED");
    }
    assert.equal(work, 0);
  } finally {
    redlock.acquire = originals.acquire;
    Squad.find = originals.find;
    console.error = originals.error;
  }
});

test("private squad creation and code join are not disabled with discovery", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";

  const createRes = response();
  await createSquadHandler({ body: {}, user: {} }, createRes);
  assert.equal(createRes.statusCode, 401);
  assert.notEqual(createRes.body.error.code, "DISCOVERY_DISABLED");

  const userId = "507f1f77bcf86cd799439011";
  const member = { memberId: "mem_private", userId, role: "member" };
  const originals = {
    findById: User.findById,
    find: User.find,
    findOne: Squad.findOne,
    deleteMany: Notification.deleteMany,
  };
  User.findById = async () => ({ _id: userId });
  User.find = () => ({ lean: async () => [{ _id: userId, blockedUserIds: [] }] });
  Squad.findOne = async () => ({
    squadId: "sq_private",
    squadCode: "ABC-123",
    squadName: "Private room",
    status: "idle",
    members: [member],
  });
  Notification.deleteMany = async () => ({ deletedCount: 0 });

  try {
    const joinRes = response();
    await joinSquadHandler({
      body: { squadCode: "ABC-123" },
      params: {},
      user: { userId },
    }, joinRes);
    assert.equal(joinRes.statusCode, 200);
    assert.equal(joinRes.body.data.squadId, "sq_private");
    assert.deepEqual(joinRes.body.data.member, member);
  } finally {
    User.findById = originals.findById;
    User.find = originals.find;
    Squad.findOne = originals.findOne;
    Notification.deleteMany = originals.deleteMany;
  }
});

test("disabled matcher resets and dequeues a stale searching squad", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";
  const originals = {
    using: redlock.using,
    findOne: Squad.findOne,
    remove: queueService.removeFromQueue,
    emit: socketService.emitToSquad,
  };
  const removed = [];
  let lockUses = 0;
  let saves = 0;
  redlock.using = async (_resources, _duration, routine) => {
    lockUses += 1;
    return routine({ aborted: false });
  };
  queueService.removeFromQueue = async (squadId) => { removed.push(squadId); };
  socketService.emitToSquad = () => {};
  const staleSquad = {
    squadId: "sq_stale",
    status: "searching",
    currentEncounterId: "enc_stale",
    searchQueuedAt: new Date(),
    async save() { saves += 1; },
  };
  const freshSquad = { ...staleSquad, async save() { saves += 1; } };
  Squad.findOne = async () => freshSquad;

  try {
    assert.equal(await tryMatchmakeForSquad(staleSquad), null);
    assert.equal(freshSquad.status, "idle");
    assert.equal(freshSquad.currentEncounterId, null);
    assert.equal(freshSquad.searchQueuedAt, null);
    assert.equal(staleSquad.status, "searching");
    assert.deepEqual(removed, ["sq_stale"]);
    assert.equal(saves, 1);
    assert.equal(lockUses, 1);
  } finally {
    redlock.using = originals.using;
    Squad.findOne = originals.findOne;
    queueService.removeFromQueue = originals.remove;
    socketService.emitToSquad = originals.emit;
  }
});

test("disabled matcher cannot overwrite a squad matched after a stale call began", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";
  const originals = {
    using: redlock.using,
    findOne: Squad.findOne,
    remove: queueService.removeFromQueue,
  };
  let staleSaves = 0;
  const staleSquad = {
    squadId: "sq_race",
    status: "searching",
    async save() { staleSaves += 1; },
  };
  const matchedSquad = { squadId: "sq_race", status: "matched", currentEncounterId: "enc_new" };
  const removed = [];
  redlock.using = async (_resources, _duration, routine) => routine({ aborted: false });
  Squad.findOne = async () => matchedSquad;
  queueService.removeFromQueue = async (squadId) => { removed.push(squadId); };

  try {
    assert.equal(await tryMatchmakeForSquad(staleSquad), null);
    assert.equal(staleSaves, 0);
    assert.equal(matchedSquad.status, "matched");
    assert.equal(matchedSquad.currentEncounterId, "enc_new");
    assert.deepEqual(removed, ["sq_race"]);
  } finally {
    redlock.using = originals.using;
    Squad.findOne = originals.findOne;
    queueService.removeFromQueue = originals.remove;
  }
});

test("disabled discovery ends awaiting handoff instead of activating it", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";
  const originals = {
    updateMany: Squad.updateMany,
    findOne: Squad.findOne,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
  };
  const updates = [];
  const events = [];
  Squad.updateMany = async (_filter, update) => { updates.push(update); };
  Squad.findOne = async () => null;
  socketService.emitToSquad = (_squadId, event) => { events.push(event); };
  socketService.closeEncounterRoom = () => { events.push("CLOSE"); };
  const encounter = {
    encounterId: "enc_handoff",
    status: "awaiting_ack",
    squadAId: "sq_a",
    squadBId: "sq_b",
    expiresAt: new Date(Date.now() + 60_000),
    ackBySquad: new Map([["sq_a", true], ["sq_b", false]]),
    async save() {},
  };

  try {
    const result = await ackEncounterForSquad({ encounter, squadId: "sq_b" });
    assert.equal(result.error.status, 503);
    assert.equal(result.error.code, "DISCOVERY_DISABLED");
    assert.equal(encounter.status, "ended");
    assert.equal(updates[0].$set.status, "idle");
    assert.equal(events.includes("ENCOUNTER_ACTIVE"), false);
  } finally {
    Squad.updateMany = originals.updateMany;
    Squad.findOne = originals.findOne;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
  }
});

test("disabled encounter requeue ends both squads at idle without queueing", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";
  const originals = {
    updateMany: Squad.updateMany,
    findOne: Squad.findOne,
    add: queueService.addToQueue,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
  };
  const updates = [];
  let queued = 0;
  Squad.updateMany = async (_filter, update) => { updates.push(update); };
  Squad.findOne = async () => null;
  queueService.addToQueue = async () => { queued += 1; };
  socketService.emitToSquad = () => {};
  socketService.closeEncounterRoom = () => {};
  const encounter = {
    encounterId: "enc_disabled",
    squadAId: "sq_a",
    squadBId: "sq_b",
    async save() {},
  };

  try {
    assert.equal(await endEncounterAndRequeue({ encounter, triggeringSquadId: "sq_a" }), null);
    assert.equal(updates[0].$set.status, "idle");
    assert.equal(updates[0].$set.searchQueuedAt, null);
    assert.equal(queued, 0);
  } finally {
    Squad.updateMany = originals.updateMany;
    Squad.findOne = originals.findOne;
    queueService.addToQueue = originals.add;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
  }
});
