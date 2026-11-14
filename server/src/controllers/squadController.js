const { withSquadAdmissionLock, guardSquadWrites } = require("../services/squadAdmissionService");
const { validGroupInvite } = require("../utils/groupInviteValidation");
const {groupMetadata,directoryQuery} = require("../utils/groupSettingsValidation");
const groupPresence = require("../services/groupPresenceService");
const { aliasGroup, groupAlias, groupHandle, publicMemberId, publicUserId, publicGroupMember, groupFields, resolveGroupMember } = require("../services/groupIdentityService");
const { normalizeEncounterAlias } = require("../utils/groupIdentityValidation");
const memberMedia = require('../services/memberMediaService');
const { hashStringToUid, lobbyRtcUid } = require("../services/agoraTokenService");
const mongoose = require("mongoose");
const { Squad } = require("../models/Squad");
const User = require("../models/User");
const { hasActivePremium } = require("../utils/premium");
const {
  MAX_SQUAD_MEMBERS,
  MIN_MEMBERS_TO_SEARCH,
  FREE_MAX_MEMBERS,
  PREMIUM_MAX_MEMBERS,
  isStrangerDiscoveryEnabled,
} = require("../config/appConfig");
const {
  getRequesterIdentity,
  hasIdentityId,
  isSameMember,
  findSquadForIdentity,
  findSquadsForIdentity,
  deleteSquadAndNotifications,
  removeSquadMember,
} = require("../app/squadAccess");
const { generateId, generateSquadCode } = require("../utils/idGenerator");
const {
  endEncounterAsymmetric,
  getEncounterById,
  tryMatchmakeForSquad,
} = require("../services/matchmakingService");
const { allUsersHaveAdultAccess, hasAdultAccess } = require("../services/ageAccessService");
const queueService = require("../services/queueService");
const socketService = require("../services/socketService");
const sessionService = require("../services/sessionService");
const { redlock, withMatchmakingLock } = require("../config/redisConfig");
const {
  createNotification,
  deleteNotifications,
  emitNotification,
} = require("../models/Notification");
const { shuffle } = require("../utils/random");
const { normalizeSquadTags } = require("../utils/squadValidation");
const { classifyVibe } = require("../utils/moderation");
const { normalizeSquadCoverImage } = require("../utils/squadCoverValidation");
const {
  decodeCoverDataUrl,
  publicCoverImage,
  uploadCoverKey,
  uploadCoverRef,
} = require("../utils/squadCovers");
const coverStorage = require("../services/coverStorage");
const { firstDisplayName } = require("../utils/identityValidation");
const { loadAvatarsByUserId, publicAvatar } = require("../utils/avatars");
const {
  identityUserFor,
  loadEncounterIdentityUsers,
  publicEncounterIdentity,
} = require("../services/encounterIdentityService");
const {
  anyBlockedPair,
  anyBlockedPairInState,
  canonicalUserId,
  filterBlockedCandidates,
  hasBlockedPair,
  loadBlockState,
} = require("../services/interactionSafetyService");

const discoveryDisabled = (res) => res.status(503).json({
  ok: false,
  error: { code: "DISCOVERY_DISABLED", message: "Stranger discovery is temporarily unavailable" },
});

// Effective member capacity for a squad: 8 when the leader has Giggle+, else 4.
// Always clamped to the global hard cap (MAX_SQUAD_MEMBERS). Looks up the
// leader's live `isPremium` from the User record so upgrades take effect
// immediately. Falls back to 4 if the leader/user can't be resolved.
const findCapacityLeader = (squad) =>
  squad.members.find((m) => m.role === "leader") ||
  (squad.leaderMemberId
    ? squad.members.find((m) => m.memberId === squad.leaderMemberId)
    : null);

const capacityForPremium = (isPremium) =>
  Math.min(isPremium ? PREMIUM_MAX_MEMBERS : FREE_MAX_MEMBERS, MAX_SQUAD_MEMBERS);

const getSquadCapacity = async (squad) => {
  if (squad.authorizedPrincipalPair?.length === 2) return 2;
  try {
    const leader = findCapacityLeader(squad);
    if (!leader || !leader.userId) return FREE_MAX_MEMBERS;
    const leaderUser = await User.findById(leader.userId, "isPremium premiumExpiresAt", { lean: true });
    return capacityForPremium(hasActivePremium(leaderUser));
  } catch (error) {
    console.warn("getSquadCapacity failed:", error.message);
    return FREE_MAX_MEMBERS;
  }
};

// Batched getSquadCapacity for list endpoints: one User query for all leaders
// instead of one per squad. Same fallback (free capacity) on any failure.
const getSquadCapacities = async (squads) => {
  const leaderIds = squads.map((squad) => {
    const leader = findCapacityLeader(squad);
    return leader && isValidUserObjectId(leader.userId) ? leader.userId.toLowerCase() : null;
  });
  const uniqueIds = [...new Set(leaderIds.filter(Boolean))];
  const premiumById = new Map();
  if (uniqueIds.length > 0) {
    try {
      const users = await User.find({ _id: { $in: uniqueIds } }, "isPremium premiumExpiresAt", { lean: true });
      for (const user of users) premiumById.set(String(user._id), hasActivePremium(user));
    } catch (error) {
      console.warn("getSquadCapacities failed:", error.message);
    }
  }
  return leaderIds.map((id, index) => squads[index].authorizedPrincipalPair?.length === 2 ? 2 : capacityForPremium(Boolean(id && premiumById.get(id))));
};

