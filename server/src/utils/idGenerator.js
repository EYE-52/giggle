const crypto = require("crypto");
const { randomBase36 } = require("./random");

const generateId = (prefix) => {
  const timestamp = Date.now();
  const randomSuffix = randomBase36(10);
  return `${prefix}_${timestamp}_${randomSuffix}`;
};

const generateSquadCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "23456789";
  let result = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 3; i++) {
    result += chars.charAt(bytes[i] % chars.length);
  }
  result += "-";
  for (let i = 0; i < 3; i++) {
    result += digits.charAt(bytes[i + 3] % digits.length);
  }
  return result;
};

module.exports = { generateId, generateSquadCode };
