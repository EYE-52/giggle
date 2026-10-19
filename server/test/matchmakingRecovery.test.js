const assert = require("node:assert/strict");
const { after, afterEach, test } = require("node:test");

const {
  ackEncounterForSquad,
  endEncounterAndRequeue,
  endEncounterAsymmetric,
  getMatchmakingStatus,
  retrySearchingSquads,
  stopSearchesWhileDiscoveryDisabled,
  sweepStuckEncounters,
} = require("../src/services/matchmakingService");
const squadAccess = require("../src/app/squadAccess");
const { Squad } = require("../src/models/Squad");
const { Encounter } = require("../src/models/Encounter");
const User = require("../src/models/User");
const { redlock, redis, subClient } = require("../src/config/redisConfig");
const queueService = require("../src/services/queueService");
const sessionService = require("../src/services/sessionService");
const socketService = require("../src/services/socketService");

const USER_A = "507f1f77bcf86cd799439011";
const USER_B = "507f1f77bcf86cd799439012";

const originalDiscoveryEnv = process.env.STRANGER_DISCOVERY_ENABLED;

// Every test stubs model statics and service functions through `stub`; they
// are all restored after each test.
const restores = [];
const stub = (target, key, value) => {
  const original = target[key];
  restores.push(() => { target[key] = original; });
  target[key] = value;
};

afterEach(() => {
  while (restores.length) restores.pop()();
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

// In-memory squads plus the subset of Squad/Encounter writes the matchmaking
// transitions use, so a test can assert the resulting state.
function squadStore(squads) {
  const byId = new Map(squads.map((squad) => [squad.squadId, squad]));
  const matches = (squad, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "squadId") return value?.$in ? value.$in.includes(squad.squadId) : squad.squadId === value;
    if (value && typeof value === "object" && "$in" in value) return value.$in.includes(squad[key]);
    if (value && typeof value === "object" && "$ne" in value) return squad[key] !== value.$ne;
    return (squad[key] ?? null) === value;
  });
  const apply = (squad, update) => {
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (!key.includes("$")) squad[key] = value;
    }
  };
  return {
    byId,
    updateMany: async (filter, update) => {
      let matchedCount = 0;
      for (const squad of byId.values()) {
        if (!matches(squad, filter)) continue;
        apply(squad, update);
        matchedCount += 1;
      }
      return { matchedCount };
    },
    updateOne: async (filter, update) => {
      const squad = [...byId.values()].find((candidate) => matches(candidate, filter));
      if (!squad) return { matchedCount: 0 };
      apply(squad, update);
      return { matchedCount: 1 };
    },
    findOne: async ({ squadId }) => byId.get(squadId) || null,
    find: async (filter) => [...byId.values()].filter((squad) => matches(squad, filter)),
  };
}

function stubSquads(store) {
  stub(Squad, "updateMany", store.updateMany);
  stub(Squad, "updateOne", store.updateOne);
  stub(Squad, "findOne", store.findOne);
  stub(Squad, "find", store.find);
}

function stubRealtime() {
  const events = [];
  stub(socketService, "emitToSquad", (squadId, event, payload) => { events.push({ squadId, event, payload }); });
  stub(socketService, "closeEncounterRoom", (encounterId) => { events.push({ event: "CLOSE", encounterId }); });
  return events;
}

function stubLock() {
  const lock = { uses: 0 };
  stub(redlock, "using", async (_resources, _duration, routine) => {
    lock.uses += 1;
    return routine({ aborted: false });
  });
  return lock;
}

// Conditional encounter end: wins only while the stored status still matches.
function stubEncounterEnd(statusById) {
  const writes = [];
  stub(Encounter, "findOneAndUpdate", async (filter, update) => {
    writes.push(filter);
    const current = statusById.get(filter.encounterId);
    const allowed = typeof filter.status === "string" ? current === filter.status : current !== filter.status.$ne;
    if (!allowed) return null;
    statusById.set(filter.encounterId, update.$set.status);
    return { encounterId: filter.encounterId, ...update.$set };
  });
  return writes;
}

function stubSafeUsers() {
  const users = [USER_A, USER_B].map((_id) => ({
    _id,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    blockedUserIds: [],
  }));
  stub(User, "find", ({ _id: { $in: ids } }) => {
    const matching = users.filter((user) => ids.map(String).includes(String(user._id)));
    return { select: async () => matching, lean: async () => matching };
  });
}

const squad = (squadId, userId, fields = {}) => ({
  squadId,
  squadName: squadId,
  searchRegion: "global",
  tags: [],
  reputationScore: 100,
  members: [{ memberId: `member_${squadId}`, userId, role: "leader" }],
  async save() {},
  ...fields,
});

