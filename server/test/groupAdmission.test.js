const test = require("node:test");
const assert = require("node:assert/strict");
const { Squad } = require("../src/models/Squad");
const User = require("../src/models/User");
const { Notification } = require("../src/models/Notification");
const { redlock, redis, subClient } = require("../src/config/redisConfig");
const {
  joinSquadHandler,
  joinRandomSquadHandler,
  updateSquadVisibilityHandler,
  updateSquadJoinPolicyHandler,
  approveJoinRequestHandler,
  promoteMemberHandler,
  kickMemberHandler,
  disbandSquadHandler,
  leaveSquadHandler,
} = require("../src/controllers/squadController");
const {
  joinGroup,
  groupInvite,
  leaveGroup,
} = require("../src/controllers/groupManagementController");
const { groupHandle } = require("../src/services/groupIdentityService");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
const IDs = Array.from({ length: 6 }, (_, i) => "507f1f77bcf86cd79943901" + i);
const member = (i, role = "member") => ({
  memberId: "member-" + i,
  userId: IDs[i],
  alias: "Person " + i,
  displayName: "Person " + i,
  role,
});
const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
const base = () => ({
  squadId: "fixture",
  squadCode: "ABC-123",
  squadName: "Fixture",
  status: "idle",
  managedGroup: true,
  identityMode: "aliases",
  visibility: "private",
  joinPolicy: "invite",
  groupInvite: "a".repeat(64),
  members: [member(0, "leader")],
  joinRequests: [],
  invitedUserIds: [],
});

