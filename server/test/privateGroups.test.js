const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createPrivateGroupService,
} = require("../src/services/privateGroupService");
const {
  groupHandle,
  publicGroupMember,
} = require("../src/services/groupIdentityService");
const {
  publicEncounterIdentity,
} = require("../src/services/encounterIdentityService");
const A = "507f1f77bcf86cd799439011",
  B = "507f1f77bcf86cd799439022",
  C = "507f1f77bcf86cd799439033";
function fixture() {
  let stamp = 1000000;
  const people = [A, B, C].map((_id, i) => ({
    _id,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    blockedUserIds: [],
    name: "Private real " + i,
    avatar: "private-avatar",
  }));
  const group = {
    squadId: "group",
    identityMode: "aliases",
    communicationMode: "chat",
    members: people.map((u, i) => ({
      memberId: "mem" + i,
      userId: u._id,
      providerAccountId: "private-provider" + i,
      displayName: u.name,
      alias: ["Quiet Fox", "Calm Oak", "Soft Rain"][i],
      role: i ? "member" : "leader",
    })),
  };
  const groups = new Map([["group", group]]),
    requests = [],
    notifications = [];
  const match = (row, q) =>
    Object.entries(q).every(([key, value]) =>
      key === "$or"
        ? value.some((v) => match(row, v))
        : value && typeof value === "object" && "$gt" in value
          ? new Date(row[key]) > value.$gt
          : row[key] === value,
    );
  const query = (value) => ({
    session() {
      return this;
    },
    lean: async () => value,
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  });
  const Request = {
    findOne: async (q) => requests.find((r) => match(r, q)),
    countDocuments: (q) => query(requests.filter((r) => match(r, q)).length),
    find: (q) => query(requests.filter((r) => match(r, q))),
    async create(rows) {
      for (const row of rows) {
        row.save = async () => row;
        requests.push(row);
      }
      return rows;
    },
  };
  const Squad = {
    findOne: async (q) => groups.get(q.squadId),
    async create(rows) {
      rows.forEach((row) => groups.set(row.squadId, row));
      return rows;
    },
  };
  const User = {
    find: (q) => query(people.filter((u) => q._id.$in.includes(u._id))),
  };
  let serial = Promise.resolve();
  const withLock = (fn) => {
    const current = serial.then(() => fn({ aborted: false }));
    serial = current.catch(() => {});
    return current;
  };
  const service = createPrivateGroupService({
    Squad,
    User,
    Request,
    withLock,
    transaction: (fn) => fn({}),
    notify: async (payload) => {
      notifications.push(payload);
      return payload;
    },
    now: () => stamp,
  });
  return {
    service,
    group,
    people,
    groups,
    requests,
    notifications,
    setTime: (t) => {
      stamp = t;
    },
  };
}
test("aliases never expose account/profile data, even to the same group or in another call", () => {
  const f = fixture(),
    member = f.group.members[0],
    view = publicGroupMember(f.group, member, {
      gender: "private",
      avatar: "private",
      uid: 123,
      screenSharing: true,
    });
  for (const secret of [
    A,
    member.providerAccountId,
    member.displayName,
    "private-avatar",
    "gender",
  ])
    assert(!JSON.stringify(view).includes(secret));
  assert.equal(view.userId, groupHandle(f.group, member));
  assert.equal(view.displayName, "Quiet Fox");
  assert.equal(view.avatar, null);
  const other = publicGroupMember({ ...f.group, squadId: "another" }, member);
  assert.notEqual(other.userId, view.userId);
  const call = publicEncounterIdentity({
    viewerSquadId: "group",
    memberSquadId: "group",
    member,
    user: { _id: A },
    encounterId: "call",
    identityMode: "aliases",
  });
  assert.equal(call.userId, view.userId);
  assert.equal(call.displayName, "Quiet Fox");
  assert(!JSON.stringify(call).includes(A));
});
test("mutual request/accept is idempotent, recipient-only, scoped, and creates exactly the same two principals", async () => {
  const f = fixture(),
    handle = groupHandle(f.group, f.group.members[1]);
  const [first, duplicate] = await Promise.all([
    f.service.request("group", A, handle),
    f.service.request("group", A, handle),
  ]);
  assert.equal(first.request.requestId, duplicate.request.requestId);
  assert.equal(f.requests.length, 1);
  assert(!JSON.stringify(first.request).includes(B));
  assert.equal(
    f.notifications[0].publicFromId,
    groupHandle(f.group, f.group.members[0]),
  );
  await assert.rejects(
    f.service.respond(first.request.requestId, A, "accept"),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    f.service.respond(first.request.requestId, C, "accept"),
    { code: "NOT_FOUND" },
  );
  const [accepted, repeated] = await Promise.all([
    f.service.respond(first.request.requestId, B, "accept"),
    f.service.respond(first.request.requestId, B, "accept"),
  ]);
  assert.equal(accepted.squadId, repeated.squadId);
  assert.equal(f.groups.size, 2);
  const pair = f.groups.get(accepted.squadId);
  assert.deepEqual(pair.authorizedPrincipalPair, [A, B]);
  assert.equal(pair.members.length, 2);
  assert.equal(pair.members[0].userId, A);
  assert.equal(pair.members[0].role, "leader");
  assert.equal(pair.visibility, "private");
  assert.equal(pair.joinPolicy, "invite");
  assert.equal(pair.identityMode, "aliases");
  assert.equal(pair.communicationMode, "chat");
  assert(
    pair.members.every(
      (m) => !m.inLobbyVideo && !m.inEncounterVideo && !m.ready,
    ),
  );
});
test("expired, stale membership, raw-account and cross-group targets cannot open a private group", async () => {
  for (const change of ["expiry", "membership", "block", "ban"]) {
    const f = fixture(),
      request = await f.service.request(
        "group",
        A,
        groupHandle(f.group, f.group.members[1]),
      );
    if (change === "expiry") f.setTime(1600001);
    if (change === "membership") (f.group.members.pop(), f.group.members.pop());
    if (change === "block") f.people[1].blockedUserIds.push(A);
    if (change === "ban") f.people[1].isSuspended = true;
    await assert.rejects(
      f.service.respond(request.request.requestId, B, "accept"),
    );
    assert.equal(f.groups.size, 1);
  }
  const f = fixture();
  await assert.rejects(f.service.request("group", A, B), { code: "NOT_FOUND" });
  await assert.rejects(
    f.service.request("other", A, groupHandle(f.group, f.group.members[1])),
    { code: "NOT_FOUND" },
  );
});
test("pending and rate limits count both ends while duplicate taps consume one request", async () => {
  const f = fixture(),
    target = groupHandle(f.group, f.group.members[1]);
  for (let i = 0; i < 3; i++) {
    const r = await f.service.request("group", A, target);
    await f.service.respond(r.request.requestId, A, "cancel");
  }
  await assert.rejects(f.service.request("group", A, target), {
    code: "REQUEST_LIMIT",
  });
  const g = fixture();
  for (let i = 0; i < 10; i++)
    g.requests.push({
      senderId: C,
      recipientId: B,
      status: "pending",
      expiresAt: new Date(2000000),
      createdAt: new Date(1),
    });
  await assert.rejects(
    g.service.request("group", A, groupHandle(g.group, g.group.members[1])),
    { code: "REQUEST_LIMIT" },
  );
});
