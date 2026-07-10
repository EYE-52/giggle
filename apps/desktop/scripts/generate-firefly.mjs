// Generate Giggle's photographic assets via Adobe Firefly Services API.
//
// Usage:
//   1. Put creds in giggle-app/.firefly.env:
//        FIREFLY_CLIENT_ID=xxxx
//        FIREFLY_CLIENT_SECRET=xxxx
//   2. node apps/desktop/scripts/generate-firefly.mjs
//
// Requires Adobe Developer Console project with "Firefly Services" API enabled
// (OAuth Server-to-Server credentials). Outputs land in apps/desktop/public/img/.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/img");
const ENV_FILE = path.resolve(__dirname, "../../.firefly.env");

const STYLE =
  "cinematic 35mm photo, moody neon nightlife lighting with violet and lime rim light, " +
  "deep near-black background, high-energy candid, shallow depth of field, no text, no logos, no watermark";

// Firefly v3 supports a fixed set of sizes; pick the closest aspect per asset.
const SIZES = {
  landscape: { width: 2304, height: 1792 },
  portrait: { width: 1792, height: 2304 },
  square: { width: 1024, height: 1024 },
};

const ASSETS = [
  { file: "venue-neon-nights.jpg", size: SIZES.landscape, prompt: "A packed downtown lounge dance floor glowing in violet and pink neon, silhouettes of a small group of friends laughing together, disco haze" },
  { file: "venue-midnight-gamers.jpg", size: SIZES.landscape, prompt: "A dim gaming lounge with blue and teal monitor glow, several friends at a couch setup with controllers, esports energy" },
  { file: "match-your-squad.jpg", size: SIZES.portrait, prompt: "Four stylish young friends crowded together taking a group selfie at a neon rooftop party, violet light, joyful" },
  { file: "match-opponent-squad.jpg", size: SIZES.portrait, prompt: "A different group of four confident friends posing at a neon-lit bar, lime and pink light, playful rivalry energy" },
  { file: "avatar-alex.jpg", size: SIZES.square, prompt: "Portrait of a stylish gen-z person with an undercut, half-lit by violet and lime neon, looking at camera, confident" },
  { file: "onboarding-hero.jpg", size: SIZES.portrait, prompt: "Overhead shot of a diverse squad of friends huddled in a circle looking up, neon floor glow, celebratory" },
];

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile(ENV_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}

async function getToken(id, secret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
    scope: "openid,AdobeID,firefly_api,ff_apis",
  });
  const res = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`IMS token failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function generate({ prompt, size }, token, clientId) {
  const res = await fetch("https://firefly-api.adobe.io/v3/images/generate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: `${prompt}, ${STYLE}`, numVariations: 1, size }),
  });
  if (!res.ok) throw new Error(`generate failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const url = data?.outputs?.[0]?.image?.url;
  if (!url) throw new Error(`no image url in response: ${JSON.stringify(data).slice(0, 300)}`);
  return url;
}

async function main() {
  const env = await loadEnv();
  const id = env.FIREFLY_CLIENT_ID;
  const secret = env.FIREFLY_CLIENT_SECRET;
  if (!id || !secret) {
    console.error("Missing FIREFLY_CLIENT_ID / FIREFLY_CLIENT_SECRET (set them in giggle-app/.firefly.env).");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  console.log("Authenticating with Adobe IMS…");
  const token = await getToken(id, secret);
  console.log("Token OK. Generating", ASSETS.length, "images…\n");

  for (const asset of ASSETS) {
    try {
      process.stdout.write(`• ${asset.file} … `);
      const url = await generate(asset, token, id);
      const img = Buffer.from(await (await fetch(url)).arrayBuffer());
      await writeFile(path.join(OUT_DIR, asset.file), img);
      console.log(`saved (${(img.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.log(`FAILED — ${e.message}`);
    }
  }
  console.log("\nDone. Images in apps/desktop/public/img/. Reload the app to see them.");
}

main().catch((e) => { console.error(e); process.exit(1); });
