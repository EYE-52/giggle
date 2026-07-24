const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const {
  AGORA_APP_ID,
  AGORA_APP_CERTIFICATE,
  AGORA_TOKEN_EXPIRY_SECONDS,
} = require("../config/agoraConfig");

const isAgoraConfigured = () => {
  return Boolean(AGORA_APP_ID && AGORA_APP_CERTIFICATE);
};

const hashStringToUid = (input) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }

  const unsigned = hash >>> 0;
  return unsigned === 0 ? 1 : unsigned;
};

const buildLobbyChannelName = (squadId) => `lobby_${squadId}`;
const buildEncounterChannelName = (encounterId) => `encounter_${encounterId}`;

const createLobbyRtcToken = ({ squadId, userId }) => {
  if (!isAgoraConfigured()) {
    throw new Error("AGORA_NOT_CONFIGURED");
  }

  const channelName = buildLobbyChannelName(squadId);
  const uid = hashStringToUid(`${squadId}:${userId}`);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTimestamp + AGORA_TOKEN_EXPIRY_SECONDS;

  const rtcToken = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpireTs
  );

  return {
    appId: AGORA_APP_ID,
    channelName,
    rtcToken,
    uid,
    expiresIn: AGORA_TOKEN_EXPIRY_SECONDS,
    expiresAt: new Date(privilegeExpireTs * 1000).toISOString(),
  };
};

const createEncounterRtcToken = ({ encounterId, userId }) => {
  if (!isAgoraConfigured()) {
    throw new Error("AGORA_NOT_CONFIGURED");
  }

  const channelName = buildEncounterChannelName(encounterId);
  const uid = hashStringToUid(`${encounterId}:${userId}`);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTimestamp + AGORA_TOKEN_EXPIRY_SECONDS;

  const rtcToken = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    privilegeExpireTs
  );

  return {
    appId: AGORA_APP_ID,
    channelName,
    rtcToken,
    uid,
    expiresIn: AGORA_TOKEN_EXPIRY_SECONDS,
    expiresAt: new Date(privilegeExpireTs * 1000).toISOString(),
  };
};

module.exports = {
  isAgoraConfigured,
  hashStringToUid,
  buildLobbyChannelName,
  buildEncounterChannelName,
  createLobbyRtcToken,
  createEncounterRtcToken,
};