function fixture(t, initial = base()) {
  let record = structuredClone(initial),
    queue = Promise.resolve(),
    acquired = 0,
    requested = 0;
  const saved = [];
  t.mock.method(redlock, "acquire", async (resources) => {
    assert.deepEqual(resources, ["lock:squad:fixture:admission"]);
    requested++;
    const previous = queue,
      hold = deferred();
    queue = hold.promise;
    await previous;
    acquired++;
    let released = false;
    return {
      release: async () => {
        assert.equal(released, false, "a lock is released once");
        released = true;
        hold.resolve();
      },
    };
  });
  t.mock.method(redlock, "using", async (resources, duration, work) => {
    assert.equal(duration, 10_000);
    const lease = await redlock.acquire(resources);
    try {
      return await work({ aborted: false });
    } finally {
      await lease.release();
    }
  });
  t.mock.method(Squad, "findOne", async (query) => {
    if (
      !record ||
      (query.squadId && query.squadId !== record.squadId) ||
      (query.squadCode && query.squadCode !== record.squadCode)
    )
      return null;
    const copy = structuredClone(record);
    copy.save = async () => {
      const { save, ...value } = copy;
      record = structuredClone(value);
      saved.push(structuredClone(value));
    };
    return copy;
  });
  const accounts = IDs.map((_id) => ({
    _id,
    name: "Private name",
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    isPremium: false,
    blockedUserIds: [],
  }));
  t.mock.method(User, "findById", async (id) =>
    accounts.find((user) => user._id === id),
  );
  t.mock.method(User, "find", () => ({
    lean: async () => accounts,
    select: () => ({ lean: async () => accounts }),
  }));
  t.mock.method(Notification, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(
    require("../src/services/memberMediaService"),
    "clearMember",
    async () => {},
  );
  t.mock.method(
    require("../src/services/sessionService"),
    "clearMemberSession",
    async () => {},
  );
  t.mock.method(
    require("../src/services/queueService"),
    "removeFromQueue",
    async () => {},
  );
  const request = (i, body = {}) => ({
    user: { userId: IDs[i] },
    params: { squadId: "fixture" },
    body,
    squadAccess: { squad: structuredClone(initial) },
  });
  return {
    request,
    get requested() {
      return requested;
    },
    saved,
    get record() {
      return record;
    },
    set record(value) {
      record = value;
    },
    get acquired() {
      return acquired;
    },
  };
}
test.after(() => {
  redis.disconnect();
  subClient.disconnect();
});

test("invite rotation wins over an already located join, including direct legacy joins", async (t) => {
  for (const dealer of [joinGroup, joinSquadHandler])
    await t.test(dealer.name, async (t) => {
      const f = fixture(t),
        held = await redlock.acquire(["lock:squad:fixture:admission"]);
      const rotated = response(),
        joined = response();
      const rotating = groupInvite(f.request(0, { rotate: true }), rotated);
      const joining = dealer(
        f.request(1, { alias: "New Fox", invite: "a".repeat(64) }),
        joined,
      );
      await tick();
      await held.release();
      await Promise.all([rotating, joining]);
      assert.equal(rotated.statusCode, 200);
      assert.notEqual(f.record.groupInvite, "a".repeat(64));
      assert.equal(joined.statusCode, 403);
      assert.equal(joined.body.error.code, "INVITE_REQUIRED");
      assert.equal(f.record.members.length, 1);
      assert.equal(
        f.acquired,
        3,
        "wrapper and dealer share one admission acquisition",
      );
    });
});

test("fresh seats serialize a direct join against a pending approval", async (t) => {
  const initial = base();
  initial.members = [member(0, "leader"), member(1), member(2)];
  initial.joinRequests = [
    { userId: IDs[4], alias: "Pending Owl", name: "Pending Owl" },
  ];
  const f = fixture(t, initial),
    held = await redlock.acquire(["lock:squad:fixture:admission"]),
    joined = response(),
    approved = response();
  const joining = joinSquadHandler(
    f.request(3, { alias: "Last Fox", invite: initial.groupInvite }),
    joined,
  );
  await tick();
  const approvalReq = f.request(0);
  approvalReq.params.userId = groupHandle(initial, { userId: IDs[4] });
  const approving = approveJoinRequestHandler(approvalReq, approved);
  await tick();
  await held.release();
  await Promise.all([joining, approving]);
  assert.equal(joined.statusCode, 200);
  assert.equal(approved.statusCode, 409);
  assert.equal(approved.body.error.code, "SQUAD_FULL");
  assert.equal(f.record.members.length, 4);
  assert.equal(f.record.joinRequests.length, 1);
  assert(f.saved.every((row) => row.members.length <= 4));
});

test("two stale approvals cannot consume the final seat twice", async (t) => {
  const initial = base();
  initial.members = [member(0, "leader"), member(1), member(2)];
  initial.joinRequests = [3, 4].map((i) => ({
    userId: IDs[i],
    alias: "Pending " + i,
    name: "Pending " + i,
  }));
  const f = fixture(t, initial);
  const results = await Promise.all(
    [3, 4].map(async (i) => {
      const req = f.request(0),
        res = response();
      req.params.userId = groupHandle(initial, { userId: IDs[i] });
      await approveJoinRequestHandler(req, res);
      return res;
    }),
  );
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(f.record.members.length, 4);
  assert.equal(f.record.joinRequests.length, 1);
});

test("promotion accepts the public alias handle, rejects raw ids and stale owners", async (t) => {
  const initial = base();
  initial.members.push(member(1));
  const f = fixture(t, initial);
  const raw = f.request(0),
    denied = response();
  raw.params.memberId = "member-1";
  await promoteMemberHandler(raw, denied);
  assert.equal(denied.statusCode, 404);
  const publicReq = f.request(0),
    promoted = response();
  publicReq.params.memberId = groupHandle(initial, member(1));
  await promoteMemberHandler(publicReq, promoted);
  assert.equal(promoted.statusCode, 200);
  assert.equal(promoted.body.data.newLeaderMemberId, publicReq.params.memberId);
  const stale = f.request(0),
    staleRes = response();
  stale.params.memberId = groupHandle(initial, member(0));
  await promoteMemberHandler(stale, staleRes);
  assert.equal(staleRes.statusCode, 403);
  assert.equal(
    f.record.members.find((person) => person.role === "leader").userId,
    IDs[1],
  );
  const approving = f.request(0),
    approvalRes = response();
  approving.params.userId = groupHandle(initial, member(1));
  await approveJoinRequestHandler(approving, approvalRes);
  assert.equal(approvalRes.statusCode, 403);
});

test("legacy leave cannot silently transfer a managed owner; explicit successor still works", async (t) => {
  const initial = base();
  initial.members.push(member(1));
  const f = fixture(t, initial),
    res = response();
  await leaveSquadHandler(f.request(0), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, "OWNER_TRANSFER_REQUIRED");
  assert.equal(f.record.members.length, 2);
  assert.equal(f.record.members[0].role, "leader");
  const leaving = response();
  await leaveGroup(
    f.request(0, { transferToMemberId: groupHandle(initial, member(1)) }),
    leaving,
  );
  assert.equal(leaving.statusCode, 200);
  assert.equal(f.record.members.length, 1);
  assert.equal(f.record.members[0].userId, IDs[1]);
  assert.equal(f.record.members[0].role, "leader");
});

test("random and direct admission share the final-seat lock", async (t) => {
  const enabled = process.env.STRANGER_DISCOVERY_ENABLED;
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  t.after(() => {
    if (enabled === undefined) delete process.env.STRANGER_DISCOVERY_ENABLED;
    else process.env.STRANGER_DISCOVERY_ENABLED = enabled;
  });
  const initial = base();
  initial.identityMode = "names";
  initial.visibility = "open";
  initial.joinPolicy = "open";
  initial.members = [member(0, "leader"), member(1), member(2)];
  const f = fixture(t, initial);
  t.mock.method(Squad, "find", () => ({
    sort() {
      return this;
    },
    limit: async () => [structuredClone(initial)],
  }));
  const held = await redlock.acquire(["lock:squad:fixture:admission"]),
    randomRes = response(),
    directRes = response();
  const random = joinRandomSquadHandler(
    f.request(3, { displayName: "Last Fox" }),
    randomRes,
  );
  for (let i = 0; i < 20 && f.requested < 2; i++) await tick();
  assert.equal(f.requested, 2);
  const direct = joinSquadHandler(
    f.request(4, { displayName: "Next Owl" }),
    directRes,
  );
  await tick();
  await held.release();
  await Promise.all([random, direct]);
  assert.equal(randomRes.statusCode, 200);
  assert.equal(directRes.statusCode, 403);
  assert.equal(directRes.body.error.code, "SQUAD_FULL_UPGRADE");
  assert.equal(f.record.members.length, 4);
  assert(f.saved.every((row) => row.members.length <= 4));
});

test("lost admission ownership before save returns409 without notices or roster changes", async (t) => {
  const f = fixture(t),
    signal = { aborted: false },
    notices = [];
  t.mock.method(redlock, "using", async (_resources, _duration, work) =>
    work(signal),
  );
  t.mock.method(User, "find", () => ({
    lean: async () => {
      signal.aborted = true;
      return IDs.map((_id) => ({ _id, blockedUserIds: [] }));
    },
  }));
  t.mock.method(
    require("../src/services/socketService"),
    "emitToSquad",
    (...args) => notices.push(args),
  );
  t.mock.method(Notification, "deleteMany", async () => {
    notices.push("notification");
  });
  const res = response();
  await joinSquadHandler(
    f.request(1, { alias: "Waiting Fox", invite: "a".repeat(64) }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, "GROUP_CHANGED");
  assert.equal(f.record.members.length, 1);
  assert.equal(f.saved.length, 0);
  assert.deepEqual(notices, []);
});

test("a fenced write conflict returns409 without sending membership notices", async (t) => {
  const f = fixture(t),
    notices = [],
    read = Squad.findOne;
  t.mock.method(Squad, "findOne", async (...args) => {
    const squad = await read(...args);
    squad.save = async () => {
      throw Object.assign(new Error("Stale version"), { name: "VersionError" });
    };
    return squad;
  });
  t.mock.method(
    require("../src/services/socketService"),
    "emitToSquad",
    (...args) => notices.push(args),
  );
  t.mock.method(Notification, "deleteMany", async () => {
    notices.push("notification");
  });
  const res = response();
  await joinSquadHandler(
    f.request(1, { alias: "Waiting Fox", invite: "a".repeat(64) }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, "GROUP_CHANGED");
  assert.equal(f.record.members.length, 1);
  assert.deepEqual(notices, []);
});

test("permission toggles commit before a waiting join checks the current policy", async (t) => {
  const enabled = process.env.STRANGER_DISCOVERY_ENABLED;
  process.env.STRANGER_DISCOVERY_ENABLED = "true";
  t.after(() => {
    if (enabled === undefined) delete process.env.STRANGER_DISCOVERY_ENABLED;
    else process.env.STRANGER_DISCOVERY_ENABLED = enabled;
  });
  for (const [handler, input, errorCode] of [
    [
      updateSquadVisibilityHandler,
      { visibility: "private" },
      "INVITE_REQUIRED",
    ],
    [updateSquadJoinPolicyHandler, { joinPolicy: "invite" }, "INVITE_ONLY"],
  ]) {
    await t.test(handler.name, async (t) => {
      const initial = base();
      initial.visibility = "open";
      initial.joinPolicy = "open";
      initial.identityMode = "names";
      const f = fixture(t, initial),
        held = await redlock.acquire(["lock:squad:fixture:admission"]),
        changed = response(),
        joined = response();
      const changing = handler(f.request(0, input), changed);
      await tick();
      const joining = joinSquadHandler(
        f.request(1, { displayName: "Waiting Owl" }),
        joined,
      );
      await tick();
      await held.release();
      await Promise.all([changing, joining]);
      assert.equal(changed.statusCode, 200);
      assert.equal(joined.statusCode, 403);
      assert.equal(joined.body.error.code, errorCode);
      assert.equal(f.record.members.length, 1);
      const stale = f.request(0, input),
        staleRes = response();
      f.record = { ...f.record, members: [member(1, "leader")] };
      await handler(stale, staleRes);
      assert.equal(staleRes.statusCode, 403);
      assert.equal(staleRes.body.error.code, "LEADER_ONLY");
    });
  }
});

test("a former owner cannot kick or delete after promotion; managed kicks persist a ban", async (t) => {
  const initial = base();
  initial.members.push(member(1), member(2));
  const f = fixture(t, initial);
  const promote = f.request(0),
    promoted = response();
  promote.params.memberId = groupHandle(initial, member(1));
  await promoteMemberHandler(promote, promoted);
  assert.equal(promoted.statusCode, 200);
  const staleKick = f.request(0),
    kicked = response();
  staleKick.params.memberId = groupHandle(initial, member(1));
  await kickMemberHandler(staleKick, kicked);
  assert.equal(kicked.statusCode, 403);
  assert.equal(f.record.members.length, 3);
  const staleDelete = response();
  await disbandSquadHandler(
    { ...f.request(0), squadAccess: { squad: initial, isLeader: true } },
    staleDelete,
  );
  assert.equal(staleDelete.statusCode, 403);
  assert.equal(f.record.members.length, 3);
  const remove = f.request(1),
    removed = response();
  remove.params.memberId = groupHandle(initial, member(0));
  await kickMemberHandler(remove, removed);
  assert.equal(removed.statusCode, 200);
  assert.equal(f.record.bannedMembers[0].userId, IDs[0]);
  assert.equal(f.record.members.length, 2);
  const rejoin = response();
  await joinSquadHandler(
    f.request(0, { alias: "New Alias", invite: initial.groupInvite }),
    rejoin,
  );
  assert.equal(rejoin.statusCode, 403);
  assert.equal(rejoin.body.error.code, "GROUP_BANNED");
});