test("a late ack ends the expired handoff and frees both squads to idle", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  const store = squadStore([
    squad("sq_a", USER_A, { status: "matched", currentEncounterId: "enc_late" }),
    squad("sq_b", USER_B, { status: "matched", currentEncounterId: "enc_late" }),
  ]);
  stubSquads(store);
  stubEncounterEnd(new Map([["enc_late", "awaiting_ack"]]));
  stub(sessionService, "setSessionField", async () => {});
  stubRealtime();
  const encounter = {
    encounterId: "enc_late",
    status: "awaiting_ack",
    squadAId: "sq_a",
    squadBId: "sq_b",
    expiresAt: new Date(Date.now() - 1_000),
    ackBySquad: new Map([["sq_a", true], ["sq_b", false]]),
    async save() {},
  };

  const result = await ackEncounterForSquad({ encounter, squadId: "sq_b", emitRealtime: false });

  assert.equal(result.error.code, "ENCOUNTER_EXPIRED");
  assert.equal(result.realtime.close, true);
  assert.equal(encounter.status, "ended");
  for (const squadId of ["sq_a", "sq_b"]) {
    assert.equal(store.byId.get(squadId).status, "idle");
    assert.equal(store.byId.get(squadId).currentEncounterId, null);
  }
});

test("matchmaking status never reports an ended encounter as a match", async () => {
  stub(Encounter, "findOne", () => ({
    lean: async () => ({ encounterId: "enc_over", status: "ended", squadAId: "sq_a", squadBId: "sq_b" }),
  }));
  stub(Squad, "findOne", () => assert.fail("an ended encounter must not load the opponent"));
  const stuck = squad("sq_a", USER_A, { status: "matched", currentEncounterId: "enc_over" });

  const status = await getMatchmakingStatus("sq_a", { squad: stuck });

  assert.equal(status.match, null);
  assert.equal(status.interactionBlocked, false);
});

test("the sweeper frees squads stuck on an ended encounter but leaves acked calls alone", async () => {
  const store = squadStore([
    squad("sq_a", USER_A, { status: "matched", currentEncounterId: "enc_ended" }),
    squad("sq_b", USER_B, { status: "matched", currentEncounterId: "enc_ended" }),
    squad("sq_c", USER_A, { status: "in_encounter", currentEncounterId: "enc_raced" }),
    squad("sq_d", USER_B, { status: "in_encounter", currentEncounterId: "enc_raced" }),
  ]);
  stubSquads(store);
  // Mongoose query chain used by the repair scan.
  stub(Squad, "find", (filter) => {
    const result = store.find(filter);
    return { select: () => ({ lean: () => result }) };
  });
  const statuses = new Map([["enc_ended", "ended"], ["enc_raced", "active"]]);
  stubEncounterEnd(statuses);
  const encounters = {
    enc_ended: { encounterId: "enc_ended", status: "ended", squadAId: "sq_a", squadBId: "sq_b" },
    // Expired by its handoff deadline, but an ack activated it before the sweep.
    enc_raced: { encounterId: "enc_raced", status: "awaiting_ack", squadAId: "sq_c", squadBId: "sq_d" },
  };
  stub(Encounter, "find", async (filter) => {
    if (filter.status === "awaiting_ack") return [encounters.enc_raced];
    return filter.encounterId.$in
      .filter((encounterId) => statuses.get(encounterId) === "ended")
      .map((encounterId) => encounters[encounterId]);
  });
  stub(sessionService, "setSessionField", async () => {});
  const events = stubRealtime();
  const lock = stubLock();

  const swept = await sweepStuckEncounters();

  assert.equal(swept, 0);
  assert.equal(lock.uses, 1);
  assert.equal(statuses.get("enc_raced"), "active");
  assert.equal(store.byId.get("sq_c").status, "in_encounter");
  assert.equal(store.byId.get("sq_d").status, "in_encounter");
  assert.equal(store.byId.get("sq_a").status, "idle");
  assert.equal(store.byId.get("sq_b").status, "idle");
  assert.equal(store.byId.get("sq_a").currentEncounterId, null);
  assert.equal(events.some(({ event, payload }) => event === "ENCOUNTER_ENDED" && payload.encounterId === "enc_raced"), false);
  assert.deepEqual(
    events.filter(({ event }) => event === "SQUAD_UPDATED").map(({ squadId }) => squadId).sort(),
    ["sq_a", "sq_b"]
  );
});

