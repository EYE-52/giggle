const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");

function section(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(startAt, -1);
  assert.notEqual(endAt, -1);
  return source.slice(startAt, endAt);
}

test("public squad discovery and preview do not expose join codes or member demographics", () => {
  const controller = read("src/controllers/squadController.js");
  const routes = read("src/routes/squadRoutes.js");
  const publicSerializer = section(controller, "const toPublicSquad", "const findJoinableSquads");
  const previewHandler = section(controller, "const getSquadPreviewHandler", "const updateReadyStateHandler");
  const discoverQuery = section(controller, "const findJoinableSquads", "const discoverSquadsHandler");

  assert.equal(publicSerializer.includes("squadCode:"), false);
  assert.equal(previewHandler.includes("squadCode:"), false);
  for (const field of ["gender", "age", "languages", "country"]) {
    assert.equal(new RegExp(`\\b${field}\\s*:`).test(previewHandler), false);
  }
  assert.equal(routes.includes('router.post("/squads/:squadId/join", requireApiAuth, joinSquadHandler);'), true);
  assert.equal(discoverQuery.includes('joinPolicy: { $in: ["open", "request"] }'), true);
});

test("public squad discovery and preview normalize stale display fields", () => {
  const controller = read("src/controllers/squadController.js");
  const publicSerializer = section(controller, "const toPublicSquad", "const findJoinableSquads");
  const previewHandler = section(controller, "const getSquadPreviewHandler", "const updateReadyStateHandler");

  assert.equal(controller.includes("const publicSquadName = (squad) =>"), true);
  assert.equal(controller.includes("const publicMemberName = (member) =>"), true);
  assert.equal(controller.includes("const publicSquadTags = (squad) =>"), true);
  assert.equal(publicSerializer.includes("squadName: publicSquadName(squad),"), true);
  assert.equal(publicSerializer.includes("tags: publicSquadTags(squad),"), true);
  assert.equal(publicSerializer.includes("leaderName: leader ? publicMemberName(leader) : undefined,"), true);
  assert.equal(previewHandler.includes("squadName: publicSquadName(squad),"), true);
  assert.equal(previewHandler.includes("displayName: publicMemberName(member),"), true);
  assert.equal(previewHandler.includes("tags: publicSquadTags(squad),"), true);
});

test("squad premium capacity status is resolved live but not sent to matchmaking queue", () => {
  const controller = read("src/controllers/squadController.js");
  const queueService = read("src/services/queueService.js");
  const createHandler = section(controller, "const createSquadHandler", "const joinSquadHandler");
  const searchHandler = section(controller, "const startSearchHandler", "const cancelSearchHandler");

  assert.equal(controller.includes("const getSquadPremiumStatus = async (squad) =>"), true);
  assert.equal(createHandler.includes("isPremiumSquad: await getUserPremiumStatus(userId)"), true);
  assert.equal(createHandler.includes("const { userId, providerAccountId, name, email, isPremium } = identity"), false);
  assert.equal(searchHandler.includes("squad.isPremiumSquad = await getSquadPremiumStatus(squad);"), true);
  assert.equal(searchHandler.includes("queueService.addToQueue(squad.squadId, squad.members.length, squad.searchRegion, squad.tags, squad.reputationScore, squad.isPremiumSquad)"), false);
  assert.equal(queueService.includes("isPremiumSquad"), false);
});

test("start search rolls back squad state when queue insertion fails", () => {
  const controller = read("src/controllers/squadController.js");
  const searchHandler = section(controller, "const startSearchHandler", "const cancelSearchHandler");

  assert.equal(searchHandler.includes("let searchStateSaved = false;"), true);
  assert.equal(searchHandler.includes("searchStateSaved = true;"), true);
  assert.equal(searchHandler.includes("if (searchStateSaved)"), true);
  assert.equal(searchHandler.includes('squad.status = "idle";'), true);
  assert.equal(searchHandler.includes("squad.searchQueuedAt = null;"), true);
  assert.equal(searchHandler.indexOf("searchStateSaved = true;") < searchHandler.indexOf("await queueService.addToQueue"), true);
});

test("encounter requeue rolls squads back to idle when Redis queue insertion fails", () => {
  const service = read("src/services/matchmakingService.js");
  const requeueHandler = section(service, "const endEncounterAndRequeue", "const endEncounterToIdle");

  assert.equal(service.includes("const rollbackSquadsToIdle = async"), true);
  assert.equal(requeueHandler.includes("const requeuedSquadIds = [];"), true);
  assert.equal(requeueHandler.includes("requeuedSquadIds.push(s.squadId);"), true);
  assert.match(requeueHandler, /catch \(error\) \{[\s\S]*await rollbackSquadsToIdle\(squadIds\);[\s\S]*throw error;[\s\S]*\}/);
});

test("asymmetric encounter end rolls opponent back to idle when requeue fails", () => {
  const service = read("src/services/matchmakingService.js");
  const asymmetricHandler = section(service, "const endEncounterAsymmetric", "// ── Stuck-encounter sweeper");

  assert.equal(asymmetricHandler.includes("let otherQueued = false;"), true);
  assert.equal(asymmetricHandler.includes('reason: "squad_disconnected"'), true);
  assert.equal(asymmetricHandler.includes("endedBySquadId: disconnectingSquadId"), true);
  assert.equal(asymmetricHandler.includes("otherQueued = true;"), true);
  assert.match(asymmetricHandler, /catch \(error\) \{[\s\S]*if \(!otherQueued\) \{[\s\S]*await rollbackSquadsToIdle\(\[otherSquadId\]\);[\s\S]*\}[\s\S]*throw error;[\s\S]*\}/);
});

