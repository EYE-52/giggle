// Boots the API from exactly the files the deploy ships (server/ minus
// .dockerignore, which Railway's build honours) and fails unless it stays
// healthy after its delayed startup jobs have run. Catches code that works in
// the repo but requires something the image doesn't contain.
//
//   npm run verify:deploy-bundle        # uses .env.local (local Mongo/Redis)
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER_ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.VERIFY_PORT) || 3099;
const STARTUP_TIMEOUT_MS = 30_000;
const STAY_HEALTHY_MS = 20_000;

function ignorePatterns() {
  return fs.readFileSync(path.join(SERVER_ROOT, ".dockerignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => ({
      negate: line.startsWith("!"),
      regex: new RegExp(`^${line.replace(/^!/, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`),
    }));
}

function isIgnored(name, patterns) {
  let ignored = false;
  for (const { negate, regex } of patterns) if (regex.test(name)) ignored = !negate;
  return ignored;
}

function buildBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-deploy-bundle-"));
  const patterns = ignorePatterns();
  for (const name of fs.readdirSync(SERVER_ROOT)) {
    if (isIgnored(name, patterns)) continue;
    fs.cpSync(path.join(SERVER_ROOT, name), path.join(dir, name), { recursive: true });
  }
  // The build installs dependencies into the image; reuse the local install.
  fs.symlinkSync(path.join(SERVER_ROOT, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

async function healthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const bundle = buildBundle();
  const envFile = path.join(SERVER_ROOT, ".env.local");
  const args = [...(fs.existsSync(envFile) ? [`--env-file=${envFile}`] : []), "src/server.js"];
  const child = spawn(process.execPath, args, {
    cwd: bundle,
    env: { ...process.env, PORT: String(PORT), COVER_BACKFILL_DELAY_MS: "1000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited = null;
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("exit", (code) => { exited = code; });

  const fail = (reason) => {
    console.error(`Deploy bundle check FAILED: ${reason}\n--- server output ---\n${output.slice(-4000)}`);
    child.kill("SIGTERM");
    fs.rmSync(bundle, { recursive: true, force: true });
    process.exit(1);
  };

  const started = Date.now();
  while (!(await healthy())) {
    if (exited !== null) fail(`server exited with code ${exited} before becoming healthy`);
    if (Date.now() - started > STARTUP_TIMEOUT_MS) fail("server did not become healthy in time");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const healthyAt = Date.now();
  while (Date.now() - healthyAt < STAY_HEALTHY_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (exited !== null) fail(`server crashed ${Math.round((Date.now() - healthyAt) / 1000)}s after becoming healthy (exit ${exited})`);
    if (!(await healthy())) fail("health check stopped passing");
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  fs.rmSync(bundle, { recursive: true, force: true });
  console.log(`Deploy bundle check passed: healthy for ${STAY_HEALTHY_MS / 1000}s after startup jobs ran.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