test("turning discovery off stops in-flight searches and clears the queue", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "false";
  const store = squadStore([
    squad("sq_a", USER_A, { status: "searching", searchQueuedAt: new Date() }),
    squad("sq_b", USER_B, { status: "in_encounter", currentEncounterId: "enc_live" }),
  ]);
  stubSquads(store);
  stub(Squad, "find", (filter) => {
    const result = store.find(filter);
    return { select: () => ({ lean: () => result }) };
  });
  const removed = [];
  stub(queueService, "getAllQueuedSquads", async () => [{ squadId: "sq_a" }, { squadId: "sq_ghost" }]);
  stub(queueService, "removeFromQueue", async (squadId) => { removed.push(squadId); });
  const events = stubRealtime();
  stubLock();

  assert.equal(await stopSearchesWhileDiscoveryDisabled(), 1);
  assert.equal(store.byId.get("sq_a").status, "idle");
  assert.equal(store.byId.get("sq_a").searchQueuedAt, null);
  assert.equal(store.byId.get("sq_b").status, "in_encounter");
  assert.deepEqual(removed.sort(), ["sq_a", "sq_ghost"]);
  assert.deepEqual(events.map(({ squadId, event }) => [squadId, event]), [["sq_a", "SQUAD_UPDATED"]]);
});

test("stopping searches is a no-op while discovery is enabled", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  stub(Squad, "find", () => assert.fail("enabled discovery must not scan searching squads"));

  assert.equal(await stopSearchesWhileDiscoveryDisabled(), 0);
});

test("the periodic matcher pairs two squads that were left searching", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  const store = squadStore([
    squad("sq_a", USER_A, { status: "searching", searchQueuedAt: new Date(Date.now() - 200_000) }),
    squad("sq_b", USER_B, { status: "searching", searchQueuedAt: new Date(Date.now() - 150_000) }),
  ]);
  stubSquads(store);
  stub(Squad, "find", (filter) => {
    const result = store.find(filter);
    const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => result };
    return chain;
  });
  const queue = [
    { squadId: "sq_a", size: "1", queuedAt: String(Date.now() - 200_000) },
    { squadId: "sq_b", size: "1", queuedAt: String(Date.now() - 150_000) },
  ];
  stub(queueService, "getQueuedSquadsByRegion", async () => queue);
  stub(queueService, "getAllQueuedSquads", async () => queue);
  stub(queueService, "removeFromQueue", async () => {});
  stub(socketService, "getOnlineUserIds", async (ids) => new Set(ids));
  stub(sessionService, "setSessionField", async () => {});
  stubSafeUsers();
  stubRealtime();
  const lock = stubLock();
  const created = [];
  stub(Encounter, "create", async (data) => { created.push(data); return data; });

  assert.equal(await retrySearchingSquads(), 1);
  assert.equal(created.length, 1);
  assert.equal(store.byId.get("sq_a").status, "matched");
  assert.equal(store.byId.get("sq_b").status, "matched");
  // The partner matched in this tick is not retried on its own.
  assert.equal(lock.uses, 1);
});

test("the periodic matcher does nothing for a lone searcher", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  stub(Squad, "find", () => {
    const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => [{ squadId: "sq_a", status: "searching" }] };
    return chain;
  });
  stub(redlock, "using", () => assert.fail("a lone searcher needs no matching attempt"));

  assert.equal(await retrySearchingSquads(), 0);
});

test("skip never requeues a squad that already ended the call", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  // sq_a pressed End first: it is idle and no longer on this encounter.
  const store = squadStore([
    squad("sq_a", USER_A, { status: "idle", currentEncounterId: null }),
    squad("sq_b", USER_B, { status: "in_encounter", currentEncounterId: "enc_race" }),
  ]);
  stubSquads(store);
  stubEncounterEnd(new Map([["enc_race", "active"]]));
  const queued = [];
  stub(queueService, "addToQueue", async (squadId) => { queued.push(squadId); });
  stub(queueService, "removeFromQueue", async () => {});
  stub(sessionService, "setSessionField", async () => {});
  stubSafeUsers();
  const events = stubRealtime();
  const encounter = { encounterId: "enc_race", status: "active", squadAId: "sq_a", squadBId: "sq_b" };

  const requeued = await endEncounterAndRequeue({ encounter, triggeringSquadId: "sq_b", matchImmediately: false });

  assert.equal(requeued.squadId, "sq_b");
  assert.deepEqual(queued, ["sq_b"]);
  assert.equal(store.byId.get("sq_a").status, "idle");
  assert.equal(
    events.find(({ squadId, event }) => squadId === "sq_a" && event === "ENCOUNTER_ENDED").payload.queueStatus,
    "idle"
  );
});

test("skip does nothing once another path has ended the encounter", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  const store = squadStore([
    squad("sq_a", USER_A, { status: "in_encounter", currentEncounterId: "enc_done" }),
    squad("sq_b", USER_B, { status: "in_encounter", currentEncounterId: "enc_done" }),
  ]);
  stubSquads(store);
  stubEncounterEnd(new Map([["enc_done", "ended"]]));
  stub(queueService, "addToQueue", async () => assert.fail("a lost end must not requeue"));
  const events = stubRealtime();
  // The in-memory copy was loaded before the other ender won.
  const encounter = { encounterId: "enc_done", status: "active", squadAId: "sq_a", squadBId: "sq_b" };

  assert.equal(await endEncounterAndRequeue({ encounter, triggeringSquadId: "sq_a", matchImmediately: false }), null);
  assert.equal(store.byId.get("sq_a").status, "in_encounter");
  assert.deepEqual(events, []);
});

