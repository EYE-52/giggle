const assert = require("node:assert/strict");
const test = require("node:test");

const {
  approveUserHandler,
  getPendingUsersHandler,
  requireAdmin,
  updateUserAccessHandler,
} = require("../src/controllers/adminController");
const User = require("../src/models/User");
const socketService = require("../src/services/socketService");

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
