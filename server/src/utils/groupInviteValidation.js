const crypto = require("node:crypto");

// Compare the proof only against the current record while its admission lock
// is held. A boolean from an earlier room preview must never authorize a join.
function validGroupInvite(squad, value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value) &&
    typeof squad.groupInvite === "string" &&
    /^[a-f0-9]{64}$/.test(squad.groupInvite) &&
    crypto.timingSafeEqual(Buffer.from(value), Buffer.from(squad.groupInvite))
  );
}
module.exports = { validGroupInvite };
