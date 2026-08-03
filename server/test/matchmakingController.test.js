const assert = require("node:assert/strict");
const test = require("node:test");

const squadAccess = require("../src/app/squadAccess");

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
