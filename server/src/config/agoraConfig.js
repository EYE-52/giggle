const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const AGORA_APP_ID = process.env.AGORA_APP_ID || "";
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || "";
const AGORA_TOKEN_EXPIRY_SECONDS = toPositiveInt(process.env.AGORA_TOKEN_EXPIRY_SECONDS, 3600);

module.exports = {
  AGORA_APP_ID,
  AGORA_APP_CERTIFICATE,
  AGORA_TOKEN_EXPIRY_SECONDS,
};
