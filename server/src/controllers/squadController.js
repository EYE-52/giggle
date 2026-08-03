const { Squad } = require("../models/Squad");
const User = require("../models/User");
const {
  MAX_SQUAD_MEMBERS,
  MIN_MEMBERS_TO_SEARCH,
  FREE_MAX_MEMBERS,
  PREMIUM_MAX_MEMBERS,
} = require("../config/appConfig");
const {
  getRequesterIdentity,
  hasIdentityId,
  isSameMember,
  findSquadForIdentity,
  findSquadsForIdentity,
  deleteSquadAndNotifications,
  persistSquadAfterMemberRemoval,
} = require("../app/squadAccess");
const { generateId, generateSquadCode } = require("../utils/idGenerator");
const { tryMatchmakeForSquad } = require("../services/matchmakingService");
const queueService = require("../services/queueService");
const socketService = require("../services/socketService");
const sessionService = require("../services/sessionService");
const { createNotification, deleteNotifications } = require("../models/Notification");
const { shuffle } = require("../utils/random");
const { normalizeSquadTags } = require("../utils/squadValidation");
const { classifyVibe, tagsAreMature, firstBlockedTag } = require("../utils/moderation");
const { normalizeSquadCoverImage } = require("../utils/squadCoverValidation");
const { firstDisplayName } = require("../utils/identityValidation");

// Effective member capacity for a squad: 8 when the leader has Giggle+, else 4.
// Always clamped to the global hard cap (MAX_SQUAD_MEMBERS). Looks up the
// leader's live `isPremium` from the User record so upgrades take effect
// immediately. Falls back to 4 if the leader/user can't be resolved.
const getSquadCapacity = async (squad) => {
  try {
    const leader =
      squad.members.find((m) => m.role === "leader") ||
      (squad.leaderMemberId
        ? squad.members.find((m) => m.memberId === squad.leaderMemberId)
        : null);
    if (!leader || !leader.userId) return FREE_MAX_MEMBERS;
    const leaderUser = await User.findById(leader.userId);
    const isPremium = Boolean(leaderUser && leaderUser.isPremium);
    const capacity = isPremium ? PREMIUM_MAX_MEMBERS : FREE_MAX_MEMBERS;
    return Math.min(capacity, MAX_SQUAD_MEMBERS);
  } catch (error) {
    console.warn("getSquadCapacity failed:", error.message);
    return FREE_MAX_MEMBERS;
  }
};

const getUserPremiumStatus = async (userId) => {
  if (!userId) return false;
  const user = await User.findById(userId).select("isPremium");
  return Boolean(user && user.isPremium);
};

// Defensive: legacy/missing users are treated as NOT adult (must set DOB first).
const getUserIsAdult = async (userId) => {
  if (!userId) return false;
  const user = await User.findById(userId).select("isAdult");
  return Boolean(user && user.isAdult);
};

const getSquadPremiumStatus = async (squad) => {
  try {
    const leader =
      squad.members.find((m) => m.role === "leader") ||
      (squad.leaderMemberId
        ? squad.members.find((m) => m.memberId === squad.leaderMemberId)
        : null);
    return getUserPremiumStatus(leader?.userId);
  } catch (error) {
    console.warn("getSquadPremiumStatus failed:", error.message);
    return false;
  }
};

const normalizeSquadName = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const publicSquadName = (squad) => normalizeSquadName(squad?.squadName).slice(0, 60) || "Untitled squad";

const publicMemberName = (member) => firstDisplayName(member?.displayName, "Someone");

const publicSquadTags = (squad) => {
  const normalized = normalizeSquadTags(squad?.tags ?? []);
  return normalized.tags || [];
};

const isValidUserObjectId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const resolveSquadInviteNotification = async (userId, squadId) =>
  deleteNotifications({ userId, type: "squad_invite", squadId });

const resolveJoinRequestNotification = async (leaderUserId, requesterUserId, squadId) =>
  deleteNotifications({
    userId: leaderUserId,
    type: "join_request",
    fromUserId: requesterUserId,
    squadId,
  });

const getMySquadHandler = async (req, res) => {
  const identity = getRequesterIdentity(req);

  if (!identity.userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  try {
    const squad = await findSquadForIdentity(identity);
    if (!squad) {
      return res.status(200).json({ ok: true, data: { inSquad: false } });
    }

    const member = squad.members.find((candidate) => isSameMember(candidate, identity));
    const leader = squad.members.find((candidate) => candidate.role === "leader");

    return res.status(200).json({
      ok: true,
      data: {
        inSquad: true,
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
        status: squad.status,
        member,
        leaderMemberId: leader ? leader.memberId : null,
        maxSlots: await getSquadCapacity(squad),
        members: squad.members,
      },
    });
  } catch (error) {
    console.error("Error fetching my squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch squad" },
    });
  }
};

const getMySquadsHandler = async (req, res) => {
  const identity = getRequesterIdentity(req);

  if (!identity.userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  try {
    const squads = await findSquadsForIdentity({
      userId: identity.userId,
      providerAccountId: identity.providerAccountId,
    });

    const data = await Promise.all(squads.map(async (squad) => {
      const leader = squad.members.find((m) => m.role === "leader");
      const myMember = squad.members.find((m) => isSameMember(m, identity));
      return {
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
        status: squad.status,
        memberCount: squad.members.length,
        maxSlots: await getSquadCapacity(squad),
        coverImage: squad.coverImage ?? null,
        tags: squad.tags || [],
        leaderName: leader ? leader.displayName : undefined,
        myRole: myMember ? myMember.role : undefined,
        joinPolicy: squad.joinPolicy || "open",
      };
    }));

    return res.status(200).json({ ok: true, data: { squads: data } });
  } catch (error) {
    console.error("Error fetching my squads:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch squads" },
    });
  }
};

