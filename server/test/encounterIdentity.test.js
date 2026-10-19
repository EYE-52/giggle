const assert = require("node:assert/strict");
const test = require("node:test");

const {
  opaqueEncounterId,
  isOpaqueEncounterId,
  encounterRtcUid,
  fallbackEncounterAlias,
  normalizeEncounterAlias,
  encounterAnonymity,
  publicEncounterIdentity,
  projectEncounterRosters,
  resolveEncounterOpaqueIds,
} = require("../src/services/encounterIdentityService");
const { normalizeProfilePatch } = require("../src/controllers/authController");

const ALICE = "507f1f77bcf86cd799439011";
const BRUNO = "507f1f77bcf86cd799439022";
const BEN = "507f1f77bcf86cd799439044";
const ENC = "enc_1728000000000_abc123def4";

const member = (memberId, userId, displayName, role = "member") => ({ memberId, userId, displayName, role });

test("opaque encounter ids are stable per encounter, unlinkable across encounters, and not the account id", () => {
  const first = opaqueEncounterId(ENC, BRUNO);
  assert.equal(first, opaqueEncounterId(ENC, BRUNO));
  assert.equal(first, opaqueEncounterId(ENC, BRUNO.toUpperCase()), "case-insensitive account ids map to one id");
  assert.notEqual(first, opaqueEncounterId("enc_other", BRUNO));
  assert.notEqual(first, opaqueEncounterId(ENC, BEN));
  assert.ok(isOpaqueEncounterId(first));
  assert.ok(!first.includes(BRUNO));
  assert.equal(isOpaqueEncounterId(BRUNO), false);
  assert.equal(isOpaqueEncounterId("anon_xyz"), false);
});

test("encounter rtc uids are keyed, stable and in the Agora uid range", () => {
  const uid = encounterRtcUid(ENC, BRUNO);
  assert.equal(uid, encounterRtcUid(ENC, BRUNO));
  assert.notEqual(uid, encounterRtcUid(ENC, BEN));
  assert.ok(Number.isInteger(uid) && uid >= 1 && uid <= 0xffffffff);
  // Not the old public string hash anyone could recompute from an account id.
  const { hashStringToUid } = require("../src/services/agoraTokenService");
  assert.notEqual(uid, hashStringToUid(`${ENC}:${BRUNO}`));
});

test("fallback alias is a stable Guest number per user", () => {
  assert.match(fallbackEncounterAlias(BRUNO), /^Guest \d{4}$/);
  assert.equal(fallbackEncounterAlias(BRUNO), fallbackEncounterAlias(BRUNO));
});

test("alias validation trims, bounds length, limits the charset and blocks slurs", () => {
  assert.deepEqual(normalizeEncounterAlias("  Night   Owl  "), { value: "Night Owl" });
  assert.deepEqual(normalizeEncounterAlias("Zoë-2"), { value: "Zoë-2" });
  assert.deepEqual(normalizeEncounterAlias(""), { value: "" });
  assert.deepEqual(normalizeEncounterAlias(null), { value: "" });
  assert.ok(normalizeEncounterAlias("a").error);
  assert.ok(normalizeEncounterAlias("x".repeat(25)).error);
  assert.ok(normalizeEncounterAlias("<script>").error);
  assert.ok(normalizeEncounterAlias("me@mail.com").error);
  assert.ok(normalizeEncounterAlias("-dash").error);
  assert.ok(normalizeEncounterAlias(42).error);
});

test("profile patch accepts and validates the anonymity settings", () => {
  assert.deepEqual(
    normalizeProfilePatch({ anonymousInEncounters: true, encounterAlias: " Quiet Fox " }),
    { patch: { anonymousInEncounters: true, encounterAlias: "Quiet Fox" }, unset: [] }
  );
  assert.deepEqual(normalizeProfilePatch({ encounterAlias: null }), { patch: { encounterAlias: "" }, unset: [] });
  assert.match(normalizeProfilePatch({ anonymousInEncounters: "yes" }).error, /true or false/);
  assert.match(normalizeProfilePatch({ encounterAlias: "x" }).error, /2 to 24/);
  assert.match(normalizeProfilePatch({ encounterAlias: "{evil}" }).error, /letters, numbers/);
});

test("anonymity falls back to a Guest alias when the alias is empty", () => {
  assert.deepEqual(encounterAnonymity({ anonymousInEncounters: false, encounterAlias: "Fox" }, BRUNO), { anonymous: false, alias: null });
  assert.deepEqual(encounterAnonymity({ anonymousInEncounters: true, encounterAlias: "Fox" }, BRUNO), { anonymous: true, alias: "Fox" });
  assert.deepEqual(
    encounterAnonymity({ anonymousInEncounters: true, encounterAlias: "" }, BRUNO),
    { anonymous: true, alias: fallbackEncounterAlias(BRUNO) }
  );
});

test("publicEncounterIdentity shows the real identity to the own squad only", () => {
  const bruno = member("m-b1", BRUNO, "Bruno Real", "leader");
  const user = { _id: BRUNO, avatar: "teal-bot", anonymousInEncounters: true, encounterAlias: "Quiet Fox" };

  const own = publicEncounterIdentity({ viewerSquadId: "sq-B", memberSquadId: "sq-B", member: bruno, user, encounterId: ENC });
  assert.equal(own.userId, BRUNO);
  assert.equal(own.memberId, "m-b1");
  assert.equal(own.displayName, "Bruno Real");
  assert.equal(own.avatar, "teal-bot");
  assert.equal(own.anonymous, true);
  assert.equal(own.alias, "Quiet Fox");

  const other = publicEncounterIdentity({ viewerSquadId: "sq-A", memberSquadId: "sq-B", member: bruno, user, encounterId: ENC });
  const opaque = opaqueEncounterId(ENC, BRUNO);
  assert.deepEqual(other, {
    memberId: opaque,
    userId: opaque,
    displayName: "Quiet Fox",
    role: "leader",
    avatar: null,
    callId: opaque,
    uid: encounterRtcUid(ENC, BRUNO),
    anonymous: true,
  });
  const serialized = JSON.stringify(other);
  for (const secret of [BRUNO, "Bruno Real", "teal-bot", "m-b1"]) assert.ok(!serialized.includes(secret), secret);
  // Own and other views agree on the call id and the RTC uid, so tiles line up.
  assert.equal(other.callId, own.callId);
  assert.equal(other.uid, own.uid);
});

