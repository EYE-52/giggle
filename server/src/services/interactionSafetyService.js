const canonicalUserId = (value) => {
  if (!value) return "";
  const raw = typeof value === "string"
    ? value
    : typeof value.toString === "function"
      ? value.toString()
      : "";
  return /^[a-f\d]{24}$/i.test(raw) ? raw.toLowerCase() : "";
};

const relationalIdMatcher = (value) => {
  const canonical = canonicalUserId(value);
  return canonical ? new RegExp(`^${canonical}$`, "i") : null;
};

const includesId = (values, id) =>
  Array.isArray(values) && values.some((value) => canonicalUserId(value) === id);

const hasBlockedPair = (userA, userB) => {
  const userAId = canonicalUserId(userA?._id);
  const userBId = canonicalUserId(userB?._id);
  if (!userAId || !userBId) return true;
  return includesId(userA.blockedUserIds, userBId) || includesId(userB.blockedUserIds, userAId);
};

const loadBlockState = async (userIds, { User, session } = {}) => {
  const ids = [...new Set((userIds || []).map(canonicalUserId).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find(
    { _id: { $in: ids } },
    "_id blockedUserIds",
    session ? { session } : undefined
  ).lean();
  return new Map(users.map((user) => [canonicalUserId(user._id), user]));
};

const anyBlockedPairInState = (userIds, state) => {
  if (!Array.isArray(userIds) || !(state instanceof Map)) return true;
  if (!userIds.length) return false;
  const normalizedIds = userIds.map(canonicalUserId);
  if (normalizedIds.some((id) => !id)) return true;
  const ids = [...new Set(normalizedIds)];
  if (ids.some((id) => !state.has(id))) return true;
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      if (hasBlockedPair(state.get(ids[left]), state.get(ids[right]))) return true;
    }
  }
  return false;
};

const anyBlockedPair = async (userIds, dependencies) => {
  if (!Array.isArray(userIds)) return true;
  if (!userIds.length) return false;
  const normalizedIds = userIds.map(canonicalUserId);
  if (normalizedIds.some((id) => !id)) return true;
  const ids = [...new Set(normalizedIds)];
  try {
    const state = await loadBlockState(ids, dependencies);
    return anyBlockedPairInState(ids, state);
  } catch {
    return true;
  }
};

const filterBlockedCandidates = async (viewerId, candidateIds, dependencies) => {
  const viewer = canonicalUserId(viewerId);
  const candidates = [...new Set((candidateIds || []).map(canonicalUserId).filter(Boolean))];
  if (!viewer || !candidates.length) return [];
  try {
    const state = await loadBlockState([viewer, ...candidates], dependencies);
    const viewerState = state.get(viewer);
    if (!viewerState) return [];
    return candidates.filter((candidateId) => {
      const candidate = state.get(candidateId);
      return candidate && !hasBlockedPair(viewerState, candidate);
    });
  } catch {
    return [];
  }
};

module.exports = {
  canonicalUserId,
  relationalIdMatcher,
  hasBlockedPair,
  loadBlockState,
  anyBlockedPairInState,
  anyBlockedPair,
  filterBlockedCandidates,
};