const createSquadHandler = async (req, res) => {
  const { displayName, squadName, tags, visibility } = req.body;
  const identity = getRequesterIdentity(req);
  const { userId, providerAccountId, name, email } = identity;

  if (!userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  try {
    // Multi-squad membership: a user may belong to many squads at once, so we
    // no longer reject creation when the user is already in another squad.
    const squadId = generateId("sq");
    const squadCode = generateSquadCode();
    const memberId = generateId("mem");
    const normalizedSquadName = normalizeSquadName(squadName) || `Squad ${squadCode}`;

    if (normalizedSquadName.length < 2 || normalizedSquadName.length > 32) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_SQUAD_NAME", message: "Squad name must be 2-32 characters" },
      });
    }

    const normalizedTags = normalizeSquadTags(tags ?? []);
    if (normalizedTags.error) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_TAGS", message: normalizedTags.error },
      });
    }

    // Server-side content moderation on tags: reject blocked outright, and mark
    // the squad adult when any tag is a "mature" vibe. Never trust the client.
    const blocked = firstBlockedTag(normalizedTags.tags);
    if (blocked) {
      return res.status(400).json({
        ok: false,
        error: { code: "TAG_BLOCKED", message: "One or more tags are not allowed." },
      });
    }
    const isAdultSquad = tagsAreMature(normalizedTags.tags);
    if (isAdultSquad && !(await getUserIsAdult(userId))) {
      return res.status(403).json({
        ok: false,
        error: { code: "AGE_RESTRICTED", message: "You must be 18+ to create an adult squad" },
      });
    }

    const normalizedVisibility = visibility ?? "private";
    if (!["private", "open"].includes(normalizedVisibility)) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_VISIBILITY", message: 'visibility must be "private" or "open"' },
      });
    }

    const newMember = {
      memberId,
      userId,
      providerAccountId,
      displayName: firstDisplayName(displayName, name, email),
      role: "leader",
      ready: false,
      joinedAt: new Date().toISOString(),
    };

    const newSquad = new Squad({
      squadId,
      squadCode,
      squadName: normalizedSquadName,
      status: "idle",
      isPremiumSquad: await getUserPremiumStatus(userId),
      tags: normalizedTags.tags,
      adult: isAdultSquad,
      visibility: normalizedVisibility,
      members: [newMember],
      createdAt: new Date().toISOString(),
    });

    await newSquad.save();

    return res.status(201).json({
      ok: true,
      data: {
        squadId: newSquad.squadId,
        squadCode: newSquad.squadCode,
        squadName: newSquad.squadName,
        tags: newSquad.tags,
        member: newMember,
        members: [newMember],
        status: newSquad.status,
      },
    });
  } catch (error) {
    console.error("Error creating squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to create squad" },
    });
  }
};

const joinSquadHandler = async (req, res) => {
  const { squadCode, displayName } = req.body;
  const pathSquadId = typeof req.params?.squadId === "string" ? req.params.squadId.trim() : "";
  const { userId, providerAccountId, name, email } = getRequesterIdentity(req);

  if (!userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  const normalizedSquadCode = typeof squadCode === "string" ? squadCode.trim().toUpperCase() : "";

  if (!normalizedSquadCode && !pathSquadId) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Squad code or squad id is required" },
    });
  }

  if (normalizedSquadCode && !/^[A-Z]{3}-\d{3}$/.test(normalizedSquadCode)) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_SQUAD_CODE", message: "Squad code must be in format ABC-123" },
    });
  }

  try {
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(401).json({
        ok: false,
        error: { code: "USER_NOT_FOUND", message: "Authenticated user does not exist" },
      });
    }

    const squad = await Squad.findOne(
      pathSquadId ? { squadId: pathSquadId } : { squadCode: normalizedSquadCode }
    );
    if (!squad) {
      return res.status(404).json({
        ok: false,
        error: { code: "SQUAD_NOT_FOUND", message: "Squad not found" },
      });
    }

    const existingMember = squad.members.find((candidate) => isSameMember(candidate, { userId, providerAccountId }));
    if (existingMember) {
      await resolveSquadInviteNotification(userId, squad.squadId);
      return res.status(200).json({
        ok: true,
        data: {
          squadId: squad.squadId,
          squadCode: squad.squadCode,
          squadName: squad.squadName,
          member: existingMember,
          members: squad.members,
          status: squad.status,
        },
      });
    }

    // Adult-content gate: an adult squad may only be joined by 18+ users.
    // Applies to both join-by-code and join-by-id (this handler serves both).
    if (squad.adult && !existingUser.isAdult) {
      return res.status(403).json({
        ok: false,
        error: { code: "AGE_RESTRICTED", message: "You must be 18+ to join an adult squad" },
      });
    }

    // Invite-only: the squad accepts neither instant joins nor requests. Only
    // users the leader explicitly invited (present in invitedUserIds) may join.
    if (squad.joinPolicy === "invite") {
      const invited = hasIdentityId(squad.invitedUserIds, userId);
      if (!invited) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "INVITE_ONLY",
            message: "This squad is invite-only. Ask the leader for an invite.",
          },
        });
      }
      // Invited user falls through to the normal capacity/status checks + join.
    }

    // Request-to-join: if the squad gates joins behind leader approval, the
    // requester (not already a member, not the leader) is added to the pending
    // joinRequests list (deduped by userId) instead of becoming a member.
    if (squad.joinPolicy === "request") {
      const alreadyRequested = hasIdentityId(squad.joinRequests, userId, "userId");
      if (!alreadyRequested) {
        squad.joinRequests.push({
          userId,
          name: firstDisplayName(displayName, name, email),
          requestedAt: new Date(),
        });
        await squad.save();
        socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

        // Notify the squad leader that someone wants to join.
        const leader = squad.members.find((m) => m.role === "leader");
        if (leader && leader.userId) {
          await createNotification({
            userId: leader.userId,
            type: "join_request",
            title: "New join request",
            body: `${firstDisplayName(displayName, name, email)} wants to join ${squad.squadName}`,
            fromUserId: userId,
            fromName: firstDisplayName(displayName, name, email),
            squadId: squad.squadId,
            squadCode: squad.squadCode,
            squadName: squad.squadName,
          });
        }
      }
      await resolveSquadInviteNotification(userId, squad.squadId);
      return res.status(200).json({ ok: true, data: { status: "requested" } });
    }

    // Multi-squad membership: being in another squad no longer blocks joining
    // this one. Other validations (already in THIS squad handled above; full;
    // closed) still apply below.
    const capacity = await getSquadCapacity(squad);
    if (squad.members.length >= capacity) {
      // A free squad (capacity 4) that is full prompts an upgrade; a premium
      // squad at its 8-seat cap returns the plain full error.
      if (capacity <= FREE_MAX_MEMBERS) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "SQUAD_FULL_UPGRADE",
            message:
              "This squad is full at 4. The leader can upgrade to Giggle+ to open up to 8 seats.",
          },
        });
      }
      return res.status(409).json({
        ok: false,
        error: { code: "SQUAD_FULL", message: `Squad is full (max ${capacity} members)` },
      });
    }

    if (squad.status !== "idle") {
      return res.status(409).json({
        ok: false,
        error: { code: "SQUAD_CLOSED", message: "Squad is already in a match or encounter" },
      });
    }

    const memberId = generateId("mem");
    const newMember = {
      memberId,
      userId,
      providerAccountId,
      displayName: firstDisplayName(displayName, name, email),
      role: "member",
      ready: false,
      joinedAt: new Date().toISOString(),
    };

    squad.members.push(newMember);
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    await resolveSquadInviteNotification(userId, squad.squadId);

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
        member: newMember,
        members: squad.members,
        status: squad.status,
      },
    });
  } catch (error) {
    console.error("Error joining squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to join squad" },
    });
  }
};

