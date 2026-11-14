/* Real local Mongo replica set + Redis + HTTP/socket path. All identities and
 * provider tokens are synthetic fixtures. No outside provider is contacted. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net"),
  { spawn } = require("node:child_process");
const { MongoClient, ObjectId } = require("mongodb"),
  Redis = require("ioredis"),
  jwt = require("jsonwebtoken"),
  { io } = require("socket.io-client");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-public-groups-")),
  children = [],
  sockets = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await delay(100);
  }
  throw Error("Local test service did not become ready.");
}
(async () => {
  let mongo, redis, apiServer;
  try {
    const mongoPort = await port(),
      redisPort = await port(),
      database = "giggle_groups_" + Date.now();
    fs.mkdirSync(path.join(temp, "mongo"));
    const m = spawn(
      process.env.MONGOD_BINARY || "mongod",
      [
        "--port",
        String(mongoPort),
        "--bind_ip",
        "127.0.0.1",
        "--dbpath",
        path.join(temp, "mongo"),
        "--replSet",
        "giggleGroupsTest",
        "--oplogSize",
        "32",
        "--wiredTigerCacheSizeGB",
        "0.25",
        "--logpath",
        path.join(temp, "mongo.log"),
      ],
      { stdio: "ignore" },
    );
    children.push(m);
    let mongoError;
    m.on("error", (e) => (mongoError = e));
    mongo = new MongoClient(
      `mongodb://127.0.0.1:${mongoPort}/?directConnection=true`,
      { serverSelectionTimeoutMS: 500 },
    );
    await until(async () => {
      if (mongoError) throw mongoError;
      await mongo.connect();
      return true;
    });
    await mongo.db("admin").command({
      replSetInitiate: {
        _id: "giggleGroupsTest",
        members: [{ _id: 0, host: `127.0.0.1:${mongoPort}` }],
      },
    });
    await until(
      async () =>
        (await mongo.db("admin").command({ hello: 1 })).isWritablePrimary,
    );
    const r = spawn(
      "redis-server",
      [
        "--port",
        String(redisPort),
        "--bind",
        "127.0.0.1",
        "--save",
        "",
        "--appendonly",
        "no",
      ],
      { stdio: "ignore" },
    );
    children.push(r);
    redis = new Redis(redisPort, "127.0.0.1", {
      retryStrategy: () => 100,
      maxRetriesPerRequest: 1,
    });
    redis.on("error", () => {});
    await until(async () => (await redis.ping()) === "PONG");
    Object.assign(process.env, {
      NODE_ENV: "test",
      MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/${database}?replicaSet=giggleGroupsTest`,
      MONGODB_DB_NAME: database,
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      JWT_SECRET: "group-local-fixture-secret-only-000000000000",
      GAME_BRIDGE_SECRET: "group-local-bridge-fixture-only-000000000",
      GAMES_PUBLIC_URL: "http://localhost:8190",
      STRANGER_DISCOVERY_ENABLED: "true",
      AGORA_APP_ID: "f".repeat(32),
      AGORA_APP_CERTIFICATE: "e".repeat(32),
      FRONTEND_URL: "http://localhost:4114",
      ENABLE_REQUEST_LOGS: "false",
      LOG_REQUEST_BODY: "false",
    });
    const app = require("../../src/server");
    apiServer = app;
    await app.startServer(0);
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const people = Array.from({ length: 4 }, (_, i) => {
      const id = new ObjectId();
      const user = {
        _id: id,
        name: "Private fixture name " + i,
        email: `group-fixture-${i}@example.invalid`,
        avatar: "private-fixture-avatar",
        ageConfirmed: true,
        isAdult: true,
        ageVerified: true,
        isApproved: true,
        isPremium: false,
        blockedUserIds: [],
      };
      return {
        ...user,
        id: String(id),
        token: jwt.sign(
          {
            sub: String(id),
            userId: String(id),
            providerAccountId: "private-provider-" + i,
            name: user.name,
            email: user.email,
          },
          process.env.JWT_SECRET,
        ),
      };
    });
    await mongo
      .db(database)
      .collection("users")
      .insertMany(people.map(({ id, token, ...user }) => user));
    async function api(route, who = 0, body, expected = 200) {
      const response = await fetch(base + "/api" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + people[who].token,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      assert.equal(
        response.status,
        expected,
        route + ": " + JSON.stringify(result),
      );
      return result.data ?? result;
    }
    const forbidden = people
      .flatMap((p) => [p.id, p.name, p.avatar])
      .concat(people.map((_, i) => "private-provider-" + i));
    const privateFree = (value) =>
      forbidden.forEach((secret) =>
        assert(
          !JSON.stringify(value).includes(secret),
          "Public data contains private identity: " + secret,
        ),
      );
    console.log("Seeded four synthetic accounts");
    const created = await api(
      "/squads/create",
      0,
      {
        squadName: "Local alias group",
        visibility: "open",
        identityMode: "aliases",
        communicationMode: "chat",
        alias: "Quiet Fox",
      },
      201,
    );
    privateFree(created);
    const id = created.squadId;
    await api(`/squads/${id}/join`, 1, {}, 400);
    for (const [i, alias] of [
      [1, "Calm Oak"],
      [2, "Soft Rain"],
    ])
      privateFree(await api(`/squads/${id}/join`, i, { alias }));
    const room = await api("/squads/" + id);
    privateFree(room);
    assert.equal(room.members.length, 3);
    assert.equal(room.selfUserId, created.selfUserId);
    assert.equal(room.communicationMode, "chat");
    await api("/squads/" + id, 3, undefined, 403);
    await api(`/agora/lobby-token/${id}`, 0, {}, 403);
    const handleB = room.members.find(
        (m) => m.displayName === "Calm Oak",
      ).memberId,
      handleC = room.members.find(
        (m) => m.displayName === "Soft Rain",
      ).memberId;
    console.log("Created and joined alias group");
    const req = await api(`/squads/${id}/private-requests`, 0, {
      memberId: handleB,
    });
    privateFree(req);
    assert.equal(
      (await api(`/squads/${id}/private-requests`, 0, { memberId: handleB }))
        .request.requestId,
      req.request.requestId,
    );
    await api(`/private-requests/${req.request.requestId}/accept`, 0, {}, 404);
    await api(`/private-requests/${req.request.requestId}/accept`, 2, {}, 404);
    const accepted = await api(
      `/private-requests/${req.request.requestId}/accept`,
      1,
      {},
    );
    assert.equal(
      (await api(`/private-requests/${req.request.requestId}/accept`, 1, {}))
        .squadId,
      accepted.squadId,
    );
    const pair = await api("/squads/" + accepted.squadId);
    privateFree(pair);
    assert.equal(pair.maxSlots, 2);
    assert.equal(pair.members.length, 2);
    assert.equal(pair.communicationMode, "chat");
    assert.equal(pair.isPrivatePair, true);
    await api(
      "/squads/join",
      3,
      { squadCode: pair.squadCode, alias: "Outsider" },
      403,
    );
    await api(
      `/squads/${pair.squadId}/invite-user`,
      0,
      { userId: people[3].id },
      403,
    );
    await api(
      `/squads/${pair.squadId}/visibility`,
      0,
      { visibility: "open" },
      403,
    );
    console.log("Accepted exact private pair");
    const ticket = await api(`/squads/${id}/games/token`, 0, {});
    const claims = jwt.verify(ticket.ticket, process.env.GAME_BRIDGE_SECRET);
    assert.equal(claims.sub, created.selfUserId);
    assert.equal(claims.displayName, "Quiet Fox");
    privateFree(claims);
    const my = await api("/squads/mine");
    privateFree(my);
    const preview = await api(`/squads/${id}/preview`, 3);
    privateFree(preview);
    console.log("Checked Games ticket and membership projections");
    const connect = async (i) => {
      const s = io(base, {
        transports: ["websocket"],
        auth: { token: people[i].token },
        reconnection: false,
      });
      sockets.push(s);
      await new Promise((resolve, reject) => {
        s.once("connect", resolve);
        s.once("connect_error", reject);
      });
      return s;
    };
    const joined = await Promise.all([0, 1, 2].map(connect));
    const send = (s, event, payload) =>
      new Promise((resolve, reject) =>
        s
          .timeout(5000)
          .emit(event, payload, (e, reply) => (e ? reject(e) : resolve(reply))),
      );
    const leases = await Promise.all(
      joined.map((s) =>
        send(s, "group_presence", { squadId: id, action: "begin" }),
      ),
    );
    assert(leases.every((l) => l.ok));
    assert.equal((await api("/squads/" + id)).onlineCount, 3);
    const tab2 = await connect(1),
      extra = await send(tab2, "group_presence", {
        squadId: id,
        action: "begin",
      });
    joined[1].disconnect();
    await delay(150);
    assert.equal((await api("/squads/" + id)).onlineCount, 3);
    console.log("Checked scoped multi-tab presence");
    const received = new Promise((resolve) =>
      joined[2].once("new_message", resolve),
    );
    const ack = await send(joined[0], "send_message", {
      squadId: id,
      text: "Hello group",
      senderId: people[2].id,
      senderName: people[2].name,
      clientMessageId: "group-test-message",
    });
    assert(ack.ok);
    privateFree(ack);
    assert.equal(ack.message.senderId, created.selfUserId);
    assert.equal(ack.message.senderName, "Quiet Fox");
    privateFree(await received);
    const reaction = new Promise((resolve) =>
      joined[2].once("new_reaction", resolve),
    );
    joined[0].emit("send_reaction", { squadId: id, emoji: "❤️" });
    privateFree(await reaction);
    const directory = await api("/squads/discover", 3);
    privateFree(directory);
    const listed = directory.squads.find((g) => g.squadId === id);
    assert.equal(listed.onlineCount, 3);
    assert.equal(listed.memberCount, 3);
    assert(
      !("members" in listed) &&
        !("squadCode" in listed) &&
        !("leaderName" in listed),
    );
    const squadsCollection = mongo.db(database).collection("squads");
    await squadsCollection.insertMany(
      Array.from({ length: 35 }, (_, i) => ({
        squadId: "search-fill-" + i,
        squadCode: "SEARCH" + i,
        squadName: "Later fixture " + i,
        description: "Search fixture",
        visibility: "open",
        joinPolicy: "open",
        status: "idle",
        members: [
          { userId: people[0].id, memberId: "fill-" + i, role: "leader" },
        ],
        maxSlots: 4,
        communicationMode: "video",
        publicTopic: "games",
        language: "en",
        createdAt: new Date(Date.now() + i + 1000),
      })),
    );
    const searched = await api(
      "/squads/discover?search=" +
        encodeURIComponent("Local alias") +
        "&communicationMode=chat&publicTopic=banter",
      3,
    );
    assert.deepEqual(
      searched.squads.map((g) => g.squadId),
      [id],
    );
    privateFree(searched);
    assert.equal(
      (
        await api(
          "/squads/discover?search=" + encodeURIComponent(people[0].name),
          3,
        )
      ).squads.length,
      0,
    );
    assert.equal(
      (await api("/squads/discover?search=" + encodeURIComponent(".*"), 3))
        .squads.length,
      0,
    );
    assert.equal(
      (await api("/squads/discover?search=Local&communicationMode=voice", 3))
        .squads.length,
      0,
    );
    await api("/squads/discover?search=" + "x".repeat(81), 3, undefined, 400);
    await squadsCollection.deleteMany({ squadId: /^search-fill-/ });
    const other = await api(
      "/squads/create",
      2,
      { squadName: "Other group", identityMode: "aliases", alias: "New Leaf" },
      201,
    );
    await send(joined[2], "group_presence", {
      squadId: other.squadId,
      action: "begin",
    });
    assert.equal((await api("/squads/" + id)).onlineCount, 2);
    console.log("Checked chat/reaction and directory projections");
    const voice = await api(
      "/squads/create",
      0,
      {
        squadName: "Voice fixture",
        identityMode: "aliases",
        communicationMode: "voice",
        alias: "Quiet Voice",
      },
      201,
    );
    const token = await api(`/agora/lobby-token/${voice.squadId}`, 0, {});
    assert.equal(token.audioOnly, true);
    const {
      AccessToken,
      priviledges,
    } = require("agora-access-token/src/AccessToken");
    const decoded = new AccessToken();
    assert(decoded.fromString(token.rtcToken));
    assert(decoded.messages[priviledges.kPublishAudioStream]);
    assert.equal(decoded.messages[priviledges.kPublishVideoStream], undefined);
    await api(`/squads/${voice.squadId}/search`, 0, {}, 409);
    const collection = mongo.db(database).collection("safetyreports");
    await collection.createIndex(
      { reporterUserId: 1, encounterId: 1, targetSquadId: 1 },
      { unique: true, name: "legacy_encounter_reports" },
    );
    const legacyReport = {
      reportId: "legacy-report-fixture",
      reporterUserId: people[0].id,
      encounterId: "legacy-encounter-fixture",
      targetSquadId: "legacy-target-fixture",
      category: "other",
    };
    await collection.insertOne(legacyReport);
    const { migrate } = require("../../scripts/migrate-group-reports");
    const dry = await migrate(collection);
    assert.equal(dry.mode, "dry-run");
    assert.equal(dry.backfill, 1);
    assert.equal(
      (await collection.findOne({ reportId: legacyReport.reportId })).scope,
      undefined,
    );
    assert.equal(
      (await collection.listIndexes().toArray()).some(
        (i) => i.name === "legacy_encounter_reports",
      ),
      true,
    );
    const applied = await migrate(collection, { apply: true });
    assert.equal(applied.removedLegacyIndexes, 1);
    assert.equal(
      (await collection.findOne({ reportId: legacyReport.reportId })).scope,
      "encounter",
    );
    assert.equal(
      (await migrate(collection, { apply: true })).removedLegacyIndexes,
      0,
    );
    console.log(
      "Isolated report migration " + JSON.stringify({ dry, applied }),
    );
    const report1 = await api(`/squads/${id}/members/${handleB}/report`, 0, {
        category: "spam",
        details: "Test report B",
      }),
      report2 = await api(`/squads/${id}/members/${handleC}/report`, 0, {
        category: "other",
        details: "Test report C",
      });
    assert.notEqual(report1.reportId, report2.reportId);
    assert.equal(
      (
        await api(`/squads/${id}/members/${handleB}/report`, 0, {
          category: "spam",
          details: "Test report B",
        })
      ).reportId,
      report1.reportId,
    );
    assert.equal(await collection.countDocuments({ scope: "group" }), 2);
    console.log(
      "Checking managed group invites, bans, ownership and pending requests",
    );
    const managed = await api(
      "/squads/create-group",
      0,
      {
        squadName: "Managed invite group",
        description: "A local fixture group",
        publicTopic: "games",
        language: "en",
        visibility: "private",
        joinPolicy: "invite",
        identityMode: "aliases",
        communicationMode: "video",
        alias: "Quiet Host",
      },
      201,
    );
    const gid = managed.squadId;
    await api(`/squads/${gid}/group-preview`, 1, {}, 404);
    await api(`/squads/${gid}/preview`, 1, undefined, 404);
    const invite = await api(`/squads/${gid}/group-invite`, 0, {});
    assert.match(invite.invite, /^[a-f0-9]{64}$/);
    const safe = await api(`/squads/${gid}/group-preview`, 1, {
      invite: invite.invite,
    });
    privateFree(safe);
    assert.equal(safe.viewerMembership, "none");
    assert.equal(safe.publicTopic, "games");
    assert.equal(safe.language, "en");
    assert.equal(safe.onlineCount, 0);
    assert(!("members" in safe) && !("squadCode" in safe));
    await api(`/squads/${gid}/group-join`, 1, {
      invite: invite.invite,
      alias: "Calm Guest",
    });
    await api(`/squads/${gid}/group-invite`, 1, { rotate: true }, 403);
    // Pause rotation after it owns the real Redis lock. A join can locate the
    // old proof now, but must reread after rotation commits to real Mongo.
    const { Squad: SquadModel } = require("../../src/models/Squad");
    const originalFindOne = SquadModel.findOne;
    let announceRead,
      finishRotation,
      readsBeforePause = 2;
    const readStarted = new Promise((resolve) => (announceRead = resolve));
    const rotationGate = new Promise((resolve) => (finishRotation = resolve));
    SquadModel.findOne = async function (...args) {
      const value = await originalFindOne.apply(this, args);
      if (args[0]?.squadId === gid && --readsBeforePause === 0) {
        announceRead();
        await rotationGate;
      }
      return value;
    };
    let rotated;
    try {
      const rotating = api(`/squads/${gid}/group-invite`, 0, { rotate: true });
      await readStarted;
      await delay(10500);
      assert(
        (await redis.pttl(`lock:squad:${gid}:admission`)) > 0,
        "slow rotation still owns its renewed admission lock",
      );
      const staleJoin = api(
        `/squads/${gid}/group-join`,
        2,
        { invite: invite.invite, alias: "Waiting Guest" },
        403,
      );
      const finished = Promise.allSettled([rotating, staleJoin]);
      await delay(40);
      finishRotation();
      const outcomes = await finished;
      for (const outcome of outcomes)
        if (outcome.status === "rejected") throw outcome.reason;
      rotated = outcomes[0].value;
    } finally {
      finishRotation();
      SquadModel.findOne = originalFindOne;
    }
    assert.notEqual(rotated.invite, invite.invite);
    await api(
      `/squads/${gid}/group-preview`,
      2,
      { invite: invite.invite },
      404,
    );
    await api(`/squads/${gid}/group-join`, 2, {
      invite: rotated.invite,
      alias: "Soft Guest",
    });
    // Delay a real Mongo write after its version condition is built, then let
    // a newer rotation commit first. Also cover persisted legacy rows with no __v.
    const {
      guardSquadWrites,
    } = require("../../src/services/squadAdmissionService");
    for (const legacyWithoutVersion of [false, true]) {
      if (legacyWithoutVersion)
        await mongo
          .db(database)
          .collection("squads")
          .updateOne({ squadId: gid }, { $unset: { __v: "" } });
      const old = guardSquadWrites(await SquadModel.findOne({ squadId: gid }), {
        aborted: false,
      });
      const newer = guardSquadWrites(
        await SquadModel.findOne({ squadId: gid }),
        { aborted: false },
      );
      const collection = SquadModel.collection,
        originalUpdate = collection.updateOne;
      let entered,
        resume,
        first = true;
      const pendingWrite = new Promise((resolve) => (entered = resolve)),
        gate = new Promise((resolve) => (resume = resolve));
      collection.updateOne = async function (...args) {
        if (first) {
          first = false;
          entered();
          await gate;
        }
        return originalUpdate.apply(this, args);
      };
      try {
        old.groupInvite = "c".repeat(64);
        const oldOutcome = Promise.allSettled([old.save()]);
        await pendingWrite;
        newer.groupInvite = "d".repeat(64);
        await newer.save();
        resume();
        const [outcome] = await oldOutcome;
        assert.equal(outcome.status, "rejected");
        assert.equal(outcome.reason.code, "GROUP_CHANGED");
        assert.equal(
          (await originalFindOne.call(SquadModel, { squadId: gid }))
            .groupInvite,
          "d".repeat(64),
        );
      } finally {
        resume();
        collection.updateOne = originalUpdate;
      }
      const restored = guardSquadWrites(
        await SquadModel.findOne({ squadId: gid }),
        { aborted: false },
      );
      restored.groupInvite = rotated.invite;
      await restored.save();
    }
    const getManaged = await api("/squads/" + gid);
    privateFree(getManaged);
    assert(!JSON.stringify(getManaged).includes(rotated.invite));
    const guest = getManaged.members.find(
      (m) => m.displayName === "Calm Guest",
    ).memberId;
    const rtc = await api(`/agora/lobby-token/${gid}`, 0, {});
    assert.equal(rtc.expiresIn, 90);
    assert.equal(
      rtc.uid,
      getManaged.members.find((m) => m.memberId === getManaged.selfMemberId)
        .uid,
    );
    assert.equal(rtc.allowedRemoteUids.length, 2);
    await api(`/squads/${gid}/group-ban/${guest}`, 0, {});
    await api(
      `/squads/${gid}/group-join`,
      1,
      { invite: rotated.invite, alias: "Calm Guest" },
      403,
    );
    await api(
      "/squads/join",
      1,
      { squadCode: getManaged.squadCode, alias: "Calm Guest" },
      403,
    );
    const bans = await api(`/squads/${gid}/group-bans`);
    privateFree(bans);
    assert.equal(bans.bans.length, 1);
    assert.equal((await api("/squads/" + gid)).members.length, 2);
    assert.equal(
      (await api(`/agora/lobby-token/${gid}`, 0, {})).allowedRemoteUids.length,
      1,
    );
    await api(`/squads/${gid}/group-unban/${bans.bans[0].memberId}`, 0, {});
    await api(`/squads/${gid}/group-join`, 1, {
      invite: rotated.invite,
      alias: "Calm Guest",
    });
    const updated = await api(`/squads/${gid}/group-settings`, 0, {
      description: "Updated fixture group",
      publicTopic: "banter",
      language: "hi",
    });
    assert.equal(updated.description, "Updated fixture group");
    assert.equal(updated.publicTopic, "banter");
    assert.equal(updated.language, "hi");
    await api(
      `/squads/${gid}/group-settings`,
      0,
      { identityMode: "names" },
      400,
    );
    await api(`/squads/${gid}/leave`, 0, {}, 409);
    await api(`/squads/${gid}/group-leave`, 0, {}, 409);
    const promoted = await api(
      `/squads/${gid}/members/${guest}/promote`,
      0,
      {},
    );
    assert.equal(promoted.newLeaderMemberId, guest);
    const newOwner = await api("/squads/" + gid, 1);
    await api(
      `/squads/${gid}/members/${newOwner.members.find((m) => m.userId === managed.selfUserId).memberId}/promote`,
      1,
      {},
    );
    await api(`/squads/${gid}/group-leave`, 0, { transferToMemberId: guest });
    await api("/squads/" + gid, 0, undefined, 403);
    const owned = await api("/squads/" + gid, 1);
    assert.equal(
      owned.members.find((m) => m.memberId === owned.selfMemberId).role,
      "leader",
    );
    await api(`/squads/${gid}/group-delete`, 1, {});
    const requested = await api(
      "/squads/create-group",
      0,
      {
        squadName: "Join requests",
        visibility: "open",
        joinPolicy: "request",
        identityMode: "aliases",
        communicationMode: "chat",
        alias: "Quiet Owner",
      },
      201,
    );
    assert.equal(
      (
        await api(`/squads/${requested.squadId}/group-join`, 1, {
          alias: "Calm Request",
        })
      ).status,
      "requested",
    );
    assert.equal(
      (await api(`/squads/${requested.squadId}/group-preview`, 1, {}))
        .viewerMembership,
      "pending",
    );
    await api(`/squads/${requested.squadId}/group-cancel-join`, 1, {});
    assert.equal(
      (await api(`/squads/${requested.squadId}/requests`)).requests.length,
      0,
    );
    await api(`/squads/${requested.squadId}/group-join`, 1, {
      alias: "Calm Request",
    });
    const pending = await api(`/squads/${requested.squadId}/requests`);
    privateFree(pending);
    await api(
      `/squads/${requested.squadId}/requests/${pending.requests[0].userId}/approve`,
      0,
      {},
    );
    privateFree(await api("/squads/" + requested.squadId, 1));
    const legacy = await api(
      "/squads/create",
      0,
      { squadName: "Legacy private fixture" },
      201,
    );
    assert.equal(legacy.managedGroup, false);
    await api("/squads/join", 1, { squadCode: legacy.squadCode });
    await api("/users/block", 0, { squadId: id, userIds: [handleB] });
    console.log(
      JSON.stringify({
        realMongoReplica: true,
        realRedis: true,
        realHttpAndSockets: true,
        aliasesAllPaths: true,
        scopedMultiTabPresence: true,
        mutualPair: true,
        voicePrivileges: true,
        reportMigrationDryRunAndApply: true,
        groupReportsDistinct: true,
        managedInvitesBansOwnership: true,
        legacyInviteCompatibility: true,
        metadataSearchBeforeCap: true,
        atomicInviteRotation: true,
        renewedSlowAdmission: true,
        inFlightVersionFenceIncludingLegacy: true,
        scopedOwnershipTransfer: true,
      }),
    );
  } finally {
    sockets.forEach((s) => s.disconnect());
    if (apiServer) {
      const exit = process.exit;
      process.exit = (code) => {
        if (code) process.exitCode = code;
      };
      try {
        await apiServer.shutdown("test");
      } finally {
        process.exit = exit;
      }
    }
    redis?.disconnect();
    await mongo?.close();
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise((r) => child.once("exit", r)),
      ),
    );
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
