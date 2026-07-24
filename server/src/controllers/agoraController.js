const { createLobbyRtcToken } = require("../services/agoraTokenService");

const getLobbyTokenHandler = async (req, res) => {
  try {
    const { squad, member } = req.squadAccess;

    const tokenPayload = createLobbyRtcToken({
      squadId: squad.squadId,
      userId: member.userId,
    });

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        memberId: member.memberId,
        ...tokenPayload,
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