const getUserPremiumStatus = async (userId) => {
  if (!userId) return false;
  const user = await User.findById(userId).select("isPremium premiumExpiresAt");
  return hasActivePremium(user);
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

const publicSquadName = (squad) => normalizeSquadName(squad?.squadName) === `Squad ${squad?.squadCode}` ? "Untitled squad" : normalizeSquadName(squad?.squadName).slice(0, 60) || "Untitled squad";

const publicMemberName = (member) => firstDisplayName(member?.displayName, "Someone");

// One identity lookup (avatar + anonymity) for members shown outside their
// squad. A failed lookup returns null: callers then treat everyone as
// anonymous (fail closed) instead of showing real identities.
const loadPublicIdentityUsers = async (members) => {
  try {
    return await loadEncounterIdentityUsers((members || []).map((member) => member?.userId), { User });
  } catch (error) {
    console.warn("loadPublicIdentityUsers failed:", error.message);
    return null;
  }
};

// How a squad member appears to someone OUTSIDE the squad (previews,
// discovery): members who stay anonymous with other squads show only their
// alias, no avatar, and an opaque id scoped to this squad's public views.
const publicMemberView = (squad, member, users) => {
  if (aliasGroup(squad)) return publicGroupMember(squad, member);
  const view = publicEncounterIdentity({
    viewerSquadId: null,
    memberSquadId: squad.squadId,
      identityMode: squad.identityMode,
    member,
    user: users ? identityUserFor(users, member?.userId) : undefined,
    scope: `squad-public:${squad.squadId}`,
  });
  return view.anonymous
    ? { memberId: view.memberId, displayName: view.displayName, avatar: null, anonymous: true }
    : { memberId: member.memberId, displayName: publicMemberName(member), avatar: view.avatar };
};

// Members with each user's chosen illustrated avatar. Looked up live from User
// (never persisted on member subdocs, where it would go stale) in one batched
// query; avatar is null when unset or when the lookup fails.
const withMemberAvatars = async (members, squad) => {
  if (aliasGroup(squad)) return members.map(member => publicGroupMember(squad, member));
  const list = [...(members || [])];
  const avatars = await loadAvatarsByUserId(list.map((member) => member?.userId), { User });
  return list.map((member) => ({
    ...(typeof member?.toObject === "function" ? member.toObject() : member),
    avatar: avatars.get(canonicalUserId(member?.userId)) ?? null,
  }));
};

const publicSquadTags = (squad) => {
  const normalized = normalizeSquadTags(squad?.tags ?? []);
  return normalized.tags || [];
};

const isValidUserObjectId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const anyBlockedPairInSquad = (squad, additionalUserIds = [], options = {}) =>
  anyBlockedPair([
    ...(squad?.members || []).map((member) => member.userId),
    ...additionalUserIds,
  ], { User, ...options });

const interactionBlocked = (res) => res.status(403).json({
  ok: false,
  error: { code: "INTERACTION_BLOCKED", message: "This interaction is unavailable" },
});

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
    if (await anyBlockedPairInSquad(squad)) return interactionBlocked(res);

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
        ...groupFields(squad, getRequesterIdentity(req).userId),
        member: publicGroupMember(squad, member),
        leaderMemberId: leader ? publicMemberId(squad, leader) : null,
        maxSlots: await getSquadCapacity(squad),
        members: await withMemberAvatars(squad.members, squad),
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
  const filters=directoryQuery(req.query);
  if(filters.error)return res.status(400).json({ok:false,error:{code:"INVALID_SEARCH",message:filters.error}});
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
      metadataQuery:filters.query,
    });

    // One block-state query for every member of every squad (was one per squad);
    // per-squad semantics match anyBlockedPairInSquad, failing closed on error.
    const memberIdsBySquad = squads.map((squad) => (squad.members || []).map((member) => member.userId));
    let blockState = null;
    try {
      blockState = await loadBlockState(memberIdsBySquad.flat(), { User });
    } catch {
      blockState = null;
    }
    const blocked = memberIdsBySquad.map((userIds) =>
      userIds.length > 0 && anyBlockedPairInState(userIds, blockState)
    );
    const visibleSquads = squads.filter((_squad, index) => !blocked[index]);
    const capacities = await getSquadCapacities(visibleSquads);
    const online = await Promise.all(visibleSquads.map(squad => groupPresence.onlineUserIds(squad.squadId, squad.members.map(member => member.userId))));
    const data = visibleSquads.map((squad, index) => {
      const leader = squad.members.find((m) => m.role === "leader");
      const myMember = squad.members.find((m) => isSameMember(m, identity));
      return {
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
        status: squad.status,
        ...groupFields(squad, getRequesterIdentity(req).userId),
        memberCount: squad.members.length,
        onlineCount: online[index].size,
        maxSlots: capacities[index],
        coverImage: publicCoverImage(squad),
        tags: squad.tags || [],
        leaderName: leader ? (aliasGroup(squad) ? groupAlias(leader) : leader.displayName) : undefined,
        myRole: myMember ? myMember.role : undefined,
        joinPolicy: squad.joinPolicy || "open",
      };
    });

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
  const { displayName, squadName, tags, visibility, identityMode = "names", communicationMode = "video", alias, joinPolicy = "open" } = req.body;
  if (!["names", "aliases"].includes(identityMode) || !["chat", "voice", "video"].includes(communicationMode) || !["open", "request", "invite"].includes(joinPolicy)) return res.status(400).json({ok:false,error:{code:"INVALID_GROUP_SETTINGS",message:"Choose a valid identity, call mode and join policy."}});
  const metadata=groupMetadata(req.body);
  if(metadata.error)return res.status(400).json({ok:false,error:{code:"INVALID_GROUP_SETTINGS",message:metadata.error}});
  const managedGroup=req.body.managedGroup === true || identityMode === "aliases";
  const chosenAlias = identityMode === "aliases" ? normalizeEncounterAlias(alias) : null;
  if (chosenAlias && (!chosenAlias.value || chosenAlias.error)) return res.status(400).json({ok:false,error:{code:"INVALID_ALIAS",message:chosenAlias.error || "Choose an alias for this group."}});
  if (visibility === "open" && !isStrangerDiscoveryEnabled()) return discoveryDisabled(res);
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
    const normalizedSquadName = normalizeSquadName(squadName) || (managedGroup ? "New group" : `Squad ${squadCode}`);

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

    if (normalizedTags.tags.some((tag) => classifyVibe(tag) !== "ok")) {
      return res.status(400).json({
        ok: false,
        error: { code: "TAG_BLOCKED", message: "One or more tags are not allowed." },
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
      displayName: chosenAlias?.value || firstDisplayName(displayName, name, email),
      ...(chosenAlias ? {alias:chosenAlias.value} : {}),
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
      visibility: normalizedVisibility, identityMode, communicationMode, joinPolicy, managedGroup, ...metadata.value,
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
        member: publicGroupMember(newSquad, newMember),
        members: await withMemberAvatars([newMember], newSquad),
        status: newSquad.status,
        ...groupFields(newSquad, userId),
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

    const locatedSquad = await Squad.findOne(
      pathSquadId ? { squadId: pathSquadId } : { squadCode: normalizedSquadCode }
    );
    if (!locatedSquad) {
      return res.status(404).json({ok:false,error:{code:"SQUAD_NOT_FOUND",message:"Squad not found"}});
    }
    return await withSquadAdmissionLock(locatedSquad.squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId: locatedSquad.squadId }), admissionSignal);
      if (!squad || (!pathSquadId && normalizedSquadCode && squad.squadCode !== normalizedSquadCode)) {
        return res.status(404).json({
          ok: false,
          error: { code: "SQUAD_NOT_FOUND", message: "Squad not found" },
        });
      }

      if (squad.visibility === "open" && !isStrangerDiscoveryEnabled()) return discoveryDisabled(res);
      if (squad.authorizedPrincipalPair?.length && !squad.authorizedPrincipalPair.includes(userId)) return res.status(403).json({ok:false,error:{code:"PAIR_ONLY",message:"This private group is only for its two participants."}});
      if (await anyBlockedPairInSquad(squad, [userId])) return interactionBlocked(res);

      if ((squad.bannedMembers || []).some(member=>String(member.userId)===userId)) return res.status(403).json({ok:false,error:{code:"GROUP_BANNED",message:"This group is unavailable."}});
      const existingMember = squad.members.find((candidate) => isSameMember(candidate, { userId, providerAccountId }));
      if (existingMember) {
        await resolveSquadInviteNotification(userId, squad.squadId);
        return res.status(200).json({
          ok: true,
          data: {
            squadId: squad.squadId,
            squadCode: squad.squadCode,
            squadName: squad.squadName,
            member: publicGroupMember(squad, existingMember),
            members: await withMemberAvatars(squad.members, squad),
            status: squad.status,
          ...groupFields(squad, getRequesterIdentity(req).userId),
          },
        });
      }

      const inviteValidated = validGroupInvite(squad, req.body?.invite);
      if (squad.managedGroup && squad.visibility === "private" &&
          !inviteValidated && !hasIdentityId(squad.invitedUserIds, userId)) {
        return res.status(403).json({
          ok: false,
          error: { code: "INVITE_REQUIRED", message: "Use a current invite link to join this private group." },
        });
      }
      const chosenAlias = aliasGroup(squad) ? normalizeEncounterAlias(req.body?.alias) : null;
      if (chosenAlias && (!chosenAlias.value || chosenAlias.error)) return res.status(400).json({ok:false,error:{code:"INVALID_ALIAS",message:chosenAlias.error || "Choose an alias for this group."}});

      // Invite-only: the squad accepts neither instant joins nor requests. Only
      // users the leader explicitly invited (present in invitedUserIds) may join.
      if (squad.joinPolicy === "invite") {
        const invited = inviteValidated || hasIdentityId(squad.invitedUserIds, userId);
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
        const outcome = await withMatchmakingLock(async (signal) => {
          return mongoose.connection.transaction(async (session) => {
            const currentSquad = guardSquadWrites(await Squad.findOne(
              { squadId: squad.squadId },
              null,
              { session }
            ), admissionSignal);
            if (!currentSquad) {
              return { error: { status: 404, code: "SQUAD_NOT_FOUND", message: "Squad not found" } };
            }
            if ((currentSquad.bannedMembers || []).some(member=>String(member.userId)===userId)) return {error:{status:403,code:"GROUP_BANNED",message:"This group is unavailable."}};
            if (currentSquad.joinPolicy !== "request") {
              return { error: { status: 409, code: "SQUAD_CHANGED", message: "Squad join settings changed" } };
            }
            if (await anyBlockedPairInSquad(currentSquad, [userId], { session })) {
              return { blocked: true };
            }
            if (hasIdentityId(currentSquad.joinRequests, userId, "userId")) {
              return { added: false, squadId: currentSquad.squadId };
            }
            if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");

            currentSquad.joinRequests.push({
              userId,
              name: (chosenAlias?.value || firstDisplayName(displayName, name, email)),
              ...(chosenAlias ? {alias:chosenAlias.value} : {}),
              requestedAt: new Date(),
            });
            await currentSquad.save({ session });

            const leader = currentSquad.members.find((member) => member.role === "leader");
            const notification = leader?.userId
              ? await createNotification({
                  userId: leader.userId,
                  type: "join_request",
                  title: "New join request",
                  body: `${(chosenAlias?.value || firstDisplayName(displayName, name, email))} wants to join ${currentSquad.squadName}`,
                  fromUserId: userId,
                  ...(aliasGroup(currentSquad) ? {publicFromId:groupHandle(currentSquad,{userId}),publicFromName:chosenAlias.value} : {}),
                  fromName: (chosenAlias?.value || firstDisplayName(displayName, name, email)),
                  squadId: currentSquad.squadId,
                  squadCode: currentSquad.squadCode,
                  squadName: currentSquad.squadName,
                }, { session, required: true, emit: false })
              : null;
            if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
            return { added: true, notification, squadId: currentSquad.squadId };
          });
        });
        if (outcome.blocked) return interactionBlocked(res);
        if (outcome.error) {
          return res.status(outcome.error.status).json({
            ok: false,
            error: { code: outcome.error.code, message: outcome.error.message },
          });
        }
        if (outcome.added) {
          if (outcome.notification) emitNotification(outcome.notification);
          socketService.emitToSquad(outcome.squadId, "SQUAD_UPDATED", {});
        }
        await resolveSquadInviteNotification(userId, outcome.squadId || squad.squadId);
        return res.status(200).json({ ok: true, data: { status: "requested" } });
      }

      // Multi-squad membership: being in another squad no longer blocks joining
      // this one. Other validations (already in THIS squad handled above; full;
      // closed) still apply below.
      const capacity = await getSquadCapacity(squad);
      if (squad.members.length >= capacity) {
        // A free squad (capacity 4) that is full prompts an upgrade; a premium
        // squad at its 8-seat cap returns the plain full error.
        if (capacity !== 2 && capacity <= FREE_MAX_MEMBERS) {
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
        displayName: (chosenAlias?.value || firstDisplayName(displayName, name, email)),
        ...(chosenAlias ? {alias:chosenAlias.value} : {}),
        role: "member",
        ready: false,
        joinedAt: new Date().toISOString(),
      };

      squad.members.push(newMember);
      await squad.save();
      if (await anyBlockedPairInSquad(squad)) {
        const addedIndex = squad.members.findIndex((member) => member.memberId === memberId);
        if (addedIndex >= 0) squad.members.splice(addedIndex, 1);
        await squad.save();
        return interactionBlocked(res);
      }
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
      await resolveSquadInviteNotification(userId, squad.squadId);

      return res.status(200).json({
        ok: true,
        data: {
          squadId: squad.squadId,
          squadCode: squad.squadCode,
          squadName: squad.squadName,
          member: publicGroupMember(squad, newMember),
          members: await withMemberAvatars(squad.members, squad),
          status: squad.status,
          ...groupFields(squad, getRequesterIdentity(req).userId),
        },
      });
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
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
    if (await anyBlockedPairInSquad(squad)) return interactionBlocked(res);

    // Load independent lobby state together; this endpoint runs after every
    // generic squad update, so serial remote reads make every member wait.
    const memberUserIds = squad.members.map((m) => m.userId).filter(Boolean);
    const [sessionData, demoUsers, onlineMemberIds] = await Promise.all([
      sessionService.getSquadSession(squad.squadId),
      memberUserIds.length
        ? User.find({ _id: { $in: memberUserIds } })
            .select("_id gender languages country isPremium premiumExpiresAt avatar ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus")
            .lean()
        : Promise.resolve([]),
      groupPresence.onlineUserIds(squad.squadId, memberUserIds),
    ]);
    const demoById = new Map(demoUsers.map((u) => [u._id.toString(), u]));
    const capacityLeader = leader ||
      squad.members.find((member) => member.role === "leader") ||
      squad.members.find((member) => member.memberId === squad.leaderMemberId);
    const leaderUser = capacityLeader?.userId
      ? demoById.get(String(capacityLeader.userId))
      : undefined;
    const maxSlots = squad.authorizedPrincipalPair?.length === 2 ? 2 : Math.min(
      hasActivePremium(leaderUser) ? PREMIUM_MAX_MEMBERS : FREE_MAX_MEMBERS,
      MAX_SQUAD_MEMBERS
    );

    const visibleMembers = squad.members.filter(member => !(squad.bannedMembers||[]).some(banned=>String(banned.userId)===String(member.userId)) && (!squad.managedGroup && !aliasGroup(squad) || hasAdultAccess(demoById.get(String(member.userId)))));
    const mergedMembers = await Promise.all(visibleMembers.map(async member => {
      const live = sessionData[member.memberId] || {};
      const u = demoById.get(String(member.userId));
      return publicGroupMember(squad, member, {
        ...member.toObject(),
        uid: lobbyRtcUid({squadId:squad.squadId,userId:member.userId,identityMode:squad.identityMode}),
        ...await memberMedia.publicState(member.userId, `squad:${squad.squadId}:${member.memberId}`),
        ready: live.ready !== undefined ? live.ready : member.ready,
        inLobbyVideo: live.inLobbyVideo !== undefined ? live.inLobbyVideo : member.inLobbyVideo,
        inEncounterVideo: live.inEncounterVideo !== undefined ? live.inEncounterVideo : member.inEncounterVideo,
        // Live presence — is this member actually connected right now?
        online: onlineMemberIds.has(member.userId),
        gender: u ? u.gender : undefined,
        languages: u ? u.languages || [] : undefined,
        country: u ? u.country : undefined,
        avatar: publicAvatar(u?.avatar),
      });
    }));

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        squadCode: squad.squadCode,
        squadName: squad.squadName,
        status: squad.status,
        ...groupFields(squad, getRequesterIdentity(req).userId),
        members: mergedMembers,
        onlineCount: onlineMemberIds.size,
        maxSlots,
        leaderMemberId: leader ? publicMemberId(squad, leader) : undefined,
        tags: squad.tags,
        coverImage: publicCoverImage(squad),
        visibility: squad.visibility || "private",
        joinPolicy: squad.joinPolicy || "open",
        invitedCount: (squad.invitedUserIds || []).length,
        ...(aliasGroup(squad) ? {} : {invitedUserIds:squad.invitedUserIds || []}),
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

    const viewerId = getRequesterIdentity(req).userId;
    if ((squad.bannedMembers || []).some(member=>String(member.userId)===String(viewerId))) return res.status(404).json({ok:false,error:{code:"NOT_FOUND",message:"This group is unavailable."}});
    if (squad.managedGroup && squad.visibility === "private" && !squad.members.some(member=>isSameMember(member,getRequesterIdentity(req)))) return res.status(404).json({ok:false,error:{code:"NOT_FOUND",message:"Use a current invite link to preview this group."}});
    if (await anyBlockedPairInSquad(squad, [viewerId])) return interactionBlocked(res);

    const leader =
      squad.members.find((m) => m.role === "leader") ||
      (squad.leaderMemberId
        ? squad.members.find((m) => m.memberId === squad.leaderMemberId)
        : undefined);

    // Members see their own squad for real; everyone else sees anonymous
    // members only by alias (publicMemberView).
    const viewerIsMember = squad.members.some((member) => isSameMember(member, getRequesterIdentity(req)));
    const users = await loadPublicIdentityUsers(squad.members);
    const views = new Map(squad.members.map((member) => [
      member,
      aliasGroup(squad) ? publicGroupMember(squad, member) : viewerIsMember
        ? {
            memberId: member.memberId,
            displayName: publicMemberName(member),
            avatar: publicAvatar(identityUserFor(users || new Map(), member.userId)?.avatar),
          }
        : publicMemberView(squad, member, users),
    ]));
    const members = squad.members.map((member) => ({
      ...views.get(member),
      role: member.role,
      ...(aliasGroup(squad) ? {} : {avatarId:member.avatarId}),
    }));

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        squadName: publicSquadName(squad),
        status: squad.status,
        ...groupFields(squad, getRequesterIdentity(req).userId),
        members,
        memberCount: squad.members.length,
        maxSlots: await getSquadCapacity(squad),
        leaderMemberId: leader ? views.get(leader)?.memberId : undefined,
        leaderName: leader ? views.get(leader)?.displayName : undefined,
        tags: publicSquadTags(squad),
        coverImage: publicCoverImage(squad),
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
  let lock;

  if (typeof ready !== "boolean") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Ready state must be a boolean" },
    });
  }

  try {
    const { squad: accessedSquad, member: accessedMember } = req.squadAccess;
    lock = await redlock.acquire([`lock:squad:${accessedSquad.squadId}:admission`], 10_000);
    const squad = await Squad.findOne({ squadId: accessedSquad.squadId });
    const member = squad?.members.find((candidate) => candidate.memberId === accessedMember.memberId);

    if (!squad || !member) {
      return res.status(404).json({
        ok: false,
        error: { code: "SQUAD_NOT_FOUND", message: "Squad membership not found" },
      });
    }

    if (squad.status !== "idle") {
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

    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {
      memberId: publicMemberId(squad,member),
      ready,
    });

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        memberId: publicMemberId(squad,member),
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
  } finally {
    if (lock) await lock.release();
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
  if (req.squadAccess?.squad?.authorizedPrincipalPair?.length === 2) return res.status(403).json({ok:false,error:{code:"PAIR_ONLY",message:"This private conversation stays invite-only."}});
  if (req.body?.visibility === "open" && !isStrangerDiscoveryEnabled()) return discoveryDisabled(res);
  const squadId = req.squadAccess.squad.squadId;
  const { visibility } = req.body || {};

  if (visibility !== "private" && visibility !== "open") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: 'visibility must be "private" or "open"' },
    });
  }

  try {
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || !squad.members.some(member =>
        member.role === "leader" && isSameMember(member, getRequesterIdentity(req))
      )) {
        return res.status(403).json({
          ok: false,
          error: { code: "LEADER_ONLY", message: "Only the current group owner can change who can join." },
        });
      }
      if (squad.authorizedPrincipalPair?.length === 2) {
        return res.status(403).json({
          ok: false,
          error: { code: "PAIR_ONLY", message: "This private conversation stays invite-only." },
        });
      }
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
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
    console.error("Error updating squad visibility:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update visibility" },
    });
  }
};

