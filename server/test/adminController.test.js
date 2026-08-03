const assert = require("node:assert/strict");
const test = require("node:test");

const {
  approveUserHandler,
  getPendingUsersHandler,
  listSafetyReportsHandler,
  requireAdmin,
  reviewSafetyReportHandler,
  updateUserAccessHandler,
} = require("../src/controllers/adminController");
const User = require("../src/models/User");
const socketService = require("../src/services/socketService");
const { existsSync } = require("node:fs");
const path = require("node:path");
const safetyReportPath = path.join(__dirname, "../src/models/SafetyReport.js");
const SafetyReport = existsSync(safetyReportPath) ? require(safetyReportPath) : null;

function createMockResponse() {
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

function withAdminEmail(value, fn) {
  const original = process.env.ADMIN_EMAIL;
  if (value === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = value;

  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = original;
  }
}

const pendingUser = () => ({
  _id: "507f1f77bcf86cd799439011",
  email: "member@example.com",
  name: "Member",
  image: null,
  isApproved: false,
  ageConfirmed: true,
  isAdult: true,
  ageVerified: false,
  isSuspended: false,
  isShadowBanned: false,
  deletionStatus: "active",
  ageVerification: {
    status: "pending",
    sessionId: "private-session",
    referenceId: "private-reference",
    evidenceId: "private-evidence",
  },
  birthDate: new Date("2000-01-01T00:00:00.000Z"),
  friends: ["friend-id"],
  blockedUserIds: ["blocked-id"],
  referralCode: "PRIVATE",
  tokens: 99,
  __v: 7,
  createdAt: new Date("2026-08-04T00:00:00.000Z"),
});

const expectedAdminUser = {
  id: "507f1f77bcf86cd799439011",
  email: "member@example.com",
  name: "Member",
  image: null,
  isApproved: false,
  ageConfirmed: true,
  isAdult: true,
  ageVerified: false,
  verificationStatus: "pending",
  isSuspended: false,
  isShadowBanned: false,
  deletionStatus: "active",
  createdAt: "2026-08-04T00:00:00.000Z",
};

test("getPendingUsersHandler returns only the explicit admin user projection", async () => {
  const originalFind = User.find;
  let projection;
  User.find = (_filter, selected) => {
    projection = selected;
    return { sort: async () => [pendingUser()] };
  };

  try {
    const res = createMockResponse();
    await getPendingUsersHandler({}, res);

    assert.deepEqual(res.body, { ok: true, data: [expectedAdminUser] });
    for (const field of [
      "birthDate",
      "ageVerification.sessionId",
      "ageVerification.referenceId",
      "ageVerification.evidenceId",
      "friends",
      "blockedUserIds",
      "referralCode",
      "tokens",
      "__v",
    ]) {
      assert.equal(String(projection).split(/\s+/).includes(field), false);
    }
  } finally {
    User.find = originalFind;
  }
});

test("approveUserHandler returns only the explicit admin user projection", async () => {
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  let options;
  User.findByIdAndUpdate = async (_id, _update, selectedOptions) => {
    options = selectedOptions;
    return pendingUser();
  };

  try {
    const res = createMockResponse();
    await approveUserHandler(
      { params: { userId: "507f1f77bcf86cd799439011" } },
      res
    );

    assert.deepEqual(res.body, { ok: true, data: expectedAdminUser });
    assert.equal(String(options?.select).includes("birthDate"), false);
  } finally {
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test("requireAdmin fails closed when ADMIN_EMAIL is not configured", () => {
  withAdminEmail(undefined, () => {
    const req = { user: { email: "legacy.owner@example.com" } };
    const res = createMockResponse();
    let nextCalled = false;

    requireAdmin(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "ADMIN_NOT_CONFIGURED");
  });
});

test("requireAdmin allows the configured admin email with normalization", () => {
  withAdminEmail(" Owner@GiggleMeet.com ", () => {
    const req = { user: { email: "owner@gigglemeet.com" } };
    const res = createMockResponse();
    let nextCalled = false;

    requireAdmin(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, null);
  });
});

test("requireAdmin rejects non-admin callers", () => {
  withAdminEmail("owner@gigglemeet.com", () => {
    const req = { user: { email: "member@gigglemeet.com" } };
    const res = createMockResponse();
    let nextCalled = false;

    requireAdmin(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
  });
});

test("approveUserHandler returns 404 when the target user does not exist", async () => {
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  User.findByIdAndUpdate = async () => null;

  try {
    const req = { params: { userId: "507f1f77bcf86cd799439011" } };
    const res = createMockResponse();

    await approveUserHandler(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "USER_NOT_FOUND");
  } finally {
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test("approveUserHandler rejects malformed user ids before database update", async () => {
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  let touchedDatabase = false;
  User.findByIdAndUpdate = async () => {
    touchedDatabase = true;
    throw new Error("should not touch database");
  };

  try {
    const req = { params: { userId: "not-an-object-id" } };
    const res = createMockResponse();

    await approveUserHandler(req, res);

    assert.equal(touchedDatabase, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "INVALID_REQUEST");
  } finally {
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test("updateUserAccessHandler validates ids and an exact boolean patch", async () => {
  const original = User.findByIdAndUpdate;
  let touched = false;
  User.findByIdAndUpdate = async () => {
    touched = true;
    return pendingUser();
  };

  try {
    for (const [userId, body] of [
      ["bad-id", { suspended: true }],
      ["507f1f77bcf86cd799439011", {}],
      ["507f1f77bcf86cd799439011", { suspended: "yes" }],
      ["507f1f77bcf86cd799439011", { shadowBanned: false, extra: true }],
    ]) {
      const res = createMockResponse();
      await updateUserAccessHandler({ params: { userId }, body }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "INVALID_REQUEST");
    }
    assert.equal(touched, false);
  } finally {
    User.findByIdAndUpdate = original;
  }
});

test("updateUserAccessHandler updates moderation state without changing age verification", async () => {
  const originalUpdate = User.findByIdAndUpdate;
  const originalDisconnect = socketService.disconnectUserSockets;
  let observedUpdate;
  let disconnected;
  User.findByIdAndUpdate = async (_id, update) => {
    observedUpdate = update;
    return { ...pendingUser(), isSuspended: true, suspendedAt: new Date(), isShadowBanned: false };
  };
  socketService.disconnectUserSockets = (userId) => { disconnected = userId; };

  try {
    const res = createMockResponse();
    await updateUserAccessHandler(
      { params: { userId: "507f1f77bcf86cd799439011" }, body: { suspended: true } },
      res
    );

    assert.equal(observedUpdate.$set.isSuspended, true);
    assert.ok(observedUpdate.$set.suspendedAt instanceof Date);
    assert.equal("ageVerified" in observedUpdate.$set, false);
    assert.equal(disconnected, "507f1f77bcf86cd799439011");
    assert.equal(res.body.data.isSuspended, true);
  } finally {
    User.findByIdAndUpdate = originalUpdate;
    socketService.disconnectUserSockets = originalDisconnect;
  }
});

const rawSafetyReport = () => ({
  _id: "507f1f77bcf86cd799439012",
  reporterUserId: "507f1f77bcf86cd799439011",
  reporterSquadId: "sq_a",
  targetSquadId: "sq_b",
  targetUserIds: ["507f1f77bcf86cd799439013"],
  encounterId: "enc_1",
  category: "harassment",
  details: "Repeated insults",
  status: "open",
  reviewedBy: null,
  reviewedAt: null,
  actionNote: "",
  createdAt: new Date("2026-08-04T01:00:00.000Z"),
  updatedAt: new Date("2026-08-04T01:00:00.000Z"),
  rawPayload: { private: true },
  __v: 9,
});

const expectedAdminReport = {
  id: "507f1f77bcf86cd799439012",
  reporterUserId: "507f1f77bcf86cd799439011",
  reporterSquadId: "sq_a",
  targetSquadId: "sq_b",
  targetUserIds: ["507f1f77bcf86cd799439013"],
  encounterId: "enc_1",
  category: "harassment",
  details: "Repeated insults",
  status: "open",
  reviewedBy: null,
  reviewedAt: null,
  actionNote: "",
  createdAt: "2026-08-04T01:00:00.000Z",
  updatedAt: "2026-08-04T01:00:00.000Z",
  reporter: {
    userId: "507f1f77bcf86cd799439011",
    name: "Reporter",
    email: "reporter@example.com",
  },
  targets: [{
    userId: "507f1f77bcf86cd799439013",
    name: "Target",
    email: "target@example.com",
  }],
};

test("listSafetyReportsHandler returns a bounded safe review queue", async () => {
  assert.equal(typeof listSafetyReportsHandler, "function");
  assert.ok(SafetyReport);
  if (typeof listSafetyReportsHandler !== "function" || !SafetyReport) return;

  const originalReports = SafetyReport.find;
  const originalUsers = User.find;
  let reportFilter;
  let reportProjection;
  let observedLimit;
  let userProjection;
  SafetyReport.find = (filter, projection) => {
    reportFilter = filter;
    reportProjection = projection;
    return {
      sort() { return this; },
      async limit(limit) { observedLimit = limit; return [rawSafetyReport()]; },
    };
  };
  User.find = async (_filter, projection) => {
    userProjection = projection;
    return [
      { _id: "507f1f77bcf86cd799439011", name: "Reporter", email: "reporter@example.com", birthDate: "private" },
      { _id: "507f1f77bcf86cd799439013", name: "Target", email: "target@example.com", ageVerification: { sessionId: "private" } },
    ];
  };

  try {
    const res = createMockResponse();
    await listSafetyReportsHandler({ query: { status: "open", limit: "500" } }, res);

    assert.deepEqual(reportFilter, { status: "open" });
    assert.equal(observedLimit, 50);
    assert.equal(String(reportProjection).includes("rawPayload"), false);
    assert.equal(userProjection, "_id name email");
    assert.deepEqual(res.body, { ok: true, data: [expectedAdminReport] });
    assert.equal(JSON.stringify(res.body).includes("birthDate"), false);
    assert.equal(JSON.stringify(res.body).includes("ageVerification"), false);
  } finally {
    SafetyReport.find = originalReports;
    User.find = originalUsers;
  }
});

test("reviewSafetyReportHandler validates the exact action and records the reviewer", async () => {
  assert.equal(typeof reviewSafetyReportHandler, "function");
  assert.ok(SafetyReport);
  if (typeof reviewSafetyReportHandler !== "function" || !SafetyReport) return;

  const originalUpdate = SafetyReport.findByIdAndUpdate;
  const originalUsers = User.find;
  let calls = 0;
  let observedUpdate;
  let observedOptions;
  SafetyReport.findByIdAndUpdate = async (_id, update, options) => {
    calls += 1;
    observedUpdate = update;
    observedOptions = options;
    return { ...rawSafetyReport(), status: "actioned", reviewedBy: "507f1f77bcf86cd799439014", actionNote: "Suspended after review" };
  };
  User.find = async () => [
    { _id: "507f1f77bcf86cd799439011", name: "Reporter", email: "reporter@example.com" },
    { _id: "507f1f77bcf86cd799439013", name: "Target", email: "target@example.com" },
  ];

  try {
    for (const [reportId, body] of [
      ["bad-id", { status: "reviewing" }],
      ["507f1f77bcf86cd799439012", {}],
      ["507f1f77bcf86cd799439012", { status: "unknown" }],
      ["507f1f77bcf86cd799439012", { status: "actioned", extra: true }],
      ["507f1f77bcf86cd799439012", { status: "actioned", actionNote: "x".repeat(501) }],
    ]) {
      const res = createMockResponse();
      await reviewSafetyReportHandler(
        { params: { reportId }, body, user: { userId: "507f1f77bcf86cd799439014" } },
        res
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "INVALID_REQUEST");
    }
    assert.equal(calls, 0);

    const res = createMockResponse();
    await reviewSafetyReportHandler(
      {
        params: { reportId: "507f1f77bcf86cd799439012" },
        body: { status: "actioned", actionNote: "  Suspended   after review  " },
        user: { userId: "507f1f77bcf86cd799439014" },
      },
      res
    );

    assert.equal(calls, 1);
    assert.equal(observedUpdate.$set.status, "actioned");
    assert.equal(observedUpdate.$set.actionNote, "Suspended after review");
    assert.equal(observedUpdate.$set.reviewedBy, "507f1f77bcf86cd799439014");
    assert.ok(observedUpdate.$set.reviewedAt instanceof Date);
    assert.equal(observedOptions.new, true);
    assert.equal(observedOptions.runValidators, true);
    assert.equal(String(observedOptions.select).includes("rawPayload"), false);
    assert.equal(res.body.data.status, "actioned");
  } finally {
    SafetyReport.findByIdAndUpdate = originalUpdate;
    User.find = originalUsers;
  }
});

test("admin report routes require identity and admin authorization", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/routes/adminRoutes.js"),
    "utf8"
  );
  assert.match(source, /router\.get\("\/reports", requireIdentityAuth, requireAdmin, listSafetyReportsHandler\);/);
  assert.match(source, /router\.patch\("\/reports\/:reportId", requireIdentityAuth, requireAdmin, reviewSafetyReportHandler\);/);
});
