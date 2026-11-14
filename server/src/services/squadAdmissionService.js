const { redlock } = require("../config/redisConfig");

function admissionConflict(cause) {
  return Object.assign(
    new Error("This group changed. Refresh it and try again."),
    {
      status: 409,
      code: "GROUP_CHANGED",
      cause,
    },
  );
}
function assertAdmission(signal) {
  if (signal?.aborted) {
    throw admissionConflict(signal.error);
  }
}
async function withSquadAdmissionLock(squadId, work) {
  let activeSignal;
  try {
    return await redlock.using(
      [`lock:squad:${squadId}:admission`],
      10_000,
      async (signal) => {
        activeSignal = signal;
        assertAdmission(signal);
        const result = await work(signal);
        assertAdmission(signal);
        return result;
      },
    );
  } catch (error) {
    if (error.name === "VersionError" || activeSignal?.aborted) {
      throw admissionConflict(error);
    }
    throw error;
  }
}

const guardedDocuments = new WeakSet();
const isAdmissionGuarded = (squad) => guardedDocuments.has(squad);
// Auto-extension covers slow healthy requests. The version condition also
// rejects a delayed database write after a newer owner has changed the group.
// This is local to these admission documents, not a change to all Squad saves.
function guardSquadWrites(squad, signal) {
  if (!squad) {
    return squad;
  }
  guardedDocuments.add(squad);
  const save = squad.save.bind(squad);
  const versionKey = squad.schema?.options.versionKey;
  const versionFilter = () => {
    const version = squad.get(versionKey);
    return { [versionKey]: version == null ? { $exists: false } : version };
  };
  if (typeof squad.deleteOne === "function" && versionKey) {
    const remove = squad.deleteOne.bind(squad);
    squad.deleteOne = async (...args) => {
      assertAdmission(signal);
      squad.$where = { ...squad.$where, ...versionFilter() };
      const result = await remove(...args);
      if (result.deletedCount !== 1) {
        throw admissionConflict();
      }
      assertAdmission(signal);
      return result;
    };
  }
  squad.save = async (...args) => {
    assertAdmission(signal);
    if (typeof squad.increment === "function") {
      squad.$where = { ...squad.$where, ...versionFilter() };
      squad.increment();
    }
    try {
      const result = await save(...args);
      assertAdmission(signal);
      return result;
    } catch (error) {
      if (error.name === "VersionError" || signal?.aborted) {
        throw admissionConflict(error);
      }
      throw error;
    }
  };
  return squad;
}
module.exports = {
  withSquadAdmissionLock,
  guardSquadWrites,
  assertAdmission,
  admissionConflict,
  isAdmissionGuarded,
};
