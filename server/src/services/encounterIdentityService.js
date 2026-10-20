// Encounter identity: how a person appears to people OUTSIDE their own squad.
//
// A member can turn on "stay anonymous with other squads" and pick an alias.
// Their own squad still sees their real squad name and avatar. Everyone else
// (the opponent squad in an encounter, strangers previewing the squad) sees
// only the alias, no avatar, and an opaque id that is different in every
// encounter. Every server path that shows a person to another squad goes
// through publicEncounterIdentity so the rule lives in one place.
//
// Opaque ids are HMACs over (scope, userId) with a server secret: stable within
// one encounter (so call tiles, chat and reactions line up), unlinkable across
// encounters, and never reversible on the client. The server maps them back
// (resolveEncounterOpaqueIds) only for members of that encounter.
const crypto = require("crypto");
const { canonicalUserId } = require("./interactionSafetyService");
const { publicAvatar } = require("../utils/avatars");
const { firstDisplayName } = require("../utils/identityValidation");
const { classifyVibe } = require("../utils/moderation");

const OPAQUE_ID_PREFIX = "anon_";
const OPAQUE_ID_PATTERN = /^anon_[a-f0-9]{24}$/;
const ENCOUNTER_ALIAS_MIN_LENGTH = 2;
const ENCOUNTER_ALIAS_MAX_LENGTH = 24;
// Letters and numbers (any script), with inner spaces, dots, dashes,
// underscores and apostrophes. Must start and end with a letter or number.
const ENCOUNTER_ALIAS_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._'-]*[\p{L}\p{N}])?$/u;
const IDENTITY_USER_FIELDS = "_id avatar anonymousInEncounters encounterAlias";

const identitySecret = (env = process.env) =>
  env.ENCOUNTER_IDENTITY_SECRET || env.JWT_SECRET || "dev-encounter-identity-secret";

const digest = (label, ...parts) =>
  crypto.createHmac("sha256", identitySecret()).update([label, ...parts.map(String)].join("\n")).digest();

const normalizedUserKey = (userId) => canonicalUserId(userId) || String(userId || "");

/** Opaque, per-scope id for a person (scope is usually the encounter id). */
const opaqueEncounterId = (scope, userId) =>
  `${OPAQUE_ID_PREFIX}${digest("encounter-member", scope, normalizedUserKey(userId)).toString("hex").slice(0, 24)}`;

const isOpaqueEncounterId = (value) => typeof value === "string" && OPAQUE_ID_PATTERN.test(value);

/**
 * Agora uid for an encounter call. Keyed with the server secret so the other
 * squad cannot test a known account id against the uid they see.
 */
const encounterRtcUid = (encounterId, userId) => {
  const value = digest("encounter-rtc", encounterId, normalizedUserKey(userId)).readUInt32BE(0);
  return value === 0 ? 1 : value;
};

/** "Guest 4821": the stable alias used when anonymity is on but no alias is set. */
const fallbackEncounterAlias = (userId) =>
  `Guest ${1000 + (digest("encounter-alias", normalizedUserKey(userId)).readUInt32BE(0) % 9000)}`;

/**
 * Validate a user-chosen alias. Returns { value } ("" clears it) or { error }.
 */
const normalizeEncounterAlias = (raw) => {
  if (raw === null) return { value: "" };
  if (typeof raw !== "string") return { error: "encounterAlias must be a string" };
  const value = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!value) return { value: "" };
  if (value.length < ENCOUNTER_ALIAS_MIN_LENGTH || value.length > ENCOUNTER_ALIAS_MAX_LENGTH) {
    return { error: `encounterAlias must be ${ENCOUNTER_ALIAS_MIN_LENGTH} to ${ENCOUNTER_ALIAS_MAX_LENGTH} characters` };
  }
  if (!ENCOUNTER_ALIAS_PATTERN.test(value)) {
    return { error: "encounterAlias can use letters, numbers, spaces and . _ ' -" };
  }
  if (classifyVibe(value) !== "ok") return { error: "That name isn't allowed" };
  return { value };
};

/** The user's anonymity choice, with the alias they appear under. */
const encounterAnonymity = (user, userId) => {
  if (user?.anonymousInEncounters !== true) return { anonymous: false, alias: null };
  const stored = normalizeEncounterAlias(user.encounterAlias ?? "");
  return { anonymous: true, alias: stored.value || fallbackEncounterAlias(userId ?? user._id) };
};

/**
 * How `member` (of squad `memberSquadId`) appears to someone in `viewerSquadId`.
 * `scope` is the encounter id (or another opaque scope, e.g. a squad preview).
 *
 * - Own-squad viewers get the real identity, plus whether the member is
 *   anonymous to others and under which alias.
 * - Other viewers get the real identity only when the member is not anonymous.
 *   Anonymous members come back as alias + no avatar + opaque ids. A member
 *   whose user record could not be loaded is treated as anonymous (fail closed).
 */