const getSquadHandler = async (req, res) => {
  try {
    const { squad, leader } = req.squadAccess;

    // Merge high-speed session data from Redis
    const sessionData = await sessionService.getSquadSession(squad.squadId);

    // Batch-load member demographics from User to avoid N queries.
    const memberUserIds = squad.members.map((m) => m.userId).filter(Boolean);
    const demoUsers = memberUserIds.length
      ? await User.find({ _id: { $in: memberUserIds } })
      : [];
    const demoById = new Map(demoUsers.map((u) => [u._id.toString(), u]));
    const onlineMemberIds = await socketService.getOnlineUserIds(memberUserIds);

    const mergedMembers = squad.members.map(member => {
      const live = sessionData[member.memberId] || {};
      const u = demoById.get(member.userId);
      return {
        ...member.toObject(),
        ready: live.ready !== undefined ? live.ready : member.ready,
        inLobbyVideo: live.inLobbyVideo !== undefined ? live.inLobbyVideo : member.inLobbyVideo,
        inEncounterVideo: live.inEncounterVideo !== undefined ? live.inEncounterVideo : member.inEncounterVideo,
        // Live presence — is this member actually connected right now?
        online: onlineMemberIds.has(member.userId),
        gender: u ? u.gender : undefined,
        age: u ? u.age : undefined,
        languages: u ? u.languages || [] : undefined,
        country: u ? u.country : undefined,
      };
    });

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
        status: squad.status,
        members: mergedMembers,
        maxSlots: await getSquadCapacity(squad),
        leaderMemberId: leader ? leader.memberId : undefined,
        tags: squad.tags,
        coverImage: squad.coverImage ?? null,
        visibility: squad.visibility || "private",
        joinPolicy: squad.joinPolicy || "open",
        invitedCount: (squad.invitedUserIds || []).length,
        invitedUserIds: squad.invitedUserIds || [],
      },
    });
  } catch (error) {
    console.error("Error getting squad lobby state:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to retrieve squad state" },
    });
  }
};

// Public squad PREVIEW — NO membership required. Powers the two-step join flow
// so people can vet a squad's themes + roster before committing. Returns only
// non-sensitive vetting info (no live session/video/ready state, no codes-for-action).
const getSquadPreviewHandler = async (req, res) => {
  try {
    const { squadId } = req.params;
    const squad = await Squad.findOne({ squadId });
    if (!squad) {
      return res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "Squad not found" },
      });
    }

    const leader =
      squad.members.find((m) => m.role === "leader") ||
      (squad.leaderMemberId
        ? squad.members.find((m) => m.memberId === squad.leaderMemberId)
        : undefined);

    const members = squad.members.map((member) => ({
      memberId: member.memberId,
      displayName: publicMemberName(member),
      role: member.role,
      avatarId: member.avatarId,
    }));

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        squadName: publicSquadName(squad),
        status: squad.status,
        members,
        memberCount: squad.members.length,
        maxSlots: await getSquadCapacity(squad),
        leaderMemberId: leader ? leader.memberId : undefined,
        leaderName: leader ? publicMemberName(leader) : undefined,
        tags: publicSquadTags(squad),
        coverImage: squad.coverImage ?? null,
        joinPolicy: squad.joinPolicy || "open",
        // Whether the requester is on the invite allow-list (so the UI can show
        // "you're invited" vs the invite-only block for invite-only squads).
        invited: hasIdentityId(squad.invitedUserIds, getRequesterIdentity(req).userId),
      },
    });
  } catch (error) {
    console.error("Error getting squad preview:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to retrieve squad preview" },
    });
  }
};

