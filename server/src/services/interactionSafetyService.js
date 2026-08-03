const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return typeof value.toString === "function" ? value.toString() : "";
};

const includesId = (values, id) =>
  Array.isArray(values) && values.some((value) => toIdString(value) === id);

const hasBlockedPair = (userA, userB) => {
  const userAId = toIdString(userA?._id);
  const userBId = toIdString(userB?._id);
  if (!userAId || !userBId) return true;
  return includesId(userA.blockedUserIds, userBId) || includesId(userB.blockedUserIds, userAId);
};

const loadBlockState = async (userIds, { User }) => {
  const ids = [...new Set((userIds || []).map(toIdString).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }, "_id blockedUserIds").lean();
  return new Map(users.map((user) => [toIdString(user._id), user]));
};

const anyBlockedPair = async (userIds, dependencies) => {
  const ids = [...new Set((userIds || []).map(toIdString).filter(Boolean))];
  try {
    const state = await loadBlockState(ids, dependencies);
    if (state.size !== ids.length) return true;
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        if (hasBlockedPair(state.get(ids[left]), state.get(ids[right]))) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
};

const filterBlockedCandidates = async (viewerId, candidateIds, dependencies) => {
  const viewer = toIdString(viewerId);
  const candidates = [...new Set((candidateIds || []).map(toIdString).filter(Boolean))];
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
  hasBlockedPair,
  loadBlockState,
  anyBlockedPair,
  filterBlockedCandidates,
};
