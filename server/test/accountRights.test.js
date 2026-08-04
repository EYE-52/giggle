const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ACCOUNT_CONTROLLER_PATH = path.join(__dirname, "../src/controllers/accountController.js");
const ACCOUNT_DELETION_PATH = path.join(__dirname, "../src/services/accountDeletionService.js");
const USER_ID = "507f1f77bcf86cd799439011";
const FRIEND_ID = "507f1f77bcf86cd799439012";
const BLOCKED_ID = "507f1f77bcf86cd799439013";
const REFERRER_ID = "507f1f77bcf86cd799439014";

test("account export maps identity data explicitly without internal or third-party private fields", async () => {
  assert.equal(existsSync(ACCOUNT_CONTROLLER_PATH), true, "account controller must exist");
  const { buildAccountExport } = require(ACCOUNT_CONTROLLER_PATH);
  const calls = [];
  const exported = await buildAccountExport(USER_ID, {
    now: () => new Date("2026-08-04T10:00:00.000Z"),
    User: {
      findById: async (_id, projection) => {
        calls.push(["user", projection]);
        return {
          _id: USER_ID,
          email: "member@example.com",
          name: "Member",
          image: "avatar-1",
          birthDate: new Date("2000-02-03T00:00:00.000Z"),
          ageConfirmed: true,
          isAdult: true,
          ageVerified: true,
          ageVerification: {
            provider: "yoti",
            status: "verified",
            method: "AGE_ESTIMATION",
            threshold: 18,
            policyVersion: "adult-v1",
            requestedAt: new Date("2026-08-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-08-01T00:01:00.000Z"),
            sessionId: "raw-session-secret",
            referenceId: "raw-reference-secret",
            evidenceId: "raw-evidence-secret",
            providerPayload: "raw-provider-secret",
          },
          gender: "nonbinary",
          languages: ["English"],
          country: "IN",
          vibes: ["Gaming"],
          friends: [FRIEND_ID],
          blockedUserIds: [BLOCKED_ID],
          isApproved: true,
          isPremium: false,
          premiumExpiresAt: null,
          isSuspended: false,
          isShadowBanned: false,
          deletionStatus: "active",
          referralCode: "GIGGLE-1",
          referredBy: REFERRER_ID,
          referralCount: 2,
          tokens: 30,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-08-04T00:00:00.000Z"),
          jwt: "jwt-secret",
          __v: 9,
        };
      },
      find: async (_filter, projection) => {
        calls.push(["contacts", projection]);
        return [
          { _id: FRIEND_ID, name: "Friend", image: "friend-avatar", email: "friend-private@example.com", gender: "female" },
          { _id: BLOCKED_ID, name: "Blocked", image: null, email: "blocked-private@example.com", country: "US" },
        ];
      },
    },
    Squad: {
      find: async (_filter, projection) => {
        calls.push(["squads", projection]);
        return [{
          _id: "mongo-squad-id",
          squadId: "sq_1",
          squadCode: "ABC-123",
          squadName: "Night Owls",
          status: "idle",
          visibility: "private",
          joinPolicy: "invite",
          tags: ["Gaming"],
          coverImage: null,
          members: [
            { userId: USER_ID, displayName: "Member", role: "leader", joinedAt: new Date("2026-07-01T00:00:00.000Z"), providerAccountId: "provider-secret", ready: true },
            { userId: FRIEND_ID, displayName: "Friend", role: "member", joinedAt: new Date("2026-07-02T00:00:00.000Z"), gender: "female" },
          ],
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          opponentSquadId: "internal-opponent",
          __v: 4,
        }];
      },
    },
    Notification: {
      find: async (_filter, projection) => {
        calls.push(["notifications", projection]);
        return [{
          _id: "notification-1",
          type: "info",
          title: "Hello",
          body: "Welcome",
          fromUserId: FRIEND_ID,
          fromName: "Friend",
          squadId: "sq_1",
          squadCode: "ABC-123",
          squadName: "Night Owls",
          read: false,
          createdAt: new Date("2026-08-03T00:00:00.000Z"),
          internalDeliveryToken: "notification-secret",
        }];
      },
    },
    SafetyReport: {
      find: async (_filter, projection) => {
        calls.push(["reports", projection]);
        return [{
          _id: "report-1",
          reporterSquadId: "sq_1",
          targetSquadId: "sq_2",
          targetUserIds: [BLOCKED_ID],
          encounterId: "enc_1",
          category: "harassment",
          details: "Abusive chat",
          status: "open",
          createdAt: new Date("2026-08-03T00:00:00.000Z"),
          updatedAt: new Date("2026-08-03T00:00:00.000Z"),
          reviewedBy: "admin-private",
          actionNote: "internal-moderation-note",
          __v: 3,
        }];
      },
    },
  });

  assert.deepEqual(Object.keys(exported), [
    "generatedAt",
    "account",
    "ageAssurance",
    "profile",
    "friends",
    "blocks",
    "squads",
    "notifications",
    "safetyReports",
    "walletAndReferral",
  ]);
  assert.equal(exported.generatedAt, "2026-08-04T10:00:00.000Z");
  assert.equal(exported.ageAssurance.birthDate, "2000-02-03");
  assert.deepEqual(exported.friends, [{ userId: FRIEND_ID, name: "Friend", image: "friend-avatar" }]);
  assert.deepEqual(exported.blocks, [{ userId: BLOCKED_ID, name: "Blocked", image: null }]);
  assert.deepEqual(Object.keys(exported.squads[0]), [
    "squadId", "squadCode", "squadName", "status", "visibility", "joinPolicy", "tags", "coverImage", "members", "createdAt",
  ]);
  assert.deepEqual(Object.keys(exported.squads[0].members[0]), ["userId", "displayName", "role", "joinedAt"]);
  assert.deepEqual(Object.keys(exported.safetyReports[0]), [
    "id", "reporterSquadId", "targetSquadId", "targetUserIds", "encounterId", "category", "details", "status", "createdAt", "updatedAt",
  ]);
  assert.equal(calls.every(([, projection]) => typeof projection === "string" && projection.length > 0), true);

  const serialized = JSON.stringify(exported);
  for (const forbidden of [
    "raw-session-secret",
    "raw-reference-secret",
    "raw-evidence-secret",
    "raw-provider-secret",
    "friend-private@example.com",
    "blocked-private@example.com",
    "provider-secret",
    "notification-secret",
    "admin-private",
    "internal-moderation-note",
    "jwt-secret",
    "__v",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `export leaked ${forbidden}`);
  }
});