const publicEncounterIdentity = ({ viewerSquadId, memberSquadId, member, user, encounterId, scope } = {}) => {
  const idScope = scope || encounterId;
  const userId = String(member?.userId || "");
  const callId = opaqueEncounterId(idScope, userId);
  const role = member?.role === "leader" ? "leader" : "member";
  const sameSquad = Boolean(viewerSquadId) && viewerSquadId === memberSquadId;
  const { anonymous, alias } = user
    ? encounterAnonymity(user, userId)
    : { anonymous: !sameSquad, alias: fallbackEncounterAlias(userId) };
  const rtc = encounterId ? { uid: encounterRtcUid(encounterId, userId) } : {};
  const real = {
    memberId: member?.memberId,
    userId,
    displayName: firstDisplayName(member?.displayName),
    role,
    avatar: publicAvatar(user?.avatar),
    callId,
    ...rtc,
  };
  if (sameSquad) return { ...real, anonymous, ...(anonymous ? { alias } : {}) };
  if (!anonymous) return { ...real, anonymous: false };
  return {
    memberId: callId,
    userId: callId,
    displayName: alias,
    role,
    avatar: null,
    callId,
    ...rtc,
    anonymous: true,
  };
};

/**
 * One batched lookup of the fields publicEncounterIdentity needs. Throws on
 * failure: callers must not fall back to showing real identities.
 */
const loadEncounterIdentityUsers = async (userIds, { User }) => {
  const ids = [...new Set((userIds || []).map(canonicalUserId).filter(Boolean))];
  const users = new Map();
  if (!ids.length) return users;
  const rows = await User.find({ _id: { $in: ids } }, IDENTITY_USER_FIELDS).lean();
  for (const row of rows || []) {
    const id = canonicalUserId(row?._id);
    if (id) users.set(id, row);
  }
  return users;
};

const identityUserFor = (users, userId) => users.get(canonicalUserId(userId));

/** Members of both squads as seen from `viewerSquadId`. */
const projectEncounterRosters = ({ encounter, squadA, squadB, viewerSquadId, users }) => {
  const project = (squad) => (squad?.members || []).map((member) => publicEncounterIdentity({
    viewerSquadId,
    memberSquadId: squad.squadId,
    member,
    user: identityUserFor(users, member.userId),
    encounterId: encounter.encounterId,
  }));
  return { squadAMembers: project(squadA), squadBMembers: project(squadB) };
};

/**
 * Map ids a client sent for opponents back to real account ids. Real ids pass
 * through; opaque ids resolve only against the OTHER squad of an encounter the
 * requester belongs to. Returns { error } or { userIds, anonymousTargets }.
 */
const resolveEncounterOpaqueIds = async ({ ids, encounterId, requesterId, Encounter, Squad, User }) => {
  const opaque = ids.filter(isOpaqueEncounterId);
  if (!opaque.length) return { userIds: ids.map(canonicalUserId), anonymousTargets: [] };
  if (typeof encounterId !== "string" || !encounterId) return { error: "ENCOUNTER_REQUIRED" };

  const encounter = await Encounter.findOne({ encounterId });
  if (!encounter) return { error: "NOT_FOUND" };
  const [squadA, squadB] = await Promise.all([
    Squad.findOne({ squadId: encounter.squadAId }),
    Squad.findOne({ squadId: encounter.squadBId }),
  ]);
  const requester = canonicalUserId(requesterId);
  const isIn = (squad) => (squad?.members || []).some((member) => canonicalUserId(member.userId) === requester);
  const ownSquad = isIn(squadA) ? squadA : isIn(squadB) ? squadB : null;
  if (!ownSquad) return { error: "NOT_FOUND" };
  const otherSquad = ownSquad === squadA ? squadB : squadA;

  const byOpaqueId = new Map();
  for (const member of otherSquad?.members || []) {
    const userId = canonicalUserId(member.userId);
    if (userId) byOpaqueId.set(opaqueEncounterId(encounter.encounterId, userId), userId);
  }
  const resolved = ids.map((id) => (isOpaqueEncounterId(id) ? byOpaqueId.get(id) : canonicalUserId(id)));
  if (resolved.some((id) => !id)) return { error: "NOT_FOUND" };

  const users = await loadEncounterIdentityUsers(resolved, { User });
  const anonymousTargets = [];
  ids.forEach((id, index) => {
    if (!isOpaqueEncounterId(id)) return;
    const userId = resolved[index];
    const { anonymous, alias } = encounterAnonymity(identityUserFor(users, userId), userId);
    if (anonymous) anonymousTargets.push({ userId, handle: id, alias });
  });
  return { userIds: resolved, anonymousTargets };
};

module.exports = {
  OPAQUE_ID_PREFIX,
  ENCOUNTER_ALIAS_MIN_LENGTH,
  ENCOUNTER_ALIAS_MAX_LENGTH,
  IDENTITY_USER_FIELDS,
  opaqueEncounterId,
  isOpaqueEncounterId,
  encounterRtcUid,
  fallbackEncounterAlias,
  normalizeEncounterAlias,
  encounterAnonymity,
  publicEncounterIdentity,
  loadEncounterIdentityUsers,
  identityUserFor,
  projectEncounterRosters,
  resolveEncounterOpaqueIds,
};