const updateReadyStateHandler = async (req, res) => {
  const { ready } = req.body;

  if (typeof ready !== "boolean") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Ready state must be a boolean" },
    });
  }

  try {
    const { squad, memberIndex } = req.squadAccess;
    const member = squad.members[memberIndex];

    if (squad.status !== "idle" && ready === true) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "INVALID_SQUAD_STATE",
          message: "Cannot change ready state when squad is not idle",
        },
      });
    }

    // High-speed update in Redis
    await sessionService.setSessionField(squad.squadId, member.memberId, 'ready', ready);

    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        memberId: member.memberId,
        providerAccountId: member.providerAccountId,
        ready,
      },
    });
  } catch (error) {
    console.error("Error updating ready state:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update ready state" },
    });
  }
};

const updateSquadNameHandler = async (req, res) => {
  const { squad } = req.squadAccess;
  const normalizedSquadName = normalizeSquadName(req.body?.squadName);

  if (!normalizedSquadName) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "squadName is required" },
    });
  }

  if (normalizedSquadName.length < 2 || normalizedSquadName.length > 32) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_SQUAD_NAME", message: "Squad name must be 2-32 characters" },
    });
  }

  try {
    squad.squadName = normalizedSquadName;
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        squadName: squad.squadName,
      },
    });
  } catch (error) {
    console.error("Error updating squad name:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update squad name" },
    });
  }
};

const updateSquadVisibilityHandler = async (req, res) => {
  const { squad } = req.squadAccess;
  const { visibility } = req.body || {};

  if (visibility !== "private" && visibility !== "open") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: 'visibility must be "private" or "open"' },
    });
  }

  try {
    squad.visibility = visibility;
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        visibility: squad.visibility,
      },
    });
  } catch (error) {
    console.error("Error updating squad visibility:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update visibility" },
    });
  }
};

const updateSquadJoinPolicyHandler = async (req, res) => {
  const { squad } = req.squadAccess;
  const { joinPolicy } = req.body || {};

  if (joinPolicy !== "open" && joinPolicy !== "request" && joinPolicy !== "invite") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: 'joinPolicy must be "open", "request", or "invite"' },
    });
  }

  try {
    squad.joinPolicy = joinPolicy;
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        joinPolicy: squad.joinPolicy,
      },
    });
  } catch (error) {
    console.error("Error updating squad join policy:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update join policy" },
    });
  }
};

const getJoinRequestsHandler = async (req, res) => {
  try {
    const { squad } = req.squadAccess;
    const requests = squad.joinRequests || [];

    // Enrich each request with the requester's demographics in one batch query.
    const userIds = requests.map((r) => r.userId);
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
      : [];
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    const enriched = requests.map((r) => {
      const u = byId.get(r.userId);
      return {
        userId: r.userId,
        name: r.name,
        requestedAt: r.requestedAt,
        gender: u ? u.gender : undefined,
        age: u ? u.age : undefined,
        languages: u ? u.languages || [] : undefined,
        country: u ? u.country : undefined,
      };
    });

    return res.status(200).json({ ok: true, data: { requests: enriched } });
  } catch (error) {
    console.error("Error fetching join requests:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch join requests" },
    });
  }
};

const approveJoinRequestHandler = async (req, res) => {
  const { userId: targetUserId } = req.params;
  const { userId: leaderUserId } = getRequesterIdentity(req);

  try {
    const { squad } = req.squadAccess;
    const reqIndex = (squad.joinRequests || []).findIndex((r) =>
      hasIdentityId([r], targetUserId, "userId")
    );

    if (reqIndex === -1) {
      return res.status(404).json({
        ok: false,
        error: { code: "REQUEST_NOT_FOUND", message: "Join request not found" },
      });
    }

    const request = squad.joinRequests[reqIndex];

    // If already a member, just clear the stale request.
    const alreadyMember = hasIdentityId(squad.members, targetUserId, "userId");
    if (alreadyMember) {
      squad.joinRequests.splice(reqIndex, 1);
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
      await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);
      return res.status(200).json({
        ok: true,
        data: { squadId: squad.squadId, userId: targetUserId, status: "member" },
      });
    }

    const capacity = await getSquadCapacity(squad);
    if (squad.members.length >= capacity) {
      return res.status(409).json({
        ok: false,
        error: { code: "SQUAD_FULL", message: `Squad is full (max ${capacity} members)` },
      });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      squad.joinRequests.splice(reqIndex, 1);
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
      await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);
      return res.status(404).json({
        ok: false,
        error: { code: "REQUEST_USER_NOT_FOUND", message: "Join request user no longer exists" },
      });
    }

    // Adult-content gate: never approve a non-adult user into an adult squad.
    if (squad.adult && !targetUser.isAdult) {
      squad.joinRequests.splice(reqIndex, 1);
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
      await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);
      return res.status(403).json({
        ok: false,
        error: { code: "AGE_RESTRICTED", message: "This user must be 18+ to join an adult squad" },
      });
    }

    const newMember = {
      memberId: generateId("mem"),
      userId: targetUserId,
      providerAccountId: targetUserId,
      displayName: request.name || targetUser.name || targetUser.email,
      role: "member",
      ready: false,
      joinedAt: new Date().toISOString(),
    };

    squad.members.push(newMember);
    squad.joinRequests.splice(reqIndex, 1);
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        member: newMember,
        members: squad.members,
        status: squad.status,
      },
    });
  } catch (error) {
    console.error("Error approving join request:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to approve join request" },
    });
  }
};