test("squad creation accepts normalized initial tags atomically", () => {
  const controller = read("src/controllers/squadController.js");
  const createHandler = section(controller, "const createSquadHandler", "const joinSquadHandler");

  assert.equal(createHandler.includes("const { displayName, squadName, tags, visibility } = req.body;"), true);
  assert.equal(createHandler.includes("const normalizedTags = normalizeSquadTags(tags ?? []);"), true);
  assert.equal(createHandler.includes("tags: normalizedTags.tags,"), true);
});

test("squad creation validates and persists optional initial visibility", () => {
  const controller = read("src/controllers/squadController.js");
  const createHandler = section(controller, "const createSquadHandler", "const joinSquadHandler");

  assert.equal(createHandler.includes("const { displayName, squadName, tags, visibility } = req.body;"), true);
  assert.equal(createHandler.includes('const normalizedVisibility = visibility ?? "private";'), true);
  assert.equal(createHandler.includes('["private", "open"].includes(normalizedVisibility)'), true);
  assert.equal(createHandler.includes('code: "INVALID_VISIBILITY"'), true);
  assert.equal(createHandler.includes("visibility: normalizedVisibility,"), true);
});

test("squad creation API docs include initial name and tags", () => {
  const routes = read("src/routes/squadRoutes.js");
  const createDocs = section(routes, " * /squads/create:", "router.post(\"/squads/create\"");

  assert.equal(createDocs.includes("squadName:"), true);
  assert.equal(createDocs.includes("tags:"), true);
  assert.equal(createDocs.includes("visibility:"), true);
  assert.equal(createDocs.includes("maxItems: 5"), true);
  assert.equal(createDocs.includes("User already belongs to another squad"), false);
});

test("squad join API docs do not claim other squad membership blocks joining", () => {
  const routes = read("src/routes/squadRoutes.js");
  const joinDocs = section(routes, " * /squads/join:", "router.post(\"/squads/join\"");

  assert.equal(joinDocs.includes("user already in another squad"), false);
});

test("approving a join request rejects stale deleted users", () => {
  const controller = read("src/controllers/squadController.js");
  const approveHandler = section(controller, "const approveJoinRequestHandler", "const declineJoinRequestHandler");

  assert.equal(approveHandler.includes("const targetUser = await User.findById(targetUserId);"), true);
  assert.equal(approveHandler.includes('code: "REQUEST_USER_NOT_FOUND"'), true);
  assert.equal(approveHandler.indexOf("REQUEST_USER_NOT_FOUND") < approveHandler.indexOf("const newMember = {"), true);
  assert.equal((approveHandler.match(/await resolveJoinRequestNotification\(leaderUserId, targetUserId, squad\.squadId\);/g) ?? []).length, 4);
});

test("squad invite endpoints reject nonexistent user ids", () => {
  const controller = read("src/controllers/squadController.js");
  const leaderInviteHandler = section(controller, "const inviteToSquadHandler", "const revokeInviteHandler");
  const memberInviteHandler = section(controller, "const inviteUserToSquadHandler", "const startSearchHandler");

  assert.equal(controller.includes("const isValidUserObjectId = (value) =>"), true);
  assert.equal(leaderInviteHandler.includes("!isValidUserObjectId(targetUserId)"), true);
  assert.equal(memberInviteHandler.includes("!isValidUserObjectId(targetUserId)"), true);
  assert.equal(leaderInviteHandler.indexOf("!isValidUserObjectId(targetUserId)") < leaderInviteHandler.indexOf("User.findById(targetUserId)"), true);
  assert.equal(memberInviteHandler.indexOf("!isValidUserObjectId(targetUserId)") < memberInviteHandler.indexOf("User.findById(targetUserId)"), true);
  assert.equal(leaderInviteHandler.includes('code: "INVITE_USER_NOT_FOUND"'), true);
  assert.equal(leaderInviteHandler.indexOf("INVITE_USER_NOT_FOUND") < leaderInviteHandler.indexOf("squad.invitedUserIds.push(targetUserId)"), true);
  assert.equal(memberInviteHandler.includes('code: "INVITE_USER_NOT_FOUND"'), true);
  assert.equal(memberInviteHandler.indexOf("INVITE_USER_NOT_FOUND") < memberInviteHandler.indexOf("squad.invitedUserIds.push(targetUserId)"), true);
});

test("joining a squad resolves any matching invite notification", () => {
  const controller = read("src/controllers/squadController.js");
  const joinHandler = section(controller, "const joinSquadHandler", "const getSquadHandler");

  assert.equal(controller.includes("const resolveSquadInviteNotification = async"), true);
  assert.equal(joinHandler.includes("await resolveSquadInviteNotification(userId, squad.squadId);"), true);
  assert.equal((joinHandler.match(/resolveSquadInviteNotification\(userId, squad\.squadId\)/g) ?? []).length, 3);
});