function createDeletionDependencies(failStage = "") {
  const events = [];
  let deleted = false;
  let activeFailure = failStage;
  let userUpdateCalls = 0;
  let reportUpdateCalls = 0;
  const fail = (stage) => {
    events.push(stage);
    if (activeFailure === stage) throw new Error(`${stage} failed`);
  };
  const pendingUser = { _id: USER_ID, deletionStatus: "pending", referredBy: REFERRER_ID };
  const deps = {
    now: () => new Date("2026-08-04T11:00:00.000Z"),
    User: {
      findOneAndUpdate: async (_filter, update) => {
        events.push("stage");
        assert.deepEqual(update, { $set: {
          deletionStatus: "pending",
          deletionRequestedAt: new Date("2026-08-04T11:00:00.000Z"),
          ageVerified: false,
        } });
        return pendingUser;
      },
      findById: async () => deleted ? null : pendingUser,
      updateMany: async () => {
        userUpdateCalls += 1;
        fail(userUpdateCalls === 1 ? "user-graph" : "referral-links");
      },
      countDocuments: async () => { fail("referral-count"); return 4; },
      updateOne: async (_filter, update) => {
        fail("referrer-update");
        assert.deepEqual(update, { $set: { referralCount: 4 } });
      },
      deleteOne: async () => {
        fail("user-delete");
        deleted = true;
        return { deletedCount: 1 };
      },
      find: async () => [],
    },
    Squad: {
      updateMany: async () => fail("squad-pending"),
      find: async () => {
        fail("squad-memberships");
        return [{ squadId: "sq_1", members: [{ userId: USER_ID, memberId: "member-1" }] }];
      },
    },
    removeSquadMember: async () => fail("member-removal"),
    Notification: { deleteMany: async () => fail("notifications") },
    SafetyReport: {
      updateMany: async () => {
        reportUpdateCalls += 1;
        fail(reportUpdateCalls % 2 === 1 ? "reporter-pseudonym" : "report-target-removal");
      },
    },
    redlock: {
      using: async (resources, _duration, routine) => {
        events.push("lock");
        assert.deepEqual(resources, [`lock:account-delete:${USER_ID}`]);
        return routine({ aborted: false });
      },
    },
    disconnectUserSockets: () => fail("disconnect"),
    logger: { error() {} },
  };
  return {
    deps,
    events,
    clearFailure() { activeFailure = ""; },
    resetCounters() { userUpdateCalls = 0; reportUpdateCalls = 0; },
    wasDeleted() { return deleted; },
  };
}

