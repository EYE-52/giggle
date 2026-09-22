// Temporary declaration access is evaluated on every request. Never persist it as
// provider verification, so disabling the flag restores the Yoti requirement.
function isAgeCheckSatisfied(user, env = process.env) {
  return Boolean(user?.ageConfirmed === true && user?.isAdult === true &&
    (user?.ageVerified === true || env?.SELF_DECLARED_AGE_ACCESS === "true"));
}

function hasAdultAccess(user, env = process.env) {
  const developmentBypass =
    env?.NODE_ENV === "development" && env?.AGE_VERIFICATION_BYPASS === "true";

  return Boolean(
    user?.ageConfirmed === true &&
      user?.isAdult === true &&
      (isAgeCheckSatisfied(user, env) || developmentBypass) &&
      user?.isSuspended !== true &&
      user?.isShadowBanned !== true &&
      user?.deletionStatus !== "pending"
  );
}

async function allUsersHaveAdultAccess(userIds, { User, env = process.env }) {
  if (!Array.isArray(userIds) || userIds.length === 0 || typeof User?.find !== "function") {
    return false;
  }

  if (userIds.some((id) => !id)) return false;
  const ids = [...new Set(userIds.map(String))];

  const users = await User.find({ _id: { $in: ids } }).select(
    "ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus"
  );
  const eligibleIds = new Set(
    users.filter((user) => hasAdultAccess(user, env)).map((user) => String(user._id))
  );

  return ids.every((id) => eligibleIds.has(id));
}

module.exports = { allUsersHaveAdultAccess, hasAdultAccess, isAgeCheckSatisfied };
