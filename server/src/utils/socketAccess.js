const MAX_REALTIME_ID_LENGTH = 96;
const REALTIME_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const { anyBlockedPair } = require("../services/interactionSafetyService");

function normalizeRealtimeId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_REALTIME_ID_LENGTH) return "";
  if (!REALTIME_ID_PATTERN.test(normalized)) return "";
  return normalized;
}

async function authorizeSquadRoomJoin({ squadId, userId, isProduction, Squad, User }) {
  const normalizedSquadId = normalizeRealtimeId(squadId);
  if (!normalizedSquadId) return { allowed: false };

  const room = `squad_${normalizedSquadId}`;
  if (!userId) return { allowed: !isProduction, room };

  const squad = await Squad.findOne({
    squadId: normalizedSquadId,
    "members.userId": String(userId),
  });

  if (!squad) return { allowed: false };
  const blocked = await anyBlockedPair(squad.members.map((member) => member.userId), { User });
  return blocked ? { allowed: false } : { allowed: true, room };
}

async function authorizeEncounterRoomJoin({ encounterId, userId, isProduction, Squad, Encounter, User }) {
  const normalizedEncounterId = normalizeRealtimeId(encounterId);
  if (!normalizedEncounterId) return { allowed: false };

  const room = `encounter_${normalizedEncounterId}`;
  if (!userId) return { allowed: !isProduction, room };

  const encounter = await Encounter.findOne({ encounterId: normalizedEncounterId });
  if (!encounter || encounter.status === "ended") return { allowed: false };

  const [squadA, squadB] = await Promise.all([
    Squad.findOne({ squadId: encounter.squadAId }),
    Squad.findOne({ squadId: encounter.squadBId }),
  ]);
  if (!squadA || !squadB) return { allowed: false };

  const squads = [squadA, squadB];
  const ownSquad = squads.find((squad) =>
    squad.members.some((member) => String(member.userId) === String(userId))
  );
  if (!ownSquad) return { allowed: false };
  const blocked = await anyBlockedPair(
    squads.flatMap((squad) => squad.members.map((member) => member.userId)),
    { User }
  );
  if (blocked) return { allowed: false };
  // Besides the shared room, each socket joins its own squad's side of the
  // call so per-squad projections (anonymous senders) reach only that squad.
  return {
    allowed: true,
    room,
    sideRoom: encounterSideRoom(normalizedEncounterId, ownSquad.squadId),
    encounter,
    squadA,
    squadB,
    ownSquadId: ownSquad.squadId,
  };
}

function encounterSideRoom(encounterId, squadId) {
  return `encounter_${encounterId}:squad_${squadId}`;
}

const authorizeRealtimeSend = ({ encounterId, squadId, ...dependencies }) =>
  encounterId
    ? authorizeEncounterRoomJoin({ encounterId, ...dependencies })
    : authorizeSquadRoomJoin({ squadId, ...dependencies });

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
  encounterSideRoom,
  authorizeRealtimeSend,
  authorizeSquadReport,
  authorizeSquadRoomJoin,
  normalizeRealtimeId,
  resolveReportTargetSquadId,
};
