const { createHash } = require("node:crypto");
const User = require("../models/User");
const { Squad } = require("../models/Squad");
const { Notification } = require("../models/Notification");
const SafetyReport = require("../models/SafetyReport");
const { redlock } = require("../config/redisConfig");
const { removeSquadMember } = require("../app/squadAccess");
const { disconnectUserSockets } = require("./socketService");
const { canonicalUserId, relationalIdMatcher } = require("./interactionSafetyService");

const LOCK_DURATION_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;
let sweepTimer = null;

const dependencies = (overrides = {}) => ({
  User,
  Squad,
  Notification,
  SafetyReport,
  redlock,
  removeSquadMember,
  disconnectUserSockets,
  now: () => new Date(),
  logger: console,
  ...overrides,
});

const cleanupAccount = async (userId, deps, signal) => {
  const user = await deps.User.findById(userId, "_id referredBy deletionStatus");
  if (!user) return { status: "deleted" };
  if (user.deletionStatus !== "pending") throw new Error("Account deletion was not staged");

  const matcher = relationalIdMatcher(userId);
  await deps.User.updateMany({}, {
    $pull: {
      friends: matcher,
      friendRequestsIncoming: matcher,
      friendRequestsOutgoing: matcher,
      blockedUserIds: matcher,
    },
  });

  await deps.User.updateMany({ referredBy: matcher }, { $set: { referredBy: null } });
  const referrerId = canonicalUserId(user.referredBy);
  if (referrerId) {
    const referralCount = await deps.User.countDocuments({
      _id: { $ne: userId },
      referredBy: relationalIdMatcher(referrerId),
    });
    await deps.User.updateOne({ _id: referrerId }, { $set: { referralCount } });
  }

  await deps.Squad.updateMany({}, {
    $pull: {
      invitedUserIds: matcher,
      joinRequests: { userId: matcher },
    },
  });
  const squads = await deps.Squad.find({ "members.userId": matcher });
  for (const squad of squads) {
    const memberIndex = (squad.members || []).findIndex(
      (member) => canonicalUserId(member.userId) === canonicalUserId(userId)
    );
    if (memberIndex >= 0) await deps.removeSquadMember(squad, memberIndex);
  }

  await deps.Notification.deleteMany({
    $or: [{ userId: matcher }, { fromUserId: matcher }],
  });

  const pseudonym = `deleted:${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
  await deps.SafetyReport.updateMany(
    { reporterUserId: matcher },
    { $set: { reporterUserId: pseudonym } }
  );
  await deps.SafetyReport.updateMany(
    { targetUserIds: matcher },
    { $pull: { targetUserIds: matcher } }
  );

  if (signal.aborted) throw signal.error || new Error("Account deletion lock was lost");
  await deps.User.deleteOne({ _id: userId, deletionStatus: "pending" });
  return { status: "deleted" };
};

const resumeAccountDeletion = async (userId, overrides = {}) => {
  const deps = dependencies(overrides);
  const accountId = canonicalUserId(userId);
  if (!accountId) throw new Error("Invalid account id");
  try {
    deps.disconnectUserSockets(accountId);
    // ponytail: Mongo and Redis cannot share a transaction; pending + idempotent
    // retries are the recovery boundary. Add an external job queue only at scale.
    return await deps.redlock.using(
      [`lock:account-delete:${accountId}`],
      LOCK_DURATION_MS,
      (signal) => cleanupAccount(accountId, deps, signal)
    );
  } catch (error) {
    deps.logger.error(`Account deletion cleanup failed for ${accountId}:`, error);
    return { status: "pending" };
  }
};

const requestAccountDeletion = async (userId, overrides = {}) => {
  const deps = dependencies(overrides);
  const accountId = canonicalUserId(userId);
  if (!accountId) throw new Error("Invalid account id");
  const staged = await deps.User.findOneAndUpdate(
    { _id: accountId, deletionStatus: { $ne: "pending" } },
    { $set: {
      deletionStatus: "pending",
      deletionRequestedAt: deps.now(),
      ageVerified: false,
    } },
    { new: true, select: "_id deletionStatus referredBy" }
  );
  if (!staged) {
    const existing = await deps.User.findById(accountId, "_id deletionStatus");
    if (!existing) return { status: "deleted" };
  }
  return resumeAccountDeletion(accountId, deps);
};

const sweepPendingAccountDeletions = async (options = {}) => {
  const deps = dependencies(options);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const processAccount = options.processAccount || resumeAccountDeletion;
  const users = await deps.User.find(
    { deletionStatus: "pending" },
    "_id",
    { sort: { deletionRequestedAt: 1 }, limit }
  );
  let deleted = 0;
  let pending = 0;
  for (const user of users) {
    try {
      const result = await processAccount(String(user._id), deps);
      if (result?.status === "deleted") deleted += 1;
      else pending += 1;
    } catch (error) {
      deps.logger.error(`Account deletion retry failed for ${user._id}:`, error);
      pending += 1;
    }
  }
  return { attempted: users.length, deleted, pending };
};

const startAccountDeletionSweeper = (options = {}) => {
  if (sweepTimer) return sweepTimer;
  const setIntervalFn = options.setIntervalFn || setInterval;
  sweepTimer = setIntervalFn(() => {
    void sweepPendingAccountDeletions(options).catch((error) => {
      (options.logger || console).error("Account deletion sweep failed:", error);
    });
  }, SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  return sweepTimer;
};

module.exports = {
  requestAccountDeletion,
  resumeAccountDeletion,
  sweepPendingAccountDeletions,
  startAccountDeletionSweeper,
};