const updateSquadJoinPolicyHandler = async (req, res) => {
  if (req.squadAccess?.squad?.authorizedPrincipalPair?.length === 2) return res.status(403).json({ok:false,error:{code:"PAIR_ONLY",message:"This private conversation stays invite-only."}});
  const squadId = req.squadAccess.squad.squadId;
  const { joinPolicy } = req.body || {};

  if (joinPolicy !== "open" && joinPolicy !== "request" && joinPolicy !== "invite") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: 'joinPolicy must be "open", "request", or "invite"' },
    });
  }

  try {
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || !squad.members.some(member =>
        member.role === "leader" && isSameMember(member, getRequesterIdentity(req))
      )) {
        return res.status(403).json({
          ok: false,
          error: { code: "LEADER_ONLY", message: "Only the current group owner can change who can join." },
        });
      }
      if (squad.authorizedPrincipalPair?.length === 2) {
        return res.status(403).json({
          ok: false,
          error: { code: "PAIR_ONLY", message: "This private conversation stays invite-only." },
        });
      }
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
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
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

    // Load the live roster and pending users together so stale/missing/blocked
    // requests fail closed before any profile fields are returned.
    const memberUserIds = squad.members.map((member) => member.userId);
    const userIds = [...new Set([...memberUserIds, ...requests.map((request) => request.userId)])];
    const users = userIds.length
      ? await User.find(
          { _id: { $in: userIds } },
          "_id blockedUserIds gender languages country avatar"
        )
      : [];
    const byId = new Map(users.map((user) => [canonicalUserId(user._id), user]));

    const enriched = requests.filter((request) => {
      const requester = byId.get(canonicalUserId(request.userId));
      return requester && memberUserIds.every((memberUserId) => {
        const member = byId.get(canonicalUserId(memberUserId));
        return member && !hasBlockedPair(member, requester);
      });
    }).map((r) => {
      const u = byId.get(canonicalUserId(r.userId));
      if (aliasGroup(squad)) return {userId:groupHandle(squad,r),name:r.alias || "Guest",requestedAt:r.requestedAt,avatar:null};
      return {
        userId: r.userId,
        name: r.name,
        requestedAt: r.requestedAt,
        gender: u ? u.gender : undefined,
        languages: u ? u.languages || [] : undefined,
        country: u ? u.country : undefined,
        avatar: publicAvatar(u?.avatar),
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
  let { userId: targetUserId } = req.params;
  const { userId: leaderUserId } = getRequesterIdentity(req);

  try {
    const squadId = req.squadAccess.squad.squadId;
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || !squad.members.some(member =>
        member.role === "leader" && isSameMember(member, getRequesterIdentity(req))
      )) {
        return res.status(403).json({
          ok: false,
          error: { code: "LEADER_ONLY", message: "Only the current group owner can approve requests." },
        });
      }
      if (aliasGroup(squad)) targetUserId = (squad.joinRequests || []).find(r => groupHandle(squad,r) === targetUserId)?.userId;
      if (!targetUserId) return res.status(404).json({ok:false,error:{code:"REQUEST_NOT_FOUND",message:"Join request not found"}});
      if (squad.visibility === "open" && !isStrangerDiscoveryEnabled()) return discoveryDisabled(res);
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

      if ((squad.bannedMembers || []).some(member=>String(member.userId)===targetUserId)) return res.status(403).json({ok:false,error:{code:"GROUP_BANNED",message:"This group is unavailable."}});
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({
          ok: false,
          error: { code: "REQUEST_USER_NOT_FOUND", message: "Join request user no longer exists" },
        });
      }
      if (!hasAdultAccess(targetUser)) {
        return res.status(403).json({
          ok: false,
          error: { code: "AGE_RESTRICTED", message: "This user must complete adult age verification" },
        });
      }
      if (await anyBlockedPairInSquad(squad, [targetUserId])) return interactionBlocked(res);

      // If already a member, just clear the stale request.
      const alreadyMember = hasIdentityId(squad.members, targetUserId, "userId");
      if (alreadyMember) {
        squad.joinRequests.splice(reqIndex, 1);
        await squad.save();
        socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
        await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);
        return res.status(200).json({
          ok: true,
          data: { squadId: squad.squadId, userId: aliasGroup(squad) ? groupHandle(squad,{userId:targetUserId}) : targetUserId, status: "member" },
        });
      }

      if (squad.authorizedPrincipalPair?.length && !squad.authorizedPrincipalPair.includes(targetUserId)) return res.status(403).json({ok:false,error:{code:"PAIR_ONLY",message:"This private group is only for its two participants."}});
      const capacity = await getSquadCapacity(squad);
      if (squad.members.length >= capacity) {
        return res.status(409).json({
          ok: false,
          error: { code: "SQUAD_FULL", message: `Squad is full (max ${capacity} members)` },
        });
      }

      const newMember = {
        memberId: generateId("mem"),
        userId: targetUserId,
        providerAccountId: targetUserId,
        displayName: aliasGroup(squad) ? (request.alias || "Guest") : request.name || targetUser.name || targetUser.email,
        ...(aliasGroup(squad) ? {alias:request.alias} : {}),
        role: "member",
        ready: false,
        joinedAt: new Date().toISOString(),
      };

      squad.members.push(newMember);
      squad.joinRequests.splice(reqIndex, 1);
      await squad.save();
      if (await anyBlockedPairInSquad(squad)) {
        const addedIndex = squad.members.findIndex((member) => member.memberId === newMember.memberId);
        if (addedIndex >= 0) squad.members.splice(addedIndex, 1);
        await squad.save();
        return interactionBlocked(res);
      }
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
      await resolveJoinRequestNotification(leaderUserId, targetUserId, squad.squadId);

      return res.status(200).json({
        ok: true,
        data: {
          squadId: squad.squadId,
          member: publicGroupMember(squad, newMember),
          members: await withMemberAvatars(squad.members, squad),
          status: squad.status,
          ...groupFields(squad, getRequesterIdentity(req).userId),
        },
      });
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
    console.error("Error approving join request:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to approve join request" },
    });
  }
};