const declineJoinRequestHandler = async (req, res) => {
  const { userId: targetUserId } = req.params;
  const { userId: leaderUserId } = getRequesterIdentity(req);

  try {
    const { squad } = req.squadAccess;
    const reqIndex = (squad.joinRequests || []).findIndex((r) =>
      hasIdentityId([r], targetUserId, "userId")
    );

    if (reqIndex === -1) {
      return res.status(404).json({
        ok: false,
        error: { code: "REQUEST_NOT_FOUND", message: "Join request not found" },
      });
    }

    squad.joinRequests.splice(reqIndex, 1);
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);

    return res.status(200).json({
      ok: true,
      data: { squadId: squad.squadId, userId: targetUserId, status: "declined" },
    });
  } catch (error) {
    console.error("Error declining join request:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to decline join request" },
    });
  }
};

// Leader invites a user to an invite-only squad by adding them to the
// allow-list. Accepts a userId (preferred) and/or an email (best-effort
// resolved to a user). Idempotent: re-inviting an already-invited user is a
// no-op success.
const inviteToSquadHandler = async (req, res) => {
  const { userId: bodyUserId, email } = req.body || {};

  try {
    const { squad } = req.squadAccess;

    let targetUserId = typeof bodyUserId === "string" && bodyUserId.trim() ? bodyUserId.trim() : null;

    // Resolve an email to a userId when no explicit userId was given.
    if (!targetUserId && typeof email === "string" && email.trim()) {
      const user = await User.findOne({ email: email.trim().toLowerCase() });
      if (user) targetUserId = user._id.toString();
    }

    if (!targetUserId) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "A userId or a resolvable email is required" },
      });
    }
    if (!isValidUserObjectId(targetUserId)) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "A valid userId is required" },
      });
    }

    const targetUser = await User.findById(targetUserId).select("_id");
    if (!targetUser) {
      return res.status(404).json({
        ok: false,
        error: { code: "INVITE_USER_NOT_FOUND", message: "Invite target user no longer exists" },
      });
    }

    if (!Array.isArray(squad.invitedUserIds)) squad.invitedUserIds = [];
    if (!hasIdentityId(squad.invitedUserIds, targetUserId)) {
      squad.invitedUserIds.push(targetUserId);
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    }

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        invitedUserId: targetUserId,
        invitedCount: squad.invitedUserIds.length,
      },
    });
  } catch (error) {
    console.error("Error inviting to squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to invite user" },
    });
  }
};

// Leader revokes a previously-issued invite (removes from the allow-list).
const revokeInviteHandler = async (req, res) => {
  const { userId: targetUserId } = req.params;

  try {
    const { squad } = req.squadAccess;
    const idx = (squad.invitedUserIds || []).findIndex((id) => hasIdentityId([id], targetUserId));
    if (idx !== -1) {
      squad.invitedUserIds.splice(idx, 1);
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    }
    await resolveSquadInviteNotification(targetUserId, squad.squadId);

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        revokedUserId: targetUserId,
        invitedCount: (squad.invitedUserIds || []).length,
      },
    });
  } catch (error) {
    console.error("Error revoking invite:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to revoke invite" },
    });
  }
};

// Any MEMBER of the squad invites another USER to it. Adds the invitee to the
// invite allow-list (so invite-only squads accept them) AND pushes a
// squad_invite notification carrying the squadCode so the invitee can join.
// Idempotent: re-inviting an already-invited user is a no-op success.
const inviteUserToSquadHandler = async (req, res) => {
  const { userId: targetUserId } = req.body || {};

  if (typeof targetUserId !== "string" || !targetUserId.trim()) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "userId is required" },
    });
  }
  if (!isValidUserObjectId(targetUserId)) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "A valid userId is required" },
    });
  }

  try {
    const { squad } = req.squadAccess;
    const inviterName = req.giggleIdentity?.name || getRequesterIdentity(req).name;
    const targetUser = await User.findById(targetUserId).select("_id");
    if (!targetUser) {
      return res.status(404).json({
        ok: false,
        error: { code: "INVITE_USER_NOT_FOUND", message: "Invite target user no longer exists" },
      });
    }

    if (!Array.isArray(squad.invitedUserIds)) squad.invitedUserIds = [];

    const alreadyInvited = hasIdentityId(squad.invitedUserIds, targetUserId);
    const alreadyMember = hasIdentityId(squad.members, targetUserId, "userId");

    if (!alreadyInvited && !alreadyMember) {
      squad.invitedUserIds.push(targetUserId);
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

      await createNotification({
        userId: targetUserId,
        type: "squad_invite",
        title: "Squad invite",
        body: `${inviterName || "Someone"} invited you to ${squad.squadName}`,
        fromUserId: getRequesterIdentity(req).userId,
        fromName: inviterName,
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
      });
    }

    return res.status(200).json({ ok: true, data: { invited: true } });
  } catch (error) {
    console.error("Error inviting user to squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to invite user" },
    });
  }
};

