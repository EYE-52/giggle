const assert = require("node:assert/strict");
const { lstatSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("unified deployment docs keep verified-adult discovery disabled by default", () => {
  const envPath = path.join(root, "server/.env.example");
  assert.equal(lstatSync(envPath).isSymbolicLink(), false);

  const envExample = read("server/.env.example");
  const docs = [read("README.md"), read("server/README.md"), read("DEPLOYMENT.md")].join("\n");
  const required = [
    "YOTI_AGE_API_KEY",
    "YOTI_AGE_SDK_ID",
    "AGE_VERIFICATION_CALLBACK_URL",
    "STRANGER_DISCOVERY_ENABLED",
    "NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED",
    "EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED",
    "EXPO_PUBLIC_IOS_DISCOVERY_ENABLED",
    "ADMIN_EMAIL",
  ];

  for (const name of required) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
    assert.match(docs, new RegExp(name));
  }

  assert.match(envExample, /^STRANGER_DISCOVERY_ENABLED=false$/m);
  assert.match(docs, /apps\/desktop/);
  assert.match(docs, /apps\/mobile/);
  assert.match(docs, /server\//);
  assert.doesNotMatch(docs, /\.\.\/giggle-server|giggle-app\/|legacy `?giggle-web|top-level `?giggle-web/i);
  assert.match(docs, /missing Yoti configuration[\s\S]*social access[\s\S]*fail(?:s)? closed/i);
  assert.match(docs, /identity[\s\S]*support[\s\S]*export[\s\S]*delet/i);

  const deploy = read("DEPLOYMENT.md");
  const order = [
    "Provision Mongo",
    "Deploy `server/` to Railway",
    "Deploy the repository root to Vercel",
    "Build `apps/mobile` with Expo/EAS",
    "two verified accounts",
  ].map((step) => deploy.indexOf(step));
  assert.equal(order.every((position) => position >= 0), true);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));

  const vercel = read("vercel.json");
  assert.doesNotMatch(vercel, /YOTI_|AGE_VERIFICATION_CALLBACK_URL|ADMIN_EMAIL/);
  assert.match(vercel, /"NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED": "false"/);
});