const declineJoinRequestHandler = async (req, res) => {
  let { userId: targetUserId } = req.params;
  const { userId: leaderUserId } = getRequesterIdentity(req);

  try {
    const { squad } = req.squadAccess;
    if (aliasGroup(squad)) targetUserId = (squad.joinRequests || []).find(r => groupHandle(squad,r) === targetUserId)?.userId;
    if (!targetUserId) return res.status(404).json({ok:false,error:{code:"REQUEST_NOT_FOUND",message:"Join request not found"}});
    if (squad.visibility === "open" && !isStrangerDiscoveryEnabled()) return discoveryDisabled(res);
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
      data: { squadId: squad.squadId, userId: aliasGroup(squad) ? groupHandle(squad,{userId:targetUserId}) : targetUserId, status: "declined" },
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
    const inviterIdentity = getRequesterIdentity(req);

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

    const targetUser = await User.findById(targetUserId).select(
      "_id ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus"
    );
    if (!targetUser) {
      return res.status(404).json({
        ok: false,
        error: { code: "INVITE_USER_NOT_FOUND", message: "Invite target user no longer exists" },
      });
    }
    if (!hasAdultAccess(targetUser)) {
      return res.status(403).json({
        ok: false,
        error: { code: "AGE_RESTRICTED", message: "This user must complete adult age verification" },
      });
    }
    const outcome = await withMatchmakingLock(async (signal) => {
      return mongoose.connection.transaction(async (session) => {
        const currentSquad = await Squad.findOne(
          { squadId: squad.squadId },
          null,
          { session }
        );
        if (currentSquad?.authorizedPrincipalPair?.length && !currentSquad.authorizedPrincipalPair.includes(targetUserId)) return {error:{status:403,code:"PAIR_ONLY",message:"This private group is only for its two participants."}};
        if (!currentSquad) {
          return { error: { status: 404, code: "SQUAD_NOT_FOUND", message: "Squad not found" } };
        }
        const currentLeader = currentSquad.members.find(
          (candidate) => candidate.role === "leader" && isSameMember(candidate, inviterIdentity)
        );
        if (!currentLeader) {
          return { error: { status: 403, code: "LEADER_ONLY", message: "Only the squad leader can invite" } };
        }
        if (await anyBlockedPairInSquad(currentSquad, [targetUserId], { session })) {
          return { blocked: true };
        }
        if (!Array.isArray(currentSquad.invitedUserIds)) currentSquad.invitedUserIds = [];
        if (hasIdentityId(currentSquad.invitedUserIds, targetUserId)) {
          return {
            added: false,
            squadId: currentSquad.squadId,
            invitedCount: currentSquad.invitedUserIds.length,
          };
        }

        currentSquad.invitedUserIds.push(targetUserId);
        await currentSquad.save({ session });
        if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
        return {
          added: true,
          squadId: currentSquad.squadId,
          invitedCount: currentSquad.invitedUserIds.length,
        };
      });
    });
    if (outcome.blocked) return interactionBlocked(res);
    if (outcome.error) {
      return res.status(outcome.error.status).json({
        ok: false,
        error: { code: outcome.error.code, message: outcome.error.message },
      });
    }
    if (outcome.added) {
      socketService.emitToSquad(outcome.squadId, "SQUAD_UPDATED", {});
    }

    return res.status(200).json({
      ok: true,
      data: {
        squadId: outcome.squadId,
        invitedUserId: aliasGroup(squad) ? groupHandle(squad,{userId:targetUserId}) : targetUserId,
        invitedCount: outcome.invitedCount,
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
  let { userId: targetUserId } = req.params;

  try {
    const { squad } = req.squadAccess;
    if (aliasGroup(squad)) targetUserId = (squad.invitedUserIds || []).find(userId => groupHandle(squad,{userId}) === targetUserId);
    if (!targetUserId) return res.status(404).json({ok:false,error:{code:"NOT_FOUND",message:"Invite not found"}});
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
        revokedUserId: aliasGroup(squad) ? groupHandle(squad,{userId:targetUserId}) : targetUserId,
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
    const inviterIdentity = getRequesterIdentity(req);
    const ownMember = squad.members.find(member => isSameMember(member,inviterIdentity));
    const inviterName = aliasGroup(squad) ? groupAlias(ownMember) : req.giggleIdentity?.name || inviterIdentity.name;
    const targetUser = await User.findById(targetUserId).select(
      "_id ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus"
    );
    if (!targetUser) {
      return res.status(404).json({
        ok: false,
        error: { code: "INVITE_USER_NOT_FOUND", message: "Invite target user no longer exists" },
      });
    }
    if (!hasAdultAccess(targetUser)) {
      return res.status(403).json({
        ok: false,
        error: { code: "AGE_RESTRICTED", message: "This user must complete adult age verification" },
      });
    }
    const outcome = await withMatchmakingLock(async (signal) => {
      return mongoose.connection.transaction(async (session) => {
        const currentSquad = await Squad.findOne(
          { squadId: squad.squadId },
          null,
          { session }
        );
        if (currentSquad?.authorizedPrincipalPair?.length && !currentSquad.authorizedPrincipalPair.includes(targetUserId)) return {error:{status:403,code:"PAIR_ONLY",message:"This private group is only for its two participants."}};
        if (!currentSquad) {
          return { error: { status: 404, code: "SQUAD_NOT_FOUND", message: "Squad not found" } };
        }
        if (!currentSquad.members.some((candidate) => isSameMember(candidate, inviterIdentity))) {
          return { error: { status: 403, code: "FORBIDDEN", message: "Squad member access required" } };
        }
        if (await anyBlockedPairInSquad(currentSquad, [targetUserId], { session })) {
          return { blocked: true };
        }
        if (!Array.isArray(currentSquad.invitedUserIds)) currentSquad.invitedUserIds = [];
        const alreadyInvited = hasIdentityId(currentSquad.invitedUserIds, targetUserId);
        const alreadyMember = hasIdentityId(currentSquad.members, targetUserId, "userId");
        if (alreadyInvited || alreadyMember) {
          return { added: false, squadId: currentSquad.squadId };
        }
        if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");

        currentSquad.invitedUserIds.push(targetUserId);
        await currentSquad.save({ session });
        const notification = await createNotification({
          userId: targetUserId,
          type: "squad_invite",
          title: "Squad invite",
          body: `${inviterName || "Someone"} invited you to ${currentSquad.squadName}`,
          fromUserId: inviterIdentity.userId,
          ...(aliasGroup(currentSquad) ? {publicFromId:groupHandle(currentSquad,ownMember),publicFromName:inviterName} : {}),
          fromName: inviterName,
          squadId: currentSquad.squadId,
          squadCode: currentSquad.squadCode,
          squadName: currentSquad.squadName,
        }, { session, required: true, emit: false });
        if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
        return { added: true, notification, squadId: currentSquad.squadId };
      });
    });
    if (outcome.blocked) return interactionBlocked(res);
    if (outcome.error) {
      return res.status(outcome.error.status).json({
        ok: false,
        error: { code: outcome.error.code, message: outcome.error.message },
      });
    }
    if (outcome.added) {
      emitNotification(outcome.notification);
      socketService.emitToSquad(outcome.squadId, "SQUAD_UPDATED", {});
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
  if (!isStrangerDiscoveryEnabled()) return discoveryDisabled(res);

  let searchStateSaved = false;
  let squad = null;
  let queueAdmissionId;

  try {
    const { member, squad: accessedSquad } = req.squadAccess;
    if (accessedSquad.authorizedPrincipalPair?.length || accessedSquad.communicationMode && accessedSquad.communicationMode !== "video") return res.status(409).json({ok:false,error:{code:"GROUP_ROOM_ONLY",message:"Use this group room for its chosen call mode.",squadId:accessedSquad.squadId}});
    const admitted = await withSquadAdmissionLock(accessedSquad.squadId, async admissionSignal => {
    squad = guardSquadWrites(await Squad.findOne({ squadId: accessedSquad.squadId }), admissionSignal);

    if (!squad || !squad.members.some((candidate) => candidate.memberId === member.memberId && candidate.role === "leader")) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Squad leader access required" },
      });
    }

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

    if ((squad.tags || []).some((tag) => classifyVibe(tag) !== "ok")) {
      return res.status(400).json({
        ok: false,
        error: { code: "TAG_BLOCKED", message: "One or more tags are not allowed." },
      });
    }

    if (!(await allUsersHaveAdultAccess(squad.members.map((member) => member.userId), { User }))) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "AGE_RESTRICTED",
          message: "Every squad member must complete adult age verification",
        },
      });
    }
    if (await anyBlockedPairInSquad(squad)) return interactionBlocked(res);

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

    const premium = await getSquadPremiumStatus(squad);
    await withMatchmakingLock(async signal => {
    const now = new Date();
    squad.status = "searching";
    squad.searchQueuedAt = now;
    squad.searchRegion = squad.searchRegion || "global";
    squad.currentEncounterId = null;
    squad.opponentSquadId = null;
    squad.matchedAt = null;
    squad.isPremiumSquad = premium;
    if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
    await squad.save();
    searchStateSaved = true;
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    // Add to Redis Queue
    queueAdmissionId = await queueService.addToQueue(squad.squadId, squad.members.length, squad.searchRegion, squad.tags, squad.reputationScore);

    }, { squadIds: [squad.squadId] });
    return { queued: true, member };
    });
    if (!admitted?.queued) return admitted;
    const { member: startedBy } = admitted;
    // Both the admission lease and own-squad state lease are released before
    // the matcher attempts any pair, avoiding nested cross-squad admission.

    // The queue write is the durable boundary the caller needs. Flush the
    // response before the candidate scan so navigation does not wait on it.
    const response = res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        status: "searching",
        startedByMemberId: startedBy.memberId,
      },
    });
    await tryMatchmakeForSquad(squad);
    return response;
  } catch (error) {
    console.error("Error starting search:", error);
    if (res.headersSent) return;
    if (searchStateSaved) {
      try {
        if (squad) {
          await withMatchmakingLock(async signal => {
            if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
            const reset = await Squad.updateOne({ squadId: squad.squadId, status: "searching", currentEncounterId: null,
              searchQueuedAt: squad.searchQueuedAt, __v: squad.__v == null ? { $exists: false } : squad.__v },
            { $set: { status: "idle", searchQueuedAt: null }, $inc: { __v: 1 } });
            if ((reset.matchedCount ?? reset.n ?? 0) === 1 && queueAdmissionId) await queueService.removeFromQueue(squad.squadId, { admissionId: queueAdmissionId });
          }, { squadIds: [squad.squadId] });
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
    const { squad: accessedSquad, member } = req.squadAccess;
    const outcome = await withMatchmakingLock(async (signal) => {
      const squad = await Squad.findOne({ squadId: accessedSquad.squadId });
      if (!squad) {
        return { error: { status: 404, code: "SQUAD_NOT_FOUND", message: "Squad not found" } };
      }
      if (!squad.members.some(candidate => candidate.role === "leader" && isSameMember(candidate, getRequesterIdentity(req)))) {
        return { error: { status: 403, code: "LEADER_ONLY", message: "Only the current squad leader can cancel search" } };
      }
      if (squad.status !== "searching") {
        return { error: { status: 409, code: "NOT_IN_SEARCH", message: "Squad is not in searching state" } };
      }

      const admission = await queueService.getQueueAdmission(squad.squadId);
      if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
      const changed = await Squad.updateOne({
        squadId: squad.squadId, status: "searching", currentEncounterId: null,
        searchQueuedAt: squad.searchQueuedAt ?? null,
        __v: squad.__v == null ? { $exists: false } : squad.__v,
      }, { $set: { status: "idle", searchQueuedAt: null }, $inc: { __v: 1 } });
      if ((changed.matchedCount ?? changed.n ?? 0) !== 1) {
        return { error: { status: 409, code: "SQUAD_CHANGED", message: "This squad changed. Refresh it and try again." } };
      }
      if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
      await queueService.removeIfAdmission(squad.squadId, admission);
      return { squadId: squad.squadId, status: "idle" };
    }, { squadIds: [accessedSquad.squadId] });

    if (outcome.error) {
      return res.status(outcome.error.status).json({
        ok: false,
        error: { code: outcome.error.code, message: outcome.error.message },
      });
    }
    socketService.emitToSquad(outcome.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: {
        squadId: outcome.squadId,
        status: outcome.status,
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
    const squadId = req.squadAccess.squad.squadId;
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || !squad.members.some(member =>
        member.role === "leader" && isSameMember(member, getRequesterIdentity(req))
      )) {
        return res.status(403).json({
          ok: false,
          error: { code: "LEADER_ONLY", message: "Only the current group owner can remove members." },
        });
      }
      const targetIndex = squad.members.findIndex((candidate) => candidate === resolveGroupMember(squad, memberId));

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

      if (squad.managedGroup) {
        if (!squad.bannedMembers) {
          squad.bannedMembers = [];
        }
        if (!squad.bannedMembers.some(member => String(member.userId) === String(targetMember.userId))) {
          squad.bannedMembers.push({
            memberId: targetMember.memberId,
            userId: targetMember.userId,
            displayName: targetMember.displayName,
            alias: targetMember.alias,
            bannedAt: new Date(),
          });
        }
        await squad.save();
        await removeSquadMember(squad, targetIndex);
      } else {
        squad.members.splice(targetIndex, 1);
        await squad.save();
        await memberMedia.clearMember(targetMember.userId, targetMember.memberId);
        socketService.revokeUserRealtimeAccess({
          userId: targetMember.userId,
          squadId: squad.squadId,
          encounterId: squad.currentEncounterId,
        });
        socketService.emitToUser(targetMember.userId, "SQUAD_UPDATED", { squadId: squad.squadId, removed: true });
        socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
      }

      return res.status(200).json({
        ok: true,
        data: {
          squadId: squad.squadId,
          kickedMemberId: publicMemberId(squad, targetMember),
          remainingCount: squad.members.length,
          status: squad.status,
          ...groupFields(squad, getRequesterIdentity(req).userId),
        },
      });
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
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
    const squadId = req.squadAccess.squad.squadId;
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || !squad.members.some(member =>
        member.role === "leader" && isSameMember(member, getRequesterIdentity(req))
      )) {
        return res.status(403).json({
          ok: false,
          error: { code: "LEADER_ONLY", message: "Only the current group owner can transfer ownership." },
        });
      }
      const targetMember = resolveGroupMember(squad, memberId);

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
          newLeaderMemberId: publicMemberId(squad,targetMember),
          previousLeaderMemberId: publicMemberId(squad,currentLeader),
        },
      });
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
    console.error("Error promoting member:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to promote member" },
    });
  }
};

