const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const {
  AGORA_APP_ID,
  AGORA_APP_CERTIFICATE,
  AGORA_TOKEN_EXPIRY_SECONDS,
} = require("../config/agoraConfig");
const { AccessToken, priviledges } = require("agora-access-token/src/AccessToken");
const { encounterRtcUid } = require("./encounterIdentityService");

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

const lobbyRtcUid = ({squadId,userId,identityMode}) => identityMode === "aliases"
  ? encounterRtcUid(`group:${squadId}`,userId) : hashStringToUid(`${squadId}:${userId}`);

const createLobbyRtcToken = ({ squadId, userId, identityMode, communicationMode = "video", expiresIn = AGORA_TOKEN_EXPIRY_SECONDS }) => {
  if (!isAgoraConfigured()) {
    throw new Error("AGORA_NOT_CONFIGURED");
  }

  const channelName = buildLobbyChannelName(squadId);
  const uid = lobbyRtcUid({squadId,userId,identityMode});
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTimestamp + expiresIn;

  let rtcToken;
  if (communicationMode === "voice") {
    const token = new AccessToken(AGORA_APP_ID, AGORA_APP_CERTIFICATE, channelName, uid);
    token.addPriviledge(priviledges.kJoinChannel, privilegeExpireTs);
    token.addPriviledge(priviledges.kPublishAudioStream, privilegeExpireTs);
    rtcToken = token.build();
  } else {
    rtcToken = RtcTokenBuilder.buildTokenWithUid(AGORA_APP_ID, AGORA_APP_CERTIFICATE, channelName, uid, RtcRole.PUBLISHER, privilegeExpireTs);
  }

  return {
    appId: AGORA_APP_ID,
    channelName,
    rtcToken,
    uid,
    ...(communicationMode === "voice" ? {audioOnly:true} : {}),
    expiresIn,
    expiresAt: new Date(privilegeExpireTs * 1000).toISOString(),
  };
};

const createEncounterRtcToken = ({ encounterId, userId, expiresIn = AGORA_TOKEN_EXPIRY_SECONDS }) => {
  if (!isAgoraConfigured()) {
    throw new Error("AGORA_NOT_CONFIGURED");
  }

  const channelName = buildEncounterChannelName(encounterId);
  // Keyed with a server secret: the other squad sees this uid and must not be
  // able to test a known account id against it (anonymous members).
  const uid = encounterRtcUid(encounterId, userId);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTimestamp + expiresIn;

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
    expiresIn,
    expiresAt: new Date(privilegeExpireTs * 1000).toISOString(),
  };
};

module.exports = {
  isAgoraConfigured,
  hashStringToUid,
  lobbyRtcUid,
  buildLobbyChannelName,
  buildEncounterChannelName,
  createLobbyRtcToken,
  createEncounterRtcToken,
};
