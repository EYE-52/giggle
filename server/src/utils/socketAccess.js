const MAX_REALTIME_ID_LENGTH = 96;
const REALTIME_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function normalizeRealtimeId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_REALTIME_ID_LENGTH) return "";
  if (!REALTIME_ID_PATTERN.test(normalized)) return "";
  return normalized;
}

async function authorizeSquadRoomJoin({ squadId, userId, isProduction, Squad }) {
  const normalizedSquadId = normalizeRealtimeId(squadId);
  if (!normalizedSquadId) return { allowed: false };

  const room = `squad_${normalizedSquadId}`;
  if (!userId) return { allowed: !isProduction, room };

  const squad = await Squad.findOne({
    squadId: normalizedSquadId,
    "members.userId": String(userId),
  });

  return squad ? { allowed: true, room } : { allowed: false };
}

async function authorizeEncounterRoomJoin({ encounterId, userId, isProduction, Squad, Encounter }) {
  const normalizedEncounterId = normalizeRealtimeId(encounterId);
  if (!normalizedEncounterId) return { allowed: false };

  const room = `encounter_${normalizedEncounterId}`;
  if (!userId) return { allowed: !isProduction, room };

  const encounter = await Encounter.findOne({ encounterId: normalizedEncounterId });
  if (!encounter || encounter.status === "ended") return { allowed: false };

  const squad = await Squad.findOne({
    squadId: { $in: [encounter.squadAId, encounter.squadBId] },
    "members.userId": String(userId),
  });

  return squad ? { allowed: true, room } : { allowed: false };
}

function resolveReportTargetSquadId(payload = {}) {
  return normalizeRealtimeId(payload.reportedSquadId || payload.targetSquadId || payload.squadId);
}

async function authorizeSquadReport({ payload = {}, userId, Squad, Encounter }) {
  if (!userId) return { allowed: false };

  const encounterId = normalizeRealtimeId(payload.encounterId);
  const reporterSquadId = normalizeRealtimeId(payload.squadId);
  const targetSquadId = resolveReportTargetSquadId(payload);
  if (!encounterId || !reporterSquadId || !targetSquadId) return { allowed: false };
  if (reporterSquadId === targetSquadId) return { allowed: false };

  const encounter = await Encounter.findOne({ encounterId });
  if (!encounter || encounter.status === "ended") return { allowed: false };

  const encounterSquads = [encounter.squadAId, encounter.squadBId];
  if (!encounterSquads.includes(reporterSquadId) || !encounterSquads.includes(targetSquadId)) {
    return { allowed: false };
  }

  const reporterSquad = await Squad.findOne({
    squadId: reporterSquadId,
    "members.userId": String(userId),
  });

  return reporterSquad ? { allowed: true, targetSquadId } : { allowed: false };
}

module.exports = {
  authorizeEncounterRoomJoin,
  authorizeSquadReport,
  authorizeSquadRoomJoin,
  normalizeRealtimeId,
  resolveReportTargetSquadId,
};
