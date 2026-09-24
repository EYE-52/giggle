// Shared, dependency-free character contract. Kept inside the server bundle so
// standalone Railway deploys and browser clients validate the same catalog.
const CHARACTER_PREFIX = "giggle:v1:";
const CHARACTER_OPTIONS = Object.freeze({
  hair: ["curls", "crop", "bob", "swoop", "buzz", "bald", "long", "bun"],
  face: ["soft", "round", "angular"],
  glasses: ["none", "round", "square"],
  facialHair: ["none", "stubble", "beard", "mustache"],
  expression: ["smile", "laugh", "wink", "surprised"],
  clothing: ["tee", "hoodie", "sweater", "jacket", "collared"],
  headwear: ["none", "beanie", "cap"],
  earrings: ["none", "studs", "hoops"],
});
const CHARACTER_DEFAULTS = Object.freeze({
  hair: "curls", face: "soft", glasses: "none", facialHair: "none", expression: "smile",
  clothing: "tee", headwear: "none", earrings: "none",
  skin: "#bd815e", hairColor: "#39302e", accent: "#e5dbc9", shirtColor: "#d97654", accessoryColor: "#74618c",
  faceWidth: 50, eyeSize: 50, eyeSpacing: 50, browTilt: 50, noseSize: 50, mouthWidth: 50,
  freckles: false, animated: true,
});
function validateCharacter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).some(key => !Object.hasOwn(CHARACTER_DEFAULTS, key))) return null;
  const config = {};
  for (const [key, fallback] of Object.entries(CHARACTER_DEFAULTS)) {
    const value = Object.hasOwn(input, key) ? input[key] : fallback;
    if (CHARACTER_OPTIONS[key]) {
      if (!CHARACTER_OPTIONS[key].includes(value)) return null;
    } else if (typeof fallback === "number") {
      if (!Number.isInteger(value) || value < 0 || value > 100) return null;
    } else if (typeof fallback === "boolean") {
      if (typeof value !== "boolean") return null;
    } else if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
    config[key] = typeof value === "string" && value.startsWith("#") ? value.toLowerCase() : value;
  }
  return config;
}
function parseCharacter(value) {
  if (typeof value !== "string" || value.length > 1500 || !value.startsWith(CHARACTER_PREFIX)) return null;
  try { return validateCharacter(JSON.parse(value.slice(CHARACTER_PREFIX.length))); } catch { return null; }
}
function encodeCharacter(input) {
  const config = validateCharacter(input);
  if (!config) throw new Error("Invalid character settings");
  return CHARACTER_PREFIX + JSON.stringify(config);
}
module.exports = { CHARACTER_OPTIONS, CHARACTER_DEFAULTS, parseCharacter, encodeCharacter, validateCharacter };