const leaveSquadHandler = async (req, res) => {
  try {
    const squadId = req.squadAccess.squad.squadId;
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      const memberIndex = squad?.members.findIndex(member =>
        isSameMember(member, getRequesterIdentity(req))
      ) ?? -1;
      if (!squad || memberIndex < 0) {
        return res.status(404).json({
          ok: false,
          error: { code: "MEMBER_NOT_FOUND", message: "You are no longer in this group." },
        });
      }
      if (squad.managedGroup && squad.members[memberIndex].role === "leader" && squad.members.length > 1) {
        return res.status(409).json({
          ok: false,
          error: {
            code: "OWNER_TRANSFER_REQUIRED",
            message: "Choose the next group owner in group settings before leaving.",
            squadId: squad.squadId,
          },
        });
      }
      const result = await removeSquadMember(squad, memberIndex);
      if (!result) throw new Error("Squad member no longer exists");
      const { removedMember: leavingMember, squadDeleted, newLeaderMemberId } = result;

      return res.status(200).json({
        ok: true,
        data: {
          squadId: squad.squadId,
          leftMemberId: publicMemberId(squad, leavingMember),
          newLeaderMemberId: newLeaderMemberId
            ? publicMemberId(squad, squad.members.find(member => member.memberId === newLeaderMemberId))
            : null,
          remainingCount: squad.members.length,
          squadDeleted,
        },
      });
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
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
    const squadId = req.squadAccess.squad.squadId;
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || !squad.members.some(member =>
        member.role === "leader" && isSameMember(member, getRequesterIdentity(req))
      )) {
        return res.status(403).json({
          ok: false,
          error: { code: "NOT_LEADER", message: "Only the squad leader can delete the squad." },
        });
      }

      // Pull it out of matchmaking before it disappears.
      if (squad.status === "searching") {
        try { await queueService.removeFromQueue(squad.squadId); } catch (e) { console.error("Error dequeuing squad on disband:", e); }
      }

      // Mid-call: end the encounter for the other squad (and requeue it) first,
      // as when the last member leaves; otherwise it sits in a dead call.
      if (squad.currentEncounterId && ["matched", "in_encounter"].includes(squad.status)) {
        const encounter = await getEncounterById(squad.currentEncounterId);
        if (encounter) await endEncounterAsymmetric({ encounter, disconnectingSquadId: squad.squadId });
      }

      const removedMembers = [...squad.members];
      await deleteSquadAndNotifications(squad);
      for (const member of removedMembers) {
        socketService.revokeUserRealtimeAccess({
          userId: member.userId,
          squadId: squad.squadId,
          encounterId: squad.currentEncounterId,
        });
        socketService.emitToUser(member.userId, "SQUAD_UPDATED", { squadId: squad.squadId, disbanded: true });
      }

      return res.status(200).json({ ok: true, data: { squadId: squad.squadId, disbanded: true } });
    });
  } catch (error) {
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
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
    if (inLobbyVideo && squad.communicationMode === "chat") return res.status(403).json({ok:false,error:{code:"CHAT_ONLY",message:"This group uses text chat."}});
    await sessionService.setSessionField(squad.squadId, member.memberId, 'inLobbyVideo', inLobbyVideo);
    // Leaving the lobby video also means leaving the encounter video
    if (!inLobbyVideo) {
      await sessionService.setSessionField(squad.squadId, member.memberId, 'inEncounterVideo', false);
    }

    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});

    return res.status(200).json({
      ok: true,
      data: { memberId: publicMemberId(squad,member), inLobbyVideo },
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
      data: { memberId: publicMemberId(squad,member), inEncounterVideo },
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

  if (normalized.tags.some((tag) => classifyVibe(tag) !== "ok")) {
    return res.status(400).json({
      ok: false,
      error: { code: "TAG_BLOCKED", message: "One or more tags are not allowed." },
    });
  }

  try {
    const { squad } = req.squadAccess;

    squad.tags = normalized.tags;
    squad.adult = false;
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
  // Clients only ever see an uploaded cover as its served URL; re-applying the
  // current cover sends that URL back. Keep the stored image instead of saving
  // a URL that points at itself.
  const currentPublicCover = publicCoverImage(squad);
  if (
    currentPublicCover &&
    currentPublicCover !== squad.coverImage &&
    typeof req.body?.coverImage === "string" &&
    req.body.coverImage.trim() === currentPublicCover
  ) {
    return res.status(200).json({
      ok: true,
      data: { squadId: squad.squadId, coverImage: currentPublicCover },
    });
  }

  const normalized = normalizeSquadCoverImage(req.body?.coverImage);

  if (normalized.error) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_COVER_IMAGE", message: normalized.error },
    });
  }

  // Uploaded image bytes go to coverStorage; the squad keeps a short reference.
  const previousCover = squad.coverImage;
  const previousKey = uploadCoverKey(previousCover);
  let storedKey = null;
  try {
    let nextCover = normalized.coverImage;
    const upload = decodeCoverDataUrl(nextCover);
    if (upload) {
      ({ key: storedKey } = await coverStorage.putCover({
        squadId: squad.squadId,
        contentType: upload.contentType,
        bytes: upload.body,
      }));
      nextCover = uploadCoverRef(storedKey);
    }
    squad.coverImage = nextCover;
    await squad.save();
  } catch (error) {
    squad.coverImage = previousCover;
    // The squad was deleted meanwhile, so nothing will ever reference the new
    // image. After other failures the write may still have landed; keep it.
    if (storedKey && storedKey !== previousKey && error?.name === "DocumentNotFoundError") {
      await deleteCoverQuietly(storedKey);
    }
    console.error("Error updating squad cover:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update squad cover" },
    });
  }

  if (previousKey && previousKey !== storedKey) await deleteCoverQuietly(previousKey);
  socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
  return res.status(200).json({
    ok: true,
    data: { squadId: squad.squadId, coverImage: publicCoverImage(squad) },
  });
};

