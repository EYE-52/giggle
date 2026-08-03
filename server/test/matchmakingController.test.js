const assert = require("node:assert/strict");
const test = require("node:test");

const squadAccess = require("../src/app/squadAccess");
const { Squad } = require("../src/models/Squad");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function runSkip(requeueResult) {
  const originals = {
    getRequesterIdentity: squadAccess.getRequesterIdentity,
    getSquadAccessContext: squadAccess.getSquadAccessContext,
  };
  const controllerPath = require.resolve("../src/controllers/matchmakingController");
  const servicePath = require.resolve("../src/services/matchmakingService");
  const originalServiceModule = require.cache[servicePath];

  squadAccess.getRequesterIdentity = () => ({ userId: "leader" });
  squadAccess.getSquadAccessContext = async () => ({ isLeader: true });
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      getMatchmakingStatus: async () => null,
      getEncounterById: async () => ({
        encounterId: "encounter_1",
        squadAId: "squad_a",
        squadBId: "squad_b",
      }),
      ackEncounterForSquad: async () => ({}),
      endEncounterAndRequeue: async () => requeueResult,
    },
  };
  delete require.cache[controllerPath];

  try {
    const { skipEncounterHandler } = require(controllerPath);
    const res = createResponse();
    await skipEncounterHandler({
      body: { squadId: "squad_a", encounterId: "encounter_1" },
      user: { userId: "leader" },
    }, res);
    return res;
  } finally {
    Object.assign(squadAccess, {
      getRequesterIdentity: originals.getRequesterIdentity,
      getSquadAccessContext: originals.getSquadAccessContext,
    });
    if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
    else delete require.cache[servicePath];
    delete require.cache[controllerPath];
  }
}

test("skip reports idle when the triggering squad is rejected from requeue", async () => {
  const res = await runSkip(null);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.queueStatus, "idle");
});

test("skip reports idle when only the other squad is requeued", async () => {
  const res = await runSkip({ squadId: "squad_b" });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.queueStatus, "idle");
});

test("skip reports searching when the triggering squad is requeued", async () => {
  const res = await runSkip({ squadId: "squad_a" });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.queueStatus, "searching");
});

async function loadSafetyController({ interactionBlocked = false } = {}) {
  const controllerPath = require.resolve("../src/controllers/matchmakingController");
  const servicePath = require.resolve("../src/services/matchmakingService");
  const originalServiceModule = require.cache[servicePath];
  const originalFindOne = Squad.findOne;
  let acknowledgements = 0;
  const encounter = {
    encounterId: "encounter_1",
    squadAId: "squad_a",
    squadBId: "squad_b",
    status: "awaiting_ack",
    ackBySquad: new Map(),
  };
  const squadA = { squadId: "squad_a", squadName: "A", members: [{ memberId: "member_a", userId: "user_a" }] };
  const squadB = { squadId: "squad_b", squadName: "B", members: [{ memberId: "member_b", userId: "user_b" }] };

  Squad.findOne = async ({ squadId }) => squadId === "squad_a" ? squadA : squadB;
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      getMatchmakingStatus: async () => ({
        squad: { ...squadA, status: "matched" },
        queue: null,
        match: { encounterId: encounter.encounterId },
        interactionBlocked,
      }),
      getEncounterById: async () => encounter,
      getEncounterRosterContext: async () => ({
        allowed: !interactionBlocked,
        squadA,
        squadB,
      }),
      ackEncounterForSquad: async () => {
        acknowledgements += 1;
        return { acknowledged: true, allAcked: false };
      },
      endEncounterAndRequeue: async () => null,
    },
  };
  delete require.cache[controllerPath];

  return {
    controller: require(controllerPath),
    acknowledgements: () => acknowledgements,
    restore() {
      Squad.findOne = originalFindOne;
      if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
      else delete require.cache[servicePath];
      delete require.cache[controllerPath];
    },
  };
}

test("matchmaking status denies a blocked legacy encounter", async () => {
  const fixture = await loadSafetyController({ interactionBlocked: true });
  try {
    const res = createResponse();
    await fixture.controller.getMatchmakingStatusHandler({ params: { squadId: "squad_a" } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
  } finally {
    fixture.restore();
  }
});

test("encounter handoff does not expose opponent identities for a blocked pair", async () => {
  const fixture = await loadSafetyController({ interactionBlocked: true });
  try {
    const res = createResponse();
    await fixture.controller.getEncounterHandoffHandler({
      params: { encounterId: "encounter_1" },
      user: { userId: "user_a" },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
    assert.equal(JSON.stringify(res.body).includes("user_b"), false);
  } finally {
    fixture.restore();
  }
});

test("encounter acknowledgement revalidates blocks before activation", async () => {
  const fixture = await loadSafetyController({ interactionBlocked: true });
  try {
    const res = createResponse();
    await fixture.controller.ackEncounterJoinHandler({
      params: { encounterId: "encounter_1" },
      body: { squadId: "squad_a" },
      user: { userId: "user_a" },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
    assert.equal(fixture.acknowledgements(), 0);
  } finally {
    fixture.restore();
  }
});