const startSearchHandler = async (req, res) => {
  let searchStateSaved = false;
  let squad = null;

  try {
    const { member } = req.squadAccess;
    squad = req.squadAccess.squad;

    if (squad.status !== "idle") {
      return res.status(409).json({
        ok: false,
        error: { code: "INVALID_SQUAD_STATE", message: "Squad must be idle to start search" },
      });
    }

    if (squad.members.length < MIN_MEMBERS_TO_SEARCH) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "NOT_ENOUGH_MEMBERS",
          message: `At least ${MIN_MEMBERS_TO_SEARCH} members are required to start search`,
        },
      });
    }

    // Fetch live session data from Redis to check ready/video states
    const sessionData = await sessionService.getSquadSession(squad.squadId);

    // Only members currently connected (online) gate the search. An offline
    // member — one who disconnected without marking ready — must never
    // permanently block the leader from finding a match. We still require at
    // least MIN_MEMBERS_TO_SEARCH *online* members so a squad can't match with
    // nobody actually present.
    const onlineMemberIds = await socketService.getOnlineUserIds(
      squad.members.map((m) => m.userId).filter(Boolean)
    );
    const activeMembers = squad.members.filter((m) => onlineMemberIds.has(m.userId));

    if (activeMembers.length < MIN_MEMBERS_TO_SEARCH) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "NOT_ENOUGH_MEMBERS",
          message: `At least ${MIN_MEMBERS_TO_SEARCH} online members are required to start search`,
        },
      });
    }

    const allReady = activeMembers.every((m) => {
      const live = sessionData[m.memberId] || {};
      return (live.ready !== undefined ? live.ready : m.ready) === true;
    });

    const allInLobbyVideo = activeMembers.every((m) => {
      const live = sessionData[m.memberId] || {};
      return (live.inLobbyVideo !== undefined ? live.inLobbyVideo : m.inLobbyVideo) === true;
    });

    if (!allReady || !allInLobbyVideo) {
      return res.status(409).json({
        ok: false,
        error: {
          code: "NOT_READY_TO_SEARCH",
          message: "All online squad members must be ready and in the video lobby",
        },
      });
    }

    // Adult-content enqueue gate: an adult squad may only enter matchmaking when
    // EVERY member is 18+. (A non-adult squad has no such restriction.)
    if (squad.adult) {
      const memberUserIds = squad.members.map((m) => m.userId).filter(Boolean);
      const adultUsers = memberUserIds.length
        ? await User.find({ _id: { $in: memberUserIds }, isAdult: true }).select("_id")
        : [];
      if (adultUsers.length !== memberUserIds.length) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "AGE_RESTRICTED",
            message: "All squad members must be 18+ before an adult squad can start matchmaking",
          },
        });
      }
    }

    const now = new Date();
    squad.status = "searching";
    squad.searchQueuedAt = now;
    squad.searchRegion = squad.searchRegion || "global";
    squad.currentEncounterId = null;
    squad.opponentSquadId = null;
    squad.matchedAt = null;
    squad.isPremiumSquad = await getSquadPremiumStatus(squad);
    await squad.save();
    searchStateSaved = true;
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    // Add to Redis Queue
    await queueService.addToQueue(squad.squadId, squad.members.length, squad.searchRegion, squad.tags, squad.reputationScore);

    const encounter = await tryMatchmakeForSquad(squad);
    if (encounter) {
      return res.status(200).json({
        ok: true,
        data: {
          squadId: squad.squadId,
          status: "matched",
          startedByMemberId: member.memberId,
          encounterId: encounter.encounterId,
        },
      });
    }

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        status: squad.status,
        startedByMemberId: member.memberId,
      },
    });
  } catch (error) {
    console.error("Error starting search:", error);
    if (searchStateSaved) {
      try {
        if (squad) {
          squad.status = "idle";
          squad.searchQueuedAt = null;
          await squad.save();
          socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
        }
      } catch (rollbackError) {
        console.error("Error rolling back failed search start:", rollbackError);
      }
    }
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to start search" },
    });
  }
};

const cancelSearchHandler = async (req, res) => {
  try {
    const { squad, member } = req.squadAccess;

    if (squad.status !== "searching") {
      return res.status(409).json({
        ok: false,
        error: { code: "NOT_IN_SEARCH", message: "Squad is not in searching state" },
      });
    }

    squad.status = "idle";
    squad.searchQueuedAt = null;
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    // Remove from Redis Queue
    await queueService.removeFromQueue(squad.squadId);

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        status: squad.status,
        cancelledByMemberId: member.memberId,
      },
    });
  } catch (error) {
    console.error("Error cancelling search:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to cancel search" },
    });
  }
};

const kickMemberHandler = async (req, res) => {
  const { memberId } = req.params;

  try {
    const { squad } = req.squadAccess;
    const targetIndex = squad.members.findIndex((candidate) => candidate.memberId === memberId);

    if (targetIndex === -1) {
      return res.status(404).json({
        ok: false,
        error: { code: "MEMBER_NOT_FOUND", message: "Target member not found in squad" },
      });
    }

    const targetMember = squad.members[targetIndex];
    if (targetMember.role === "leader") {
      return res.status(409).json({
        ok: false,
        error: { code: "LEADER_CANNOT_BE_KICKED", message: "Leader cannot be kicked" },
      });
    }

    squad.members.splice(targetIndex, 1);
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        kickedMemberId: targetMember.memberId,
        remainingCount: squad.members.length,
        status: squad.status,
      },
    });
  } catch (error) {
    console.error("Error kicking member:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to kick member" },
    });
  }
};

const promoteMemberHandler = async (req, res) => {
  const { memberId } = req.params;

  try {
    const { squad } = req.squadAccess;
    const targetMember = squad.members.find((candidate) => candidate.memberId === memberId);

    if (!targetMember) {
      return res.status(404).json({
        ok: false,
        error: { code: "MEMBER_NOT_FOUND", message: "Target member not found in squad" },
      });
    }

    if (targetMember.role === "leader") {
      return res.status(409).json({
        ok: false,
        error: { code: "ALREADY_LEADER", message: "Target member is already leader" },
      });
    }

    const currentLeader = squad.members.find((candidate) => candidate.role === "leader");
    if (!currentLeader) {
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "No leader found in squad" },
      });
    }

    currentLeader.role = "member";
    targetMember.role = "leader";

    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        newLeaderMemberId: targetMember.memberId,
        previousLeaderMemberId: currentLeader.memberId,
      },
    });
  } catch (error) {
    console.error("Error promoting member:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to promote member" },
    });
  }
};