// Best effort: a leftover image is only wasted space (squad deletion removes
// all of a squad's covers), so it never fails the request.
const deleteCoverQuietly = async (key) => {
  try {
    await coverStorage.deleteCover(key);
  } catch (error) {
    console.error("Error deleting squad cover:", error);
  }
};

const toPublicSquad = async (squad, users) => {
  const leader = squad.members.find((m) => m.role === "leader");
  return {
    squadId: squad.squadId,
    squadName: publicSquadName(squad),
    memberCount: squad.members.length,
    maxSlots: await getSquadCapacity(squad),
    tags: publicSquadTags(squad),
    coverImage: publicCoverImage(squad),
    status: squad.status,
    visibility: squad.visibility || "private",
    joinPolicy: squad.joinPolicy || "open",
    ...groupFields(squad),
    onlineCount: (await groupPresence.onlineUserIds(squad.squadId,squad.members.map(member=>member.userId))).size,
  };
};

const findJoinableSquads = async (identity, metadataQuery = {}) => {
  // Joinable by strangers: idle status (join handler rejects anything else),
  // visibility "open", not full, and not already containing the requester.
  // Do the filtering in Mongo instead of fetching 200 and filtering in JS.
  const exclude = [];
  if (identity.userId) exclude.push(identity.userId);
  if (identity.providerAccountId) exclude.push(identity.providerAccountId);

  const query = {
    ...metadataQuery,
    status: "idle",
    visibility: "open",
    joinPolicy: { $in: ["open", "request"] },
    $expr: { $lt: [{ $size: "$members" }, MAX_SQUAD_MEMBERS] },
  };

  if (exclude.length > 0) {
    query["members.userId"] = { $nin: exclude };
    query["members.providerAccountId"] = { $nin: exclude };
  }

  if (identity.userId) query["bannedMembers.userId"] = {$ne:String(identity.userId)};
  const squads = await Squad.find(query).sort({ createdAt: -1 }).limit(30);
  const memberUserIds = squads.flatMap((squad) =>
    (squad.members || []).map((member) => member.userId)
  );
  const allowedIds = new Set(
    await filterBlockedCandidates(identity.userId, memberUserIds, { User })
  );
  return squads.filter((squad) =>
    (squad.members || []).every((member) => allowedIds.has(canonicalUserId(member.userId)))
  );
};

