const { canonicalUserId } = require("../services/interactionSafetyService");

// Illustrated avatars a user may pick for their public profile. Must match the
// ids in DEFAULT_AVATARS (packages/core/src/avatars.ts); test/avatars.test.js
// fails if the two lists drift. Google profile photos (`image`) are never
// shown to other users — this id is the only avatar other people see.
const AVATAR_IDS = Object.freeze([
  "violet-blob",
  "teal-bot",
  "coral-star",
  "lime-ghost",
  "orange-cat",
  "blue-bolt",
  "gold-moon",
  "pink-diamond",
  "cyan-bot",
  "indigo-blob",
  "red-ghost",
  "green-star",
  "yellow-cat",
  "navy-moon",
  "rose-diamond",
  "mint-bolt",
]);

const AVATAR_ID_SET = new Set(AVATAR_IDS);

// The first 8 are free; the rest are the premium "vibe_pack" (FREE_AVATAR_COUNT
// in packages/core). Vibe Pack redemption is a local preview only, so
// production accepts free avatars until server-side entitlements exist.
const FREE_AVATAR_COUNT = 8;
const FREE_AVATAR_ID_SET = new Set(AVATAR_IDS.slice(0, FREE_AVATAR_COUNT));

const isAvatarId = (value) => typeof value === "string" && AVATAR_ID_SET.has(value);

const isSelectableAvatarId = (value, { production = process.env.NODE_ENV === "production" } = {}) =>
  isAvatarId(value) && (!production || FREE_AVATAR_ID_SET.has(value));

/** Client-facing avatar: a known id, or null (never echoes unknown stored values). */
const publicAvatar = (value) => (isAvatarId(value) ? value : null);

/**
 * One batched avatar lookup for a set of user ids. Returns a Map of
 * canonical userId -> avatar id (or null). Fails soft: on any lookup error the
 * map is empty, so callers render `avatar: null` instead of failing the request.
 */
const loadAvatarsByUserId = async (userIds, { User } = {}) => {
  const avatars = new Map();
  const ids = [...new Set((userIds || []).map(canonicalUserId).filter(Boolean))];
  if (!ids.length || !User) return avatars;
  try {
    const users = await User.find({ _id: { $in: ids } }, "avatar").lean();
    for (const user of users || []) {
      avatars.set(canonicalUserId(user._id), publicAvatar(user.avatar));
    }
  } catch (error) {
    console.warn("loadAvatarsByUserId failed:", error.message);
    avatars.clear();
  }
  return avatars;
};

module.exports = { AVATAR_IDS, FREE_AVATAR_COUNT, isAvatarId, isSelectableAvatarId, publicAvatar, loadAvatarsByUserId };