test("account deletion stages access revocation before cleanup and is safe to repeat", async () => {
  assert.equal(existsSync(ACCOUNT_DELETION_PATH), true, "account deletion service must exist");
  const { requestAccountDeletion } = require(ACCOUNT_DELETION_PATH);
  const state = createDeletionDependencies();

  assert.deepEqual(await requestAccountDeletion(USER_ID, state.deps), { status: "deleted" });
  assert.equal(state.events[0], "stage");
  assert.equal(state.events[1], "disconnect");
  assert.equal(state.wasDeleted(), true);
  assert.deepEqual(await requestAccountDeletion(USER_ID, state.deps), { status: "deleted" });
});

test("account deletion canonicalizes identity and lock keys", async () => {
  const { requestAccountDeletion } = require(ACCOUNT_DELETION_PATH);
  const state = createDeletionDependencies();

  assert.deepEqual(await requestAccountDeletion(USER_ID.toUpperCase(), state.deps), { status: "deleted" });
  assert.equal(state.wasDeleted(), true);
});

test("pending cleanup resumes after every stage failure and deletes the User last", async () => {
  assert.equal(existsSync(ACCOUNT_DELETION_PATH), true, "account deletion service must exist");
  const { resumeAccountDeletion } = require(ACCOUNT_DELETION_PATH);
  const stages = [
    "disconnect",
    "user-graph",
    "referral-links",
    "referral-count",
    "referrer-update",
    "squad-pending",
    "squad-memberships",
    "member-removal",
    "notifications",
    "reporter-pseudonym",
    "report-target-removal",
    "user-delete",
  ];

  for (const stage of stages) {
    const state = createDeletionDependencies(stage);
    assert.deepEqual(await resumeAccountDeletion(USER_ID, state.deps), { status: "pending" }, stage);
    assert.equal(state.wasDeleted(), false, `${stage} deleted the User early`);
    state.clearFailure();
    state.resetCounters();
    assert.deepEqual(await resumeAccountDeletion(USER_ID, state.deps), { status: "deleted" }, `${stage} retry`);
    assert.equal(state.wasDeleted(), true, `${stage} retry did not delete the User`);
    assert.equal(state.events.at(-1), "user-delete", `${stage} did work after deleting the User`);
  }
});

test("pending-deletion sweep continues after one account fails and starts one unrefed timer", async () => {
  assert.equal(existsSync(ACCOUNT_DELETION_PATH), true, "account deletion service must exist");
  const {
    sweepPendingAccountDeletions,
    startAccountDeletionSweeper,
  } = require(ACCOUNT_DELETION_PATH);
  const seen = [];
  const User = {
    find: async (filter, projection, options) => {
      assert.deepEqual(filter, { deletionStatus: "pending" });
      assert.equal(projection, "_id");
      assert.equal(options.limit, 25);
      return [{ _id: USER_ID }, { _id: FRIEND_ID }];
    },
  };
  const result = await sweepPendingAccountDeletions({
    User,
    logger: { error() {} },
    processAccount: async (userId) => {
      seen.push(userId);
      if (userId === USER_ID) throw new Error("first failed");
      return { status: "deleted" };
    },
  });
  assert.deepEqual(seen, [USER_ID, FRIEND_ID]);
  assert.deepEqual(result, { attempted: 2, deleted: 1, pending: 1 });

  let intervalStarts = 0;
  let unrefs = 0;
  const timer = { unref() { unrefs += 1; } };
  const options = {
    setIntervalFn: () => { intervalStarts += 1; return timer; },
    User,
    processAccount: async () => ({ status: "deleted" }),
  };
  assert.equal(startAccountDeletionSweeper(options), timer);
  assert.equal(startAccountDeletionSweeper(options), timer);
  assert.equal(intervalStarts, 1);
  assert.equal(unrefs, 1);
});

test.after(async () => {
  const redisPath = require.resolve("../src/config/redisConfig");
  if (!require.cache[redisPath]) return;
  const { redis, subClient } = require(redisPath);
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});