const discoverSquadsHandler = async (req, res) => {
  const filters=directoryQuery(req.query);
  if(filters.error)return res.status(400).json({ok:false,error:{code:"INVALID_SEARCH",message:filters.error}});
  const identity = getRequesterIdentity(req);

  if (!identity.userId) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  }
  if (!isStrangerDiscoveryEnabled()) return discoveryDisabled(res);

  try {
    const joinable = await findJoinableSquads(identity,filters.query);
    const listed = joinable.slice(0, 30);
    const users = await loadPublicIdentityUsers(
      listed.map((squad) => squad.members.find((member) => member.role === "leader")).filter(Boolean)
    );
    const squads = await Promise.all(listed.map((squad) => toPublicSquad(squad, users)));
    return res.status(200).json({ ok: true, data: { squads } });
  } catch (error) {
    console.error("Error discovering squads:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to discover squads" },
    });
  }
};

// Attempt to join a single squad under the shared admission lock. Returns the new member on
// success, or null if the squad became full/closed/gone (so the caller can
// try the next candidate). Re-reads the squad fresh to minimize race windows.
const tryJoinSquadOnce = async (squadId, identity, displayName) => {
  try {
    return await withSquadAdmissionLock(squadId, async admissionSignal => {
      const squad = guardSquadWrites(await Squad.findOne({ squadId }), admissionSignal);
      if (!squad || squad.visibility !== "open" || (squad.joinPolicy || "open") !== "open") {
        return null;
      }
      if (squad.status !== "idle" || aliasGroup(squad) || squad.authorizedPrincipalPair?.length || (squad.bannedMembers || []).some(member=>String(member.userId)===String(identity.userId))) return null;
      // Treat both free-full (4) and premium-full (8) as "full, try next" — never
      // surface the upgrade prompt from random matching.
      const capacity = await getSquadCapacity(squad);
      if (squad.members.length >= capacity) return null;
      if (squad.members.some((m) => isSameMember(m, identity))) return null;
      if (await anyBlockedPairInSquad(squad, [identity.userId])) return null;
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
      if (await anyBlockedPairInSquad(squad)) {
        const addedIndex = squad.members.findIndex((member) => member.memberId === newMember.memberId);
        if (addedIndex >= 0) squad.members.splice(addedIndex, 1);
        await squad.save();
        return null;
      }
      return newMember;
    });
  } catch (error) {
    if (error.status === 409) throw error;
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
  if (!isStrangerDiscoveryEnabled()) return discoveryDisabled(res);

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
            members: await withMemberAvatars(fresh.members,fresh),
            status: fresh.status,
            leaderMemberId: leader ? publicMemberId(fresh, leader) : undefined,
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
    if (res.headersSent) return res;
    if (error.status === 409) {
      return res.status(409).json({ok:false,error:{code:error.code,message:error.message}});
    }
    console.error("Error joining random squad:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to join a random squad" },
    });
  }
};

module.exports = {
  getSquadCapacity,
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
