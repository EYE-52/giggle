const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Free squads cap at 4 members. A squad whose leader has Giggle+ can hold up to
// 8. MAX_SQUAD_MEMBERS is the global hard cap (never allow more than this).
const FREE_MAX_MEMBERS = toPositiveInt(process.env.FREE_MAX_MEMBERS, 4);
const PREMIUM_MAX_MEMBERS = toPositiveInt(process.env.PREMIUM_MAX_MEMBERS, 8);
const MAX_SQUAD_MEMBERS = toPositiveInt(process.env.MAX_SQUAD_MEMBERS, PREMIUM_MAX_MEMBERS);
const MIN_MEMBERS_TO_SEARCH = toPositiveInt(process.env.MIN_MEMBERS_TO_SEARCH, 1);
const ENABLE_REQUEST_LOGS = process.env.ENABLE_REQUEST_LOGS !== "false";
const LOG_REQUEST_BODY = process.env.LOG_REQUEST_BODY === "true";
const isStrangerDiscoveryEnabled = (env = process.env) =>
  env.STRANGER_DISCOVERY_ENABLED === "true" ||
  (env.STRANGER_DISCOVERY_ENABLED !== "false" && env.NODE_ENV !== "production");

module.exports = {
  FREE_MAX_MEMBERS,
  PREMIUM_MAX_MEMBERS,
  MAX_SQUAD_MEMBERS,
  MIN_MEMBERS_TO_SEARCH,
  ENABLE_REQUEST_LOGS,
  LOG_REQUEST_BODY,
  isStrangerDiscoveryEnabled,
};