const leaveSquadHandler = async (req, res) => {
  try {
    const { squad, memberIndex } = req.squadAccess;
    const leavingMember = squad.members[memberIndex];
    const wasSearching = squad.status === "searching";

    squad.members.splice(memberIndex, 1);

    // A squad that loses a member mid-search shouldn't keep searching: pull it
    // out of the matchmaking queue and (if it survives) reset it to idle so a
    // depleted squad never gets matched.
    if (wasSearching && squad.members.length > 0) {
      squad.status = "idle";
      squad.searchQueuedAt = null;
    }

    const { squadDeleted, newLeaderMemberId } = await persistSquadAfterMemberRemoval(squad, {
      removedMemberRole: leavingMember.role,
    });

    if (wasSearching) {
      // Always dequeue: covers both the surviving-but-depleted squad and the
      // now-deleted (empty) squad — a deleted squad must not linger in Redis.
      try {
        await queueService.removeFromQueue(squad.squadId);
      } catch (dequeueErr) {
        console.error("Error dequeuing squad on leave:", dequeueErr);
      }
    }

    if (!squadDeleted) {
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    }

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        leftMemberId: leavingMember.memberId,
        newLeaderMemberId,
        remainingCount: squad.members.length,
        squadDeleted,
      },
    });
  } catch (error) {
    console.error("Error leaving squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to leave squad" },
    });
  }
};

// Leader-only: permanently delete the whole squad for everyone (disband),
// regardless of remaining members. Distinct from "leave" (which hands off
// leadership and keeps the squad alive).
const disbandSquadHandler = async (req, res) => {
  try {
    const { squad, isLeader } = req.squadAccess;
    if (!isLeader) {
      return res.status(403).json({
        ok: false,
        error: { code: "NOT_LEADER", message: "Only the squad leader can delete the squad." },
      });
    }

    // Pull it out of matchmaking before it disappears.
    if (squad.status === "searching") {
      try { await queueService.removeFromQueue(squad.squadId); } catch (e) { console.error("Error dequeuing squad on disband:", e); }
    }

    await deleteSquadAndNotifications(squad);
    // Tell everyone still in the room the squad is gone. Clients re-fetch on
    // SQUAD_UPDATED, hit 404, and get redirected home.
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", { disbanded: true });

    return res.status(200).json({ ok: true, data: { squadId: squad.squadId, disbanded: true } });
  } catch (error) {
    console.error("Error disbanding squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to delete squad" },
    });
  }
};

const updateLobbyVideoPresenceHandler = async (req, res) => {
  const { inLobbyVideo } = req.body;

  if (typeof inLobbyVideo !== "boolean") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "inLobbyVideo must be a boolean" },
    });
  }

  try {
    const { squad, memberIndex } = req.squadAccess;
    const member = squad.members[memberIndex];

    // High-speed update in Redis
    await sessionService.setSessionField(squad.squadId, member.memberId, 'inLobbyVideo', inLobbyVideo);
    // Leaving the lobby video also means leaving the encounter video
    if (!inLobbyVideo) {
      await sessionService.setSessionField(squad.squadId, member.memberId, 'inEncounterVideo', false);
    }

    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: { memberId: member.memberId, inLobbyVideo },
    });
  } catch (error) {
    console.error("Error updating lobby video presence:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update lobby video presence" },
    });
  }
};

const updateEncounterVideoPresenceHandler = async (req, res) => {
  const { inEncounterVideo } = req.body;

  if (typeof inEncounterVideo !== "boolean") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "inEncounterVideo must be a boolean" },
    });
  }

  try {
    const { squad, memberIndex } = req.squadAccess;
    const member = squad.members[memberIndex];

    // High-speed update in Redis
    await sessionService.setSessionField(squad.squadId, member.memberId, 'inEncounterVideo', inEncounterVideo);

    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: { memberId: member.memberId, inEncounterVideo },
    });
  } catch (error) {
    console.error("Error updating encounter video presence:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update encounter video presence" },
    });
  }
};

const updateSquadTagsHandler = async (req, res) => {
  const { tags } = req.body;
  const normalized = normalizeSquadTags(tags);

  if (normalized.error) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: normalized.error },
    });
  }

  // Server-side moderation: reject blocked tags outright.
  const blocked = firstBlockedTag(normalized.tags);
  if (blocked) {
    return res.status(400).json({
      ok: false,
      error: { code: "TAG_BLOCKED", message: "One or more tags are not allowed." },
    });
  }

  try {
    const { squad } = req.squadAccess;
    const willBeAdult = tagsAreMature(normalized.tags);

    // If this update turns the squad into an adult room, the acting user must be 18+.
    if (willBeAdult && !squad.adult) {
      const actorId = getRequesterIdentity(req).userId;
      if (!(await getUserIsAdult(actorId))) {
        return res.status(403).json({
          ok: false,
          error: { code: "AGE_RESTRICTED", message: "You must be 18+ to make a squad adult" },
        });
      }
    }

    squad.tags = normalized.tags;
    squad.adult = willBeAdult;
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        tags: squad.tags,
        adult: squad.adult,
      },
    });
  } catch (error) {
    console.error("Error updating squad tags:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update tags" },
    });
  }
};

const updateSquadCoverHandler = async (req, res) => {
  const { squad } = req.squadAccess;
  const normalized = normalizeSquadCoverImage(req.body?.coverImage);

  if (normalized.error) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_COVER_IMAGE", message: normalized.error },
    });
  }

  try {
    squad.coverImage = normalized.coverImage;
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    return res.status(200).json({
      ok: true,
      data: { squadId: squad.squadId, coverImage: squad.coverImage },
    });
  } catch (error) {
    console.error("Error updating squad cover:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update squad cover" },
    });
  }
};

