const {hasAdultAccess}=require("../services/ageAccessService");
const { publicMemberId } = require("../services/groupIdentityService");
const {createLobbyRtcToken,lobbyRtcUid} = require("../services/agoraTokenService");
const User = require("../models/User");
const { anyBlockedPair } = require("../services/interactionSafetyService");

const getLobbyTokenHandler = async (req, res) => {
  try {
    const { squad, member } = req.squadAccess;
    if (await anyBlockedPair(squad.members.map((candidate) => candidate.userId), { User })) {
      return res.status(403).json({
        ok: false,
        error: { code: "INTERACTION_BLOCKED", message: "This lobby is unavailable" },
      });
    }

    if (squad.communicationMode === "chat") return res.status(403).json({ok:false,error:{code:"CHAT_ONLY",message:"This group uses text chat. Devices stay off."}});
    const strict=squad.managedGroup || squad.identityMode === "aliases";
    const accounts = strict ? await User.find({_id:{$in:squad.members.map(member=>member.userId)}}).select("_id ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus").lean() : [];
    const validIds = new Set(accounts.filter(user => hasAdultAccess(user)).map(user=>String(user._id)));
    const tokenPayload = createLobbyRtcToken({
      squadId: squad.squadId,
      userId: member.userId,
      identityMode:squad.identityMode,
      communicationMode:squad.communicationMode,
      ...((squad.managedGroup || squad.identityMode === "aliases" || squad.visibility === "open" || squad.communicationMode === "voice") ? {expiresIn:90} : {}),
    });

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        memberId: publicMemberId(squad,member),
        ...tokenPayload,
        allowedRemoteUids:squad.members.filter(candidate=>String(candidate.userId)!==String(member.userId) && (!strict || validIds.has(String(candidate.userId))) && !(squad.bannedMembers||[]).some(banned=>String(banned.userId)===String(candidate.userId))).map(candidate=>lobbyRtcUid({squadId:squad.squadId,userId:candidate.userId,identityMode:squad.identityMode})),
      },
    });
  } catch (error) {
    if (error.message === "AGORA_NOT_CONFIGURED") {
      return res.status(500).json({
        ok: false,
        error: {
          code: "AGORA_NOT_CONFIGURED",
          message: "Agora server credentials are missing",
        },
      });
    }

    console.error("Error generating Agora lobby token:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to generate Agora lobby token" },
    });
  }
};

module.exports = {
  getLobbyTokenHandler,
};