test("publicEncounterIdentity keeps non-anonymous opponents as today and fails closed without a user record", () => {
  const ben = member("m-b2", BEN, "Ben");
  const visible = publicEncounterIdentity({
    viewerSquadId: "sq-A", memberSquadId: "sq-B", member: ben, user: { _id: BEN, avatar: "coral-star" }, encounterId: ENC,
  });
  assert.equal(visible.userId, BEN);
  assert.equal(visible.displayName, "Ben");
  assert.equal(visible.avatar, "coral-star");
  assert.equal(visible.anonymous, false);

  const unknown = publicEncounterIdentity({ viewerSquadId: "sq-A", memberSquadId: "sq-B", member: ben, user: undefined, encounterId: ENC });
  assert.equal(unknown.anonymous, true);
  assert.equal(unknown.displayName, fallbackEncounterAlias(BEN));
  assert.ok(!JSON.stringify(unknown).includes(BEN));
});

test("projectEncounterRosters projects both rosters for one viewer squad", () => {
  const encounter = { encounterId: ENC, squadAId: "sq-A", squadBId: "sq-B" };
  const squadA = { squadId: "sq-A", members: [member("m-a1", ALICE, "Ann", "leader")] };
  const squadB = { squadId: "sq-B", members: [member("m-b1", BRUNO, "Bruno")] };
  const users = new Map([
    [ALICE, { _id: ALICE, anonymousInEncounters: true, encounterAlias: "Owl" }],
    [BRUNO, { _id: BRUNO, anonymousInEncounters: true, encounterAlias: "Fox" }],
  ]);
  const fromA = projectEncounterRosters({ encounter, squadA, squadB, viewerSquadId: "sq-A", users });
  assert.equal(fromA.squadAMembers[0].displayName, "Ann");
  assert.equal(fromA.squadBMembers[0].displayName, "Fox");
  const fromB = projectEncounterRosters({ encounter, squadA, squadB, viewerSquadId: "sq-B", users });
  assert.equal(fromB.squadAMembers[0].displayName, "Owl");
  assert.equal(fromB.squadBMembers[0].displayName, "Bruno");
});

function resolverDeps({ users = [] } = {}) {
  const encounter = { encounterId: ENC, squadAId: "sq-A", squadBId: "sq-B" };
  const squads = {
    "sq-A": { squadId: "sq-A", members: [member("m-a1", ALICE, "Ann")] },
    "sq-B": { squadId: "sq-B", members: [member("m-b1", BRUNO, "Bruno"), member("m-b2", BEN, "Ben")] },
  };
  return {
    Encounter: { findOne: async ({ encounterId }) => (encounterId === ENC ? encounter : null) },
    Squad: { findOne: async ({ squadId }) => squads[squadId] || null },
    User: { find: () => ({ lean: async () => users }) },
  };
}

test("resolveEncounterOpaqueIds maps opaque ids back only for the requester's opponents", async () => {
  const deps = resolverDeps({
    users: [{ _id: BRUNO, anonymousInEncounters: true, encounterAlias: "Fox" }, { _id: BEN }],
  });
  const brunoId = opaqueEncounterId(ENC, BRUNO);
  const result = await resolveEncounterOpaqueIds({ ids: [brunoId, BEN], encounterId: ENC, requesterId: ALICE, ...deps });
  assert.deepEqual(result.userIds, [BRUNO, BEN]);
  assert.deepEqual(result.anonymousTargets, [{ userId: BRUNO, handle: brunoId, alias: "Fox" }]);

  // An outsider cannot resolve anything.
  assert.deepEqual(
    await resolveEncounterOpaqueIds({ ids: [brunoId], encounterId: ENC, requesterId: "507f1f77bcf86cd799439099", ...deps }),
    { error: "NOT_FOUND" }
  );
  // Opaque ids from another encounter or the requester's own squad do not resolve.
  assert.deepEqual(
    await resolveEncounterOpaqueIds({ ids: [opaqueEncounterId("enc_other", BRUNO)], encounterId: ENC, requesterId: ALICE, ...deps }),
    { error: "NOT_FOUND" }
  );
  assert.deepEqual(
    await resolveEncounterOpaqueIds({ ids: [opaqueEncounterId(ENC, ALICE)], encounterId: ENC, requesterId: BRUNO, ...deps }),
    { userIds: [ALICE], anonymousTargets: [] },
    "Bruno's opponents are squad A, so Alice's opaque id resolves for him"
  );
  assert.deepEqual(
    await resolveEncounterOpaqueIds({ ids: [brunoId], encounterId: ENC, requesterId: BEN, ...deps }),
    { error: "NOT_FOUND" },
    "a squadmate's opaque id is never resolved"
  );
  assert.deepEqual(
    await resolveEncounterOpaqueIds({ ids: [brunoId], requesterId: ALICE, ...deps }),
    { error: "ENCOUNTER_REQUIRED" }
  );
});