const toPublicSquad = async (squad) => {
  const leader = squad.members.find((m) => m.role === "leader");
  return {
    squadId: squad.squadId,
    squadName: publicSquadName(squad),
    memberCount: squad.members.length,
    maxSlots: await getSquadCapacity(squad),
    tags: publicSquadTags(squad),
    coverImage: squad.coverImage ?? null,
    status: squad.status,
    visibility: squad.visibility || "private",
    joinPolicy: squad.joinPolicy || "open",
    leaderName: leader ? publicMemberName(leader) : undefined,
  };
};

const findJoinableSquads = async (identity) => {
  // Joinable by strangers: idle status (join handler rejects anything else),
  // visibility "open", not full, and not already containing the requester.
  // Do the filtering in Mongo instead of fetching 200 and filtering in JS.
  const exclude = [];
  if (identity.userId) exclude.push(identity.userId);
  if (identity.providerAccountId) exclude.push(identity.providerAccountId);

  const query = {
    status: "idle",
    visibility: "open",
    joinPolicy: { $in: ["open", "request"] },
    $expr: { $lt: [{ $size: "$members" }, MAX_SQUAD_MEMBERS] },
  };

  if (exclude.length > 0) {
    query["members.userId"] = { $nin: exclude };
    query["members.providerAccountId"] = { $nin: exclude };
  }

  return Squad.find(query).sort({ createdAt: -1 }).limit(30);
};

const discoverSquadsHandler = async (req, res) => {
  const identity = getRequesterIdentity(req);

  if (!identity.userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  try {
    const joinable = await findJoinableSquads(identity);
    const squads = await Promise.all(joinable.slice(0, 30).map(toPublicSquad));
    return res.status(200).json({ ok: true, data: { squads } });
  } catch (error) {
    console.error("Error discovering squads:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to discover squads" },
    });
  }
};

// Attempt to join a single squad atomically-ish. Returns the new member on
// success, or null if the squad became full/closed/gone (so the caller can
// try the next candidate). Re-reads the squad fresh to minimize race windows.
const tryJoinSquadOnce = async (squadId, identity, displayName) => {
  try {
    const squad = await Squad.findOne({ squadId });
    if (!squad) return null;
    if (squad.status !== "idle") return null;
    // Treat both free-full (4) and premium-full (8) as "full, try next" — never
    // surface the upgrade prompt from random matching.
    const capacity = await getSquadCapacity(squad);
    if (squad.members.length >= capacity) return null;
    if (squad.members.some((m) => isSameMember(m, identity))) return null;
    // Never drop a non-adult user into an adult squad via random matching.
    if (squad.adult && !(await getUserIsAdult(identity.userId))) return null;

    const newMember = {
      memberId: generateId("mem"),
      userId: identity.userId,
      providerAccountId: identity.providerAccountId,
      displayName: firstDisplayName(displayName, identity.name, identity.email),
      role: "member",
      ready: false,
      joinedAt: new Date().toISOString(),
    };

    squad.members.push(newMember);
    await squad.save();
    return newMember;
  } catch (error) {
    // VersionError or other concurrent-write conflict — treat as a failed
    // attempt so the caller falls through to the next candidate.
    console.warn(`tryJoinSquadOnce failed for ${squadId}:`, error.message);
    return null;
  }
};

const joinRandomSquadHandler = async (req, res) => {
  const identity = getRequesterIdentity(req);

  if (!identity.userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }

  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : undefined;

  try {
    // Note: join-random must NEVER return a squad the caller is already in
    // (including their own). findJoinableSquads already excludes any squad
    // whose members contain the requester (same exclusion as discover), so we
    // go straight to matching against fresh open squads and fall back to
    // creating a new one when none remain.
    const joinable = await findJoinableSquads(identity);
    // join-random must only consider OPEN (instant-join) squads; skip any squad
    // gated behind leader approval (joinPolicy === "request").
    const openOnly = joinable.filter((s) => (s.joinPolicy || "open") === "open");
    // Shuffle so concurrent callers don't all stampede the same squad.
    const candidates = shuffle(openOnly);

    for (const candidate of candidates) {
      const member = await tryJoinSquadOnce(candidate.squadId, identity, displayName);
      if (member) {
        const fresh = await Squad.findOne({ squadId: candidate.squadId });
        const leader = fresh.members.find((m) => m.role === "leader");
        socketService.emitToSquad(fresh.squadId, "SQUAD_UPDATED", {});
        return res.status(200).json({
          ok: true,
          data: {
            squadId: fresh.squadId,
            squadCode: fresh.squadCode,
            squadName: fresh.squadName,
            member,
            members: fresh.members,
            status: fresh.status,
            leaderMemberId: leader ? leader.memberId : undefined,
          },
        });
      }
      // join failed (full/closed/race) — try the next candidate.
    }

    // No joinable squad (or all attempts lost a race) — create a new one so
    // the user always lands somewhere.
    req.body = { displayName, squadName: undefined };
    return createSquadHandler(req, res);
  } catch (error) {
    console.error("Error joining random squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to join a random squad" },
    });
  }
};

module.exports = {
  createSquadHandler,
  joinSquadHandler,
  discoverSquadsHandler,
  joinRandomSquadHandler,
  getMySquadHandler,
  getMySquadsHandler,
  getSquadHandler,
  getSquadPreviewHandler,
  updateReadyStateHandler,
  updateSquadNameHandler,
  updateSquadTagsHandler,
  updateSquadCoverHandler,
  updateSquadVisibilityHandler,
  updateSquadJoinPolicyHandler,
  getJoinRequestsHandler,
  approveJoinRequestHandler,
  declineJoinRequestHandler,
  inviteToSquadHandler,
  inviteUserToSquadHandler,
  revokeInviteHandler,
  startSearchHandler,
  cancelSearchHandler,
  kickMemberHandler,
  promoteMemberHandler,
  leaveSquadHandler,
  disbandSquadHandler,
  updateLobbyVideoPresenceHandler,
  updateEncounterVideoPresenceHandler,
};
