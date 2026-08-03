const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const modelPath = path.join(__dirname, "../src/models/SafetyReport.js");
const modelExists = existsSync(modelPath);
const SafetyReport = modelExists ? require(modelPath) : null;
const socketService = require("../src/services/socketService");

test("SafetyReport stores only the bounded review record with an idempotency index", () => {
  assert.equal(modelExists, true);
  if (!SafetyReport) return;

  const { paths } = SafetyReport.schema;
  assert.deepEqual(paths.category.enumValues, ["harassment", "hate", "sexual", "minor_safety", "spam", "other"]);
  assert.deepEqual(paths.status.enumValues, ["open", "reviewing", "actioned", "dismissed"]);
  assert.equal(paths.details.options.maxlength, 500);
  assert.equal(paths.actionNote.options.maxlength, 500);
  assert.ok(paths.createdAt);
  assert.ok(paths.updatedAt);
  assert.equal(paths.rawPayload, undefined);

  const uniqueIndex = SafetyReport.schema.indexes().find(([fields, options]) =>
    fields.reporterUserId === 1 &&
    fields.encounterId === 1 &&
    fields.targetSquadId === 1 &&
    options.unique === true
  );
  assert.ok(uniqueIndex);
});

function fakeScope() {
  const squads = [
    { squadId: "sq_a", members: [{ userId: "user_a" }] },
    {
      squadId: "sq_b",
      members: [{ userId: "user_b" }, { userId: "user_c" }, { userId: "user_b" }],
      reputationScore: 100,
    },
  ];
  return {
    squads,
    Squad: {
      async findOne(query) {
        if (query.squadId && query["members.userId"]) {
          return squads.find((squad) =>
            squad.squadId === query.squadId &&
            squad.members.some((member) => member.userId === query["members.userId"])
          ) || null;
        }
        return squads.find((squad) => squad.squadId === query.squadId) || null;
      },
    },
    Encounter: {
      async findOne(query) {
        return query.encounterId === "enc_1"
          ? { encounterId: "enc_1", squadAId: "sq_a", squadBId: "sq_b", status: "active" }
          : null;
      },
    },
  };
}

test("persistSquadReport derives targets from the live opponent roster and is idempotent", async () => {
  assert.equal(typeof socketService.persistSquadReport, "function");
  if (typeof socketService.persistSquadReport !== "function") return;

  const { Squad, Encounter, squads } = fakeScope();
  const records = new Map();
  let writes = 0;
  let inserted;
  const ReportModel = {
    async findOneAndUpdate(filter, update, options) {
      assert.deepEqual(options, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
      const key = `${filter.reporterUserId}:${filter.encounterId}:${filter.targetSquadId}`;
      if (!records.has(key)) {
        writes += 1;
        inserted = update.$setOnInsert;
        records.set(key, { _id: "report_1", status: "open", ...inserted });
      }
      return records.get(key);
    },
  };
  const input = {
    payload: {
      encounterId: "enc_1",
      squadId: "sq_a",
      reportedSquadId: "sq_b",
      targetUserIds: ["client_supplied_target"],
      category: "harassment",
      details: "  repeated   insults  ",
    },
    userId: "user_a",
    Squad,
    Encounter,
    ReportModel,
  };

  const first = await socketService.persistSquadReport(input);
  const retry = await socketService.persistSquadReport(input);

  assert.deepEqual(first, { ok: true, reportId: "report_1", status: "open" });
  assert.deepEqual(retry, first);
  assert.equal(writes, 1);
  assert.deepEqual(inserted.targetUserIds, ["user_b", "user_c"]);
  assert.equal(inserted.reporterUserId, "user_a");
  assert.equal(inserted.reporterSquadId, "sq_a");
  assert.equal(inserted.details, "repeated insults");
  assert.equal(squads[1].reputationScore, 100);
});

test("persistSquadReport rejects invalid scope and unbounded report input before writing", async () => {
  assert.equal(typeof socketService.persistSquadReport, "function");
  if (typeof socketService.persistSquadReport !== "function") return;

  const { Squad, Encounter } = fakeScope();
  let writes = 0;
  const ReportModel = { async findOneAndUpdate() { writes += 1; } };
  const base = { encounterId: "enc_1", squadId: "sq_a", reportedSquadId: "sq_b" };

  for (const payload of [
    null,
    [],
    { ...base, category: "unknown" },
    { ...base, category: "other", details: "x".repeat(501) },
    { ...base, category: "other", details: { raw: true } },
    { ...base, reportedSquadId: "sq_a", category: "other" },
  ]) {
    assert.deepEqual(
      await socketService.persistSquadReport({ payload, userId: "user_a", Squad, Encounter, ReportModel }),
      { ok: false, error: "Report unavailable." }
    );
  }
  assert.equal(writes, 0);
});