test("skipping an expired handoff requeues only squads that acked", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  const store = squadStore([
    squad("sq_a", USER_A, { status: "matched", currentEncounterId: "enc_timeout" }),
    squad("sq_b", USER_B, { status: "matched", currentEncounterId: "enc_timeout" }),
  ]);
  stubSquads(store);
  stubEncounterEnd(new Map([["enc_timeout", "awaiting_ack"]]));
  const queued = [];
  stub(queueService, "addToQueue", async (squadId) => { queued.push(squadId); });
  stub(queueService, "removeFromQueue", async () => {});
  stub(sessionService, "setSessionField", async () => {});
  stubSafeUsers();
  const events = stubRealtime();
  const encounter = {
    encounterId: "enc_timeout",
    status: "awaiting_ack",
    squadAId: "sq_a",
    squadBId: "sq_b",
    expiresAt: new Date(Date.now() - 1_000),
    ackBySquad: new Map([["sq_a", true], ["sq_b", false]]),
  };

  // sq_a acked and its leader skips at the deadline; sq_b never acked.
  await endEncounterAndRequeue({ encounter, triggeringSquadId: "sq_a", matchImmediately: false });
  assert.deepEqual(queued, ["sq_a"]);
  assert.equal(store.byId.get("sq_a").status, "searching");
  assert.equal(store.byId.get("sq_b").status, "idle");
  assert.equal(store.byId.get("sq_b").currentEncounterId, null);
  assert.equal(
    events.find(({ squadId, event }) => squadId === "sq_b" && event === "ENCOUNTER_ENDED").payload.queueStatus,
    "idle"
  );
});

test("an End that lost the race to a skip still takes its squad out of the search", async () => {
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  // The skip already ended enc_x and requeued both squads.
  const store = squadStore([
    squad("sq_a", USER_A, { status: "searching", currentEncounterId: null, lastEncounterId: "enc_x" }),
    squad("sq_b", USER_B, { status: "searching", currentEncounterId: null, lastEncounterId: "enc_x" }),
  ]);
  stubSquads(store);
  stubEncounterEnd(new Map([["enc_x", "ended"]]));
  const removed = [];
  stub(queueService, "removeFromQueue", async (squadId) => { removed.push(squadId); });
  stub(queueService, "addToQueue", async () => assert.fail("the opponent is already queued"));
  stub(sessionService, "clearMemberSession", async () => {});
  stubRealtime();
  const lock = stubLock();
  const encounter = { encounterId: "enc_x", status: "active", squadAId: "sq_a", squadBId: "sq_b" };

  await endEncounterAsymmetric({ encounter, disconnectingSquadId: "sq_a" });

  assert.equal(lock.uses, 1);
  assert.equal(store.byId.get("sq_a").status, "idle");
  assert.deepEqual(removed, ["sq_a"]);
  assert.equal(store.byId.get("sq_b").status, "searching");
});

test("skip frees a squad left pointing at an already-ended encounter", async () => {
  const controllerPath = require.resolve("../src/controllers/matchmakingController");
  const servicePath = require.resolve("../src/services/matchmakingService");
  const originalServiceModule = require.cache[servicePath];
  const released = [];
  stubLock();
  stub(squadAccess, "getRequesterIdentity", () => ({ userId: "leader" }));
  stub(squadAccess, "getSquadAccessContext", async () => ({
    isLeader: true,
    squad: { squadId: "squad_a", status: "matched", currentEncounterId: "encounter_1" },
  }));
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      getEncounterById: async () => ({
        encounterId: "encounter_1",
        status: "ended",
        squadAId: "squad_a",
        squadBId: "squad_b",
      }),
      endEncounterAndRequeue: async () => assert.fail("an ended encounter must not be requeued"),
      releaseSquadsFromEncounter: async (encounter) => { released.push(encounter.encounterId); },
      tryMatchmakeForSquad: async () => null,
    },
  };
  delete require.cache[controllerPath];
  restores.push(() => {
    if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
    else delete require.cache[servicePath];
    delete require.cache[controllerPath];
  });

  const { skipEncounterHandler } = require(controllerPath);
  const res = response();
  await skipEncounterHandler({
    body: { squadId: "squad_a", encounterId: "encounter_1" },
    user: { userId: "leader" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.queueStatus, "idle");
  assert.deepEqual(released, ["encounter_1"]);
});
