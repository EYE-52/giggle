const { getRequesterIdentity, getSquadAccessContext } = require("../app/squadAccess");

const attachSquadAccess = ({ requireLeader = false } = {}) => {
  return async (req, res, next) => {
    const identity = getRequesterIdentity(req);

    if (!identity.userId) {
      return res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    try {
      const context = await getSquadAccessContext({
        squadId: req.params.squadId,
        identity,
      });

      if (context.error) {
        return res.status(context.error.status).json({ ok: false, error: context.error });
      }

      if (requireLeader && !context.isLeader) {
        return res.status(403).json({
          ok: false,
          error: { code: "LEADER_ONLY", message: "Only squad leader can perform this action" },
        });
      }

      req.giggleIdentity = identity;
      req.squadAccess = context;
      next();
    } catch (error) {
      console.error("Error loading squad access:", error);
      return res.status(500).json({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Failed to load squad access" },
      });
     }
   };
 };
 
 const requireSquadMemberAccess = attachSquadAccess();
 const requireSquadLeaderAccess = attachSquadAccess({ requireLeader: true });
 
 module.exports = {
   requireSquadMemberAccess,
   requireSquadLeaderAccess,
 };
