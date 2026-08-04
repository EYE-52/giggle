const User = require("../models/User");
const { Squad } = require("../models/Squad");
const { Notification } = require("../models/Notification");
const SafetyReport = require("../models/SafetyReport");
const { getRequesterIdentity } = require("../app/squadAccess");
const { requestAccountDeletion } = require("../services/accountDeletionService");
const { canonicalUserId, relationalIdMatcher } = require("../services/interactionSafetyService");

const USER_EXPORT_FIELDS = [
  "_id email name image birthDate ageConfirmed isAdult ageVerified ageVerification.provider",
  "ageVerification.status ageVerification.method ageVerification.threshold ageVerification.policyVersion",
  "ageVerification.requestedAt ageVerification.verifiedAt gender languages country vibes friends",
  "blockedUserIds isApproved isPremium premiumExpiresAt isSuspended isShadowBanned deletionStatus",
  "referralCode referredBy referralCount tokens createdAt updatedAt",
].join(" ");
const CONTACT_EXPORT_FIELDS = "_id name image";
const SQUAD_EXPORT_FIELDS =
  "squadId squadCode squadName status visibility joinPolicy tags coverImage members.userId members.displayName members.role members.joinedAt createdAt";
const NOTIFICATION_EXPORT_FIELDS =
  "_id type title body fromUserId fromName squadId squadCode squadName read createdAt";
const REPORT_EXPORT_FIELDS =
  "_id reporterSquadId targetSquadId targetUserIds encounterId category details status createdAt updatedAt";

const iso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const id = (value) => value == null ? null : String(value);

const buildAccountExport = async (userId, dependencies = {}) => {
  const deps = {
    User,
    Squad,
    Notification,
    SafetyReport,
    now: () => new Date(),
    ...dependencies,
  };
  const accountId = canonicalUserId(userId);
  if (!accountId) return null;
  const identityMatcher = relationalIdMatcher(accountId);
  const user = await deps.User.findById(accountId, USER_EXPORT_FIELDS);
  if (!user) return null;

  const friendIds = (user.friends || []).map(id).filter(Boolean);
  const blockedIds = (user.blockedUserIds || []).map(id).filter(Boolean);
  const [contacts, squads, notifications, reports] = await Promise.all([
    deps.User.find({ _id: { $in: [...new Set([...friendIds, ...blockedIds])] } }, CONTACT_EXPORT_FIELDS),
    deps.Squad.find({ "members.userId": identityMatcher }, SQUAD_EXPORT_FIELDS),
    deps.Notification.find({ userId: identityMatcher }, NOTIFICATION_EXPORT_FIELDS, { sort: { createdAt: 1 } }),
    deps.SafetyReport.find({ reporterUserId: identityMatcher }, REPORT_EXPORT_FIELDS, { sort: { createdAt: 1 } }),
  ]);
  const contactsById = new Map(contacts.map((contact) => [id(contact._id), contact]));
  const mapContact = (contactId) => {
    const contact = contactsById.get(contactId);
    return {
      userId: contactId,
      name: contact?.name ?? null,
      image: contact?.image ?? null,
    };
  };
  const verification = user.ageVerification || {};
  const unavailable = user.isSuspended === true || user.isShadowBanned === true;

  return {
    generatedAt: deps.now().toISOString(),
    account: {
      id: id(user._id),
      email: user.email ?? null,
      status: user.deletionStatus === "pending"
        ? "pending_deletion"
        : unavailable ? "unavailable" : "active",
      isApproved: user.isApproved === true,
      isPremium: user.isPremium === true,
      premiumExpiresAt: iso(user.premiumExpiresAt),
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
    },
    ageAssurance: {
      birthDate: iso(user.birthDate)?.slice(0, 10) ?? null,
      ageConfirmed: user.ageConfirmed === true,
      isAdult: user.isAdult === true,
      ageVerified: user.ageVerified === true,
      provider: verification.provider ?? null,
      status: verification.status ?? "not_started",
      method: verification.method ?? null,
      threshold: verification.threshold ?? null,
      policyVersion: verification.policyVersion ?? null,
      requestedAt: iso(verification.requestedAt),
      verifiedAt: iso(verification.verifiedAt),
    },
    profile: {
      name: user.name ?? null,
      image: user.image ?? null,
      gender: user.gender ?? null,
      languages: (user.languages || []).map(String),
      country: user.country ?? null,
      vibes: (user.vibes || []).map(String),
    },
    friends: friendIds.map(mapContact),
    blocks: blockedIds.map(mapContact),
    squads: squads.map((squad) => ({
      squadId: squad.squadId,
      squadCode: squad.squadCode,
      squadName: squad.squadName,
      status: squad.status,
      visibility: squad.visibility,
      joinPolicy: squad.joinPolicy,
      tags: (squad.tags || []).map(String),
      coverImage: squad.coverImage ?? null,
      members: (squad.members || []).map((member) => ({
        userId: id(member.userId),
        displayName: member.displayName ?? null,
        role: member.role,
        joinedAt: iso(member.joinedAt),
      })),
      createdAt: iso(squad.createdAt),
    })),
    notifications: notifications.map((notification) => ({
      id: id(notification._id),
      type: notification.type,
      title: notification.title ?? null,
      body: notification.body ?? null,
      fromUserId: id(notification.fromUserId),
      fromName: notification.fromName ?? null,
      squadId: notification.squadId ?? null,
      squadCode: notification.squadCode ?? null,
      squadName: notification.squadName ?? null,
      read: notification.read === true,
      createdAt: iso(notification.createdAt),
    })),
    safetyReports: reports.map((report) => ({
      id: id(report._id),
      reporterSquadId: report.reporterSquadId,
      targetSquadId: report.targetSquadId,
      targetUserIds: (report.targetUserIds || []).map(id).filter(Boolean),
      encounterId: report.encounterId,
      category: report.category,
      details: report.details || "",
      status: report.status,
      createdAt: iso(report.createdAt),
      updatedAt: iso(report.updatedAt),
    })),
    walletAndReferral: {
      referralCode: user.referralCode ?? null,
      referredBy: id(user.referredBy),
      referralCount: Number(user.referralCount) || 0,
      tokens: Number(user.tokens) || 0,
    },
  };
};

const exportAccountHandler = async (req, res) => {
  try {
    const data = await buildAccountExport(getRequesterIdentity(req).userId);
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Account export failed:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "EXPORT_FAILED", message: "Unable to export account data" },
    });
  }
};

const deleteAccountHandler = async (req, res) => {
  try {
    const result = await requestAccountDeletion(getRequesterIdentity(req).userId);
    return res.status(result.status === "pending" ? 202 : 200).json({ ok: true, data: result });
  } catch (error) {
    console.error("Account deletion staging failed:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "DELETION_FAILED", message: "Unable to start account deletion" },
    });
  }
};

module.exports = {
  buildAccountExport,
  exportAccountHandler,
  deleteAccountHandler,
};
